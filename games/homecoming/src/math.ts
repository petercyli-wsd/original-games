// Homecoming: a simple random walk on the lattice Z^d (d = 1, 2 or 3) starts
// at the origin. Each step moves one coordinate, chosen uniformly, by ±1, so
// every one of the 2d neighbours is equally likely. You back one side:
//   Home: the walk comes back to the origin within T steps;
//   Away: it does not.
//
// Pólya's recurrence theorem: given unlimited time the walk is certain to
// come home in one and two dimensions, but in three it returns only with
// probability ≈ 0.3405. Within a finite budget T the chance is smaller, and
// the dimension is the volatility knob.
//
// Exact odds. Let g(x, t) be the chance that a walk at x (not yet counted as
// home) hits the origin within t more steps. Then g(x, 0) = 0 and
//
//   g(x, t) = (1/2d) Σ over neighbours y of [ y = 0 ? 1 : g(y, t − 1) ],
//
// and g(x, t) = 0 when the walk is more steps from home than it has left
// (|x|₁ > t). The chance only depends on x up to sign flips and swapping
// coordinates, so states are reduced to sorted absolute values. Everything is
// a finite sum of dyadic fractions computed by DP: no simulation.
//
// Pricing (fixed prize): the prize is RTP / P(side at the start) and the
// cash-out at any moment is prize × P(side | now). By the recursion above the
// cash-out is a martingale, so every stopping rule returns exactly RTP. The
// side is chosen before the bet and each side is priced at its own odds, so
// the choice changes volatility only. Payouts are bounded by the largest
// prize, so no max-win cap is needed.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

export const DIMS = [1, 2, 3] as const;
export type Dim = (typeof DIMS)[number];

/** Step budgets T. */
export const BUDGETS = [10, 20, 40] as const;
export type Budget = (typeof BUDGETS)[number];

export const SIDES = ['home', 'away'] as const;
export type Side = (typeof SIDES)[number];

export interface Settings {
  dim: Dim;
  budget: Budget;
  side: Side;
}

/** A lattice point; only the first `dim` coordinates are used. */
export type Pos = readonly number[];

export const origin = (dim: Dim): number[] => Array.from({ length: dim }, () => 0);
export const l1 = (p: Pos) => p.reduce((s, v) => s + Math.abs(v), 0);
export const isHome = (p: Pos) => p.every((v) => v === 0);

/** Steps per press: ten checkpoints at most in a full round. */
export const burstOf = (budget: Budget) => budget / 10;

/**
 * Steps the next press takes. The first press is a single step: it can never
 * settle the round (home is two steps away) and leaves the value at RTP, so
 * every round reaches a checkpoint.
 */
export const pressSize = (budget: Budget, left: number) => Math.min(left, left === budget ? 1 : burstOf(budget));

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
export const startChance = ({ dim, budget, side }: Settings) => sideChance(side, dim, origin(dim), budget);

export const prizeFor = (s: Settings) => RTP / startChance(s);

// --- one move ------------------------------------------------------------------

/** The 2d moves, in display order: +x, −x, +y, −y, +z, −z. */
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
  const v = verdict(s.side, p, left);
  const prize = prizeFor(s);
  if (v === 'won') return prize;
  if (v === 'lost') return 0;
  return prize * sideChance(s.side, s.dim, p, left);
}

/** Chance of the backed side after each possible next move, in movesOf order. */
export const moveChances = (s: Settings, p: Pos, left: number) =>
  movesOf(s.dim).map((m) => {
    const q = applyMove(p, m);
    const v = verdict(s.side, q, left - 1);
    return v === 'won' ? 1 : v === 'lost' ? 0 : sideChance(s.side, s.dim, q, left - 1);
  });

export interface Burst {
  /** Positions after each step taken (stops early when the round settles). */
  path: number[][];
  verdict: Verdict;
  /** Cash-out after the burst (prize or 0 when settled). */
  cash: number;
}

/** Plays the next press (`pressSize` steps) from p, drawing each step with u(). */
export function walkBurst(s: Settings, p: Pos, left: number, u: () => number): Burst {
  const path: number[][] = [];
  let cur: Pos = p;
  let l = left;
  const n = pressSize(s.budget, left);
  for (let i = 0; i < n; i++) {
    cur = applyMove(cur, randomMove(s.dim, u()));
    l--;
    path.push([...cur]);
    const v = verdict(s.side, cur, l);
    if (v) return { path, verdict: v, cash: v === 'won' ? prizeFor(s) : 0 };
  }
  return { path, verdict: null, cash: cashAt(s, cur, l) };
}

// --- settings -----------------------------------------------------------------

export function volatilityOf(s: Settings): Volatility {
  const p = startChance(s);
  return p > 0.6 ? 'low' : p > 0.4 ? 'medium' : p > 0.22 ? 'high' : 'extreme';
}

export const VOLATILITY: Record<Volatility, Settings> = {
  low: { dim: 1, budget: 40, side: 'home' },
  medium: { dim: 2, budget: 20, side: 'home' },
  high: { dim: 3, budget: 10, side: 'home' },
  extreme: { dim: 1, budget: 40, side: 'away' },
};

/** Every payout is either a cash-out below the prize or the prize itself. */
export const MAX_MULTIPLIER = Math.max(
  ...DIMS.flatMap((dim) => BUDGETS.flatMap((budget) => SIDES.map((side) => prizeFor({ dim, budget, side })))),
);
