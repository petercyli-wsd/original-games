// Core: random intervals drop onto the unit segment [0, 1], one at a time.
// Each interval is the span between two independent uniform points. You
// survive while all the intervals so far share a common point.
//
// Helly's theorem in one dimension: a family of intervals has a common point
// exactly when every two of them meet, and then the common part (the "core")
// is the interval [l, r] with l = the largest left end and r = the smallest
// right end. Before the first drop the core is the whole segment [0, 1].
//
// The bust region. A new interval [a, b] keeps the core non-empty exactly
// when it meets [l, r]: a ≤ r and b ≥ l. It misses when both of its random
// endpoints land left of l (chance l²) or both land right of r (chance
// (1 − r)²). These two events are disjoint, so the bust chance is
//
//   q = l² + (1 − r)².
//
// On the board this is literal: in the unit square of endpoint pairs (u, v)
// the busting pairs are the two corner squares [0, l]² and [r, 1]², with sides
// l and 1 − r. Their red area is q. Tie rule: closed intervals, so touching
// the core at one point still counts as sharing it (a zero-area boundary).
//
// Pricing (per-step fair factor). Surviving a drop with bust chance q
// multiplies the cash-out by 1/(1 − q): E[cash-out after] = (1 − q)·c/(1 − q)
// = c. The cash-out is a martingale that starts at RTP, every round ends
// within `target` drops, and by optional stopping every cash-out rule returns
// exactly RTP. The first drop is free (q = 0).
//
// Max win. As the core shrinks towards a point x, q tends to x² + (1 − x)²,
// which approaches 1 near the ends of the segment, so the factor 1/(1 − q) is
// unbounded. Before a drop, if surviving it would push the cash-out above
// MAX_WIN, the round auto-cashes instead. That is a stopping rule, so RTP is
// unchanged, and MAX_WIN bounds every payout.
//
// Headline odds. n random intervals share a point exactly when, among their
// 2n endpoints, all n left ends come before all n right ends. So
//   P(n intervals share a point) = 2ⁿ·(n!)² / (2n)! = 2ⁿ / C(2n, n).
// From a live core [l, r] with m intervals still to drop, the exact chance to
// complete is (A = largest new left end, B = smallest new right end)
//   P = P(A ≤ l, B ≥ l) + ∫_l^r P(A ∈ ds, B ≥ s)
//     = (2l(1 − l))^m + ∫_l^r 2m(1 − s)(2s(1 − s))^(m−1) ds
//     = (2l(1 − l))^m + P₀(m)·[T_m(r) − T_m(l)],
// with P₀(m) = 2^m/C(2m, m) and T_m(x) = P(Binomial(2m, x) ≥ m), the
// regularised incomplete beta I_x(m, m + 1): a finite sum of positive terms.
// The live "chance to complete" readout is this number (the max-win stop is
// ignored there, as it only ever ends a round early with a payout).

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

/** No payout exceeds this: the round auto-cashes before a drop that could. */
export const MAX_WIN = 10_000;

/** Intervals to land (the round pays out when the last one keeps the core). */
export const TARGETS = [3, 4, 5, 6, 8, 10, 12] as const;
export type Target = (typeof TARGETS)[number];

/** The eval's configs, one per volatility level. */
export const VOLATILITY: Record<Volatility, { target: Target }> = {
  low: { target: 3 },
  medium: { target: 5 },
  high: { target: 8 },
  extreme: { target: 12 },
};

export interface Interval {
  /** The two raw endpoints, in the order they were drawn (a point in the unit square). */
  u: number;
  v: number;
}

export const left = (iv: Interval) => Math.min(iv.u, iv.v);
export const right = (iv: Interval) => Math.max(iv.u, iv.v);

export interface Core {
  /** Largest left end so far (0 before the first drop). */
  l: number;
  /** Smallest right end so far (1 before the first drop). */
  r: number;
}

/** The common part [l, r] of the intervals. Empty (l > r) when they don't all share a point. */
export function core(intervals: readonly Interval[]): Core {
  let l = 0;
  let r = 1;
  for (const iv of intervals) {
    l = Math.max(l, left(iv));
    r = Math.min(r, right(iv));
  }
  return { l, r };
}

/** Whether all the intervals share a point (the raw definition: every pair meets, via Helly). */
export function allShare(intervals: readonly Interval[]): boolean {
  for (let i = 0; i < intervals.length; i++)
    for (let j = i + 1; j < intervals.length; j++) {
      const A = intervals[i];
      const B = intervals[j];
      if (left(A) > right(B) || left(B) > right(A)) return false;
    }
  return true;
}

/** Whether a new interval keeps the core non-empty: it meets [l, r]. */
export const meets = ({ l, r }: Core, iv: Interval) => left(iv) <= r && right(iv) >= l;

/** Chance the next interval misses the core: both ends left of l, or both right of r. */
export const risk = ({ l, r }: Core) => Math.min(1, Math.max(0, l * l + (1 - r) * (1 - r)));

export interface Square {
  /** Lower-left corner and side, in unit-square coordinates (y up). */
  x: number;
  y: number;
  side: number;
}

/** The two red corner squares in the endpoint-pair square: [0, l]² and [r, 1]². Their total area is the risk. */
export const redSquares = ({ l, r }: Core): [Square, Square] => [
  { x: 0, y: 0, side: l },
  { x: r, y: r, side: 1 - r },
];

/** Cash-out after surviving a drop that had bust chance q. */
export const afterSafeDrop = (cash: number, q: number) => cash / (1 - q);

/** Whether the next drop must be skipped (auto cash-out) because surviving it would exceed MAX_WIN. */
export const hitsCap = (cash: number, q: number) => q >= 1 || afterSafeDrop(cash, q) > MAX_WIN;

function choose(n: number, k: number): number {
  let c = 1;
  for (let i = 1; i <= k; i++) c = (c * (n - k + i)) / i;
  return c;
}

/** P(n random intervals share a point) = 2ⁿ·(n!)²/(2n)! = 2ⁿ / C(2n, n). */
export const shareChance = (n: number) => (n <= 1 ? 1 : 2 ** n / choose(2 * n, n));

/** T_m(x) = P(Binomial(2m, x) ≥ m) = I_x(m, m + 1). A sum of positive terms. */
function tail(m: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  let s = 0;
  for (let j = m; j <= 2 * m; j++) s += choose(2 * m, j) * x ** j * (1 - x) ** (2 * m - j);
  return Math.min(1, s);
}

/** Exact chance that m more random intervals all meet the core [l, r] and each other. */
export function completeChance({ l, r }: Core, m: number): number {
  if (l > r) return 0;
  if (m <= 0) return 1;
  const p = (2 * l * (1 - l)) ** m + shareChance(m) * (tail(m, r) - tail(m, l));
  return Math.min(1, Math.max(0, p));
}

/** E[full prize | all intervals share a point] = RTP / P(complete) (ignoring the rarely-binding max-win stop). */
export const averageFullPrize = (n: number) => RTP / shareChance(n);

export const MAX_MULTIPLIER = MAX_WIN;
