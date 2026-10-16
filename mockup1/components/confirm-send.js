import { KocElement } from './lib/base.js';
import { html } from './lib/html.js';
import { icon } from './lib/icons.js';
import { getCase } from './lib/store.js';
import { submitReferral } from './lib/actions.js';
import { toast } from './lib/toast.js';
import { fmtDate } from './lib/dates.js';

class ConfirmSend extends KocElement {
  static styles = `
    .actions { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; margin-top: 4px; }
    .note { margin-top: 12px; }
    .sent { display: grid; gap: 10px; }
    .sent .meta { font-size: 13px; color: var(--muted); }
    @media (max-width: 480px) { .actions .btn { flex: 1 1 100%; } }
  `;

  init() { this.ack ??= false; }

  render() {
    const c = getCase(this.caseId);
    if (c.phase !== 'draft') {
      const p = c.handover?.provenance || {};
      return html`<section class="card sent" aria-live="polite">
        <p class="banner ok">${icon('check')}<strong>Odesláno do KOC VFN · ${fmtDate(c.submittedAt, { year: true })}</strong></p>
        <p class="meta">Návrh: <span class="mono">${p.draftedBy}</span> · ověřil(a): ${p.verifiedBy}. Případ převezme koordinátorka KOC.</p>
        <a class="btn" href="#/koordinator">Otevřít obrazovku koordinátora ${icon('arrow')}</a>
      </section>`;
    }
    const ready = !!c.handover;
    return html`
      <section class="card" aria-label="Potvrzení a odeslání">
        <label class="check">
          <input type="checkbox" data-action="ack" data-key="ack" ${this.ack ? 'checked' : ''} ${ready ? '' : 'disabled'}>
          <span>Zkontroloval(a) jsem návrh AI a údaje odpovídají dokumentaci.</span>
        </label>
        <div class="actions">
          <button class="btn" type="button" data-action="save" data-key="save">Uložit koncept</button>
          <button class="btn primary" type="button" data-action="send" data-key="send" ${this.ack && ready ? '' : 'disabled'}
            aria-describedby="send-hint">Potvrdit a odeslat do KOC ${icon('arrow')}</button>
        </div>
        <p class="note" id="send-hint">${icon('spark')}<span>AI pouze připravuje návrh · rozhoduje a potvrzuje lékař.${ready ? '' : ' Čeká se na návrh AI…'}</span></p>
      </section>`;
  }

  onChange(e, el, action) {
    if (action === 'ack') { this.ack = el.checked; this.update(); }
  }

  onClick(e, el, action) {
    if (action === 'save') toast('Koncept uložen');
    if (action === 'send' && this.ack) {
      submitReferral(this.caseId);
      this.ack = false;
      toast('Odesláno do KOC VFN · případ čeká na převzetí koordinátorkou', { href: '#/koordinator', linkText: 'Obrazovka koordinátora' });
    }
  }
}
customElements.define('confirm-send', ConfirmSend);
