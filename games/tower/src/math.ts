// Tower (the Dragon Tower / Towers / Tower Legend format): a tower of 9 rows,
// each with t tiles of which s are safe and t − s are traps. The player climbs
// from the bottom row, picking one tile per row; a safe tile lifts them a row,
// a trap ends the round and loses the stake. Cash out any time after row 1;
// clearing row 9 (the summit) pays out by itself.
//
// Difficulty (tiles, safe):  Easy (4, 3) · Medium (3, 2) · Hard (2, 1)
//                            Expert (3, 1) · Master (4, 1)
//
// Every row's safe set is a uniformly random s-subset of its t tiles, drawn
// independently per row when the bet is placed. So whichever tile is picked,
// it is safe with probability exactly
//
//     p = s / t,
//
// independent of the column, the pattern and every earlier row. Reaching row k
// (k safe picks in a row) has probability p^k, and the cash-out after k rows is
//
//     M(k) = RTP / p^k = 0.99 · (t / s)^k.
//
// Pricing is a per-step fair factor: surviving a row multiplies the cash-out by
// 1 / p, exactly the inverse of the chance of surviving it. The cash-out is a
// martingale starting at M(0) = RTP = 0.99, so by optional stopping every
// strategy (when to cash out, which tiles, any auto pattern or target row)
// returns exactly 99%. Fixed targets show it directly: p^k · M(k) = 0.99.
//
// Exact paytables (summit = row 9):
//   Easy    p = 3/4   M(9) = 0.99 · (4/3)^9 =      13.1832…×
//   Medium  p = 2/3   M(9) = 0.99 · 1.5^9   =      38.0570…×
//   Hard    p = 1/2   M(9) = 0.99 · 2^9     =     506.88×
//   Expert  p = 1/3   M(9) = 0.99 · 3^9     =  19,486.17×
//   Master  p = 1/4   M(9) = 0.99 · 4^9     = 259,522.56×   (the honest max)

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;
export const ROWS = 9;

export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert' | 'master';

export interface DifficultySpec {
  label: string;
  tiles: number;
  safe: number;
}

export const DIFFICULTY: Record<Difficulty, DifficultySpec> = {
  easy: { label: 'Easy', tiles: 4, safe: 3 },
  medium: { label: 'Medium', tiles: 3, safe: 2 },
  hard: { label: 'Hard', tiles: 2, safe: 1 },
  expert: { label: 'Expert', tiles: 3, safe: 1 },
  master: { label: 'Master', tiles: 4, safe: 1 },
};

export const DIFFICULTIES = Object.keys(DIFFICULTY) as Difficulty[];

/** Chance a picked tile is safe: s / t, the same for every tile and every row. */
export const rowSafe = (d: Difficulty) => DIFFICULTY[d].safe / DIFFICULTY[d].tiles;

/** Chance of clearing the first k rows: (s / t)^k. */
export const reachChance = (d: Difficulty, k: number) => rowSafe(d) ** k;

/** Cash-out after k cleared rows: RTP · (t / s)^k (k = 0 is the stake's fair value). */
export const multiplier = (d: Difficulty, k: number) => RTP * (DIFFICULTY[d].tiles / DIFFICULTY[d].safe) ** k;

/** The cash-out after one more safe row (the per-step fair factor). */
export const afterSafe = (cash: number, d: Difficulty) => (cash * DIFFICULTY[d].tiles) / DIFFICULTY[d].safe;

/** Clearing the summit (row 9) pays this. */
export const summit = (d: Difficulty) => multiplier(d, ROWS);

/** Largest payout under any setting: Master summit, 0.99 · 4^9. */
export const MAX_MULTIPLIER = Math.max(...DIFFICULTIES.map(summit));

export function volatilityOf(d: Difficulty): Volatility {
  return d === 'easy' ? 'low' : d === 'medium' ? 'medium' : d === 'hard' ? 'high' : 'extreme';
}

/** A tower: rows[r][c] is true when tile c of row r (row 0 at the bottom) is safe. */
export type Tower = boolean[][];

/** Builds the tower: each row's safe tiles are a uniformly random s-subset, independently per row. */
export function buildTower(d: Difficulty, shuffle: <T>(items: readonly T[]) => T[]): Tower {
  const { tiles, safe } = DIFFICULTY[d];
  return Array.from({ length: ROWS }, () => {
    const order = shuffle(Array.from({ length: tiles }, (_, i) => i));
    const row = new Array<boolean>(tiles).fill(false);
    for (let i = 0; i < safe; i++) row[order[i]] = true;
    return row;
  });
}

// ---------- Auto patterns ----------

export type Pattern = 'random' | 'left' | 'right' | 'zigzag' | 'custom';

export const PATTERNS: { value: Pattern; label: string }[] = [
  { value: 'random', label: 'Random' },
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
  { value: 'zigzag', label: 'Zigzag' },
  { value: 'custom', label: 'Custom' },
];

/**
 * The column picked in each of the first `target` rows. Random draws a fresh
 * column per row (from `int`, independent of the tower); Custom uses the
 * player's own columns, clamped to the row width.
 */
export function patternColumns(pattern: Pattern, d: Difficulty, target: number, custom: readonly number[], int: (n: number) => number): number[] {
  const t = DIFFICULTY[d].tiles;
  return Array.from({ length: target }, (_, r) => {
    switch (pattern) {
      case 'left':
        return 0;
      case 'right':
        return t - 1;
      case 'zigzag':
        return r % 2 === 0 ? 0 : t - 1;
      case 'custom':
        return Math.min(t - 1, Math.max(0, custom[r] ?? 0));
      default:
        return int(t);
    }
  });
}

export interface ClimbResult {
  /** The columns picked, row by row, ending at the trap if one was hit. */
  picks: number[];
  /** The row whose trap ended the round, or null if every pick was safe. */
  bust: number | null;
  /** M(picks) when every pick was safe, else 0. */
  multiplier: number;
}

/** One auto bet: climb with the preset columns, stopping at the first trap. */
export function climb(tower: Tower, d: Difficulty, columns: readonly number[]): ClimbResult {
  const picks: number[] = [];
  for (let r = 0; r < columns.length; r++) {
    picks.push(columns[r]);
    if (!tower[r][columns[r]]) return { picks, bust: r, multiplier: 0 };
  }
  return { picks, bust: null, multiplier: multiplier(d, columns.length) };
}
