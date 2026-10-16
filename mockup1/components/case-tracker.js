import { KocElement } from './lib/base.js';
import { html } from './lib/html.js';
import { icon } from './lib/icons.js';
import { getCase, templateFor, isPrebaked } from './lib/store.js';
import { CASES } from './lib/cases.js';
import { deriveSteps } from './lib/derive.js';
import { currentScreen, DEMO_DATES, fmtDate } from './lib/dates.js';

const STATE_LABEL = { done: 'hotovo', 'done-with-issue': 'hotovo s výhradou', active: 'probíhá', todo: 'čeká' };

class CaseTracker extends KocElement {
  static styles = `
    :host { container-type: inline-size; }
    ol { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
    @container (max-width: 820px) { ol { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @container (max-width: 440px) {
      li { flex-direction: column; gap: 6px; }
      .num { width: 26px; height: 26px; }
      .title { overflow-wrap: anywhere; }
    }
    li { border: 1px solid var(--line); border-radius: var(--radius-ctl); padding: 10px 12px; display: flex; gap: 10px; align-items: flex-start; background: var(--surface); min-width: 0; }
    .num { flex: none; width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; font-family: var(--font-mono);
      font-size: 13px; font-weight: 500; background: var(--bg); color: var(--muted); border: 1px solid var(--line); }
    .num .icon { width: 16px; height: 16px; }
    .title { font-weight: 600; }
    .title .n { font-family: var(--font-mono); color: var(--muted); font-weight: 500; margin-right: 4px; }
    .status { font-size: 13px; color: var(--muted); margin-top: 2px; }
    .body { min-width: 0; display: grid; gap: 4px; justify-items: start; }
    li.done { border-color: #B9D6BF; background: var(--ok-soft); }
    li.done .num { background: var(--ok); color: #fff; border-color: var(--ok); }
    li.done-with-issue { border-color: #E9CF9F; background: var(--warn-soft); }
    li.done-with-issue .num { background: var(--ok); color: #fff; border-color: var(--ok); }
    li.active { border: 2px solid var(--accent); padding: 9px 11px; }
    li.active .num { background: var(--accent); color: #fff; border-color: var(--accent); }
    li.active .title { color: var(--accent); }
    li.todo { background: #FAFAF8; }
    .pill { white-space: normal; }
    .slot { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--line); }
    .prebaked { margin-top: 10px; }
  `;

  render() {
    const c = getCase(this.caseId);
    const screen = currentScreen();
    const { steps, summary } = deriveSteps(c, templateFor(c), screen);
    return html`
      <section class="card" aria-labelledby="t">
        <div class="card-head">
          <h2 id="t">Cesta případu</h2>
          <span class="pill ${summary.tone}">${summary.tone === 'ok' ? icon('check') : summary.tone === 'miss' ? icon('alert') : ''}${summary.text}</span>
        </div>
        <ol>
          ${steps.map((s) => html`
            <li class="${s.state}" ${s.state === 'active' ? html`aria-current="step"` : ''}>
              <span class="num" aria-hidden="true">${s.state.startsWith('done') ? icon('check') : String(s.n).padStart(2, '0')}</span>
              <div class="body">
                <p class="title"><span class="n">${String(s.n).padStart(2, '0')}</span>${s.title}<span class="sr-only"> – ${STATE_LABEL[s.state]}</span></p>
                <p class="status">${s.status}</p>
                ${s.pill ? html`<span class="pill ${s.pill.tone}">${s.pill.text}</span>` : ''}
              </div>
            </li>`)}
        </ol>
        ${this.children.length ? html`<div class="slot"><slot></slot></div>` : ''}
        ${isPrebaked(this.caseId, screen) ? html`<p class="note prebaked">${icon('clock')}<span>Připravený stav k demo datu ${fmtDate(DEMO_DATES[screen], { year: true })}. Pro živý průchod ${CASES[this.caseId].gpFlow
          ? html`začněte na obrazovce <a href="#/gp">referujícího lékaře</a>`
          : html`převezměte případ na obrazovce <a href="#/koordinator">koordinátora</a>`}.</span></p>` : ''}
      </section>`;
  }
}
customElements.define('case-tracker', CaseTracker);
