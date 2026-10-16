import { KocElement } from './lib/base.js';
import { html } from './lib/html.js';
import { icon } from './lib/icons.js';
import { getCase } from './lib/store.js';
import { setSourcesLoaded, setSourcesExcluded } from './lib/actions.js';
import { fmtDate } from './lib/dates.js';

// Loads a FHIR R4 bundle. Mock mode fetches the `src` JSON; with KOC_CONFIG.fhirMock = false
// it calls `${fhirBaseUrl}/${patient}/$everything` on a real server (e.g. InterSystems IRIS for Health).
const ORDER = ['Patient', 'Condition', 'DiagnosticReport', 'Observation', 'MedicationStatement', 'AllergyIntolerance', 'DocumentReference'];
const num = (v) => String(v).replace('.', ',');

function describe(r) {
  switch (r.resourceType) {
    case 'Patient': return `${r.name?.[0]?.text || ''}, nar. ${fmtDate(r.birthDate, { year: true })}`;
    case 'Condition': return `${r.code?.coding?.[0]?.code || ''} ${r.code?.text || r.code?.coding?.[0]?.display || ''}`.trim();
    case 'DiagnosticReport': return `${r.code?.text} ${fmtDate(r.effectiveDateTime, { year: true })}`;
    case 'Observation': {
      const q = r.valueQuantity;
      const high = r.interpretation?.[0]?.coding?.[0]?.code === 'H' ? ' ↑' : '';
      return `${r.code?.text}${q ? ` ${num(q.value)} ${q.unit}${high}` : ''}`;
    }
    case 'MedicationStatement': return `${r.medicationCodeableConcept?.text}${r.dosage?.[0]?.text ? ' ' + r.dosage[0].text : ''}`;
    case 'AllergyIntolerance': return r.code?.text;
    case 'DocumentReference': return r.content?.[0]?.attachment?.title || r.type?.text;
    default: return r.id;
  }
}

class FhirPicker extends KocElement {
  static styles = `
    .banner { justify-content: space-between; }
    .banner .what { display: flex; gap: 10px; align-items: flex-start; min-width: 0; }
    .banner .meta { font-size: 12.5px; color: var(--ink); overflow-wrap: anywhere; }
    h3 { margin: 14px 0 6px; font-size: 14px; display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
    ul { border: 1px solid var(--line); border-radius: var(--radius-ctl); }
    li + li { border-top: 1px solid var(--line); }
    li label { display: flex; gap: 12px; align-items: flex-start; padding: 10px 12px; margin: 0; cursor: pointer; color: var(--ink); font-size: 14px; font-weight: 400; min-height: 44px; }
    li label:hover { background: #FAFAF8; }
    .type { font-weight: 600; }
    .count { font-family: var(--font-mono); color: var(--muted); font-size: 13px; }
    .detail { display: block; color: var(--muted); font-size: 13px; margin-top: 2px; }
    .detail.mono { font-size: 12.5px; }
  `;

  init() { if (!this.bundle && !this.loading) this.load(); }

  async load() {
    this.loading = true;
    this.error = null;
    this.update();
    try {
      const cfg = window.KOC_CONFIG || {};
      const url = cfg.fhirMock === false
        ? `${cfg.fhirBaseUrl.replace(/\/$/, '')}/${this.getAttribute('patient')}/$everything`
        : `${cfg.fhirBaseUrl || ''}${this.getAttribute('src').replace(/^data\//, '')}`;
      const res = await fetch(url, { headers: { Accept: 'application/fhir+json' }, cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.bundle = await res.json();
      this.loadedAt = new Date();
      const entries = this.bundle.entry || [];
      const docs = entries.filter((e) => e.resource.resourceType === 'DocumentReference').length;
      setSourcesLoaded(this.caseId, entries.length - docs, docs);
    } catch (e) {
      this.error = e.message;
    }
    this.loading = false;
    this.update();
  }

  groups() {
    const by = {};
    for (const { resource } of this.bundle?.entry || []) (by[resource.resourceType] ||= []).push(resource);
    return ORDER.filter((t) => by[t]).map((t) => ({ type: t, items: by[t] }))
      .concat(Object.keys(by).filter((t) => !ORDER.includes(t)).map((t) => ({ type: t, items: by[t] })));
  }

  render() {
    const c = getCase(this.caseId);
    const excluded = c.sourcesExcluded || [];
    const endpoint = this.getAttribute('endpoint');
    const patient = this.getAttribute('patient');
    const groups = this.groups();
    const total = groups.reduce((a, g) => a + g.items.length, 0);
    const selected = groups.filter((g) => !excluded.includes(g.type)).reduce((a, g) => a + g.items.length, 0);
    const locked = c.phase !== 'draft';
    return html`
      <div class="banner ${this.error ? 'miss' : 'ok'}" aria-live="polite">
        <div class="what">
          ${icon(this.error ? 'alert' : 'server')}
          <div>
            <strong>${this.error ? 'Nepodařilo se načíst data z FHIR serveru' : 'Připojeno: InterSystems IRIS for Health'}</strong>
            <div class="meta mono">${endpoint} · ${patient}${this.loadedAt ? ` · načteno ${this.loadedAt.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })}` : ''}</div>
            ${this.error ? html`<div class="meta">${this.error}</div>` : ''}
          </div>
        </div>
        <button class="btn sm" type="button" data-action="reload" data-key="reload" ${this.loading ? 'disabled' : ''}>${icon('refresh')}${this.loading ? 'Načítám…' : 'Načíst znovu'}</button>
      </div>
      ${this.loading && !this.bundle ? html`<div class="skeleton" style="margin-top:14px"><span></span><span></span><span></span></div>` : ''}
      ${groups.length ? html`
        <h3><span>Nalezené zdroje</span><span class="count">vybráno ${selected} z ${total}</span></h3>
        <ul>
          ${groups.map((g) => html`<li><label>
            <input type="checkbox" data-action="toggle" data-type="${g.type}" data-key="cb-${g.type}" ${excluded.includes(g.type) ? '' : 'checked'} ${locked ? 'disabled' : ''}>
            <span>
              <span class="type">${g.type}</span>${g.items.length > 1 ? html` <span class="count">×${g.items.length}</span>` : ''}
              ${g.items.some((r) => r.meta?.tag?.some((t) => t.code === 'key')) ? html` <span class="pill accent">klíčové</span>` : ''}
              <span class="detail ${g.type === 'Observation' ? 'mono' : ''}">${g.items.map(describe).join(' · ')}</span>
            </span>
          </label></li>`)}
        </ul>` : ''}`;
  }

  onClick(e, el, action) { if (action === 'reload') this.load(); }

  onChange(e, el, action) {
    if (action !== 'toggle') return;
    const c = getCase(this.caseId);
    const set = new Set(c.sourcesExcluded || []);
    if (el.checked) set.delete(el.dataset.type); else set.add(el.dataset.type);
    setSourcesExcluded(this.caseId, [...set]);
  }
}
customElements.define('fhir-picker', FhirPicker);
