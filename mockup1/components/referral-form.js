import { KocElement } from './lib/base.js';
import { html } from './lib/html.js';
import { icon } from './lib/icons.js';
import { getCase } from './lib/store.js';
import { loadJSON } from './lib/data.js';
import { updateServiceRequest } from './lib/actions.js';
import { fmtDate } from './lib/dates.js';

// Screen 1 form: target KOC + patient (prefilled from FHIR) + the only 2 manual fields.
class ReferralForm extends KocElement {
  static styles = `
    :host { display: grid; gap: 16px; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .full { grid-column: 1 / -1; }
    @media (max-width: 560px) { .grid { grid-template-columns: minmax(0, 1fr); } }
    .hint { font-size: 13px; color: var(--muted); margin-top: 6px; }
    .manual-head { display: flex; gap: 8px; align-items: center; margin: 4px 0 -4px; }
    .lbl-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .lbl-row label { margin: 0 0 4px; }
    .tag { font-size: 11.5px; font-weight: 600; color: var(--warn); }
    .foot { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--line); font-size: 13px; color: var(--muted); }
    .foot strong { color: var(--ink); }
    .divider { grid-column: 1 / -1; border-top: 1px solid var(--line); margin: 4px 0 0; }
  `;

  init() {
    if (!this.kocs) loadJSON('data/koc-list.json').then((l) => { this.kocs = l; this.update(); });
  }

  render() {
    const c = getCase(this.caseId);
    const sr = c.serviceRequest;
    const p = c.patient;
    const locked = c.phase !== 'draft';
    const ro = locked ? html`readonly aria-readonly="true"` : '';
    return html`
      <section class="card" aria-labelledby="koc-h">
        <div class="card-head"><h2 id="koc-h">Cílové centrum</h2><span class="pill accent">doporučeno</span></div>
        <label for="koc">Komplexní onkologické centrum</label>
        <select id="koc" data-key="koc" data-action="koc" ${locked ? 'disabled' : ''}>
          ${(this.kocs || [{ id: sr.koc, label: 'Načítám…' }]).map((k) => html`<option value="${k.id}" ${k.id === sr.koc ? 'selected' : ''}>${k.label}</option>`)}
        </select>
        <p class="hint">Doporučeno podle suspektní diagnózy C25 a spádovosti · případ přijde koordinátorovi, ne do e-mailu</p>
      </section>

      <section class="card" aria-labelledby="pt-h">
        <div class="card-head"><h2 id="pt-h">Pacient a referující lékař</h2><span class="pill ok">${icon('check')}převzato z FHIR</span></div>
        <div class="grid">
          <div><label for="pt">Pacient</label><input id="pt" class="prefilled" readonly value="${p.name}, nar. ${fmtDate(p.birthDate, { year: true })}"></div>
          <div><label for="rc">Rodné číslo</label><input id="rc" class="prefilled mono" readonly value="${p.birthNumberMasked}"></div>
          <div><label for="ins">Pojišťovna</label><input id="ins" class="prefilled" readonly value="${p.insurerLabel}"></div>
          <div><label for="tel">Telefon</label><input id="tel" class="prefilled mono" readonly value="${p.phoneMasked}"></div>
          <div class="divider" role="presentation"></div>
          <div class="full">
            <div class="lbl-row"><label for="dx">Suspektní diagnóza</label><span class="tag">vyplňte ručně · 1/2</span></div>
            <input id="dx" data-key="dx" data-action="dx" value="${sr.reasonText}" ${ro} autocomplete="off">
          </div>
          <div class="full">
            <div class="lbl-row"><label for="why">Důvod a naléhavost</label><span class="tag">vyplňte ručně · 2/2</span></div>
            <textarea id="why" data-key="why" data-action="why" rows="3" ${ro}>${sr.note}</textarea>
          </div>
        </div>
        <p class="foot">Referující lékař: <strong>${sr.requester}</strong> · praktický lékař, Benešov · IČP <span class="mono">39 112 004</span> <span class="muted">(z profilu)</span></p>
      </section>`;
  }

  onChange(e, el, action) {
    if (action === 'koc') updateServiceRequest(this.caseId, { koc: el.value });
    if (action === 'dx') updateServiceRequest(this.caseId, { reasonText: el.value, reasonCode: (el.value.match(/^[A-Z]\d{2}(\.\d)?/) || [''])[0] });
    if (action === 'why') updateServiceRequest(this.caseId, { note: el.value });
  }
}
customElements.define('referral-form', ReferralForm);
