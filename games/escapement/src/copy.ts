import type { SlotCopy } from '@originals/slots/ui';

// Every line here is under 9 words (checkCopy in slot.test.ts): a blind reviewer can't read longer ones.
export const copy: SlotCopy = {
  featureName: 'Grand Complication',
  // The feature's rule (the Chime): the hour hand climbs one hour per free spin, and the board pays ×hour.
  introNote: 'The hour climbs: spin n pays ×n',
  featureRule: 'Each free spin strikes one hour higher',
  rule: 'Any win locks its gears. The rest respin.',
  wildText: 'Wild on reels 2–4. Fills its whole reel.',
  scatterText: '3+ keys anywhere start Grand Complication',
  symbolText: {
    1: '3+ anywhere start Grand Complication',
    2: 'Wild on reels 2–4. Fills its whole reel.',
  },
  paytableFirst: [2, 1],
  modifierName: 'Winding',
  respinLabel: 'Tick',
  mainFeature: 'free',
  modifierIntro: 'Locked gears hold. The rest respin.',
  modifierRules: [
    'Any win locks its gears',
    'Open cells respin each tick',
    'It stops when a tick locks nothing',
    'Up to 4 ticks per chain',
    'One payment on the final board',
  ],
  chainRule: 'Wins lock. Others respin. Up to 4 ticks.',
};
