import { SlotGame, parseSlotFacts, type SlotCopy } from '@originals/slots/ui';
import type { SlotSpec } from '@originals/slots';
import { midnightSymbols, midnightTheme } from './art';
import manifest from './manifest';
import spec from './slot.spec.json';
import featureSpec from './feature.spec.json';
import config from './slot.config.json';
import rawFacts from './slot-facts.json';

const copy: SlotCopy = {
  featureName: 'The Abyss',
  rule: '8 or more of a kind pay anywhere.',
  scatterText: 'Anglerfish lures pay nowhere. 4 start The Abyss.',
  introNote: 'Deeper boards. Bigger jellyfish.',
};

const facts = parseSlotFacts(rawFacts);

export default function MidnightZone() {
  return (
    <SlotGame
      manifest={manifest}
      spec={spec as unknown as SlotSpec}
      featureSpecs={{ 'feature.spec.json': featureSpec as unknown as SlotSpec }}
      config={config as never}
      facts={facts}
      theme={midnightTheme}
      symbols={midnightSymbols}
      copy={copy}
    />
  );
}
