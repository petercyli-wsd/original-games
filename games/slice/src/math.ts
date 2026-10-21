// Slice: a dot is hidden uniformly at random in the unit square. The player's
// circle (kept wholly inside the square) covers P0 = πr² of it, so the prize
// for "the dot is in the circle" is M = RTP / P0.
//
// Each cut is a random line through the current region (a convex polygon);
// the half without the dot is thrown away. Cut lines never look at the dot,
// so given the cuts so far the dot is still uniform over what is left, and the
// win chance is P_t = area(circle ∩ region) / area(region). That is a
// martingale: E[P_{t+1} | region] = Σ (A_h / A)(C_h / A_h) = C / A = P_t.
// So cashing out at M × P_t is worth exactly RTP from every checkpoint, and no
// stopping strategy beats any other.

import type { Rng, Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

export interface Pt {
  x: number;
  y: number;
}
/** Convex polygon, vertices in order. */
export type Poly = Pt[];
export interface Circle {
  cx: number;
  cy: number;
  r: number;
}
/** The line through `p` with unit normal `n`. */
export interface Cut {
  p: Pt;
  n: Pt;
}

export type Mode = Volatility;

/** Circle sizes, given by their prize: the radius follows from πr² = RTP / M. */
export const MODES: Record<Mode, { mult: number }> = {
  low: { mult: 2 },
  medium: { mult: 5 },
  high: { mult: 10 },
  extreme: { mult: 25 },
};
export const MODE_NAMES = Object.keys(MODES) as Mode[];

export const radiusFor = (mode: Mode) => Math.sqrt(RTP / MODES[mode].mult / Math.PI);
export const maxMultiplier = (mode: Mode) => MODES[mode].mult;

/** How many cuts before the dot is revealed: the pace of a round. */
export const CUT_OPTIONS = [4, 6, 8] as const;
export const DEFAULT_CUTS = 6;

export const UNIT_SQUARE: Poly = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

/** Regions smaller than this are revealed at once (never reached in practice). */
const MIN_AREA = 1e-9;
/** Cut anchors are pulled this far toward the centroid so cuts rarely shave slivers. */
const ANCHOR_PULL = 0.5;

const cross = (a: Pt, b: Pt) => a.x * b.y - a.y * b.x;
const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Keeps the circle wholly inside the square, so P0 never depends on where it sits. */
export function clampCentre(p: Pt, r: number): Pt {
  const c = (v: number) => Math.min(1 - r, Math.max(r, v));
  return { x: c(p.x), y: c(p.y) };
}

// ---------------------------------------------------------------- geometry

export function polygonArea(poly: Poly): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) s += cross(poly[i], poly[(i + 1) % poly.length]);
  return Math.abs(s) / 2;
}

export function centroid(poly: Poly): Pt {
  let a = 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const c = cross(p, q);
    a += c;
    x += (p.x + q.x) * c;
    y += (p.y + q.y) * c;
  }
  return { x: x / (3 * a), y: y / (3 * a) };
}

/** Clips a convex polygon to the half-plane side × (n · (x − p)) ≥ 0 (Sutherland–Hodgman, one edge). */
export function clipHalfPlane(poly: Poly, { p, n }: Cut, side: 1 | -1 = 1): Poly {
  const d = (v: Pt) => side * dot(n, sub(v, p));
  const out: Poly = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const da = d(a);
    const db = d(b);
    if (da >= 0) out.push(a);
    if ((da > 0 && db < 0) || (da < 0 && db > 0)) out.push(lerp(a, b, da / (da - db)));
  }
  return out;
}

// Signed area of (disk of radius r at the origin) ∩ triangle(origin, a, b).
// Split ab where it crosses the circle; each piece is either inside (a plain
// triangle) or outside (a circular sector spanning the same angle).
function diskTriangleArea(a: Pt, b: Pt, r: number): number {
  const d = sub(b, a);
  const A = dot(d, d);
  const B = 2 * dot(a, d);
  const C = dot(a, a) - r * r;
  const ts = [0];
  const disc = B * B - 4 * A * C;
  if (A > 0 && disc > 0) {
    const s = Math.sqrt(disc);
    for (const t of [(-B - s) / (2 * A), (-B + s) / (2 * A)]) if (t > 0 && t < 1) ts.push(t);
  }
  ts.push(1);
  let area = 0;
  for (let i = 0; i + 1 < ts.length; i++) {
    const p = lerp(a, b, ts[i]);
    const q = lerp(a, b, ts[i + 1]);
    const m = lerp(a, b, (ts[i] + ts[i + 1]) / 2);
    area += dot(m, m) <= r * r ? cross(p, q) / 2 : (r * r * Math.atan2(cross(p, q), dot(p, q))) / 2;
  }
  return area;
}

/** Exact area of circle ∩ polygon: the per-edge triangle/sector pieces sum to it. */
export function circlePolygonArea({ cx, cy, r }: Circle, poly: Poly): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += diskTriangleArea({ x: a.x - cx, y: a.y - cy }, { x: b.x - cx, y: b.y - cy }, r);
  }
  return Math.abs(s);
}

export const inCircle = ({ cx, cy, r }: Circle, p: Pt) => (p.x - cx) ** 2 + (p.y - cy) ** 2 <= r * r;

function inConvex(poly: Poly, p: Pt): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const c = cross(sub(poly[(i + 1) % poly.length], poly[i]), sub(p, poly[i]));
    if (c !== 0) {
      if (sign && Math.sign(c) !== sign) return false;
      sign = Math.sign(c);
    }
  }
  return true;
}

function segmentDistSq(p: Pt, a: Pt, b: Pt): number {
  const d = sub(b, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), d) / (dot(d, d) || 1)));
  const q = lerp(a, b, t);
  return (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
}

/** The disk is convex, so the polygon is inside it iff every vertex is. */
export const regionInside = (c: Circle, poly: Poly) => poly.every((v) => inCircle(c, v));

/** No overlap iff the centre is outside the polygon and no edge comes within r. */
export function regionOutside(c: Circle, poly: Poly): boolean {
  const o = { x: c.cx, y: c.cy };
  if (inConvex(poly, o)) return false;
  return poly.every((a, i) => segmentDistSq(o, a, poly[(i + 1) % poly.length]) >= c.r * c.r);
}

/** Uniform point in a convex polygon: pick a fan triangle by area, then a point in it. */
export function randomPointIn(poly: Poly, rng: Rng): Pt {
  const areas = poly.slice(2).map((_, i) => polygonArea([poly[0], poly[i + 1], poly[i + 2]]));
  let u = rng.next() * areas.reduce((s, a) => s + a, 0);
  let k = 0;
  while (k < areas.length - 1 && u >= areas[k]) u -= areas[k++];
  const s = Math.sqrt(rng.next());
  const t = rng.next();
  const [a, b, c] = [poly[0], poly[k + 1], poly[k + 2]];
  return {
    x: (1 - s) * a.x + s * (1 - t) * b.x + s * t * c.x,
    y: (1 - s) * a.y + s * (1 - t) * b.y + s * t * c.y,
  };
}

/**
 * A random cut of the region: a uniform-angle line through a random interior
 * point (pulled toward the centroid, so both halves are always substantial).
 * It depends only on the region, never on the hidden dot.
 */
export function sampleCut(region: Poly, rng: Rng): Cut {
  const u = randomPointIn(region, rng);
  const c = centroid(region);
  const theta = rng.next() * Math.PI;
  return { p: lerp(c, u, ANCHOR_PULL), n: { x: Math.cos(theta), y: Math.sin(theta) } };
}

/** The part of the cut line that crosses the region, for drawing the blade. */
export function chord(poly: Poly, { p, n }: Cut): [Pt, Pt] {
  const dir = { x: -n.y, y: n.x };
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const da = dot(n, sub(a, p));
    const db = dot(n, sub(b, p));
    if ((da >= 0 && db <= 0) || (da <= 0 && db >= 0)) {
      const x = da === db ? a : lerp(a, b, da / (da - db));
      const t = dot(dir, sub(x, p));
      lo = Math.min(lo, t);
      hi = Math.max(hi, t);
    }
  }
  if (!Number.isFinite(lo)) lo = hi = 0;
  return [
    { x: p.x + dir.x * lo, y: p.y + dir.y * lo },
    { x: p.x + dir.x * hi, y: p.y + dir.y * hi },
  ];
}

// ------------------------------------------------------------------ rounds

/**
 * live: still in play. covered: what's left is all inside the circle (win).
 * missed: what's left is all outside (loss). hit / miss: the final reveal.
 */
export type Outcome = 'live' | 'covered' | 'missed' | 'hit' | 'miss';

export interface Slice {
  cut: Cut;
  /** The discarded half. */
  lost: Poly;
  /** Unit vector pointing away from the kept half, for the fall-away animation. */
  away: Pt;
  /** Win chance after this cut. */
  chance: number;
}

export interface Round {
  circle: Circle;
  /** Prize if the dot is in the circle. */
  mult: number;
  maxCuts: number;
  /** The hidden dot. The UI must not show it until the round is over. */
  dot: Pt;
  region: Poly;
  slices: Slice[];
  /** P_t: the share of the region the circle covers. */
  chance: number;
  outcome: Outcome;
}

export function winChance(circle: Circle, region: Poly): number {
  if (regionInside(circle, region)) return 1;
  if (regionOutside(circle, region)) return 0;
  return Math.min(1, Math.max(0, circlePolygonArea(circle, region) / polygonArea(region)));
}

export function newRound(mode: Mode, centre: Pt, maxCuts: number, hidden: Pt): Round {
  const r = radiusFor(mode);
  const { x, y } = clampCentre(centre, r);
  const circle = { cx: x, cy: y, r };
  return { circle, mult: MODES[mode].mult, maxCuts, dot: hidden, region: UNIT_SQUARE, slices: [], chance: winChance(circle, UNIT_SQUARE), outcome: 'live' };
}

/** Applies a cut: keeps the half with the dot and checks whether the round has ended. */
export function cutRound(round: Round, cut: Cut): Round {
  const side = dot(cut.n, sub(round.dot, cut.p)) >= 0 ? 1 : -1;
  const region = clipHalfPlane(round.region, cut, side);
  const lost = clipHalfPlane(round.region, cut, side === 1 ? -1 : 1);
  const { circle } = round;
  let outcome: Outcome = 'live';
  let chance: number;
  if (regionInside(circle, region)) {
    outcome = 'covered';
    chance = 1;
  } else if (regionOutside(circle, region)) {
    outcome = 'missed';
    chance = 0;
  } else {
    chance = winChance(circle, region);
  }
  const slices = [...round.slices, { cut, lost, away: { x: -side * cut.n.x, y: -side * cut.n.y }, chance }];
  if (outcome === 'live' && (slices.length >= round.maxCuts || polygonArea(region) < MIN_AREA)) {
    outcome = inCircle(circle, round.dot) ? 'hit' : 'miss';
  }
  return { ...round, region, slices, chance, outcome };
}

/** Cash-out multiplier now: M × P_t while live, the result once it's over. */
export function cashMultiplier(round: Round): number {
  switch (round.outcome) {
    case 'live':
      return round.mult * round.chance;
    case 'covered':
    case 'hit':
      return round.mult;
    case 'missed':
    case 'miss':
      return 0;
  }
}

export const isWin = (o: Outcome) => o === 'covered' || o === 'hit';
