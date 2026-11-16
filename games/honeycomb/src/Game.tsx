// Honeycomb on the slot kit. The maths is all in slot.spec.json / slot.config.json / slot-facts.json.
import { SlotGame, parseSlotFacts } from '@originals/slots/ui';
import type { SlotCopy, SlotGameConfig } from '@originals/slots/ui';
import type { SlotSpec } from '@originals/slots';
import { useMemo } from 'react';
import { honeycombSymbols, honeycombTheme } from './art';
import config from './slot.config.json';
import spec from './slot.spec.json';
import factsRaw from './slot-facts.json';
import manifest from './manifest';

const BET = (spec as unknown as SlotSpec).bet.coins;

const copy: SlotCopy = {
  featureName: 'Honey Harvest',
  rule: 'Land 6 honey cells to start Honey Harvest.',
  wildText: 'Worker bee. Stands in for every symbol except honey cells.',
  modifierName: 'Honey Harvest',
  modifierIntro: 'You start with 3. New cells reset it.',
  modifierRules: ['Honey cells lock in place.', 'You get 3 respins.', 'Each new cell resets them to 3.', 'A full comb pays a bonus.'],
  respinLabel: 'Harvest',
  mainFeature: 'respin',
  // Engine text -> the game's own words. Only the words change; every amount is the engine's.
  extrasLabels: (raw) => raw.replace(/^HOLD & SPIN: (\d+) coins/, 'Honey Harvest: $1 cells').replace('(full grid)', '(full comb)'),
  decorLabels: { 'hold_and_spin_lock_respin.heldVals': (v) => `×${Math.round(v / BET)}` },
};

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
