// Base class for all components: Shadow DOM + shared stylesheet, store subscription,
// event delegation via [data-action], and focus-preserving re-render.
import { Raw } from './html.js';

const BASE_CSS = `
:host { display: block; font-family: var(--font-sans); color: var(--ink); font-size: 15px; line-height: 1.45; min-width: 0; }
:host([hidden]) { display: none !important; }
*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }
p { margin: 0; }
h1, h2, h3 { margin: 0; line-height: 1.3; font-weight: 600; }
h2 { font-size: 17px; }
h3 { font-size: 15px; }
a { color: var(--accent); text-underline-offset: 2px; }
ul, ol { margin: 0; padding: 0; list-style: none; }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-card); padding: 16px; }
.card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px 12px; flex-wrap: wrap; margin-bottom: 12px; }
.card-head > div { min-width: 0; }
.muted { color: var(--muted); }
.small { font-size: 13px; }
.mono { font-family: var(--font-mono); font-size: 0.93em; }
.row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.pill { display: inline-flex; align-items: center; gap: 4px; border-radius: 999px; padding: 2px 10px; font-size: 12.5px; font-weight: 600;
  line-height: 1.5; white-space: nowrap; background: var(--bg); color: var(--muted); border: 1px solid var(--line); }
.pill .icon { width: 13px; height: 13px; }
.pill.accent { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
.pill.ok { background: var(--ok-soft); color: var(--ok); border-color: transparent; }
.pill.warn { background: var(--warn-soft); color: var(--warn); border-color: transparent; }
.pill.miss { background: var(--miss-soft); color: var(--miss); border-color: transparent; }
.pill.ai { background: var(--ai-soft); color: var(--ai); border-color: transparent; }
.pill.dark { background: rgba(255,255,255,.12); color: #fff; border-color: rgba(255,255,255,.2); }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 0 16px;
  border-radius: var(--radius-ctl); border: 1px solid var(--line-strong); background: var(--surface); color: var(--ink);
  font: inherit; font-weight: 600; cursor: pointer; text-decoration: none; white-space: nowrap; }
.btn:hover { background: var(--bg); }
.btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.btn.primary:hover { background: var(--accent-strong); }
.btn.sm { min-height: 36px; padding: 0 12px; font-size: 13.5px; }
.btn.ghost { border-color: transparent; background: transparent; color: var(--accent); }
.btn.ghost:hover { background: var(--accent-soft); }
.btn:disabled, .btn[aria-disabled="true"] { opacity: .5; cursor: not-allowed; }
.btn .icon { width: 16px; height: 16px; }
:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
label, .label { display: block; font-size: 13px; font-weight: 600; color: var(--muted); margin-bottom: 4px; }
input[type="text"], input[type="date"], input:not([type]), select, textarea {
  width: 100%; font: inherit; color: var(--ink); background: var(--surface); border: 1px solid var(--line-strong);
  border-radius: var(--radius-ctl); padding: 9px 12px; min-height: 44px; }
textarea { resize: vertical; line-height: 1.45; }
.prefilled { background: var(--prefill) !important; border-color: var(--line) !important; }
input[type="checkbox"] { width: 20px; height: 20px; accent-color: var(--accent); margin: 0; flex: none; }
.check { display: flex; gap: 10px; align-items: flex-start; font-size: 14px; color: var(--ink); font-weight: 500; cursor: pointer; min-height: 44px; padding: 10px 0; margin: 0; }
.check input { margin-top: 1px; }
.icon { width: 18px; height: 18px; flex: none; }
.source { font-size: 12.5px; color: var(--muted); }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.skeleton { display: grid; gap: 8px; }
.skeleton span { display: block; height: 12px; border-radius: 6px; background: linear-gradient(90deg, var(--line) 0%, var(--bg) 50%, var(--line) 100%);
  background-size: 200% 100%; animation: shimmer 1.2s linear infinite; }
@keyframes shimmer { to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) { .skeleton span { animation: none; } }
.note { display: flex; gap: 8px; align-items: flex-start; font-size: 13px; color: var(--muted); }
.banner { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; border-radius: var(--radius-ctl); padding: 10px 12px; font-size: 14px; }
.banner.ok { background: var(--ok-soft); color: var(--ok); }
.banner.miss { background: var(--miss-soft); color: var(--miss); }
.banner.warn { background: var(--warn-soft); color: var(--warn); }
.banner.ai { background: var(--ai-soft); color: var(--ai); }
.empty { padding: 12px; border: 1px dashed var(--line-strong); border-radius: var(--radius-ctl); color: var(--muted); font-size: 14px; }
`;

export const baseSheet = new CSSStyleSheet();
baseSheet.replaceSync(BASE_CSS);
const sheets = new WeakMap();

function sheetFor(cls) {
  if (!sheets.has(cls)) {
    const s = new CSSStyleSheet();
    s.replaceSync(cls.styles || '');
    sheets.set(cls, s);
  }
  return sheets.get(cls);
}

const EVENTS = ['click', 'change', 'input', 'keydown', 'submit', 'focusout', 'dragover', 'dragleave', 'drop'];

export class KocElement extends HTMLElement {
  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.adoptedStyleSheets = [baseSheet, sheetFor(this.constructor)];
    for (const type of EVENTS) root.addEventListener(type, (e) => this._dispatch(e));
  }

  get caseId() { return this.getAttribute('case-id') || 'novak'; }

  connectedCallback() {
    this._ac = new AbortController();
    this.listen(window, 'koc:change', (e) => {
      const id = e.detail?.id;
      if (!id || id === this.caseId) this.update();
    });
    this.init?.();
    this.update();
  }

  disconnectedCallback() {
    this._ac?.abort();
    this.teardown?.();
  }

  /** addEventListener that is removed automatically on disconnect. */
  listen(target, type, fn) {
    target.addEventListener(type, fn, { signal: this._ac.signal });
  }

  _dispatch(e) {
    const el = e.target.closest?.('[data-action]') || null;
    if (e.type === 'keydown' && el && el.getAttribute('role') === 'button' && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      el.click();
      return;
    }
    if (e.type === 'submit') e.preventDefault();
    const name = 'on' + e.type[0].toUpperCase() + e.type.slice(1);
    if (typeof this[name] === 'function') this[name](e, el, el?.dataset.action);
  }

  /** Re-render; restores focus/selection for elements carrying data-key. */
  update() {
    if (!this.isConnected) return;
    const root = this.shadowRoot;
    const active = root.activeElement;
    const key = active?.dataset?.key;
    let sel = null;
    if (key && typeof active.selectionStart === 'number') sel = [active.selectionStart, active.selectionEnd];
    const out = this.render();
    if (out === undefined) return;
    root.innerHTML = out instanceof Raw ? out.s : String(out);
    if (key) {
      const el = root.querySelector(`[data-key="${CSS.escape(key)}"]`);
      if (el) {
        el.focus({ preventScroll: true });
        if (sel) try { el.setSelectionRange(...sel); } catch { /* not a text input */ }
      }
    }
    this.updated?.();
  }

  render() { return ''; }

  $(sel) { return this.shadowRoot.querySelector(sel); }
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}
