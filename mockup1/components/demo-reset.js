import { KocElement } from './lib/base.js';
import { html } from './lib/html.js';
import { icon } from './lib/icons.js';
import { reset, getStoredCase } from './lib/store.js';
import { toast } from './lib/toast.js';

const PHASE = {
  draft: 'koncept u referujícího lékaře', submitted: 'odesláno do KOC', active: 'v koordinaci KOC',
  postponed: 'odložený', 'closed-pending-ack': 'závěr odeslán, čeká na potvrzení', closed: 'uzavřeno',
};

class DemoReset extends KocElement {
  static styles = `.wrap { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }`;
  render() {
    const phase = getStoredCase('novak')?.phase || 'draft';
    return html`<div class="wrap">
      <button class="btn primary" type="button" data-action="reset">${icon('refresh')}Reset demo</button>
      <span class="muted small">Aktuální stav případu Novák: <strong>${PHASE[phase]}</strong></span>
    </div>`;
  }
  onClick(e, el, action) {
    if (action === 'reset') { reset(); toast('Demo resetováno', { href: '#/gp', linkText: 'Začít: referující lékař' }); }
  }
}
customElements.define('demo-reset', DemoReset);
