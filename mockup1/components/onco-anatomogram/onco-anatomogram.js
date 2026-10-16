// <onco-anatomogram> — standalone Web Component (no framework, no build step).
//
// Draws the EMBL-EBI Expression Atlas body (CC BY 4.0; organs are SVG elements whose id is the
// UBERON id) and colours organs:
//   red  = suspicion of cancer, from the `findings` of the board data
//   blue = organs where the current medication is absorbed / distributed / metabolised / excreted,
//          queried from the pharmacolibrary ADME SQLite (sql.js, loaded lazily) or given statically
// and lists shared-actor drug-interaction candidates. Rule-based, no LLM.
// Documentation: README.md here (quick start) and README_anatomogram.md in the prototype root.
import { openDb, resolveDrugs, computeAdme, DEFAULT_DB, DEFAULT_SQL_WASM } from './adme.js';
import { STRINGS, LEVELS, PROCESSES, ORGANS, TISSUES_CS, TISSUE_PROXY } from './i18n.js';

const HERE = new URL('.', import.meta.url);
const DEFAULT_ZOOM = { male: '30 46 46 56', female: '28 46 50 60' };
const DEFAULT_HIDE = 'blood-brain barrier,placenta,testis,mammary gland';
const textCache = new Map();

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const fetchText = (url) => {
  if (!textCache.has(url)) {
    textCache.set(url, fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
      return r.text();
    }).catch((e) => { textCache.delete(url); throw e; }));
  }
  return textCache.get(url);
};
const fmtDate = (d) => {
  if (!d) return '';
  const [y, m, dd] = d.slice(0, 10).split('-').map(Number);
  return `${dd}. ${m}. ${y}`;
};
const list = (s) => (s || '').split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);

const STYLES = `
:host { display: block; font-family: var(--font-sans, system-ui, sans-serif); color: var(--ink, #18212B); font-size: 15px; line-height: 1.45;
  --_tumor: var(--tumor, #C62828); --_tumor-soft: var(--tumor-soft, #F4B4AE); --_drug: var(--drug, #1B57AE); --_drug-soft: var(--drug-soft, #E3EDFB);
  --_line: var(--line, #DAD9D2); --_line-strong: var(--line-strong, #8A9199); --_muted: var(--muted, #55606C); --_surface: var(--surface, #fff);
  --_accent: var(--accent, #0E5A66); --_accent-soft: var(--accent-soft, #E3EEEF); --_bg: var(--bg, #F3F3EF); }
*, *::before, *::after { box-sizing: border-box; }
p { margin: 0; } h2, h3 { margin: 0; line-height: 1.3; font-weight: 600; } h2 { font-size: 17px; } h3 { font-size: 15px; }
ul { margin: 0; padding: 0; list-style: none; }
:focus-visible { outline: 3px solid var(--focus, var(--_accent)); outline-offset: 2px; }
.card { background: var(--_surface); border: 1px solid var(--_line); border-radius: var(--radius-card, 10px); padding: 16px; }
.head { display: flex; justify-content: space-between; gap: 8px 12px; flex-wrap: wrap; margin-bottom: 12px; }
.muted { color: var(--_muted); } .small { font-size: 13px; }
.mono { font-family: var(--font-mono, ui-monospace, monospace); font-size: .93em; }
.pill { display: inline-flex; align-items: center; border-radius: 999px; padding: 2px 10px; font-size: 12.5px; font-weight: 600; white-space: nowrap; line-height: 1.5; }
.pill.miss, .pill.tumor { background: var(--miss-soft, #FBE9E7); color: var(--miss, #94181A); }
.pill.warn { background: var(--warn-soft, #FCF1DE); color: var(--warn, #7A4200); }
.pill.ok { background: var(--ok-soft, #E5F1E7); color: var(--ok, #2D6A3E); }
.pill.drug { background: var(--_drug-soft); color: var(--_drug); }
.pill.neutral { background: var(--_bg); color: var(--_muted); }
.row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.controls { display: flex; gap: 8px 16px; flex-wrap: wrap; margin-bottom: 12px; }
.seg { display: inline-flex; border: 1px solid var(--_line-strong); border-radius: var(--radius-ctl, 8px); overflow: hidden; }
.seg button { border: 0; min-height: 36px; padding: 0 12px; background: var(--_surface); font: inherit; font-size: 13.5px; font-weight: 600; color: inherit; cursor: pointer; }
.seg button + button { border-left: 1px solid var(--_line); }
.seg button[aria-pressed="true"] { background: var(--_accent); color: #fff; }
.layout { display: grid; grid-template-columns: minmax(220px, 300px) minmax(0, 1fr); gap: 16px; align-items: start; }
@media (max-width: 760px) { .layout { grid-template-columns: minmax(0, 1fr); } }
figure { margin: 0; background: #FAFAF8; border: 1px solid var(--_line); border-radius: var(--radius-ctl, 8px); padding: 8px; }
figure svg { display: block; width: 100%; height: auto; max-height: 560px; }
figcaption { font-size: 12px; color: var(--_muted); margin-top: 6px; }
#LAYER_OUTLINE path { fill: #fff; stroke: #A3A9AF; stroke-width: .35; }
#LAYER_OUTLINE > a { display: none; } /* EBI info link icon; the body is a <path> (male) or <g> (female) */
/* Organs are see-through so organs drawn behind others (pancreas, duodenum, kidneys) stay visible. */
#LAYER_EFO > *, #LAYER_EFO > * * { fill: #C9CED3 !important; fill-opacity: var(--organ-opacity, .3) !important;
  stroke: #8F969D !important; stroke-opacity: .8 !important; stroke-width: .2 !important; }
.legend { display: grid; gap: 6px; margin-top: 10px; font-size: 13px; }
.legend span { display: flex; gap: 8px; align-items: center; }
.sw { width: 14px; height: 14px; border-radius: 4px; flex: none; border: 1.5px solid transparent; }
.sw { position: relative; overflow: hidden; }
.sw::before { content: ''; position: absolute; inset: 0; opacity: var(--highlight-opacity, .6); }
.sw.t::before, .sw.td::before { background: var(--_tumor); } .sw.p::before { background: var(--_tumor-soft); } .sw.d::before { background: var(--_drug); }
.sw.r::before { background: #C9CED3; opacity: var(--organ-opacity, .3); }
.sw.p, .sw.r { border: 1.5px dashed var(--_tumor); } .sw.td { border: 2.5px solid var(--_drug); }
.group + .group { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--_line); }
.group h3 { margin: 4px 0 8px; display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.organ { display: grid; gap: 4px; width: 100%; text-align: left; background: none; border: 1px solid transparent; border-radius: var(--radius-ctl, 8px);
  padding: 8px 10px; font: inherit; color: inherit; cursor: pointer; min-height: 44px; }
.organ:hover { background: var(--_bg); }
.organ[aria-pressed="true"] { border-color: var(--_accent); background: var(--_accent-soft); }
.top { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; align-items: center; }
.name { font-weight: 600; } .txt { font-size: 14px; }
.source { font-size: 12.5px; color: var(--_muted); }
.item { padding: 8px 10px; }
.chips { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; align-items: center; }
.chip { display: inline-flex; align-items: center; min-height: 36px; padding: 0 10px; border-radius: 999px; font: inherit; font-size: 13px;
  border: 1px solid var(--_drug); background: var(--_drug-soft); color: var(--_drug); cursor: pointer; }
.chip[aria-pressed="true"] { background: var(--_drug); color: #fff; }
.chip.static { cursor: default; border-style: dashed; background: none; }
.genes { font-family: var(--font-mono, ui-monospace, monospace); font-size: 12.5px; color: var(--_muted); }
.detail { margin-top: 12px; border: 1px solid var(--_line-strong); border-radius: var(--radius-ctl, 8px); padding: 12px; display: grid; gap: 8px; }
.hist li { display: grid; gap: 2px; padding: 6px 0; border-top: 1px solid var(--_line); font-size: 14px; }
.hist li:first-child { border-top: 0; }
.hist li.old { color: var(--_muted); }
.x { background: none; border: 0; min-width: 36px; min-height: 36px; border-radius: 8px; cursor: pointer; font: inherit; font-size: 18px; color: inherit; }
.x:hover { background: var(--_bg); }
.note { font-size: 13px; color: var(--_muted); margin-top: 8px; }
.banner { border-radius: var(--radius-ctl, 8px); padding: 10px 12px; font-size: 14px; background: var(--_bg); }
.banner.miss { background: var(--miss-soft, #FBE9E7); color: var(--miss, #94181A); }
.skeleton { display: grid; gap: 8px; } .skeleton span { display: block; height: 12px; border-radius: 6px; background: var(--_line); }
`;

class OncoAnatomogram extends HTMLElement {
  static observedAttributes = ['src', 'sex', 'svg', 'drugs', 'db', 'sql-wasm', 'hide-tissues', 'evidence', 'include-text', 'lang', 'reached', 'zoom'];

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(STYLES);
    this.shadowRoot.adoptedStyleSheets = [sheet];
    this.ui = { layer: 'all', zoom: null, selected: null };
    this.st = { status: 'idle' };
    this._seq = 0;
    for (const t of ['click', 'keydown']) this.shadowRoot.addEventListener(t, (e) => this.onEvent(e));
  }

  /** Board data object (same shape as the `src` JSON); overrides `src`. */
  set board(v) { this._board = v; this.reload(); }
  get board() { return this._board; }

  /** Reached steps for gating findings (`when`): array/Set of 'task:<id>' / 'mdt:<id>'. null = show all. */
  set reached(v) { this._reached = v == null ? null : new Set(v); this.render(); }
  get reached() { return this._reached; }

  connectedCallback() { this.reload(); }

  attributeChangedCallback(name, old, val) {
    if (old === val || !this.isConnected) return;
    if (name === 'reached') { this._reached = val == null ? null : new Set(list(val.replace(/\s+/g, ','))); this.render(); return; }
    if (name === 'lang' || name === 'zoom') { this.render(); return; }
    this.reload();
  }

  get t() { return STRINGS[this.getAttribute('lang') === 'en' ? 'en' : 'cs']; }
  get lang() { return this.getAttribute('lang') === 'en' ? 'en' : 'cs'; }

  reload() {
    if (!this.isConnected) return;
    clearTimeout(this._rt);
    this._rt = setTimeout(() => this.load(), 0); // coalesce attribute bursts
  }

  async load() {
    const seq = ++this._seq;
    const current = () => seq === this._seq;
    this.st = { status: 'loading' };
    this.render();
    try {
      const src = this.getAttribute('src');
      const board = this._board || (src ? JSON.parse(await fetchText(new URL(src, location.href).href)) : {});
      const sex = this.getAttribute('sex') || board.sex || 'male';
      const svgUrl = this.getAttribute('svg') || (board.svg ? new URL(board.svg, new URL(src || '.', location.href)).href
        : new URL(`assets/anatomogram-hs-${sex}.svg`, HERE).href);
      const svg = (await fetchText(svgUrl)).replace(/^<!--[\s\S]*?-->\s*/, '');
      if (!current()) return;
      const drawn = new Set(svg.match(/id="UBERON_\d+"/g)?.map((m) => m.slice(4, -1)) || []);
      const meds = this.medications(board);
      this.st = { status: 'ready', board, svg, sex, drawn, meds, drugs: [], interactions: [], dbFile: null };
      const needDb = meds.some((m) => !m.sites);
      if (needDb) {
        this.st.status = 'db';
        this.render();
        await this.queryDb(meds, current);
      } else {
        this.st.drugs = meds.map((m) => this.staticDrug(m));
        this.st.interactions = (board.drugs?.interactions || []).map((x) => this.staticInteraction(x));
      }
      if (!current()) return;
      this.st.status = 'ready';
    } catch (e) {
      if (!current()) return;
      this.st = { ...this.st, status: 'error', error: e.message };
    }
    this.render();
  }

  /** Medications from board.medications, legacy board.drugs.items and the `drugs` attribute (merged by drug name). */
  medications(board) {
    const out = [...(board.medications || []).map((m) => ({ ...m }))];
    for (const it of board.drugs?.items || []) out.push({ drug: it.id, label: it.label, dosage: it.dosage, atc: it.atc, ref: it.fhir, sites: it.sites, elsewhere: it.elsewhere });
    for (const name of list(this.getAttribute('drugs'))) {
      if (!out.some((m) => m.drug.toLowerCase() === name.toLowerCase())) out.push({ drug: name });
    }
    return out;
  }

  async queryDb(meds, current) {
    const dbUrl = this.getAttribute('db') || DEFAULT_DB;
    const { db, file } = await openDb(dbUrl, this.getAttribute('sql-wasm') || DEFAULT_SQL_WASM);
    if (!current()) return;
    const evidence = list(this.getAttribute('evidence') || 'drugbank_actor');
    const text = this.getAttribute('include-text') !== 'false';
    const hide = new Set(list(this.getAttribute('hide-tissues') ?? DEFAULT_HIDE).map((x) => x.toLowerCase()));
    const resolved = resolveDrugs(db, meds.map((m) => m.drug));
    const found = resolved.filter((r) => !r.missing);
    const { sites, interactions } = computeAdme(db, found, { evidence, text });
    const label = (slug) => {
      const r = found.find((x) => x.slug === slug);
      const m = r && meds[resolved.indexOf(r)];
      return m?.label?.split(' ')[0] || (r ? r.name[0].toUpperCase() + r.name.slice(1) : slug);
    };
    this.st.dbFile = file;
    this.st.dbInfo = { evidence: [...evidence, ...(text ? ['drugbank_text'] : [])].join(', '), hidden: [...hide].join(', ') };
    this.st.drugs = meds.map((m, i) => {
      const r = resolved[i];
      if (m.sites) return this.staticDrug(m);
      const name = r.missing ? m.drug : r.name[0].toUpperCase() + r.name.slice(1);
      return {
        id: r.slug || m.drug, label: m.label || name, dosage: m.dosage || '', atc: m.atc || r.atc || '', ref: m.ref || (r.drugbank_id ? `DrugBank ${r.drugbank_id}` : ''),
        missing: !!r.missing,
        sites: sites.filter((s) => s.drug === r.slug && !hide.has(s.tissue.toLowerCase()))
          .map((s) => ({ key: this.keyFor(s.uberon), tissue: s.tissue, process: s.process, genes: s.genes })),
      };
    });
    this.st.interactions = interactions.map((x) => ({
      kind: x.kind, gene: x.gene,
      text: x.kind === 'ddi_candidate' ? this.t.ddiText(label(x.perpetrator), x.effect, x.gene, label(x.victim)) : this.t.sharedText(label(x.a), label(x.b), x.gene),
      organs: [...new Set(x.tissues.filter((t) => !hide.has(t.tissue.toLowerCase())).map((t) => this.keyFor(t.uberon)).filter(Boolean))],
    }));
  }

  /** ADME tissue UBERON id ("UBERON:0002113") -> organ id in the current drawing, or null. */
  keyFor(uberon) {
    if (!uberon) return null;
    const key = TISSUE_PROXY[uberon] || uberon.replace(':', '_');
    return this.st.drawn?.has(key) ? key : null;
  }

  staticDrug(m) {
    return {
      id: m.drug, label: m.label || m.drug, dosage: m.dosage || '', atc: m.atc || '', ref: m.ref || '',
      sites: [
        ...(m.sites || []).map((s) => ({ key: s.organ, tissue: null, process: s.process, genes: s.genes || [] })),
        ...(m.elsewhere || []).map((s) => ({ key: null, tissue: s.label, process: s.process, genes: s.genes || [] })),
      ],
    };
  }

  staticInteraction(x) {
    return { kind: x.role === 'inhibitor' || x.role === 'inducer' ? 'ddi_candidate' : 'shared_substrate', gene: x.gene, text: x.text, organs: x.organs || [] };
  }

  organLabel(key) {
    const b = this.st.board || {};
    return b.organs?.[key] || ORGANS[key.split(':')[0]]?.[this.lang] || key;
  }

  tissueLabel(t) { return this.lang === 'cs' ? (TISSUES_CS[t] || t) : t; }

  /** Organ model: findings (gated by `reached`) and drug sites per organ key. */
  model() {
    const { board, drugs } = this.st;
    const reached = this._reached;
    const visible = (f) => !f.when || !reached
      || (f.when.task && reached.has(`task:${f.when.task}`)) || (f.when.mdt && reached.has(`mdt:${f.when.mdt}`))
      || (typeof f.when === 'string' && reached.has(f.when));
    const organs = new Map();
    const get = (key, label, off = false) => {
      if (!organs.has(key)) organs.set(key, { key, label, off, findings: [], drugs: [] });
      return organs.get(key);
    };
    for (const f of (board.findings || []).filter(visible)) {
      if (f.organ) get(f.organ, this.organLabel(f.organ)).findings.push(f);
      else get(`off:${f.label}`, f.label, true).findings.push(f);
    }
    for (const d of drugs) {
      for (const s of d.sites) if (s.key) get(s.key, this.organLabel(s.key)).drugs.push({ ...s, drug: d });
    }
    for (const o of organs.values()) o.latest = o.findings[o.findings.length - 1] || null;
    const tumor = [...organs.values()].filter((o) => o.latest).sort((a, z) => LEVELS[z.latest.level].rank - LEVELS[a.latest.level].rank);
    return { organs, tumor };
  }

  organCss(organs) {
    const showT = this.ui.layer !== 'drugs';
    const showD = this.ui.layer !== 'tumor';
    const rules = [];
    for (const o of organs.values()) {
      if (o.off) continue;
      const lvl = showT ? o.latest?.level : null;
      const drug = showD && o.drugs.length > 0;
      const red = lvl === 'suspect' || lvl === 'confirmed';
      let fill = null; let stroke = null; let width = null; let dash = null;
      if (red) fill = 'var(--_tumor)';
      else if (lvl === 'possible') { fill = 'var(--_tumor-soft)'; stroke = 'var(--_tumor)'; width = 0.6; dash = '1.2 .8'; }
      else if (drug) fill = 'var(--_drug)';
      if (lvl === 'related') { stroke = 'var(--_tumor)'; width = 0.7; dash = '1.2 .8'; }
      if (drug && (red || lvl === 'possible')) { stroke = 'var(--_drug)'; width = 0.9; dash = null; }
      if (o.key === this.ui.selected) { stroke = 'var(--ink, #18212B)'; width = 1.1; dash = null; }
      const [id, part] = o.key.split(':');
      // Two ids so these beat the base organ rule in the adopted stylesheet (adopted sheets cascade later).
      const el = `#LAYER_EFO #${id}${part ? ` > path:nth-of-type(${part})` : ''}`;
      rules.push(`${el}, ${el} * { ${fill ? `fill: ${fill} !important; fill-opacity: var(--highlight-opacity, .6) !important;` : ''} ${stroke ? `stroke: ${stroke} !important; stroke-opacity: 1 !important; stroke-width: ${width} !important;` : ''} stroke-dasharray: ${dash || 'none'} !important; cursor: pointer; }`);
    }
    return rules.join('\n');
  }

  render() {
    const t = this.t;
    const st = this.st;
    if (st.status === 'idle' || st.status === 'loading' || st.status === 'error' && !st.svg) {
      this.paint(`<section class="card"><div class="head"><h2>${esc(t.title)}</h2></div>${st.status === 'error'
        ? `<p class="banner miss">${esc(t.loadError)}: ${esc(st.error)}</p>`
        : '<div class="skeleton"><span></span><span style="width:70%"></span><span style="width:85%"></span></div>'}</section>`);
      return;
    }
    const { organs, tumor } = this.model();
    const layer = this.ui.layer;
    const zoom = this.ui.zoom || (this.getAttribute('zoom') === 'abdomen' ? 'abdomen' : 'body');
    const showT = layer !== 'drugs';
    const showD = layer !== 'tumor';
    const sel = this.ui.selected;
    const seg = (name, action, items, current) => `<div class="seg" role="group" aria-label="${esc(name)}">${items.map(([v, l]) =>
      `<button type="button" data-action="${action}" data-v="${v}" data-key="${action}-${v}" aria-pressed="${v === current}">${esc(l)}</button>`).join('')}</div>`;
    const lastDate = tumor.map((o) => o.latest.date).sort().pop();
    const lvl = (l) => `<span class="pill ${LEVELS[l].tone}">${esc(LEVELS[l][this.lang])}</span>`;
    const proc = (p) => PROCESSES[p]?.[this.lang] || p;

    // Figure
    let svg = st.svg.replace('<svg ', '<svg role="img" aria-labelledby="ana-cap" ');
    if (zoom === 'abdomen') svg = svg.replace(/viewBox="[^"]*"/, `viewBox="${st.board.zoomViewBox || DEFAULT_ZOOM[st.sex] || DEFAULT_ZOOM.male}"`);
    const red = tumor.filter((o) => !o.off && ['suspect', 'confirmed'].includes(o.latest.level)).map((o) => o.label);
    const blue = [...organs.values()].filter((o) => o.drugs.length).map((o) => o.label);
    const figure = `<figure><style>${this.organCss(organs)}</style>${svg}
      <figcaption id="ana-cap">${esc(t.captionRed)}: ${esc(red.join(', ') || t.none)}; ${esc(t.captionBlue)}: ${esc(blue.join(', ') || t.none)}. ${esc(t.attribution)}</figcaption></figure>`;
    const legend = `<div class="legend">${['t', 'p', 'r', 'd', 'td'].map((c, i) => `<span><i class="sw ${c}"></i>${esc(t.legend[i])}</span>`).join('')}</div>`;

    // Findings
    const findings = showT ? `<div class="group"><h3>${esc(t.suspicionH)} <span class="muted small">${esc(t.suspicionSub)}</span></h3>
      ${tumor.length ? `<ul>${tumor.map((o) => `<li><button class="organ" type="button" data-action="select" data-id="${esc(o.key)}" data-key="o-${esc(o.key)}" aria-pressed="${o.key === sel}">
        <span class="top"><span class="name">${esc(o.label)}${o.off ? ` <span class="muted small">(${esc(t.off)})</span>` : ''}</span>${lvl(o.latest.level)}</span>
        <span class="txt">${esc(o.latest.text)}</span>
        <span class="source">${esc(fmtDate(o.latest.date))} · ${esc(o.latest.source || '')}</span></button></li>`).join('')}</ul>`
        : `<p class="muted small">${esc(t.noFindings)}</p>`}</div>` : '';

    // Drugs
    let meds = '';
    if (showD) {
      const chips = (d) => {
        const groups = new Map();
        for (const s of d.sites) {
          const k = s.key || `off:${s.tissue}`;
          if (!groups.has(k)) groups.set(k, { key: s.key, label: s.key ? this.organLabel(s.key) : this.tissueLabel(s.tissue), procs: [] });
          if (!groups.get(k).procs.includes(s.process)) groups.get(k).procs.push(s.process);
        }
        return [...groups.values()].map((g) => (g.key
          ? `<button class="chip" type="button" data-action="select" data-id="${esc(g.key)}" data-key="d-${esc(d.id)}-${esc(g.key)}" aria-pressed="${g.key === sel}">${esc(g.label)} · ${esc(g.procs.map(proc).join(', '))}</button>`
          : `<span class="chip static">${esc(g.label)} · ${esc(g.procs.map(proc).join(', '))} (${esc(t.off)})</span>`)).join('');
      };
      meds = `<div class="group"><h3>${esc(t.medsH)} <span class="muted small">${esc(t.medsSub)}</span></h3>
        ${st.status === 'db' ? `<p class="banner">${esc(t.loadingDb)}</p>` : ''}
        ${st.status === 'error' ? `<p class="banner miss">${esc(t.dbError)}: ${esc(st.error)}</p>` : ''}
        ${st.status === 'ready' && !st.drugs.length ? `<p class="muted small">${esc(t.noDrugs)}</p>` : ''}
        <ul>${st.drugs.map((d) => `<li class="item">
          <div class="top"><strong>${esc(d.label)}</strong><span class="muted small mono">${esc([d.dosage, d.atc && `ATC ${d.atc}`].filter(Boolean).join(' · '))}</span></div>
          ${d.missing ? `<p class="pill warn">${esc(t.notFound)}</p>` : d.sites.length ? `<div class="chips">${chips(d)}</div>` : `<p class="muted small">${esc(t.noSites)}</p>`}
          ${d.ref ? `<p class="source" style="margin-top:4px">${esc(t.source)}: ${esc(d.ref)}</p>` : ''}</li>`).join('')}</ul>
        ${st.interactions.length ? `<h3 style="margin-top:14px">${esc(t.ddiH)} <span class="muted small">${esc(t.ddiSub)}</span></h3>
          <ul>${st.interactions.map((x, i) => `<li class="item"><div class="top"><strong>${esc(x.text)}</strong>
            <span class="pill ${x.kind === 'ddi_candidate' ? 'warn' : 'neutral'}">${esc(x.kind === 'ddi_candidate' ? t.ddiPill : t.sharedPill)}</span></div>
            <div class="chips"><span class="genes">${esc(x.gene)}</span>${x.organs.map((o) => `<button class="chip" type="button" data-action="select" data-id="${esc(o)}" data-key="x-${i}-${esc(o)}" aria-pressed="${o === sel}">${esc(this.organLabel(o))}</button>`).join('')}</div></li>`).join('')}</ul>` : ''}
        <p class="note">${st.dbFile ? `${esc(t.dbNote(st.dbFile, st.dbInfo.evidence))}${esc(st.dbInfo.hidden || t.none)}.` : st.drugs.length ? esc(t.staticNote) : ''}</p>
      </div>`;
    }

    // Detail of the selected organ
    let detail = '';
    if (sel) {
      const o = organs.get(sel) || { key: sel, label: this.organLabel(sel), findings: [], drugs: [] };
      const ddi = showD ? st.interactions.filter((x) => x.organs.includes(sel)) : [];
      detail = `<div class="detail" aria-live="polite">
        <div class="top"><h3>${esc(o.label)}</h3><button class="x" type="button" data-action="clear" aria-label="${esc(t.close)}">×</button></div>
        ${o.findings.length ? `<ul class="hist">${[...o.findings].reverse().map((f, i) => `<li class="${i ? 'old' : ''}"><span>${lvl(f.level)} ${esc(f.text)}</span>
          <span class="source">${esc(fmtDate(f.date))} · ${esc(f.source || '')}</span></li>`).join('')}</ul>` : `<p class="muted small">${esc(t.noFinding)}</p>`}
        ${showD && o.drugs.length ? `<ul class="hist">${o.drugs.map((s) => `<li><span><span class="pill drug">${esc(proc(s.process))}</span> ${esc(s.drug.label)}</span>
          <span class="genes">${esc(s.genes.length ? s.genes.join(' · ') : t.spc)}</span></li>`).join('')}</ul>` : ''}
        ${ddi.length ? `<ul class="hist">${ddi.map((x) => `<li><span><span class="pill ${x.kind === 'ddi_candidate' ? 'warn' : 'neutral'}">${esc(x.kind === 'ddi_candidate' ? t.ddiPill : t.sharedPill)}</span> ${esc(x.text)}</span></li>`).join('')}</ul>` : ''}
      </div>`;
    }

    this.paint(`<section class="card" aria-labelledby="ana-h">
      <div class="head"><div><h2 id="ana-h">${esc(t.title)}</h2>
        ${lastDate ? `<p class="muted small">${esc(t.asOf)} ${esc(fmtDate(lastDate))} · ${esc(t.recalc)}</p>` : ''}</div>
        <div class="row"><span class="pill tumor">${esc(t.pillFindings)}</span><span class="pill drug">${esc(t.pillDrugs)}</span></div></div>
      <div class="controls">${seg(t.layer, 'layer', [['all', t.all], ['tumor', t.findings], ['drugs', t.drugs]], layer)}
        ${seg(t.view, 'zoom', [['body', t.body], ['abdomen', t.abdomen]], zoom)}</div>
      <div class="layout"><div>${figure}${legend}</div><div>${findings}${meds}${detail}</div></div>
      <p class="note">${esc(t.rule)}</p></section>`);
  }

  /** Replace shadow content, keeping focus on the element with the same data-key. */
  paint(markup) {
    const key = this.shadowRoot.activeElement?.dataset?.key;
    this.shadowRoot.innerHTML = markup;
    if (key) this.shadowRoot.querySelector(`[data-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
  }

  select(key) {
    this.ui.selected = key;
    this.render();
    if (key) {
      this.dispatchEvent(new CustomEvent('organ-select', { bubbles: true, composed: true, detail: { organ: key, label: this.organLabel(key) } }));
    }
  }

  onEvent(e) {
    if (e.type === 'keydown') return;
    const el = e.target.closest('[data-action]');
    const action = el?.dataset.action;
    if (!action) {
      // Click on an organ in the drawing; prefer a sub-part key ("ID:n") when the clicked path is that part.
      const organ = e.target.closest?.('[id^="UBERON_"]');
      if (!organ) return;
      const path = e.target.closest('path');
      const keys = [...this.model().organs.keys()];
      const part = keys.find((k) => k.startsWith(`${organ.id}:`) && organ.querySelector(`:scope > path:nth-of-type(${k.split(':')[1]})`) === path);
      this.select(part || organ.id);
      return;
    }
    if (action === 'layer') { this.ui.layer = el.dataset.v; this.render(); }
    if (action === 'zoom') { this.ui.zoom = el.dataset.v; this.render(); }
    if (action === 'select') this.select(this.ui.selected === el.dataset.id ? null : el.dataset.id);
    if (action === 'clear') this.select(null);
  }
}

if (!customElements.get('onco-anatomogram')) customElements.define('onco-anatomogram', OncoAnatomogram);
export { OncoAnatomogram };
