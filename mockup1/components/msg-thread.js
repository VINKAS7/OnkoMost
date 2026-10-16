import { KocElement } from './lib/base.js';
import { html } from './lib/html.js';
import { icon } from './lib/icons.js';
import { getCase } from './lib/store.js';
import { sendMessage } from './lib/actions.js';
import { completeJSON } from './lib/llm.js';
import { fmtDate } from './lib/dates.js';

// FHIR Communication thread. Header buttons can ask for an AI-drafted message (human sends).
const RECIPIENTS = {
  gp: { to: null, channel: 'app', label: null }, // filled with the case's referring doctor
  patient: { to: 'pacient', channel: 'sms', label: 'Pacient (SMS)' },
  reviewer: { to: 'Revizní lékař VZP', channel: 'app', label: 'Revizní lékař VZP (aplikace)' },
};
const CHANNEL = { app: 'aplikace', sms: 'SMS', email: 'e-mail' };

class MsgThread extends KocElement {
  static styles = `
    ol { display: grid; gap: 10px; max-height: 420px; overflow-y: auto; padding-right: 2px; }
    li { border: 1px solid var(--line); border-radius: var(--radius-ctl); padding: 10px 12px; display: grid; gap: 4px; }
    li.question { border-color: #C9C2EA; background: var(--ai-soft); }
    li.question .meta strong { color: var(--ai); }
    .meta { font-size: 13px; color: var(--muted); display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
    .meta strong { color: var(--ink); font-weight: 600; }
    .text { font-size: 14.5px; overflow-wrap: anywhere; }
    form { margin-top: 12px; display: grid; gap: 8px; }
    .compose { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: end; }
    @media (max-width: 480px) { .compose { grid-template-columns: minmax(0, 1fr); } }
  `;

  init() {
    this.draft ??= '';
    this.to ??= 'gp';
    this.aiDraft ??= false;
    this.listen(window, 'koc:compose', (e) => this.compose(e.detail.to));
  }

  async compose(to) {
    this.to = to;
    this.drafting = true;
    this.update();
    this.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    const r = await completeJSON({ task: 'draft-message', messages: [{ role: 'user', content: JSON.stringify({ to, caseId: this.caseId }) }] });
    this.drafting = false;
    this.draft = r.data.text;
    this.aiDraft = r.model;
    this.update();
    this.$('#msg')?.focus();
  }

  recipients(c) {
    const gp = c.serviceRequest.requester;
    return { ...RECIPIENTS, gp: { to: gp, channel: 'app', label: `${gp} (aplikace)` } };
  }

  caseChanged() { this.draft = ''; this.aiDraft = false; }

  render() {
    const c = getCase(this.caseId);
    const msgs = c.messages || [];
    return html`
      <section class="card" aria-labelledby="mt-h">
        <div class="card-head"><h2 id="mt-h">Zprávy</h2><span class="muted small">${msgs.length} ve vlákně · uloženo k případu</span></div>
        <ol aria-live="polite">
          ${msgs.map((m) => html`<li class="${m.kind || ''}">
            <p class="meta"><span class="pill">${CHANNEL[m.channel] || m.channel}</span>
              <strong>${m.channel === 'sms' ? 'SMS' : m.from} → ${m.to}</strong> · <span class="mono">${fmtDate(m.at)}</span>
              ${m.kind === 'question' ? html`<span class="pill ai">dotaz revize</span>` : ''}</p>
            <p class="text">${m.text}</p>
            ${m.draftedBy ? html`<p class="source">${icon('spark', 'icon sr-hide')} AI návrh (${m.draftedBy}) · zkontroloval(a) a odeslal(a) koordinátor</p>` : ''}
          </li>`)}
        </ol>
        <form data-action="send" aria-label="Nová zpráva">
          <div><label for="to">Komu</label>
            <select id="to" data-action="to" data-key="to">${Object.entries(this.recipients(c)).map(([k, r]) => html`<option value="${k}" ${k === this.to ? 'selected' : ''}>${r.label}</option>`)}</select></div>
          ${this.drafting ? html`<p class="banner ai" aria-live="polite">${icon('spark')}AI připravuje návrh zprávy…</p>` : ''}
          ${this.aiDraft && this.draft ? html`<p class="row"><span class="pill ai">${icon('spark')}AI návrh</span><span class="muted small">zkontrolujte a upravte před odesláním</span></p>` : ''}
          <div class="compose">
            <div><label for="msg">Nová zpráva</label><textarea id="msg" rows="2" data-key="msg">${this.draft}</textarea></div>
            <button class="btn primary" type="submit" data-key="send-btn">${icon('send')}Odeslat</button>
          </div>
        </form>
      </section>`;
  }

  updated() {
    const list = this.$('ol');
    if (list) list.scrollTop = list.scrollHeight;
  }

  onInput(e) { if (e.target.id === 'msg') this.draft = e.target.value; }

  onChange(e, el, action) { if (action === 'to') this.to = el.value; }

  onKeydown(e) {
    if (e.target.id === 'msg' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.send(); }
  }

  onSubmit(e, el, action) { if (action === 'send') this.send(); }

  send() {
    const text = this.draft.trim();
    if (!text) { this.$('#msg').focus(); return; }
    const r = this.recipients(getCase(this.caseId))[this.to];
    const msg = { from: 'Koordinátor', to: r.to, channel: r.channel, text };
    if (this.aiDraft) msg.draftedBy = `llm:${this.aiDraft}`;
    this.draft = '';
    this.aiDraft = false;
    sendMessage(this.caseId, msg);
  }
}
customElements.define('msg-thread', MsgThread);
