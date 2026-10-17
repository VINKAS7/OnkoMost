import { KocElement } from './lib/base.js';
import { html } from './lib/html.js';
import { icon } from './lib/icons.js';
import { getCase, templateFor } from './lib/store.js';
import { completeTask, takeOver, addTask, pendingDeps } from './lib/actions.js';
import { dueLabel, isOverdue, currentScreen, demoDate, addDays } from './lib/dates.js';

// FHIR CarePlan / Task list from the PlanDefinition template, with dependsOn enforcement.
class TaskPlan extends KocElement {
  static styles = `
    :host { container-type: inline-size; }
    .grid { display: grid; }
    .tr { display: grid; grid-template-columns: 44px minmax(0, 1fr) minmax(110px, 0.45fr) 110px; gap: 8px 12px; align-items: start; padding: 10px 0; border-top: 1px solid var(--line); }
    .tr.hdr { border-top: 0; padding-top: 0; font-size: 12.5px; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: .03em; }
    .step strong, .step .t { display: block; }
    .step .t { font-weight: 500; }
    .tr.running .t, .tr.overdue .t { font-weight: 600; }
    .tr.done .t { color: var(--muted); }
    .sub { font-size: 13px; color: var(--muted); }
    .due { font-family: var(--font-mono); font-size: 13.5px; }
    .tr.overdue .due { color: var(--miss); font-weight: 500; }
    .owner { font-size: 14px; }
    .dot { width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; padding: 0; border: 2px solid var(--line-strong);
      background: var(--surface); cursor: pointer; margin: -6px 0 0 0; }
    .dot .inner { width: 12px; height: 12px; border-radius: 50%; }
    .dot.running { border-color: var(--accent); }
    .dot.running .inner { background: var(--accent); }
    .dot.todo .inner { background: transparent; }
    .dot.overdue { border-color: var(--miss); }
    .dot.overdue .inner { background: var(--miss); }
    .dot:hover { background: var(--accent-soft); }
    .dot.done { background: var(--ok); border-color: var(--ok); color: #fff; cursor: default; }
    .dot.done .icon { width: 16px; height: 16px; }
    .blocked { display: flex; gap: 6px; align-items: center; margin-top: 6px; color: var(--miss); font-size: 13px; font-weight: 600; }
    .blocked .icon { width: 15px; height: 15px; }
    .add { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) 160px auto; gap: 10px; align-items: end; padding: 12px; margin-top: 10px;
      border: 1px dashed var(--line-strong); border-radius: var(--radius-ctl); }
    .add .btns { display: flex; gap: 6px; }
    .lbl-sm { display: none; }
    @container (max-width: 560px) {
      .tr { grid-template-columns: 44px minmax(0, 1fr); }
      .tr.hdr { display: none; }
      .owner, .due { grid-column: 2; }
      .lbl-sm { display: inline; color: var(--muted); font-family: var(--font-sans); font-size: 12.5px; }
      .add { grid-template-columns: minmax(0, 1fr); }
    }
  `;

  init() {
    this.blocked ??= null;
    this.adding ??= false;
    this.listen(window, 'koc:add-task', () => {
      this.adding = true;
      this.update();
      this.$('#nt-title')?.focus();
      this.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  render() {
    const c = getCase(this.caseId);
    const screen = currentScreen();
    if (c.phase === 'submitted' || !c.tasks.length) {
      return html`<section class="card" aria-labelledby="tp-h">
        <div class="card-head"><h2 id="tp-h">Plán a úkoly</h2></div>
        <p class="empty">Sada úkolů ještě není spuštěna. Po převzetí se z šablony „${templateFor(c).title}“ vytvoří ${templateFor(c).tasks.length} úkolů s odpovědnými a termíny.</p>
        ${c.phase === 'submitted' ? html`<p style="margin-top:12px"><button class="btn primary" type="button" data-action="takeover">${icon('check')}Převzít a spustit sadu</button></p>` : ''}
      </section>`;
    }
    const editable = c.phase === 'active';
    return html`
      <section class="card" aria-labelledby="tp-h">
        <div class="card-head">
          <div><h2 id="tp-h">Plán a úkoly</h2><p class="muted small">pořadí hlídá systém · notifikace 24 h před termínem</p></div>
          <span class="pill">Sada: ${c.carePlan?.title}</span>
        </div>
        <div class="grid" role="table" aria-label="Plán a úkoly">
          <div class="tr hdr" role="row"><span role="columnheader"><span class="sr-only">Stav</span></span><span role="columnheader">Krok</span><span role="columnheader">Na tahu</span><span role="columnheader">Termín</span></div>
          ${c.tasks.map((t, i) => {
            const over = isOverdue(t, screen, c.id);
            const pend = pendingDeps(c, t);
            const state = t.status === 'done' ? 'done' : over ? 'overdue' : t.status;
            const note = t.id === 'mdt1' && t.status !== 'done'
              ? (pend.length ? `čeká na: ${pend.map((p) => p.short).join(', ')}` : 'podklady připraveny')
              : t.note;
            const tip = t.status === 'done' ? '' : t.auto ? 'Dokončí se automaticky po odeslání závěru MDT'
              : pend.length ? `Čeká na: ${pend.map((p) => p.title).join(', ')}` : 'Označit jako hotové';
            return html`<div class="tr ${state}" role="row">
              <span role="cell">${t.status === 'done'
                ? html`<span class="dot done" role="img" aria-label="Hotovo">${icon('check')}</span>`
                : html`<button class="dot ${state}" type="button" data-action="done" data-id="${t.id}" data-key="dot-${t.id}" title="${tip}"
                    aria-label="${i + 1}. ${t.title} – ${state === 'overdue' ? 'po termínu' : t.status === 'running' ? 'běží' : 'čeká'}. ${tip}" ${editable ? '' : 'disabled'}><span class="inner"></span></button>`}</span>
              <span role="cell" class="step">
                <span class="t">${t.title}</span>
                ${note ? html`<span class="sub">${note}</span>` : ''}
                ${over ? html` <span class="pill miss">po termínu</span>` : ''}
                ${t.priority === 'high' && t.status !== 'done' ? html` <span class="pill warn">vysoká priorita</span>` : ''}
                ${this.blocked?.id === t.id ? html`<span class="blocked" role="alert">${icon('alert')}${this.blocked.text}</span>` : ''}
              </span>
              <span role="cell" class="owner"><span class="lbl-sm">Na tahu: </span>${t.owner}</span>
              <span role="cell" class="due"><span class="lbl-sm">Termín: </span>${dueLabel(t, screen, c.id)}</span>
            </div>`;
          })}
        </div>
        ${this.adding ? html`<form class="add" data-action="add" aria-label="Nový úkol">
          <div><label for="nt-title">Krok</label><input id="nt-title" data-key="nt-title" required autocomplete="off"></div>
          <div><label for="nt-owner">Na tahu</label><input id="nt-owner" data-key="nt-owner" required value="Koordinátor"></div>
          <div><label for="nt-due">Termín</label><input id="nt-due" type="date" data-key="nt-due" required value="${addDays(demoDate(screen, c.id), 2)}"></div>
          <div class="btns"><button class="btn" type="button" data-action="cancel-add">Zrušit</button><button class="btn primary" type="submit">Přidat</button></div>
        </form>` : ''}
      </section>`;
  }

  caseChanged() { this.blocked = null; this.adding = false; }

  onClick(e, el, action) {
    if (action === 'takeover') takeOver(this.caseId);
    if (action === 'cancel-add') { this.adding = false; this.update(); }
    if (action === 'done') {
      const r = completeTask(this.caseId, el.dataset.id);
      if (r.blocked || r.auto) {
        this.blocked = { id: el.dataset.id, text: r.auto ? 'Dokončí se automaticky po odeslání závěru MDT' : `Čeká na: ${r.blocked.join(', ')}` };
        this.update();
        clearTimeout(this._bt);
        this._bt = setTimeout(() => { this.blocked = null; this.update(); }, 5000);
      }
    }
  }

  onSubmit(e, el, action) {
    if (action !== 'add') return;
    const title = this.$('#nt-title').value.trim();
    const owner = this.$('#nt-owner').value.trim();
    const due = this.$('#nt-due').value;
    if (!title || !owner || !due) return;
    this.adding = false;
    addTask(this.caseId, { title, owner, due });
  }
}
customElements.define('task-plan', TaskPlan);
