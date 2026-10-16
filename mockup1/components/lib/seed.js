// Case factories. Novák: the draft case (GP, 6. 1.) and pre-baked states for the koordinator (12. 1.),
// mdt (13. 1.) and revizni (27. 1.) demo dates. Veselá: referred by her gynaecologist on 12. 1.
// (arrives in the coordinator queue as new) and pre-baked for the mdt date. Shapes follow FHIR naming (see §6).
// Which factory a screen uses is decided in cases.js.
import { addDays } from './dates.js';

export const GP_NAME = 'MUDr. Jana Dvořáková';
export const COORDINATOR_NAME = 'Bc. Petra Malá';
export const REVIEWER_NAME = 'MUDr. Tomáš Beneš';
// Step 04 jumps the demo clock forward to the reviewer's date.
export const SEND_AT = '2026-01-27T08:50';
export const ACK_AT = '2026-01-27T09:14';

export function seedDraft() {
  return {
    id: 'novak',
    phase: 'draft',
    serviceRequest: {
      koc: 'vfn-hpb',
      reasonCode: 'C25.0',
      reasonText: 'C25.0 – Zhoubný novotvar hlavy slinivky břišní (suspektní)',
      note: 'Nebolestivý ikterus od 5. 1., na UZ ložisko v hlavě pankreatu 32 mm. Urgentní – prosím o převzetí do 48 h.',
      requester: GP_NAME,
      requesterOrg: 'PL Benešov',
      requesterDat: 'MUDr. Dvořákové',
    },
    patient: {
      name: 'Josef Novák', birthDate: '1966-01-05', age: 60, sex: 'male',
      ref: 'pan Novák', refGen: 'pana Nováka',
      birthNumberMasked: '660105/••••', insurer: '111', insurerLabel: '111 – VZP ČR',
      phoneMasked: '+420 7•• ••• 412',
      summary: 'DM 2. typu, hypertenze · alergie: penicilin',
    },
    sources: null,
    sourcesExcluded: [],
    uploads: [],
    handover: null,
    values: {},
    carePlan: null,
    tasks: [],
    messages: [],
    mdt: [],
    diagnosis: null,
    treatment: null,
    timeline: { symptom: '2026-01-05', referral: '2026-01-06', mdtDecision: null, treatmentStart: null, ack: null },
    review: { status: 'new' },
  };
}

export function confirmedHandover(d) {
  return {
    ...structuredClone(d.handovers.novak),
    model: 'mock',
    provenance: { draftedBy: 'llm:mock', verifiedBy: GP_NAME, at: '2026-01-06T10:58' },
  };
}

export function applyTemplate(c, tpl) {
  c.carePlan = { template: tpl.id, title: tpl.title };
  c.tasks = tpl.tasks.map((t) => {
    const due = addDays(c.timeline.referral, t.dueOffsetDays) + (t.time ? `T${t.time}` : '');
    return {
      id: t.id, title: t.title, short: t.short, note: t.note || '', owner: t.owner,
      priority: t.priority || 'normal', dependsOn: [...(t.dependsOn || [])], auto: !!t.auto,
      due, status: t.initialStatus, doneAt: t.initialStatus === 'done' ? due.slice(0, 10) : null,
    };
  });
}

export function seedActive(d) {
  const c = seedDraft();
  c.phase = 'active';
  c.submittedAt = '2026-01-06T10:58';
  c.sources = { count: 14, documents: 1 };
  c.handover = confirmedHandover(d);
  applyTemplate(c, d.templates['pancreas-v1']);
  c.messages = [
    { id: 'm1', from: 'Koordinátor', to: GP_NAME, channel: 'app', at: '2026-01-06T11:05',
      text: 'Dobrý den, prosím o doplnění ECOG pana Nováka.', requests: 'ecog' },
    { id: 'm2', from: 'Koordinátor', to: 'pacient', channel: 'sms', at: '2026-01-11T15:30',
      text: NOVAK_SMS },
  ];
  return c;
}

// Step 04: structured (AI-drafted, coordinator-confirmed) MDT conclusion is applied and sent.
export function applyMdtConclusion(c, s, { verifiedBy, model, at = SEND_AT }) {
  c.diagnosis = s.diagnosis;
  c.mdt = s.mdt.map((m) => ({ ...m }));
  c.treatment = { ...s.treatment };
  const decision = [...c.mdt].reverse().find((m) => m.decision) || c.mdt[c.mdt.length - 1];
  c.timeline.mdtDecision = decision.date;
  c.timeline.treatmentStart = s.treatment.start;
  c.mdtProvenance = { draftedBy: `llm:${model}`, verifiedBy, at, source: s.source };
  c.tasks.forEach((t) => {
    if (t.status === 'done') return;
    t.status = 'done';
    t.doneAt = t.id === 'feedback' ? at.slice(0, 10) : t.due.slice(0, 10);
  });
  c.phase = 'closed-pending-ack';
  c.sentAt = at;
  c.messages.push(
    { id: `m${Date.now()}a`, from: 'Koordinátor', to: GP_NAME, channel: 'app', at,
      text: `Závěr MDT a plán léčby pana Nováka: ${s.diagnosis}. ${s.treatment.plan} Původní referování a handover jsou přiloženy.` },
    { id: `m${Date.now()}b`, from: 'Systém', to: 'Revizní lékař VZP', channel: 'app', at,
      text: 'Uzavřený případ předán automaticky k revizi (souhrn, indikátory, zprávy z MDT).' },
  );
}

export function acknowledge(c) {
  c.phase = 'closed';
  c.timeline.ack = ACK_AT;
  if (!c.values.ecog) {
    // Demo: GP answered the ECOG request late (13. 1.), before closing.
    c.values.ecog = { value: 1, at: '2026-01-13', by: GP_NAME };
  }
  c.messages.push({ id: `m${Date.now()}c`, from: GP_NAME, to: 'Koordinátor', channel: 'app', at: ACK_AT,
    text: 'Potvrzuji převzetí závěru MDT a plánu léčby. Děkuji.' });
}

// 1. MDT HPB, 13. 1. 14:00: ECOG answered, CT + markers + histology in, the board is in session.
export function seedMdt(d) {
  const c = seedActive(d);
  c.values.ecog = { value: 1, at: '2026-01-13', by: GP_NAME };
  c.messages.push({ id: 'm3', from: GP_NAME, to: 'Koordinátor', channel: 'app', at: '2026-01-13T08:10',
    text: 'ECOG 1 – pacient soběstačný, omezen jen při fyzické zátěži.' });
  for (const t of c.tasks) if (['ct', 'markers'].includes(t.id)) { t.status = 'done'; t.doneAt = '2026-01-12'; }
  for (const t of c.tasks) if (t.id === 'histology') { t.status = 'done'; t.doneAt = '2026-01-13'; }
  for (const t of c.tasks) if (t.id === 'mdt1') t.status = 'running';
  return c;
}

export function seedClosed(d) {
  const c = seedMdt(d);
  applyMdtConclusion(c, d.mdt, { verifiedBy: COORDINATOR_NAME, model: 'mock' });
  acknowledge(c);
  return c;
}

// --- Alena Veselá: suspected ovarian cancer, referred by her gynaecologist ---------------------
export const GYN_NAME = 'MUDr. Hana Pokorná';

export function seedVeselaSubmitted(d) {
  return {
    id: 'vesela',
    phase: 'submitted',
    submittedAt: '2026-01-12T07:40',
    serviceRequest: {
      koc: 'vfn-gyn',
      reasonCode: 'C56',
      reasonText: 'C56 – Zhoubný novotvar vaječníku (suspektní)',
      note: 'Adnexální tumor vlevo 74 mm, O-RADS 5, CA-125 486 kU/l. ADPKD s CKD G3a – pozor na kontrast. Prosím o převzetí a MDT.',
      requester: GYN_NAME,
      requesterOrg: 'gynekologie Kladno',
      requesterDat: 'MUDr. Pokorné',
    },
    patient: {
      name: 'Alena Veselá', birthDate: '1968-09-14', age: 57, sex: 'female',
      ref: 'paní Veselá', refGen: 'paní Veselé',
      birthNumberMasked: '685914/••••', insurer: '111', insurerLabel: '111 – VZP ČR',
      phoneMasked: '+420 6•• ••• 087',
      summary: 'ADPKD, CKD G3a, hypertenze, hyperurikémie · alergie: neudává',
    },
    sources: { count: 9, documents: 1 },
    sourcesExcluded: [],
    uploads: [],
    handover: {
      ...structuredClone(d.handovers.vesela),
      model: 'mock',
      provenance: { draftedBy: 'llm:mock', verifiedBy: GYN_NAME, at: '2026-01-12T07:38' },
    },
    values: {},
    carePlan: null,
    tasks: [],
    messages: [],
    mdt: [],
    diagnosis: null,
    treatment: null,
    timeline: { symptom: '2025-12-15', referral: '2026-01-12', mdtDecision: null, treatmentStart: null, ack: null },
    review: { status: 'new' },
  };
}

// 13. 1. afternoon: taken over on 12. 1., markers, nephrology, CT and gynaecological oncology done; MDT on 15. 1.
export function seedVeselaMdt(d) {
  const c = seedVeselaSubmitted(d);
  c.phase = 'active';
  c.takenOverAt = '2026-01-12T08:20';
  applyTemplate(c, d.templates['ovary-v1']);
  const done = { markers: '2026-01-12', nephro: '2026-01-13', ct: '2026-01-13', gynonc: '2026-01-13' };
  for (const t of c.tasks) if (done[t.id]) { t.status = 'done'; t.doneAt = done[t.id]; }
  for (const t of c.tasks) if (t.id === 'mdt1') t.status = 'running';
  c.messages = [
    { id: 'v1', from: 'Koordinátor', to: 'pacient', channel: 'sms', at: '2026-01-12T08:25',
      text: VESELA_SMS },
    { id: 'v2', from: 'Koordinátor', to: GYN_NAME, channel: 'app', at: '2026-01-12T08:30',
      text: 'Dobrý den, paní Veselá je převzata do KOC VFN. Vyšetření 13. 1., MDT gynekoonkologie 15. 1.' },
  ];
  return c;
}

export const VESELA_SMS = 'Nefrologie 13. 1. v 9:00, gynekoonkologie 10:30, CT 13:00 – vše VFN. Ráno se napijte, léky po domluvě s nefrologem.';
export const NOVAK_SMS = 'CT 12. 1. v 8:30, Radiologie VFN, nalačno.';
