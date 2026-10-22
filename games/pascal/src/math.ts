// Pascal: a uniformly random monotone lattice path crosses an n×n grid, one
// step at a time, from the start corner S to the end corner E. The board is
// the grid turned 45°, so S is the top tile, E the bottom tile, and every
// step goes down-left (↙) or down-right (↘). The path makes n of each.
//
// Every one of the C(2n, n) paths is equally likely. That is the whole game:
// a path is a shuffled deck of n ↘ cards and n ↙ cards, so the next step is
// ↘ with chance (↘ left) / (moves left). It is not Plinko: Plinko bounces
// 50/50 and piles up in the middle of every row by the binomial law; here the
// deck runs out, which pulls the walker back towards the centre line.
//
// The player marks a gate: 1–4 adjacent tiles on one row (an anti-diagonal of
// the grid). Every path crosses each row exactly once, so the events "crosses
// at tile t" are disjoint and
//
//   paths through tile v = (ways in) × (ways out) = C(i+j, i) · C(2n−i−j, n−i),
//   P(win | walker at w)  = Σ_{t in gate} paths(w→t)·paths(t→E) / paths(w→E).
//
// The ways in are Pascal's triangle grown from the walker; the ways out are
// Pascal's triangle grown up from E. Both are drawn on the board.
//
// Pricing (fixed prize). prize = RTP / P(win | S), locked at the bet, and
// cash-out = prize × P(win | walker). P(win | walker) is the conditional
// chance of one fixed event under the uniform path measure, so it is a
// martingale: Pascal's rule paths(w→t) = paths(w↘→t) + paths(w↙→t) with the
// step chances paths(child→E)/paths(w→E) gives E[P after a step] = P now
// exactly (the step test checks it to 1e-12). By optional stopping every
// cash-out rule, pace and choice of gate returns exactly RTP. All counts are
// integers below 2^53 (at most C(16, 8) = 12,870), so every probability is an
// exact ratio of integers; P = 0 and P = 1 are decided by integer equality.
//
// A gate may not cover half its row or more (so P < 1), and its headline
// chance must be at least 1 in 2,000 (integer test 2000·count ≥ total). The
// cash-out never exceeds the prize, so the largest payout is the largest
// prize on offer, MAX_MULTIPLIER.

import type { Rng, Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

/** Grid sizes: an n×n grid has 2n steps and C(2n, n) paths. */
export const SIZES = [4, 6, 8] as const;
export type Size = (typeof SIZES)[number];

/** Gate widths on offer (capped per row so the gate covers less than half of it). */
export const WIDTHS = [1, 2, 3, 4] as const;

/** The smallest headline chance a gate may have: 1 in 2,000. */
export const MIN_CHANCE_INV = 2000;

export interface Pos {
  /** ↘ steps taken. */
  a: number;
  /** ↙ steps taken. */
  b: number;
}

export interface Gate {
  /** The row (= steps from S) the gate sits on, 1..2n−1. */
  row: number;
  /** The leftmost gate tile's ↘ count: the tiles are (a, row − a) for a = lo..lo+width−1. */
  lo: number;
  width: number;
}

export const START: Pos = { a: 0, b: 0 };
export const rowOf = (p: Pos) => p.a + p.b;

const MAX_ROWS = 2 * Math.max(...SIZES);
/** Pascal's triangle up to row 16, exact integers. */
const PASCAL: number[][] = [];
for (let m = 0; m <= MAX_ROWS; m++) {
  PASCAL.push(Array.from({ length: m + 1 }, (_, k) => (k === 0 || k === m ? 1 : PASCAL[m - 1][k - 1] + PASCAL[m - 1][k])));
}

export const choose = (m: number, k: number) => (m < 0 || k < 0 || k > m ? 0 : PASCAL[m][k]);

/** Monotone lattice paths making dx ↘ steps and dy ↙ steps. */
export const paths = (dx: number, dy: number) => (dx < 0 || dy < 0 ? 0 : choose(dx + dy, dx));

/** Paths from the walker to tile v (Pascal's triangle grown from the walker). */
export const waysIn = (from: Pos, v: Pos) => paths(v.a - from.a, v.b - from.b);

/** Paths from tile v to the end E (Pascal's triangle grown up from E). */
export const waysOut = (n: number, v: Pos) => paths(n - v.a, n - v.b);

/** Inclusive range of ↘ counts a on a row: the tiles (a, row − a). */
export function rowRange(n: number, row: number): [number, number] {
  return [Math.max(0, row - n), Math.min(row, n)];
}

export const rowLength = (n: number, row: number) => {
  const [lo, hi] = rowRange(n, row);
  return hi - lo + 1;
};

/** Widest gate on a row: strictly under half its tiles, so it can never be a sure thing. */
export const maxWidth = (n: number, row: number) => Math.min(WIDTHS[WIDTHS.length - 1], Math.floor(rowLength(n, row) / 2));

export interface Crossing {
  a: number;
  tile: Pos;
  /** Paths from the walker that cross the row at this tile: ways in × ways out. */
  count: number;
}

/** Where the remaining paths cross a row (one entry per tile, left to right). */
export function crossing(n: number, from: Pos, row: number): Crossing[] {
  const [lo, hi] = rowRange(n, row);
  const out: Crossing[] = [];
  for (let a = lo; a <= hi; a++) {
    const tile = { a, b: row - a };
    out.push({ a, tile, count: waysIn(from, tile) * waysOut(n, tile) });
  }
  return out;
}

export const inGate = (gate: Gate, v: Pos) => rowOf(v) === gate.row && v.a >= gate.lo && v.a < gate.lo + gate.width;

export interface Tally {
  /** Paths from the walker through the gate. */
  through: number;
  /** All paths from the walker to E. */
  total: number;
}

/**
 * Paths through the gate out of all paths still possible. Once the walker is
 * on or past the gate row the path is decided: through = total or 0.
 */
export function tally(n: number, from: Pos, gate: Gate): Tally {
  const total = waysOut(n, from);
  if (rowOf(from) >= gate.row) return { through: inGate(gate, from) ? total : 0, total };
  let through = 0;
  for (let a = gate.lo; a < gate.lo + gate.width; a++) {
    const tile = { a, b: gate.row - a };
    through += waysIn(from, tile) * waysOut(n, tile);
  }
  return { through, total };
}

export function winChance(n: number, from: Pos, gate: Gate): number {
  const { through, total } = tally(n, from, gate);
  return through / total;
}

/** The round's fate once it is sealed: every remaining path wins, or none does. Null while it is open. */
export function sealed(n: number, from: Pos, gate: Gate): 'win' | 'lose' | null {
  const { through, total } = tally(n, from, gate);
  return through === total ? 'win' : through === 0 ? 'lose' : null;
}

/** Chance the next step is ↘: the ↘ moves left over all moves left (the paths through the ↘ child over all paths). */
export function downRightChance(n: number, from: Pos): number {
  const right = n - from.a;
  const left = n - from.b;
  return right + left === 0 ? 0 : right / (right + left);
}

/** One step of the uniform path, decided by a single draw. */
export function step(n: number, from: Pos, rng: Rng): Pos {
  return rng.next() < downRightChance(n, from) ? { a: from.a + 1, b: from.b } : { a: from.a, b: from.b + 1 };
}

/** Steps until the round is sealed (or the walker reaches the gate row). Always at least one step. */
export function runToGate(n: number, from: Pos, gate: Gate, rng: Rng): Pos[] {
  const out: Pos[] = [];
  let p = from;
  do {
    p = step(n, p, rng);
    out.push(p);
  } while (sealed(n, p, gate) === null);
  return out;
}

/** The headline counts: paths through the gate out of all C(2n, n). */
export const headlineTally = (n: number, gate: Gate) => tally(n, START, gate);
export const headline = (n: number, gate: Gate) => winChance(n, START, gate);
export const prizeFor = (n: number, gate: Gate) => RTP / headline(n, gate);

/** Whether a gate can be bet on: on the board, under half its row, and at least 1 in 2,000. */
export function validGate(n: number, gate: Gate): boolean {
  if (!Number.isInteger(gate.row) || gate.row < 1 || gate.row > 2 * n - 1) return false;
  if (gate.width < 1 || gate.width > maxWidth(n, gate.row)) return false;
  const [lo, hi] = rowRange(n, gate.row);
  if (gate.lo < lo || gate.lo + gate.width - 1 > hi) return false;
  const { through, total } = headlineTally(n, gate);
  return MIN_CHANCE_INV * through >= total;
}

/** Valid left ends for a gate of this width on this row (a contiguous run around the centre). */
export function positions(n: number, row: number, width: number): number[] {
  const [lo, hi] = rowRange(n, row);
  const out: number[] = [];
  for (let s = lo; s + width - 1 <= hi; s++) if (validGate(n, { row, lo: s, width })) out.push(s);
  return out;
}

/** The centre of a gate, in ↘ units (may be a half). */
export const gateCentre = (g: Gate) => g.lo + (g.width - 1) / 2;
/** The centre of a row, in ↘ units. */
export const rowCentre = (n: number, row: number) => {
  const [lo, hi] = rowRange(n, row);
  return (lo + hi) / 2;
};

/**
 * The valid gate on `row` with `width` tiles (clamped to the row) whose centre
 * is nearest to `centre` (ties go to the side nearer the row's middle).
 */
export function placeGate(n: number, row: number, width: number, centre: number): Gate {
  const r = Math.min(2 * n - 1, Math.max(1, Math.round(row)));
  const w = Math.max(1, Math.min(width, maxWidth(n, r)));
  const mid = rowCentre(n, r);
  let best: Gate | null = null;
  let bestKey = Infinity;
  for (const lo of positions(n, r, w)) {
    const g = { row: r, lo, width: w };
    const key = Math.abs(gateCentre(g) - centre) * 1000 + Math.abs(gateCentre(g) - mid);
    if (key < bestKey) {
      bestKey = key;
      best = g;
    }
  }
  // Every row has a valid single tile in its middle, so best is always set.
  return best ?? { row: r, lo: Math.floor(mid), width: 1 };
}

/** The gate reflected across the board's centre line: the same chance, by symmetry. */
export function mirror(n: number, gate: Gate): Gate {
  const [lo, hi] = rowRange(n, gate.row);
  return { row: gate.row, lo: lo + hi - (gate.lo + gate.width - 1), width: gate.width };
}

export function volatilityOf(p: number): Volatility {
  return p >= 0.6 ? 'low' : p >= 0.2 ? 'medium' : p >= 0.03 ? 'high' : 'extreme';
}

/** Every gate a player can bet on, per size. */
export function allGates(n: number): Gate[] {
  const out: Gate[] = [];
  for (let row = 1; row <= 2 * n - 1; row++) {
    for (let width = 1; width <= maxWidth(n, row); width++) for (const lo of positions(n, row, width)) out.push({ row, lo, width });
  }
  return out;
}

/** The largest prize on offer (the cash-out never exceeds the prize). */
export const MAX_MULTIPLIER = Math.max(...SIZES.flatMap((n) => allGates(n).map((g) => prizeFor(n, g))));

/** The eval's settings, one per volatility level. */
export const VOLATILITY: Record<Volatility, { n: Size; gate: Gate }> = {
  low: { n: 6, gate: { row: 6, lo: 2, width: 3 } },
  medium: { n: 8, gate: { row: 8, lo: 4, width: 1 } },
  high: { n: 8, gate: { row: 10, lo: 7, width: 1 } },
  extreme: { n: 8, gate: { row: 8, lo: 1, width: 1 } },
};
