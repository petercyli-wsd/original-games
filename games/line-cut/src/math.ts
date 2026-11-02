// Line Cut: one random line is cut across a disc arena of radius 1 that holds
// the one shape you picked. You win if the line cuts your shape.
//
// A random line is drawn with the Crofton measure, the only one that doesn't
// care where or which way the arena sits: a direction φ uniform over a
// half-turn and an offset p uniform in [−1, 1]. The line is { x : x·u = p }
// with u = (cos φ, sin φ), so it crosses the "ruler" (the diameter along u)
// at p, square to it. We draw φ in [−π/2, π/2) so the ruler's −1 end is
// always on the left of the screen; any half-turn gives the same lines,
// because (φ + π, −p) is the same line as (φ, p).
//
// The theorem (Cauchy–Crofton). Given φ, the line cuts a convex shape K
// exactly when p lands in K's shadow on the ruler, the interval
// [min x·u, max x·u] over x in K. So P(cut | φ) = w_K(φ) / 2, where w_K(φ) is
// K's width in direction u and 2 is the ruler's length. Cauchy's formula says
// the mean width over all directions is perimeter / π, so
//
//     P(cut) = E[w_K(φ)] / 2 = perimeter(K) / 2π.
//
// Only the outline's length matters, not the area or the position, which is
// why each shape sits at the centre of the arena. The shape is the one risk
// knob: pin 2%, triangle 10%, square 20%, rod 30%, plank 60%. None of them is
// round, so the direction always matters: a shape is wider seen from some
// sides than others (the rod's shadow swings from nothing, end-on, to 47%
// of the ruler, side-on).
//
// The round has two reveals. First the direction (the ruler spins and the
// shadow appears, with share s = w(φ)/2): the checkpoint. Then the offset
// (the line lands, cutting with chance exactly s).
//
//     P(win | start) = c = perimeter / 2π,   P(win | aimed) = s,   then 1 or 0.
//
// Pricing (fixed prize). A win pays prize = RTP / c, and the cash-out at any
// state is prize × P(win | state). P(win | state) is a conditional
// probability of one fixed event, so it is a martingale: averaging s over φ
// gives back c (Cauchy), and the line cuts with chance exactly s. By optional
// stopping every cash-out rule returns exactly RTP, and every shape is a fair
// choice because its prize is set from its own c. Payouts never exceed the
// prize, so the largest is RTP / 0.02 = 49.5× (cut the pin).
//
// Tie rule: a line that only touches a shape (p exactly at a shadow end)
// counts as a cut. That set has probability zero.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

export interface Pt {
  x: number;
  y: number;
}

export type ShapeId = 'pin' | 'triangle' | 'square' | 'rod' | 'plank';

/** A convex polygon (a rod is a 2-gon), centred on the arena's centre. */
export interface Shape {
  id: ShapeId;
  name: string;
  verts: Pt[];
}

const rot = (p: Pt, a: number): Pt => ({ x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) });

/** A segment of the given length through the centre, at angle a (radians, SVG orientation). */
function rod(length: number, a: number): Pt[] {
  return [rot({ x: -length / 2, y: 0 }, a), rot({ x: length / 2, y: 0 }, a)];
}

/** A w × h rectangle centred on the centre, turned by a. */
function rect(w: number, h: number, a: number): Pt[] {
  return [
    { x: -w / 2, y: -h / 2 },
    { x: w / 2, y: -h / 2 },
    { x: w / 2, y: h / 2 },
    { x: -w / 2, y: h / 2 },
  ].map((p) => rot(p, a));
}

/** An isosceles triangle with base b and outline P, centroid on the centre, apex up, turned by a. */
function wedge(b: number, P: number, a: number): Pt[] {
  const leg = (P - b) / 2;
  const h = Math.sqrt(leg * leg - (b * b) / 4);
  return [
    { x: 0, y: (-2 * h) / 3 },
    { x: b / 2, y: h / 3 },
    { x: -b / 2, y: h / 3 },
  ].map((p) => rot(p, a));
}

/**
 * The shapes, in arena units (radius 1, y pointing down as on screen). Each
 * outline is set so that perimeter / 2π is a round chance. Every shape sits
 * wholly inside the arena, so every line that can cut it is a line through
 * the arena.
 */
export const SHAPES: Record<ShapeId, Shape> = {
  pin: { id: 'pin', name: 'Pin', verts: rod(0.02 * Math.PI, -0.6) },
  triangle: { id: 'triangle', name: 'Triangle', verts: wedge(0.04 * Math.PI, 0.2 * Math.PI, 0.35) },
  square: { id: 'square', name: 'Square', verts: rect(0.1 * Math.PI, 0.1 * Math.PI, 0.26) },
  rod: { id: 'rod', name: 'Rod', verts: rod(0.3 * Math.PI, -0.52) },
  plank: { id: 'plank', name: 'Plank', verts: rect(0.6 * Math.PI - 0.4, 0.4, -0.3) },
};

export const SHAPE_IDS: ShapeId[] = ['pin', 'triangle', 'square', 'rod', 'plank'];

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Length of the outline. A rod (a 2-gon) has perimeter twice its length. */
export function perimeter(s: Shape): number {
  return s.verts.reduce((sum, v, i) => sum + dist(v, s.verts[(i + 1) % s.verts.length]), 0);
}

/** Chance that one random line cuts the shape (Cauchy–Crofton): perimeter / 2π. */
export const cutChance = (s: Shape) => perimeter(s) / (2 * Math.PI);

export const unit = (phi: number): Pt => ({ x: Math.cos(phi), y: Math.sin(phi) });

/** A uniform direction over the half-turn [−π/2, π/2), from a uniform u in [0, 1). */
export const direction = (u: number) => (u - 0.5) * Math.PI;

/** A uniform offset along the ruler, in [−1, 1), from a uniform u in [0, 1). */
export const offset = (u: number) => 2 * u - 1;

export interface Interval {
  lo: number;
  hi: number;
}

/** The shape's shadow on the ruler at direction φ: the offsets p whose line cuts it. */
export function shadow(s: Shape, phi: number): Interval {
  const u = unit(phi);
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of s.verts) {
    const d = v.x * u.x + v.y * u.y;
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  return { lo, hi };
}

/** P(cut | direction φ): the shadow's share of the ruler, w(φ) / 2. */
export function aimedCutChance(s: Shape, phi: number): number {
  const { lo, hi } = shadow(s, phi);
  return (hi - lo) / 2;
}

/** Whether the line at direction φ and offset p cuts the shape (touching counts). */
export function lineHits(s: Shape, phi: number, p: number): boolean {
  const { lo, hi } = shadow(s, phi);
  return p >= lo && p <= hi;
}

/**
 * The narrowest and widest shadow over all directions, as shares of the ruler.
 * Exact for a convex polygon: the widest width is its diameter (the longest
 * vertex-to-vertex distance), the narrowest is attained square to an edge.
 */
export function shadowRange(s: Shape): Interval {
  const vs = s.verts;
  let hi = 0;
  for (const a of vs) for (const b of vs) hi = Math.max(hi, dist(a, b));
  let lo = Infinity;
  vs.forEach((a, i) => {
    const b = vs[(i + 1) % vs.length];
    const len = dist(a, b);
    const far = Math.max(...vs.map((v) => Math.abs((b.x - a.x) * (v.y - a.y) - (b.y - a.y) * (v.x - a.x)) / len));
    lo = Math.min(lo, far);
  });
  // A rod's narrowest shadow is exactly 0; don't show rounding noise.
  return { lo: lo < 1e-12 ? 0 : lo / 2, hi: hi / 2 };
}

/** P(win) at the start of a round: the shape's average shadow. */
export const winChance = (shape: ShapeId) => cutChance(SHAPES[shape]);

/** The full prize: RTP / P(win). */
export const prizeFor = (shape: ShapeId) => RTP / winChance(shape);

/** The volatility level of a shape, from its win chance. */
export function volatilityOf(p: number): Volatility {
  return p >= 0.5 ? 'low' : p >= 0.25 ? 'medium' : p >= 0.05 ? 'high' : 'extreme';
}

/** Every payout is at most the prize, so this bounds any multiplier. */
export const MAX_MULTIPLIER = Math.max(...SHAPE_IDS.map(prizeFor));
