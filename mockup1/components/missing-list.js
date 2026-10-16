import { KocElement } from './lib/base.js';
import { html } from './lib/html.js';
import { icon } from './lib/icons.js';
import { getCase, templateFor } from './lib/store.js';
import { computeMissing, openItems } from './lib/derive.js';
import { setEcog, remindEcog } from './lib/actions.js';
import { daysBetween, demoDate, fmtDate, days, currentScreen } from './lib/dates.js';

// Rule-based completeness check against the case's care-plan template (data/template-*.json, no LLM).
const GP_PILL = { 'blocks-mdt': ['miss', 'blokuje MDT'], gp: ['warn', 'doplňte vy'], recommended: ['accent', 'doporučeno'] };
const ECOG_HINT = ['plně aktivní', 'omezen při námaze', 'soběstačný, nepracuje', 'omezeně soběstačný', 'zcela odkázaný'];

class MissingList extends KocElement {
  static styles = `
    li { display: grid; gap: 6px; padding: 12px 0; border-top: 1px solid var(--line); }
    li:first-child { border-top: 0; padding-top: 0; }
    .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px 12px; flex-wrap: wrap; }
    .lbl { font-weight: 600; min-width: 0; }
    .sub { font-size: 13px; color: var(--muted); }
    .ecog { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
    .ecog button { min-width: 44px; min-height: 44px; font-family: var(--font-mono); font-size: 15px; }
    .ecog button[aria-pressed="true"] { background: var(--accent); color: #fff; border-color: var(--accent); }
    .resolved { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--line); font-size: 13px; color: var(--muted); display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .resolved .icon { color: var(--ok); }
    .resolved > span { flex: 1 1 16em; min-width: 0; }
    .rule { margin-top: 12px; }
  `;

  render() {
    const c = getCase(this.caseId);
    const tpl = templateFor(c);
    const audience = this.getAttribute('audience') || 'gp';
    return audience === 'gp' ? this.renderGp(c, tpl) : this.renderCoordinator(c, tpl);
  }

  renderGp(c, tpl) {
    const all = computeMissing(c, tpl, 'gp');
    const open = openItems(all);
    // Recommended items sharing a group render as one row.
    const rows = [];
    for (const m of open) {
      if (m.group) {
        const existing = rows.find((r) => r.group === m.group);
        if (existing) continue;
        const g = tpl.groups[m.group];
        rows.push({ ...m, id: m.group, label: g.label, gpNote: g.gpNote });
      } else rows.push(m);
    }
    const ecog = c.values?.ecog;
    const fromDocs = all.filter((m) => m.resolvedBy === 'document');
    return html`
      <section class="card" aria-labelledby="ml-h">
        <div class="card-head">
          <div><h2 id="ml-h">Co v dokumentaci chybí</h2><p class="muted small">dle šablony pro 1. MDT</p></div>
          ${c.handover ? html`<span class="pill ${open.some((m) => m.severity === 'blocks-mdt') ? 'miss' : open.length ? 'warn' : 'ok'}">${open.length ? `${open.length} chybí` : 'kompletní'}</span>` : ''}
        </div>
        ${!c.handover ? html`<p class="empty">Kontrola úplnosti proběhne po vytěžení dokumentace.</p>` : html`
        <ul aria-live="polite">
          ${rows.map((m) => html`<li>
            <div class="top"><span class="lbl">${m.label}</span><span class="pill ${GP_PILL[m.severity][0]}">${GP_PILL[m.severity][1]}</span></div>
            <span class="sub">${m.gpNote}</span>
            ${m.id === 'ecog' ? html`<div class="ecog" role="group" aria-label="Výkonnostní stav ECOG">
              ${[0, 1, 2, 3, 4].map((v) => html`<button class="btn sm" type="button" data-action="ecog" data-v="${v}" data-key="ecog-${v}" aria-pressed="false" title="${ECOG_HINT[v]}" aria-label="ECOG ${v} – ${ECOG_HINT[v]}">${v}</button>`)}
            </div>` : ''}
          </li>`)}
        </ul>
        ${!rows.length ? html`<p class="banner ok">${icon('check')}Podklady pro 1. MDT jsou kompletní.</p>` : ''}
        ${fromDocs.length ? html`<p class="resolved">${icon('check')}<span>Doloženo z dokumentu: ${fromDocs.map((m) => m.shortLabel || m.label).join(', ')}
          · ${fromDocs[0].doc.file} · potvrdil(a) ${fromDocs[0].doc.confirmedBy}</span></p>` : ''}
        ${ecog ? html`<p class="resolved">${icon('check')}<span>Doplněno: Výkonnostní stav (ECOG) = <strong class="mono">${ecog.value}</strong> · ${fmtDate(ecog.at)}${ecog.source ? ` · z dokumentu ${ecog.source}` : ''}</span>
          <button class="btn sm ghost" type="button" data-action="ecog-clear" data-key="ecog-clear">Zrušit</button></p>` : ''}
        <p class="note rule">${icon('check')}<span>Kontrolu provádí pravidlo podle šablony „${tpl.title}“, ne AI.</span></p>`}
      </section>`;
  }

  renderCoordinator(c, tpl) {
    const screen = currentScreen();
    const open = openItems(computeMissing(c, tpl, 'koordinator'));
    const ecogReqs = c.messages.filter((m) => m.requests === 'ecog');
    const firstReq = ecogReqs[0];
    const lastReminder = ecogReqs.filter((m) => m.reminder).pop();
    const sub = (m) => {
      if (m.severity === 'blocks-mdt') {
        const t = m.task;
        if (!t) return 'úkol zatím nespuštěn';
        return `úkol běží · ${t.owner}`;
      }
      if (m.id === 'ecog') {
        if (!firstReq) return 'nevyžádáno';
        const wait = Math.max(0, daysBetween(firstReq.at, demoDate(screen)));
        return `vyžádáno od ${c.serviceRequest.requesterDat} ${fmtDate(firstReq.at, { time: false })} · bez odpovědi ${days(wait)}${lastReminder ? ` · připomenuto ${fmtDate(lastReminder.at)}` : ''}`;
      }
      return '';
    };
    return html`
      <section class="card" aria-labelledby="mk-h">
        <div class="card-head"><h2 id="mk-h">Chybí ${open.length}</h2><span class="muted small">kontrola dle šablony, ne AI</span></div>
        ${c.phase === 'submitted' ? html`<p class="empty">Po převzetí se úkoly ke chybějícím údajům vytvoří automaticky.</p>` : ''}
        ${open.length ? html`<ul aria-live="polite">${open.map((m) => html`<li>
          <div class="top">
            <span class="lbl">${m.shortLabel || m.label}</span>
            ${m.severity === 'blocks-mdt' ? html`<span class="pill miss">blokuje MDT</span>` : html`<span class="pill warn">lékař</span>`}
          </div>
          <div class="top"><span class="sub">${sub(m)}</span>
            ${m.id === 'ecog' ? html`<button class="btn sm" type="button" data-action="remind" data-key="remind">${icon('send')}Připomenout</button>` : ''}</div>
        </li>`)}</ul>` : html`<p class="banner ok">${icon('check')}Podklady pro MDT jsou kompletní.</p>`}
      </section>`;
  }

  onClick(e, el, action) {
    if (action === 'ecog') setEcog(this.caseId, Number(el.dataset.v));
    if (action === 'ecog-clear') setEcog(this.caseId, null);
    if (action === 'remind') remindEcog(this.caseId);
  }
}
customElements.define('missing-list', MissingList);
