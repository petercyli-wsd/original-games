import type { SlotCopy } from '@originals/slots/ui';

// Dinner rush's rule: every new order ticket adds a spin and raises the multiplier by 1.
export const copy: SlotCopy = {
  featureName: 'Dinner rush',
  introNote: 'Each ticket: +1 spin, multiplier +1',
  featureRule: 'New tickets add spins and raise the multiplier.',
  rule: 'A cook steps in as a wild reel.',
  wildText: 'Rush: a cook on reels 2-4 fills it',
  scatterText: 'Cook on reel 1, 3, 5 hides tickets',
  wildTag: false,
  paytableFirst: [2, 1],
  mainFeature: 'free',
};
