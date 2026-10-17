// Demo case registry: which care-plan template a case uses, its starting state, and which
// pre-baked factory a screen shows while the live (stored) case has not progressed that far.
import {
  seedDraft, seedActive, seedMdt, seedClosed, seedVeselaSubmitted, seedVeselaMdt, NOVAK_SMS, VESELA_SMS,
  seedProchazkovaSubmitted, seedProchazkovaMdt, PROCH_SMS, PROCH_COORDINATOR,
} from './seed.js';

export const CASES = {
  novak: {
    template: 'pancreas-v1',
    initial: seedDraft,
    initialPhase: 'draft',
    gpFlow: true, // starts on the GP screen
    mdtReport: true, // has a sample MDT report for step 04
    takeoverSms: NOVAK_SMS,
    mdtLabel: 'MDT HPB · 13. 1. 14:00',
    prebaked(screen, phase) {
      if (screen === 'koordinator' && phase === 'draft') return seedActive;
      if (screen === 'mdt' && (phase === 'draft' || phase === 'submitted')) return seedMdt;
      if (screen === 'revizni' && phase !== 'closed') return seedClosed;
      return null;
    },
  },
  vesela: {
    template: 'ovary-v1',
    initial: seedVeselaSubmitted,
    initialPhase: 'submitted',
    gpFlow: false, // referred by a gynaecologist outside the demo; starts in the coordinator queue
    mdtReport: false,
    takeoverSms: VESELA_SMS,
    mdtLabel: 'MDT gynekoonkologie · 15. 1. 13:00',
    prebaked(screen, phase) {
      if (screen === 'mdt' && phase === 'submitted') return seedVeselaMdt;
      return null;
    },
  },
  // Rakathon 2026 competition case (data/rakathon_final_all): KOC Nemocnice Lipová, MDT GIT 21. 10. 2026.
  prochazkova: {
    template: 'pancreas-koc2',
    initial: seedProchazkovaSubmitted,
    initialPhase: 'submitted',
    gpFlow: false, // the GP's request (report 07) arrives as a document, without results
    mdtReport: true,
    takeoverSms: PROCH_SMS,
    mdtLabel: 'MDT GIT · 21. 10. 14:00',
    kocLabel: 'KOC Nemocnice Lipová',
    // own demo clock: taken over on the day of the request, board on 21. 10.
    demoDates: { koordinator: '2026-10-02', mdt: '2026-10-21' },
    coordinator: { name: PROCH_COORDINATOR, role: 'koordinátorka KOC Nemocnice Lipová' },
    mdtChair: { name: 'doc. MUDr. Pavel Hrubý, Ph.D.', role: 'předsedající MDT pro nádory GIT, KOC Nemocnice Lipová' },
    sendAt: '2026-10-21T16:10', // MDT record sent to the GP the same day
    ackAt: '2026-10-21T17:02', // delivery confirmed by the GP
    demoDoc: 'data/demo/handover-prochazkova.docx', // coordinator screen: sample handover (Handover_obsah) to scan
    mdtDoc: 'Zapis_MDT_GIT_Prochazkova_2026-10-21.pdf',
    prebaked(screen, phase) {
      if (screen === 'mdt' && phase === 'submitted') return seedProchazkovaMdt;
      return null;
    },
  },
};

export const CASE_IDS = Object.keys(CASES);
