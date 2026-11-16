// Honeycomb's own words (each line under 9 words).
import type { SlotCopy } from '@originals/slots/ui';
import type { SlotSpec } from '@originals/slots';
import spec from './slot.spec.json';

const BET = (spec as unknown as SlotSpec).bet.coins;

export const QUEEN = 12;
export const HONEY = 11;

export const copy: SlotCopy = {
  featureName: 'Honey Harvest',
  rule: 'Honey on all 5 reels starts the harvest.',
  wildText: 'Worker bee: wild for every pay symbol.',
  modifierName: 'Honey Harvest',
  modifierIntro: 'A queen on the last respin multiplies all.',
  modifierRules: [
    'Honey cells lock in place.',
    'Each new cell resets respins to 3.',
    'A queen on the last respin multiplies all.',
    'Queens add up: ×2 + ×3 = ×5.',
    'Full comb bonus: 1,000×.',
    'Total win is capped at 2,000×.',
  ],
  chainRule: 'Queen on the last respin multiplies all.',
  symbolText: {
    [QUEEN]: "Multiplies her board's win ×2 to ×10.",
    [HONEY]: 'Worth ×1 to ×100; five start the harvest.',
  },
  paytableFirst: [QUEEN, HONEY, 1],
  respinLabel: 'Respin',
  respinsLeftLabel: 'Respins left',
  fillLabel: 'Comb',
  mainFeature: 'respin',
  // Engine text -> the game's own words. Only the words change; every amount is the engine's.
  extrasLabels: (raw) =>
    raw
      .replace(/^HOLD & SPIN: (\d+) coins/, 'Honey Harvest: $1 cells')
      .replace('(full grid)', '(full comb)')
      .replace(/^ORB SUM x(\d+)/, 'Queen ×$1'),
  decorLabels: { 'hold_and_spin_lock_respin.heldVals': (v) => `×${Math.round(v / BET)}` },
};
