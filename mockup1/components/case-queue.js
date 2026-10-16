import { KocElement } from './lib/base.js';
import { html } from './lib/html.js';
import { icon } from './lib/icons.js';
import { getCase, getData } from './lib/store.js';
import { computeMissing, openItems, nextTask } from './lib/derive.js';
import { takeOver } from './lib/actions.js';
import { toast } from './lib/toast.js';
import { daysBetween, demoDate, fmtDate, dateOnly } from './lib/dates.js';

const STATE = {
  new: ['accent', 'nový'], active: ['ok', 'aktivní'], postponed: ['warn', 'odložený'], overdue: ['miss', 'po termínu'],
  pending: ['warn', 'čeká na potvrzení'], closed: ['ok', 'uzavřeno'],
};

/** Queue entry for Novák derived from live case state. */
export function liveNovak(base) {
  const c = getCase('novak', 'koordinator');
  const tpl = getData().template;
  const today = demoDate('koordinator');
  const e = { ...base };
  if (c.phase === 'submitted') {
    Object.assign(e, { state: 'new', context: `od ${fmtDate(c.submittedAt)} · MUDr. Dvořáková`, nextStep: 'převzít a spustit sadu',
      due: today, dueLabel: `dnes ${fmtDate(today)}`, owner: 'vy (koordinátor)', missing: 0, canTakeOver: true });
  } else if (c.phase === 'closed-pending-ack' || c.phase === 'closed') {
    const done = c.phase === 'closed';
    Object.assign(e, { state: done ? 'closed' : 'pending', context: c.diagnosis || '', nextStep: done ? 'žádný · případ uzavřen' : 'potvrzení příjmu',
      due: '2026-01-27', dueLabel: done ? `potvrzeno ${fmtDate(c.timeline.ack)}` : '27. 1.', owner: done ? 'nikdo' : 'MUDr. Jana Dvořáková', missing: 0 });
  } else {
    const t = nextTask(c);
    const missing = openItems(computeMissing(c, tpl, 'koordinator')).length;
    const day = daysBetween(c.timeline.referral, today) + 1;
    const overdue = c.tasks.some((x) => x.status !== 'done' && dateOnly(x.due) < today);
    Object.assign(e, {
      state: 'active', overdue, context: `den ${day} z cílových ${tpl.targets.t2}`, missing,
      nextStep: t ? t.short : 'nahrát zprávu z MDT',
      due: t ? t.due : today,
      dueLabel: t ? (dateOnly(t.due) === today ? `dnes ${fmtDate(t.due)}` : dateOnly(t.due) < today ? `termín byl ${fmtDate(t.due, { time: false })}` : fmtDate(t.due)) : `dnes ${fmtDate(today)}`,
      owner: t ? t.owner : 'vy (koordinátor)',
    });
  }
  return e;
}

/** Totals from queue.json adjusted for Novák's live state (baseline counts him as active). */
export function adjustedTotals(q) {
  const t = { ...q.totals };
  const n = liveNovak(q.cases.find((c) => c.id === 'novak'));
  if (n.state !== 'active') { t.active -= 1; if (n.state === 'new') t.new += 1; if (n.state === 'closed' || n.state === 'pending') t.all -= 1; }
  return t;
}

class CaseQueue extends KocElement {
  static styles = `
    .tabs { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
    .tabs button { min-height: 36px; border-radius: 999px; padding: 0 12px; font-size: 13.5px; }
    .tabs button[aria-pressed="true"] { background: var(--ink); color: #fff; border-color: var(--ink); }
    .tabs .n { font-family: var(--font-mono); font-weight: 500; margin-left: 2px; }
    ul { display: grid; gap: 8px; }
    .qcard { border: 1px solid var(--line); border-radius: var(--radius-ctl); background: var(--surface); }
    .qcard.sel { border: 2px solid var(--accent); }
    .qcard.overdue:not(.sel) { border-color: #EDB8B3; }
    .main { display: grid; gap: 4px; width: 100%; text-align: left; background: none; border: 0; padding: 12px; font: inherit; color: inherit; cursor: pointer; border-radius: var(--radius-ctl); }
    .qcard.sel .main { padding: 11px; }
    .main:hover { background: #FAFAF8; }
    .top { display: flex; justify-content: space-between; gap: 8px; align-items: center; flex-wrap: wrap; }
    .name { font-weight: 600; }
    .line { font-size: 13.5px; color: var(--muted); }
    .line strong { color: var(--ink); font-weight: 600; }
    .owner { font-size: 13.5px; }
    .tail { padding: 0 12px 12px; }
    .foot { margin-top: 10px; font-size: 12.5px; color: var(--muted); }
  `;

  init() {
    this.filter ??= 'all';
    this.selected ??= this.getAttribute('selected') || 'novak';
  }

  entries() {
    const q = getData().queue;
    return q.cases.map((c) => (c.live ? liveNovak(c) : c))
      .sort((a, b) => (!!b.overdue - !!a.overdue) || (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  }

  render() {
    const q = getData().queue;
    const t = adjustedTotals(q);
    const all = this.entries();
    const shown = all.filter((e) => this.filter === 'all' || e.state === this.filter);
    const tabs = [['all', 'Vše', t.all], ['new', 'Nový', t.new], ['active', 'Aktivní', t.active], ['postponed', 'Odložený', t.postponed]];
    return html`
      <section class="card" aria-labelledby="q-h">
        <div class="card-head"><h2 id="q-h">Pracovní fronta</h2><span class="muted small">po termínu nahoře, pak dle termínu</span></div>
        <div class="tabs" role="group" aria-label="Filtr stavu">
          ${tabs.map(([id, label, n]) => html`<button class="btn" type="button" data-action="filter" data-f="${id}" data-key="f-${id}" aria-pressed="${this.filter === id}">${label} <span class="n">${n}</span></button>`)}
        </div>
        <ul aria-live="polite">
          ${shown.map((e) => {
            const [tone, label] = e.overdue ? STATE.overdue : STATE[e.state];
            const sel = e.id === this.selected;
            return html`<li class="qcard ${sel ? 'sel' : ''} ${e.overdue ? 'overdue' : ''}">
              <button class="main" type="button" data-action="select" data-id="${e.id}" data-key="q-${e.id}" aria-pressed="${sel}">
                <span class="top"><span class="name">${e.name}, ${e.age}</span><span class="pill ${tone}">${label}</span></span>
                <span class="line"><span class="mono">${e.dg}</span>${e.context ? ` · ${e.context}` : ''}</span>
                <span class="line">Další krok: <strong>${e.nextStep}</strong> · ${e.dueLabel}</span>
                <span class="owner">Na tahu: <strong>${e.owner}</strong></span>
                ${e.missing ? html`<span><span class="pill miss">${e.missing} chybí</span></span>` : ''}
              </button>
              ${e.canTakeOver ? html`<div class="tail"><button class="btn primary sm" type="button" data-action="takeover" data-key="takeover">${icon('check')}Převzít a spustit sadu</button></div>` : ''}
            </li>`;
          })}
        </ul>
        ${!shown.length ? html`<p class="empty">V tomto filtru nejsou v demu žádné případy.</p>` : ''}
        <p class="foot">Zobrazeno ${shown.length} z ${t.all} · ostatní případy jsou v demu skryté.</p>
      </section>`;
  }

  onClick(e, el, action) {
    if (action === 'filter') { this.filter = el.dataset.f; this.update(); }
    if (action === 'select') {
      if (el.dataset.id !== 'novak') toast('Detail je v demu k dispozici jen pro pana Nováka.');
      else { this.selected = 'novak'; this.update(); }
    }
    if (action === 'takeover') takeOver('novak');
  }
}
customElements.define('case-queue', CaseQueue);
