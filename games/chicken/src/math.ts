// Chicken (the lane-crossing format: Mission Uncrossable / Chicken): a token
// crosses a road of 20 lanes, one lane at a time. Each lane is hit by traffic
// with chance h, set by the difficulty:
//
//   Easy 1/25 · Medium 3/25 · Hard 5/25 · Daredevil 10/25
//
// A hit ends the round and loses the stake. After each safe lane the player can
// cash out; crossing lane 20 (the far kerb) pays out by itself.
//
// The road is drawn when the bet is placed: lane i is hit iff int(25) < hits,
// independently per lane, so each lane is hit with probability exactly
// h = hits / 25 (an integer comparison, no floating tie). Reaching lane k
// (k safe crossings in a row) has probability (1 − h)^k and the cash-out after
// k lanes is
//
//     M(k) = RTP / (1 − h)^k = 0.99 · (25 / (25 − hits))^k.
//
// Pricing is a per-step fair factor (house pattern 2): surviving a lane
// multiplies the cash-out by 1 / (1 − h), exactly the inverse of the chance of
// surviving it. The cash-out is a martingale starting at M(0) = RTP, so by the
// optional stopping theorem every strategy (cash out at any lane, chase a
// multiplier, an auto target lane, cross to the end) returns exactly
//
//     RTP = 99%.
//
// Fixed targets show it directly: (1 − h)^k · M(k) = 0.99 for every k.
//
// Exact finish prizes (lane 20):
//   Easy       0.99 · (25/24)^20 =      2.2398…×
//   Medium     0.99 · (25/22)^20 =     12.7639…×
//   Hard       0.99 · (5/4)^20   =     85.8688…×
//   Daredevil  0.99 · (5/3)^20   = 27,077.60…×   (the honest max; the ladder is finite)

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;
export const LANES = 20;
/** Hit chances are counted in 25ths. */
export const OUT_OF = 25;

export type Difficulty = 'easy' | 'medium' | 'hard' | 'daredevil';

export interface DifficultySpec {
  label: string;
  /** Lanes hit per 25. */
  hits: number;
}

export const DIFFICULTY: Record<Difficulty, DifficultySpec> = {
  easy: { label: 'Easy', hits: 1 },
  medium: { label: 'Medium', hits: 3 },
  hard: { label: 'Hard', hits: 5 },
  daredevil: { label: 'Daredevil', hits: 10 },
};

export const DIFFICULTIES = Object.keys(DIFFICULTY) as Difficulty[];

/** Chance a lane is hit: hits / 25. */
export const hitChance = (d: Difficulty) => DIFFICULTY[d].hits / OUT_OF;

/** Chance a lane is crossed safely: (25 − hits) / 25, the same for every lane. */
export const laneSafe = (d: Difficulty) => (OUT_OF - DIFFICULTY[d].hits) / OUT_OF;

/** The per-lane fair factor 25 / (25 − hits). */
export const laneFactor = (d: Difficulty) => OUT_OF / (OUT_OF - DIFFICULTY[d].hits);

/** Chance of crossing the first k lanes: (1 − h)^k. */
export const reachChance = (d: Difficulty, k: number) => laneSafe(d) ** k;

/** Cash-out after k crossed lanes: RTP · (25 / (25 − hits))^k (k = 0 is the stake's fair value). */
export const multiplier = (d: Difficulty, k: number) => RTP * laneFactor(d) ** k;

/** The cash-out after one more safe lane. */
export const afterSafe = (cash: number, d: Difficulty) => (cash * OUT_OF) / (OUT_OF - DIFFICULTY[d].hits);

/** Crossing lane 20 pays this. */
export const finish = (d: Difficulty) => multiplier(d, LANES);

/** Largest payout under any setting: the Daredevil finish, 0.99 · (5/3)^20. */
export const MAX_MULTIPLIER = Math.max(...DIFFICULTIES.map(finish));

export function volatilityOf(d: Difficulty): Volatility {
  return d === 'easy' ? 'low' : d === 'medium' ? 'medium' : d === 'hard' ? 'high' : 'extreme';
}

/** A road: road[i] is true when lane i + 1 is hit by traffic. */
export type Road = boolean[];

/** Draws the road: each lane is hit iff int(25) < hits, independently. */
export function buildRoad(d: Difficulty, int: (n: number) => number): Road {
  const hits = DIFFICULTY[d].hits;
  return Array.from({ length: LANES }, () => int(OUT_OF) < hits);
}

export interface CrossResult {
  /** Lanes entered (the last one is the hit, if there was one). */
  lanes: number;
  /** The lane (1-based) whose traffic ended the round, or null if every lane was safe. */
  hit: number | null;
  /** M(target) when every lane was safe, else 0. */
  multiplier: number;
}

/** One auto bet: cross lanes 1..target, stopping at the first hit. */
export function cross(road: Road, d: Difficulty, target: number): CrossResult {
  const t = Math.min(LANES, Math.max(1, Math.floor(target)));
  for (let i = 0; i < t; i++) if (road[i]) return { lanes: i + 1, hit: i + 1, multiplier: 0 };
  return { lanes: t, hit: null, multiplier: multiplier(d, t) };
}

/** The highest lane whose reach chance is at least `floor` (at least 1). */
export function reachableLane(d: Difficulty, floor: number): number {
  let k = 1;
  while (k < LANES && reachChance(d, k + 1) >= floor) k++;
  return k;
}
