import { SlotGame, parseSlotFacts, type SlotCopy } from '@originals/slots/ui';
import type { SlotGameConfig } from '@originals/slots/ui';
import type { SlotSpec } from '@originals/slots';
import { calderaSymbols, calderaTheme } from './art';
import featureSpec from './feature.spec.json';
import facts from './slot-facts.json';
import config from './slot.config.json';
import spec from './slot.spec.json';
import manifest from './manifest';

const copy: SlotCopy = {
  featureName: 'Eruption spins',
  introNote: 'Pressure starts at ×4. Wins hit harder.',
  rule: '5 or more touching win. Cascades build pressure.',
  wildText: 'Lava pools replace any symbol except fumaroles.',
  scatterText: '3 fumaroles start Eruption spins.',
  ladder: { label: 'Pressure' },
  featureRule: 'Pressure starts at ×4. Cascades climb.',
};

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
    />
  );
}
