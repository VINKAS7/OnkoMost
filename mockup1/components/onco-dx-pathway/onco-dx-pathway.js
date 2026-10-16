// <onco-dx-pathway> — standalone Web Component (no framework, no build step).
//
// Draws a diagnostic pathway (format onkomost.diagnostic-pathway/0.1: a JSON file, or the same JSON exported from
// Neo4j by mockup1/backend/dx_graph.py) as an SVG flowchart and colours every step from the case state:
//   red  = missing and needed for the MDT, grey = missing but not needed, green = done, …
// The states come from the rule engine in engine.js (generated from pathway-viewer/src/engine.ts). Rule-based, no AI.
// Documentation: README.md here (quick start) and README_pathway.md in the prototype root.
import { evaluate, condText, validate } from './engine.js';
import { layout, wrap, NODE_W as W, NODE_H as H } from './layout.js';
import { I18N } from './i18n.js';

const MANUAL = ['missing', 'in_progress', 'done', 'conflict'];
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const emptyState = () => ({ nodes: {}, decisions: {}, facts: {} });
const normState = (s) => ({ nodes: { ...(s?.nodes || {}) }, decisions: { ...(s?.decisions || {}) }, facts: { ...(s?.facts || {}) } });

/** Fact names a condition refers to. */
function condFacts(c, out = new Set()) {
  if (!c || typeof c !== 'object') return out;
  if (c.fact) out.add(c.fact);
  for (const x of [...(c.all || []), ...(c.any || [])]) condFacts(x, out);
  if (c.not) condFacts(c.not, out);
  return out;
}

const STYLES = `
:host { display: block; font-family: var(--font-sans, system-ui, sans-serif); color: var(--_ink); font-size: 15px; line-height: 1.45;
  --_ink: var(--ink, #18212B); --_muted: var(--muted, #55606C); --_line: var(--line, #DAD9D2); --_line-strong: var(--line-strong, #8A9199);
  --_surface: var(--surface, #fff); --_bg: var(--bg, #F3F3EF); --_accent: var(--accent, #0E5A66); --_accent-soft: var(--accent-soft, #E3EEEF);
  --_ok: var(--ok, #2D6A3E); --_ok-soft: var(--ok-soft, #E5F1E7); --_warn: var(--warn, #7A4200); --_warn-soft: var(--warn-soft, #FCF1DE);
  --_miss: var(--miss, #94181A); --_miss-soft: var(--miss-soft, #FBE9E7); --_ai: var(--ai, #3F347D); --_ai-soft: var(--ai-soft, #ECEAF6);
  --_focus: var(--focus, var(--_accent)); --_radius: var(--radius-ctl, 8px); }
:host([hidden]) { display: none; }
*, *::before, *::after { box-sizing: border-box; }
p { margin: 0; } h2, h3 { margin: 0; line-height: 1.3; font-weight: 600; } h2 { font-size: 17px; } h3 { font-size: 15px; }
:focus-visible, g.node:focus-visible { outline: 3px solid var(--_focus); outline-offset: 2px; }
.card { background: var(--_surface); border: 1px solid var(--_line); border-radius: var(--radius-card, 10px); padding: 16px; }
:host([bare]) .card { border: 0; padding: 0; background: none; }
.head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px 12px; flex-wrap: wrap; margin-bottom: 12px; }
.sub, .srclink, .muted { color: var(--_muted); font-size: 13px; }
.srclink { font-size: 12.5px; margin-top: 2px; } .srclink a { color: var(--_accent); }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.pill { display: inline-flex; align-items: center; gap: 4px; border-radius: 999px; padding: 2px 10px; font-size: 12.5px; font-weight: 600; white-space: nowrap; line-height: 1.5;
  background: var(--_bg); color: var(--_muted); }
.pill.miss { background: var(--_miss-soft); color: var(--_miss); } .pill.warn { background: var(--_warn-soft); color: var(--_warn); }
.pill.ok { background: var(--_ok-soft); color: var(--_ok); }
.pill svg { width: 14px; height: 14px; flex: none; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 0 0 10px; }
.chips .lbl { font-size: 13px; color: var(--_muted); margin-right: 2px; }
button { font: inherit; color: inherit; cursor: pointer; }
button.chip { min-height: 36px; border-radius: 999px; padding: 2px 12px; font-size: 13px; max-width: 100%;
  border: 1.5px dashed var(--_miss); background: var(--_miss-soft); color: var(--_miss); font-weight: 600; text-align: left; }
button.chip.side { border-style: solid; border-color: var(--_line); background: var(--_surface); color: var(--_ink); font-weight: 500; }
button.chip.warn { border: 1.5px solid var(--_warn); background: var(--_warn-soft); color: var(--_ink); }
button.chip.dec { border: 1.5px dashed var(--_ai); background: var(--_ai-soft); color: var(--_ink); font-weight: 500; }
button.plain { min-height: 36px; padding: 0 12px; border: 1px solid var(--_line-strong); border-radius: var(--_radius); background: var(--_surface); font-size: 13.5px; font-weight: 600; }
.scroll { overflow: auto; max-height: var(--dx-max-height, 620px); border: 1px solid var(--_line); border-radius: var(--_radius); background: var(--_bg); }
.scroll > svg { display: block; margin: 0 auto; }
g.node { cursor: pointer; }
g.node rect { fill: var(--_surface); stroke: var(--_line-strong); stroke-width: 1.4; }
g.node text { font-family: var(--font-sans, system-ui, sans-serif); fill: var(--_ink); }
g.node .t { font-size: 11.5px; font-weight: 600; }
g.node .s { font-size: 10.5px; fill: var(--_muted); }
g.node.v-done rect, g.node.v-decided rect, g.node.v-gate_ready rect { fill: var(--_ok-soft); stroke: var(--_ok); }
g.node.v-in_progress rect { fill: var(--_accent-soft); stroke: var(--_accent); stroke-dasharray: 5 3; }
g.node.v-missing_needed rect, g.node.v-gate_waiting rect { fill: var(--_miss-soft); stroke: var(--_miss); stroke-width: 2; stroke-dasharray: 6 3; }
g.node.v-missing_needed .s, g.node.v-gate_waiting .s { fill: var(--_miss); font-weight: 600; }
g.node.v-missing_optional rect, g.node.v-pending rect { stroke: var(--_muted); stroke-dasharray: 4 3; }
g.node.v-undetermined rect { stroke: var(--_muted); stroke-dasharray: 1.5 3; }
g.node.v-conflict rect { fill: var(--_warn-soft); stroke: var(--_warn); stroke-width: 2; }
g.node.v-waived rect { stroke: var(--_ok); stroke-dasharray: 4 3; }
g.node.v-undecided rect { fill: var(--_ai-soft); stroke: var(--_ai); stroke-dasharray: 5 3; }
.v-skipped, .v-pruned { opacity: .38; }
g.node.v-skipped .t, g.node.v-pruned .t { text-decoration: line-through; }
g.node.t-decision rect { rx: 18px; }
g.node.t-mdt rect { stroke-width: 2.6; }
g.node.sel rect { stroke: var(--_accent); stroke-width: 3; stroke-dasharray: none; }
path.e { fill: none; stroke: var(--_muted); stroke-width: 1.3; }
path.e-done { stroke: var(--_ok); stroke-width: 1.6; }
path.e-active { stroke: var(--_accent); stroke-width: 2; stroke-dasharray: 6 4; animation: flow 1s linear infinite; }
path.e-needed { stroke: var(--_miss); stroke-dasharray: 6 4; }
path.e-conflict { stroke: var(--_warn); }
path.e-open { stroke-dasharray: 1.5 4; }
path.e-optional, path.e-pending { stroke-dasharray: 4 4; }
path.e-pruned { stroke-dasharray: 2 6; opacity: .25; }
@keyframes flow { to { stroke-dashoffset: -20; } }
@media (prefers-reduced-motion: reduce) { path.e-active { animation: none; } }
.legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 12.5px; color: var(--_muted); margin-top: 10px; }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.sw { width: 18px; height: 11px; border-radius: 3px; border: 1.5px solid var(--_line-strong); background: var(--_surface); }
.sw.done { background: var(--_ok-soft); border-color: var(--_ok); }
.sw.prog { background: var(--_accent-soft); border: 1.5px dashed var(--_accent); }
.sw.need { background: var(--_miss-soft); border: 1.5px dashed var(--_miss); }
.sw.opt { border: 1.5px dashed var(--_muted); } .sw.unk { border: 1.5px dotted var(--_muted); }
.sw.conf { background: var(--_warn-soft); border-color: var(--_warn); }
.sw.dec { background: var(--_ai-soft); border: 1.5px dashed var(--_ai); }
.detail { margin-top: 12px; padding: 12px 14px; border: 1px solid var(--_line); border-radius: var(--_radius); background: var(--_surface); }
.detail h3 { margin: 0 0 4px; }
.detail dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; margin: 8px 0 0; font-size: 13.5px; }
.detail dt { color: var(--_muted); } .detail dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
@media (max-width: 420px) { .detail dl { grid-template-columns: minmax(0, 1fr); } .detail dd { margin-bottom: 4px; } }
.src { border-left: 3px solid var(--_line-strong); padding: 2px 0 2px 10px; margin-top: 8px; font-size: 13px; overflow-wrap: anywhere; }
.src.binding { border-color: var(--_miss); } .src.structure { border-color: var(--_accent); }
.src .role { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--_muted); }
.src q { display: block; font-style: italic; margin-top: 2px; } .src .note { color: var(--_muted); }
.progress, .koc { margin: 0 0 10px; font-size: 14px; } .koc .lbl { color: var(--_muted); }
.hint { margin-top: 10px; font-size: 13px; color: var(--_muted); }
.edit { margin-top: 10px; display: grid; gap: 8px; }
.seg { display: inline-flex; flex-wrap: wrap; border: 1px solid var(--_line-strong); border-radius: var(--_radius); overflow: hidden; }
.seg button { border: 0; min-height: 36px; padding: 0 12px; background: var(--_surface); font-size: 13.5px; font-weight: 600; }
.seg button + button { border-left: 1px solid var(--_line); }
.seg button[aria-pressed="true"] { background: var(--_accent); color: #fff; }
.edit label { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; font-size: 13.5px; }
.edit select, .edit input { font: inherit; font-size: 13.5px; min-height: 36px; padding: 2px 8px; border: 1px solid var(--_line-strong); border-radius: var(--_radius); background: var(--_surface); color: inherit; max-width: 100%; }
.edit input[type=number] { width: 7em; }
.warnings { margin-top: 8px; font-size: 12.5px; color: var(--_warn); }
`;

const ICON = {
  check: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
  alert: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/></svg>',
};

let uid = 0;

class OncoDxPathway extends HTMLElement {
  static observedAttributes = ['src', 'state-src', 'mode', 'lang', 'editable', 'expanded'];

  constructor() {
    super();
    this._root = this.attachShadow({ mode: 'open' });
    this._pathway = null;
    this._state = emptyState();
    this._provenance = {};
    this._sel = null;
    this._error = null;
    this._loading = 0;
    this._uid = `dx${++uid}`;
    this._root.addEventListener('click', (e) => this._onClick(e));
    this._root.addEventListener('dblclick', (e) => this._onDblClick(e));
    this._root.addEventListener('keydown', (e) => this._onKeydown(e));
    this._root.addEventListener('change', (e) => this._onChange(e));
  }

  connectedCallback() { this._render(); }

  attributeChangedCallback(name, old, val) {
    if (old === val) return;
    if (name === 'src') this._load('pathway', val);
    else if (name === 'state-src') this._load('state', val);
    else this._render();
  }

  // ---- public API --------------------------------------------------------------------------------------------

  /** The pathway definition (JSON object). Setting it replaces `src`. */
  get pathway() { return this._pathway; }
  set pathway(p) {
    this._pathway = p || null;
    this._error = null;
    if (this._sel && !p?.graph?.nodes?.some((n) => n.id === this._sel)) this._sel = null;
    this._render();
  }

  /** Case state {nodes: {id: missing|in_progress|done|conflict}, decisions: {id: [branchKey]}, facts: {name: value}}. */
  get state() { return normState(this._state); }
  set state(s) { this._state = normState(s); this._render(); }

  /** Optional per-step explanation of where a status came from ({id: text}), shown as "From the case". */
  get provenance() { return { ...this._provenance }; }
  set provenance(v) { this._provenance = { ...(v || {}) }; this._render(); }

  /** Last evaluation (step states, red list, edge styles) or null without a pathway. */
  get evaluation() { return this._ev || null; }

  get lang() { return this.getAttribute('lang') === 'en' ? 'en' : 'cs'; }
  get mode() { return ['compact', 'gp'].includes(this.getAttribute('mode')) ? this.getAttribute('mode') : 'full'; }
  get editable() { return this.hasAttribute('editable'); }

  /** Set the manual status of a step; null removes it. */
  setStatus(id, status) {
    if (status != null && !MANUAL.includes(status)) throw new Error(`onco-dx-pathway: unknown status "${status}"`);
    this._patch('status', id, status, (s) => { if (status == null) delete s.nodes[id]; else s.nodes[id] = status; });
  }

  /** Choose the branch(es) of a decision node (string or array of branch keys); null clears it. */
  setDecision(id, keys) {
    const v = keys == null ? null : [].concat(keys);
    this._patch('decision', id, v, (s) => { if (!v?.length) delete s.decisions[id]; else s.decisions[id] = v; });
  }

  /** Set a case fact (bool / number / enum string); null makes it unknown again. */
  setFact(name, value) {
    this._patch('fact', name, value, (s) => { if (value == null || value === '') delete s.facts[name]; else s.facts[name] = value; });
  }

  /** Open the detail panel of a step (null closes it). */
  select(id) { this._select(id, false); }

  // ---- internals ---------------------------------------------------------------------------------------------

  get t() { return I18N[this.lang]; }

  _label(n) { return (this.lang === 'en' && n?.label_en) || n?.label || ''; }

  _patch(type, id, value, fn) {
    const s = normState(this._state);
    fn(s);
    this._state = s;
    this._render();
    this._emit('dx-state-change', { state: this.state, change: { type, id, value } });
  }

  _emit(name, detail) { this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true })); }

  async _load(what, url) {
    if (!url) return;
    const ticket = (this[`_ticket_${what}`] = {});
    this._loading++;
    this._render();
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
      const data = await r.json();
      if (this[`_ticket_${what}`] !== ticket) return; // a newer src won
      if (what === 'pathway') this.pathway = data.graph ? data : data.pathway;
      else { this._state = normState(data.state || data); if (data.provenance) this._provenance = data.provenance; }
    } catch (e) {
      if (this[`_ticket_${what}`] === ticket) this._error = e.message;
    } finally {
      this._loading--;
      this._render();
    }
  }

  _select(id, toggle = true) {
    this._sel = toggle && this._sel === id ? null : id || null;
    this._render();
    if (this._sel) this._emit('dx-select', { id: this._sel, node: this._pathway?.graph.nodes.find((n) => n.id === this._sel), eval: this._ev?.nodes[this._sel] });
  }

  _onClick(e) {
    const g = e.target.closest?.('g.node');
    if (g) return this._select(g.dataset.id);
    const b = e.target.closest?.('button[data-action]');
    if (!b) return;
    const { action, id, value } = b.dataset;
    if (action === 'sel') this._select(id);
    else if (action === 'expand') this.toggleAttribute('expanded');
    else if (action === 'status') this.setStatus(id, value || null);
    else if (action === 'branch') {
      const n = this._pathway.graph.nodes.find((x) => x.id === id);
      const cur = this._state.decisions[id] || [];
      const next = !value ? null : n?.multi ? (cur.includes(value) ? cur.filter((k) => k !== value) : [...cur, value]) : cur.includes(value) ? null : [value];
      this.setDecision(id, next);
    }
  }

  // double-click (editable only): cycle the status of a step
  _onDblClick(e) {
    const g = e.target.closest?.('g.node');
    if (!g || !this.editable) return;
    const n = this._pathway.graph.nodes.find((x) => x.id === g.dataset.id);
    if (!n || !['step', 'mdt'].includes(n.type)) return;
    const cur = this._state.nodes[n.id] || 'missing';
    this.setStatus(n.id, MANUAL[(MANUAL.indexOf(cur) + 1) % MANUAL.length]);
  }

  _onKeydown(e) {
    const g = e.target.closest?.('g.node');
    if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); this._select(g.dataset.id); }
  }

  _onChange(e) {
    const el = e.target;
    if (el.dataset?.action !== 'fact') return;
    const def = this._pathway.facts?.[el.dataset.id] || {};
    let v = el.value;
    if (v === '') v = null;
    else if (def.type === 'bool') v = v === 'true';
    else if (def.type === 'number') v = Number(v);
    this.setFact(el.dataset.id, v);
  }

  _sourceLink(p) {
    const count = {};
    for (const n of p.graph.nodes) for (const s of n.sources || []) if (s.role === 'binding') count[s.ref] = (count[s.ref] || 0) + 1;
    const ref = Object.keys(count).filter((r) => p.sources?.[r]?.url).sort((a, b) => count[b] - count[a])[0];
    const s = ref && p.sources[ref];
    if (!s) return '';
    let host = '';
    try { host = new URL(s.url).hostname.replace(/^www\./, ''); } catch { /* relative URL */ }
    return `<p class="srclink">${esc(this.t.source)}: <a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}<span class="sr-only"> ${esc(this.t.newWindow)}</span></a>${host ? ` · ${esc(host)}` : ''}</p>`;
  }

  _head(p, pill = '') {
    const t = this.t;
    const title = this.getAttribute('heading') || t.title;
    const sub = p ? `${esc((this.lang === 'en' && p.name_en) || p.name)}${p.status === 'draft' ? ` · ${esc(t.draft)}` : ''}` : '';
    return `<div class="head"><div><h2 id="${this._uid}-t">${esc(title)}</h2>${sub ? `<p class="sub">${sub}</p>` : ''}${p ? this._sourceLink(p) : ''}</div>${pill}</div>`;
  }

  _render() {
    if (!this.isConnected) return;
    const t = this.t;
    const p = this._pathway;
    if (!p) {
      const msg = this._error ? `${t.loadError}: ${this._error}` : this._loading ? t.loading : t.empty;
      this._ev = null;
      this._root.innerHTML = `<style>${STYLES}</style><section class="card" aria-labelledby="${this._uid}-t">${this._head(null)}<p class="muted" role="status">${esc(msg)}</p></section>`;
      return;
    }
    const ev = (this._ev = evaluate(p, this._state));
    const byId = Object.fromEntries(p.graph.nodes.map((n) => [n.id, n]));
    const label = (id) => this._label(byId[id]) || id;
    const side = new Set(p.graph.nodes.filter((n) => n.phase === 'supportive').map((n) => n.id));
    const gate = p.graph.nodes.find((n) => n.type === 'mdt');
    const ge = gate && ev.nodes[gate.id];
    const red = ev.red;
    const pill = ge?.vstate === 'done' ? `<span class="pill ok">${ICON.check}${esc(t.mdtHeld)}</span>`
      : red.length ? `<span class="pill miss">${ICON.alert}${esc(t.missingForMdt(red.length))}</span>`
      : ge?.vstate === 'gate_waiting' ? `<span class="pill warn">${esc(t.unresolved(ge.blockers.length))}</span>`
      : `<span class="pill ok">${ICON.check}${esc(t.ready)}</span>`;
    // required, applicable examinations (not intake / milestones / decisions) and how many are done
    const exams = p.graph.nodes.filter((n) => n.type === 'step' && !['intake', 'milestone'].includes(n.kind) && !side.has(n.id)
      && ev.nodes[n.id].level === 'required' && ['done', 'waived', 'in_progress', 'conflict', 'missing_needed'].includes(ev.nodes[n.id].vstate));
    const doneN = exams.filter((n) => ['done', 'waived'].includes(ev.nodes[n.id].vstate)).length;
    const progress = `<p class="progress">${t.progress(doneN, exams.length)}</p>`;
    const mode = this.mode;
    let body;

    if (mode === 'gp') {
      const gpCan = (n) => n.owner_role === 'gp' || (n.suppliable_by || []).includes('gp');
      const koc = exams.filter((n) => !gpCan(n) && ['missing_needed', 'in_progress'].includes(ev.nodes[n.id].vstate));
      body = `${this._head(p)}${progress}
        ${koc.length ? `<p class="koc"><span class="lbl">${esc(t.kocArranges)}</span> ${koc.map((n) => esc(this._label(n))).join(' · ')}</p>` : ''}
        <p class="hint">${esc(t.referrerNote)}</p><slot name="footer"></slot>`;
    } else {
      const showChart = mode === 'full' || this.hasAttribute('expanded');
      const chip = (id, cls = '', extra = '') => `<button class="chip ${cls}" data-action="sel" data-id="${esc(id)}">${esc(label(id))}${extra}</button>`;
      let extras = '';
      if (mode === 'compact') {
        const conflicts = p.graph.nodes.filter((n) => ev.nodes[n.id].vstate === 'conflict').map((n) => n.id);
        const decisions = p.graph.nodes.filter((n) => n.type === 'decision' && n.decided_by !== 'rule' && ['undecided', 'decided'].includes(ev.nodes[n.id].vstate));
        if (conflicts.length) extras += `<div class="chips"><span class="lbl">${esc(t.conflicts)}</span>${conflicts.map((id) => chip(id, 'warn')).join('')}</div>`;
        if (decisions.length) extras += `<div class="chips"><span class="lbl">${esc(t.boardDecides)}</span>${decisions.map((n) => {
          const chosen = this._chosen(n, ev.nodes[n.id]);
          return chip(n.id, 'dec', chosen ? ` · <strong>${esc(chosen)}</strong>` : ` · ${esc(t.waiting)}`);
        }).join('')}</div>`;
      }
      body = `${this._head(p, pill)}
        ${mode === 'compact' ? progress : ''}
        ${red.length ? `<div class="chips"><span class="lbl">${esc(t.redList)}</span>${red.map((id) => chip(id)).join('')}</div>` : ''}
        ${extras}
        ${showChart ? this._chart(p, ev, side) : ''}
        ${mode === 'compact' ? `<button class="plain" data-action="expand" aria-expanded="${showChart}">${esc(showChart ? t.hideAll : t.showAll)}</button>` : ''}
        ${showChart && side.size ? `<div class="chips" style="margin-top:10px"><span class="lbl">${esc(t.supportive)}</span>
          ${[...side].map((id) => chip(id, 'side', ` · ${esc(t.state[ev.nodes[id].vstate] || ev.nodes[id].vstate)}`)).join('')}</div>` : ''}
        ${showChart ? this._legend() : ''}
        ${this._sel && byId[this._sel] ? this._detail(p, ev, byId[this._sel], label) : showChart ? `<p class="hint">${esc(this.editable ? t.hintEdit : t.hint)}</p>` : ''}
        ${this.editable && ev.warnings?.length ? `<p class="warnings">${ev.warnings.map(esc).join('<br>')}</p>` : ''}
        <slot name="footer"></slot>`;
    }
    const focused = this._root.activeElement;
    const key = focused && (focused.dataset?.id ? `${focused.dataset.action || 'node'}:${focused.dataset.id}:${focused.dataset.value || ''}` : null);
    this._root.innerHTML = `<style>${STYLES}</style><section class="card" aria-labelledby="${this._uid}-t">${body}</section>`;
    if (key) { // keep keyboard focus across the full re-render
      const [a, id, v] = key.split(':');
      const el = [...this._root.querySelectorAll(a === 'node' ? 'g.node' : `[data-action="${a}"]`)]
        .find((x) => x.dataset.id === id && (x.dataset.value || '') === v);
      el?.focus();
    }
    this._emit('dx-evaluated', { evaluation: ev, red: [...red], ready: !red.length && ge?.vstate !== 'gate_waiting', progress: { done: doneN, total: exams.length } });
  }

  _chosen(n, e) {
    if (!e?.chosen?.length) return '';
    return e.chosen.map((k) => { const b = n.branches?.find((x) => x.key === k); return b ? (this.lang === 'en' && b.label_en) || b.label : k; }).join(', ');
  }

  _chart(p, ev, side) {
    const t = this.t;
    const nodes = p.graph.nodes.filter((n) => !side.has(n.id));
    const edges = ev.edges.filter(({ edge }) => !side.has(edge.source) && !side.has(edge.target));
    const L = layout(nodes, edges.map((x) => x.edge));
    const mk = `${this._uid}-ah`;
    const edgeSvg = edges.map(({ edge, style }) => {
      const a = L.at[edge.source];
      const b = L.at[edge.target];
      if (!a || !b) return '';
      const x1 = a.x + W / 2; const y1 = a.y + H; const x2 = b.x + W / 2; const y2 = b.y;
      const my = (y1 + y2) / 2;
      return `<path class="e e-${esc(style)}" d="M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2 - 5}" marker-end="url(#${mk})"/>`;
    }).join('');
    const nodeSvg = nodes.map((n) => {
      const e = ev.nodes[n.id];
      const { x, y } = L.at[n.id];
      let sub = t.state[e.vstate] || e.vstate;
      if (n.type === 'decision' && e.chosen?.length) sub = this._chosen(n, e);
      if (e.vstate === 'gate_waiting') sub = t.waitsN(e.blockers.length);
      const name = this._label(n);
      return `<g class="node v-${esc(e.vstate)} t-${esc(n.type)}${this._sel === n.id ? ' sel' : ''}" data-id="${esc(n.id)}" role="button" tabindex="0"
          aria-label="${esc(name)} – ${esc(sub)}" aria-pressed="${this._sel === n.id}" transform="translate(${x},${y})">
        <rect width="${W}" height="${H}" rx="7"/>
        ${wrap(name).map((l, i) => `<text class="t" x="9" y="${15 + i * 13}">${esc(l)}</text>`).join('')}
        <text class="s" x="9" y="${H - 7}">${esc(sub)}</text>
      </g>`;
    }).join('');
    return `<div class="scroll"><svg width="${L.width}" height="${L.height}" viewBox="0 0 ${L.width} ${L.height}" role="group" aria-label="${esc(t.chart)}">
      <defs><marker id="${mk}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 z" fill="var(--_muted)"/></marker></defs>${edgeSvg}${nodeSvg}</svg></div>`;
  }

  _legend() {
    const l = this.t.lg;
    return `<div class="legend" aria-label="${esc(this.t.legend)}">
      <span><i class="sw done"></i>${esc(l.done)}</span><span><i class="sw prog"></i>${esc(l.prog)}</span>
      <span><i class="sw need"></i>${esc(l.need)}</span><span><i class="sw opt"></i>${esc(l.opt)}</span>
      <span><i class="sw unk"></i>${esc(l.unk)}</span><span><i class="sw conf"></i>${esc(l.conf)}</span>
      <span><i class="sw dec"></i>${esc(l.dec)}</span><span><i class="sw"></i>${esc(l.strike)}</span></div>`;
  }

  _detail(p, ev, n, label) {
    const t = this.t;
    const e = ev.nodes[n.id];
    const fl = (id) => p.facts?.[id]?.label || id;
    const cond = (c) => esc(condText(c, fl, t.words));
    const lv = (l) => esc(t.lv[l] || l);
    const srcs = [...(n.sources || []), ...(n.waiver?.sources || [])];
    const cls = ['missing_needed', 'gate_waiting'].includes(e.vstate) ? 'miss' : ['done', 'decided', 'gate_ready'].includes(e.vstate) ? 'ok' : e.vstate === 'conflict' ? 'warn' : '';
    const from = this._provenance[n.id];
    const desc = n.description ? `<p class="muted" style="margin-top:4px">${esc(n.description)}</p>` : '';
    return `<div class="detail" aria-live="polite">
      <h3>${esc(this._label(n))}</h3>
      <span class="pill ${cls}">${esc(t.state[e.vstate] || e.vstate)}</span>${desc}
      <dl>
        ${e.level ? `<dt>${esc(t.level)}</dt><dd>${lv(e.level)}${n.blocking === false ? ` · ${esc(t.nonBlocking)}` : ''}${e.downgraded ? ` · ${esc(t.structureOnly)}` : ''}</dd>` : ''}
        ${from ? `<dt>${esc(t.fromCase)}</dt><dd>${esc(from)}</dd>` : ''}
        ${n.condition ? `<dt>${esc(t.condition)}</dt><dd>${cond(n.condition)} → ${esc(e.cond === null ? t.unknown : e.cond ? t.met : t.notMet)}</dd>` : ''}
        ${n.level_rules ? `<dt>${esc(t.levelBy)}</dt><dd>${n.level_rules.map((r) => `<div>${cond(r.when)} → ${lv(r.level)}</div>`).join('')}</dd>` : ''}
        ${n.type === 'decision' ? `<dt>${esc(t.decides)}</dt><dd>${esc(n.decided_by === 'rule' ? t.byRule : t.byClinician)}${n.suggest ? ` – ${esc(n.suggest)}` : ''}</dd>` : ''}
        ${n.waiver ? `<dt>${esc(t.waiver)}</dt><dd>${esc((this.lang === 'en' && n.waiver.label_en) || n.waiver.label)} → ${esc(e.waived ? t.applied : t.no)}</dd>` : ''}
        ${e.blockers?.length ? `<dt>${esc(t.waitsFor)}</dt><dd>${e.blockers.map((id) => esc(label(id))).join(', ')}</dd>` : ''}
      </dl>
      ${this.editable ? this._editor(p, n) : ''}
      ${srcs.map((s) => `<div class="src ${esc(s.role)}"><span class="role">${esc(t.role[s.role] || s.role)}</span>
        ${esc(p.sources?.[s.ref]?.title || s.ref)}${s.section ? ` · § ${esc(s.section)}` : ''}
        ${s.quote ? `<q>${esc(s.quote)}</q>` : ''}${s.note ? `<div class="note">${esc(s.note)}</div>` : ''}</div>`).join('')}
    </div>`;
  }

  /** Editable mode: status / decision buttons and the facts this step's rules depend on. */
  _editor(p, n) {
    const t = this.t;
    const id = esc(n.id);
    let out = '';
    if (['step', 'mdt'].includes(n.type)) {
      const cur = this._state.nodes[n.id];
      out += `<div class="seg" role="group" aria-label="${esc(t.status)}">${MANUAL.map((s) =>
        `<button data-action="status" data-id="${id}" data-value="${s}" aria-pressed="${cur === s}">${esc(t.manual[s])}</button>`).join('')}
        <button data-action="status" data-id="${id}" data-value="" aria-pressed="false">${esc(t.clear)}</button></div>`;
    }
    if (n.type === 'decision' && n.decided_by !== 'rule' && n.branches?.length) {
      const cur = this._state.decisions[n.id] || [];
      out += `<div class="seg" role="group" aria-label="${esc(t.decision)}">${n.branches.map((b) =>
        `<button data-action="branch" data-id="${id}" data-value="${esc(b.key)}" aria-pressed="${cur.includes(b.key)}">${esc((this.lang === 'en' && b.label_en) || b.label)}</button>`).join('')}
        <button data-action="branch" data-id="${id}" data-value="" aria-pressed="false">${esc(t.clear)}</button></div>`;
    }
    const names = new Set();
    for (const c of [n.condition, ...(n.level_rules || []).map((r) => r.when), n.waiver?.when, ...(n.branches || []).map((b) => b.when)]) condFacts(c, names);
    for (const f of [...names]) for (const x of condFacts(p.facts?.[f]?.derived)) names.add(x);
    for (const f of names) {
      const def = p.facts?.[f];
      if (!def || def.derived) continue;
      const v = this._state.facts[f];
      const unk = `<option value="">${esc(t.unknown)}</option>`;
      const sel = (val) => (v !== undefined && String(v) === String(val) ? ' selected' : '');
      let input;
      if (def.type === 'bool') input = `<select data-action="fact" data-id="${esc(f)}">${unk}<option value="true"${sel(true)}>${esc(t.yes)}</option><option value="false"${sel(false)}>${esc(t.no)}</option></select>`;
      else if (def.type === 'enum') input = `<select data-action="fact" data-id="${esc(f)}">${unk}${(def.values || []).map((x) => `<option${sel(x)}>${esc(x)}</option>`).join('')}</select>`;
      else input = `<input type="number" data-action="fact" data-id="${esc(f)}" value="${v ?? ''}">${def.unit ? ` ${esc(def.unit)}` : ''}`;
      out += `<label>${esc(def.label || f)} ${input}</label>`;
    }
    return out ? `<div class="edit">${out}</div>` : '';
  }
}

if (!customElements.get('onco-dx-pathway')) customElements.define('onco-dx-pathway', OncoDxPathway);
export { OncoDxPathway, validate };
