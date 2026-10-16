// Tiny localStorage store. Emits window 'koc:change' with {id} after every change.
// The koordinator / revizni screens render a pre-baked state for their demo date
// whenever the stored (live) case has not progressed that far yet.
import { currentScreen } from './dates.js';
import { loadJSON } from './data.js';
import { seedDraft, seedActive, seedClosed } from './seed.js';

const KEY = 'koc-demo-v1';
const data = {};
let state = null;

export async function initStore() {
  const files = ['handover-novak', 'template-pancreas', 'closed-cases', 'mdt-structured-novak', 'queue'];
  const [handover, template, closed, mdt, queue] = await Promise.all(files.map((f) => loadJSON(`data/${f}.json`)));
  Object.assign(data, { handover, template, closed, mdt, queue });
  window.addEventListener('storage', (e) => {
    if (e.key === KEY || e.key === null) { state = null; emit(null); }
  });
}

/** Static demo data loaded at startup (template, handover, ...). */
export const getData = () => data;

function readState() {
  if (state) return state;
  try { state = JSON.parse(localStorage.getItem(KEY)) || { cases: {} }; } catch { state = { cases: {} }; }
  if (!state.cases) state.cases = {};
  return state;
}

function writeState(s) {
  state = s;
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable: keep in memory */ }
}

function emit(id) {
  window.dispatchEvent(new CustomEvent('koc:change', { detail: { id } }));
}

export const getStoredCase = (id) => readState().cases[id] || null;

/** True when the screen shows the pre-baked state for its demo date (no newer live state). */
export function isPrebaked(id, screen = currentScreen()) {
  const phase = getStoredCase(id)?.phase || 'draft';
  return (screen === 'koordinator' && phase === 'draft') || (screen === 'revizni' && phase !== 'closed');
}

export function getCase(id, screen = currentScreen()) {
  if (screen === 'koordinator' && isPrebaked(id, screen)) return seedActive(data);
  if (screen === 'revizni' && isPrebaked(id, screen)) return seedClosed(data);
  return getStoredCase(id) || seedDraft(data);
}

/**
 * Apply patchFn to a copy of the case as currently shown (or the stored one with
 * {base: 'stored'}) and persist it. Returning false from patchFn aborts.
 */
export function updateCase(id, patchFn, { base = 'view' } = {}) {
  const current = base === 'stored' ? (getStoredCase(id) || seedDraft(data)) : getCase(id);
  const c = structuredClone(current);
  if (patchFn(c) === false) return null;
  c.updatedAt = new Date().toISOString();
  const s = readState();
  writeState({ ...s, cases: { ...s.cases, [id]: c } });
  emit(id);
  return c;
}

export function reset() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  state = { cases: {} };
  emit(null);
}
