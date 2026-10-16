// Demo case registry: which care-plan template a case uses, its starting state, and which
// pre-baked factory a screen shows while the live (stored) case has not progressed that far.
import {
  seedDraft, seedActive, seedMdt, seedClosed, seedVeselaSubmitted, seedVeselaMdt, NOVAK_SMS, VESELA_SMS,
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
};

export const CASE_IDS = Object.keys(CASES);
