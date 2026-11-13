// Burrows: seven burrows, m critters (1 to 6) hiding among them. Each tap picks
// one burrow. If a critter is in it that is a find and the cash-out rises; an
// empty burrow ends the round. The critters are hidden again before every tap
// (with replacement), so every tap finds one with probability exactly
//
//     p = m / 7,
//
// whichever burrow is tapped and whatever happened on earlier taps. The cash-out
// after n finds is
//
//     V(n) = RTP · (7 / m)^n,        V(0) = RTP = 0.98.
//
// Pricing is a per-step fair factor: a find multiplies the cash-out by 1/p =
// 7/m, exactly the inverse of the chance of making it. The cash-out is therefore
// a martingale, E[V(n+1) | n] = p · V(n) · 7/m = V(n), and by optional stopping
// every rule for when to stop (and every choice of burrow) returns exactly RTP.
// A fixed target of k finds shows it directly: p^k · V(k) = RTP.
//
// Max win: MAX_WIN = RTP · 7^8 = 5,649,504.98× (eight finds with one critter).
// A find that would push the cash-out above it is never offered: the round
// cashes out first. That is a stopping rule, so RTP is unchanged. Per setting
// that is 8, 12, 18, 27, 46 and 100 finds for 1 to 6 critters.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.98;
export const BURROWS = 7;
export const CRITTERS = [1, 2, 3, 4, 5, 6] as const;
export type Critters = (typeof CRITTERS)[number];

/** Chance a tapped burrow holds a critter: m / 7, for every burrow and every tap. */
export const findChance = (m: number) => m / BURROWS;

/** Cash-out after n finds: RTP · (7/m)^n (n = 0 is the stake's fair value). */
export const value = (m: number, n: number) => RTP * (BURROWS / m) ** n;

/** The cash-out after one more find (the per-step fair factor 7/m). */
export const afterFind = (cash: number, m: number) => (cash * BURROWS) / m;

/** Chance of n finds in a row: (m/7)^n. */
export const reachChance = (m: number, n: number) => findChance(m) ** n;

/** Largest payout under any setting: 0.98 · 7^8. */
export const MAX_WIN = RTP * BURROWS ** 8;
export const MAX_MULTIPLIER = MAX_WIN;

/** Most finds a round can reach: the largest n with V(n) ≤ MAX_WIN. */
export function maxFinds(m: number): number {
  let n = 0;
  while (value(m, n + 1) <= MAX_WIN * (1 + 1e-12)) n++;
  return n;
}

export function volatilityOf(m: number): Volatility {
  return m >= 5 ? 'low' : m === 4 ? 'medium' : m === 3 ? 'high' : 'extreme';
}

/** The shown multiplier, floored to 2 places (the house's way). Pricing stays exact. */
export const floor2 = (x: number) => Math.floor(x * 100 + 1e-9) / 100;

type Shuffle = <T>(xs: readonly T[]) => T[];

/** Hides m critters among the 7 burrows: a uniformly random m-subset (the first m of a shuffle). */
export function hide(m: number, shuffle: Shuffle): boolean[] {
  const order = shuffle([0, 1, 2, 3, 4, 5, 6]);
  const out = new Array<boolean>(BURROWS).fill(false);
  for (let i = 0; i < m; i++) out[order[i]] = true;
  return out;
}

export interface Tap {
  burrow: number;
  hit: boolean;
  /** Where the critters were this tap. */
  hidden: boolean[];
}

/** One tap: hide the critters afresh, then look in the chosen burrow. */
export function tap(m: number, burrow: number, shuffle: Shuffle): Tap {
  const hidden = hide(m, shuffle);
  return { burrow, hit: hidden[burrow], hidden };
}

export interface Climb {
  taps: Tap[];
  finds: number;
  multiplier: number;
}

/**
 * A whole round on the real draw. `choose(n)` is the burrow tapped after n finds
 * and `stop(n)` cashes out after n finds (n >= 1); the round also cashes out at
 * the max-win cap. An empty burrow pays 0. Used by Auto, the eval and the tests.
 */
export function playRound(m: number, shuffle: Shuffle, choose: (finds: number) => number, stop: (finds: number) => boolean): Climb {
  const cap = maxFinds(m);
  const taps: Tap[] = [];
  let finds = 0;
  while (finds < cap) {
    const t = tap(m, choose(finds), shuffle);
    taps.push(t);
    if (!t.hit) return { taps, finds, multiplier: 0 };
    finds++;
    if (stop(finds)) break;
  }
  return { taps, finds, multiplier: value(m, finds) };
}

/** Auto: tap the planned burrows in order, then cash out (every planned find is needed). */
export const autoClimb = (m: number, picks: readonly number[], shuffle: Shuffle): Climb =>
  playRound(m, shuffle, (n) => picks[n], (n) => n >= picks.length);
