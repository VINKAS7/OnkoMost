import { KocElement } from './lib/base.js';
import { html } from './lib/html.js';

// "Dokumentace" card with tabs; panels are slotted light-DOM components.
const TABS = [
  { id: 'fhir', label: 'FHIR server' },
  { id: 'upload', label: 'Nahrát soubory' },
  { id: 'sw', label: 'Z ambulantního SW' },
];

class DocSources extends KocElement {
  static styles = `
    [role="tablist"] { display: flex; gap: 4px; border-bottom: 1px solid var(--line); margin-bottom: 14px; overflow-x: auto; }
    [role="tab"] { font: inherit; font-size: 14px; font-weight: 600; color: var(--muted); background: none; border: 0; border-bottom: 3px solid transparent;
      padding: 0 12px; min-height: 44px; cursor: pointer; white-space: nowrap; margin-bottom: -1px; }
    [role="tab"][aria-selected="true"] { color: var(--accent); border-bottom-color: var(--accent); }
    [role="tab"]:hover { color: var(--ink); }
  `;

  init() { this.tab ??= 'fhir'; }

  render() {
    return html`
      <section class="card" aria-labelledby="doc-h">
        <div class="card-head"><h2 id="doc-h">Dokumentace</h2><span class="muted small">převezme se, nic se nepřepisuje</span></div>
        <div role="tablist" aria-label="Zdroj dokumentace">
          ${TABS.map((t) => html`<button role="tab" type="button" id="tab-${t.id}" data-action="tab" data-tab="${t.id}" data-key="tab-${t.id}"
            aria-selected="${t.id === this.tab}" aria-controls="panel-${t.id}" tabindex="${t.id === this.tab ? 0 : -1}">${t.label}</button>`)}
        </div>
        <div role="tabpanel" id="panel-fhir" aria-labelledby="tab-fhir" ${this.tab !== 'fhir' ? 'hidden' : ''}><slot name="fhir"></slot></div>
        <div role="tabpanel" id="panel-upload" aria-labelledby="tab-upload" ${this.tab !== 'upload' ? 'hidden' : ''}><slot name="upload"></slot></div>
        <div role="tabpanel" id="panel-sw" aria-labelledby="tab-sw" tabindex="0" ${this.tab !== 'sw' ? 'hidden' : ''}>
          <p class="empty">Import přímo z ambulantního software (např. přes FHIR / DASTA rozhraní dodavatele). V prototypu není zapojeno – použijte FHIR server nebo nahrání souborů.</p>
        </div>
      </section>`;
  }

  select(id, focus) {
    this.tab = id;
    this.update();
    if (focus) this.$(`#tab-${id}`).focus();
  }

  onClick(e, el, action) { if (action === 'tab') this.select(el.dataset.tab); }

  onKeydown(e, el, action) {
    if (action !== 'tab') return;
    const i = TABS.findIndex((t) => t.id === el.dataset.tab);
    const map = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 };
    if (!(e.key in map)) return;
    e.preventDefault();
    this.select(TABS[(map[e.key] + TABS.length) % TABS.length].id, true);
  }
}
customElements.define('doc-sources', DocSources);
