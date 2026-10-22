// Mines (Stake, Roobet, BC.Game, Rollbit, Shuffle, Rainbet…): m mines are
// hidden uniformly at random among the 25 tiles of a 5×5 grid, the other
// 25 − m are gems. The player reveals tiles one at a time and may cash out
// after any safe reveal; revealing a mine loses the stake.
//
// Exchangeability: the mines are a uniformly random m-subset, so whatever
// tiles have been revealed, and whichever hidden tile is picked next, it is a
// mine with probability exactly (mines left) / (tiles left) = m / (25 − k)
// after k safe reveals. Tile choice changes nothing; only k matters.
//
// So k safe reveals in a row happen with probability
//
//     P(k) = C(25 − m, k) / C(25, k) = Π_{i<k} (25 − m − i) / (25 − i),
//
// and the cash-out after k gems is the closed form
//
//     M(k) = RTP · C(25, k) / C(25 − m, k) = RTP / P(k).
//
// Pricing is a per-step fair factor: surviving reveal k+1 (safe with chance
// (25 − m − k) / (25 − k)) multiplies the cash-out by (25 − k) / (25 − m − k).
// The cash-out is therefore a martingale starting at M(0) = RTP = 0.99, and by
// optional stopping every strategy (cash-out point, tile order, auto tile set)
// returns exactly 99%. Clearing every gem pays RTP · C(25, m); the largest
// such prize is m = 12 or 13: 0.99 · C(25, 12) = 5,148,297×, the honest max.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;
export const SIZE = 5;
export const TILES = SIZE * SIZE;
export const MIN_MINES = 1;
export const MAX_MINES = 24;

/** Quick picks shown under the mines stepper (the familiar presets). */
export const MINE_PRESETS = [1, 3, 5, 10, 24] as const;

export const gemsFor = (mines: number) => TILES - mines;

/** C(n, k) exactly (all values here are far below 2^53). */
export function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let c = 1;
  for (let i = 1; i <= k; i++) c = (c * (n - k + i)) / i;
  return Math.round(c);
}

/** Chance the next hidden tile is a gem, after k safe reveals. */
export const nextSafe = (mines: number, k: number) => (k >= gemsFor(mines) ? 0 : (TILES - mines - k) / (TILES - k));

/** Chance the first k reveals are all gems: C(25 − m, k) / C(25, k). */
export const surviveChance = (mines: number, k: number) => choose(TILES - mines, k) / choose(TILES, k);

/** Cash-out multiplier after k safe reveals: RTP · C(25, k) / C(25 − m, k). */
export const multiplier = (mines: number, k: number) => RTP * (choose(TILES, k) / choose(TILES - mines, k));

/** The cash-out after one more safe reveal (the per-step fair factor applied). */
export const afterSafe = (cash: number, mines: number, k: number) => (cash * (TILES - k)) / (TILES - mines - k);

/** Clearing the board (every gem) pays this. */
export const fullClear = (mines: number) => multiplier(mines, gemsFor(mines));

/** Largest payout under any setting: 0.99 · C(25, 12). */
export const MAX_MULTIPLIER = Math.max(...Array.from({ length: MAX_MINES }, (_, i) => fullClear(i + 1)));

export function volatilityOf(mines: number): Volatility {
  return mines <= 2 ? 'low' : mines <= 6 ? 'medium' : mines <= 14 ? 'high' : 'extreme';
}

/** Places the mines: a uniformly random m-subset of the 25 tiles. */
export function placeMines(mines: number, shuffle: <T>(items: readonly T[]) => T[]): boolean[] {
  const order = shuffle(Array.from({ length: TILES }, (_, i) => i));
  const board = new Array<boolean>(TILES).fill(false);
  for (let i = 0; i < mines; i++) board[order[i]] = true;
  return board;
}

export interface AutoRound {
  /** Tiles revealed in order, ending at the first mine if one was hit. */
  revealed: number[];
  /** The mine that ended the round, or null if every selected tile was a gem. */
  hit: number | null;
  /** Payout multiplier: M(selection size) when every tile is safe, else 0. */
  multiplier: number;
}

/** One auto bet: reveal the preset tiles in order, stopping at the first mine. */
export function playSelection(board: readonly boolean[], mines: number, selection: readonly number[]): AutoRound {
  const revealed: number[] = [];
  for (const t of selection) {
    revealed.push(t);
    if (board[t]) return { revealed, hit: t, multiplier: 0 };
  }
  return { revealed, hit: null, multiplier: multiplier(mines, selection.length) };
}
