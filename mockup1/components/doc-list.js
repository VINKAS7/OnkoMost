import { KocElement } from './lib/base.js';
import { html } from './lib/html.js';
import { icon } from './lib/icons.js';
import { getData, getCase } from './lib/store.js';
import { toast } from './lib/toast.js';

class DocList extends KocElement {
  static styles = `
    li { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-top: 1px solid var(--line); }
    li:first-child { border-top: 0; }
    li .icon { color: var(--muted); }
    .name { flex: 1; min-width: 0; overflow-wrap: anywhere; font-size: 14px; }
  `;

  render() {
    const docs = getData().closed.novak.documents;
    const c = getCase(this.caseId);
    const extra = c.mdtProvenance?.source && !/ukázka/.test(c.mdtProvenance.source) ? [{ name: c.mdtProvenance.source }] : [];
    return html`<section class="card" aria-labelledby="dl-h">
      <div class="card-head"><h2 id="dl-h">Dokumenty</h2><span class="muted small">ilustrativní</span></div>
      <ul>${[...docs, ...extra].map((d) => html`<li>${icon('file')}<span class="name">${d.name}</span>
        <button class="btn sm ghost" type="button" data-action="open" aria-label="Otevřít ${d.name}">Otevřít</button></li>`)}</ul>
    </section>`;
  }

  onClick(e, el, action) { if (action === 'open') toast('Ilustrativní dokument – v prototypu není k dispozici.'); }
}
customElements.define('doc-list', DocList);
