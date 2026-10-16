// Loads demo data into the store, then registers all components.
// Custom elements already injected by docsify upgrade as soon as they are defined.
import { initStore } from './lib/store.js';

const COMPONENTS = [
  'app-header', 'case-tracker', 'tt-bar', 'demo-reset',
  'referral-form', 'doc-sources', 'fhir-picker', 'doc-dropzone', 'handover-panel', 'missing-list', 'confirm-send', 'gp-feedback',
  'kpi-strip', 'case-queue', 'case-header', 'task-plan', 'mdt-upload', 'msg-thread',
  'mdt-anatomogram', 'case-picker',
  'closed-list', 'indicator-tiles', 'case-summary', 'case-timeline', 'doc-list', 'review-question',
];

try {
  await initStore();
  await Promise.all(COMPONENTS.map((name) => import(`./${name}.js`)));
} catch (e) {
  console.error(e);
  const el = document.createElement('p');
  el.className = 'koc-fatal';
  el.textContent = `Prototyp se nepodařilo načíst (${e.message}). Spusťte jej přes webový server z kořene projektu, např. python3 -m http.server.`;
  document.body.prepend(el);
}
