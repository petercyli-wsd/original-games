// Drift: a dot does a fair ±1 random walk on the integers 0..W. 0 is the red
// wall (lose), W is the green wall (win). By gambler's ruin, from position x
// the dot reaches green first with probability exactly x / W, so the dot's
// position *is* the win chance.
//
// Starting at x0, reaching green pays RTP·W/x0, and cashing out at x pays
// RTP·x/x0 = prize × P(win | x). Position is a bounded martingale, so by
// optional stopping every cash-out rule (hold to the end, cash after k steps,
// take-profit, stop-loss, any mix) returns exactly RTP.

import type { Rng, Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

/** Steps from wall to wall. Longer tracks give slower, smoother rounds. */
export const TRACKS = [10, 20, 40, 100] as const;
export type Track = (typeof TRACKS)[number];
export const MAX_TRACK = Math.max(...TRACKS);

/** Steps per burst before pausing at a checkpoint. 0 runs until the player pauses. */
export const BURSTS = [1, 5, 10, 25, 0] as const;
export type Burst = (typeof BURSTS)[number];

/** Start presets, as win chances. Offered when they land on a whole step. */
export const START_CHANCES = [0.5, 0.25, 0.1, 0.05, 0.02, 0.01];

/** Start win chance that represents each volatility level (used by the evals). */
export const VOLATILITY_START: Record<Volatility, number> = { low: 0.5, medium: 0.25, high: 0.1, extreme: 0.01 };
export const VOLATILITY_NAMES = Object.keys(VOLATILITY_START) as Volatility[];

export const winChance = (x: number, W: number) => x / W;
export const prizeMultiplier = (W: number, x0: number) => (RTP * W) / x0;
/** Worth of the bet at position x: 0 on the red wall, the prize on the green one. */
export const cashMultiplier = (x: number, x0: number) => (RTP * x) / x0;
/** Expected steps until the dot hits a wall from x (gambler's ruin duration). */
export const expectedSteps = (x: number, W: number) => x * (W - x);
/** Start one step off red on the longest track. */
export const maxMultiplier = prizeMultiplier(MAX_TRACK, 1);

export function volatilityOf(x0: number, W: number): Volatility {
  const c = x0 / W;
  if (c >= 0.4) return 'low';
  if (c >= 0.2) return 'medium';
  if (c >= 0.05) return 'high';
  return 'extreme';
}

/** Start positions for the presets that land on a whole step of a W-step track. */
export function startPresets(W: number): number[] {
  return START_CHANCES.map((c) => c * W).filter((x) => x >= 1 && Math.abs(x - Math.round(x)) < 1e-9).map(Math.round);
}

/** Keeps the win chance as close as possible when the track length changes. */
export const rescaleStart = (x0: number, from: number, to: number) => Math.min(to - 1, Math.max(1, Math.round((x0 / from) * to)));

/** One fair step. All randomness comes from the host RNG. */
export const step = (x: number, rng: Rng) => x + (rng.next() < 0.5 ? 1 : -1);

/** Optional auto cash-out levels, as track positions (null = off). */
export interface AutoRules {
  takeProfit: number | null;
  stopLoss: number | null;
}

export type Ending = 'win' | 'lose' | 'take-profit' | 'stop-loss';

/** Whether the round ends at x. It pays cashMultiplier(x, x0) either way. */
export function endingAt(x: number, W: number, { takeProfit, stopLoss }: AutoRules): Ending | null {
  if (x >= W) return 'win';
  if (x <= 0) return 'lose';
  if (takeProfit !== null && x >= takeProfit) return 'take-profit';
  if (stopLoss !== null && x <= stopLoss) return 'stop-loss';
  return null;
}
