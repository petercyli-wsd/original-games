// Records: a queue of N = 20 items arrives one at a time in a uniformly random
// order. Item t is a *record* if it beats every item before it. You win if the
// queue produces at least k records.
//
// Rényi's record theorem. When item t arrives, it slots in among the t items
// seen so far at a uniformly random rank R_t ∈ {1, …, t}, and the relative
// ranks R_1, …, R_n are independent. Item t is a record exactly when it takes
// the top slot (R_t = t), so the record indicators are independent with
// P(item t is a record) = 1/t. The board is exactly this draw: item t drops
// into one of t equal slots and only the green (top) slot is a record. Where a
// miss lands among the other slots has no effect on anything later, and the
// board gives it none: a miss is just a grey dot in the item row.
//
// The number of records is therefore a sum of independent Bernoulli(1/t): its
// mean is the harmonic number H_n and P(exactly m records) = c(n, m)/n!, the
// unsigned Stirling numbers of the first kind (Foata's bijection: records in a
// random order ↔ cycles of a random permutation). From any state (j items
// seen, r records) the win chance is a Poisson-binomial tail, computed exactly
// by a backward DP:
//   T(j, d) = P(at least d records among items j+1..n),
//   T(n, d) = [d ≤ 0],   T(j, d) = (1/(j+1))·T(j+1, d−1) + (j/(j+1))·T(j+1, d).
//
// Pricing (fixed prize). prize = RTP / P(win), locked at the bet, and
// cash-out = prize × P(win | j, r). The only move is "next item", and the
// recursion above is exactly E[P after] = P before, so the cash-out is a
// martingale. The round ends (lost, value 0 either way) the moment fewer items
// remain than records needed. By optional stopping every cash-out rule returns
// exactly RTP. The cash-out never exceeds the prize, so the largest payout is
// the largest prize on offer (MAX_MULTIPLIER).

import type { Rng, Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

/** The queue length is fixed: the records-needed slider is the one risk knob. */
export const N = 20;

/** Records needed on offer: headline chances from 95% (2) down to 0.12% (9), a spread of about 785:1. */
export const TARGETS = [2, 3, 4, 5, 6, 7, 8, 9] as const;

export const VOLATILITY: Record<Volatility, { k: number }> = {
  low: { k: 3 },
  medium: { k: 5 },
  high: { k: 7 },
  extreme: { k: 9 },
};

export const clampTarget = (k: number) => Math.min(TARGETS[TARGETS.length - 1], Math.max(TARGETS[0], Math.round(k)));

const tables = new Map<number, Float64Array[]>();

/** tailTable(n)[j][d] = P(at least d records among items j+1..n), for d = 0..n+1. Cached per n. */
export function tailTable(n: number): Float64Array[] {
  let t = tables.get(n);
  if (t) return t;
  t = Array.from({ length: n + 1 }, () => new Float64Array(n + 2));
  t[n][0] = 1;
  for (let j = n - 1; j >= 0; j--) {
    const p = 1 / (j + 1);
    t[j][0] = 1;
    for (let d = 1; d <= n + 1; d++) t[j][d] = p * t[j + 1][d - 1] + (1 - p) * t[j + 1][d];
  }
  tables.set(n, t);
  return t;
}

/** True once the target is out of reach: fewer items remain than records needed (integer test, no tie issue). */
export const outOfReach = (k: number, j: number, r: number, n: number = N) => r < k && n - j < k - r;

/** Exact chance of finishing with at least k records, given j items seen and r records so far. */
export function winChance(k: number, j: number, r: number, n: number = N): number {
  const d = k - r;
  if (d <= 0) return 1;
  if (n - j < d) return 0;
  return tailTable(n)[j][d];
}

export const headline = (k: number, n: number = N) => winChance(k, 0, 0, n);
export const prizeFor = (k: number, n: number = N) => RTP / headline(k, n);

/** Mean number of records in n items: the harmonic number H_n. */
export function harmonic(n: number): number {
  let h = 0;
  for (let i = 1; i <= n; i++) h += 1 / i;
  return h;
}

/** Item t has t equal slots and only the top (green) one is a record. */
export const recordChance = (t: number) => 1 / t;

/** The slot item t lands in: uniform on 1..t (t = the top slot, a record). Decided when the move starts. */
export const drawRank = (t: number, rng: Rng) => 1 + rng.int(t);

export const isRecord = (rank: number, t: number) => rank === t;

export const countRecords = (ranks: readonly number[]) => ranks.reduce((c, rank, i) => c + (rank === i + 1 ? 1 : 0), 0);

export function volatilityOf(k: number, n: number = N): Volatility {
  const p = headline(k, n);
  return p > 0.3 ? 'low' : p > 0.08 ? 'medium' : p > 0.01 ? 'high' : 'extreme';
}

/** The largest prize on offer: no cash-out can exceed its round's prize. */
export const MAX_MULTIPLIER = Math.max(...TARGETS.map((k) => prizeFor(k)));
