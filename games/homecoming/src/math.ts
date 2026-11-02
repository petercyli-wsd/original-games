// Homecoming: a simple random walk on the lattice Z^d (d = 1, 2 or 3) starts
// at home, the origin. Each step moves one coordinate, chosen uniformly, by
// ±1, so every one of the 2d neighbours is equally likely. The walk has a
// fixed budget of T = 30 steps. You back one side:
//   Home: the walk comes back to the origin within T steps;
//   Away: it does not.
//
// Pólya's recurrence theorem: given unlimited time the walk is certain to
// come home in one and two dimensions, but in three it returns only with
// probability ≈ 0.3405. Within T steps the chance is smaller, and the
// dimension is the risk knob (Home: 86% in 1D, 51% in 2D, 29% in 3D).
// No single knob reaches a 25:1 chance span here (the budget barely moves
// the odds; dimension spans 3:1), so the side stays as a second control:
// with it the chance runs from 14% (1D Away) to 86% (1D Home). T = 30 keeps
// rounds short (one step per press) while the eval's std-dev spread stays
// above 5×.
//
// Only the distance from home on each axis matters (|x|, |y|, |z|), so the
// board folds each axis into a one-sided track. A step moves one axis one
// notch closer to home or one notch further; an axis already at home can
// only move further (both of its moves do).
//
// Exact odds. Let g(x, t) be the chance that a walk at x (not yet counted as
// home) hits the origin within t more steps. Then g(x, 0) = 0 and
//
//   g(x, t) = (1/2d) Σ over neighbours y of [ y = 0 ? 1 : g(y, t − 1) ],
//
// and g(x, t) = 0 when the walk is more steps from home than it has left
// (|x|₁ > t: "out of reach"). The chance only depends on x up to sign flips
// and swapping coordinates, so states are reduced to sorted absolute values.
// Everything is a finite sum of dyadic fractions computed by DP: no
// simulation.
//
// Pricing (fixed prize): the prize is RTP / P(side at the start) and the
// cash-out at any moment is prize × P(side | now). By the recursion above the
// cash-out is a martingale, so every stopping rule returns exactly RTP. The
// side is chosen before the bet and each side is priced at its own odds, so
// the choice changes volatility only. Payouts are bounded by the largest
// prize, so no max-win cap is needed.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

/** The step budget T: the walk has this many steps to come home. */
export const BUDGET = 30;

export const DIMS = [1, 2, 3] as const;
export type Dim = (typeof DIMS)[number];

export const SIDES = ['home', 'away'] as const;
export type Side = (typeof SIDES)[number];

export interface Settings {
  dim: Dim;
  side: Side;
}

/** A lattice point; only the first `dim` coordinates are used. */
export type Pos = readonly number[];

export const origin = (dim: Dim): number[] => Array.from({ length: dim }, () => 0);
export const l1 = (p: Pos) => p.reduce((s, v) => s + Math.abs(v), 0);
export const isHome = (p: Pos) => p.every((v) => v === 0);

// --- exact hitting chances ---------------------------------------------------

const memo = new Map<number, number>();

/** Canonical key: dimension, steps left and sorted absolute coordinates. */
const keyOf = (dim: Dim, t: number, a: number, b: number, c: number) => ((dim * 64 + t) * 64 + a) * 64 * 64 + b * 64 + c;

function canon(p: Pos): [number, number, number] {
  const s = p.map(Math.abs).sort((x, y) => y - x);
  return [s[0] ?? 0, s[1] ?? 0, s[2] ?? 0];
}

/** The 2d neighbours of a canonical point (in any order, possibly repeated). */
function neighbours(dim: Dim, c: [number, number, number]): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < dim; i++) {
    for (const s of [1, -1]) {
      const q = c.slice(0, dim);
      q[i] += s;
      out.push(q);
    }
  }
  return out;
}

function g(dim: Dim, c: [number, number, number], t: number): number {
  if (t <= 0) return 0;
  if (c[0] + c[1] + c[2] > t) return 0;
  const key = keyOf(dim, t, c[0], c[1], c[2]);
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  let sum = 0;
  for (const y of neighbours(dim, c)) sum += isHome(y) ? 1 : g(dim, canon(y), t - 1);
  const v = sum / (2 * dim);
  memo.set(key, v);
  return v;
}

/**
 * Exact chance that a walk at p hits the origin within `left` more steps.
 * At the origin itself this is the first-return chance (the start of a round).
 */
export const homeChance = (dim: Dim, p: Pos, left: number) => g(dim, canon(p), left);

/** Chance that the backed side wins from here. */
export const sideChance = (side: Side, dim: Dim, p: Pos, left: number) => {
  const h = homeChance(dim, p, left);
  return side === 'home' ? h : 1 - h;
};

/** Chance the backed side wins, at the start of a round. */
export const startChance = ({ dim, side }: Settings) => sideChance(side, dim, origin(dim), BUDGET);

export const prizeFor = (s: Settings) => RTP / startChance(s);

// --- one step ------------------------------------------------------------------

/** The 2d moves: +x, −x, +y, −y, +z, −z. */
export interface Move {
  axis: number;
  sign: 1 | -1;
}
export const movesOf = (dim: Dim): Move[] => Array.from({ length: 2 * dim }, (_, i) => ({ axis: i >> 1, sign: i % 2 ? -1 : 1 }));

export function applyMove(p: Pos, m: Move): number[] {
  const q = [...p];
  q[m.axis] += m.sign;
  return q;
}

export const randomMove = (dim: Dim, u: number): Move => movesOf(dim)[Math.min(2 * dim - 1, Math.floor(u * 2 * dim))];

/** Whether a move takes its axis one notch closer to home (else further). */
export const isCloser = (p: Pos, m: Move) => p[m.axis] !== 0 && Math.sign(p[m.axis]) === -m.sign;

/**
 * The next step as the board draws it: the 2d equally likely moves, closer
 * ones first, each tagged with its axis. `index` maps a move to its slot.
 */
export interface Slot {
  axis: number;
  closer: boolean;
}
export function slotsOf(dim: Dim, p: Pos): Slot[] {
  const moves = movesOf(dim);
  const closer = moves.filter((m) => isCloser(p, m)).map((m) => ({ axis: m.axis, closer: true }));
  const further = moves.filter((m) => !isCloser(p, m)).map((m) => ({ axis: m.axis, closer: false }));
  return [...closer, ...further];
}
export function slotIndex(dim: Dim, p: Pos, m: Move): number {
  const moves = movesOf(dim);
  const closer = moves.filter((x) => isCloser(p, x));
  const further = moves.filter((x) => !isCloser(p, x));
  const ci = closer.findIndex((x) => x.axis === m.axis && x.sign === m.sign);
  return ci >= 0 ? ci : closer.length + further.findIndex((x) => x.axis === m.axis && x.sign === m.sign);
}

/** How many of the 2d moves take the walk closer to home. */
export const closerCount = (p: Pos) => p.filter((v) => v !== 0).length;

/**
 * The out-of-reach line on axis i: the walk can still get home in time while
 * |x_i| ≤ this value (the steps left minus the other axes' distances).
 */
export const reachOn = (p: Pos, i: number, left: number) => left - (l1(p) - Math.abs(p[i]));

export type Verdict = 'won' | 'lost' | null;

/**
 * Whether a state settles the round: reaching home settles both sides; so
 * does running out of steps, or being further from home than the steps left.
 */
export function verdict(side: Side, p: Pos, left: number): Verdict {
  if (isHome(p)) return side === 'home' ? 'won' : 'lost';
  if (l1(p) > left) return side === 'home' ? 'lost' : 'won';
  return null;
}

/** Cash-out value (× stake) at a state with `left` steps to go. */
export function cashAt(s: Settings, p: Pos, left: number): number {
  const prize = prizeFor(s);
  if (left === BUDGET && isHome(p)) return RTP; // the start, before any step
  const v = verdict(s.side, p, left);
  if (v === 'won') return prize;
  if (v === 'lost') return 0;
  return prize * sideChance(s.side, s.dim, p, left);
}

export interface Step {
  move: Move;
  /** Position after the step. */
  to: number[];
  verdict: Verdict;
  /** Cash-out after the step (prize or 0 when settled). */
  cash: number;
}

/** Takes one step from p (with `left` steps to go), drawn with u. */
export function walkStep(s: Settings, p: Pos, left: number, u: number): Step {
  const move = randomMove(s.dim, u);
  const to = applyMove(p, move);
  const v = verdict(s.side, to, left - 1);
  return { move, to, verdict: v, cash: v === 'won' ? prizeFor(s) : v === 'lost' ? 0 : cashAt(s, to, left - 1) };
}

// --- settings -----------------------------------------------------------------

export function volatilityOf(s: Settings): Volatility {
  const p = startChance(s);
  return p > 0.6 ? 'low' : p > 0.4 ? 'medium' : p > 0.22 ? 'high' : 'extreme';
}

export const VOLATILITY: Record<Volatility, Settings> = {
  low: { dim: 1, side: 'home' },
  medium: { dim: 2, side: 'home' },
  high: { dim: 3, side: 'home' },
  extreme: { dim: 1, side: 'away' },
};

/** Every payout is either a cash-out below the prize or the prize itself. */
export const MAX_MULTIPLIER = Math.max(...DIMS.flatMap((dim) => SIDES.map((side) => prizeFor({ dim, side }))));
