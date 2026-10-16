import { KocElement } from './lib/base.js';
import { html } from './lib/html.js';
import { icon } from './lib/icons.js';
import { getCase } from './lib/store.js';
import { askQuestion } from './lib/actions.js';
import { fmtDate } from './lib/dates.js';

// Reviewer -> coordinator question; lands in the case's msg-thread on the coordinator screen.
class ReviewQuestion extends KocElement {
  static styles = `
    form { display: grid; gap: 8px; }
    .actions { display: flex; justify-content: flex-end; }
    .sent { margin-top: 12px; display: grid; gap: 8px; }
    .sent li { background: var(--ai-soft); border-radius: var(--radius-ctl); padding: 8px 10px; font-size: 14px; }
    .sent .meta { font-size: 12.5px; color: var(--muted); }
  `;

  init() {
    this.draft ??= '';
    this.listen(window, 'koc:focus-question', () => {
      if (!this.draft) this.draft = 'Prosím o doplnění: ';
      this.update();
      const ta = this.$('#q');
      ta.scrollIntoView({ behavior: 'smooth', block: 'center' });
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    });
  }

  render() {
    const c = getCase(this.caseId);
    const asked = c.messages.filter((m) => m.kind === 'question');
    return html`<section class="card">
      <form data-action="ask">
        <label for="q">Dotaz na koordinátora</label>
        <textarea id="q" rows="3" data-key="q" placeholder="Např. proč proběhlo 1. MDT bez průkazné histologie?">${this.draft}</textarea>
        <div class="actions"><button class="btn primary" type="submit">${icon('send')}Odeslat dotaz</button></div>
      </form>
      ${asked.length ? html`<ul class="sent" aria-label="Odeslané dotazy">${asked.map((m) => html`<li><p>${m.text}</p>
        <p class="meta">Odesláno ${fmtDate(m.at)} · zobrazí se koordinátorce ve vlákně zpráv · <a href="#/koordinator">otevřít</a></p></li>`)}</ul>` : ''}
    </section>`;
  }

  onInput(e) { if (e.target.id === 'q') this.draft = e.target.value; }

  onSubmit(e, el, action) {
    if (action !== 'ask') return;
    const text = this.draft.trim();
    if (!text) { this.$('#q').focus(); return; }
    this.draft = '';
    askQuestion(this.caseId, text);
  }
}
customElements.define('review-question', ReviewQuestion);
