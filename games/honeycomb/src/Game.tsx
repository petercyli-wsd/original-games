// Honeycomb on the slot kit. The maths is all in slot.spec.json / slot.config.json / slot-facts.json.
import { SlotGame, parseSlotFacts } from '@originals/slots/ui';
import type { SlotGameConfig } from '@originals/slots/ui';
import type { SlotSpec } from '@originals/slots';
import { useMemo } from 'react';
import { honeycombSymbols, honeycombTheme } from './art';
import config from './slot.config.json';
import { copy } from './copy';
import spec from './slot.spec.json';
import factsRaw from './slot-facts.json';
import manifest from './manifest';

export default function Game() {
  const facts = useMemo(() => parseSlotFacts(factsRaw), []);
  return (
    <SlotGame
      manifest={{ id: manifest.id, name: manifest.name, accent: manifest.accent }}
      spec={spec as unknown as SlotSpec}
      config={config as unknown as SlotGameConfig}
      facts={facts}
      theme={honeycombTheme}
      symbols={honeycombSymbols}
      copy={copy}
    />
  );
}
