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
      id: t.id, title: t.title, short: t.short, note: t.note || '', owner: t.owner, place: t.place || null,
      priority: t.priority || 'normal', dependsOn: [...(t.dependsOn || [])], auto: !!t.auto, afterMdt: !!t.afterMdt,
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
    if (t.status === 'done' || t.afterMdt) return; // follow-up care after the board stays open
    t.status = 'done';
    t.doneAt = t.id === 'feedback' ? at.slice(0, 10) : t.due.slice(0, 10);
  });
  c.phase = 'closed-pending-ack';
  c.sentAt = at;
  c.messages.push({ id: `m${Date.now()}a`, from: 'Koordinátor', to: c.serviceRequest.requester, channel: 'app', at,
    text: `Závěr MDT a plán léčby ${c.patient.refGen}: ${s.diagnosis}. ${s.treatment.plan} Původní referování a handover jsou přiloženy.` });
  // the reviewing doctor is the VZP's (insurer 111); other insurers get no automatic review hand-off
  if (c.patient.insurer === '111') {
    c.messages.push({ id: `m${Date.now()}b`, from: 'Systém', to: 'Revizní lékař VZP', channel: 'app', at,
      text: 'Uzavřený případ předán automaticky k revizi (souhrn, indikátory, zprávy z MDT).' });
  }
}

export function acknowledge(c, at = ACK_AT) {
  c.phase = 'closed';
  c.timeline.ack = at;
  if (c.id === 'novak' && !c.values.ecog) {
    // Demo: GP answered the ECOG request late (13. 1.), before closing.
    c.values.ecog = { value: 1, at: '2026-01-13', by: GP_NAME };
  }
  c.messages.push({ id: `m${Date.now()}c`, from: c.serviceRequest.requester, to: 'Koordinátor', channel: 'app', at,
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

// --- Alena Procházková: Rakathon 2026 competition case (fictional), KOC Nemocnice Lipová ----------------
// The GP's request (report 07, 2. 10. 2026) arrives without results: they are at five other sites. The
// coordinator requests them, arranges CT in KOC 1 (Nemocnice Severní), EUS-FNB, control labs and histology in
// KOC 2, and prepares the MDT GIT on 21. 10. Reports 12–13 (pain clinic 26. 10., psychology 27. 10.) are written
// after the board and must not enter its podklad.
export const PROCH_GP = 'MUDr. Tomáš Řezníček';
export const PROCH_COORDINATOR = 'Bc. Lucie Dvořáková';
export const PROCH_SMS = 'Dobrý den, jsem koordinátorka KOC Nemocnice Lipová. CT 8. 10. v 7:30 v Nemocnici Severní (Praha 8), nalačno. Další termíny pošlu SMS. Tel. 241 000 650.';

export function seedProchazkovaSubmitted(d) {
  return {
    id: 'prochazkova',
    phase: 'submitted',
    submittedAt: '2026-10-02T11:40',
    serviceRequest: {
      koc: 'lipova-git',
      reasonCode: 'C25.0',
      reasonText: 'C25.0 – suspektní tumor hlavy pankreatu, cholestatický syndrom',
      note: 'Ložisko hlavy pankreatu na UZ 29. 9., CT se nepodařilo zajistit. Urgentní. Apixaban – před výkony vysadit dle kardiologa. Výrazná úzkost – zvážit psychologa.',
      requester: PROCH_GP,
      requesterOrg: 'PL Dolní Břežany',
      requesterDat: 'MUDr. Řezníčkovi', // dative; requesterGen: genitive where it differs
      requesterGen: 'MUDr. Řezníčka',
    },
    patient: {
      name: 'Alena Procházková', birthDate: '1963-07-22', age: 63, sex: 'female',
      ref: 'paní Procházková', refGen: 'paní Procházkové',
      birthNumberMasked: '635722/••••', insurer: '211', insurerLabel: '211 – ZP MV ČR',
      phoneMasked: '+420 777 ••• 541',
      summary: 'paroxysmální FS na apixabanu, hypertenze, hypercholesterolémie · alergie: neguje',
      contact: { name: 'Petra Horká', relation: 'dcera', phone: '+420 777 000 542', consent: true },
    },
    sources: { count: 1, documents: 1, label: 'Žádost PL (dokument) · výsledky na 5 pracovištích' },
    sourcesExcluded: [],
    uploads: [],
    handover: {
      ...structuredClone(d.handovers.prochazkova),
      model: 'mock',
      provenance: { draftedBy: 'llm:mock', verifiedBy: `${PROCH_COORDINATOR} (z žádosti PL)`, at: '2026-10-02T11:40' },
    },
    values: {},
    carePlan: null,
    tasks: [],
    messages: [],
    mdt: [],
    diagnosis: null,
    treatment: null,
    timeline: { symptom: '2026-08-15', referral: '2026-10-02', mdtDecision: null, treatmentStart: null, ack: null },
    review: { status: 'new' },
  };
}

// 21. 10. 2026, MDT GIT: reports 01–06 requested and received, CT, EUS-FNB, labs and histology done;
// ECOG still not documented anywhere (requested from the GP, unanswered). Handover rebuilt from reports 01–11.
export function seedProchazkovaMdt(d) {
  const c = seedProchazkovaSubmitted(d);
  c.phase = 'active';
  c.takenOverAt = '2026-10-02T13:05';
  c.sources = { count: 11, documents: 11, label: 'Shromážděno 11 zpráv (01–11) z 8 pracovišť' };
  c.sourcesExcluded = ['12 Algeziologie 26. 10. 2026', '13 Psychologie 27. 10. 2026'];
  c.handover = {
    ...structuredClone(d.handovers['prochazkova-mdt']),
    model: 'mock',
    provenance: { draftedBy: 'llm:mock', verifiedBy: PROCH_COORDINATOR, at: '2026-10-20T15:30' },
  };
  applyTemplate(c, d.templates['pancreas-koc2']);
  const done = { records: '2026-10-06', ct: '2026-10-08', anticoag: '2026-10-10', eus: '2026-10-12', labs: '2026-10-15', histology: '2026-10-19' };
  for (const t of c.tasks) if (done[t.id]) { t.status = 'done'; t.doneAt = done[t.id]; }
  for (const t of c.tasks) if (t.id === 'mdt1') t.status = 'running';
  for (const t of c.tasks) if (['pain', 'psycho'].includes(t.id)) t.status = 'running';
  c.messages = [
    { id: 'p1', from: 'Koordinátor', to: PROCH_GP, channel: 'app', at: '2026-10-02T13:10',
      text: 'Dobrý den, paní Procházková je převzata do KOC Nemocnice Lipová. CT zajistíme v KOC Nemocnice Severní 8. 10. Prosím o doplnění výkonnostního stavu (ECOG 0–4) a o konkrétní otázku na MDT.', requests: 'ecog' },
    { id: 'p2', from: 'Koordinátor', to: 'pacient', channel: 'sms', at: '2026-10-02T13:15', text: PROCH_SMS },
    { id: 'p3', from: 'Koordinátor', to: 'LabJih, RC Modřany, Poliklinika Jižní (GE, RDG), Kardiologie Jesenice', channel: 'app', at: '2026-10-02T13:30',
      text: 'Žádost o zaslání zpráv: laboratoř 1. 9., RTG plic 3. 9., gastroenterologie 15. 9., UZ břicha 29. 9., kardiologie 20. 7. 2026 (pacientka souhlasí).' },
    { id: 'p4', from: 'Kardiologie Jesenice', to: 'Koordinátor', channel: 'app', at: '2026-10-06T09:20',
      text: 'Zasíláme zprávu z 20. 7. 2026. Apixaban vysadit 48 h před výkonem s vysokým rizikem krvácení, bez překlenovací léčby.' },
    { id: 'p5', from: 'Koordinátor', to: 'pacient', channel: 'sms', at: '2026-10-09T10:00',
      text: 'EUS s biopsií 12. 10. v 8:00, Nemocnice Lipová, endoskopie. Nalačno od půlnoci. Apixaban vysaďte 48 h před výkonem podle pokynu kardiologa.' },
    { id: 'p6', from: 'Koordinátor', to: PROCH_GP, channel: 'app', at: '2026-10-19T14:00', reminder: true, requests: 'ecog',
      text: 'Připomínka: prosím o doplnění výkonnostního stavu (ECOG 0–4) paní Procházkové – podmínka pro MDT 21. 10.' },
  ];
  return c;
}
