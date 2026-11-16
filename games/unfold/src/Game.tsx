import { SlotGame, parseSlotFacts } from '@originals/slots/ui';
import type { SlotGameConfig } from '@originals/slots/ui';
import type { SlotSpec } from '@originals/slots';
import manifest from './manifest';
import { copy } from './copy';
import { unfoldCorner, unfoldFx, unfoldSymbols, unfoldTheme } from './art';
import spec from './slot.spec.json';
import featureSpec from './feature.spec.json';
import config from './slot.config.json';
import factsRaw from './slot-facts.json';

const facts = parseSlotFacts(factsRaw);

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
      symbolFx={unfoldFx}
      renderOverlay={unfoldCorner}
    />
  );
}
