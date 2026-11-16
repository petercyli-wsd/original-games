// Escapement: a clockmaker's bench. Mounts the slot kit with this game's spec, theme and art.
import { SlotGame, parseSlotFacts, type SlotCopy } from '@originals/slots/ui';
import type { SlotSpec } from '@originals/slots';
import manifest from './manifest';
import { escapementSymbols, escapementTheme } from './art';
import config from './slot.config.json';
import factsRaw from './slot-facts.json';
import featureSpec from './feature.spec.json';
import spec from './slot.spec.json';

const copy: SlotCopy = {
  featureName: 'Grand Complication',
  introNote: 'More pendulums on reels 2 to 4',
  rule: 'Any win locks its gears. The rest respin.',
  wildText: 'Pendulum swings to fill reels 2 to 4.',
  scatterText: '3 winding keys start Grand Complication.',
  modifierName: 'Winding',
  respinLabel: 'Tick',
  modifierIntro: 'Locked gears hold. The rest respin.',
  modifierRules: ['Any win locks its gears', 'Open cells respin each tick', 'It stops when a tick locks nothing', 'One payment on the final board'],
};

const facts = parseSlotFacts(factsRaw);

export default function Game() {
  return (
    <SlotGame
      manifest={{ id: manifest.id, name: manifest.name, accent: manifest.accent }}
      spec={spec as unknown as SlotSpec}
      featureSpecs={{ 'feature.spec.json': featureSpec as unknown as SlotSpec }}
      config={config as never}
      facts={facts}
      theme={escapementTheme}
      symbols={escapementSymbols}
      copy={copy}
    />
  );
}
