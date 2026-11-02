// Convex: dots drop uniformly into a square, one at a time. Each dot must
// land in the green zone; a dot that lands in red loses the round. Place the
// chosen number of dots and the round pays out.
//
// What green and red mean. Green is exactly where a new dot keeps every dot a
// corner of the shape they make (their convex hull), i.e. keeps the dots in
// convex position. Let the hull have corners v1..vn (counter-clockwise) and
// edges ei = (vi, vi+1). Seen from a point p outside a convex polygon, the
// edges whose lines p lies beyond form one contiguous chain. So p either
//   - lies beyond no edge line: it is inside the shape: red;
//   - lies beyond two or more edge lines: the chain then contains two edges
//     that meet at a corner v, p is in v's "shadow"
//     {v + s(v - u) + t(v - w) : s, t >= 0} (u, w are v's neighbours), and v
//     falls inside the new hull: red;
//   - lies beyond exactly one edge line ei: the new hull is
//     v1..vi, p, vi+1..vn and every dot is still a corner: green.
// The green zone is therefore n disjoint convex "caps",
//   cap_i = square ∩ beyond(ei) ∩ inside(ej) for every j ≠ i,
// each an exact convex polygon clip (Sutherland–Hodgman against half-planes),
// and the chance the next dot lands in red is
//   q = 1 − Σ area(cap_i) / area(square),
// the red share of the square on the board (inside + shadows, one region).
// There is no sampling anywhere: the areas are shoelace sums of exact clip
// vertices.
//
// Pricing (per-step fair factor). Surviving a drop with red share q
// multiplies the cash-out by 1/(1 − q), so E[cash-out after the drop] =
// (1 − q)·cash/(1 − q) + q·0 = cash. The cash-out is a martingale that starts
// at RTP, every round ends within `target` drops, and by optional stopping
// every strategy (any cash-out rule, the auto-drop rule, playing to the end)
// returns exactly RTP. The first three drops are free (q = 0): three random
// points always make a triangle. There is no fixed full prize: placing the
// last dot pays the cash-out at that moment, which the board shows live.
//
// Max win. The green caps can be arbitrarily thin (a hull hugging the
// square's corners), so 1/(1 − q) is unbounded. Before a drop, if surviving
// would push the cash-out above MAX_WIN, the round auto-cashes instead. That
// is a stopping rule, so RTP is unchanged, and MAX_WIN bounds every payout. A
// drop with q = 1 is never offered either (same rule).
//
// Chance to place all n dots (Valtr 1995). n uniform points in a
// parallelogram are in convex position with probability (C(2n−2, n−1) / n!)².
// Convex position is hereditary (a subset of a convex-position set is one
// too), so dropping dots until the first red one places all n with exactly
// this probability. n = 4 is Sylvester's four-point problem: 25/36. This is
// exact only before the first drop; once dots are down the game shows the
// exact chance of the next drop (1 − q) instead.
//
// Tie rule: a point exactly on an edge line counts as not beyond it. Lines
// have zero area, so this never changes a probability.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

/** No payout exceeds this: the round auto-cashes before a drop that could. */
export const MAX_WIN = 10_000;

/** Free drops at the start: any three points are in convex position. */
export const FREE_DROPS = 3;

/** Dots to place (the round pays out when the last one lands in green). 4 is Sylvester's problem. */
export const TARGETS = [4, 5, 6, 7, 8] as const;
export type Target = (typeof TARGETS)[number];

/** The eval's configs, one per volatility level. */
export const VOLATILITY: Record<Volatility, { target: Target }> = {
  low: { target: 5 },
  medium: { target: 6 },
  high: { target: 7 },
  extreme: { target: 8 },
};

export interface Pt {
  x: number;
  y: number;
}

/** The square, in unit coordinates (y up), counter-clockwise. */
export const SQUARE: readonly Pt[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

/** cross((a − o), (b − o)): > 0 when b is left of the directed line o → a. */
export const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Shoelace area of a simple polygon (absolute value). */
export function polygonArea(poly: readonly Pt[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

/** A uniform point in the square, from two uniforms. */
export const samplePoint = (next: () => number): Pt => ({ x: next(), y: next() });

/** Strict convex hull, counter-clockwise (Andrew's monotone chain). Collinear points are dropped. Keeps the input objects. */
export function hull(points: readonly Pt[]): Pt[] {
  if (points.length < 3) return [...points];
  const s = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const chain = (list: Pt[]) => {
    const out: Pt[] = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...chain(s), ...chain(s.slice().reverse())];
}

/** Whether every point is a corner of the hull (the raw definition, used by the tests). */
export const inConvexPosition = (points: readonly Pt[]) => points.length < 3 || hull(points).length === points.length;

/** Keeps the part of a convex polygon on one side of the line a → b (left when side = 1, right when −1). */
export function clip(poly: readonly Pt[], a: Pt, b: Pt, side: 1 | -1): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    const P = poly[i];
    const Q = poly[(i + 1) % poly.length];
    const sp = side * cross(a, b, P);
    const sq = side * cross(a, b, Q);
    if (sp >= 0) out.push(P);
    if (sp >= 0 !== sq >= 0) {
      const t = sp / (sp - sq);
      out.push({ x: P.x + t * (Q.x - P.x), y: P.y + t * (Q.y - P.y) });
    }
  }
  return out;
}

/** How many hull edge lines p lies strictly beyond. 0 = inside, 1 = safe, ≥ 2 = swallows a corner. */
export function edgesBeyond(h: readonly Pt[], p: Pt): number {
  let k = 0;
  for (let i = 0; i < h.length; i++) if (cross(h[i], h[(i + 1) % h.length], p) < 0) k++;
  return k;
}

/** Whether a point dropped next keeps every point a corner (the hull must have ≥ 3 corners; fewer is always safe). */
export const landsSafe = (h: readonly Pt[], p: Pt) => h.length < 3 || edgesBeyond(h, p) === 1;

/** Corners that a point at p would swallow (p beyond both edges at the corner). */
export function swallowed(h: readonly Pt[], p: Pt): Pt[] {
  if (h.length < 3) return [];
  const n = h.length;
  const beyond = h.map((v, i) => cross(v, h[(i + 1) % n], p) < 0);
  return h.filter((_, i) => beyond[i] && beyond[(i + n - 1) % n]);
}

/** The triangle a new corner p adds to the hull: (previous corner, p, next corner). Null if p is not a corner. */
export function newWedge(h: readonly Pt[], p: Pt): [Pt, Pt, Pt] | null {
  const i = h.indexOf(p);
  if (i < 0 || h.length < 4) return null;
  return [h[(i + h.length - 1) % h.length], p, h[(i + 1) % h.length]];
}

export interface Zones {
  /** The hull, counter-clockwise. */
  hull: Pt[];
  /** The green landing caps, one per hull edge (empty caps are dropped). */
  caps: Pt[][];
  /** Chance the next dot lands in red: the red share of the square. */
  q: number;
}

/** The green caps and the exact chance the next dot lands in red. The square has area 1. */
export function zones(points: readonly Pt[]): Zones {
  if (points.length < FREE_DROPS) return { hull: hull(points), caps: [], q: 0 };
  const h = hull(points);
  const n = h.length;
  const caps: Pt[][] = [];
  let safe = 0;
  for (let i = 0; i < n; i++) {
    let cap: Pt[] = clip(SQUARE, h[i], h[(i + 1) % n], -1);
    for (let j = 0; j < n && cap.length >= 3; j++) if (j !== i) cap = clip(cap, h[j], h[(j + 1) % n], 1);
    if (cap.length < 3) continue;
    const a = polygonArea(cap);
    if (a <= 0) continue;
    caps.push(cap);
    safe += a;
  }
  const q = Math.min(1, Math.max(0, 1 - safe));
  return { hull: h, caps, q };
}

/** Cash-out after surviving a drop that had bust chance q. */
export const afterSafeDrop = (cash: number, q: number) => cash / (1 - q);

/** Whether the next drop must be skipped (auto cash-out) because surviving it would exceed MAX_WIN. */
export const hitsCap = (cash: number, q: number) => q >= 1 || afterSafeDrop(cash, q) > MAX_WIN;

const factorial = (n: number) => {
  let f = 1;
  for (let k = 2; k <= n; k++) f *= k;
  return f;
};
const choose = (n: number, k: number) => {
  let c = 1;
  for (let i = 1; i <= k; i++) c = (c * (n - k + i)) / i;
  return c;
};

/** Valtr: exact chance that n uniform points in the square are in convex position (= placing all n dots in green). */
export function convexChance(n: number): number {
  if (n <= 3) return 1;
  return (choose(2 * n - 2, n - 1) / factorial(n)) ** 2;
}

export const MAX_MULTIPLIER = MAX_WIN;
