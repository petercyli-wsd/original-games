// Overhang: identical blocks (width 1, equal mass) are dropped one at a time
// onto a pedestal of the same width. Each block lands at a uniform offset in
// [-s, s] from the block below it.
//
// Statics: the tower stands iff, for every level j (the pedestal is level 0),
// the centre of mass of everything above j lies over block j, i.e. within
// x_j ± 1/2. For a new block at offset d each level gives one linear
// constraint on d, so the safe offsets are an intersection of intervals: an
// interval. P(safe) = |safe ∩ [-s, s]| / 2s, drawn on screen as the green zone.
//
// Payout: the cash-out value starts at RTP and is multiplied by 1/p_k after
// each safe drop, so it is a martingale: E[next value] = p · v/p = v. Every
// stopping rule that depends only on what has happened so far is therefore
// worth exactly RTP. The round auto-cashes (a stopping rule, so still fair)
// before a drop when any of these hold:
//   - the tower has reached maxHeight,
//   - the next drop's odds are below pMin (this includes p = 0, where the
//     tower can't take another block at all),
//   - the next drop would pay more than the mode's cap.
// The last rule bounds every payout by the cap without changing the RTP.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

/** Block width; heights are in the same units. */
export const BLOCK_W = 1;

export type Mode = Volatility;

export interface ModeSpec {
  /** Drop spread: each offset is uniform in [-s, s]. */
  s: number;
  /** Auto-cash once the tower is this many blocks tall. */
  maxHeight: number;
  /** Auto-cash before a drop whose odds are below this. */
  pMin: number;
  /** Auto-cash before a drop that would pay more than this. */
  cap: number;
}

export const MODES: Record<Mode, ModeSpec> = {
  low: { s: 0.6, maxHeight: 20, pMin: 0.1, cap: 250 },
  medium: { s: 0.8, maxHeight: 16, pMin: 0.08, cap: 1_000 },
  high: { s: 1.05, maxHeight: 12, pMin: 0.06, cap: 5_000 },
  extreme: { s: 1.4, maxHeight: 10, pMin: 0.05, cap: 10_000 },
};

export const MODE_NAMES = Object.keys(MODES) as Mode[];

/** Largest payout under a mode: the cap rule guarantees nothing pays more. */
export const maxMultiplier = (mode: Mode) => MODES[mode].cap;

/**
 * Safe offsets [lo, hi] for the next block, relative to the top block's centre
 * (or the pedestal's, at x = 0, when `xs` is empty). `xs` are the centres of
 * the stacked blocks from the bottom up. lo > hi means no offset is safe.
 */
export function safeInterval(xs: readonly number[]): [number, number] {
  const n = xs.length;
  const top = n ? xs[n - 1] : 0;
  let lo = -Infinity;
  let hi = Infinity;
  // Walk down from the top. At level j (block j-1 in xs, or the pedestal at 0)
  // the m blocks above sum to `sum`; with the new block at top + d their centre
  // of mass is (sum + top + d) / (m + 1), which must lie within x_j ± 1/2.
  let sum = 0;
  for (let j = n; j >= 0; j--) {
    const xj = j === 0 ? 0 : xs[j - 1];
    const m = n - j + 1;
    lo = Math.max(lo, m * (xj - BLOCK_W / 2) - sum - top);
    hi = Math.min(hi, m * (xj + BLOCK_W / 2) - sum - top);
    if (j > 0) sum += xs[j - 1];
  }
  return [lo, hi];
}

export interface Odds {
  /** The part of the drop range [-s, s] that is safe, or null if none is. */
  range: [number, number] | null;
  /** Probability the next drop leaves the tower standing: |range| / 2s. */
  p: number;
}

export function nextOdds(xs: readonly number[], s: number): Odds {
  const [lo, hi] = safeInterval(xs);
  const a = Math.max(lo, -s);
  const b = Math.min(hi, s);
  return b > a ? { range: [a, b], p: (b - a) / (2 * s) } : { range: null, p: 0 };
}

/** Draws the next offset: uniform in [-s, s), from one rng sample. */
export const drawOffset = (s: number, u: number) => (2 * u - 1) * s;

/**
 * Whether offset d lands safely. The outcome is decided by the safe range
 * itself, so a drop wins with probability exactly p; `failingLevel` (the
 * definition) only drives the topple animation.
 */
export const landsSafely = ({ range }: Odds, d: number) => !!range && d >= range[0] && d <= range[1];

/**
 * The lowest level that fails, straight from the definition (used to animate
 * the topple and, in tests, as the brute-force check of `safeInterval`).
 * Level 0 is the pedestal; level j ≥ 1 is block xs[j-1]. Returns null if the
 * tower stands. `dir` is the side the blocks above it tip towards.
 */
export function failingLevel(xs: readonly number[]): { level: number; dir: 1 | -1 } | null {
  const n = xs.length;
  for (let j = 0; j < n; j++) {
    const xj = j === 0 ? 0 : xs[j - 1];
    let sum = 0;
    for (let i = j; i < n; i++) sum += xs[i];
    const com = sum / (n - j);
    // A hair of tolerance so an offset exactly on the zone edge counts as safe.
    if (com > xj + BLOCK_W / 2 + 1e-12) return { level: j, dir: 1 };
    if (com < xj - BLOCK_W / 2 - 1e-12) return { level: j, dir: -1 };
  }
  return null;
}

export const isStable = (xs: readonly number[]) => failingLevel(xs) === null;

export type StopReason = 'height' | 'odds' | 'cap';

/** Why the round must auto-cash before the next drop, if it must. */
export function stopReason(mode: Mode, height: number, mult: number, p: number): StopReason | null {
  const { maxHeight, pMin, cap } = MODES[mode];
  if (height >= maxHeight) return 'height';
  if (p < pMin) return 'odds';
  if (mult / p > cap) return 'cap';
  return null;
}

/**
 * Plays out a whole round for a simulated player who cashes out when
 * `stop(height, mult)` says so (or the round auto-cashes). Shared by the eval
 * and tests.
 */
export function simulate(
  mode: Mode,
  stop: (height: number, mult: number) => boolean,
  next: () => number,
): { multiplier: number; drops: number; auto: StopReason | null } {
  const { s } = MODES[mode];
  const xs: number[] = [];
  let mult = RTP;
  while (true) {
    const odds = nextOdds(xs, s);
    if (xs.length > 0) {
      const auto = stopReason(mode, xs.length, mult, odds.p);
      if (auto || stop(xs.length, mult)) return { multiplier: mult, drops: xs.length, auto };
    }
    // Height 0 never auto-cashes: the first drop's odds are min(1, 0.5 / s),
    // which every mode keeps above pMin and below the cap (see tests).
    const d = drawOffset(s, next());
    if (!landsSafely(odds, d)) return { multiplier: 0, drops: xs.length + 1, auto: null };
    xs.push((xs.length ? xs[xs.length - 1] : 0) + d);
    mult /= odds.p;
  }
}
