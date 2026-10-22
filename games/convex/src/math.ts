// Convex: points drop uniformly into an arena (a square or a triangle), one
// at a time. You survive while every point is a corner of the convex hull,
// i.e. while the points are in convex position. Reach the target number of
// corners and the round pays out.
//
// The bust region. Let the hull have corners v1..vn (counter-clockwise) and
// edges ei = (vi, vi+1). Seen from a point p outside a convex polygon, the
// edges whose lines p lies beyond form one contiguous chain. So p either
//   - lies beyond no edge line: it is inside the hull, not a corner: lost;
//   - lies beyond two or more edge lines: the chain then contains two edges
//     that meet at a corner v, p is in v's "swallow cone"
//     {v + s(v − u) + t(v − w) : s, t ≥ 0} (u, w are v's neighbours), and v
//     falls inside the new hull: lost;
//   - lies beyond exactly one edge line ei: the new hull is
//     v1..vi, p, vi+1..vn and every point is still a corner: safe.
// The safe region is therefore n disjoint convex "caps",
//   cap_i = arena ∩ beyond(ei) ∩ inside(ej) for every j ≠ i,
// each an exact convex polygon clip (Sutherland–Hodgman against half-planes),
// and the bust chance of the next drop is
//   q = 1 − Σ area(cap_i) / area(arena),
// the red share of the arena on the board (hull ∪ swallow cones). There is
// no sampling anywhere: the areas are shoelace sums of exact clip vertices.
//
// Pricing (per-step fair factor). Surviving a drop with bust chance q
// multiplies the cash-out by 1/(1 − q), so E[cash-out after the drop] =
// (1 − q)·cash/(1 − q) + q·0 = cash. The cash-out is a martingale that starts
// at RTP, every round ends within `target` drops, and by optional stopping
// every strategy (any cash-out rule, the auto-drop rule, playing to the end)
// returns exactly RTP. The first three drops are free (q = 0): three random
// points always make a triangle.
//
// Max win. The safe caps can be arbitrarily thin (a hull hugging the arena's
// corners), so 1/(1 − q) is unbounded. Before a drop, if surviving would push
// the cash-out above MAX_WIN, the round auto-cashes instead. That is a
// stopping rule, so RTP is unchanged, and MAX_WIN bounds every payout. A drop
// with q = 1 is never offered either (same rule).
//
// Headline odds (Valtr 1995). n uniform points in a parallelogram are in
// convex position with probability (C(2n−2, n−1) / n!)²; in a triangle,
// 2ⁿ·(3n−3)! / ((n−1)!³·(2n)!). Convex position is hereditary (a subset of a
// convex-position set is one too), so dropping points until the first failure
// reaches n corners with exactly this probability. n = 4 is Sylvester's
// four-point problem: 25/36 in a square, 2/3 in a triangle. Because the
// played-to-the-end payout is a martingale that is 0 on a loss,
// E[full prize | complete] = RTP / P(complete): the "average full prize".
//
// Tie rule: a point exactly on an edge line counts as not beyond it. Lines
// have zero area, so this never changes a probability.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

/** No payout exceeds this: the round auto-cashes before a drop that could. */
export const MAX_WIN = 10_000;

/** Free drops at the start: any three points are in convex position. */
export const FREE_DROPS = 3;

export const ARENAS = ['square', 'triangle'] as const;
export type Arena = (typeof ARENAS)[number];

/** Corners to build (the round pays out when the last one lands safe). 4 is Sylvester's problem. */
export const TARGETS = [4, 5, 6, 7, 8] as const;
export type Target = (typeof TARGETS)[number];

export const POLYGON_NAME: Record<Target, string> = {
  4: 'quadrilateral',
  5: 'pentagon',
  6: 'hexagon',
  7: 'heptagon',
  8: 'octagon',
};

/** The eval's configs, one per volatility level. */
export const VOLATILITY: Record<Volatility, { arena: Arena; target: Target }> = {
  low: { arena: 'square', target: 5 },
  medium: { arena: 'triangle', target: 6 },
  high: { arena: 'square', target: 7 },
  extreme: { arena: 'triangle', target: 8 },
};

export interface Pt {
  x: number;
  y: number;
}

const H = Math.sqrt(3) / 2;
const LIFT = (1 - H) / 2;

/** The arenas in unit coordinates (y up), counter-clockwise. The triangle is equilateral and centred in the unit box. */
const ARENA_POLY: Record<Arena, Pt[]> = {
  square: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ],
  triangle: [
    { x: 0, y: LIFT },
    { x: 1, y: LIFT },
    { x: 0.5, y: LIFT + H },
  ],
};

export const arenaPolygon = (arena: Arena): readonly Pt[] => ARENA_POLY[arena];

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

export const arenaArea = (arena: Arena) => polygonArea(ARENA_POLY[arena]);

/** A uniform point in the arena, from two uniforms. The triangle folds the unit square onto itself (exactly uniform). */
export function samplePoint(arena: Arena, next: () => number): Pt {
  const u = next();
  const v = next();
  if (arena === 'square') return { x: u, y: v };
  const [a, b, c] = ARENA_POLY.triangle;
  const [s, t] = u + v > 1 ? [1 - u, 1 - v] : [u, v];
  return { x: a.x + s * (b.x - a.x) + t * (c.x - a.x), y: a.y + s * (b.y - a.y) + t * (c.y - a.y) };
}

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
  /** The safe landing caps, one per hull edge (empty caps are dropped). */
  caps: Pt[][];
  /** Chance the next drop busts: the red share of the arena. */
  q: number;
}

/** The safe caps and the exact bust chance for the next drop. */
export function zones(points: readonly Pt[], arena: Arena): Zones {
  if (points.length < FREE_DROPS) return { hull: hull(points), caps: [], q: 0 };
  const h = hull(points);
  const n = h.length;
  const caps: Pt[][] = [];
  let safe = 0;
  for (let i = 0; i < n; i++) {
    let cap: Pt[] = clip(ARENA_POLY[arena], h[i], h[(i + 1) % n], -1);
    for (let j = 0; j < n && cap.length >= 3; j++) if (j !== i) cap = clip(cap, h[j], h[(j + 1) % n], 1);
    if (cap.length < 3) continue;
    const a = polygonArea(cap);
    if (a <= 0) continue;
    caps.push(cap);
    safe += a;
  }
  const q = Math.min(1, Math.max(0, 1 - safe / arenaArea(arena)));
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

/** Valtr: exact chance that n uniform points in the arena are in convex position. */
export function convexChance(n: number, arena: Arena): number {
  if (n <= 3) return 1;
  if (arena === 'square') return (choose(2 * n - 2, n - 1) / factorial(n)) ** 2;
  return (2 ** n * factorial(3 * n - 3)) / (factorial(n - 1) ** 3 * factorial(2 * n));
}

/** E[full prize | the polygon completes] = RTP / P(complete) (ignoring the rarely-binding max-win stop). */
export const averageFullPrize = (n: number, arena: Arena) => RTP / convexChance(n, arena);

export const MAX_MULTIPLIER = MAX_WIN;
