import { KocElement } from './lib/base.js';
import { html } from './lib/html.js';
import { getCase } from './lib/store.js';
import { deriveEvents } from './lib/derive.js';
import { fmtDate } from './lib/dates.js';

class CaseTimeline extends KocElement {
  static styles = `
    ol { position: relative; display: grid; gap: 0; }
    li { display: grid; grid-template-columns: 64px 20px minmax(0, 1fr); gap: 8px; align-items: start; position: relative; padding-bottom: 12px; }
    li:not(:last-child)::after { content: ''; position: absolute; left: 81px; top: 16px; bottom: -2px; width: 2px; background: var(--line); }
    .date { font-family: var(--font-mono); font-size: 13px; color: var(--muted); text-align: right; padding-top: 1px; }
    .dot { width: 12px; height: 12px; border-radius: 50%; background: var(--ok); margin: 4px auto 0; position: relative; z-index: 1; box-shadow: 0 0 0 3px var(--surface); }
    li.warn .dot { background: #C77700; width: 14px; height: 14px; }
    li.accent .dot { background: var(--accent); width: 14px; height: 14px; }
    li.strong .lbl { font-weight: 600; }
    li.warn .lbl { color: var(--warn); }
    li.accent .lbl { color: var(--accent); }
  `;

  render() {
    const ev = deriveEvents(getCase(this.caseId));
    return html`<section class="card" aria-labelledby="tl-h">
      <div class="card-head"><h2 id="tl-h">Časová osa</h2></div>
      <ol>${ev.map((e) => html`<li class="${e.tone || ''} ${e.strong ? 'strong' : ''}">
        <span class="date">${fmtDate(e.date, { time: false })}</span><span class="dot" aria-hidden="true"></span>
        <span class="lbl">${e.label}${e.tone === 'warn' ? html`<span class="sr-only"> (s výhradou)</span>` : ''}</span>
      </li>`)}</ol>
    </section>`;
  }
}
customElements.define('case-timeline', CaseTimeline);
