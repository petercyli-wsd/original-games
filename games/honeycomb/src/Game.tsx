// Honeycomb on the slot kit. The maths is all in slot.spec.json / slot.config.json / slot-facts.json.
import { SlotGame, parseSlotFacts } from '@originals/slots/ui';
import type { SlotCopy, SlotGameConfig } from '@originals/slots/ui';
import { createSlot, type SlotRound, type SlotSpec } from '@originals/slots';
import { useMemo } from 'react';
import { honeycombSymbols, honeycombTheme } from './art';
import config from './slot.config.json';
import spec from './slot.spec.json';
import factsRaw from './slot-facts.json';
import manifest from './manifest';

const BET = (spec as unknown as SlotSpec).bet.coins;

// The engine labels the respin payout "HOLD & SPIN: n coins". Show the game's own words instead.
// Only the text changes; every coin amount is the engine's.
const copy: SlotCopy = {
  featureName: 'Honey Harvest',
  rule: 'Land 6 honey cells to start Honey Harvest.',
  wildText: 'Worker bee. Stands in for every symbol except honey cells.',
  decorLabels: { 'hold_and_spin_lock_respin.heldVals': (v) => `×${Math.round(v / BET)}` },
};

/** The kit's own engine, with only the respin chip's words changed (amounts and boards untouched). */
function themedEngine() {
  const slot = createSlot({ spec: spec as unknown as SlotSpec, maxWinStakes: config.maxWinStakes });
  const words = (label: string) => label.replace(/^HOLD & SPIN: (\d+) coins/, 'Honey Harvest: $1 cells').replace('(full grid)', '(full comb)');
  return {
    playRound(seed: number, rng32: () => number): SlotRound {
      const r = slot.playRound(seed, rng32);
      return { ...r, base: { ...r.base, extras: r.base.extras.map((e) => ({ ...e, label: words(e.label) })) } };
    },
  };
}

export default function Game() {
  const facts = useMemo(() => parseSlotFacts(factsRaw), []);
  const engine = useMemo(themedEngine, []);
  return (
    <SlotGame
      manifest={{ id: manifest.id, name: manifest.name, accent: manifest.accent }}
      spec={spec as unknown as SlotSpec}
      config={config as unknown as SlotGameConfig}
      facts={facts}
      theme={honeycombTheme}
      symbols={honeycombSymbols}
      copy={copy}
      engine={engine}
    />
  );
}
