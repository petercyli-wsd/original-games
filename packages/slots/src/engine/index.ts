// @originals/slots engine: the runtime a slot game plays on.
//
// Every board comes from the TypeScript port of the engine pack (byte-for-byte parity, see
// parity.test.ts): spin(seed) runs Mulberry32(seed) through the spec's reel engine, so any spin
// can be replayed by the pack (`enginepack.base.spin_json(engine, seed)`). At runtime each paid
// spin's seed (and each free spin's seed) is a fresh 32-bit draw from the host's crypto RNG.
//
//   const slot = createSlot({ spec, featureSpecs: { 'feature.spec.json': fspec }, feature, maxWinStakes: 5000 });
//   const round = slot.playRound(rng.u32(), () => rng.u32());   // after `await ticket.place()`
//
// Free spins follow the law in ./analytics/config.ts (the one the feature algebra prices):
// awards by scatter count K (counted on the board the pack's trigger read), retriggers (one counts
// whenever award(retrigger, K) > 0, even when maxSpins clips it), maxSpins, and an INTEGER
// multiplier that depends only on the spin index and the retriggers so far. Max win: the round pays at most maxWinStakes × stake; a round
// that reaches the cap ends there and pays the cap.

import { award, multiplierAt, type FeatureConfig } from './analytics/config';
import { canonicalResult } from './canonical';
import { SlotEngine } from './engine';
import { Mulberry32 } from './rng';
import type { FeatureRound, SlotRound, SlotSpec, SpinResult } from './types';

export * from './types';
export type { FeatureConfig, FreeSpinsConfig, MultiplierSchedule, SlotConfig } from './analytics/config';
export { award, multiplierAt } from './analytics/config';
export { SlotEngine, compileSpec } from './engine';
export { Mulberry32, type SpinRng } from './rng';
export { canonicalJson } from './canonical';
export { knownIds as portedMechanics } from './mechanics/registry';

/** The pack's canonical spin for spec + seed (object for object what `base.spin_json` gives). */
export function canonicalSpin(spec: SlotSpec, seed: number): SpinResult {
  return new SlotEngine(spec).spin(seed);
}

/**
 * The scatter count K that the pack's trigger read: on the base board, or on the terminal board
 * when the spec's continuation settles scatters there (tumbles: refills can add scatters).
 */
export function triggerScatters(engine: SlotEngine, result: SpinResult): number {
  if (engine.scatter === null) return 0;
  const cont = engine.stage('continuation');
  const terminal = cont.length > 0 && cont[0].SETTLES_SCATTER === 'terminal';
  const board = terminal ? result.finalBoard : result.steps[0].board;
  let n = 0;
  for (const col of board) for (const v of col) if (v === engine.scatter) n++;
  return n;
}

export interface CreateSlotOptions {
  /** The base game spec (game_spec_v2; `games/<id>/src/slot.spec.json`). */
  spec: SlotSpec;
  /** Feature spin specs, keyed by the file name `feature.spec` names (e.g. "feature.spec.json"). */
  featureSpecs?: Record<string, SlotSpec>;
  /** The feature rules (`slot.config.json` `feature`); falls back to `spec.feature` when present. */
  feature?: FeatureConfig | null;
  /** The max-win cap in stakes (docs/SLOTS.md §2.7). */
  maxWinStakes: number;
}

export interface Slot {
  readonly spec: SlotSpec;
  readonly engine: SlotEngine;
  readonly featureEngine: SlotEngine | null;
  readonly feature: FeatureConfig | null;
  /** Stake in coins (spec.bet.coins); a win in stakes is coins / stake. */
  readonly stakeCoins: number;
  readonly maxWinCoins: number;
  /** The base spin on Mulberry32(seed). */
  spin(seed: number): SpinResult;
  /** One paid round: the base spin, any free spins it triggered (seeds from rng32), the cap. */
  playRound(seed: number, rng32?: () => number): SlotRound;
}

function lookupFeatureSpec(featureSpecs: Record<string, SlotSpec> | undefined, path: string): SlotSpec | undefined {
  if (!featureSpecs) return undefined;
  const base = path.split('/').pop() ?? path;
  const stem = base.replace(/\.spec\.json$/, '').replace(/\.json$/, '');
  return featureSpecs[path] ?? featureSpecs[base] ?? featureSpecs[stem];
}

export function createSlot(opts: CreateSlotOptions): Slot {
  const engine = new SlotEngine(opts.spec);
  const feature = opts.feature ?? ((opts.spec as { feature?: FeatureConfig }).feature ?? null);
  let featureEngine: SlotEngine | null = null;
  if (feature) {
    if (feature.kind !== 'free_spins') throw new Error(`feature.kind '${String((feature as { kind: unknown }).kind)}' is not supported (free_spins only)`);
    const fspec = lookupFeatureSpec(opts.featureSpecs, feature.spec);
    if (!fspec) throw new Error(`feature spec '${feature.spec}' not given in featureSpecs`);
    featureEngine = new SlotEngine(fspec);
    if (featureEngine.betCoins !== engine.betCoins) {
      throw new Error(`feature spec stake ${featureEngine.betCoins} != base stake ${engine.betCoins} (coins must share one unit)`);
    }
    if (engine.scatter === null) throw new Error('a free-spins feature needs a scatter symbol in the base spec');
    if (!(feature.maxSpins >= 1)) throw new Error('feature.maxSpins must be >= 1');
    // integer multipliers only: the runtime then pays exactly Σ m_j·W_j, the value the algebra prices
    const m = feature.multiplier as unknown as Record<string, unknown>;
    for (const key of ['value', 'start', 'step']) {
      if (key in m && !Number.isInteger(m[key])) throw new Error(`feature.multiplier.${key} must be an integer (got ${String(m[key])})`);
    }
  }
  if (!(opts.maxWinStakes > 0)) throw new Error('maxWinStakes must be > 0');
  const stake = engine.betCoins;
  const maxWinCoins = Math.floor(opts.maxWinStakes * stake);

  const spin = (seed: number) => engine.spin(seed >>> 0);

  const playRound = (seed: number, rng32?: () => number): SlotRound => {
    const base = spin(seed);
    let total = base.totalCoins;
    if (total >= maxWinCoins) return { seed: seed >>> 0, base, feature: null, totalCoins: maxWinCoins, capped: true };
    let fround: FeatureRound | null = null;
    let capped = false;
    if (feature && featureEngine && base.trigger?.fired) {
      const k = triggerScatters(engine, base);
      const awarded = Math.min(award(feature.awards, k), feature.maxSpins);
      if (awarded > 0) {
        if (!rng32) throw new Error('playRound: the base spin triggered free spins; pass rng32 (the host 32-bit RNG) for their seeds');
        fround = { kind: 'free_spins', spins: [], totalCoins: 0 };
        let left = awarded;
        let played = 0;
        let granted = awarded;
        let retriggers = 0;
        while (left > 0) {
          const j = played + 1;
          const fseed = rng32() >>> 0;
          const result = featureEngine.spin(fseed);
          const mult = multiplierAt(feature.multiplier, j, retriggers);
          if (!Number.isInteger(mult) || mult < 0) throw new Error(`free spin ${j}: multiplier ${mult} is not a non-negative integer`);
          let coins = result.totalCoins * mult;
          const kk = triggerScatters(featureEngine, result);
          const a = award(feature.retrigger, kk);
          const extra = Math.max(0, Math.min(a, feature.maxSpins - granted));
          granted += extra;
          if (a > 0) retriggers += 1; // counts even when maxSpins clips the spins it adds (the algebra's rule)
          left += extra - 1;
          played = j;
          if (total + coins >= maxWinCoins) {
            coins = maxWinCoins - total;
            capped = true;
          }
          total += coins;
          fround.totalCoins += coins;
          fround.spins.push({ seed: fseed, result, multiplier: mult, coins, retrigger: extra });
          if (capped) break;
        }
      }
    }
    return { seed: seed >>> 0, base, feature: fround, totalCoins: total, capped };
  };

  return { spec: opts.spec, engine, featureEngine, feature, stakeCoins: stake, maxWinCoins, spin, playRound };
}

/** Replay helper: the raw engine spin on an explicit Mulberry32 stream (tests, tools). */
export function spinOnStream(engine: SlotEngine, seed: number): SpinResult {
  return canonicalResult(engine.spinRaw(new Mulberry32(seed >>> 0)), engine.decorSchema);
}
