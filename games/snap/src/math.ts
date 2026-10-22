// Snap: a stick [0, 1] is broken at your mark x, then k random cuts fall on
// it one at a time (each uniform on the stick). The pieces can be laid out as
// a polygon exactly when every side is shorter than all the others together.
// The pieces sum to 1, so that is: every piece is shorter than ½.
//
// The long piece. Because the pieces sum to 1, at most one of them can be
// ≥ ½: call it the long piece, length ℓ. Cuts elsewhere are wasted. With m
// cuts left, j of them land in the long piece (j ~ Bin(m, ℓ)), uniformly, and
// they break it into pieces all < ½ with the spacing probability
//   S(j, ℓ) = Σᵢ (−1)ⁱ C(j+1, i) (1 − i/(2ℓ))₊ʲ.
// For ½ ≤ ℓ < 1 only i = 0 and i = 1 survive, so Bin(j; m, ℓ)·S(j, ℓ) is
// C(m, j)(1−ℓ)^(m−j)[ℓʲ − (j+1)(ℓ−½)ʲ], and the binomial theorem (with
// (1−ℓ) + (ℓ−½) = ½) collapses the sum to a straight line in ℓ:
//
//   P(win | long piece ℓ, m cuts left) = 1 − (1 + m(2ℓ − 1)) / 2^m.
//
// ℓ → 1 is the classic broken stick: m random cuts give a polygon with
// probability 1 − (m+1)/2^m (two cuts make a triangle ¼ of the time). Its
// complement (m+1)/2^m is Wendel's n/2^(n−1) with n = m+1: Half Moon's
// semicircle event, seen from the other side (pieces of a stick ↔ gaps
// between points on a circle).
//
// The landscape (the odds on screen). Where the next cut lands decides the
// new chance, and every case is a picture on the stick:
//   - within ½ of both ends of the long piece, the middle stretch
//     (ℓ − ½, ½) from its left end, of length 1 − ℓ: every piece is now < ½,
//     the polygon is certain (height 1, drawn green);
//   - nearer an end, the long piece is trimmed to ℓ' ∈ [½, ℓ): height
//     P(ℓ', m−1), a straight ramp because P is linear in ℓ;
//   - any other piece: the cut is wasted, height P(ℓ, m−1).
// The cut is uniform on [0, 1], so the area under this profile is the
// expected next chance, and it equals P(ℓ, m) exactly (the test checks it).
// So the shaded area over the stick IS the win chance, and the height where
// the blade lands IS the next one.
//
// Pricing (pattern 1, fixed prize). The prize is locked at bet time at
// RTP / P₀ with P₀ = P(max(x, 1−x), k), and the cash-out at any checkpoint is
// prize × P(ℓ, m). Since E[next P] = P now, the cash-out is a martingale that
// starts at RTP, so by optional stopping every cash-out strategy returns RTP.
// When no piece is ≥ ½ the polygon is certain and the round pays the prize at
// once: a stopping rule, so RTP is unchanged.
//
// The choice. Your break x only sets P₀ (centre = safe, near an end = long
// odds). The prize is locked at RTP / P₀, so at the moment of choosing every
// x is worth RTP: the choice moves volatility, never EV.
//
// Tie rule. A piece of length exactly ½ counts as long (a polygon needs every
// side strictly shorter than ½). The break at exactly 50% is not offered:
// both halves would be long and the line above would not apply.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;
export const HALF = 0.5;

/** Random cuts after your break. */
export const CUTS = [1, 2, 3, 4] as const;
export type Cuts = (typeof CUTS)[number];

/** Your break, in whole percent of the stick. 50 is skipped (see the tie rule). */
export const BREAK_MIN = 1;
export const BREAK_MAX = 99;

/**
 * Clamps a break to the allowed grid. Landing on 50 steps past it, in the
 * direction you were moving (from `prev`), or to the nearer side of `raw`.
 */
export function snapBreak(raw: number, prev?: number): number {
  const p = Math.round(Math.min(BREAK_MAX, Math.max(BREAK_MIN, raw)));
  if (p !== 50) return p;
  if (prev !== undefined) return prev > 50 ? 49 : 51;
  return raw < 50 ? 49 : 51;
}

export interface Piece {
  start: number;
  end: number;
  length: number;
}

/** The pieces left to right, for breaks at the given positions in [0, 1]. */
export function pieces(breaks: readonly number[]): Piece[] {
  const s = [0, ...[...breaks].sort((a, b) => a - b), 1];
  return s.slice(1).map((end, i) => ({ start: s[i], end, length: end - s[i] }));
}

/** The piece of length ≥ ½, if there is one (tie rule: exactly ½ counts). */
export function longPiece(breaks: readonly number[]): Piece | null {
  let best: Piece | null = null;
  for (const p of pieces(breaks)) if (p.length >= HALF && (!best || p.length > best.length)) best = p;
  return best;
}

/** The pieces form a polygon: every piece < ½. */
export const isPolygon = (breaks: readonly number[]) => longPiece(breaks) === null;

/** Exact chance of ending with a polygon: long piece ℓ (null = none), m cuts left. */
export function winChance(long: number | null, m: number): number {
  if (long === null) return 1;
  if (m <= 0) return 0;
  return 1 - (1 + m * (2 * long - 1)) / 2 ** m;
}

const choose = (n: number, k: number) => {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
};

/** (x)₊ʲ with the convention (x)₊⁰ = [x > 0]. */
const plus = (x: number, j: number) => (j === 0 ? (x > 0 ? 1 : 0) : Math.max(0, x) ** j);

/** S(j, ℓ): j uniform cuts split a piece of length ℓ into pieces all < ½. */
export function splitChance(j: number, long: number): number {
  let s = 0;
  for (let i = 0; i <= j + 1; i++) s += (i % 2 ? -1 : 1) * choose(j + 1, i) * plus(1 - i / (2 * long), j);
  return s;
}

/** The spec's form Σⱼ Bin(j; m, ℓ)·S(j, ℓ). Equal to winChance; kept for the tests. */
export function winChanceSum(long: number, m: number): number {
  let p = 0;
  for (let j = 0; j <= m; j++) p += choose(m, j) * long ** j * (1 - long) ** (m - j) * splitChance(j, long);
  return p;
}

/** The headline chance for a break at x (fraction of the stick) and k random cuts. */
export const headline = (x: number, cuts: number) => winChance(Math.max(x, 1 - x), cuts);

/** The prize for a full win, locked at bet time. */
export const prizeFor = (x: number, cuts: number) => RTP / headline(x, cuts);

/** Cuts still to fall in a round with these breaks (the first break is yours). */
export const cutsLeft = (breaks: readonly number[], cuts: number) => cuts - (breaks.length - 1);

export type ZoneKind = 'win' | 'trim' | 'waste';

/** A stretch of the stick where the next cut gives a new chance rising linearly from h0 to h1. */
export interface Zone {
  start: number;
  end: number;
  h0: number;
  h1: number;
  kind: ZoneKind;
}

/**
 * The win-chance landscape for the next cut, with m cuts left (m ≥ 1, long
 * piece present). Zones tile [0, 1] left to right.
 */
export function landscape(breaks: readonly number[], m: number): Zone[] {
  const long = longPiece(breaks);
  if (!long || m < 1) return [];
  const after = (l: number) => winChance(l, m - 1);
  const stay = after(long.length);
  const edge = after(HALF);
  const zones: Zone[] = [];
  for (const p of pieces(breaks)) {
    if (p.start === long.start && p.end === long.end) {
      // Landing at c leaves the long piece max(c − a, b − c); both < ½ in the middle.
      zones.push({ start: p.start, end: p.end - HALF, h0: stay, h1: edge, kind: 'trim' });
      zones.push({ start: p.end - HALF, end: p.start + HALF, h0: 1, h1: 1, kind: 'win' });
      zones.push({ start: p.start + HALF, end: p.end, h0: edge, h1: stay, kind: 'trim' });
    } else if (p.length > 0) {
      zones.push({ start: p.start, end: p.end, h0: stay, h1: stay, kind: 'waste' });
    }
  }
  return zones;
}

/** The area under the landscape: the expected next chance (= the chance now). */
export const landscapeArea = (zones: readonly Zone[]) => zones.reduce((s, z) => s + ((z.end - z.start) * (z.h0 + z.h1)) / 2, 0);

/** The landscape's height at u. */
export function heightAt(zones: readonly Zone[], u: number): number {
  for (const z of zones) {
    if (u >= z.start && u <= z.end) {
      const w = z.end - z.start;
      return w > 0 ? z.h0 + ((u - z.start) / w) * (z.h1 - z.h0) : z.h0;
    }
  }
  return 0;
}

/** Where the next cut makes the polygon at once (the green zone), if there is a long piece. */
export function winZone(breaks: readonly number[]): { start: number; end: number } | null {
  const long = longPiece(breaks);
  return long ? { start: long.end - HALF, end: long.start + HALF } : null;
}

export const VOLATILITY: Record<Volatility, { brk: number; cuts: Cuts }> = {
  low: { brk: 40, cuts: 4 },
  medium: { brk: 20, cuts: 3 },
  high: { brk: 5, cuts: 2 },
  extreme: { brk: 5, cuts: 1 },
};

export function volatilityOf(brk: number, cuts: number): Volatility {
  const p = headline(brk / 100, cuts);
  return p >= 0.75 ? 'low' : p >= 0.4 ? 'medium' : p >= 0.15 ? 'high' : 'extreme';
}

/**
 * Every payout is either 0, a cash-out (prize × P ≤ prize) or the prize, so
 * the largest is RTP over the smallest headline chance: one cut with the
 * break at 1% (or 99%), RTP / 0.01 = 99×.
 */
export const MAX_MULTIPLIER = Math.max(
  ...CUTS.flatMap((k) => Array.from({ length: BREAK_MAX - BREAK_MIN + 1 }, (_, i) => prizeFor((BREAK_MIN + i) / 100, k))),
);

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * The polygon your pieces make: a cyclic polygon with these side lengths, in
 * the stick's order (side i runs from vertex i to vertex i+1). Needs every
 * side < ½ of the total. Decorative only: it plays no part in pricing.
 */
export function polygonSides(sides: readonly number[]): Segment[] {
  const n = sides.length;
  let iMax = 0;
  for (let i = 1; i < n; i++) if (sides[i] > sides[iMax]) iMax = i;
  // Rotate so the longest side comes last and closes the loop.
  const order = [...sides.slice(iMax + 1), ...sides.slice(0, iMax + 1)];
  const big = order[n - 1];
  const others = order.slice(0, n - 1);
  const ang = (s: number, R: number) => 2 * Math.asin(Math.min(1, s / (2 * R)));
  const sumOthers = (R: number) => others.reduce((t, s) => t + ang(s, R), 0);
  // Centre inside the polygon if the other sides already need ≥ π at the
  // smallest radius; otherwise the longest side's arc equals the rest.
  const inside = sumOthers(big / 2) >= Math.PI;
  const f = (R: number) => (inside ? sumOthers(R) + ang(big, R) - 2 * Math.PI : sumOthers(R) - ang(big, R));
  let lo = big / 2;
  let hi = 1e6;
  for (let it = 0; it < 200; it++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < 0 === inside) hi = mid;
    else lo = mid;
  }
  const R = (lo + hi) / 2;
  const pts: { x: number; y: number }[] = [];
  let theta = -Math.PI / 2 - sumOthers(R) / 2;
  for (let i = 0; i < n; i++) {
    pts.push({ x: R * Math.cos(theta), y: R * Math.sin(theta) });
    if (i < n - 1) theta += ang(others[i], R);
  }
  const rotated = order.map((_, i) => ({ x1: pts[i].x, y1: pts[i].y, x2: pts[(i + 1) % n].x, y2: pts[(i + 1) % n].y }));
  // Back to the stick's order.
  return sides.map((_, j) => rotated[(j - (iMax + 1) + n) % n]);
}
