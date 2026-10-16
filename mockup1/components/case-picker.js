import { KocElement } from './lib/base.js';
import { html } from './lib/html.js';
import { getCase, getSelected, setSelected } from './lib/store.js';
import { CASE_IDS, CASES } from './lib/cases.js';
import { currentScreen } from './lib/dates.js';

// Switches which demo case the case-id="selected" components on this screen show (MDT program).
class CasePicker extends KocElement {
  static styles = `
    ul { display: flex; gap: 8px; flex-wrap: wrap; }
    li { flex: 1 1 260px; min-width: 0; }
    button { width: 100%; display: grid; gap: 2px; text-align: left; font: inherit; color: inherit; cursor: pointer; min-height: 44px;
      background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-ctl); padding: 10px 12px; }
    button:hover { background: #FAFAF8; }
    button[aria-pressed="true"] { border: 2px solid var(--accent); padding: 9px 11px; }
    .name { font-weight: 600; }
    .line { font-size: 13.5px; color: var(--muted); }
  `;

  render() {
    const screen = currentScreen();
    const selected = getSelected(screen);
    return html`<section class="card" aria-labelledby="cp-h">
      <div class="card-head"><h2 id="cp-h">Program konzilií</h2><span class="muted small">vyberte pacienta</span></div>
      <ul>${CASE_IDS.map((id) => {
        const c = getCase(id, screen);
        return html`<li><button type="button" data-action="pick" data-id="${id}" data-key="pick-${id}" aria-pressed="${id === selected}">
          <span class="name">${c.patient.name}, ${c.patient.age}</span>
          <span class="line"><span class="mono">${c.serviceRequest.reasonCode}</span> · ${CASES[id].mdtLabel}</span>
        </button></li>`;
      })}</ul>
    </section>`;
  }

  onClick(e, el, action) {
    if (action === 'pick') setSelected(currentScreen(), el.dataset.id);
  }
}
customElements.define('case-picker', CasePicker);
