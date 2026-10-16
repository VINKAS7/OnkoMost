import { KocElement } from './lib/base.js';
import { icon } from './lib/icons.js';
import { loadJSON } from './lib/data.js';
import { getCase } from './lib/store.js';
import { caseState } from './lib/dx-case-state.js';
import './onco-dx-pathway/onco-dx-pathway.js';

// Prototype wrapper around the standalone <onco-dx-pathway> (components/onco-dx-pathway/): loads
// data/dx-map-<case>.json, which names the case's pathway (data/dx-pathway-*.json) and says how the case's tasks,
// values, handover and MDT record map onto pathway steps (lib/dx-case-state.js), and passes the resulting state.
// Rule-based, no AI.
class DxPathway extends KocElement {
  static styles = `.missing { margin: 0; }`;

  /** Load the case's map once; re-render when it arrives. */
  map(id) {
    this.cache ||= {};
    if (!(id in this.cache)) {
      this.cache[id] = null;
      loadJSON(`data/dx-map-${id}.json`).catch(() => ({ missing: true })).then((m) => { this.cache[id] = m; this.update(); });
    }
    return this.cache[id];
  }

  render() {
    const c = getCase(this.caseId);
    const mode = this.getAttribute('mode') || 'full'; // full (koordinator) | compact (mdt) | gp
    const map = this.map(this.caseId);
    let el = this.shadowRoot.querySelector('onco-dx-pathway');
    let note = this.shadowRoot.querySelector('.missing');
    if (!el) {
      el = document.createElement('onco-dx-pathway');
      el.setAttribute('lang', 'cs');
      el.setAttribute('mode', mode);
      if (mode === 'gp') {
        const p = document.createElement('p');
        p.slot = 'footer';
        p.className = 'note';
        p.style.marginTop = '6px';
        p.innerHTML = `${icon('file')}<span>Co můžete doplnit vy, je v seznamu „Co v dokumentaci chybí“.</span>`;
        el.append(p);
      }
      note = document.createElement('section');
      note.className = 'card missing';
      note.hidden = true;
      this.shadowRoot.append(el, note);
    }
    if (map?.missing) {
      el.hidden = true;
      note.hidden = mode === 'gp';
      note.innerHTML = `<h2>Diagnostická cesta</h2><p class="note" style="margin-top:8px">${icon('alert')}<span></span></p>`;
      note.querySelector('span').textContent = `Pro diagnózu ${c.serviceRequest?.reasonCode || ''} zatím není diagnostická cesta připravena (k dispozici: C22.0 hepatocelulární karcinom, C25 karcinom pankreatu, C56–57 karcinom ovaria a tuby).`;
      return undefined;
    }
    el.hidden = false;
    note.hidden = true;
    if (map) {
      if (el.getAttribute('src') !== map.pathway) el.setAttribute('src', map.pathway);
      if (this.lastCase !== this.caseId) { this.lastCase = this.caseId; el.select(null); }
      const { state, from } = caseState(c, map);
      el.provenance = from;
      el.state = state;
    }
    return undefined; // the child element renders itself; never replace it
  }
}
customElements.define('dx-pathway', DxPathway);
