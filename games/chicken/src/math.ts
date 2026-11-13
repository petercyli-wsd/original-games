// Chicken, laid out exactly like Stake's Chicken: a road of N = 20 slots hides
// m hazards (Easy 1, Medium 3, Hard 5, Expert 10), drawn WITHOUT replacement as
// a uniform m-subset. The token hops slots 1, 2, 3 ... in order; a hazard ends
// the round and loses the stake. The crossable lanes are the first
// L = 20 - m slots (Easy 19, Medium 17, Hard 15, Expert 10): if all L are safe,
// every hazard sits in the unvisited tail and the round pays the top prize.
//
// Exact odds. The first k slots are all safe with probability
//
//   S(m, k) = C(20 - m, k) / C(20, k) = prod_{i<k} (20 - m - i) / (20 - i).
//
// Pricing (house pattern 2, a per-step fair factor). After k safe hops the
// cash-out is
//
//   M(k) = RTP / S(m, k) = RTP * C(20, k) / C(20 - m, k),   M(0) = RTP.
//
// The next slot is a hazard with chance q = m / (20 - k), so a safe hop
// multiplies the cash-out by exactly 1 / (1 - q) = (20 - k) / (20 - m - k) =
// M(k + 1) / M(k). The cash-out is a martingale starting at RTP, and by optional
// stopping every rule (cash out at lane t, at a multiplier, play to the end)
// returns exactly RTP. Never a per-step edge: M(k) * S(m, k) = RTP for all k.
//
// RTP is 98%, the value Stake's published table implies: first lanes
// 1.03 / 1.15 / 1.31 / 1.96 (rounded for display), tops 19.60 / 1,117.20 /
// 15,193.92 / 181,060.88, and finishing chances 1/20, 1/1,140, 1/15,504 and
// 1/184,756 are 0.98 * C(20, k) / C(20 - m, k) and 1 / C(20, m) exactly. The
// ladder is finite, so the largest payout, 181,060.88x, is the honest maximum.

import type { Rng, Volatility } from '@originals/game-sdk';

export const RTP = 0.98;
/** Slots on the road. */
export const SLOTS = 20;

export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';

export interface DifficultySpec {
  label: string;
  /** Hazards hidden among the 20 slots. */
  hazards: number;
}

export const DIFFICULTY: Record<Difficulty, DifficultySpec> = {
  easy: { label: 'Easy', hazards: 1 },
  medium: { label: 'Medium', hazards: 3 },
  hard: { label: 'Hard', hazards: 5 },
  expert: { label: 'Expert', hazards: 10 },
};

export const DIFFICULTIES = Object.keys(DIFFICULTY) as Difficulty[];

/** Crossable lanes: 20 - hazards (19 / 17 / 15 / 10). */
export const lanesOf = (d: Difficulty) => SLOTS - DIFFICULTY[d].hazards;

/** Exact binomial coefficient (all values used are below 2^53). */
export function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
}

/** Chance the first k slots are all safe: C(20 - m, k) / C(20, k). */
export function reachChance(d: Difficulty, k: number): number {
  if (k > lanesOf(d)) return 0;
  const m = DIFFICULTY[d].hazards;
  let p = 1;
  for (let i = 0; i < k; i++) p *= (SLOTS - m - i) / (SLOTS - i);
  return p;
}

/** Chance the next slot is a hazard after k safe hops: m / (20 - k). */
export const hazardChance = (d: Difficulty, k: number) => (k >= lanesOf(d) ? 1 : DIFFICULTY[d].hazards / (SLOTS - k));

/** Chance of crossing every remaining lane from k safe hops: 1 / C(20 - k, m). */
export const finishChance = (d: Difficulty, k: number) => 1 / choose(SLOTS - k, DIFFICULTY[d].hazards);

/** Cash-out after k safe hops: RTP * C(20, k) / C(20 - m, k) (k = 0 is the stake's fair value). */
export function multiplier(d: Difficulty, k: number): number {
  const m = DIFFICULTY[d].hazards;
  let v = RTP;
  for (let i = 0; i < k; i++) v *= (SLOTS - i) / (SLOTS - m - i);
  return v;
}

/** The cash-out after one more safe hop from cash-out `cash` after k hops. */
export const afterSafe = (cash: number, d: Difficulty, k: number) => (cash * (SLOTS - k)) / (SLOTS - DIFFICULTY[d].hazards - k);

/** Crossing the last lane pays this: RTP * C(20, m). */
export const finish = (d: Difficulty) => multiplier(d, lanesOf(d));

/** Largest payout under any setting: the Expert finish, 0.98 * C(20, 10) = 181,060.88. */
export const MAX_MULTIPLIER = Math.max(...DIFFICULTIES.map(finish));

export function volatilityOf(d: Difficulty): Volatility {
  return d === 'easy' ? 'low' : d === 'medium' ? 'medium' : d === 'hard' ? 'high' : 'extreme';
}

/** A road: road[i] is true when slot i + 1 is a hazard (20 entries, exactly m true). */
export type Road = boolean[];

/** Draws the hazards: a uniform m-subset of the 20 slots by a partial Fisher-Yates shuffle. */
export function buildRoad(d: Difficulty, int: (n: number) => number): Road {
  const m = DIFFICULTY[d].hazards;
  const idx = Array.from({ length: SLOTS }, (_, i) => i);
  for (let i = 0; i < m; i++) {
    const j = i + int(SLOTS - i);
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  const road = new Array<boolean>(SLOTS).fill(false);
  for (let i = 0; i < m; i++) road[idx[i]] = true;
  return road;
}

export function drawRoad(rng: Rng, d: Difficulty): Road {
  return buildRoad(d, (n) => rng.int(n));
}

export interface CrossResult {
  /** Lanes entered (the last one is the hazard, if there was one). */
  lanes: number;
  /** The lane (1-based) whose hazard ended the round, or null if every lane was safe. */
  hit: number | null;
  /** M(target) when every lane was safe, else 0. */
  multiplier: number;
}

/** One auto bet: hop lanes 1..target, stopping at the first hazard. */
export function cross(road: Road, d: Difficulty, target: number): CrossResult {
  const t = Math.min(lanesOf(d), Math.max(1, Math.floor(target)));
  for (let i = 0; i < t; i++) if (road[i]) return { lanes: i + 1, hit: i + 1, multiplier: 0 };
  return { lanes: t, hit: null, multiplier: multiplier(d, t) };
}

/** The highest lane whose reach chance is at least `floor` (at least 1). */
export function reachableLane(d: Difficulty, floor: number): number {
  let k = 1;
  while (k < lanesOf(d) && reachChance(d, k + 1) >= floor) k++;
  return k;
}
