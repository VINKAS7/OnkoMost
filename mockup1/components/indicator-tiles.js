import { KocElement } from './lib/base.js';
import { html } from './lib/html.js';
import { getCase, templateFor } from './lib/store.js';
import { deriveIndicators } from './lib/derive.js';
import { fmtDate, days } from './lib/dates.js';

// Indicators computed from the case timeline (not hard-coded).
class IndicatorTiles extends KocElement {
  static styles = `
    .head { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
    ul { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
    li { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-card); padding: 12px 14px; display: grid; gap: 2px; align-content: start; }
    li.main { background: var(--accent-soft); border-color: transparent; }
    li.main .v { color: var(--accent); }
    .k { font-size: 13px; color: var(--muted); font-weight: 600; }
    .v { font-size: 24px; font-weight: 600; font-family: var(--font-mono); line-height: 1.25; }
    .s { font-size: 12.5px; color: var(--muted); }
  `;

  render() {
    const c = getCase(this.caseId);
    const i = deriveIndicators(c, templateFor(c));
    const t = c.timeline;
    const v = (n) => (n == null ? '–' : days(n));
    const comp = i.completeness.map((x) => `${x.have}/${x.total}`).join(' → ') || '–';
    const tiles = [
      ['Čas do léčby', v(i.tt), `${fmtDate(t.symptom)} symptom → ${fmtDate(t.treatmentStart)} operace`, 'main'],
      ['T1', v(i.t1), 'symptom → KOC'],
      ['T2', v(i.t2), i.decisionMdt ? `rozhodující ${i.decisionMdt.title} ${fmtDate(i.decisionMdt.date)}` : 'diagnostika → MDT'],
      ['T3', v(i.t3), 'MDT → léčba'],
      ['Úplnost podkladů', comp, i.completeness.map((x) => x.title).join(' → ')],
    ];
    return html`
      <section aria-labelledby="ind-h">
        <div class="head"><h2 id="ind-h">Indikátory případu</h2><span class="muted small">vypočteno z časové osy</span></div>
        <ul>${tiles.map(([k, val, sub, cls]) => html`<li class="${cls || ''}"><span class="k">${k}</span><span class="v">${val}</span><span class="s">${sub}</span></li>`)}</ul>
      </section>`;
  }
}
customElements.define('indicator-tiles', IndicatorTiles);
