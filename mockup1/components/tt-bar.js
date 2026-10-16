import { KocElement } from './lib/base.js';
import { html } from './lib/html.js';
import { getCase, templateFor } from './lib/store.js';
import { deriveTT } from './lib/derive.js';
import { currentScreen, days } from './lib/dates.js';

const STATE_TEXT = { done: 'hotovo', running: 'běží', over: 'běží, po cíli', remaining: '', future: 'zatím nezačalo' };

class TtBar extends KocElement {
  static styles = `
    .head { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; font-size: 13px; margin-bottom: 6px; }
    .head strong { font-size: 14px; }
    .bar { display: flex; gap: 3px; height: 14px; }
    .seg { min-width: 8px; border-radius: 4px; }
    .seg.done { background: var(--ok); }
    .seg.running { background: var(--accent); }
    .seg.over { background: var(--miss); }
    .seg.remaining { background: repeating-linear-gradient(90deg, transparent 0 6px, var(--accent-soft) 6px 7px); border: 2px dashed var(--accent); }
    .seg.future { background: var(--line); }
    .legend { display: flex; flex-wrap: wrap; gap: 4px 16px; margin-top: 8px; font-size: 13px; color: var(--muted); }
    .legend li { display: flex; align-items: center; gap: 6px; }
    .legend .sw { width: 12px; height: 12px; border-radius: 3px; flex: none; }
    .legend b { color: var(--ink); font-family: var(--font-mono); font-weight: 500; }
  `;

  render() {
    const c = getCase(this.caseId);
    const { segs, elapsed } = deriveTT(c, templateFor(c), currentScreen());
    const label = (s) => s.key === 'rest' ? `zbývá do cíle MDT ${s.days} d` : `${s.key} ${s.days == null ? '–' : s.days + ' d'}`;
    const aria = 'Čas do léčby = T1 + T2 + T3. ' + segs.map((s) => s.key === 'rest'
      ? `Do cílového termínu MDT zbývá ${days(s.days)}.`
      : `${s.key} ${s.desc}: ${s.days == null ? 'zatím nezačalo' : `${days(s.days)}, ${STATE_TEXT[s.state]}`}.`).join(' ');
    return html`
      <div class="head"><strong>Čas do léčby = T1 + T2 + T3</strong><span class="muted">dosud ${days(elapsed)}</span></div>
      <div class="bar" role="img" aria-label="${aria}">
        ${segs.map((s) => html`<span class="seg ${s.state}" style="flex-grow:${Math.max(1, s.days ?? s.width)}"></span>`)}
      </div>
      <ul class="legend" aria-hidden="true">
        ${segs.map((s) => html`<li><span class="sw seg ${s.state}"></span><span><b>${label(s)}</b> ${s.key === 'rest' ? '' : s.desc}</span></li>`)}
      </ul>`;
  }
}
customElements.define('tt-bar', TtBar);
