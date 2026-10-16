import { KocElement } from './lib/base.js';
import { html } from './lib/html.js';
import { icon } from './lib/icons.js';
import { getCase } from './lib/store.js';
import { acknowledgeCase } from './lib/actions.js';
import { fmtDate } from './lib/dates.js';

// Step 04 on the GP side: MDT result with the original referral context; GP confirms receipt.
class GpFeedback extends KocElement {
  static styles = `
    dl { display: grid; grid-template-columns: minmax(110px, 160px) minmax(0, 1fr); gap: 8px 16px; margin: 0; }
    dt { font-weight: 600; color: var(--muted); font-size: 13.5px; }
    dd { margin: 0; }
    @media (max-width: 560px) { dl { grid-template-columns: minmax(0, 1fr); } dt { margin-top: 6px; } }
    details { margin-top: 14px; border-top: 1px solid var(--line); padding-top: 10px; }
    summary { cursor: pointer; font-weight: 600; min-height: 36px; display: flex; align-items: center; }
    details ul { display: grid; gap: 8px; margin-top: 8px; font-size: 14px; }
    .foot { margin-top: 14px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; justify-content: space-between; }
  `;

  render() {
    const c = getCase(this.caseId);
    const show = c.phase === 'closed-pending-ack' || c.phase === 'closed';
    this.toggleAttribute('hidden', !show);
    if (!show) return '';
    const done = c.phase === 'closed';
    return html`
      <section class="card" aria-labelledby="fb-h">
        <div class="card-head">
          <div><h2 id="fb-h">Zpětná vazba z KOC VFN</h2><p class="muted small">závěr MDT k vašemu referování z ${fmtDate(c.timeline.referral, { year: true })}</p></div>
          <div class="row"><span class="pill ai">AI strukturace</span>${done ? html`<span class="pill ok">${icon('check')}potvrzen</span>` : html`<span class="pill warn">čeká na vaše potvrzení</span>`}</div>
        </div>
        <dl>
          <dt>Diagnóza</dt><dd>${c.diagnosis}</dd>
          ${c.mdt.map((m) => html`<dt>${m.title} ${fmtDate(m.date)}</dt><dd>${m.conclusion}</dd>`)}
          <dt>Plán léčby</dt><dd>${c.treatment?.plan}</dd>
        </dl>
        <p class="source" style="margin-top:8px">Strukturoval ${c.mdtProvenance?.draftedBy} · ověřila ${c.mdtProvenance?.verifiedBy}</p>
        <details>
          <summary>Původní kontext referování (váš handover)</summary>
          <ul>${(c.handover?.sections || []).map((s) => html`<li><strong>${s.title}:</strong> ${s.text}</li>`)}</ul>
        </details>
        <div class="foot">
          ${done ? html`<p class="banner ok">${icon('check')}Převzetí potvrzeno ${fmtDate(c.timeline.ack)} · informace doručena i reviznímu lékaři</p>`
            : html`<span class="muted small">Revizní lékař VZP je informován automaticky.</span>
              <button class="btn primary" type="button" data-action="ack">${icon('check')}Potvrdit převzetí informace</button>`}
        </div>
      </section>`;
  }

  onClick(e, el, action) { if (action === 'ack') acknowledgeCase(this.caseId); }
}
customElements.define('gp-feedback', GpFeedback);
