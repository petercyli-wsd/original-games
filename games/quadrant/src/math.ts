// Quadrant: a point (x, y) is drawn from a standard bivariate normal cloud
// with correlation ρ. Back "Top-right" (x > 0 and y > 0) or "Same sign"
// (x and y both positive or both negative). With several points, every one
// of them must land in the target. Each point is revealed in two stages:
// first x, then y.
//
// The theorem (Sheppard, 1899): P(x > 0, y > 0) = ¼ + arcsin(ρ)/2π.
//
// Proof by geometry, which is also how the board draws the odds. Write
// x = g₁ and y = g₁·cos θ + g₂·sin θ, where (g₁, g₂) is a round (isotropic)
// Gaussian and ρ = cos θ. In that round frame the lines x = 0 and y = 0 are
// two lines through the centre meeting at angle θ, and the top-right quadrant
// is a wedge of angle 180° − θ. A round Gaussian points every way equally
// often, so P(top-right) = (180° − θ)/360°, which is Sheppard's formula
// because arcsin ρ = 90° − θ. Same sign is two such wedges: 1 − θ/180°.
//
// θ runs over whole multiples of 10°, so ρ = cos θ goes from 0.98 to −0.98
// and every chance is a whole number of 36ths. The board cuts the cloud into
// 36 slices, the images of 10° wedges of the round frame. The squash from the
// round frame to the plane is linear, so it scales every area by the same
// factor: each slice holds 1/36 of the chance AND 1/36 of the ellipse's area.
// The green share of the ellipse (the count of green slices) is the exact
// win chance, and the axes always fall on slice edges.
//
// Stage 1 reveals x. Given x, y = x·cos θ + z·sin θ with z standard normal,
// so P(y > 0 | x) = Φ(x·cot θ) = Φ(ρx/√(1 − ρ²)). The board draws this bell
// of y on the vertical slice through x; its green share is the chance.
// Stage 2 reveals y and the point lands.
//
// Tie rule: a coordinate of exactly 0 counts as a miss (probability zero).
//
// Pricing (fixed prize). With n points and single-point chance p, a full win
// pays prize = RTP / pⁿ. In any state, with k points already landed,
//   cash-out = prize × P(win | state)
//            = prize × pⁿ⁻ᵏ                         before the next x,
//            = prize × P(point lands | x) × pⁿ⁻ᵏ⁻¹  once its x is known.
// Each reveal averages P(win | state) back to its current value (the tower
// property: E[P(lands | x)] = p), so the cash-out is a martingale starting
// at RTP, and by optional stopping every cash-out strategy returns exactly
// RTP. When an x settles its point (top-right with x ≤ 0, or a chance that is
// exactly 0 or 1 in floating point) no checkpoint is offered and y is
// revealed straight away: that is the play-on strategy, so it is fair too.
// No payout exceeds the prize; the largest is three top-right points at
// ρ = cos 170°: 0.99 × 36³ = 46,189.44×.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

export type Target = 'corner' | 'same';
export const TARGETS: readonly Target[] = ['corner', 'same'];
export const TARGET_LABEL: Record<Target, string> = { corner: 'Top-right', same: 'Same sign' };

/** The angle θ between the axes in the round frame, in degrees. ρ = cos θ. */
export const ANGLES = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170] as const;

/** How many points must land. */
export const POINTS = [1, 2, 3] as const;
export type Points = (typeof POINTS)[number];

/** The cloud is cut into this many equal-chance slices (10° of the round frame each). */
export const SLICES = 36;
export const SLICE_DEG = 360 / SLICES;

export interface Settings {
  target: Target;
  /** θ in degrees, a multiple of 10 from 10 to 170. */
  theta: number;
  points: Points;
}

export const VOLATILITY: Record<Volatility, Settings> = {
  low: { target: 'same', theta: 20, points: 1 },
  medium: { target: 'same', theta: 60, points: 2 },
  high: { target: 'corner', theta: 90, points: 2 },
  extreme: { target: 'corner', theta: 140, points: 3 },
};

// ---------- trigonometry in degrees, exact at the quarter turns ----------

const RAD = Math.PI / 180;
const mod360 = (d: number) => ((d % 360) + 360) % 360;

export function cosDeg(d: number): number {
  const m = mod360(d);
  if (m === 90 || m === 270) return 0;
  if (m === 0) return 1;
  if (m === 180) return -1;
  return Math.cos(m * RAD);
}

export function sinDeg(d: number): number {
  const m = mod360(d);
  if (m === 0 || m === 180) return 0;
  if (m === 90) return 1;
  if (m === 270) return -1;
  return Math.sin(m * RAD);
}

/** The correlation for an axis angle θ. */
export const rhoOf = (theta: number) => cosDeg(theta);

// ---------- the standard normal ----------

const LN_SQRT_2PI = 0.918938533204672741780329736406;

/** Standard normal density. */
export const phi = (z: number) => Math.exp(-0.5 * z * z - LN_SQRT_2PI);

/** Q(z) = 1 − Φ(z) for z ≥ 3, by the Laplace continued fraction (backward evaluation). */
function upperTail(z: number): number {
  let f = z;
  for (let k = 240; k >= 1; k--) f = z + k / f;
  return Math.exp(-0.5 * z * z - LN_SQRT_2PI) / f;
}

/**
 * Standard normal distribution function, accurate to about 1e-16 absolute
 * (and relative in the lower tail). Marsaglia's Taylor series in the middle,
 * the continued fraction in the tails.
 */
export function Phi(z: number): number {
  if (Number.isNaN(z)) return NaN;
  if (z <= -3) return upperTail(-z);
  if (z >= 3) return 1 - upperTail(z);
  const q = z * z;
  let s = z;
  let t = 0;
  let b = z;
  let i = 1;
  while (s !== t) {
    t = s;
    i += 2;
    b *= q / i;
    s = t + b;
  }
  return 0.5 + s * Math.exp(-0.5 * q - LN_SQRT_2PI);
}

// ---------- chances ----------

/** Chance one point lands in the target (Sheppard), before anything is revealed. */
export const pPoint = (target: Target, theta: number) => ((target === 'corner' ? 1 : 2) * (180 - theta)) / 360;

/** The same chance in terms of ρ, as Sheppard wrote it. */
export const sheppard = (target: Target, rho: number) =>
  target === 'corner' ? 0.25 + Math.asin(rho) / (2 * Math.PI) : 0.5 + Math.asin(rho) / Math.PI;

/** How many of the 36 equal-chance slices are green. */
export const greenSlices = (target: Target, theta: number) => Math.round(pPoint(target, theta) * SLICES);

/** The chance of each quadrant: top-right, top-left, bottom-left, bottom-right. */
export const quadrantChances = (theta: number) => [(180 - theta) / 360, theta / 360, (180 - theta) / 360, theta / 360];

/** Chance to win the whole bet before anything is revealed. */
export const pWin0 = (s: Settings) => pPoint(s.target, s.theta) ** s.points;

/** The full prize. */
export const prize = (s: Settings) => RTP / pWin0(s);

/** Where y lands once x is known: y ~ N(x cos θ, sin² θ). */
export const condY = (x: number, theta: number) => ({ mean: x * cosDeg(theta), sd: sinDeg(theta) });

/** Which sign y needs once x is known: +1, −1, or 0 when no y can win. */
export function needSign(target: Target, x: number): 1 | -1 | 0 {
  if (x > 0) return 1;
  if (x < 0 && target === 'same') return -1;
  return 0;
}

/** P(the point lands in the target | x) = Φ(±x cot θ), or 0. */
export function pLandGivenX(target: Target, theta: number, x: number): number {
  const s = needSign(target, x);
  if (s === 0) return 0;
  const { mean, sd } = condY(x, theta);
  return Phi((s * mean) / sd);
}

/** Whether a point is in the target. Tie rule: a zero coordinate is a miss. */
export const inTarget = (target: Target, x: number, y: number) =>
  target === 'corner' ? x > 0 && y > 0 : (x > 0 && y > 0) || (x < 0 && y < 0);

/** The state of a round: points already landed, and the current point's x if revealed. */
export interface State {
  landed: number;
  x: number | null;
}

/** P(win the bet | state). */
export function pWin(s: Settings, st: State): number {
  const p = pPoint(s.target, s.theta);
  if (st.x === null) return p ** (s.points - st.landed);
  return pLandGivenX(s.target, s.theta, st.x) * p ** (s.points - st.landed - 1);
}

/** The fair cash-out: prize × P(win | state). A martingale starting at RTP. */
export const cashOut = (s: Settings, st: State) => prize(s) * pWin(s, st);

/** An x settles its point when the chance is exactly 0 or 1: y is then revealed at once. */
export const settles = (pLand: number) => pLand === 0 || pLand === 1;

export function volatilityOf(s: Settings): Volatility {
  const p = pWin0(s);
  return p >= 0.45 ? 'low' : p >= 0.15 ? 'medium' : p >= 0.02 ? 'high' : 'extreme';
}

/** Any payout is at most the prize, which peaks at three top-right points with θ = 170°. */
export const MAX_MULTIPLIER = Math.max(
  ...ANGLES.flatMap((theta) => TARGETS.flatMap((target) => POINTS.map((points) => prize({ target, theta, points })))),
);

// ---------- sampling (outcomes come from host.rng) ----------

export interface Uniform {
  next(): number;
}

/** A standard normal from two uniforms (Box–Muller). */
export function normal(rng: Uniform): number {
  const u = 1 - rng.next(); // (0, 1]
  const v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export const drawX = (rng: Uniform) => normal(rng);

/** y given x, from the construction y = x cos θ + z sin θ. */
export const drawY = (x: number, theta: number, rng: Uniform) => x * cosDeg(theta) + sinDeg(theta) * normal(rng);

// ---------- the odds as drawn ----------

export type Pt = [number, number];

/** The point of the cloud's ellipse of radius R (in the round frame) at round-frame angle φ, in degrees. */
export const cloudPoint = (phiDeg: number, theta: number, R: number): Pt => [R * cosDeg(phiDeg), R * cosDeg(phiDeg - theta)];

/** Round-frame angle of a plane point, in [0, 360). */
export function roundAngle(x: number, y: number, theta: number): number {
  const g2 = (y - x * cosDeg(theta)) / sinDeg(theta);
  return mod360(Math.atan2(g2, x) / RAD);
}

/**
 * The target's wedges in the round frame, [from, to] in degrees. The line
 * x = 0 is at 90° and 270°, the line y = 0 at θ ± 90°.
 */
export function targetWedges(target: Target, theta: number): [number, number][] {
  const w: [number, number][] = [[theta - 90, 90]];
  if (target === 'same') w.push([theta + 90, 270]);
  return w;
}

/** The complementary wedges (the miss region). */
export function missWedges(target: Target, theta: number): [number, number][] {
  if (target === 'same') return [[90, theta + 90], [270, theta + 270]];
  return [[90, theta + 270]];
}

/** A fan polygon from the centre along the ellipse from angle a to b, in steps of at most 1°. */
export function fan(a: number, b: number, theta: number, R: number): Pt[] {
  const n = Math.max(1, Math.ceil(b - a - 1e-9));
  const pts: Pt[] = [[0, 0]];
  for (let i = 0; i <= n; i++) pts.push(cloudPoint(a + ((b - a) * i) / n, theta, R));
  return pts;
}

/** Shoelace area of a polygon. */
export function polygonArea(pts: readonly Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

export interface BellSample {
  y: number;
  /** Density relative to the peak, 0..1. */
  h: number;
}

/** The bell of y on the slice through x, from −4.5σ to +4.5σ, with a sample exactly at y = 0. */
export function bell(x: number, theta: number, n = 120): BellSample[] {
  const { mean, sd } = condY(x, theta);
  const lo = mean - 4.5 * sd;
  const hi = mean + 4.5 * sd;
  const ys: number[] = [];
  for (let i = 0; i <= n; i++) ys.push(lo + ((hi - lo) * i) / n);
  if (lo < 0 && hi > 0) {
    ys.push(0);
    ys.sort((a, b) => a - b);
  }
  return ys.map((y) => ({ y, h: Math.exp(-0.5 * ((y - mean) / sd) ** 2) }));
}

/** The share of the drawn bell's area (trapezoids) that is on the winning side. */
export function bellShare(target: Target, x: number, samples: readonly BellSample[]): number {
  const s = needSign(target, x);
  let total = 0;
  let green = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    const area = ((a.h + b.h) / 2) * (b.y - a.y);
    total += area;
    if (s !== 0 && s * (a.y + b.y) > 0) green += area;
  }
  return green / total;
}
