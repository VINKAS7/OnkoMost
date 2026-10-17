import { KocElement, copyText } from './lib/base.js';
import { html } from './lib/html.js';
import { icon } from './lib/icons.js';
import { getCase, templateFor } from './lib/store.js';
import { setHandoverDraft, editHandoverSection } from './lib/actions.js';
import { completeJSON } from './lib/llm.js';
import { fmtDate } from './lib/dates.js';

const FLAG = { missing: 'chybí', conflict: 'nesoulad', note: 'pozn.' };

// Structured handover. Full (GP, editable) or compact (coordinator) mode.
class HandoverPanel extends KocElement {
  static styles = `
    .title-row { display: grid; gap: 4px; }
    .sec { border-top: 1px solid var(--line); padding: 12px 0; display: grid; gap: 6px; }
    .sec:last-of-type { padding-bottom: 0; }
    .sec-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .text { font-size: 14.5px; border-radius: 6px; padding: 4px 6px; margin: -4px -6px; }
    .text.mono { font-size: 13.5px; }
    .text[role="button"] { cursor: text; }
    .text[role="button"]:hover { background: var(--prefill); outline: 1px dashed var(--line-strong); }
    .edited { color: var(--ai); }
    textarea { min-height: 90px; }
    .edit-actions { display: flex; gap: 8px; justify-content: flex-end; }
    .prov { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--line); }
    .compact li { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 6px 0; border-top: 1px solid var(--line); font-size: 14px; }
    .compact li:first-child { border-top: 0; }
    .compact li > span:first-child { min-width: 0; display: grid; gap: 3px; }
    .flags { display: flex; flex-direction: column; gap: 3px; font-size: 12.5px; }
    .flag { display: flex; gap: 6px; align-items: baseline; overflow-wrap: anywhere; }
    .flag b { font-weight: 600; flex: none; }
    .flag.missing b { color: var(--miss); }
    .flag.conflict b { color: var(--warn); }
    .flag.note b { color: var(--muted); }
    .flagsum { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 6px; }
    .originals { margin-top: 10px; font-size: 13px; color: var(--muted); }
    .loading { display: grid; gap: 10px; }
  `;

  init() {
    this.copied ??= null;
    this.editing ??= null;
  }

  ensureDraft(c) {
    if (c.phase !== 'draft' || c.handover || this.loading) return;
    this.loading = true;
    completeJSON({
      task: 'extract-handover',
      messages: [
        { role: 'system', content: `Vytěž strukturovaný handover dle šablony ${templateFor(c).title}. U každé sekce uveď zdroj.` },
        { role: 'user', content: JSON.stringify({ src: this.getAttribute('src'), sources: c.sources, uploads: (c.uploads || []).map((u) => u.name) }) },
      ],
    }).then((r) => { this.loading = false; setHandoverDraft(this.caseId, r); })
      .catch((e) => { this.loading = false; this.error = e.message; this.update(); });
  }

  render() {
    const c = getCase(this.caseId);
    this.ensureDraft(c);
    return this.hasAttribute('compact') ? this.renderCompact(c) : this.renderFull(c);
  }

  copyBtn(s) {
    const done = this.copied === s.id;
    return html`<button class="btn sm" type="button" data-action="copy" data-id="${s.id}" data-key="copy-${s.id}" aria-label="Kopírovat sekci ${s.title}">
      ${icon(done ? 'check' : 'copy')}${done ? 'Zkopírováno' : 'Kopírovat'}</button>`;
  }

  renderFull(c) {
    const h = c.handover;
    const confirmed = c.phase !== 'draft';
    const editable = this.hasAttribute('editable') && !confirmed;
    return html`
      <section class="card" aria-labelledby="ho-h" aria-busy="${!h}">
        <div class="card-head">
          <div class="title-row">
            <div class="row"><span class="pill ai">${icon('spark')}AI návrh</span>${confirmed ? html`<span class="pill ok">${icon('check')}potvrzen</span>` : ''}</div>
            <h2 id="ho-h">Strukturovaný handover</h2>
          </div>
          <span class="muted small">Šablona: ${templateFor(c).title}</span>
        </div>
        ${!h ? html`<div class="loading" aria-live="polite">
            <p class="banner ai">${icon('spark')}${this.error ? `Vytěžení selhalo: ${this.error}` : 'AI vytěžuje dokumentaci (FHIR + epikríza)…'}</p>
            <div class="skeleton"><span></span><span style="width:80%"></span><span style="width:60%"></span><span></span><span style="width:70%"></span></div>
          </div>` : html`
          ${h.sections.map((s) => html`<div class="sec">
            <div class="sec-head"><h3 id="s-${s.id}">${s.title}</h3>${this.copyBtn(s)}</div>
            ${this.editing === s.id ? html`
              <label class="sr-only" for="ta-${s.id}">Upravit: ${s.title}</label>
              <textarea id="ta-${s.id}" data-key="ta-${s.id}" class="${s.mono ? 'mono' : ''}">${this.draft ?? s.text}</textarea>
              <div class="edit-actions"><button class="btn sm" type="button" data-action="cancel">Zrušit</button><button class="btn sm primary" type="button" data-action="save" data-id="${s.id}">Uložit úpravu</button></div>`
            : html`<p class="text ${s.mono ? 'mono' : ''}" ${editable ? html`role="button" tabindex="0" data-action="edit" data-id="${s.id}" data-key="txt-${s.id}" aria-label="${s.title}: ${s.text}. Upravit text"` : ''}>${s.text}</p>`}
            <p class="source">Zdroj: ${s.source}${s.editedBy ? html` · <span class="edited">upraveno lékařem</span>` : ''}</p>
            ${this.flags(s)}
          </div>`)}
          <p class="note prov">${icon('spark')}<span>${confirmed
            ? `Návrh ${h.provenance?.draftedBy || 'llm:' + h.model} · ověřil(a) ${h.provenance?.verifiedBy} · ${fmtDate(c.submittedAt)}`
            : `Návrh připravil model ${h.model}${h.latencyMs ? ` za ${h.latencyMs} ms` : ''} · klikněte na text pro úpravu · rozhoduje lékař`}</span></p>`}
      </section>`;
  }

  /** Rule/AI flags of a section (missing / conflicting data, notes); text labels, not colour only. */
  flags(s) {
    if (!s.flags?.length) return '';
    return html`<span class="flags">${s.flags.map((f) => html`<span class="flag ${f.kind}"><b>${FLAG[f.kind] || 'pozn.'}:</b><span>${f.text}</span></span>`)}</span>`;
  }

  flagSummary(h) {
    const all = h.sections.flatMap((s) => s.flags || []);
    const n = (k) => all.filter((f) => f.kind === k).length;
    if (!n('missing') && !n('conflict')) return '';
    return html`<p class="flagsum">${n('missing') ? html`<span class="pill miss">${icon('alert')}chybí ${n('missing')}</span>` : ''}${n('conflict')
      ? html`<span class="pill warn">${icon('alert')}nesoulad ${n('conflict')} – ověřit</span>` : ''}${h.asOf ? html`<span class="muted small">stav k ${fmtDate(h.asOf, { year: true })}</span>` : ''}</p>`;
  }

  renderCompact(c) {
    const h = c.handover;
    if (!h || c.phase === 'draft') {
      return html`<section class="card"><div class="card-head"><h2>Handover od lékaře</h2></div><p class="empty">Handover zatím nedorazil.</p></section>`;
    }
    const originals = [...(h.originals || []), ...(c.uploads || []).map((u) => u.name)];
    return html`
      <section class="card compact" aria-labelledby="hc-h">
        <div class="card-head">
          <h2 id="hc-h">Handover od lékaře</h2>
          <div class="row"><span class="pill ok">${icon('check')}potvrzen</span><span class="pill ai">AI návrh</span></div>
        </div>
        ${this.flagSummary(h)}
        <ul>${h.sections.map((s) => html`<li><span><span>${s.title}${s.editedBy ? html` <span class="small edited">· upraveno</span>` : ''}</span>${this.flags(s)}</span>${this.copyBtn(s)}</li>`)}</ul>
        <p class="originals">Originály: ${originals.join(' · ')}</p>
        <p class="source" style="margin-top:4px">Ověřil(a) ${h.provenance?.verifiedBy} · návrh ${h.provenance?.draftedBy}</p>
      </section>`;
  }

  async onClick(e, el, action) {
    const c = getCase(this.caseId);
    if (action === 'copy') {
      const s = c.handover.sections.find((x) => x.id === el.dataset.id);
      await copyText(`${s.title}\n${s.text}\nZdroj: ${s.source}`);
      this.copied = s.id;
      this.update();
      clearTimeout(this._copyT);
      this._copyT = setTimeout(() => { this.copied = null; this.update(); }, 2000);
    }
    if (action === 'edit') {
      this.editing = el.dataset.id;
      this.draft = null;
      this.update();
      const ta = this.$('textarea');
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
    if (action === 'cancel') this.stopEdit();
    if (action === 'save') {
      const id = this.editing;
      const text = this.$('textarea').value.trim();
      this.editing = null;
      this.draft = null;
      editHandoverSection(this.caseId, id, text);
      this.update();
      this.$(`[data-key="txt-${id}"]`)?.focus();
    }
  }

  stopEdit() {
    const id = this.editing;
    this.editing = null;
    this.draft = null;
    this.update();
    this.$(`[data-key="txt-${id}"]`)?.focus();
  }

  onInput(e) { if (e.target.tagName === 'TEXTAREA') this.draft = e.target.value; }

  onKeydown(e) {
    if (e.target.tagName === 'TEXTAREA' && e.key === 'Escape') this.stopEdit();
  }
}
customElements.define('handover-panel', HandoverPanel);
