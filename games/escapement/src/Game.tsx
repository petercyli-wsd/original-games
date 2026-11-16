// Escapement: a clockmaker's bench. Mounts the slot kit with this game's spec, theme and art.
import { SlotGame, parseSlotFacts } from '@originals/slots/ui';
import type { SlotSpec } from '@originals/slots';
import { copy } from './copy';
import manifest from './manifest';
import { escapementSymbols, escapementTheme } from './art';
import config from './slot.config.json';
import factsRaw from './slot-facts.json';
import featureSpec from './feature.spec.json';
import spec from './slot.spec.json';

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
