// Dice Ring tiles (Snakes mechanism): a Start tile plus 11 tiles, one per dice
// total 2-12. Each roll of two dice lands on the tile for its total; a pit
// tile (the "snake") loses the bet, any other tile multiplies the value by its
// factor. At most 5 rolls, and the player may cash out after any safe roll.
//
// Why every table is fair
// -----------------------
// Rolls are independent: P(total s) = ways(s)/36 with ways(s) = 6 - |s - 7|.
// Each table below satisfies, exactly in integers,
//
//     sum over s of ways(s) * f[s] = 3600      (hundredths, 36 x 100),
//
// so the expected factor of one roll is exactly 1. The round starts at
// RTP = 0.99 and each safe roll multiplies the value by its factor, so the
// value is a martingale started at 0.99: by optional stopping every rule
// (fixed rolls, a target, any cash-out time) returns exactly 99%. The edge is
// applied once, never per roll.
//
// Max win: the natural maximum is 0.99 x 18^5 (five Master edge rolls). A roll
// is refused if its best tile could pass MAX_WIN; that never binds for 5 rolls,
// but keeps the stopping-rule cap of the contract in place.

import type { Rng, Volatility } from '@originals/game-sdk';

export const RTP = 0.99;
export const TILES = 12;
export const MAX_ROLLS = 5;
export const MAX_WIN = 2_000_000;

export const DIFFICULTIES = ['easy', 'medium', 'hard', 'expert', 'master'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert', master: 'Master' };

/**
 * Factors in hundredths for dice totals 2, 3, 4, 5, 6, 7 (0 = pit). The table
 * is symmetric: total s and total 14 - s hold the same thing.
 */
export const TABLES: Record<Difficulty, readonly number[]> = {
  easy: [200, 130, 120, 110, 108, 0],
  medium: [400, 220, 160, 120, 0, 0],
  hard: [750, 300, 150, 0, 0, 0],
  expert: [1000, 400, 0, 0, 0, 0],
  master: [1800, 0, 0, 0, 0, 0],
};

export const VOLATILITY_OF: Record<Difficulty, Volatility> = { easy: 'low', medium: 'medium', hard: 'high', expert: 'extreme', master: 'extreme' };

/** Ways (of 36) two dice make total s. */
export const ways = (s: number) => (s >= 2 && s <= 12 ? 6 - Math.abs(s - 7) : 0);

/** The factor of dice total s (0 for a pit). */
export const factorFor = (d: Difficulty, s: number) => TABLES[d][Math.min(s, 14 - s) - 2] / 100;
export const isPit = (d: Difficulty, s: number) => factorFor(d, s) === 0;

/** Tile index (1-11) of dice total s; tile 0 is Start and is never landed on. */
export const tileOf = (s: number) => s - 1;

/** Factor of tile j (Start, tile 0, has none). */
export const factorAt = (d: Difficulty, j: number) => (j === 0 ? 1 : factorFor(d, j + 1));

/** Pits among the 11 tiles. */
export const pitCount = (d: Difficulty) => TABLES[d].filter((v) => v === 0).length * 2 - (TABLES[d][5] === 0 ? 1 : 0);

/** Multiplier tiles among the 11. */
export const multiplierCount = (d: Difficulty) => 11 - pitCount(d);

/** Ways (of 36) that one roll is safe. */
export const safeWays = (d: Difficulty) => {
  let w = 0;
  for (let s = 2; s <= 12; s++) if (!isPit(d, s)) w += ways(s);
  return w;
};

/** Chance one roll hits a pit. */
export const pitChance = (d: Difficulty) => 1 - safeWays(d) / 36;

/** Exact expected factor of one roll, in hundredths x 36 (3600 on every table). */
export const weightedSum = (d: Difficulty) => {
  let t = 0;
  for (let s = 2; s <= 12; s++) t += ways(s) * factorFor(d, s) * 100;
  return Math.round(t);
};

/** The best factor on the board. */
export const maxFactor = (d: Difficulty) => Math.max(...TABLES[d]) / 100;

/** Chance to survive n rolls in a row. */
export const survival = (d: Difficulty, n: number) => (safeWays(d) / 36) ** n;

/** Whether a roll may be offered at this value: its best tile must stay within MAX_WIN. */
export const canRoll = (d: Difficulty, cash: number) => cash * maxFactor(d) <= MAX_WIN;

export interface Roll {
  dice: [number, number];
  sum: number;
  /** Tile index landed on (sum - 1). */
  to: number;
  factor: number;
  pit: boolean;
  /** The value after the roll (0 on a pit). */
  cash: number;
}

/** Resolves one roll of dice (a, b) at value `cash`. */
export function resolveRoll(d: Difficulty, cash: number, a: number, b: number): Roll {
  const sum = a + b;
  const factor = factorFor(d, sum);
  return { dice: [a, b], sum, to: tileOf(sum), factor, pit: factor === 0, cash: cash * factor };
}

/** Draws two dice from the host RNG. */
export const drawDice = (rng: Rng): [number, number] => [1 + rng.int(6), 1 + rng.int(6)];

/** An auto/strategy rule: stop after `rolls` rolls (at most 5), or once the value reaches `target` (0 = off). */
export interface StopRule {
  rolls: number;
  target: number;
}

export type StopReason = 'rolls' | 'target' | 'max';

/** Why a round at this value after `done` rolls stops under the rule, or null to keep rolling. */
export function stopReason(d: Difficulty, cash: number, done: number, rule: StopRule): StopReason | null {
  if (done >= Math.min(rule.rolls, MAX_ROLLS)) return 'rolls';
  if (done > 0 && rule.target > 0 && cash >= rule.target - 1e-9) return 'target';
  if (!canRoll(d, cash)) return 'max';
  return null;
}

/** The exact value of a stop rule by enumerating every dice outcome (36 branches per roll). Is RTP for every rule. */
export function exactRuleValue(d: Difficulty, rule: StopRule): number {
  const go = (cash: number, done: number): number => {
    if (stopReason(d, cash, done, rule)) return cash;
    let e = 0;
    for (let a = 1; a <= 6; a++)
      for (let b = 1; b <= 6; b++) {
        const r = resolveRoll(d, cash, a, b);
        if (!r.pit) e += go(r.cash, done + 1) / 36;
      }
    return e;
  };
  return go(RTP, 0);
}

/** The highest value a round can reach: five edge rolls at the best factor. */
export const MAX_MULTIPLIER = 1_870_672.32; // RTP x 18^5

/** Grid cell (column, row) of tile j on a 4x4 frame, clockwise from the top-left (tile 0 = Start). */
export const CELL: readonly (readonly [number, number])[] = [
  [0, 0], [1, 0], [2, 0], [3, 0],
  [3, 1], [3, 2], [3, 3],
  [2, 3], [1, 3], [0, 3],
  [0, 2], [0, 1],
];
