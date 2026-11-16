import { SlotGame, parseSlotFacts, type SlotCopy } from '@originals/slots/ui';
import manifest from './manifest';
import { finaleFx, finaleSymbols, finaleTheme } from './art';
import spec from './slot.spec.json';
import featureSpec from './feature.spec.json';
import config from './slot.config.json';
import factsRaw from './slot-facts.json';
import type { SlotSpec } from '@originals/slots';

const facts = parseSlotFacts(factsRaw);

// Short lines only: every line is under 9 words.
const copy: SlotCopy = {
  featureName: 'Finale spins',
  introNote: 'More rockets. Bigger numbers.',
  rule: '10+ of a kind pays anywhere.',
  wildText: 'Any firework. Its +N joins the multiplier.',
  scatterText: 'Fuse pays anywhere. 4 fuses = 12 spins.',
  decorLabels: { 'global_additive.wildMults': (v) => `+${v}` },
};

export { copy };

export default function Game() {
  return (
    <SlotGame
      manifest={manifest}
      spec={spec as unknown as SlotSpec}
      featureSpecs={{ 'feature.spec.json': featureSpec as unknown as SlotSpec }}
      config={config as never}
      facts={facts}
      theme={finaleTheme}
      symbols={finaleSymbols}
      copy={copy}
      symbolFx={finaleFx}
    />
  );
}
