// The one place the UI touches the engine, plus the dev hooks that pick seeds.
//
// `createSlot({ spec, featureSpecs, feature, maxWinStakes })` comes from `../engine`. Its `playRound(seed, rng32)`
// takes a 32-bit seed and a uint32 source for the free spins' seeds; both come from the host RNG, after the bet.

import { seededSource } from '@originals/game-sdk';
import type { Rng } from '@originals/game-sdk';
import { createSlot } from '../engine';
import type { SlotRound } from '../engine/types';
import type { SlotGameProps, SlotEngine } from './types';

export function resolveEngine({ engine, spec, featureSpecs, config }: Pick<SlotGameProps, 'engine' | 'spec' | 'featureSpecs' | 'config'>): SlotEngine {
  if (engine) return engine;
  return createSlot({ spec, featureSpecs, feature: config.feature ?? null, maxWinStakes: config.maxWinStakes });
}

/** A deterministic uint32 source for a seed, used only when a seed is forced by a dev hook (replays). */
export function seededRng32(seed: number): () => number {
  const src = seededSource(seed);
  return () => Math.floor(src() * 2 ** 32) >>> 0;
}

export interface Draw {
  seed: number;
  rng32: () => number;
}

export interface SeedSource {
  /** The next round's seed and rng. Normal play: seed and every draw from the host RNG. A forced seed is used once. */
  next(): Draw;
  /** Dev: the next spin uses this seed. */
  forceSeed(seed: number): void;
  /** Dev: searches seeds with the engine until one triggers the feature, and forces it for the next spin. Returns it, or null. */
  forceFeature(): number | null;
  /** Dev: the same for a round that wins at least `stakes` × the bet (use it to see the big-win banners and tumbles). */
  forceWin(stakes: number): number | null;
}

/**
 * Seeds for `SlotGame`. Outcomes are always drawn after the bet is placed (the caller calls `next()` after
 * `await ticket.place()`); the host RNG supplies the seed and every later draw. The dev hooks
 * (`?seed=<n>`, `?feature=1`, `?win=<stakes>`, `window.__slotDev`) exist so a blind reviewer can reach a feature.
 */
export function createSeedSource(engine: SlotEngine, rng: Rng, betCoins: number, search = { maxSeeds: 200000, maxMs: 5000 }): SeedSource {
  let forced: number | null = null;
  let cursor = 1;
  /** Searches seeds from the cursor on until `ok(round)`; forces that seed for the next spin. */
  const find = (ok: (r: SlotRound) => boolean): number | null => {
    // A random start each time (from the host RNG), so every page load forces a different round; the seed found is still replayable.
    cursor = rng.int(2 ** 32);
    const t0 = Date.now();
    for (let i = 0; i < search.maxSeeds && Date.now() - t0 < search.maxMs; i++, cursor++) {
      const s = cursor >>> 0;
      if (ok(engine.playRound(s, seededRng32(s)))) {
        forced = s;
        cursor++;
        return s;
      }
    }
    return null;
  };
  const src: SeedSource = {
    next() {
      if (forced !== null) {
        const seed = forced;
        forced = null;
        return { seed, rng32: seededRng32(seed) };
      }
      return { seed: rng.int(2 ** 32), rng32: () => rng.int(2 ** 32) };
    },
    forceSeed(seed) {
      forced = seed >>> 0;
    },
    forceFeature() {
      return find((r) => !!r.feature);
    },
    forceWin(stakes) {
      return find((r) => r.totalCoins / betCoins >= stakes);
    },
  };
  return src;
}

/** Reads the dev query (?seed=, ?feature=1) and exposes `window.__slotDev`. Returns a cleanup. */
export function installDevHooks(src: SeedSource): () => void {
  try {
    const q = new URLSearchParams(window.location.search);
    const seed = q.get('seed');
    const win = q.get('win');
    if (seed !== null && /^\d+$/.test(seed)) src.forceSeed(Number(seed));
    else if (q.get('feature') === '1') src.forceFeature();
    else if (win !== null && Number(win) > 0) src.forceWin(Number(win));
  } catch {
    /* no window.location (tests) */
  }
  const hooks = { seed: (n: number) => src.forceSeed(n), feature: () => src.forceFeature(), win: (stakes: number) => src.forceWin(stakes) };
  (window as unknown as { __slotDev?: typeof hooks }).__slotDev = hooks;
  return () => {
    delete (window as unknown as { __slotDev?: typeof hooks }).__slotDev;
  };
}
