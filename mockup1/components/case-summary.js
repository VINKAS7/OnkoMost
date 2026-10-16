import { KocElement } from './lib/base.js';
import { html } from './lib/html.js';
import { icon } from './lib/icons.js';
import { getCase } from './lib/store.js';
import { completeJSON } from './lib/llm.js';
import { fmtDate } from './lib/dates.js';

let cached = null; // AI summary is generated once per page load

class CaseSummary extends KocElement {
  static styles = `
    dl { display: grid; grid-template-columns: minmax(110px, 150px) minmax(0, 1fr); margin: 0; }
    dt, dd { padding: 10px 0; border-top: 1px solid var(--line); margin: 0; }
    dt { font-weight: 600; font-size: 13.5px; color: var(--muted); padding-right: 12px; }
    dd { display: grid; gap: 2px; }
    dd.ph span:first-child { border: 1px dashed var(--warn); background: var(--warn-soft); color: var(--warn); border-radius: 6px; padding: 4px 8px; font-size: 13.5px; justify-self: start; }
    @media (max-width: 560px) { dl { grid-template-columns: minmax(0, 1fr); } dd { border-top: 0; padding-top: 0; } dt { padding-bottom: 4px; } }
    .prov { margin-top: 10px; }
  `;

  init() {
    if (!cached && !this.loading) {
      this.loading = true;
      completeJSON({ task: 'summarize-for-reviewer', messages: [{ role: 'user', content: 'Souhrn případu novak pro revizního lékaře ze zpráv MDT a referování.' }] })
        .then((r) => { cached = r; this.loading = false; this.update(); });
    }
  }

  render() {
    const c = getCase(this.caseId);
    const checked = c.review?.status === 'checked';
    return html`
      <section class="card" aria-labelledby="cs-h" aria-busy="${!cached}">
        <div class="card-head">
          <div><div class="row"><span class="pill ai">${icon('spark')}AI strukturace</span>${checked ? html`<span class="pill ok">${icon('check')}ověřeno</span>` : ''}</div>
            <h2 id="cs-h" style="margin-top:6px">Souhrn případu</h2></div>
          <span class="muted small">ze zpráv MDT a referování · ilustrativní data</span>
        </div>
        ${!cached ? html`<p class="banner ai" aria-live="polite">${icon('spark')}AI strukturuje souhrn…</p><div class="skeleton" style="margin-top:10px"><span></span><span style="width:75%"></span><span></span></div>` : html`
        <dl>${cached.data.rows.map((r) => html`<dt>${r.label}</dt><dd class="${r.placeholder ? 'ph' : ''}"><span>${r.text}</span>${r.source ? html`<span class="source">Zdroj: ${r.source}</span>` : ''}</dd>`)}</dl>
        <p class="note prov">${icon('spark')}<span>Návrh llm:${cached.model} (${cached.latencyMs} ms) · ${checked ? `ověřil ${c.review.by} ${fmtDate(c.review.at)}` : 'ověří revizní lékař tlačítkem „Označit jako zkontrolováno“'}</span></p>`}
      </section>`;
  }
}
customElements.define('case-summary', CaseSummary);
