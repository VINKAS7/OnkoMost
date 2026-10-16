import { KocElement } from './lib/base.js';
import { html } from './lib/html.js';
import { getData } from './lib/store.js';
import { adjustedTotals } from './case-queue.js';

class KpiStrip extends KocElement {
  static styles = `
    ul { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
    li { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-card); padding: 12px 14px; }
    .v { font-size: 26px; font-weight: 600; font-family: var(--font-mono); line-height: 1.2; }
    .v small { font-size: 15px; font-family: var(--font-sans); font-weight: 500; }
    .k { font-size: 13px; color: var(--muted); font-weight: 600; }
    li.over { background: var(--miss-soft); border-color: #EDB8B3; }
    li.over .v, li.over .k { color: var(--miss); }
  `;

  render() {
    const q = getData().queue;
    const t = adjustedTotals(q);
    const items = [
      ['Nový', t.new], ['Aktivní', t.active], ['Odložený', t.postponed], ['Po termínu', t.overdue, 'over'],
      ['Medián času do MDT', q.medianDaysToMdt, '', 'dní'],
    ];
    return html`<ul aria-label="Přehled pracovní fronty">
      ${items.map(([k, v, cls, unit]) => html`<li class="${cls || ''}"><div class="k">${k}</div><div class="v">${v}${unit ? html` <small>${unit}</small>` : ''}</div></li>`)}
    </ul>`;
  }
}
customElements.define('kpi-strip', KpiStrip);
