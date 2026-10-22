// Thales: three points land uniformly in an arena (a square, a disc or an
// equilateral triangle). The player backs Acute (every angle of triangle ABC
// under 90°) or Obtuse (one angle over 90°).
//
//   square:    P(obtuse) = 97/150 + π/40         (P(acute) ≈ 27.48%)
//   disc:      P(acute)  = 4/π² − 1/8            (≈ 28.03%)
//   triangle:  P(acute)  ≈ 25.18%, by piecewise Gauss quadrature (below)
//
// Stage 1 lands A and B. Write u for the unit vector from A to B. The angle at
// A is acute iff (C − A)·u > 0, the angle at B iff (C − B)·u < 0, and the
// angle at C iff (A − C)·(B − C) > 0, i.e. iff C lies outside the circle with
// diameter AB (Thales' theorem: on that circle the angle is exactly 90°). So
// the triangle is acute iff C lies strictly inside the band between the
// perpendiculars to AB through A and B, and outside the Thales disc. That disc
// touches both perpendiculars at A and B, so it sits inside the band, and
//
//   P(acute | A, B) = [ area(band ∩ arena) − area(disc ∩ arena) ] / area(arena).
//
// Both areas are exact: the band clipped to a polygon is a polygon
// (shoelace), a disc clipped to a polygon is a sum of triangles and circular
// sectors, and for the disc arena the band is two circular caps and the disc
// a two-circle lens. Stage 2 lands C. The shaded band-minus-disc on the board
// is literally that area.
//
// Pricing (fixed prize). With p = P(side) for one triangle and n triangles in
// the series (1–3, independent; all must be on the backed side), a full win
// pays RTP / pⁿ, and in any state the cash-out is prize × P(win | state):
//
//   k triangles done, next A, B not landed:   P = p^(n−k)
//   k triangles done, next A, B landed:       P = r(A, B) · p^(n−k−1)
//
// with r(A, B) the exact share above (or 1 − it for Obtuse). E[r(A, B)] = p
// over uniform A, B, and P(side | A, B) = r(A, B) for a uniform C, so the
// cash-out is a martingale starting at prize × pⁿ = RTP. By optional stopping
// every cash-out rule returns exactly RTP, and every setting is priced to RTP.
// Cash-outs never exceed the prize, so maxMultiplier is the largest prize over
// the offered settings; no cap is needed.
//
// The triangle arena has no closed form we rely on. Its constant comes from
// obtuseChanceByQuadrature, which is exact up to Gauss–Legendre error in one
// smooth angular variable: the tests run the same routine on the square and
// check it against 97/150 + π/40 to 1e-12, and check the stored triangle
// constant against a fresh run to 1e-12.
//
// Ties: a right angle counts as not acute (C on the circle or on a
// perpendicular). Those are measure-zero events and change no probability.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

export type Arena = 'square' | 'disc' | 'triangle';
export type Side = 'acute' | 'obtuse';
export const ARENAS: readonly Arena[] = ['square', 'disc', 'triangle'];
export const SIDES: readonly Side[] = ['acute', 'obtuse'];
export const SERIES = [1, 2, 3] as const;
export type Series = (typeof SERIES)[number];

export interface Settings {
  arena: Arena;
  side: Side;
  series: Series;
}
export type Drop = Pick<Settings, 'arena' | 'side'>;

export const VOLATILITY: Record<Volatility, Settings> = {
  low: { arena: 'square', side: 'obtuse', series: 1 },
  medium: { arena: 'disc', side: 'acute', series: 1 },
  high: { arena: 'triangle', side: 'acute', series: 2 },
  extreme: { arena: 'square', side: 'acute', series: 3 },
};

export interface Pt {
  x: number;
  y: number;
}

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
const cross = (a: Pt, b: Pt) => a.x * b.y - a.y * b.x;

// ---------- Arenas (board coordinates, y down; all fit in [−1, 1]²) ----------

const H3 = Math.sqrt(3) / 2;
export const SQUARE: readonly Pt[] = [
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
];
/** Equilateral triangle with side 2, point up. */
export const TRIANGLE: readonly Pt[] = [
  { x: 0, y: -H3 },
  { x: 1, y: H3 },
  { x: -1, y: H3 },
];

export function polygonOf(arena: Arena): readonly Pt[] | null {
  return arena === 'square' ? SQUARE : arena === 'triangle' ? TRIANGLE : null;
}

export function polyArea(poly: readonly Pt[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) s += cross(poly[i], poly[(i + 1) % poly.length]);
  return Math.abs(s) / 2;
}

export const arenaArea = (arena: Arena) => (arena === 'disc' ? Math.PI : polyArea(polygonOf(arena)!));

/** Whether p lies in the (closed) arena. */
export function inArena(arena: Arena, p: Pt): boolean {
  if (arena === 'disc') return p.x * p.x + p.y * p.y <= 1;
  const poly = polygonOf(arena)!;
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const c = cross(sub(poly[(i + 1) % poly.length], poly[i]), sub(p, poly[i]));
    if (c !== 0) {
      if (sign !== 0 && Math.sign(c) !== sign) return false;
      sign = Math.sign(c);
    }
  }
  return true;
}

/** A uniform point in the arena from two uniforms in [0, 1). */
export function samplePoint(arena: Arena, u: number, v: number): Pt {
  if (arena === 'square') return { x: 2 * u - 1, y: 2 * v - 1 };
  if (arena === 'disc') {
    const r = Math.sqrt(u);
    const a = 2 * Math.PI * v;
    return { x: r * Math.cos(a), y: r * Math.sin(a) };
  }
  if (u + v > 1) [u, v] = [1 - u, 1 - v];
  const [p, q, s] = TRIANGLE;
  return { x: p.x + u * (q.x - p.x) + v * (s.x - p.x), y: p.y + u * (q.y - p.y) + v * (s.y - p.y) };
}

// ---------- The raw process ----------

/** Strictly acute: every angle under 90° (a right angle is not acute). */
export function isAcute(a: Pt, b: Pt, c: Pt): boolean {
  return dot(sub(b, a), sub(c, a)) > 0 && dot(sub(a, b), sub(c, b)) > 0 && dot(sub(a, c), sub(b, c)) > 0;
}

/** Which vertex (0 = A, 1 = B, 2 = C) carries the angle of 90° or more, if any. */
export function wideVertex(a: Pt, b: Pt, c: Pt): 0 | 1 | 2 | null {
  if (dot(sub(b, a), sub(c, a)) <= 0) return 0;
  if (dot(sub(a, b), sub(c, b)) <= 0) return 1;
  if (dot(sub(a, c), sub(b, c)) <= 0) return 2;
  return null;
}

export const onSide = (side: Side, a: Pt, b: Pt, c: Pt) => isAcute(a, b, c) === (side === 'acute');

/** The three angles in degrees, at A, B and C. */
export function angles(a: Pt, b: Pt, c: Pt): [number, number, number] {
  const ang = (p: Pt, q: Pt, r: Pt) => {
    const u = sub(q, p);
    const v = sub(r, p);
    return (Math.atan2(Math.abs(cross(u, v)), dot(u, v)) * 180) / Math.PI;
  };
  return [ang(a, b, c), ang(b, a, c), ang(c, a, b)];
}

// ---------- Exact areas ----------

/** Keeps the part of a convex polygon where x·n ≥ c (Sutherland–Hodgman). */
export function clipHalfPlane(poly: readonly Pt[], n: Pt, c: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const dp = dot(p, n) - c;
    const dq = dot(q, n) - c;
    if (dp >= 0) out.push(p);
    if ((dp >= 0) !== (dq >= 0)) {
      const t = dp / (dp - dq);
      out.push({ x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) });
    }
  }
  return out;
}

/** Signed area of circle(0, r) ∩ triangle(0, a, b). */
function circleTriArea(a: Pt, b: Pt, r: number): number {
  const d = sub(b, a);
  const qa = dot(d, d);
  const pts: Pt[] = [a];
  if (qa > 0) {
    const qb = 2 * dot(a, d);
    const qc = dot(a, a) - r * r;
    const disc = qb * qb - 4 * qa * qc;
    if (disc > 0) {
      const sq = Math.sqrt(disc);
      for (const t of [(-qb - sq) / (2 * qa), (-qb + sq) / (2 * qa)]) {
        if (t > 0 && t < 1) pts.push({ x: a.x + t * d.x, y: a.y + t * d.y });
      }
    }
  }
  pts.push(b);
  let area = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i];
    const q = pts[i + 1];
    const mx = (p.x + q.x) / 2;
    const my = (p.y + q.y) / 2;
    if (mx * mx + my * my < r * r) area += cross(p, q) / 2;
    else area += (r * r * Math.atan2(cross(p, q), dot(p, q))) / 2;
  }
  return area;
}

/** Area of the disc (centre c, radius r) inside a convex polygon. */
export function circlePolyArea(c: Pt, r: number, poly: readonly Pt[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) s += circleTriArea(sub(poly[i], c), sub(poly[(i + 1) % poly.length], c), r);
  return Math.abs(s);
}

/** Area of the unit disc on the side x·u ≥ s (u a unit vector). */
function unitCap(s: number): number {
  const t = Math.min(1, Math.max(-1, s));
  return Math.acos(t) - t * Math.sqrt(1 - t * t);
}

/** Area of the unit disc ∩ the disc (centre c, radius r). */
function unitLens(c: Pt, r: number): number {
  const d = Math.hypot(c.x, c.y);
  if (d + r <= 1) return Math.PI * r * r;
  if (d + 1 <= r) return Math.PI;
  if (d >= 1 + r) return 0;
  const a1 = Math.acos(Math.min(1, Math.max(-1, (d * d + r * r - 1) / (2 * d * r))));
  const a2 = Math.acos(Math.min(1, Math.max(-1, (d * d + 1 - r * r) / (2 * d))));
  const k = Math.sqrt(Math.max(0, (-d + r + 1) * (d + r - 1) * (d - r + 1) * (d + r + 1)));
  return r * r * a1 + a2 - k / 2;
}

/** The winning geometry once A and B are down. */
export interface Zone {
  /** Unit vector from A to B, and its normal. */
  u: Pt;
  n: Pt;
  /** Thales disc: centre (midpoint of AB) and radius |AB|/2. */
  mid: Pt;
  r: number;
}

export function zoneOf(a: Pt, b: Pt): Zone | null {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(len > 1e-12)) return null;
  const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  return { u, n: { x: -u.y, y: u.x }, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, r: len / 2 };
}

/** Area of the band between the perpendiculars to AB at A and B, inside the arena. */
export function bandArea(arena: Arena, a: Pt, b: Pt): number {
  const z = zoneOf(a, b);
  if (!z) return 0;
  const sA = dot(a, z.u);
  const sB = dot(b, z.u);
  if (arena === 'disc') return unitCap(sA) - unitCap(sB);
  const poly = polygonOf(arena)!;
  const clipped = clipHalfPlane(clipHalfPlane(poly, z.u, sA), { x: -z.u.x, y: -z.u.y }, -sB);
  return clipped.length < 3 ? 0 : polyArea(clipped);
}

/** Area of the Thales disc (diameter AB) inside the arena. */
export function thalesArea(arena: Arena, a: Pt, b: Pt): number {
  const z = zoneOf(a, b);
  if (!z) return 0;
  if (arena === 'disc') return unitLens(z.mid, z.r);
  return circlePolyArea(z.mid, z.r, polygonOf(arena)!);
}

/** Exact chance that C makes ABC acute, given A and B: the shaded share of the arena. */
export function acuteShare(arena: Arena, a: Pt, b: Pt): number {
  const v = (bandArea(arena, a, b) - thalesArea(arena, a, b)) / arenaArea(arena);
  return Math.min(1, Math.max(0, v));
}

/** Exact chance that C lands on the backed side, given A and B. */
export function sideShare(s: Drop, a: Pt, b: Pt): number {
  const q = acuteShare(s.arena, a, b);
  return s.side === 'acute' ? q : 1 - q;
}

// ---------- Headline chances ----------

/** P(acute) for the triangle arena, from obtuseChanceByQuadrature(TRIANGLE) (checked by the tests). */
export const TRIANGLE_ACUTE = 0.25180277665798;

/** P(three uniform points make an acute triangle). */
export function acuteChance(arena: Arena): number {
  if (arena === 'square') return 53 / 150 - Math.PI / 40;
  if (arena === 'disc') return 4 / (Math.PI * Math.PI) - 1 / 8;
  return TRIANGLE_ACUTE;
}

export const sideChance = (s: Drop) => (s.side === 'acute' ? acuteChance(s.arena) : 1 - acuteChance(s.arena));
export const winChance = (s: Settings) => sideChance(s) ** s.series;
export const prizeOf = (s: Settings) => RTP / winChance(s);

/** A round's position: triangles settled on your side, and the current A, B if landed. */
export interface RoundState {
  settled: number;
  ab: [Pt, Pt] | null;
}

/** Exact P(win | state). */
export function stateWinChance(s: Settings, st: RoundState): number {
  const p = sideChance(s);
  if (st.ab) return sideShare(s, st.ab[0], st.ab[1]) * p ** (s.series - st.settled - 1);
  return p ** (s.series - st.settled);
}

/** Fair cash-out: prize × P(win | state). Starts at RTP. */
export const cashOutValue = (s: Settings, st: RoundState) => prizeOf(s) * stateWinChance(s, st);

export function volatilityOf(s: Settings): Volatility {
  const p = winChance(s);
  return p > 0.5 ? 'low' : p > 0.15 ? 'medium' : p > 0.03 ? 'high' : 'extreme';
}

export function formulaText(arena: Arena): string {
  if (arena === 'square') return '53/150 − π/40';
  if (arena === 'disc') return '4/π² − 1/8';
  return '≈ 0.2518';
}

/** The headline chance for one triangle on the backed side, as text. */
export function sideFormulaText(s: Drop): string {
  if (s.arena === 'triangle') return s.side === 'acute' ? '≈ 0.2518' : '≈ 0.7482';
  if (s.side === 'acute') return formulaText(s.arena);
  return s.arena === 'square' ? '97/150 + π/40' : '9/8 − 4/π²';
}

export const MAX_MULTIPLIER = Math.max(
  ...ARENAS.flatMap((arena) => SIDES.flatMap((side) => SERIES.map((series) => prizeOf({ arena, side, series })))),
);

// ---------- Quadrature for a polygon arena's headline chance ----------

const glCache = new Map<number, { x: number[]; w: number[] }>();

/** Gauss–Legendre nodes and weights on [−1, 1]. */
export function gaussLegendre(n: number) {
  const hit = glCache.get(n);
  if (hit) return hit;
  const x: number[] = [];
  const w: number[] = [];
  for (let i = 0; i < n; i++) {
    let z = Math.cos((Math.PI * (i + 0.75)) / (n + 0.5));
    let dp = 0;
    for (let it = 0; it < 100; it++) {
      let p0 = 1;
      let p1 = z;
      for (let k = 2; k <= n; k++) [p0, p1] = [p1, ((2 * k - 1) * z * p1 - (k - 1) * p0) / k];
      dp = (n * (z * p1 - p0)) / (z * z - 1);
      const dz = p1 / dp;
      z -= dz;
      if (Math.abs(dz) < 1e-16) break;
    }
    x.push(z);
    w.push(2 / ((1 - z * z) * dp * dp));
  }
  const r = { x, w };
  glCache.set(n, r);
  return r;
}

function integrate(f: (x: number) => number, a: number, b: number, n: number): number {
  const { x, w } = gaussLegendre(n);
  const h = (b - a) / 2;
  const m = (a + b) / 2;
  let s = 0;
  for (let i = 0; i < n; i++) s += w[i] * f(m + h * x[i]);
  return s * h;
}

/** Breakpoints in [lo, hi], sorted and de-duplicated, with the ends. */
function pieces(points: number[], lo: number, hi: number): number[] {
  const all = [lo, hi, ...points.filter((p) => p > lo && p < hi)].sort((x, y) => x - y);
  return all.filter((p, i) => i === 0 || p - all[i - 1] > 1e-13);
}

/** The extent of a convex polygon along e1 on the line x·e2 = t, or null. */
function chord(poly: readonly Pt[], e1: Pt, e2: Pt, t: number): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const tp = dot(p, e2);
    const tq = dot(q, e2);
    if ((tp - t) * (tq - t) > 0 || tp === tq) continue;
    const k = (t - tp) / (tq - tp);
    const s = dot(p, e1) + k * (dot(q, e1) - dot(p, e1));
    lo = Math.min(lo, s);
    hi = Math.max(hi, s);
  }
  return lo <= hi ? [lo, hi] : null;
}

/**
 * P(obtuse) for three uniform points in a convex polygon K. Exactly one angle
 * can be obtuse and the labels are exchangeable, so P = 3·P(angle at A ≥ 90°).
 * In polar coordinates round A (direction θ, unit vector u),
 *
 *   P(angle A obtuse) = |K|⁻³ ∫θ ∫A H(A·u) · R(A, θ)² / 2 dA dθ,
 *
 * where H(s) = area of K below s along u (C must land behind A) and R is the
 * distance from A to the edge of K along u (B anywhere on that ray). In the
 * rotated frame (s along u, t across) H is piecewise quadratic in s and R is
 * piecewise linear in t, so Gauss rules on the pieces integrate A exactly; θ
 * is smooth between the angles where two vertices line up along u or across
 * it, and gets a high-order Gauss rule on each piece.
 */
export function obtuseChanceByQuadrature(poly: readonly Pt[], thetaNodes = 24): number {
  const breaks: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    for (let j = i + 1; j < poly.length; j++) {
      const phi = Math.atan2(poly[j].y - poly[i].y, poly[j].x - poly[i].x);
      for (let k = 0; k < 4; k++) breaks.push((((phi + (k * Math.PI) / 2) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI));
    }
  }
  const tb = pieces(breaks, 0, 2 * Math.PI);

  const inner = (theta: number) => {
    const u = { x: Math.cos(theta), y: Math.sin(theta) };
    const w = { x: -u.y, y: u.x };
    const sv = poly.map((p) => dot(p, u));
    const tv = poly.map((p) => dot(p, w));
    const below = (s: number) => {
      const c = clipHalfPlane(poly, { x: -u.x, y: -u.y }, -s);
      return c.length < 3 ? 0 : polyArea(c);
    };
    const tBreaks = [...tv];
    for (const sj of sv) {
      const c = chord(poly, w, u, sj);
      if (c) tBreaks.push(c[0], c[1]);
    }
    const ts = pieces(tBreaks, Math.min(...tv), Math.max(...tv));
    let total = 0;
    for (let i = 0; i + 1 < ts.length; i++) {
      total += integrate(
        (t) => {
          const c = chord(poly, u, w, t);
          if (!c) return 0;
          const [lo, hi] = c;
          const ss = pieces(sv, lo, hi);
          let g = 0;
          for (let j = 0; j + 1 < ss.length; j++) g += integrate((s) => (below(s) * (hi - s) * (hi - s)) / 2, ss[j], ss[j + 1], 4);
          return g;
        },
        ts[i],
        ts[i + 1],
        4,
      );
    }
    return total;
  };

  let total = 0;
  for (let i = 0; i + 1 < tb.length; i++) total += integrate(inner, tb[i], tb[i + 1], thetaNodes);
  return (3 * total) / polyArea(poly) ** 3;
}

/** The band drawn on the board: a long strip across AB (clipped to the arena when drawn). */
export function bandPolygon(a: Pt, b: Pt, reach = 4): Pt[] {
  const z = zoneOf(a, b);
  if (!z) return [];
  const o = { x: z.n.x * reach, y: z.n.y * reach };
  return [
    { x: a.x + o.x, y: a.y + o.y },
    { x: b.x + o.x, y: b.y + o.y },
    { x: b.x - o.x, y: b.y - o.y },
    { x: a.x - o.x, y: a.y - o.y },
  ];
}
