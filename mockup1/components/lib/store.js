// Tiny localStorage store. Emits window 'koc:change' with {id} after every change ({id: null} = all).
// The koordinator / mdt / revizni screens render a pre-baked state for their demo date
// whenever the stored (live) case has not progressed that far yet (see cases.js).
import { currentScreen } from './dates.js';
import { loadJSON } from './data.js';
import { CASES } from './cases.js';

const KEY = 'koc-demo-v2';
const data = {};
let state = null;

export async function initStore() {
  const files = ['handover-novak', 'handover-vesela', 'template-pancreas', 'template-ovary', 'closed-cases', 'mdt-structured-novak', 'queue'];
  const [handover, handoverVesela, pancreas, ovary, closed, mdt, queue] = await Promise.all(files.map((f) => loadJSON(`data/${f}.json`)));
  Object.assign(data, {
    handover, handovers: { novak: handover, vesela: handoverVesela },
    template: pancreas, templates: { [pancreas.id]: pancreas, [ovary.id]: ovary },
    closed, mdt, queue,
  });
  window.addEventListener('storage', (e) => {
    if (e.key === KEY || e.key === null) { state = null; emit(null); }
  });
}

/** Static demo data loaded at startup (templates, handovers, ...). */
export const getData = () => data;

/** Care-plan template (PlanDefinition) of a case. */
export const templateFor = (c) => data.templates[c.carePlan?.template || CASES[c.id].template];

function readState() {
  if (state) return state;
  try { state = JSON.parse(localStorage.getItem(KEY)) || { cases: {} }; } catch { state = { cases: {} }; }
  if (!state.cases) state.cases = {};
  if (!state.selected) state.selected = {};
  return state;
}

function writeState(s) {
  state = s;
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable: keep in memory */ }
}

function emit(id) {
  window.dispatchEvent(new CustomEvent('koc:change', { detail: { id } }));
}

/** Case shown by components with case-id="selected" on a screen (queue / MDT program pick). */
export const getSelected = (screen = currentScreen()) => readState().selected[screen] || 'novak';

export function setSelected(screen, id) {
  const s = readState();
  if (s.selected[screen] === id) return;
  writeState({ ...s, selected: { ...s.selected, [screen]: id } });
  emit(null);
}

export const getStoredCase = (id) => readState().cases[id] || null;

const prebakedFactory = (id, screen) =>
  CASES[id].prebaked(screen, getStoredCase(id)?.phase || CASES[id].initialPhase);

/** True when the screen shows the pre-baked state for its demo date (no newer live state). */
export const isPrebaked = (id, screen = currentScreen()) => !!prebakedFactory(id, screen);

export function getCase(id, screen = currentScreen()) {
  const factory = prebakedFactory(id, screen);
  if (factory) return factory(data);
  return getStoredCase(id) || CASES[id].initial(data);
}

/**
 * Apply patchFn to a copy of the case as currently shown (or the stored one with
 * {base: 'stored'}) and persist it. Returning false from patchFn aborts.
 */
export function updateCase(id, patchFn, { base = 'view' } = {}) {
  const current = base === 'stored' ? (getStoredCase(id) || CASES[id].initial(data)) : getCase(id);
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
  state = { cases: {}, selected: {} };
  emit(null);
}
