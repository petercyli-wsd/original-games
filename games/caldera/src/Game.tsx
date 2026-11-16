import { SlotGame, parseSlotFacts } from '@originals/slots/ui';
import type { SlotGameConfig } from '@originals/slots/ui';
import type { SlotSpec } from '@originals/slots';
import { calderaSymbols, calderaTheme, lavaFx } from './art';
import { LAVA, copy } from './copy';
import featureSpec from './feature.spec.json';
import facts from './slot-facts.json';
import config from './slot.config.json';
import spec from './slot.spec.json';
import manifest from './manifest';

export default function Game() {
  return (
    <SlotGame
      manifest={manifest}
      spec={spec as unknown as SlotSpec}
      featureSpecs={{ 'feature.spec.json': featureSpec as unknown as SlotSpec }}
      config={config as unknown as SlotGameConfig}
      facts={parseSlotFacts(facts)}
      theme={calderaTheme}
      symbols={calderaSymbols}
      copy={copy}
      symbolFx={{ [LAVA]: lavaFx }}
    />
  );
}
