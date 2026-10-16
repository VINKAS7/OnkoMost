import { KocElement } from './lib/base.js';
import { html } from './lib/html.js';
import { icon } from './lib/icons.js';
import { getCase, templateFor } from './lib/store.js';
import { markReviewed } from './lib/actions.js';
import { fmtDate, isOverdue, currentScreen } from './lib/dates.js';

const PHASE_PILL = {
  submitted: ['accent', 'nový'], active: ['ok', 'aktivní'], postponed: ['warn', 'odložený'],
  'closed-pending-ack': ['warn', 'čeká na potvrzení PL'], closed: ['ok', 'uzavřeno'], draft: ['', 'koncept'],
};

class CaseHeader extends KocElement {
  static styles = `
    .top { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: flex-start; }
    h1 { font-size: 22px; }
    .pills { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .line { margin-top: 10px; color: var(--muted); font-size: 14px; }
  `;

  render() {
    const c = getCase(this.caseId);
    const role = this.getAttribute('role') || 'koordinator';
    const name = `${c.patient.name}, ${c.patient.age} let`;
    if (role === 'revizni') {
      const checked = c.review?.status === 'checked';
      return html`<section class="card">
        <div class="top">
          <div>
            <h1>${name}</h1>
            <div class="pills">
              ${c.timeline.ack ? html`<span class="pill ok">${icon('check')}předání potvrzeno</span>` : html`<span class="pill warn">čeká na potvrzení PL</span>`}
              <span class="pill mono">${c.patient.birthNumberMasked} · VZP ${c.patient.insurer}</span>
              ${checked ? html`<span class="pill ok">zkontrolováno</span>` : ''}
            </div>
          </div>
          <div class="actions">
            <button class="btn" type="button" data-action="ask">Vyžádat doplnění</button>
            <button class="btn primary" type="button" data-action="review" data-key="review" ${checked ? 'disabled' : ''}>${icon('check')}${checked ? 'Zkontrolováno' : 'Označit jako zkontrolováno'}</button>
          </div>
        </div>
        <p class="line">KOC VFN Praha – HPB · koordinátorka Bc. Petra Malá · referující MUDr. Jana Dvořáková (PL Benešov) · informace doručena automaticky ${fmtDate(c.timeline.ack || c.sentAt)}</p>
      </section>`;
    }
    if (role === 'mdt') {
      // ECOG either answered explicitly or already stated in the confirmed handover.
      const ecog = c.values?.ecog?.value ?? (c.handover?.sections || []).map((s) => s.text).join(' ').match(/\bECOG (\d)/)?.[1];
      const decided = c.mdt.find((m) => m.decision);
      const mdtTask = c.tasks.find((t) => t.id === 'mdt1');
      return html`<section class="card">
        <div class="top">
          <div>
            <h1>${name}</h1>
            <div class="pills">
              <span class="pill ${decided ? 'ok' : 'accent'}">${decided ? `rozhodnuto ${fmtDate(decided.date, { time: false })}` : `projednání ${mdtTask ? fmtDate(mdtTask.due) : ''}`}</span>
              <span class="pill mono">${c.diagnosis ? c.diagnosis.split(' ')[0] : `${c.serviceRequest.reasonCode} susp.`}</span>
              ${ecog != null ? html`<span class="pill mono">ECOG ${ecog}</span>` : html`<span class="pill warn">ECOG chybí</span>`}
              <span class="pill mono">${c.patient.birthNumberMasked}</span>
            </div>
          </div>
        </div>
        <p class="line">${templateFor(c).board || 'MDT HPB'}, KOC VFN Praha · předkládá Bc. Petra Malá (koordinátorka) · referující ${c.serviceRequest.requester}, ${c.serviceRequest.requesterOrg} · ${c.patient.summary}</p>
      </section>`;
    }
    const overdue = c.tasks.some((t) => isOverdue(t, currentScreen()));
    const [tone, label] = overdue && c.phase === 'active' ? ['miss', 'po termínu'] : PHASE_PILL[c.phase];
    const hospital = c.tasks.find((t) => t.id === 'hospital' && t.status === 'done');
    const active = c.phase === 'active';
    return html`<section class="card">
      <div class="top">
        <div>
          <h1>${name}</h1>
          <div class="pills"><span class="pill ${tone}">${label}</span><span class="pill mono">${c.patient.birthNumberMasked}</span></div>
        </div>
        <div class="actions">
          <button class="btn sm" type="button" data-action="write">${icon('message')}Napsat lékaři</button>
          <button class="btn sm" type="button" data-action="sms">${icon('phone')}SMS pacientovi</button>
          <button class="btn sm" type="button" data-action="task" ${active ? '' : 'disabled'}>${icon('plus')}Úkol</button>
        </div>
      </div>
      <p class="line">${c.serviceRequest.reasonCode} susp. · referoval(a) ${c.serviceRequest.requester}, ${c.serviceRequest.requesterOrg} · ${fmtDate(c.timeline.referral, { year: true })}${hospital ? ' · hospitalizován Interna VFN' : ''}</p>
    </section>`;
  }

  onClick(e, el, action) {
    const fire = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));
    if (action === 'write') fire('koc:compose', { to: 'gp' });
    if (action === 'sms') fire('koc:compose', { to: 'patient' });
    if (action === 'task') fire('koc:add-task', {});
    if (action === 'ask') fire('koc:focus-question', {});
    if (action === 'review') markReviewed(this.caseId);
  }
}
customElements.define('case-header', CaseHeader);
