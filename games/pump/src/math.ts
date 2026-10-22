// Pump (the balloon format from Stake): a balloon has 25 pump positions in a
// hidden random order, and d of them are "pop" positions (Easy 1, Medium 3,
// Hard 5, Expert 10). Each pump reveals the next position. A safe position
// inflates the balloon; a pop position bursts it and the bet is lost.
//
// Exact odds. The pops are a uniform d-subset of the 25 positions, so the
// first k positions are all safe with probability
//
//   S(d, k) = C(25 − d, k) / C(25, k) = ∏_{i=0}^{k−1} (25 − d − i) / (25 − i).
//
// Pricing (house pattern 2, a per-step fair factor). After k safe pumps the
// cash-out is
//
//   m(d, k) = RTP / S(d, k) = 0.99 · C(25, k) / C(25 − d, k).
//
// The next pump pops with chance q = d / (25 − k) (d pops among the 25 − k
// unseen positions), and surviving it multiplies the cash-out by exactly
// 1 / (1 − q) = (25 − k) / (25 − k − d) = m(d, k + 1) / m(d, k). So the cash-out
// is a martingale that starts at RTP, and by optional stopping every rule
// (cash out after N pumps, stop at a multiplier, stop when the pop chance gets
// too high, pump to the end) returns exactly RTP = 99%. In particular cashing
// out after k pumps is worth S(d, k) · m(d, k) = 0.99 for every k.
//
// The ladder ends at 25 − d pumps (every safe position used); that rung pays
// 0.99 · C(25, d) and the round cashes out automatically there. It is the
// largest payout: 24.75× (Easy), 2,277× (Medium), 52,598.70× (Hard) and
// 3,236,072.40× (Expert). No other cap is needed, since the ladder is finite.

import type { Rng, Volatility } from '@originals/game-sdk';

export const RTP = 0.99;
export const POSITIONS = 25;

export const DIFFICULTIES = ['easy', 'medium', 'hard', 'expert'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const POPS: Record<Difficulty, number> = { easy: 1, medium: 3, hard: 5, expert: 10 };
export const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert' };
export const VOLATILITY_OF: Record<Difficulty, Volatility> = { easy: 'low', medium: 'medium', hard: 'high', expert: 'extreme' };

/** The most pumps a round can take: every safe position. */
export const maxPumps = (d: number) => POSITIONS - d;

/** Exact chance the first k pumps are all safe: C(25 − d, k) / C(25, k). */
export function survival(d: number, k: number): number {
  if (k < 0 || k > maxPumps(d)) return 0;
  let p = 1;
  for (let i = 0; i < k; i++) p *= (POSITIONS - d - i) / (POSITIONS - i);
  return p;
}

/** Cash-out after k safe pumps: 0.99 · C(25, k) / C(25 − d, k). */
export function multiplier(d: number, k: number): number {
  let m = RTP;
  for (let i = 0; i < k; i++) m *= (POSITIONS - i) / (POSITIONS - d - i);
  return m;
}

/** Chance the next pump pops, after k safe pumps. */
export const popChance = (d: number, k: number) => (k >= maxPumps(d) ? 1 : d / (POSITIONS - k));

/** The multiplier ladder: rung i (0-based) is the cash-out after i + 1 pumps. */
const ladders = new Map<number, number[]>();
export function ladder(d: number): number[] {
  let l = ladders.get(d);
  if (!l) {
    l = Array.from({ length: maxPumps(d) }, (_, i) => multiplier(d, i + 1));
    ladders.set(d, l);
  }
  return l;
}

/**
 * The round's hidden order: 25 positions, d of them pops (true), drawn as a
 * uniform d-subset by a partial Fisher–Yates shuffle. Drawn when the bet is
 * placed, so every pump's outcome is fixed before it animates.
 */
export function drawPositions(rng: Rng, d: number): boolean[] {
  const idx = Array.from({ length: POSITIONS }, (_, i) => i);
  for (let i = 0; i < d; i++) {
    const j = i + rng.int(POSITIONS - i);
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  const out = new Array<boolean>(POSITIONS).fill(false);
  for (let i = 0; i < d; i++) out[idx[i]] = true;
  return out;
}

/** The pump (1-based) on which the balloon would pop. */
export const firstPop = (positions: readonly boolean[]) => positions.indexOf(true) + 1;

/** Plays one round that stops after `target` pumps (or pops first). */
export function playToTarget(positions: readonly boolean[], d: number, target: number): { pumps: number; multiplier: number } {
  const t = Math.min(target, maxPumps(d));
  for (let k = 0; k < t; k++) if (positions[k]) return { pumps: k + 1, multiplier: 0 };
  return { pumps: t, multiplier: multiplier(d, t) };
}

/** The ladder's top rung for each difficulty; the largest is the game's max payout. */
export const topMultiplier = (d: number) => multiplier(d, maxPumps(d));
export const MAX_MULTIPLIER = Math.max(...DIFFICULTIES.map((x) => topMultiplier(POPS[x])));
