// Half Moon: points drop uniformly onto a circle, one at a time. You survive
// while every point so far still fits inside some arc of the window size.
//
// Positions are fractions of a turn in [0, 1). Let a be the window (as a
// fraction of the circle) and L = 1 − a. The points fit in a window exactly
// when the largest gap between neighbouring points is at least L. A new point
// can only break that by landing in the largest gap g, and it breaks it when
// it lands closer than L to both ends of that gap: the middle stretch of
// length 2L − g. If the second-largest gap is already ≥ L, nothing can bust.
// So the bust zone is a single arc you can draw, and its length is the risk.
//
// Pricing: surviving a drop with bust chance q multiplies the cash-out by
// 1/(1 − q). The cash-out is then a martingale starting at RTP, so every
// stopping rule returns exactly RTP. (Wendel: n points fit in a half circle
// with probability n/2^(n−1); for any window a the chance is the
// inclusion–exclusion sum in fitChance.)

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

/** Window sizes in degrees. Smaller windows bust sooner and pay more. */
export const WINDOWS = [240, 180, 120, 90] as const;
export type Window = (typeof WINDOWS)[number];

/** Points needed to fill the board (the round auto-cashes there). */
export const TARGETS = [4, 6, 8, 10] as const;
export type Target = (typeof TARGETS)[number];

export const VOLATILITY: Record<Volatility, { window: Window; target: Target }> = {
  low: { window: 240, target: 6 },
  medium: { window: 180, target: 6 },
  high: { window: 120, target: 8 },
  extreme: { window: 90, target: 8 },
};

export interface Arc {
  /** Start position, as a fraction of a turn clockwise from the top. */
  start: number;
  length: number;
}

const mod1 = (x: number) => ((x % 1) + 1) % 1;

/** The gaps between neighbouring points, largest first. One point has one gap: the whole circle. */
export function gaps(points: readonly number[]): Arc[] {
  if (points.length === 0) return [];
  const s = [...points].sort((x, y) => x - y);
  return s
    .map((p, i) => ({ start: p, length: i + 1 < s.length ? s[i + 1] - p : 1 - p + s[0] }))
    .sort((x, y) => y.length - x.length);
}

/** The smallest arc holding every point: the complement of the largest gap. */
export function span(points: readonly number[]): Arc | null {
  const [g] = gaps(points);
  if (!g) return null;
  return { start: mod1(g.start + g.length), length: 1 - g.length };
}

export interface Danger {
  /** Chance the next point busts the round. */
  q: number;
  /** Where it would have to land to bust (null when the drop is free). */
  arc: Arc | null;
}

export function danger(points: readonly number[], window: Window): Danger {
  const L = 1 - window / 360;
  const [g, g2] = gaps(points);
  if (!g || (g2 && g2.length >= L)) return { q: 0, arc: null };
  const length = 2 * L - g.length;
  if (length <= 0) return { q: 0, arc: null };
  return { q: length, arc: { start: mod1(g.start + g.length - L), length } };
}

/** Whether the points all fit in one window. */
export function fits(points: readonly number[], window: Window): boolean {
  const s = span(points);
  return !s || s.length <= window / 360 + 1e-12;
}

/** Cash-out after surviving a drop that had bust chance q. */
export const afterSafeDrop = (cash: number, q: number) => cash / (1 - q);

/** Exact chance that n uniform points all fit in a window of size a (fraction of a turn). */
export function fitChance(n: number, window: Window): number {
  const a = window / 360;
  let p = 0;
  let binom = 1;
  for (let k = 1; k <= n; k++) {
    binom = (binom * (n - k + 1)) / k;
    const base = 1 - k * (1 - a);
    if (base <= 0) break;
    p += (k % 2 ? 1 : -1) * binom * base ** (n - 1);
  }
  return Math.min(1, p);
}

/**
 * Upper bound on any reachable cash-out. A live round always has its largest
 * gap ≥ L, so every risky drop has q ≤ L and multiplies the cash-out by at
 * most 1/a. The first point is always free.
 */
export const maxMultiplier = (window: Window, target: Target) => RTP / (window / 360) ** (target - 1);

export const MAX_MULTIPLIER = Math.max(...WINDOWS.flatMap((w) => TARGETS.map((t) => maxMultiplier(w, t))));
