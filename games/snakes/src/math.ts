// Snakes (Stake-style): a 12-square loop. Each roll of two dice moves the
// token forward by their sum; the square it lands on multiplies the value by
// its factor, or ends the round if it holds a snake. Cash out between rolls.
//
// Why every board here is fair, from every square
// -----------------------------------------------
// From square p a roll of sum s (2–12, chance (6 − |s − 7|)/36) lands on
// (p + s) mod 12. A board of factors f is fair when, from every p,
//
//     Σ_s P(s) · f[(p + s) mod 12] = 1.                              (*)
//
// That is a circulant system. Its eigenvalues are the dice generating
// function at the 12th roots of unity, ((ω^k + … + ω^6k)/6)², which vanish
// exactly when ω^k is a non-trivial 6th root of unity (k = 2, 4, 6, 8, 10).
// So the solutions of (*) are precisely the boards with period 6 (opposite
// squares hold the same thing) whose six values average 1. Concretely: one
// die alone is uniform mod 6, so the sum of two dice is uniform mod 6, and
// from ANY square each pair of opposite squares is landed on exactly 1 time
// in 6. Every board below is a pattern of six values in hundredths summing
// to 600, repeated twice round the loop, with snakes (0) coming in opposite
// pairs. Each roll therefore has bust chance q = snake pairs / 6 and an
// expected factor of exactly 1.
//
// Pricing: the round starts at RTP = 0.99 and each roll multiplies the value
// by the landed factor. The cash-out is a martingale started at 0.99, so by
// optional stopping every rule (fixed rolls, target value, anything) returns
// exactly 99%. The RTP is applied once, never per roll.
//
// Max win: a roll is offered only if its best square keeps the value within
// MAX_WIN; otherwise the round cashes out by itself ("Max win"). That is a
// stopping rule, so the RTP is unchanged and MAX_WIN bounds every payout.

import type { Rng, Volatility } from '@originals/game-sdk';

export const RTP = 0.99;
export const SQUARES = 12;
export const MAX_WIN = 10_000;

export const DIFFICULTIES = ['easy', 'medium', 'hard', 'expert', 'master'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert', master: 'Master' };

/**
 * Six square values in hundredths (0 = snake). Square i holds PATTERN[i % 6],
 * so square 0 (Start) and square 6 share a value, and so on round the loop.
 * Each pattern sums to 600: the six values average exactly 1.
 */
export const PATTERNS: Record<Difficulty, readonly number[]> = {
  easy: [110, 130, 90, 150, 0, 120],
  medium: [120, 230, 0, 140, 0, 110],
  hard: [150, 0, 250, 0, 200, 0],
  expert: [200, 0, 0, 400, 0, 0],
  master: [600, 0, 0, 0, 0, 0],
};

export const VOLATILITY_OF: Record<Difficulty, Volatility> = { easy: 'low', medium: 'medium', hard: 'high', expert: 'extreme', master: 'extreme' };

/** The factor of square j (0 for a snake). */
export const factorAt = (d: Difficulty, j: number) => PATTERNS[d][((j % 6) + 6) % 6] / 100;
export const isSnake = (d: Difficulty, j: number) => factorAt(d, j) === 0;

/** Every square's factor, Start first, clockwise. */
export const board = (d: Difficulty) => Array.from({ length: SQUARES }, (_, j) => factorAt(d, j));

/** Snakes on the board (always an even number: they come in opposite pairs). */
export const snakeCount = (d: Difficulty) => board(d).filter((f) => f === 0).length;

/** The chance a roll lands on a snake, from any square: snake pairs / 6. */
export const snakeChance = (d: Difficulty) => PATTERNS[d].filter((v) => v === 0).length / 6;

/** The best factor on the board. */
export const maxFactor = (d: Difficulty) => Math.max(...PATTERNS[d]) / 100;

/** The safe factors, smallest first (one per opposite pair). */
export const safeFactors = (d: Difficulty) => PATTERNS[d].filter((v) => v > 0).map((v) => v / 100).sort((a, b) => a - b);

/** Ways (of 36) two dice make sum s. */
export const ways = (s: number) => (s >= 2 && s <= 12 ? 6 - Math.abs(s - 7) : 0);

/** Steps from square p forward to square j: 1–12 (landing on p itself takes a 12). */
export const stepsTo = (p: number, j: number) => ((((j - p) % SQUARES) + SQUARES) % SQUARES) || SQUARES;

/** Ways (of 36) to land on square j from square p. Opposite squares always total 6. */
export const landingWays = (p: number, j: number) => ways(stepsTo(p, j));

/** Chance to land on square j from square p. */
export const landingChance = (p: number, j: number) => landingWays(p, j) / 36;

/** Chance of a snake on the next roll from square p, read off the board (equals snakeChance). */
export const snakeChanceFrom = (d: Difficulty, p: number) => board(d).reduce((acc, f, j) => acc + (f === 0 ? landingChance(p, j) : 0), 0);

/** Expected factor of the next roll from square p (exactly 1 on every board). */
export const expectedFactorFrom = (d: Difficulty, p: number) => board(d).reduce((acc, f, j) => acc + f * landingChance(p, j), 0);

/** Whether a roll may be offered at this value: its best square must stay within MAX_WIN. */
export const canRoll = (d: Difficulty, cash: number) => cash * maxFactor(d) <= MAX_WIN;

export interface Roll {
  dice: [number, number];
  sum: number;
  from: number;
  to: number;
  factor: number;
  snake: boolean;
  /** The value after the roll (0 on a snake). */
  cash: number;
}

/** Resolves one roll of dice (a, b) from square `from` at value `cash`. */
export function resolveRoll(d: Difficulty, from: number, cash: number, a: number, b: number): Roll {
  const sum = a + b;
  const to = (from + sum) % SQUARES;
  const factor = factorAt(d, to);
  return { dice: [a, b], sum, from, to, factor, snake: factor === 0, cash: cash * factor };
}

/** Draws two dice from the host RNG. */
export const drawDice = (rng: Rng): [number, number] => [1 + rng.int(6), 1 + rng.int(6)];

/** Chance to survive n rolls in a row. */
export const survival = (d: Difficulty, n: number) => (1 - snakeChance(d)) ** n;

/** An auto/strategy rule: stop after `rolls` rolls, or once the value reaches `target` (0 = off). */
export interface StopRule {
  rolls: number;
  target: number;
}

export type StopReason = 'rolls' | 'target' | 'max';

/** Why a round at this value after `done` rolls stops under the rule, or null to keep rolling. */
export function stopReason(d: Difficulty, cash: number, done: number, rule: StopRule): StopReason | null {
  if (done >= rule.rolls) return 'rolls';
  if (done > 0 && rule.target > 0 && cash >= rule.target - 1e-9) return 'target';
  if (!canRoll(d, cash)) return 'max';
  return null;
}

/**
 * The exact value of a stop rule, by enumerating every dice outcome from the
 * actual squares (36 branches per roll). Should be RTP for every rule.
 */
export function exactRuleValue(d: Difficulty, rule: StopRule): number {
  const go = (p: number, cash: number, done: number): number => {
    if (stopReason(d, cash, done, rule)) return cash;
    let e = 0;
    for (let a = 1; a <= 6; a++)
      for (let b = 1; b <= 6; b++) {
        const r = resolveRoll(d, p, cash, a, b);
        if (!r.snake) e += go(r.to, r.cash, done + 1) / 36;
      }
    return e;
  };
  return go(0, RTP, 0);
}

/** The highest value a round can ever reach: rolls are refused past MAX_WIN. */
export const MAX_MULTIPLIER = MAX_WIN;

/** Grid cell (column, row) of square j on a 4×4 frame, clockwise from the top-left. */
export const CELL: readonly (readonly [number, number])[] = [
  [0, 0], [1, 0], [2, 0], [3, 0],
  [3, 1], [3, 2], [3, 3],
  [2, 3], [1, 3], [0, 3],
  [0, 2], [0, 1],
];
