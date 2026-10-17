// Pure, deterministic derivations from case state (no LLM here).
import { daysBetween, demoDate, fmtDate, plural, days, isOverdue } from './dates.js';

/**
 * Completeness check: compares template required fields with the handover text,
 * explicit values (e.g. ECOG) and finished tasks. Rule-based, never AI.
 */
export function computeMissing(c, tpl, audience = 'gp') {
  const text = (c.handover?.sections || []).map((s) => s.text).join('\n');
  return tpl.requiredFields
    .filter((f) => audience === 'gp' || f.severity !== 'recommended')
    .map((f) => {
      const task = f.resolvedByTask ? c.tasks.find((t) => t.id === f.resolvedByTask) : null;
      const value = f.valueKey ? c.values?.[f.valueKey] : null;
      let resolvedAt = null;
      let resolvedBy = null;
      const doc = f.dxStep ? c.docFindings?.[f.dxStep] : null;
      if (value) { resolvedAt = value.at; resolvedBy = 'value'; }
      else if (doc) { resolvedAt = doc.at; resolvedBy = 'document'; }
      else if (task?.status === 'done') { resolvedAt = task.doneAt; resolvedBy = 'task'; }
      else if (c.handover && new RegExp(f.pattern, 'i').test(text)) { resolvedAt = c.timeline.referral; resolvedBy = 'handover'; }
      return { ...f, task, value, doc, resolvedAt, resolvedBy };
    });
}

export const openItems = (list) => list.filter((m) => !m.resolvedAt);

export function missingSummary(open) {
  const blocking = open.filter((m) => m.severity === 'blocks-mdt').length;
  if (!open.length) return { text: 'podklady kompletní', tone: 'ok' };
  const n = open.length;
  let text = `${n} ${plural(n, 'údaj', 'údaje', 'údajů')} chybí`;
  if (blocking) text += ` · ${blocking} ${plural(blocking, 'blokuje', 'blokují', 'blokuje')} MDT`;
  return { text, tone: blocking ? 'miss' : 'warn' };
}

export function ecogDelay(c) {
  const e = c.values?.ecog;
  return e ? Math.max(0, daysBetween(c.timeline.referral, e.at)) : 0;
}

/** Workflow steps 01–04 with state done | done-with-issue | active | todo. */
export function deriveSteps(c, tpl, screen) {
  const audience = screen === 'gp' || screen === 'overview' ? 'gp' : 'koordinator';
  const open = openItems(computeMissing(c, tpl, audience));
  const blocking = open.filter((m) => m.severity === 'blocks-mdt');
  const gpOpen = open.filter((m) => m.severity === 'gp');
  const mdtTask = c.tasks.find((t) => t.id === 'mdt1');
  const srcCount = c.sources?.count ?? 14;
  const s = [
    { n: 1, title: 'Převzít' }, { n: 2, title: 'Vytěžit' },
    { n: 3, title: 'Koordinovat' }, { n: 4, title: 'Zpětná vazba' },
  ];
  const set = (i, state, status, pill) => Object.assign(s[i], { state, status, pill });
  const closedish = c.phase === 'closed' || c.phase === 'closed-pending-ack';

  if (c.phase === 'draft') {
    set(0, 'active', `FHIR načten · ${srcCount} zdrojů + epikríza`);
    set(1, 'active', c.handover ? 'AI návrh hotov · čeká na vaši kontrolu' : 'AI vytěžuje dokumentaci…',
      c.handover && open.length ? { text: `${open.length} chybí`, tone: 'miss' } : null);
    set(2, 'todo', 'Po odeslání převezme koordinátor KOC');
    set(3, 'todo', 'Závěr MDT se vrátí k vám');
  } else {
    set(0, 'done', c.sources?.label || (closedish ? `FHIR + epikríza · ${srcCount} zdrojů` : `Převzato z FHIR · ${srcCount} zdrojů + epikríza`));
    const late = ecogDelay(c);
    if (gpOpen.length) {
      set(1, 'done-with-issue', `${gpOpen.length} ${plural(gpOpen.length, 'dotaz na lékaře otevřený', 'dotazy na lékaře otevřené', 'dotazů na lékaře otevřených')}`);
    } else if (closedish && late > 0) {
      set(1, 'done-with-issue', `ECOG doplněn až ${fmtDate(c.values.ecog.at)}`, { text: `chyběl ${days(late)}`, tone: 'warn' });
    } else {
      set(1, 'done', 'Handover potvrzen lékařem');
    }
    if (c.phase === 'submitted') {
      set(2, 'active', 'Čeká na převzetí koordinátorem');
      set(3, 'todo', 'Po nahrání zprávy z MDT');
    } else if (!closedish) {
      const mdtDate = mdtTask ? fmtDate(mdtTask.due, { time: false }) : '';
      if (mdtTask?.status === 'done') set(2, 'active', 'MDT proběhlo · nahrajte závěr');
      else if (blocking.length) set(2, 'active', `${blocking.length} ${plural(blocking.length, 'blokuje', 'blokují', 'blokuje')} MDT ${mdtDate}`);
      else set(2, 'active', `podklady kompletní · MDT ${mdtDate}`);
      if (c.tasks.some((t) => isOverdue(t, screen, c.id))) s[2].pill = { text: 'po termínu', tone: 'miss' };
      set(3, 'todo', 'Po nahrání zprávy z MDT');
    } else {
      const issue = c.mdt.find((m) => m.issue);
      set(2, issue ? 'done-with-issue' : 'done', `${c.tasks.length} úkolů · ${c.mdt.length}× MDT`,
        issue ? { text: issue.issue, tone: 'warn' } : null);
      if (c.phase === 'closed') set(3, 'done', `PL potvrdil příjem ${fmtDate(c.timeline.ack, { time: false })}`);
      else set(3, 'active', 'Odesláno PL a revizi · čeká na potvrzení');
    }
  }

  let summary;
  if (c.phase === 'closed') summary = { text: 'všechny kroky uzavřeny', tone: 'ok' };
  else if (c.phase === 'closed-pending-ack') summary = { text: 'čeká na potvrzení PL', tone: 'warn' };
  else if (c.phase === 'draft' && !c.handover) summary = { text: 'probíhá vytěžení', tone: 'ai' };
  else summary = missingSummary(open);
  return { steps: s, summary, open };
}

/** Time-to-treatment segments T1 + T2 + T3 (days). */
export function deriveTT(c, tpl, screen) {
  const t = c.timeline;
  const today = demoDate(screen, c.id);
  const segs = [];
  segs.push({ key: 'T1', desc: 'symptom → KOC', days: daysBetween(t.symptom, t.referral), state: 'done' });
  if (t.mdtDecision) {
    segs.push({ key: 'T2', desc: 'diagnostika → MDT', days: daysBetween(t.referral, t.mdtDecision), state: 'done' });
  } else if (c.phase === 'draft') {
    segs.push({ key: 'T2', desc: 'diagnostika → MDT', days: null, width: tpl.targets.t2, state: 'future' });
  } else {
    const run = Math.max(0, daysBetween(t.referral, today));
    segs.push({ key: 'T2', desc: 'diagnostika → MDT', days: run, state: run > tpl.targets.t2 ? 'over' : 'running' });
    const rem = tpl.targets.t2 - run;
    if (rem > 0) segs.push({ key: 'rest', desc: 'zbývá do cíle MDT', days: rem, state: 'remaining' });
  }
  if (t.treatmentStart) {
    segs.push({ key: 'T3', desc: 'MDT → léčba', days: daysBetween(t.mdtDecision, t.treatmentStart), state: 'done' });
  } else if (t.mdtDecision) {
    segs.push({ key: 'T3', desc: 'MDT → léčba', days: Math.max(0, daysBetween(t.mdtDecision, today)), state: 'running' });
  } else {
    segs.push({ key: 'T3', desc: 'MDT → léčba', days: null, width: tpl.targets.t3 / 2, state: 'future' });
  }
  const elapsed = segs.filter((x) => x.state !== 'remaining' && x.days != null).reduce((a, x) => a + x.days, 0);
  return { segs, elapsed };
}

/** Reviewer indicators, computed from the case timeline. */
export function deriveIndicators(c, tpl) {
  const t = c.timeline;
  const total = tpl.mdtChecklist.length;
  return {
    tt: t.treatmentStart ? daysBetween(t.symptom, t.treatmentStart) : null,
    t1: daysBetween(t.symptom, t.referral),
    t2: t.mdtDecision ? daysBetween(t.referral, t.mdtDecision) : null,
    t3: t.treatmentStart && t.mdtDecision ? daysBetween(t.mdtDecision, t.treatmentStart) : null,
    completeness: c.mdt.map((m) => ({
      title: m.title, total,
      have: tpl.mdtChecklist.filter((k) => (m.available || []).includes(k)).length,
    })),
    decisionMdt: c.mdt.find((m) => m.decision),
  };
}

export function deriveEvents(c) {
  const t = c.timeline;
  const task = (id) => c.tasks.find((x) => x.id === id && x.status === 'done');
  const ev = [
    { date: t.symptom, label: 'Symptom – ikterus' },
    { date: t.referral, label: 'Referování PL → KOC' },
  ];
  if (task('ercp')) ev.push({ date: task('ercp').doneAt, label: 'ERCP, stent, histologie' });
  if (task('ct')) ev.push({ date: task('ct').doneAt, label: task('markers') ? 'CT, nádorové markery' : 'CT břicha' });
  c.mdt.forEach((m) => ev.push({ date: m.date, label: m.timelineLabel || m.title, tone: m.issue ? 'warn' : null, strong: !!m.issue }));
  if (t.treatmentStart) ev.push({ date: t.treatmentStart, label: 'Operace – zahájení léčby', tone: 'accent', strong: true });
  if (t.ack) ev.push({ date: t.ack, label: 'Předání PL potvrzeno' });
  return ev.map((e, i) => ({ ...e, i })).sort((a, b) => (a.date.slice(0, 10) === b.date.slice(0, 10) ? a.i - b.i : a.date < b.date ? -1 : 1));
}

/** Next actionable task ("Na tahu"). */
export function nextTask(c) {
  return c.tasks
    .filter((t) => t.status !== 'done' && t.dependsOn.every((d) => c.tasks.find((x) => x.id === d)?.status === 'done'))
    .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0))[0] || null;
}
