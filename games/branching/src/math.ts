// Branching: a Galton–Watson family tree. One seed; every generation each
// living node independently has 0, 1, 2 or 3 children, drawn from the
// family's offspring law p = (p0, p1, p2, p3). You win if the family is still
// alive at generation G.
//
// Theorem (Galton–Watson, via generating functions). Let
//   f(x) = p0 + p1·x + p2·x² + p3·x³
// be the offspring generating function and q_t = f(f(…f(0)…)) (t times), with
// q_0 = 0. Then q_t is exactly the chance that ONE node's line is extinct
// within t generations. Lines of different nodes are independent, so with z
// nodes alive at generation g and t = G − g generations still to go,
//
//   P(family alive at G | z alive at g) = 1 − q_t^z = 1 − (1 − s)^z,
//
// where s = 1 − q_t is "each line survives s". These are exact finite
// recursions (no simulation, no tables): q_t is t evaluations of a cubic.
//
// Pricing (fixed prize): a full win pays prize = RTP / (1 − q_G), and the
// cash-out at any checkpoint is V(g, z) = prize × (1 − q_{G−g}^z).
// V is a martingale: given z nodes, the next generation has Z' children with
// E[x^Z'] = f(x)^z, so
//   E[V(g+1, Z')] = prize × (1 − E[q_{t−1}^Z']) = prize × (1 − f(q_{t−1})^z)
//                 = prize × (1 − q_t^z) = V(g, z).
// Extinction (z = 0) gives V = 0, reaching G gives V = prize (q_0 = 0), and V
// starts at prize × (1 − q_G) = RTP. V is bounded by the prize, so by optional
// stopping every cash-out strategy, including the automatic cash-out when more
// than POP_CAP lines are alive (the board is full), returns exactly RTP.
// The largest possible payout is the prize itself.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

/** Offspring laws, safest first. */
export const FAMILIES = ['bushy', 'steady', 'fragile', 'thin'] as const;
export type Family = (typeof FAMILIES)[number];

/** P(0, 1, 2, 3 children) for each family. */
export const OFFSPRING: Record<Family, readonly [number, number, number, number]> = {
  bushy: [0.05, 0.35, 0.45, 0.15],
  steady: [0.15, 0.5, 0.3, 0.05],
  fragile: [0.4, 0.25, 0.1, 0.25],
  thin: [0.4, 0.45, 0.1, 0.05],
};

export const FAMILY_NAME: Record<Family, string> = { bushy: 'Bushy', steady: 'Steady', fragile: 'Fragile', thin: 'Thin' };

/** Generations the family must survive. */
export const GENERATIONS = [3, 5, 8, 12] as const;
export type Gens = (typeof GENERATIONS)[number];

/**
 * More living lines than this and the board is full: the round cashes out at
 * its fair value (by then survival is all but certain). A stopping rule, so
 * RTP is unchanged.
 */
export const POP_CAP = 30;

export const VOLATILITY: Record<Volatility, { family: Family; gens: Gens }> = {
  low: { family: 'bushy', gens: 5 },
  medium: { family: 'steady', gens: 5 },
  high: { family: 'fragile', gens: 8 },
  extreme: { family: 'thin', gens: 12 },
};

/** Mean number of children per node. */
export const meanChildren = (family: Family) => {
  const p = OFFSPRING[family];
  return p[1] + 2 * p[2] + 3 * p[3];
};

/** The offspring generating function f(x) = Σ p_k x^k. */
export function pgf(family: Family, x: number): number {
  const p = OFFSPRING[family];
  return p[0] + x * (p[1] + x * (p[2] + x * p[3]));
}

const qCache = new Map<Family, number[]>();

/** q_t = f^(t)(0): the chance one node's line has died out within t generations. */
export function extinctWithin(family: Family, t: number): number {
  if (t <= 0) return 0;
  let q = qCache.get(family);
  if (!q) qCache.set(family, (q = [0]));
  while (q.length <= t) q.push(pgf(family, q[q.length - 1]));
  return q[t];
}

/** s: the chance one node's line is still alive t generations later. */
export const lineSurvives = (family: Family, t: number) => 1 - extinctWithin(family, t);

/** P(family alive at generation G | z nodes alive at generation g). */
export function winChance(family: Family, gens: number, g: number, z: number): number {
  if (z <= 0) return 0;
  if (g >= gens) return 1;
  return 1 - extinctWithin(family, gens - g) ** z;
}

/** P(every line dies out before generation G) = q_t^z, computed directly (no 1 − P cancellation). */
export function dieOutChance(family: Family, gens: number, g: number, z: number): number {
  if (z <= 0) return 1;
  if (g >= gens) return 0;
  return extinctWithin(family, gens - g) ** z;
}

/** The full win: RTP / P(win from one seed). */
export const prize = (family: Family, gens: number) => RTP / winChance(family, gens, 0, 1);

/** The cash-out at a checkpoint: prize × P(win | state). */
export const cashValue = (family: Family, gens: number, g: number, z: number) => prize(family, gens) * winChance(family, gens, g, z);

/** A child count from a uniform u in [0, 1) (inverse CDF). */
export function sampleChildren(family: Family, u: number): number {
  const p = OFFSPRING[family];
  let acc = 0;
  for (let k = 0; k < 3; k++) {
    acc += p[k];
    if (u < acc) return k;
  }
  return 3;
}

/** Distribution of the total number of children of z nodes (z-fold convolution). */
export function childrenDistribution(family: Family, z: number): number[] {
  const p = OFFSPRING[family];
  let dist = [1];
  for (let i = 0; i < z; i++) {
    const next = new Array<number>(dist.length + 3).fill(0);
    dist.forEach((d, n) => p.forEach((pk, k) => (next[n + k] += d * pk)));
    dist = next;
  }
  return dist;
}

export interface Slice {
  /** Start, as a fraction of the goal ring clockwise from the top. */
  start: number;
  length: number;
}

/**
 * How the goal ring is lit: one green slice per living line. Line 1 covers
 * s of the ring, and each next line covers s of whatever is still red, so
 * slice k has length s(1 − s)^k and the slices add up to 1 − (1 − s)^z,
 * exactly the win chance. What stays red, (1 − s)^z, is the chance that every
 * line dies out. After `max` slices the rest are merged into one.
 */
export function lineSlices(s: number, z: number, max = 16): Slice[] {
  const out: Slice[] = [];
  let red = 1;
  for (let k = 0; k < z; k++) {
    const start = 1 - red;
    if (k === max - 1 && z > max) {
      out.push({ start, length: red - red * (1 - s) ** (z - k) });
      break;
    }
    const length = red * s;
    red -= length;
    out.push({ start, length });
  }
  return out;
}

export function volatilityOf(family: Family, gens: number): Volatility {
  const p = winChance(family, gens, 0, 1);
  return p >= 0.75 ? 'low' : p >= 0.3 ? 'medium' : p >= 0.1 ? 'high' : 'extreme';
}

/** Every payout is at most the prize, so the largest prize bounds them all. */
export const MAX_MULTIPLIER = Math.max(...FAMILIES.flatMap((f) => GENERATIONS.map((g) => prize(f, g))));
