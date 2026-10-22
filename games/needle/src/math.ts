// Needle: Buffon's needle, played as a staged reveal.
//
// The floor is ruled with parallel lines 1 apart ("Lines"), or with a square
// grid of them ("Grid"). A needle of length ℓ ∈ [0.1, 1] is dropped: first its
// centre lands uniformly in a cell, then it settles at a uniform direction
// θ ∈ [0, π). The player backs Cross (the needle touches a line) or Miss (it
// touches none).
//
//   Buffon (lines):            P(cross) = 2ℓ/π
//   Buffon–Laplace (grid):     P(cross) = (4ℓ − ℓ²)/π
//
// Stage 1 reveals the centre. With h = ℓ/2 and d the distance from the centre
// to the nearest line, the needle reaches that line exactly when its extent
// across the lines, h·|sin| of its angle to them, is at least d: when its
// direction lies within α(d) = arccos(d/h) of the perpendicular (α = 0 when
// d ≥ h). Because ℓ ≤ 1 the far line is never in reach. So, given the centre,
//
//   lines:  r(c) = (2/π)·α(dy)
//   grid:   r(c) = min(1, (2/π)·(α(dx) + α(dy)))
//
// (on the grid the two bow-ties of crossing directions are centred 90° apart
// and only overlap once together they cover every direction). This fraction
// is drawn literally: a dial of all directions [0°, 180°) with the crossing
// ones shaded, and the same bow-tie on a circle of radius ℓ/2 round the
// centre. Averaging r over the cell gives Buffon's and Laplace's formulas back
// (the tests check this by quadrature to 1e-9, using r itself).
//
// Stage 2 spins the needle. With n needles (1–3, independent) the round is n
// such pairs of reveals, and every needle must land on the backed side.
//
// Pricing (fixed prize). With p = P(side) for one needle, a full win pays
// prize = RTP / pⁿ. In any state the cash-out is prize × P(win | state):
//
//   k needles done, next centre not landed:   P = p^(n−k)
//   k needles done, next centre at c:         P = r_side(c) · p^(n−k−1)
//
// E[r_side(c)] = p over a uniform centre, and P(side | c) = r_side(c) for a
// uniform spin, so P(win | state) is a martingale and so is the cash-out,
// starting at prize × pⁿ = RTP. By optional stopping every cash-out rule
// returns exactly RTP, and every choice of settings is priced to RTP too.
// Prizes are bounded by RTP/pⁿ, so no cap is needed: maxMultiplier is the
// largest prize over the offered settings.
//
// Ties: a needle that exactly touches a line counts as crossing. Touching is
// a measure-zero event, so it changes no probability.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

export type Floor = 'lines' | 'grid';
export type Side = 'cross' | 'miss';
export const FLOORS: readonly Floor[] = ['lines', 'grid'];
export const SIDES: readonly Side[] = ['cross', 'miss'];

/** Needle length as a fraction of the line spacing (slider). */
export const LENGTH_MIN = 0.1;
export const LENGTH_MAX = 1;
export const LENGTH_STEP = 0.05;
const round2 = (x: number) => Math.round(x * 100) / 100;
export const LENGTHS: readonly number[] = Array.from({ length: 19 }, (_, i) => round2(LENGTH_MIN + i * LENGTH_STEP));

/** Snaps a slider value to one of the offered lengths. */
export function snapLength(x: number): number {
  const i = Math.round((Math.min(LENGTH_MAX, Math.max(LENGTH_MIN, x)) - LENGTH_MIN) / LENGTH_STEP);
  return LENGTHS[Math.min(LENGTHS.length - 1, Math.max(0, i))];
}

/** Needles per round: every one must land on your side. */
export const NEEDLES = [1, 2, 3] as const;
export type NeedleCount = (typeof NEEDLES)[number];

export interface Settings {
  floor: Floor;
  side: Side;
  length: number;
  needles: NeedleCount;
}

/** One needle's settings (the needle count doesn't change a single drop). */
export type Drop = Pick<Settings, 'floor' | 'side' | 'length'>;

export const VOLATILITY: Record<Volatility, Settings> = {
  low: { floor: 'lines', side: 'cross', length: 1, needles: 1 },
  medium: { floor: 'lines', side: 'cross', length: 0.9, needles: 2 },
  high: { floor: 'lines', side: 'miss', length: 1, needles: 3 },
  extreme: { floor: 'grid', side: 'miss', length: 0.8, needles: 3 },
};

/** Buffon (lines) or Buffon–Laplace (grid): the chance one needle touches a line. */
export function crossChance(floor: Floor, length: number): number {
  return floor === 'lines' ? (2 * length) / Math.PI : (4 * length - length * length) / Math.PI;
}

/** The chance one needle lands on the backed side. */
export function sideChance(s: Drop): number {
  const c = crossChance(s.floor, s.length);
  return s.side === 'cross' ? c : 1 - c;
}

/** The chance the whole round is won: every needle on the backed side. */
export const winChance = (s: Settings) => sideChance(s) ** s.needles;

/** What a full win pays (as a multiple of the stake). */
export const prizeOf = (s: Settings) => RTP / winChance(s);

/** A needle centre, as its position inside its unit cell: [0, 1)², v measured down from the top line. */
export interface Centre {
  u: number;
  v: number;
}

/** Distances from the centre to the nearest vertical (dx) and horizontal (dy) line. */
export function lineDistances({ u, v }: Centre) {
  return { dx: Math.min(u, 1 - u), dy: Math.min(v, 1 - v) };
}

/** Half-width of the bow-tie of directions that reach a line at distance d, for a needle of half-length h. */
export const reachAngle = (d: number, h: number) => (d >= h ? 0 : Math.acos(d / h));

/** The two half-widths: αy for the horizontal lines (bow-tie round 90°), αx for vertical ones (round 0°). */
export function reachAngles(floor: Floor, length: number, c: Centre) {
  const h = length / 2;
  const { dx, dy } = lineDistances(c);
  return { ay: reachAngle(dy, h), ax: floor === 'grid' ? reachAngle(dx, h) : 0 };
}

/** Exact fraction of directions θ ∈ [0, π) for which the needle touches a line. */
export function crossFraction(floor: Floor, length: number, c: Centre): number {
  const { ax, ay } = reachAngles(floor, length, c);
  return Math.min(1, (2 / Math.PI) * (ax + ay));
}

/** Exact chance the needle lands on the backed side, given where its centre landed. */
export function sideFraction(s: Drop, c: Centre): number {
  const f = crossFraction(s.floor, s.length, c);
  return s.side === 'cross' ? f : 1 - f;
}

/**
 * The raw process: does the needle with centre c and direction θ (measured
 * from the lines, counter-clockwise) touch a line? Its ends sit at
 * c ± h·(cos θ, −sin θ); it touches a line when an integer lies within its
 * extent across that family of lines. Touching counts as crossing.
 */
export function crosses(floor: Floor, length: number, c: Centre, theta: number): boolean {
  const h = length / 2;
  const reach = (p: number, half: number) => Math.floor(p + Math.abs(half)) >= Math.ceil(p - Math.abs(half));
  return reach(c.v, h * Math.sin(theta)) || (floor === 'grid' && reach(c.u, h * Math.cos(theta)));
}

/** Whether a needle at direction θ lands on the backed side. */
export const onSide = (s: Drop, c: Centre, theta: number) => crosses(s.floor, s.length, c, theta) === (s.side === 'cross');

/** An arc of directions, in radians, start < end. */
export interface DirArc {
  start: number;
  end: number;
}

export const HALF_TURN = Math.PI;

function merge(parts: DirArc[]): DirArc[] {
  const sorted = parts.filter((p) => p.end > p.start).sort((x, y) => x.start - y.start);
  const out: DirArc[] = [];
  for (const p of sorted) {
    const last = out[out.length - 1];
    if (last && p.start <= last.end) last.end = Math.max(last.end, p.end);
    else out.push({ ...p });
  }
  return out;
}

/**
 * The needle directions θ ∈ [0, π) that touch a line: a band round 90° for
 * the horizontal lines and, on the grid, bands at both ends (round 0°/180°)
 * for the vertical ones. Their total length / π is crossFraction.
 */
export function crossingArcs(floor: Floor, length: number, c: Centre): DirArc[] {
  const { ax, ay } = reachAngles(floor, length, c);
  const parts: DirArc[] = [];
  if (ay > 0) parts.push({ start: Math.max(0, HALF_TURN / 2 - ay), end: Math.min(HALF_TURN, HALF_TURN / 2 + ay) });
  if (ax > 0) parts.push({ start: 0, end: Math.min(HALF_TURN, ax) }, { start: Math.max(0, HALF_TURN - ax), end: HALF_TURN });
  return merge(parts);
}

/** The rest of the half-turn. */
export function complementArcs(arcs: DirArc[]): DirArc[] {
  const out: DirArc[] = [];
  let at = 0;
  for (const a of arcs) {
    if (a.start > at) out.push({ start: at, end: a.start });
    at = Math.max(at, a.end);
  }
  if (at < HALF_TURN) out.push({ start: at, end: HALF_TURN });
  return out;
}

/** The directions in [0, π) that win for the backed side. */
export function winArcs(s: Drop, c: Centre): DirArc[] {
  const cross = crossingArcs(s.floor, s.length, c);
  return s.side === 'cross' ? cross : complementArcs(cross);
}

export const arcsLength = (arcs: DirArc[]) => arcs.reduce((t, a) => t + a.end - a.start, 0);

/** Whether direction θ ∈ [0, π) lies in one of the arcs. */
export const inArcs = (arcs: DirArc[], theta: number) => arcs.some((a) => theta >= a.start && theta <= a.end);

/**
 * Before a centre lands, the dial shows the crossing directions *on average*
 * over the cell: their mean measure is π·P(cross) (2ℓ for lines, 4ℓ − ℓ² for
 * the grid), split between the band round 90° and, on the grid, the two ends.
 * Its share of the half-turn is exactly the headline chance.
 */
export function averageCrossingArcs(floor: Floor, length: number): DirArc[] {
  const total = HALF_TURN * crossChance(floor, length);
  if (floor === 'lines') return [{ start: HALF_TURN / 2 - total / 2, end: HALF_TURN / 2 + total / 2 }];
  const mid = total / 2;
  return [
    { start: 0, end: mid / 2 },
    { start: HALF_TURN / 2 - mid / 2, end: HALF_TURN / 2 + mid / 2 },
    { start: HALF_TURN - mid / 2, end: HALF_TURN },
  ];
}

/** Where a round stands: needles already on your side, and the current needle's centre if it has landed. */
export interface RoundState {
  settled: number;
  landed: Centre | null;
}

/** Exact P(win | state). */
export function stateWinChance(s: Settings, st: RoundState): number {
  const p = sideChance(s);
  if (st.landed) return sideFraction(s, st.landed) * p ** (s.needles - st.settled - 1);
  return p ** (s.needles - st.settled);
}

/** The fair cash-out: prize × P(win | state). Starts at RTP. */
export const cashOutValue = (s: Settings, st: RoundState) => prizeOf(s) * stateWinChance(s, st);

/** Volatility label for a setting, by its headline win chance. */
export function volatilityOf(s: Settings): Volatility {
  const p = winChance(s);
  return p > 0.5 ? 'low' : p > 0.15 ? 'medium' : p > 0.02 ? 'high' : 'extreme';
}

/** The headline formula for one needle, as text. */
export function formulaText(floor: Floor, side: Side): string {
  const f = floor === 'lines' ? '2ℓ/π' : '(4ℓ − ℓ²)/π';
  return side === 'cross' ? f : `1 − ${f}`;
}

/** Largest prize over every offered setting. */
export const MAX_MULTIPLIER = Math.max(
  ...FLOORS.flatMap((floor) =>
    SIDES.flatMap((side) => LENGTHS.flatMap((length) => NEEDLES.map((needles) => prizeOf({ floor, side, length, needles })))),
  ),
);
