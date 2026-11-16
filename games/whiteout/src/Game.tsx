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
export const copy: SlotCopy = {
  featureName: 'Whiteout spins',
  introNote: 'Spin 5 pays ×5. The storm builds.',
  rule: 'Drift rows change every spin. Wins slide away.',
  wildText: 'Cornice replaces all but beacons.',
  scatterText: '4 beacons anywhere start Whiteout spins.',
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
