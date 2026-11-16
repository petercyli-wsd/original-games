// Caldera's own words (each line under 9 words: the blind reviewer can't read longer ones).
import type { SlotCopy } from '@originals/slots/ui';

export const LAVA = 2;
export const FUMAROLE = 1;

export const copy: SlotCopy = {
  featureName: 'Eruption spins',
  // the signature rule: lava cools one level per win it pays in (power_wild_level, 2 in base, 3 in the feature)
  introNote: 'Lava stays 3 wins. Pressure resets each spin.',
  rule: '5+ touching win. Lava stays 2 wins.',
  wildText: 'Wild. Stays for 2 wins, 3 in Eruption.',
  scatterText: '3 fumaroles start Eruption spins.',
  ladder: { label: 'Pressure' },
  featureRule: 'Lava stays 3 wins. Pressure resets each spin.',
  paytableFirst: [LAVA, FUMAROLE],
  // the engine's landing levels (power_wild_level.levels) are not drawn as badges: every lava lands at the same level
  decorLabels: { 'power_wild_level.levels': () => '' },
};
