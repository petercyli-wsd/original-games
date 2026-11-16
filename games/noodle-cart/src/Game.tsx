import { SlotGame, parseSlotFacts } from '@originals/slots/ui';
import type { SlotCopy, SlotGameConfig } from '@originals/slots/ui';
import type { SlotSpec } from '@originals/slots';
import manifest from './manifest';
import { noodleSymbols, noodleTheme } from './art';
import spec from './slot.spec.json';
import featureSpec from './feature.spec.json';
import config from './slot.config.json';
import factsRaw from './slot-facts.json';

const facts = parseSlotFacts(factsRaw);

const copy: SlotCopy = {
  featureName: 'Dinner rush',
  introNote: 'A second cook joins the stall',
  rule: 'Match 3 on a line. One reel runs wild.',
  wildText: 'The cook turns one reel wild every spin.',
  scatterText: 'The cook can cover tickets on his reel.',
};

export default function Game() {
  return (
    <SlotGame
      manifest={manifest}
      spec={spec as unknown as SlotSpec}
      featureSpecs={{ 'feature.spec.json': featureSpec as unknown as SlotSpec }}
      config={config as unknown as SlotGameConfig}
      facts={facts}
      theme={noodleTheme}
      symbols={noodleSymbols}
      copy={copy}
    />
  );
}
