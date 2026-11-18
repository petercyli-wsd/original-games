// Fleet: five rockets climb together on one shared multiplier from 1x to 2x.
// Each rocket has its own crash point C, drawn independently when the bet is
// placed, with P(C >= x) = 1/x for every x >= 1 (the Crash law, no instant
// crash). You win if at least k rockets are still flying when the climb
// reaches 2x.
//
// Given a rocket is still flying at height m, the chance it reaches 2x is
// P(C >= 2 | C >= m) = m/2. That is the literal picture: on a linear 0-2x axis
// the rocket's height as a share of the axis IS its chance. Rockets are
// independent, so with a still flying at m the chance of winning is the exact
// binomial tail P(Bin(a, m/2) >= k).
//
// Pricing (fixed prize, pattern 1): prize = RTP / P0(k) with P0(k) =
// P(Bin(5, 1/2) >= k), and cash-out(a, m) = prize * P(Bin(a, m/2) >= k). That is
// RTP * E[payout | state] with E[payout | start] = 1, so the cash-out is a
// martingale: a rocket flying at m survives to m' > m with chance m/m', and
// E[cash-out(Bin(a, m/m'), m')] = cash-out(a, m) exactly (tested). By optional
// stopping every way of playing returns exactly RTP.
//
// Tie rule: a rocket whose crash point is <= the current height has crashed.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;
export const ROCKETS = 5;
export const TOP = 2;
export const KS = [2, 3, 4, 5] as const;
export type K = (typeof KS)[number];

const VOL: Record<K, Volatility> = { 2: 'low', 3: 'medium', 4: 'high', 5: 'extreme' };
export const volatilityOf = (k: K): Volatility => VOL[k];

/** Binomial coefficient, exact for the small n used here. */
export function choose(n: number, r: number): number {
  if (r < 0 || r > n) return 0;
  let c = 1;
  for (let i = 1; i <= r; i++) c = (c * (n - r + i)) / i;
  return Math.round(c);
}

/** P(Bin(n, p) >= k), exact closed form. */
export function binGE(n: number, p: number, k: number): number {
  let s = 0;
  for (let j = k; j <= n; j++) s += choose(n, j) * p ** j * (1 - p) ** (n - j);
  return Math.min(1, Math.max(0, s));
}

/** P(a rocket still flying at height m reaches 2x). */
export const rocketChance = (m: number) => m / TOP;

/** P(win) with a rockets flying at height m. */
export const winChance = (a: number, m: number, k: number) => binGE(a, rocketChance(m), k);

/** P(win) at the bet: five rockets at 1x. */
export const startChance = (k: number) => winChance(ROCKETS, 1, k);

/** The prize for holding k or more rockets to 2x. */
export const prize = (k: number) => RTP / startChance(k);

/** The exact cash-out with a rockets flying at height m. */
export const cashOut = (a: number, m: number, k: number) => prize(k) * winChance(a, m, k);

export const MAX_MULTIPLIER = prize(5);

/** A rocket's crash point from a uniform draw in [0, 1): P(C >= x) = 1/x. */
export const crashFrom = (u: number) => 1 / (1 - u);

/** The crash heights below 2x, ascending (rockets that crash on the climb). */
export const climbCrashes = (crashes: number[]) => crashes.filter((c) => c < TOP).sort((x, y) => x - y);

/** Rockets still flying at height m (crash point above m). */
export const flyingAt = (crashes: number[], m: number) => crashes.filter((c) => c > m).length;

export const fmtX = (m: number) => m.toFixed(2) + '×';

// ---- Strategies, for the eval and the fairness tests -----------------------

/**
 * A stopping rule is asked once per climb segment (a rockets flying, heights
 * lo up to hi, `crashed` crashes so far). It returns the height to cash out
 * at, inside [lo, hi), or null to let the segment run.
 */
export type StopRule = (a: number, lo: number, hi: number, k: number, crashed: number) => number | null;

export const stopNever: StopRule = () => null;
export const stopAtHeight =
  (h: number): StopRule =>
  (_a, lo, hi) =>
    h >= lo && h < hi ? h : null;
export const stopAfterCrashes =
  (n: number): StopRule =>
  (_a, lo, _hi, _k, crashed) =>
    crashed >= n ? lo : null;
/** Hold until exactly k are left (one crash from losing), then cash out. */
export const stopAtEdge: StopRule = (a, lo, _hi, k) => (a === k ? lo : null);
/** Cash out the first time the value reaches target x the stake. */
export const stopAtValue =
  (target: number): StopRule =>
  (a, lo, hi, k) => {
    if (cashOut(a, lo, k) >= target) return lo;
    if (cashOut(a, hi, k) < target) return null;
    let l = lo;
    let h = hi;
    for (let i = 0; i < 60; i++) {
      const mid = (l + h) / 2;
      if (cashOut(a, mid, k) >= target) h = mid;
      else l = mid;
    }
    return h < hi ? h : null;
  };
/** Cash out once the win chance has fallen below p. */
export const stopWhenChanceBelow =
  (p: number): StopRule =>
  (a, lo, _hi, k) =>
    winChance(a, lo, k) < p ? lo : null;

export interface Played {
  multiplier: number;
  /** Events watched: each crash on the climb, plus the climb's end or the cash-out. */
  steps: number;
}

/** One round on drawn crash points, as Game.tsx plays it, with a stopping rule. */
export function playCrashes(crashes: number[], k: K, stop: StopRule): Played {
  const events = climbCrashes(crashes);
  let a = ROCKETS;
  let m = 1;
  let steps = 0;
  for (let i = 0; i <= events.length; i++) {
    const hi = i < events.length ? events[i] : TOP;
    const s = stop(a, m, hi, k, i);
    if (s !== null) return { multiplier: cashOut(a, s, k), steps: steps + 1 };
    if (i === events.length) return { multiplier: prize(k), steps: steps + 1 };
    a--;
    m = hi;
    steps++;
    if (a < k) return { multiplier: 0, steps };
  }
  return { multiplier: prize(k), steps: steps + 1 };
}
