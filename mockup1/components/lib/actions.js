// Domain actions used by components. All state changes go through store.updateCase.
import { updateCase, getCase, getStoredCase, templateFor } from './store.js';
import { CASES } from './cases.js';
import { computeMissing, openItems } from './derive.js';
import { applyTemplate, applyMdtConclusion, acknowledge, GP_NAME, COORDINATOR_NAME, REVIEWER_NAME } from './seed.js';
import { nowStamp, demoDate, dateOnly, maxDate, currentScreen, fmtDate } from './dates.js';
import { toast } from './toast.js';

const uid = () => Math.random().toString(36).slice(2, 9);

export function updateServiceRequest(id, patch) {
  updateCase(id, (c) => { Object.assign(c.serviceRequest, patch); });
}

export function setSourcesLoaded(id, count, documents) {
  const c = getCase(id);
  if (c.phase !== 'draft' || (c.sources?.count === count && c.sources?.documents === documents)) return;
  updateCase(id, (x) => { x.sources = { count, documents, loadedAt: new Date().toISOString() }; });
}

export function setSourcesExcluded(id, excluded) {
  updateCase(id, (c) => { c.sourcesExcluded = excluded; });
}

export function addUploads(id, files) {
  updateCase(id, (c) => { c.uploads = [...(c.uploads || []), ...files]; });
}

export function patchUpload(id, uploadId, patch) {
  updateCase(id, (c) => {
    const u = c.uploads.find((x) => x.id === uploadId);
    if (u) Object.assign(u, patch);
  });
}

export function removeUpload(id, uploadId) {
  updateCase(id, (c) => { c.uploads = c.uploads.filter((u) => u.id !== uploadId); });
}

export function setHandoverDraft(id, result) {
  updateCase(id, (c) => {
    if (c.handover) return false;
    c.handover = { ...result.data, model: result.model, latencyMs: result.latencyMs, draftedAt: new Date().toISOString() };
  });
}

export function editHandoverSection(id, sectionId, text) {
  updateCase(id, (c) => {
    const s = c.handover.sections.find((x) => x.id === sectionId);
    if (!s || s.text === text) return false;
    s.text = text;
    s.editedBy = GP_NAME;
  });
}

export function setEcog(id, value) {
  updateCase(id, (c) => {
    if (value == null) delete c.values.ecog;
    else c.values.ecog = { value, at: demoDate('gp'), by: GP_NAME };
  });
}

export function submitReferral(id) {
  updateCase(id, (c) => {
    c.phase = 'submitted';
    c.submittedAt = nowStamp('gp');
    c.handover.provenance = { draftedBy: `llm:${c.handover.model || 'mock'}`, verifiedBy: GP_NAME, at: new Date().toISOString() };
  });
}

export function takeOver(id) {
  const c0 = getCase(id);
  const tpl = templateFor(c0);
  updateCase(id, (c) => {
    applyTemplate(c, tpl);
    c.phase = 'active';
    c.takenOverAt = nowStamp('koordinator');
    const ecogOpen = openItems(computeMissing(c, tpl, 'koordinator')).some((m) => m.id === 'ecog');
    if (ecogOpen) {
      c.messages.push({ id: uid(), from: 'Koordinátor', to: c.serviceRequest.requester, channel: 'app', at: nowStamp('koordinator'),
        text: `Dobrý den, prosím o doplnění ECOG ${c.patient.refGen}.`, requests: 'ecog' });
    }
    c.messages.push({ id: uid(), from: 'Koordinátor', to: 'pacient', channel: 'sms', at: nowStamp('koordinator'),
      text: CASES[id].takeoverSms });
  });
  toast(`Případ převzat · sada „${tpl.title}“ spuštěna (${tpl.tasks.length} úkolů)`);
}

export const pendingDeps = (c, task) =>
  task.dependsOn.map((d) => c.tasks.find((t) => t.id === d)).filter((t) => t && t.status !== 'done');

/** Returns {ok} | {blocked: [titles]} | {auto: true}. */
export function completeTask(id, taskId) {
  const c = getCase(id);
  const task = c.tasks.find((t) => t.id === taskId);
  if (!task || task.status === 'done') return { ok: true };
  if (task.auto) return { auto: true };
  const blockers = pendingDeps(c, task);
  if (blockers.length) return { blocked: blockers.map((t) => t.title) };
  updateCase(id, (x) => {
    const t = x.tasks.find((y) => y.id === taskId);
    t.status = 'done';
    t.doneAt = maxDate(dateOnly(t.due), demoDate());
    for (const other of x.tasks) {
      if (other.status === 'todo' && !pendingDeps(x, other).length) other.status = 'running';
    }
  });
  return { ok: true };
}

export function addTask(id, { title, owner, due }) {
  updateCase(id, (c) => {
    c.tasks.push({ id: `custom-${uid()}`, title, short: title, note: 'přidáno ručně', owner, priority: 'normal',
      dependsOn: [], auto: false, due, status: 'running', doneAt: null });
  });
}

export function sendMessage(id, msg) {
  updateCase(id, (c) => { c.messages.push({ id: uid(), at: nowStamp(), channel: 'app', ...msg }); });
}

export function remindEcog(id) {
  const c = getCase(id);
  const mdt = c.tasks.find((t) => t.id === 'mdt1');
  sendMessage(id, { from: 'Koordinátor', to: c.serviceRequest.requester, channel: 'app', requests: 'ecog', reminder: true,
    text: `Připomínka: prosím o doplnění výkonnostního stavu (ECOG 0–4) ${c.patient.refGen}${mdt ? ` – podmínka pro 1. MDT ${fmtDate(mdt.due, { time: false })}` : ''}.` });
  toast(`Připomínka odeslána ${c.serviceRequest.requesterDat}`);
}

let ackTimer = null;

export function sendMdtConclusion(id, structured, model) {
  updateCase(id, (c) => applyMdtConclusion(c, structured, { verifiedBy: COORDINATOR_NAME, model }));
  toast('Závěr MDT odeslán referujícímu a reviznímu lékaři (demo: přeskok na 27. 1.)');
  clearTimeout(ackTimer);
  // Simulated GP acknowledgement.
  ackTimer = setTimeout(() => {
    if (getStoredCase(id)?.phase === 'closed-pending-ack') {
      acknowledgeCase(id);
      toast('MUDr. Dvořáková potvrdila převzetí 27. 1. 09:14 · případ uzavřen', { href: '#/revizni', linkText: 'Pohled revizního lékaře' });
    }
  }, 4000);
}

export function acknowledgeCase(id) {
  clearTimeout(ackTimer);
  updateCase(id, (c) => {
    if (c.phase !== 'closed-pending-ack') return false;
    acknowledge(c);
  }, { base: 'stored' });
}

export function markReviewed(id) {
  updateCase(id, (c) => {
    c.review = { status: 'checked', at: nowStamp('revizni'), by: REVIEWER_NAME,
      provenance: { draftedBy: 'llm:mock', verifiedBy: REVIEWER_NAME, at: new Date().toISOString() } };
  });
  toast('Případ označen jako zkontrolovaný');
}

export function askQuestion(id, text) {
  updateCase(id, (c) => {
    c.messages.push({ id: uid(), from: `${REVIEWER_NAME} (revize VZP)`, to: 'Koordinátor', channel: 'app',
      at: nowStamp('revizni'), text, kind: 'question' });
    c.review = { ...c.review, status: 'question' };
  });
  toast('Dotaz odeslán koordinátorce', { href: '#/koordinator', linkText: 'Zobrazit ve vlákně' });
}

export { currentScreen };
