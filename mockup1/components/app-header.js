import { KocElement } from './lib/base.js';
import { html } from './lib/html.js';
import { icon } from './lib/icons.js';
import { toast } from './lib/toast.js';
import { reset, getSelected, getCase } from './lib/store.js';
import { CASES, CASE_IDS } from './lib/cases.js';
import { demoDate, fmtDate } from './lib/dates.js';

const ROLES = {
  gp: {
    suffix: '', user: 'MUDr. Jana Dvořáková', role: 'praktický lékař, Benešov',
    nav: ['Nové referování', 'Moji referovaní pacienti (4)', 'Zprávy z KOC (1)'],
  },
  koordinator: {
    suffix: ' · KOC', staff: 'coordinator', user: 'Bc. Petra Malá', role: 'koordinátorka KOC VFN',
    nav: ['Pracovní fronta', 'Kalendář MDT', 'Sady úkolů', 'Zprávy (3)'],
  },
  mdt: {
    suffix: ' · MDT', staff: 'mdtChair', user: 'prof. MUDr. Karel Vondra', role: 'přednosta onkologických MDT, KOC VFN',
    nav: ['Jednání MDT', 'Kalendář konzilií', 'Archiv závěrů'],
  },
  revizni: {
    suffix: ' · revize', user: 'MUDr. Tomáš Beneš', role: 'revizní lékař VZP',
    nav: ['Uzavřené případy', 'Indikátory KOC', 'Moje dotazy'],
  },
};

const SWITCH = [
  ['gp', '01 Referující lékař'],
  ['koordinator', '02 Koordinátor KOC'],
  ['revizni', '03 Revizní lékař VZP'],
  ['mdt', '04 MDT'],
];

class AppHeader extends KocElement {
  static styles = `
    :host { background: var(--ink); color: #fff; }
    .bar { max-width: 1440px; margin: 0 auto; padding: 10px 16px; display: flex; align-items: center; gap: 8px 24px; flex-wrap: wrap; }
    .brand { display: inline-flex; align-items: center; gap: 8px; color: #fff; text-decoration: none; font-weight: 700; font-size: 17px; min-height: 44px; }
    .brand .icon { width: 26px; height: 26px; color: #7FC4CD; }
    .brand span { font-weight: 500; color: #C5CDD5; }
    nav.main { display: flex; gap: 4px; flex-wrap: wrap; flex: 1 1 auto; }
    nav.main a, nav.main button { color: #DCE2E8; background: none; border: 0; font: inherit; font-size: 14px; padding: 0 10px; min-height: 40px;
      border-radius: 8px; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; }
    nav.main a[aria-current="page"] { color: #fff; background: rgba(255,255,255,.12); font-weight: 600; }
    nav.main button:hover, nav.main a:hover { background: rgba(255,255,255,.08); }
    .who { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 14px; }
    .who .role { color: #C5CDD5; }
    .switch { background: #232E3A; }
    .switch .inner { max-width: 1440px; margin: 0 auto; padding: 4px 16px; display: flex; align-items: center; gap: 4px 8px; flex-wrap: wrap; font-size: 13px; }
    .switch .lbl { color: #C5CDD5; margin-right: 4px; }
    .switch a { color: #DCE2E8; text-decoration: none; padding: 0 10px; min-height: 36px; display: inline-flex; align-items: center; border-radius: 8px; }
    .switch a:hover { background: rgba(255,255,255,.08); }
    .switch a[aria-current="page"] { background: #fff; color: var(--ink); font-weight: 600; }
    .switch .spacer { flex: 1; }
    .switch button { color: #DCE2E8; background: none; border: 1px solid rgba(255,255,255,.3); border-radius: 8px; min-height: 36px; padding: 0 10px;
      font: inherit; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
    .switch button:hover { background: rgba(255,255,255,.08); }
    .switch .icon { width: 15px; height: 15px; }
    :focus-visible { outline-color: #9FD8DF; }
    .switch button[aria-expanded="true"] { background: #fff; color: var(--ink); }
    .admin { background: #FFF7E6; color: var(--ink); border-bottom: 1px solid var(--line); }
    .admin .inner { max-width: 1440px; margin: 0 auto; padding: 10px 16px; display: grid; gap: 8px; font-size: 14px; }
    .admin .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .admin .icon { width: 16px; height: 16px; }
  `;

  render() {
    const role = this.getAttribute('role') || 'gp';
    const r = ROLES[role] || ROLES.gp;
    // the selected case may bring its own KOC staff and demo clock (cases.js)
    const sel = getSelected(role);
    const staff = r.staff && CASES[sel]?.[r.staff];
    const user = staff?.name || r.user;
    const roleText = staff?.role || r.role;
    const date = `Demo · ${fmtDate(demoDate(role), { year: true })}`;
    const resettable = CASE_IDS.includes(sel) ? sel : 'novak';
    return html`
      <header>
        <div class="bar">
          <a class="brand" href="#/" aria-label="Cesta pacienta – přehled dema">${icon('pulse')}Cesta pacienta<span>${r.suffix}</span></a>
          <nav class="main" aria-label="Hlavní navigace">
            <a href="#/${role}" aria-current="page">${r.nav[0]}</a>
            ${r.nav.slice(1).map((n) => html`<button type="button" data-action="na">${n}</button>`)}
          </nav>
          <div class="who">
            <span class="pill dark mono">${date}</span>
            <span><strong>${user}</strong> <span class="role">· ${roleText}</span></span>
          </div>
        </div>
        <div class="switch">
          <nav class="inner" aria-label="Přepnout roli v demu">
            <span class="lbl">Role v demu:</span>
            ${SWITCH.map(([id, label]) => html`<a href="#/${id}" ${id === role ? html`aria-current="page"` : ''}>${label}</a>`)}
            <span class="spacer"></span>
            <button type="button" data-action="admin" aria-expanded="${!!this.admin}" aria-controls="admin">${icon('refresh')}Admin: reset dema</button>
          </nav>
        </div>
        ${this.admin ? html`<div class="admin" id="admin" role="region" aria-label="Administrace dema">
          <div class="inner">
            <p><strong>Obnovit výchozí stav dema.</strong> Smaže převzetí, úkoly, zprávy, nahrané a vytěžené dokumenty i převzaté nálezy – dokumenty pak lze nahrát znovu a projít celý průchod od začátku.</p>
            <div class="row">
              <button class="btn sm primary" type="button" data-action="reset-all" data-key="reset-all">${icon('refresh')}Resetovat celé demo</button>
              <button class="btn sm" type="button" data-action="reset-case" data-id="${resettable}" data-key="reset-case">${icon('refresh')}Jen případ: ${getCase(resettable).patient.name}</button>
              <button class="btn sm ghost" type="button" data-action="admin-close" data-key="admin-close">Zrušit</button>
            </div>
          </div>
        </div>` : ''}
      </header>`;
  }

  onClick(e, el, action) {
    if (action === 'na') toast('Tato sekce není součástí prototypu.');
    if (action === 'admin' || action === 'admin-close') { this.admin = action === 'admin' && !this.admin; this.update(); }
    if (action === 'reset-all') {
      this.admin = false;
      reset();
      toast('Demo resetováno · začněte na obrazovce referujícího lékaře', { href: '#/gp', linkText: 'Otevřít' });
    }
    if (action === 'reset-case') {
      const id = el.dataset.id;
      this.admin = false;
      reset(id);
      toast(`Případ ${getCase(id).patient.name} vrácen do výchozího stavu`);
    }
  }
}
customElements.define('app-header', AppHeader);
