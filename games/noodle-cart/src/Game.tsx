import { SlotGame, parseSlotFacts } from '@originals/slots/ui';
import type { SlotGameConfig } from '@originals/slots/ui';
import { createSlot } from '@originals/slots';
import type { SlotSpec } from '@originals/slots';
import manifest from './manifest';
import { noodleSymbols, noodleTheme, ticketHidden, extraCookTag, cookFx } from './art';
import { holdsTicket, noteRound } from './walker';
import spec from './slot.spec.json';
import featureSpec from './feature.spec.json';
import config from './slot.config.json';
import { copy } from './copy';
import factsRaw from './slot-facts.json';

const facts = parseSlotFacts(factsRaw);


const baseSpec = spec as unknown as SlotSpec;
const rushSpec = featureSpec as unknown as SlotSpec;
const inner = createSlot({
  spec: baseSpec,
  featureSpecs: { 'feature.spec.json': rushSpec },
  feature: (config as unknown as SlotGameConfig).feature ?? null,
  maxWinStakes: (config as unknown as SlotGameConfig).maxWinStakes,
});
// The same engine, plus a note of which tickets the cook covered, for the overlay.
const engine = {
  playRound(seed: number, rng32: () => number) {
    const round = inner.playRound(seed, rng32);
    noteRound(baseSpec, rushSpec, round);
    return round;
  },
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
      engine={engine}
      symbolFx={{ 2: cookFx }}
      renderOverlay={({ col, row, symbol, decor }) => {
        if (holdsTicket(decor, col, row, symbol)) return ticketHidden;
        const ex = decor?.['expanding_wild.expandedReels'];
        if (symbol === 2 && row === 0 && Array.isArray(ex) && ex.includes(col)) return extraCookTag;
        return null;
      }}
    />
  );
}
