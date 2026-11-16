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

const copy: SlotCopy = {
  featureName: 'Bonus stage',
  introNote: 'Bonus marquee: ×2 to ×25',
  rule: 'Match 3 on a line. Marquee multiplies wins.',
  wildText: 'Glitch block on reel 2 is wild',
  extrasLabels: (raw) => {
    if (/scatter/i.test(raw)) return 'Scatter pay';
    const m = /\bx\s*(\d+)/i.exec(raw);
    return m ? `Marquee ×${m[1]}` : 'Marquee total';
  },
  multiplierReel: { label: 'Marquee' },
  scatterText: '3 golden tokens start the bonus stage.',
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
