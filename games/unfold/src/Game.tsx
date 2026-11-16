import { SlotGame, parseSlotFacts } from '@originals/slots/ui';
import type { SlotCopy, SlotGameConfig } from '@originals/slots/ui';
import type { SlotSpec } from '@originals/slots';
import manifest from './manifest';
import { unfoldSymbols, unfoldTheme } from './art';
import spec from './slot.spec.json';
import featureSpec from './feature.spec.json';
import config from './slot.config.json';
import factsRaw from './slot-facts.json';

const facts = parseSlotFacts(factsRaw);

const copy: SlotCopy = {
  featureName: 'Great Fold',
  introNote: 'Tall squares open together',
  rule: 'Ways pay left to right. Squares open as one.',
  wildText: 'Gold foil stands in for all but suns.',
  scatterText: '3 folded suns start the Great Fold.',
};

export default function Game() {
  return (
    <SlotGame
      manifest={manifest}
      spec={spec as unknown as SlotSpec}
      featureSpecs={{ 'feature.spec.json': featureSpec as unknown as SlotSpec }}
      config={config as unknown as SlotGameConfig}
      facts={facts}
      theme={unfoldTheme}
      symbols={unfoldSymbols}
      copy={copy}
    />
  );
}
