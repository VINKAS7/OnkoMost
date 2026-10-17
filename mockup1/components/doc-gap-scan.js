import { KocElement } from './lib/base.js';
import { html } from './lib/html.js';
import { icon } from './lib/icons.js';
import { loadJSON } from './lib/data.js';
import { getCase } from './lib/store.js';
import { CASES } from './lib/cases.js';
import { scanDocument } from './lib/llm.js';
import { acceptDocFinding, removeDocFinding } from './lib/actions.js';
import { caseState } from './lib/dx-case-state.js';
import { evaluate } from './onco-dx-pathway/engine.js';

// GP screen (draft referral) or, with role="koordinator", the coordinator screen (case in coordination): upload a
// PDF / DOCX and let an LLM (server path, mockup1/backend → e-INFRA CZ) say which still-missing steps of the case's
// diagnostic pathway the document documents. One model, or both side by side for comparison.
// The server checks every quote against the document text; nothing is written to the case until the doctor
// confirms an item ("AI only drafts, a human confirms").

const OPEN = ['missing_needed', 'missing_optional', 'undetermined'];
const MODE_COMPARE = 'compare';
const cfg = () => window.KOC_CONFIG?.docScan || {};
const models = () => cfg().models || [{ id: 'glm-5.3-flash', label: 'GLM-5.3-flash' }, { id: 'qwen3.8-27b', label: 'Qwen3.8-27B' }];
const kb = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} kB` : `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`);
const sec = (ms) => `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
const factText = (facts) => Object.entries(facts || {}).map(([k, v]) => `${k} = ${v === true ? 'ano' : v === false ? 'ne' : v}`).join(' · ');

class DocGapScan extends KocElement {
  static styles = `
    .intro { font-size: 14px; margin-bottom: 10px; }
    .looking { font-size: 13px; color: var(--muted); margin-bottom: 12px; }
    .looking strong { color: var(--ink); font-weight: 600; }
    .controls { display: flex; flex-wrap: wrap; gap: 10px 14px; align-items: center; margin-bottom: 12px; }
    .seg { display: inline-flex; flex-wrap: wrap; border: 1px solid var(--line-strong); border-radius: var(--radius-ctl); overflow: hidden; }
    .seg button { border: 0; min-height: 36px; padding: 0 12px; background: var(--surface); font: inherit; font-size: 13.5px; font-weight: 600; color: inherit; cursor: pointer; }
    .seg button + button { border-left: 1px solid var(--line); }
    .seg button[aria-pressed="true"] { background: var(--accent); color: #fff; }
    .seg-lbl { font-size: 13px; color: var(--muted); }
    input[type="file"] { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
    .file { font-size: 13px; color: var(--muted); display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin: 4px 0 10px; }
    .file strong { color: var(--ink); overflow-wrap: anywhere; }
    .cols { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 230px), 1fr)); }
    .status { font-size: 13px; color: var(--muted); display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    ul.items { display: grid; gap: 0; margin-top: 4px; }
    li.item { border-top: 1px solid var(--line); padding: 12px 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; }
    li.item:first-child { border-top: 0; }
    .top { display: flex; justify-content: space-between; gap: 6px 10px; flex-wrap: wrap; align-items: flex-start; }
    .lbl { font-weight: 600; min-width: 0; }
    .ans { border: 1px solid var(--line); border-radius: var(--radius-ctl); padding: 8px 10px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 4px; align-content: start; font-size: 13.5px; min-width: 0; }
    .ans.miss { color: var(--muted); border-style: dashed; }
    .ans .who { font-size: 11.5px; font-weight: 700; letter-spacing: .03em; text-transform: uppercase; color: var(--ai); }
    .ans q { display: block; font-style: italic; color: var(--muted); font-size: 12.5px; overflow-wrap: anywhere; }
    .ans .facts { font-family: var(--font-mono); font-size: 12px; }
    .ans .btn { justify-self: start; margin-top: 2px; }
    .accepted { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 13.5px; color: var(--ok); }
    .accepted .icon { color: var(--ok); }
    .accepted > span { flex: 1 1 16em; min-width: 0; }
    .notfound { font-size: 13px; color: var(--muted); margin-top: 8px; }
    .ans.agree { border-color: var(--ok); }
    .ans > * { min-width: 0; overflow-wrap: anywhere; }
    .ans .pill.wrap { white-space: normal; justify-self: start; }
    .ans .facts .only { font-family: var(--font-sans); font-size: 11.5px; color: var(--warn); font-weight: 600; }
    .xcheck { border: 1.5px solid var(--warn); background: var(--warn-soft); border-radius: var(--radius-ctl); padding: 8px 10px; font-size: 13.5px; display: grid; gap: 4px; }
    .xcheck strong { display: flex; gap: 6px; align-items: center; color: var(--warn); }
    .xcheck ul { display: grid; gap: 2px; padding-left: 0; }
    li.item.dis { border-left: 4px solid var(--warn); padding-left: 10px; }
    .summary { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; font-size: 13.5px; margin: 10px 0 2px; }
    .wait { font-size: 12.5px; color: var(--muted); }
    table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 12px; }
    caption { text-align: left; font-weight: 600; font-size: 13.5px; padding-bottom: 4px; }
    th, td { text-align: left; padding: 5px 8px 5px 0; border-bottom: 1px solid var(--line); vertical-align: top; }
    th[scope="row"] { font-weight: 500; color: var(--muted); }
    .tbl { overflow-x: auto; }
    .err { margin-top: 4px; }
  `;

  caseChanged() { this.scan = null; }

  /** Map + pathway of the case, loaded once. */
  data(id) {
    this.cache ||= {};
    if (!(id in this.cache)) {
      this.cache[id] = null;
      loadJSON(`data/dx-map-${id}.json`)
        .then((map) => loadJSON(map.pathway).then((p) => ({ map, p })))
        .catch(() => ({ missing: true }))
        .then((d) => { this.cache[id] = d; this.update(); });
    }
    return this.cache[id];
  }

  get mode() { return this._mode || MODE_COMPARE; }

  get coordinator() { return this.getAttribute('role') === 'koordinator'; }

  /** GP: only while the referral is a draft; coordinator: once taken over and until the MDT conclusion is sent. */
  locked(c) { return this.coordinator ? c.phase !== 'active' : c.phase !== 'draft'; }

  demoFile() { return CASES[this.caseId]?.demoDoc || cfg().demoFile || 'data/demo/ambulantni-zprava-novak.pdf'; }

  /**
   * Open pathway steps a document could still supply (not intake / supportive / milestones). The coordinator also
   * looks for steps in progress: their results arrive as reports from the sites doing them.
   */
  openSteps(c, d) {
    const { state } = caseState(c, d.map);
    const ev = evaluate(d.p, state);
    const open = this.coordinator ? [...OPEN, 'in_progress'] : OPEN;
    const facts = d.p.facts || {};
    return d.p.graph.nodes
      .filter((n) => n.type === 'step' && !['intake', 'supportive'].includes(n.phase) && n.kind !== 'milestone' && open.includes(ev.nodes[n.id].vstate))
      .map((n) => ({
        id: n.id, label: n.label, description: n.description || undefined,
        gp: n.owner_role === 'gp' || (n.suppliable_by || []).includes('gp'),
        facts: (n.produces || []).filter((f) => facts[f] && !facts[f].derived)
          .map((f) => ({ name: f, type: facts[f].type, label: facts[f].label, unit: facts[f].unit, values: facts[f].values })),
      }));
  }

  async run(file) {
    const c = getCase(this.caseId);
    const d = this.data(this.caseId);
    if (!d?.p || this.locked(c)) return;
    const steps = this.openSteps(c, d);
    const items = steps.map(({ gp, ...it }) => it);
    const chosen = this.mode === MODE_COMPARE ? models() : models().filter((m) => m.id === this.mode);
    this.abort?.abort();
    const ctl = (this.abort = new AbortController());
    const scan = (this.scan = { file: { name: file.name, size: file.size }, steps, started: Date.now(), runs: {} });
    for (const m of chosen) scan.runs[m.id] = { model: m, pending: true };
    this.update();
    await Promise.all(chosen.map((m) => scanDocument({ file, items, model: m.id, signal: ctl.signal })
      .then((r) => { scan.runs[m.id] = { model: m, result: r }; if (r.file) scan.file = { ...scan.file, ...r.file }; })
      .catch((e) => { if (e.name !== 'AbortError') scan.runs[m.id] = { model: m, error: e.message }; })
      .finally(() => { if (this.scan === scan) this.update(); })));
  }

  async runDemo() {
    const url = this.demoFile();
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(res.status);
      const blob = await res.blob();
      const type = url.endsWith('.docx') ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf';
      this.run(new File([blob], url.split('/').pop(), { type }));
    } catch {
      this.scan = { error: `Ukázkový dokument ${url} se nepodařilo načíst.` };
      this.update();
    }
  }

  onClick(e, el, action) {
    if (action === 'mode') { this._mode = el.dataset.mode; this.update(); }
    if (action === 'pick') this.$('#doc').click();
    if (action === 'demo') this.runDemo();
    if (action === 'accept') {
      const run = this.scan.runs[el.dataset.model];
      const it = run.result.items.find((x) => x.id === el.dataset.id);
      acceptDocFinding(this.caseId, {
        step: it.id, value: it.value, quote: it.quote, verified: it.verified, facts: it.facts,
        file: this.scan.file.name, model: run.model.id, modelLabel: run.model.label,
      }, this.coordinator);
    }
    if (action === 'accept-agreed') {
      const x = this.reconcile(Object.values(this.scan.runs), el.dataset.id);
      const p = x.primary;
      acceptDocFinding(this.caseId, {
        step: p.it.id, value: p.it.value, quote: p.it.quote, verified: p.it.verified,
        facts: Object.fromEntries(Object.entries(x.facts).map(([k, v]) => [k, v.value])),
        file: this.scan.file.name, model: x.answers.map((a) => a.run.model.id).join('+'),
        modelLabel: `${x.answers.map((a) => a.run.model.label).join(' + ')} (shoda)`,
      }, this.coordinator);
    }
    if (action === 'undo') removeDocFinding(this.caseId, el.dataset.id);
  }

  onChange(e, el, action) {
    if (action === 'file' && el.files.length) { this.run(el.files[0]); el.value = ''; }
  }

  /**
   * Cross-check of the models' answers for one step:
   *   single   – one model was asked
   *   partial  – the other model is still running or failed (no cross-check yet)
   *   agree    – all found it and no fact has two different values (a fact only one model states is marked)
   *   disagree – found vs. not found, or the same fact with different values → the doctor decides
   */
  reconcile(runs, stepId) {
    const answers = runs.filter((r) => r.result).map((run) => ({ run, it: run.result.items.find((x) => x.id === stepId) }));
    if (runs.length === 1) return { kind: 'single', answers };
    const open = runs.filter((r) => !r.result);
    if (open.length) return { kind: 'partial', answers, open };
    const found = answers.filter((a) => a.it?.found);
    const reasons = [];
    if (found.length && found.length < answers.length) {
      reasons.push(answers.map((a) => `${a.run.model.label}: ${a.it?.found ? 'nalezeno' : 'nenalezeno'}`).join(' · '));
    }
    const facts = {};
    for (const a of found) {
      for (const [k, v] of Object.entries(a.it.facts || {})) {
        facts[k] ||= { value: v, by: [], conflict: false };
        if (String(facts[k].value) !== String(v)) facts[k].conflict = true;
        facts[k].by.push(a.run.model.label);
      }
    }
    for (const [k, v] of Object.entries(facts)) {
      if (v.conflict) reasons.push(`${k}: ${found.map((a) => `${a.run.model.label} ${a.it.facts?.[k] ?? '–'}`).join(' × ')}`);
    }
    const primary = found.find((a) => a.it.verified) || found[0];
    return { kind: reasons.length ? 'disagree' : 'agree', answers, found, facts, reasons, primary };
  }

  agreed(x, step, accepted) {
    const it = x.primary.it;
    const verified = x.found.filter((a) => a.it.verified).length;
    const n = x.found.length;
    const facts = Object.entries(x.facts);
    return html`<div class="ans agree">
      <span class="pill ok wrap">${icon('check')}Oba modely souhlasí · ${x.found.map((a) => a.run.model.label).join(' + ')}</span>
      <span>${it.value || 'nalezeno'}</span>
      ${facts.length ? html`<span class="facts">${facts.map(([k, v], i) => html`${i ? ' · ' : ''}${factText({ [k]: v.value })}${v.by.length < n
        ? html` <span class="only" title="Tento údaj uvedl jen jeden model">(jen ${v.by[0]})</span>` : ''}`)}</span>` : ''}
      ${it.quote ? html`<q>${it.quote}</q>` : ''}
      <span>${verified ? html`<span class="pill ok">${icon('check')}citace ověřena v textu${n > 1 ? ` (${verified} z ${n})` : ''}</span>` : html`<span class="pill warn">${icon('alert')}citaci nelze ověřit</span>`}</span>
      ${accepted ? '' : html`<button class="btn sm" type="button" data-action="accept-agreed" data-id="${step.id}" data-key="acc-agreed-${step.id}">${icon('check')}Převzít</button>`}
    </div>`;
  }

  /** One list item: one card when the models agree, both answers + a cross-check note when they don't. */
  item(runs, st, acc) {
    const x = this.reconcile(runs, st.id);
    const head = html`<div class="top"><span class="lbl">${st.label}</span>${st.gp ? html`<span class="pill warn">${this.coordinator ? 'od lékaře' : 'doplňte vy'}</span>` : html`<span class="pill">zajistí KOC</span>`}</div>
      ${acc ? html`<p class="accepted">${icon('check')}<span>Převzato: ${acc.value || 'doloženo'} · ${acc.modelLabel} · potvrdil(a) ${acc.confirmedBy}</span>
        <button class="btn sm ghost" type="button" data-action="undo" data-id="${st.id}" data-key="undo-${st.id}">Zrušit</button></p>` : ''}`;
    if (x.kind === 'agree') return html`<li class="item">${head}${this.agreed(x, st, !!acc)}</li>`;
    if (x.kind === 'disagree') {
      return html`<li class="item dis">${head}
        <div class="xcheck" role="note"><strong>${icon('alert')}Modely se neshodují – zkontrolujte v dokumentu a rozhodněte</strong>
          <ul>${x.reasons.map((r) => html`<li>${r}</li>`)}</ul></div>
        <div class="cols">${x.answers.map((a) => this.answer(a.run, st, !!acc, true))}</div></li>`;
    }
    // single model, or the cross-check is not available (yet)
    const shown = x.kind === 'single' ? runs : x.answers;
    return html`<li class="item">${head}
      <div class="cols">${shown.map((r) => this.answer(r.run || r, st, !!acc, false))}</div>
      ${x.kind === 'partial' ? html`<p class="wait">${x.open.map((r) => r.pending
        ? `Čeká se na ${r.model.label} pro křížovou kontrolu…` : `${r.model.label} selhal – bez křížové kontroly.`).join(' ')}</p>` : ''}</li>`;
  }

  answer(run, step, accepted, compare) {
    const r = run.result?.items.find((x) => x.id === step.id);
    const who = html`<span class="who">${run.model.label}</span>`;
    if (run.pending) return html`<div class="ans miss">${who}<span>čeká…</span></div>`;
    if (run.error) return html`<div class="ans miss">${who}<span>chyba</span></div>`;
    if (!r?.found) return html`<div class="ans miss">${who}<span>nenalezeno</span></div>`;
    return html`<div class="ans">
      ${who}
      <span>${r.value || 'nalezeno'}</span>
      ${r.facts && Object.keys(r.facts).length ? html`<span class="facts">${factText(r.facts)}</span>` : ''}
      ${r.quote ? html`<q>${r.quote}</q>` : ''}
      <span>${r.verified ? html`<span class="pill ok">${icon('check')}citace ověřena v textu</span>` : html`<span class="pill warn">${icon('alert')}citaci nelze ověřit</span>`}</span>
      ${accepted ? '' : html`<button class="btn sm" type="button" data-action="accept" data-model="${run.model.id}" data-id="${step.id}"
        data-key="acc-${run.model.id}-${step.id}">${icon('check')}${compare ? `Převzít (${run.model.label})` : 'Převzít'}</button>`}
    </div>`;
  }

  /** Model comparison: time, tokens, findings, verified quotes, agreement. */
  compareTable(runs) {
    const done = runs.filter((r) => r.result);
    if (runs.length < 2 || done.length < 2) return '';
    // same rule as the cards: a step agrees when the models do not conflict (both not found counts as agreement)
    const agree = this.scan.steps.filter((s) => this.reconcile(runs, s.id).kind !== 'disagree').length;
    const row = (label, f) => html`<tr><th scope="row">${label}</th>${done.map((r) => html`<td>${f(r.result)}</td>`)}</tr>`;
    return html`<div class="tbl"><table>
      <caption>Porovnání modelů · shoda ${agree} z ${this.scan.steps.length} kroků</caption>
      <tr><th scope="col"><span class="sr-only">Metrika</span></th>${done.map((r) => html`<th scope="col">${r.model.label}</th>`)}</tr>
      ${row('Doba odpovědi', (r) => sec(r.ms))}
      ${row('Tokeny (z toho uvažování)', (r) => `${r.usage?.completion ?? '–'} (${r.usage?.reasoning ?? '–'})`)}
      ${row('Nalezeno kroků', (r) => r.items.filter((x) => x.found).length)}
      ${row('Ověřené citace', (r) => `${r.items.filter((x) => x.verified).length} z ${r.items.filter((x) => x.found).length}`)}
      ${row('Typ dokumentu', (r) => [r.document?.type, r.document?.date].filter(Boolean).join(' · ') || '–')}
    </table></div>`;
  }

  render() {
    const c = getCase(this.caseId);
    const d = this.data(this.caseId);
    if (!d || d.missing) return '';
    const locked = this.locked(c);
    const demo = this.demoFile();
    const docs = c.docFindings || {};
    const steps = this.openSteps(c, d);
    const s = this.scan;
    const runs = s?.runs ? Object.values(s.runs) : [];
    const compare = runs.length > 1;
    const busy = runs.some((r) => r.pending);
    const shown = s?.steps || [];
    const hit = (step) => runs.some((r) => r.result?.items.find((x) => x.id === step.id)?.found);
    const listed = shown.filter((st) => hit(st) || docs[st.id]?.file === s?.file?.name);
    const kinds = listed.map((st) => this.reconcile(runs, st.id).kind);
    const agreeN = kinds.filter((k) => k === 'agree').length;
    const disN = kinds.filter((k) => k === 'disagree').length;
    const accepted = Object.entries(docs).filter(([, f]) => f.file);
    const label = (id) => d.p.graph.nodes.find((n) => n.id === id)?.label || id;

    return html`
      <section class="card" aria-labelledby="dgs-h">
        <div class="card-head">
          <div><h2 id="dgs-h">Doplnit z dokumentu</h2><p class="muted small">AI hledá chybějící kroky diagnostické cesty · rozhodujete vy</p></div>
          <span class="pill ai">${icon('spark')}AI návrh</span>
        </div>
        ${locked ? html`<p class="empty">${this.coordinator
          ? (c.phase === 'submitted' ? 'Dokumenty lze vytěžit po převzetí případu.' : 'Závěr MDT je odeslán – případ se už nedoplňuje.')
          : 'Doporučení je odesláno – další dokumenty přiložte ve zprávě koordinátorovi.'}</p>` : html`
        <p class="intro">${this.coordinator
          ? 'Nahrajte zprávu nebo handover (PDF, DOCX). Model zjistí, které chybějící kroky diagnostické cesty dokládá, a ukáže citaci z textu. Převezmete jen to, co ověříte.'
          : 'Nahrajte zprávu (PDF, DOCX). Model zjistí, zda dokládá něco, co v cestě pacienta ještě chybí, a ukáže citaci z textu.'}</p>
        <p class="looking">Hledá se (${steps.length}): ${steps.map((st, i) => html`${i ? ' · ' : ''}${st.gp ? html`<strong>${st.label}</strong>` : st.label}`)}
          <span class="sr-only">; tučně kroky, které typicky doloží odesílající lékař</span></p>
        <div class="controls">
          <span class="seg-lbl" id="dgs-m">Model</span>
          <div class="seg" role="group" aria-labelledby="dgs-m">
            ${models().map((m) => html`<button type="button" data-action="mode" data-mode="${m.id}" data-key="mode-${m.id}" aria-pressed="${this.mode === m.id}">${m.label}</button>`)}
            <button type="button" data-action="mode" data-mode="${MODE_COMPARE}" data-key="mode-cmp" aria-pressed="${this.mode === MODE_COMPARE}">Porovnat oba</button>
          </div>
        </div>
        <div class="row">
          <input id="doc" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" data-action="file" tabindex="-1" aria-hidden="true">
          <button class="btn sm primary" type="button" data-action="pick" data-key="pick" ${busy || !steps.length ? 'disabled' : ''}>${icon('upload')}Nahrát PDF / DOCX</button>
          <button class="btn sm ghost" type="button" data-action="demo" data-key="demo" ${busy || !steps.length ? 'disabled' : ''}>${icon('file')}${this.coordinator ? 'Ukázkový handover' : 'Ukázková zpráva'} (${demo.endsWith('.docx') ? 'DOCX' : 'PDF'})</button>
        </div>`}
        <div aria-live="polite">
        ${s?.error ? html`<p class="banner warn err">${icon('alert')}${s.error}</p>` : ''}
        ${s?.file ? html`
          <p class="file">${icon('file')}<strong>${s.file.name}</strong><span class="mono">${kb(s.file.size)}</span>
            ${s.file.kind ? html`<span>· ${s.file.kind.toUpperCase()}${s.file.pages ? ` · ${s.file.pages} ${s.file.pages === 1 ? 'strana' : s.file.pages < 5 ? 'strany' : 'stran'}` : ''}</span>` : ''}</p>
          <div class="status">${runs.map((r) => r.pending ? html`<span class="pill ai">${r.model.label} čte dokument…</span>`
            : r.error ? html`<span class="pill warn">${r.model.label}: ${r.error}</span>`
            : html`<span class="pill">${r.model.label} · ${sec(r.result.ms)}</span>`)}</div>
          ${runs.some((r) => r.error && /backend|statick/.test(r.error)) ? html`<p class="note err">${icon('server')}<span>Skenování potřebuje backend prototypu: v <span class="mono">mockup1/</span> spusťte <span class="mono">.venv/bin/uvicorn backend.app:app --port 8000</span> a otevřete <span class="mono">http://localhost:8000</span>.</span></p>` : ''}
          ${busy && !runs.some((r) => r.result) ? html`<div class="skeleton" style="margin-top:10px"><span></span><span></span><span></span></div>` : ''}
          ${runs.some((r) => r.result) ? html`
            ${compare && !busy && runs.every((r) => r.result) ? html`<p class="summary">
              ${agreeN ? html`<span class="pill ok">${icon('check')}Shoda modelů: ${agreeN}</span>` : ''}
              ${disN ? html`<span class="pill warn">${icon('alert')}Neshoda: ${disN} – rozhodněte</span>` : html`<span class="muted">bez neshod</span>`}</p>` : ''}
            <ul class="items" aria-label="Nálezy v dokumentu">
              ${listed.map((st) => this.item(runs, st, docs[st.id]))}
            </ul>
            ${!busy ? html`<p class="notfound">V dokumentu nenalezeno: ${shown.filter((st) => !hit(st)).map((st) => st.label).join(' · ') || '–'}</p>` : ''}
            ${this.compareTable(runs)}` : ''}` : ''}
        </div>
        ${accepted.length && !s?.file ? html`<p class="note" style="margin-top:10px">${icon('check')}<span>Doloženo z dokumentů: ${accepted.map(([id]) => label(id)).join(', ')}.</span></p>` : ''}
        <p class="note" style="margin-top:12px">${icon('spark')}<span>Model jen navrhuje; do případu se zapíše až položka, kterou převezmete. Citace kontroluje server proti textu dokumentu.</span></p>
      </section>`;
  }
}
customElements.define('doc-gap-scan', DocGapScan);
