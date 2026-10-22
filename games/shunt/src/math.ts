// Shunt: Knuth's railway siding. Cars 1..n arrive in a uniformly random
// order and are routed through a stack (the siding) by the greedy rule: a car
// that is next in line drives straight out; any other car backs into the
// siding; whenever the car on top of the siding is next in line, it leaves.
// The exit must read 1, 2, 3, … n.
//
// The siding is last-in, first-out, so its cars must sit with the smallest on
// top. An arriving car bigger than the top car would bury a car that has to
// leave before it: the siding jams. So, at any moment, the cars still to come
// that are bigger than the top car are exactly the ones that jam next (drawn
// red), and their share of the cars still to come is the next-car risk.
//
// Knuth: a whole arrival order clears iff it avoids the pattern 231, and
// Catalan(n) of the n! orders do. So P(clear) = Catalan(n) / n!.
//
// Live odds. Let the siding hold s₁ > s₂ > … > s_k (s_k on top). The cars still
// to come split into blocks: those below s_k, those between s_k and s_{k−1},
// …, those above s₁. Every car of the lowest block must arrive before any
// higher car (else that car jams on s_k), then the next block, and so on, and
// each block must itself arrive in a sortable order. So among the m! orders
// of the m cars still to come, exactly ∏ Catalan(|block|) clear the yard:
//
//   P(clear | state) = ∏ Catalan(m_j) / m!     (exact, no simulation)
//
// Pricing (fixed prize): a clear pays prize = RTP · n!/Catalan(n); the
// cash-out is prize × P(clear | state). P(clear | state) is a conditional
// probability of the same event as the arrivals unfold, so it is a
// martingale, and every stopping rule returns exactly RTP.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

/** Number of cars in the train. More cars jam more often and pay more. */
export const CARS = [4, 5, 6, 7, 8, 9] as const;
export type Cars = (typeof CARS)[number];

export const VOLATILITY: Record<Volatility, { n: Cars }> = {
  low: { n: 4 },
  medium: { n: 6 },
  high: { n: 8 },
  extreme: { n: 9 },
};

export function volatilityOf(n: Cars): Volatility {
  return n <= 5 ? 'low' : n === 6 ? 'medium' : n <= 8 ? 'high' : 'extreme';
}

const FACT: number[] = [1];
for (let i = 1; i <= 20; i++) FACT[i] = FACT[i - 1] * i;
export const factorial = (m: number) => FACT[m];

const CAT: number[] = [1];
for (let i = 1; i <= 20; i++) CAT[i] = (CAT[i - 1] * 2 * (2 * i - 1)) / (i + 1);
/** Catalan numbers 1, 1, 2, 5, 14, 42, 132, 429, 1430, 4862, … */
export const catalan = (m: number) => CAT[m];

export interface Yard {
  n: Cars;
  /** The siding, bottom first (so the last entry is the top car). Always decreasing. */
  stack: number[];
  /** Cars that have left, in order: always 1, 2, …, out.length. */
  out: number[];
  /** Cars still to arrive, ascending. */
  rest: number[];
  /** The car that jammed the siding, if one did. */
  jammed: number | null;
}

export const initialYard = (n: Cars): Yard => ({
  n,
  stack: [],
  out: [],
  rest: Array.from({ length: n }, (_, i) => i + 1),
  jammed: null,
});

/** The car the exit is waiting for. */
export const nextOut = (y: Yard) => y.out.length + 1;

export const topOf = (y: Yard): number | null => (y.stack.length ? y.stack[y.stack.length - 1] : null);

/** Whether this car, arriving next, would jam the siding. */
export function wouldJam(y: Yard, car: number): boolean {
  const top = topOf(y);
  return top !== null && car > top;
}

/** Chance the next arriving car jams: red cars / cars still to come. */
export function nextRisk(y: Yard): number {
  if (y.jammed !== null || y.rest.length === 0) return 0;
  return y.rest.filter((c) => wouldJam(y, c)).length / y.rest.length;
}

/** Sizes of the blocks the siding splits the remaining cars into, lowest block first. */
export function blocks(y: Yard): number[] {
  const cuts = [...y.stack].reverse(); // top (smallest) first
  const sizes = new Array(cuts.length + 1).fill(0);
  for (const c of y.rest) {
    let j = 0;
    while (j < cuts.length && c > cuts[j]) j++;
    sizes[j]++;
  }
  return sizes;
}

/** Arrival orders of the remaining cars that clear the yard: ∏ Catalan(block). */
export function clearingOrders(y: Yard): number {
  if (y.jammed !== null) return 0;
  return blocks(y).reduce((p, m) => p * catalan(m), 1);
}

/** All arrival orders of the remaining cars: m!. */
export const allOrders = (y: Yard) => factorial(y.rest.length);

/** Exact chance the yard clears from here. */
export const clearChance = (y: Yard) => clearingOrders(y) / allOrders(y);

/** Chance a fresh train of n cars clears: Catalan(n) / n!. */
export const startChance = (n: Cars) => catalan(n) / factorial(n);

/** What a full clear pays. */
export const prizeOf = (n: Cars) => RTP / startChance(n);

/** The fair cash-out: prize × P(clear | yard). */
export const cashOf = (y: Yard) => prizeOf(y.n) * clearChance(y);

export type Move = { kind: 'exit'; car: number } | { kind: 'push'; car: number } | { kind: 'pop'; car: number } | { kind: 'jam'; car: number };

/** One car arrives and is routed by the greedy rule. Returns the new yard and the moves, in order. */
export function arrive(y: Yard, car: number): { yard: Yard; moves: Move[] } {
  if (y.jammed !== null || !y.rest.includes(car)) throw new Error(`car ${car} cannot arrive`);
  const rest = y.rest.filter((c) => c !== car);
  if (wouldJam(y, car)) return { yard: { ...y, rest, jammed: car }, moves: [{ kind: 'jam', car }] };
  const stack = [...y.stack];
  const out = [...y.out];
  const moves: Move[] = [];
  if (car === out.length + 1) {
    out.push(car);
    moves.push({ kind: 'exit', car });
  } else {
    stack.push(car);
    moves.push({ kind: 'push', car });
  }
  while (stack.length && stack[stack.length - 1] === out.length + 1) {
    const c = stack.pop()!;
    out.push(c);
    moves.push({ kind: 'pop', car: c });
  }
  return { yard: { ...y, stack, out, rest }, moves };
}

export const isCleared = (y: Yard) => y.jammed === null && y.out.length === y.n;

/** Runs a whole arrival order through the greedy rule. */
export function clears(order: readonly number[]): boolean {
  let y = initialYard(order.length as Cars);
  for (const c of order) {
    y = arrive(y, c).yard;
    if (y.jammed !== null) return false;
  }
  return isCleared(y);
}

/** Whether the order contains the pattern 231 (b, c, a with a < b < c). */
export function has231(order: readonly number[]): boolean {
  const m = order.length;
  for (let i = 0; i < m; i++)
    for (let j = i + 1; j < m; j++)
      for (let k = j + 1; k < m; k++) if (order[k] < order[i] && order[i] < order[j]) return true;
  return false;
}

/** Highest cash-out any round can reach: the 9-car clear. Cash-outs never exceed the prize. */
export const MAX_MULTIPLIER = Math.max(...CARS.map(prizeOf));
