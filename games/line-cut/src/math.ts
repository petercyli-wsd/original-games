// Line Cut: random lines are cut across a disc arena of radius 1 that holds
// five convex shapes. You pick one shape and back Hit (at least one line
// crosses it) or Miss (no line touches it).
//
// A random line is drawn with the Crofton measure, the only one that doesn't
// care where or which way the arena sits: a direction φ uniform over a
// half-turn and an offset p uniform in [−1, 1]. The line is { x : x·u = p }
// with u = (cos φ, sin φ), so it crosses the "ruler" (the diameter along u)
// at p, square to it. We draw φ in [−π/2, π/2) so the ruler's −1 end is
// always on the left of the screen; any half-turn gives the same lines,
// because (φ + π, −p) is the same line as (φ, p).
//
// The theorem (Cauchy–Crofton). Given φ, the line hits a convex shape K
// exactly when p lands in K's shadow on the ruler, the interval
// [min x·u, max x·u] over x in K. So P(hit | φ) = w_K(φ) / 2, where w_K(φ) is
// K's width in direction u and 2 is the ruler's length. Cauchy's formula says
// the mean width over all directions is perimeter / π, so
//
//     P(hit) = perimeter(K) / 2π = perimeter(K) / perimeter(arena).
//
// Only the outline's length matters, not the area or the position: a rod of
// length L (perimeter 2L, both sides) is as easy to hit as a disc of radius
// L / π. Here the rod and the circle both have a 30% chance per line, but
// they ride differently: a disc's shadow is its diameter in every direction,
// so its odds never move at the checkpoint, while the rod's shadow swings
// from nothing (end-on) to its full length (47% of the ruler).
//
// The round. With c = P(hit) per line, m = 1 − c and N ∈ {1, 2, 3, 5, 8} lines,
//     P(win) = 1 − m^N (Hit),   m^N (Miss).
// Each line is revealed in two stages: its direction (the ruler spins and the
// shape's shadow appears; the checkpoint) and then its offset (the cut lands).
// With k lines still to cut and the current one aimed with shadow share
// s = w(φ)/2,
//     P(win | S) = 1 − (1 − s)·m^(k−1) (Hit),   (1 − s)·m^(k−1) (Miss).
//
// Pricing (fixed prize). A win pays prize = RTP / P(win), and the cash-out at
// any state is prize × P(win | S). P(win | S) is a conditional probability of
// one fixed event, so it is a martingale: averaging the aimed formula over φ
// gives back the unaimed one because E[s] = c (Cauchy), and averaging over p
// gives back the aimed one because the line hits with chance exactly s. By
// optional stopping every cash-out rule returns exactly RTP, and every shape,
// side and line count is a fair choice because the prize is set from its own
// P(win). Payouts never exceed the prize, so the largest is RTP / min P(win)
// = 0.99 / 0.02 = 49.5× (Hit the dot with one line).
//
// Tie rule: a line that only touches a shape (p exactly at a shadow end)
// counts as a hit. That set has probability zero.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

export interface Pt {
  x: number;
  y: number;
}

export type ShapeId = 'circle' | 'rod' | 'square' | 'triangle' | 'dot';
export type Side = 'hit' | 'miss';

export const LINE_COUNTS = [1, 2, 3, 5, 8] as const;
export type Lines = (typeof LINE_COUNTS)[number];

interface Base {
  id: ShapeId;
  name: string;
}
export type Shape = (Base & { kind: 'disc'; c: Pt; r: number }) | (Base & { kind: 'poly'; verts: Pt[] });

/** Vertices of a regular n-gon with circumradius r, first vertex at angle a0 (radians, SVG orientation). */
function regular(c: Pt, n: number, r: number, a0: number): Pt[] {
  return Array.from({ length: n }, (_, i) => {
    const a = a0 + (2 * Math.PI * i) / n;
    return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
  });
}

function rod(c: Pt, length: number, angle: number): Pt[] {
  const dx = (length / 2) * Math.cos(angle);
  const dy = (length / 2) * Math.sin(angle);
  return [
    { x: c.x - dx, y: c.y - dy },
    { x: c.x + dx, y: c.y + dy },
  ];
}

/** Side of the square and the triangle: π/10, so they're hit 20% and 15% of the time. */
const SIDE = Math.PI / 10;

/**
 * The fixed layout, in arena units (radius 1, y pointing down as on screen).
 * Every shape sits wholly inside the arena, so every line that can hit it is
 * a line through the arena.
 */
export const SHAPES: Record<ShapeId, Shape> = {
  circle: { id: 'circle', name: 'Circle', kind: 'disc', c: { x: -0.38, y: -0.37 }, r: 0.3 },
  rod: { id: 'rod', name: 'Rod', kind: 'poly', verts: rod({ x: -0.2, y: 0.5 }, 0.3 * Math.PI, 0.52) },
  square: { id: 'square', name: 'Square', kind: 'poly', verts: regular({ x: 0.42, y: -0.38 }, 4, SIDE / Math.SQRT2, Math.PI / 4 + 0.26) },
  triangle: { id: 'triangle', name: 'Triangle', kind: 'poly', verts: regular({ x: 0.5, y: 0.2 }, 3, SIDE / Math.sqrt(3), -Math.PI / 2) },
  dot: { id: 'dot', name: 'Dot', kind: 'disc', c: { x: 0.12, y: 0.12 }, r: 0.02 },
};

export const SHAPE_IDS: ShapeId[] = ['circle', 'rod', 'square', 'triangle', 'dot'];

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** The shape's centre (centroid of the vertices for a polygon). */
export function centre(s: Shape): Pt {
  if (s.kind === 'disc') return s.c;
  const n = s.verts.length;
  return { x: s.verts.reduce((a, v) => a + v.x, 0) / n, y: s.verts.reduce((a, v) => a + v.y, 0) / n };
}

/** Length of the outline. A rod (a 2-gon) has perimeter twice its length. */
export function perimeter(s: Shape): number {
  if (s.kind === 'disc') return 2 * Math.PI * s.r;
  return s.verts.reduce((sum, v, i) => sum + dist(v, s.verts[(i + 1) % s.verts.length]), 0);
}

/** Chance that one random line hits the shape (Cauchy–Crofton): perimeter / 2π. */
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

/** The shape's shadow on the ruler at direction φ: the offsets p whose line hits it. */
export function shadow(s: Shape, phi: number): Interval {
  const u = unit(phi);
  if (s.kind === 'disc') {
    const m = s.c.x * u.x + s.c.y * u.y;
    return { lo: m - s.r, hi: m + s.r };
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of s.verts) {
    const d = v.x * u.x + v.y * u.y;
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  return { lo, hi };
}

/** P(hit | direction φ): the shadow's share of the ruler, w(φ) / 2. */
export function aimedCutChance(s: Shape, phi: number): number {
  const { lo, hi } = shadow(s, phi);
  return (hi - lo) / 2;
}

/** Whether the line at direction φ and offset p hits the shape (touching counts). */
export function lineHits(s: Shape, phi: number, p: number): boolean {
  const { lo, hi } = shadow(s, phi);
  return p >= lo && p <= hi;
}

/** P(win) with `left` lines still to come, none of them aimed yet. */
export function winChanceLeft(side: Side, left: number, c: number): number {
  const allMiss = (1 - c) ** left;
  return side === 'hit' ? 1 - allMiss : allMiss;
}

/** P(win) with `left` lines to come (counting the current one), the current one aimed with shadow share s. */
export function winChanceAimed(side: Side, left: number, s: number, c: number): number {
  const allMiss = (1 - s) * (1 - c) ** (left - 1);
  return side === 'hit' ? 1 - allMiss : allMiss;
}

/** P(win) at the start of a round. */
export const winChance = (shape: ShapeId, side: Side, lines: Lines) => winChanceLeft(side, lines, cutChance(SHAPES[shape]));

/** The full prize: RTP / P(win). */
export const prizeFor = (shape: ShapeId, side: Side, lines: Lines) => RTP / winChance(shape, side, lines);

export interface Setting {
  shape: ShapeId;
  side: Side;
  lines: Lines;
}

export const ALL_SETTINGS: Setting[] = SHAPE_IDS.flatMap((shape) =>
  (['hit', 'miss'] as const).flatMap((side) => LINE_COUNTS.map((lines) => ({ shape, side, lines }))),
);

/** The volatility level of a setting, from its win chance. */
export function volatilityOf(p: number): Volatility {
  return p >= 0.6 ? 'low' : p >= 0.3 ? 'medium' : p >= 0.1 ? 'high' : 'extreme';
}

/** Every payout is at most the prize, so this bounds any multiplier. */
export const MAX_MULTIPLIER = Math.max(...ALL_SETTINGS.map((s) => prizeFor(s.shape, s.side, s.lines)));
