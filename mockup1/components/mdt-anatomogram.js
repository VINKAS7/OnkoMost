import { KocElement } from './lib/base.js';
import { getCase } from './lib/store.js';
import './onco-anatomogram/onco-anatomogram.js';

// Prototype wrapper around the standalone <onco-anatomogram> (components/onco-anatomogram/):
// points it at the case's board JSON (data/mdt-anatomogram-<case>.json) and passes which steps the
// case has reached, so findings appear as the work-up progresses. Organ sites of the medication are
// queried by <onco-anatomogram> from the bundled ADME SQLite.
class MdtAnatomogram extends KocElement {
  static styles = '';

  render() {
    const c = getCase(this.caseId);
    let el = this.shadowRoot.querySelector('onco-anatomogram');
    if (!el) {
      el = document.createElement('onco-anatomogram');
      el.setAttribute('lang', 'cs');
      if (this.hasAttribute('zoom')) el.setAttribute('zoom', this.getAttribute('zoom'));
      this.shadowRoot.append(el);
    }
    const src = this.getAttribute('src') || `data/mdt-anatomogram-${this.caseId}.json`;
    if (el.getAttribute('src') !== src) el.setAttribute('src', src);
    el.reached = [
      ...c.tasks.filter((t) => t.status === 'done').map((t) => `task:${t.id}`),
      ...c.mdt.map((m) => `mdt:${m.id}`),
    ];
    return undefined; // the child element renders itself; never replace it
  }
}
customElements.define('mdt-anatomogram', MdtAnatomogram);
