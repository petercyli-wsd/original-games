// Pascal: a deck of N ↙ cards and N ↘ cards (N = 6) is shuffled face down.
// Cards are dealt one at a time and a ball follows them down Pascal's
// triangle: ↙ moves it one tile down-left, ↘ one tile down-right. After N
// cards it lands on one of the N + 1 tiles of the bottom row. The player's
// gate is 1–3 adjacent bottom tiles; the ball landing in the gate wins.
//
// The ball's tile on the bottom row is the number of ↘ cards among the first
// N dealt, so the deal is a hypergeometric draw. With R ↘ and L ↙ cards left
// in the deck and k cards still to deal before the bottom row,
//
//   P(next card is ↘)        = R / (R + L)                     (the cards left),
//   P(j more ↘ before the end) = C(R, j) · C(L, k − j) / C(R + L, k),
//   P(win | state)            = Σ over gate tiles of the line above.
//
// Every count is an integer no larger than C(12, 6) = 924, so every chance is
// an exact ratio of integers; P = 0 and P = 1 are decided by integer equality.
// (The same numbers are Pascal's triangle: the ways in to a bottom tile times
// the ways out of it, by the symmetry of the hypergeometric law.)
//
// Pricing (fixed prize). prize = RTP / P(win | start), locked at the bet, and
// cash-out = prize × P(win | cards dealt so far). P(win | state) is the
// conditional chance of one fixed event given the cards seen, so it is a
// martingale: averaging the next card's two outcomes, weighted R/(R+L) and
// L/(R+L), gives back the chance now (Vandermonde's identity; the step test
// checks it to 1e-12). By optional stopping every cash-out rule, pace and gate
// returns exactly RTP.
//
// A gate may not cover half the row or more (at most 3 of 7 tiles, so P < 1),
// and its chance must be at least 1 in 2,000 (integer test 2000·count ≥
// total). The cash-out never exceeds the prize, so the largest payout is the
// largest prize on offer, MAX_MULTIPLIER = 0.99 × 924 (one corner tile).

import type { Rng, Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

/** Cards of each kind in the deck, and the rows from the top tile to the bottom row. */
export const N = 6;

/** Gate widths on offer (strictly under half of the bottom row's N + 1 tiles). */
export const WIDTHS = [1, 2, 3] as const;

/** The smallest chance a gate may have: 1 in 2,000. */
export const MIN_CHANCE_INV = 2000;

export interface Pos {
  /** ↘ cards dealt so far. */
  a: number;
  /** ↙ cards dealt so far. */
  b: number;
}

export interface Gate {
  /** The leftmost gate tile: bottom tiles are numbered by their ↘ count, 0..N. */
  lo: number;
  width: number;
}

export const START: Pos = { a: 0, b: 0 };
/** Cards dealt = the ball's row (0 = the top tile, N = the bottom row). */
export const rowOf = (p: Pos) => p.a + p.b;

/** Pascal's triangle up to row 2N, exact integers. */
const PASCAL: number[][] = [];
for (let m = 0; m <= 2 * N; m++) {
  PASCAL.push(Array.from({ length: m + 1 }, (_, k) => (k === 0 || k === m ? 1 : PASCAL[m - 1][k - 1] + PASCAL[m - 1][k])));
}

export const choose = (m: number, k: number) => (m < 0 || k < 0 || k > m ? 0 : PASCAL[m][k]);

/** The cards still in the deck. */
export function cardsLeft(from: Pos): { down: number; right: number; left: number } {
  const right = N - from.a;
  const left = N - from.b;
  return { right, left, down: right + left };
}

/** Chance the next card is ↘: the ↘ cards left over all cards left. */
export function downRightChance(from: Pos): number {
  const { right, down } = cardsLeft(from);
  return down === 0 ? 0 : right / down;
}

export interface Landing {
  /** The bottom tile (its ↘ count). */
  a: number;
  /** Deals of the remaining cards that land the ball on this tile (out of `total`). */
  count: number;
}

/** Ways the rest of the deal lands on each bottom tile, left to right. */
export function landings(from: Pos): Landing[] {
  const { right, left } = cardsLeft(from);
  const k = N - rowOf(from);
  const out: Landing[] = [];
  for (let a = 0; a <= N; a++) {
    const j = a - from.a;
    out.push({ a, count: k < 0 ? 0 : choose(right, j) * choose(left, k - j) });
  }
  return out;
}

export const inGate = (gate: Gate, a: number) => a >= gate.lo && a < gate.lo + gate.width;

export interface Tally {
  /** Deals that land the ball in the gate. */
  through: number;
  /** All deals of the cards still to come before the bottom row: C(cards left, cards to deal). */
  total: number;
}

/** Deals through the gate out of all deals still possible. On the bottom row the result is decided. */
export function tally(from: Pos, gate: Gate): Tally {
  const { down } = cardsLeft(from);
  const total = choose(down, N - rowOf(from));
  let through = 0;
  for (const l of landings(from)) if (inGate(gate, l.a)) through += l.count;
  return { through, total };
}

export function winChance(from: Pos, gate: Gate): number {
  const { through, total } = tally(from, gate);
  return through / total;
}

/** The round's fate once it is sealed: every deal left wins, or none does. Null while it is open. */
export function sealed(from: Pos, gate: Gate): 'win' | 'lose' | null {
  const { through, total } = tally(from, gate);
  return through === total ? 'win' : through === 0 ? 'lose' : null;
}

/** Deal one card: ↘ with chance (↘ left) / (cards left). */
export function step(from: Pos, rng: Rng): Pos {
  return rng.next() < downRightChance(from) ? { a: from.a + 1, b: from.b } : { a: from.a, b: from.b + 1 };
}

/** Deal until the round is sealed (at the latest on the bottom row). Always at least one card. */
export function runToGate(from: Pos, gate: Gate, rng: Rng): Pos[] {
  const out: Pos[] = [];
  let p = from;
  do {
    p = step(p, rng);
    out.push(p);
  } while (sealed(p, gate) === null);
  return out;
}

export const headlineTally = (gate: Gate) => tally(START, gate);
export const headline = (gate: Gate) => winChance(START, gate);
export const prizeFor = (gate: Gate) => RTP / headline(gate);

/** Whether a gate can be bet on: on the row, under half of it, and at least 1 in 2,000. */
export function validGate(gate: Gate): boolean {
  if (!WIDTHS.includes(gate.width as (typeof WIDTHS)[number])) return false;
  if (gate.lo < 0 || gate.lo + gate.width - 1 > N) return false;
  const { through, total } = headlineTally(gate);
  return MIN_CHANCE_INV * through >= total;
}

/** Valid left ends for a gate of this width. */
export function positions(width: number): number[] {
  const out: number[] = [];
  for (let s = 0; s + width - 1 <= N; s++) if (validGate({ lo: s, width })) out.push(s);
  return out;
}

/** The centre of a gate, in tiles (may be a half). */
export const gateCentre = (g: Gate) => g.lo + (g.width - 1) / 2;
export const ROW_CENTRE = N / 2;

/** The valid gate of this width whose centre is nearest to `centre` (ties go towards the middle). */
export function placeGate(width: number, centre: number): Gate {
  const w = Math.max(1, Math.min(width, WIDTHS[WIDTHS.length - 1]));
  let best: Gate = { lo: ROW_CENTRE, width: 1 };
  let bestKey = Infinity;
  for (const lo of positions(w)) {
    const g = { lo, width: w };
    const key = Math.abs(gateCentre(g) - centre) * 1000 + Math.abs(gateCentre(g) - ROW_CENTRE);
    if (key < bestKey) {
      bestKey = key;
      best = g;
    }
  }
  return best;
}

/** The gate reflected across the triangle's centre line: the same chance, by symmetry. */
export const mirror = (gate: Gate): Gate => ({ lo: N - (gate.lo + gate.width - 1), width: gate.width });

export function volatilityOf(p: number): Volatility {
  return p >= 0.6 ? 'low' : p >= 0.2 ? 'medium' : p >= 0.03 ? 'high' : 'extreme';
}

/** Every gate a player can bet on. */
export function allGates(): Gate[] {
  return WIDTHS.flatMap((width) => positions(width).map((lo) => ({ lo, width })));
}

/** The largest prize on offer (the cash-out never exceeds the prize). */
export const MAX_MULTIPLIER = Math.max(...allGates().map(prizeFor));

/** The eval's settings, one per volatility level. */
export const VOLATILITY: Record<Volatility, Gate> = {
  low: { lo: 2, width: 3 },
  medium: { lo: 3, width: 1 },
  high: { lo: 1, width: 1 },
  extreme: { lo: 0, width: 1 },
};
