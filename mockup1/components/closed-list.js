import { KocElement } from './lib/base.js';
import { html } from './lib/html.js';
import { getCase, getData, templateFor } from './lib/store.js';
import { deriveIndicators } from './lib/derive.js';
import { toast } from './lib/toast.js';
import { fmtDate } from './lib/dates.js';

const STATE = { new: ['accent', 'nový'], question: ['warn', 'dotaz otevřen'], checked: ['ok', 'zkontrolováno'] };

class ClosedList extends KocElement {
  static styles = `
    ul { display: grid; gap: 8px; }
    li { border: 1px solid var(--line); border-radius: var(--radius-ctl); }
    li.sel { border: 2px solid var(--accent); }
    button { display: grid; gap: 4px; width: 100%; text-align: left; background: none; border: 0; padding: 12px; font: inherit; color: inherit; cursor: pointer; border-radius: var(--radius-ctl); }
    li.sel button { padding: 11px; }
    button:hover { background: #FAFAF8; }
    .top { display: flex; justify-content: space-between; gap: 8px; align-items: center; flex-wrap: wrap; }
    .name { font-weight: 600; }
    .line { font-size: 13.5px; color: var(--muted); }
    .line strong { color: var(--ink); }
  `;

  render() {
    const d = getData();
    const c = getCase('novak');
    const ind = deriveIndicators(c, templateFor(c));
    const items = d.closed.cases.map((x) => (x.live ? {
      ...x, state: c.review?.status || 'new', closed: (c.timeline.ack || x.closed).slice(0, 10),
      lineHtml: html`Čas do léčby <strong>${ind.tt} dní</strong> · ${c.mdt.length}× MDT`,
    } : x));
    const fresh = items.filter((x) => x.state !== 'checked').length;
    return html`
      <section class="card" aria-labelledby="cl-h">
        <div class="card-head"><h2 id="cl-h">Nově předané z KOC</h2><span class="pill accent">${fresh} nové</span></div>
        <ul>
          ${items.map((x) => {
            const [tone, label] = STATE[x.state];
            const sel = x.id === 'novak';
            return html`<li class="${sel ? 'sel' : ''}"><button type="button" data-action="select" data-id="${x.id}" aria-pressed="${sel}">
              <span class="top"><span class="name">${x.name}, ${x.age}</span><span class="pill ${tone}">${label}</span></span>
              <span class="line"><span class="mono">${x.dg}</span> · ${x.koc} · uzavřeno ${fmtDate(x.closed)}</span>
              ${x.lineHtml ? html`<span class="line">${x.lineHtml}</span>` : x.line ? html`<span class="line">${x.line}</span>` : ''}
            </button></li>`;
          })}
        </ul>
      </section>`;
  }

  onClick(e, el, action) {
    if (action === 'select' && el.dataset.id !== 'novak') toast('Detail je v demu k dispozici jen pro pana Nováka.');
  }
}
customElements.define('closed-list', ClosedList);
