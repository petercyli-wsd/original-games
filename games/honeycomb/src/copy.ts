// Honeycomb's own words (each line under 9 words).
import type { SlotCopy } from '@originals/slots/ui';
import type { SlotSpec } from '@originals/slots';
import spec from './slot.spec.json';

const BET = (spec as unknown as SlotSpec).bet.coins;

export const copy: SlotCopy = {
  featureName: 'Honey Harvest',
  rule: 'Land 6 honey cells to start Honey Harvest.',
  wildText: 'Worker bee: wild, not for honey cells.',
  modifierName: 'Honey Harvest',
  modifierIntro: 'Cells ×1 to ×500. Full comb 1,000×.',
  modifierRules: ['Honey cells lock in place.', 'You get 3 respins.', 'Each new cell resets them to 3.', 'Cells pay ×1 to ×500.', 'Full comb bonus: 1,000×.', 'Total win is capped at 2,000×.'],
  respinLabel: 'Respin',
  respinsLeftLabel: 'Respins left',
  fillLabel: 'Comb',
  mainFeature: 'respin',
  // Engine text -> the game's own words. Only the words change; every amount is the engine's.
  extrasLabels: (raw) => raw.replace(/^HOLD & SPIN: (\d+) coins/, 'Honey Harvest: $1 cells').replace('(full grid)', '(full comb)'),
  decorLabels: { 'hold_and_spin_lock_respin.heldVals': (v) => `×${Math.round(v / BET)}` },
};

