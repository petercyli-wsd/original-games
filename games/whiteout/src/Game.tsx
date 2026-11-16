// Whiteout mounts the slot kit with its spec, theme, symbol art, config and measured facts.
// The maths lives in the JSON files next to this one; nothing here changes a pay or a strip.

import { SlotGame, parseSlotFacts, type SlotCopy } from '@originals/slots/ui';
import { whiteoutSymbols, whiteoutTheme } from './art';
import featureSpec from './feature.spec.json';
import config from './slot.config.json';
import facts from './slot-facts.json';
import spec from './slot.spec.json';
import manifest from './manifest';
import type { SlotGameConfig } from '@originals/slots/ui';
import type { SlotSpec } from '@originals/slots';

// Every line stays under 9 words. The variable-height reels are called drift rows.
// The storm's own rule: every Whiteout spin plays on one of three reel sets, each with reel 4, 5 or 6 made only of
// buried snow (a wild), so that reel is wild on the stop and through every slide's refill.
export const copy: SlotCopy = {
  featureName: 'Whiteout spins',
  introNote: 'Buried reel every spin. Multiplier +1 each spin.',
  rule: 'Wins slide away. Each slide climbs the ladder.',
  featureRule: 'Buried reel stays wild through every slide.',
  featureNotes: ['Each spin buries reel 4, 5 or 6.', 'Buried reel stays wild through every slide.', 'Slides past ×8 add +1 each.'],
  wildText: 'Cornice replaces all but beacons.',
  scatterText: '4 beacons anywhere start Whiteout spins.',
  symbolText: { 13: 'Whiteout spins: fills reel 4, 5 or 6.' },
  paytableFirst: [1, 2, 13],
  ladder: { label: 'Slide' },
};

const slotSpec = spec as unknown as SlotSpec;
const featureSpecs = { 'feature.spec.json': featureSpec as unknown as SlotSpec };

export default function Game() {
  return (
    <SlotGame
      manifest={manifest}
      spec={slotSpec}
      featureSpecs={featureSpecs}
      config={config as unknown as SlotGameConfig}
      facts={parseSlotFacts(facts)}
      theme={whiteoutTheme}
      symbols={whiteoutSymbols}
      copy={copy}
    />
  );
}
