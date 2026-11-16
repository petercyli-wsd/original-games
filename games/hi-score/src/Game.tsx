import { SlotGame, parseSlotFacts } from '@originals/slots/ui';
import type { SlotCopy, SlotGameConfig } from '@originals/slots/ui';
import type { SlotSpec } from '@originals/slots';
import manifest from './manifest';
import { hiScoreSymbols, hiScoreTheme } from './art';
import spec from './slot.spec.json';
import featureSpec from './feature.spec.json';
import config from './slot.config.json';
import factsRaw from './slot-facts.json';

const facts = parseSlotFacts(factsRaw);

export const copy: SlotCopy = {
  featureName: 'Bonus stage',
  introNote: 'Level up: ×2, ×3, ×4 each spin',
  rule: 'Match 3 on a line. Hearts from 2.',
  featureRule: 'Each spin levels up. 3 tokens: extra life.',
  wildText: 'Glitch block on reel 2 is wild',
  extrasLabels: (raw) => {
    if (/scatter/i.test(raw)) return 'Scatter pay';
    const m = /\bx\s*(\d+)/i.exec(raw);
    return m ? `Marquee ×${m[1]}` : 'Marquee total';
  },
  multiplierReel: { label: 'Marquee', dimOnLoss: true, values: { base: [1, 2, 3, 5, 10], feature: [1] } },
  scatterText: '3 golden tokens: bonus stage, extra lives.',
  symbolText: { 6: 'Hearts pay from 2.' },
};

export default function Game() {
  return (
    <SlotGame
      manifest={manifest}
      spec={spec as unknown as SlotSpec}
      featureSpecs={{ 'feature.spec.json': featureSpec as unknown as SlotSpec }}
      config={config as unknown as SlotGameConfig}
      facts={facts}
      theme={hiScoreTheme}
      symbols={hiScoreSymbols}
      copy={copy}
    />
  );
}
