// Halo: a particle starts at the centre of a unit disc and wanders by
// Brownian motion until it reaches the rim. You win if it leaves through the
// green arc G.
//
// The theorem (harmonic measure). From a point z the chance of leaving
// through G is ω(z, G), the Poisson integral of G's indicator. Brownian
// motion is conformally invariant, so move z to the centre with the disc
// automorphism φ_z(w) = (w − z)/(1 − z̄w). From the centre every exit point is
// equally likely, so
//
//     ω(z, G) = |φ_z(G)| / 2π,
//
// the length of the mapped arc. At the centre that is |G|/360°. Because
// (φ_z⁻¹)'(0) = 1 − |z|² is real and positive, φ_z⁻¹ turns the radius of the
// mapped disc in direction θ into the hyperbolic geodesic leaving z in the
// same direction θ. So the mapped arc is literally a set of directions at z:
// the particle's halo. Its green part, the directions whose geodesics reach
// G, is a fraction ω of a full turn. The level sets {ω = c} are circular arcs
// through G's ends, from which G's chord is seen under the angle πc + |G|/2.
//
// The walk. Each leg runs to the next checkpoint ring ρ (concentric, inside
// the rim). It is exact "walk on circles": from p, with d = ρ − |p|, hop to a
// uniform point on the circle of radius d/2 around p (Brownian motion leaves a
// disc from its centre uniformly, and that disc lies inside the ring). Once
// d < ε, the hit point on the ring is sampled exactly from the ring's own
// harmonic measure: a uniform angle mapped back through φ_{p/ρ}. Every hop is
// a point the Brownian path really visits; the stopping rules are stopping
// times, so the ring hit has exactly Brownian law. The last leg, "release",
// samples the rim exit exactly: a uniform direction on the halo, followed
// along its geodesic to the rim. It wins exactly when it is green, i.e. with
// chance ω.
//
// Pricing (fixed prize). Leaving through G pays prize = RTP · 360°/|G|. The
// cash-out at z is prize · ω(z). ω is harmonic and bounded, so ω(B_t) is a
// martingale: by the strong Markov property E[ω(next stop)] = ω(now) for every
// hop, ring and release. The cash-out starts at prize · |G|/360° = RTP, and by
// optional stopping every strategy (cash out at any ring, release early, any
// ring count) returns exactly RTP. A cash-out never exceeds the prize, so the
// largest payout is the 5° prize, 71.28×.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

/** Green arc sizes, in degrees. From the centre the chance is arc / 360°: 1 in 72 up to 3 in 4. */
export const ARC_MIN = 5;
export const ARC_MAX = 270;
export const ARC_STEP = 5;

/** Checkpoint rings before the rim. 0 releases the particle straight from the centre. */
export const RINGS = [0, 2, 4, 6] as const;
export type Rings = (typeof RINGS)[number];

export const VOLATILITY: Record<Volatility, { arc: number; rings: Rings }> = {
  low: { arc: 270, rings: 2 },
  medium: { arc: 90, rings: 4 },
  high: { arc: 30, rings: 4 },
  extreme: { arc: 5, rings: 6 },
};

/** The chance to win from the centre, before anything moves. */
export const startChance = (arc: number) => arc / 360;

/** What leaving through the green arc pays, as a multiple of the stake. */
export const prize = (arc: number) => (RTP * 360) / arc;

export const MAX_MULTIPLIER = prize(ARC_MIN);

export function volatilityOf(arc: number): Volatility {
  const p = startChance(arc);
  return p >= 0.3 ? 'low' : p >= 0.1 ? 'medium' : p >= 0.03 ? 'high' : 'extreme';
}

// ---------------------------------------------------------------- geometry

/** A point in the unit disc, y up. */
export interface Pt {
  x: number;
  y: number;
}

export const TAU = 2 * Math.PI;
export const CENTRE: Pt = { x: 0, y: 0 };
export const mod = (x: number, m: number) => ((x % m) + m) % m;
export const polar = (t: number, r = 1): Pt => ({ x: r * Math.cos(t), y: r * Math.sin(t) });
export const angleOf = (p: Pt) => Math.atan2(p.y, p.x);
export const norm = (p: Pt) => Math.hypot(p.x, p.y);

/** Angles (radians, counter-clockwise from +x) of G's ends. G runs counter-clockwise from a to b and is centred on the top. */
export function arcEnds(arc: number) {
  const h = (arc * Math.PI) / 360;
  return { a: Math.PI / 2 - h, b: Math.PI / 2 + h };
}

/** Whether a rim angle lies in G (half-open: the clockwise end is in, the other end is out). */
export function inArc(t: number, arc: number) {
  const { a } = arcEnds(arc);
  return mod(t - a, TAU) < (arc * Math.PI) / 180;
}

/** φ_z(w) = (w − z) / (1 − z̄w): the disc automorphism taking z to the centre. */
export function toCentre(z: Pt, w: Pt): Pt {
  const nx = w.x - z.x;
  const ny = w.y - z.y;
  const dx = 1 - (z.x * w.x + z.y * w.y);
  const dy = -(z.x * w.y - z.y * w.x);
  const d2 = dx * dx + dy * dy;
  return { x: (nx * dx + ny * dy) / d2, y: (ny * dx - nx * dy) / d2 };
}

/** φ_z⁻¹(s) = (s + z) / (1 + z̄s): takes the centre back to z. */
export function fromCentre(z: Pt, s: Pt): Pt {
  const nx = s.x + z.x;
  const ny = s.y + z.y;
  const dx = 1 + (z.x * s.x + z.y * s.y);
  const dy = z.x * s.y - z.y * s.x;
  const d2 = dx * dx + dy * dy;
  return { x: (nx * dx + ny * dy) / d2, y: (ny * dx - nx * dy) / d2 };
}

export interface Arc {
  /** Start angle, radians counter-clockwise from +x. */
  start: number;
  /** Counter-clockwise length, radians. */
  length: number;
}

/**
 * The particle's halo: the directions at z whose geodesics reach G, i.e. G's
 * image under φ_z. Its length over 2π is the exact chance to win from z.
 */
export function haloArc(z: Pt, arc: number): Arc {
  const { a, b } = arcEnds(arc);
  const start = angleOf(toCentre(z, polar(a)));
  const end = angleOf(toCentre(z, polar(b)));
  return { start, length: mod(end - start, TAU) };
}

/** ω(z, G): the exact chance that Brownian motion from z leaves the disc through G. */
export const winChance = (z: Pt, arc: number) => haloArc(z, arc).length / TAU;

/** The cash-out at z, as a multiple of the stake. */
export const cashOut = (z: Pt, arc: number) => prize(arc) * winChance(z, arc);

/**
 * The same chance from the inscribed-angle formula: from z, G's chord is seen
 * under the angle Θ (measured on G's side) and ω = Θ/π − |G|/360°. Used by the
 * tests as an independent check of the Möbius formula.
 */
export function winChanceByAngle(z: Pt, arc: number): number {
  const { a, b } = arcEnds(arc);
  const A = polar(a);
  const B = polar(b);
  // The angle swept counter-clockwise from the ray z→A to the ray z→B passes over G.
  const theta = mod(angleOf({ x: B.x - z.x, y: B.y - z.y }) - angleOf({ x: A.x - z.x, y: A.y - z.y }), TAU);
  return theta / Math.PI - arc / 360;
}

// ---------------------------------------------------------------- rings and the walk

/** The last checkpoint ring; the release happens from there at the latest. */
export const LAST_RING = 0.9;

/** Radii of the checkpoint rings: their gaps to the rim shrink geometrically down to 1 − LAST_RING. */
export function ringRadii(n: number): number[] {
  return Array.from({ length: n }, (_, i) => 1 - (1 - LAST_RING) ** ((i + 1) / n));
}

/** Where Brownian motion from z first meets the circle of radius rho (> |z|), for a uniform u in [0, 1). */
export function ringHit(z: Pt, rho: number, u: number): Pt {
  const w = fromCentre({ x: z.x / rho, y: z.y / rho }, polar(TAU * u));
  const r = norm(w);
  return { x: (rho * w.x) / r, y: (rho * w.y) / r };
}

/** Density of the hit angle on the circle of radius rho from z, relative to dt / 2π (the Poisson kernel). */
export function hitDensity(z: Pt, rho: number, t: number) {
  const p = polar(t, rho);
  return (rho * rho - z.x * z.x - z.y * z.y) / ((p.x - z.x) ** 2 + (p.y - z.y) ** 2);
}

/** Each hop's radius as a share of the distance to the ring. */
export const HOP = 0.5;
/** Hops per leg before the exact ring sample takes over (a stopping rule, so still exact). */
export const MAX_HOPS = 240;

/** How close to the ring the walk gets before sampling the hit point exactly. */
export const legEps = (from: number, rho: number) => Math.max(0.003, 0.05 * (rho - from));

/**
 * One leg: walk on circles from z towards the ring of radius rho, then the
 * exact hit point. Returns every visited point; the last one is on the ring.
 */
export function leg(z: Pt, rho: number, next: () => number, eps = legEps(norm(z), rho)): Pt[] {
  const path: Pt[] = [z];
  let p = z;
  for (let i = 0; i < MAX_HOPS; i++) {
    const d = rho - norm(p);
    if (d < eps) break;
    const t = TAU * next();
    p = { x: p.x + HOP * d * Math.cos(t), y: p.y + HOP * d * Math.sin(t) };
    path.push(p);
  }
  path.push(ringHit(p, rho, next()));
  return path;
}

export interface Release {
  win: boolean;
  /** The direction the halo's pointer stops at (radians). */
  theta: number;
  /** Where the particle leaves the disc. */
  exit: Pt;
}

/**
 * The final leg: a uniform u in [0, 1) picks a direction on the halo. It wins
 * exactly when u < ω(z) (ties lose), and the particle leaves at the end of the
 * geodesic in that direction, φ_z⁻¹(e^{iθ}).
 */
export function release(z: Pt, arc: number, u: number): Release {
  const h = haloArc(z, arc);
  const theta = h.start + TAU * u;
  return { win: u < h.length / TAU, theta, exit: fromCentre(z, polar(theta)) };
}

/** The hyperbolic geodesic leaving z in direction theta, out to the rim (n + 1 points). */
export function geodesic(z: Pt, theta: number, n = 72): Pt[] {
  // Dense near the rim, where a long geodesic covers most of its length.
  return Array.from({ length: n + 1 }, (_, i) => fromCentre(z, polar(theta, 1 - (1 - i / n) ** 2)));
}

// ---------------------------------------------------------------- iso-odds arcs

/** Where the level set {ω = c} crosses the vertical axis (G's axis of symmetry). */
export function levelApex(arc: number, c: number): number {
  const h = (arc * Math.PI) / 360;
  // On the axis, ω(0, y) = (2/π)·atan2(sin h, cos h − y) − h/π.
  const beta = (Math.PI * c + h) / 2;
  return Math.cos(h) - Math.sin(h) * (Math.cos(beta) / Math.sin(beta));
}

/** The level set {ω = c} for 0 < c < 1: a circular arc from one end of G, through the apex, to the other (n + 1 points). */
export function levelCurve(arc: number, c: number, n = 64): Pt[] {
  const h = (arc * Math.PI) / 360;
  const A = { x: Math.sin(h), y: Math.cos(h) };
  const B = { x: -Math.sin(h), y: Math.cos(h) };
  const y = levelApex(arc, c);
  if (Math.abs(y - A.y) < 1e-9) {
    return Array.from({ length: n + 1 }, (_, i) => ({ x: A.x + (B.x - A.x) * (i / n), y: A.y }));
  }
  // The circle through A, B and (0, y) is centred at (0, k).
  const k = (y * y - 1) / (2 * (y - A.y));
  const r = Math.abs(y - k);
  const fa = Math.atan2(A.y - k, A.x);
  const fb = Math.atan2(B.y - k, B.x);
  const fp = Math.atan2(y - k, 0);
  const ccw = mod(fb - fa, TAU);
  const sweep = mod(fp - fa, TAU) <= ccw ? ccw : ccw - TAU;
  return Array.from({ length: n + 1 }, (_, i) => polar(fa + sweep * (i / n), r)).map((p) => ({ x: p.x, y: p.y + k }));
}

/** Candidate contour levels; the board keeps the ones that don't crowd each other. */
export const LEVELS = [0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.98] as const;
