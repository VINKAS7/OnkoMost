import { KocElement } from './lib/base.js';
import { html } from './lib/html.js';
import { icon } from './lib/icons.js';
import { getCase } from './lib/store.js';
import { CASES } from './lib/cases.js';
import { sendMdtConclusion, acknowledgeCase } from './lib/actions.js';
import { completeJSON } from './lib/llm.js';
import { fmtDate } from './lib/dates.js';

// Step 04: upload MDT report -> AI structures conclusion -> coordinator reviews -> send to GP + reviewer.
class MdtUpload extends KocElement {
  static styles = `
    .fields { display: grid; gap: 12px; margin-top: 12px; }
    .file-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: end; }
    .file-row > div { flex: 1 1 220px; min-width: 0; }
    input[type="file"] { width: 100%; font: inherit; font-size: 14px; padding: 8px; border: 1px dashed var(--line-strong); border-radius: var(--radius-ctl); min-height: 44px; background: #FAFAF8; }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
    .step-tag { font-family: var(--font-mono); color: var(--muted); font-size: 13px; }
  `;

  init() { this.s ??= { file: null, loading: false, result: null, fields: null, ack: false }; }

  caseChanged() { this.s = { file: null, loading: false, result: null, fields: null, ack: false }; }

  render() {
    const c = getCase(this.caseId);
    const show = ['active', 'closed-pending-ack', 'closed'].includes(c.phase) && c.tasks.length;
    this.toggleAttribute('hidden', !show);
    if (!show) return '';
    const head = (pill) => html`<div class="card-head"><div><span class="step-tag">Krok 04 · Zpětná vazba</span><h2 id="mu-h">Nahrát zprávu z MDT</h2></div>${pill || ''}</div>`;

    if (c.phase === 'closed') {
      return html`<section class="card" aria-labelledby="mu-h">${head(html`<span class="pill ok">${icon('check')}uzavřeno</span>`)}
        <p class="banner ok">${icon('check')}Doručení potvrzeno PL ${fmtDate(c.timeline.ack)} · případ uzavřen${c.patient.insurer === '111' ? ' · revizní lékař informován automaticky' : ''}.</p>
        ${c.patient.insurer === '111' ? html`<p style="margin-top:12px"><a class="btn" href="#/revizni">Pohled revizního lékaře ${icon('arrow')}</a></p>` : ''}</section>`;
    }
    if (c.phase === 'closed-pending-ack') {
      return html`<section class="card" aria-labelledby="mu-h">${head(html`<span class="pill warn">čeká na potvrzení</span>`)}
        <p class="banner warn">${icon('clock')}Závěr odeslán ${fmtDate(c.sentAt)} ${c.serviceRequest.requesterDat}${c.patient.insurer === '111' ? ' a reviznímu lékaři VZP' : ''} · čeká se na potvrzení příjmu.</p>
        <p style="margin-top:12px"><button class="btn" type="button" data-action="sim-ack">Simulovat potvrzení PL</button></p></section>`;
    }

    const mdtTask = c.tasks.find((t) => t.id === 'mdt1');
    const s = this.s;
    if (mdtTask?.status !== 'done') {
      return html`<section class="card" aria-labelledby="mu-h">${head()}
        <p class="empty">Dostupné po dokončení úkolu „${mdtTask?.title || '1. MDT'}“. Závěr se pak automaticky vrátí referujícímu i reviznímu lékaři.</p></section>`;
    }
    if (!CASES[this.caseId].mdtReport) {
      return html`<section class="card" aria-labelledby="mu-h">${head()}
        <p class="empty">Ukázková zpráva z MDT a její strukturování nejsou pro tuto pacientku v demu připravené.</p></section>`;
    }
    const reviewer = c.patient.insurer === '111';
    return html`<section class="card" aria-labelledby="mu-h">${head(s.fields ? html`<span class="pill ai">${icon('spark')}AI návrh</span>` : '')}
      <div class="file-row">
        <div><label for="mdt-file">Zpráva z MDT (PDF, DOCX, TXT)</label><input id="mdt-file" type="file" accept=".pdf,.doc,.docx,.txt" data-action="file" data-key="file"></div>
        <button class="btn" type="button" data-action="sample" data-key="sample">${icon('file')}Ukázková zpráva</button>
        <button class="btn primary" type="button" data-action="structure" data-key="structure" ${s.file && !s.loading ? '' : 'disabled'}>${icon('spark')}${s.loading ? 'AI strukturuje…' : 'AI: strukturovat závěr'}</button>
      </div>
      ${s.file ? html`<p class="source" style="margin-top:6px">Vybraný soubor: ${s.file}</p>` : ''}
      ${s.loading ? html`<div class="skeleton" style="margin-top:12px" aria-live="polite"><span></span><span style="width:70%"></span><span></span></div>` : ''}
      ${s.fields ? html`<div class="fields">
        <p class="banner ai">${icon('spark')}Návrh strukturovaného závěru (model ${s.result.model}, ${s.result.latencyMs} ms) · zkontrolujte a upravte před odesláním.</p>
        ${[['diagnosis', 'Diagnóza', 2], ...s.result.data.mdt.map((m, i) => [`mdt${i}`, `Závěr ${m.title} (${fmtDate(m.date)})`, 3]), ['plan', 'Plán léčby / doporučení', 4]]
          .map(([k, label, rows]) => html`<div><label for="f-${k}">${label}</label><textarea id="f-${k}" data-field="${k}" data-key="f-${k}" rows="${rows}">${s.fields[k]}</textarea></div>`)}
        <p class="source">Zdroj: ${s.file}</p>
        <label class="check"><input type="checkbox" data-action="ack" data-key="ack" ${s.ack ? 'checked' : ''}><span>Zkontrolovala jsem strukturovaný závěr a odpovídá zprávě z MDT.</span></label>
        <div class="actions"><button class="btn primary" type="button" data-action="send" data-key="send" ${s.ack ? '' : 'disabled'}>${icon('send')}Odeslat referujícímu${reviewer ? ' a reviznímu' : ''} lékaři</button></div>
      </div>` : ''}
    </section>`;
  }

  async structure() {
    const s = this.s;
    s.loading = true;
    this.update();
    const r = await completeJSON({ task: 'structure-mdt', messages: [{ role: 'user', content: JSON.stringify({ caseId: this.caseId, file: s.file }) }] });
    s.loading = false;
    s.result = r;
    s.fields = { diagnosis: r.data.diagnosis, plan: r.data.treatment.plan };
    r.data.mdt.forEach((m, i) => { s.fields[`mdt${i}`] = m.conclusion; });
    this.update();
  }

  onClick(e, el, action) {
    if (action === 'sample') { this.s.file = `${CASES[this.caseId].mdtDoc || 'Zprava_MDT_HPB_Novak.pdf'} (ukázka)`; this.update(); }
    if (action === 'structure') this.structure();
    if (action === 'sim-ack') acknowledgeCase(this.caseId);
    if (action === 'send' && this.s.ack) {
      const { data, model } = this.s.result;
      const f = this.s.fields;
      const structured = structuredClone(data);
      structured.diagnosis = f.diagnosis;
      structured.mdt.forEach((m, i) => { m.conclusion = f[`mdt${i}`]; });
      structured.treatment.plan = f.plan;
      structured.source = this.s.file;
      this.s = { file: null, loading: false, result: null, fields: null, ack: false };
      sendMdtConclusion(this.caseId, structured, model);
    }
  }

  onChange(e, el, action) {
    if (action === 'file') { this.s.file = el.files[0]?.name || null; this.update(); }
    if (action === 'ack') { this.s.ack = el.checked; this.update(); }
  }

  onInput(e) {
    const k = e.target.dataset.field;
    if (k) this.s.fields[k] = e.target.value;
  }
}
customElements.define('mdt-upload', MdtUpload);
