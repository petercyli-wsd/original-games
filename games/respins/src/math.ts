// Respins: a 5 x 3 grid of 15 cells, START coins already in it, and L respins
// (the player's one choice, 2 to 5). Every spin lands on one of the 15 cells,
// all equally likely:
//   - an empty cell takes a coin and the respins refill to L;
//   - a coin cell costs one respin; with none left, the round is lost.
// Win when TARGET (14) cells hold a coin. Only the NUMBER of coins matters, not
// where they sit, so the whole state is (c coins, l respins left).
//
// The win chance after every spin is exact, from the one-spin recursion the
// board shows (c of 15 cells are full, so the next spin is a coin with chance
// (15 - c) / 15):
//
//   P(TARGET, l) = 1,   P(c, 0) = 0 (c < TARGET),
//   P(c, l) = ((15 - c) / 15) * P(c + 1, L) + (c / 15) * P(c, l - 1).
//
// (Closed form: P(c, l) = (1 - (c/15)^l) * prod_{c' = c+1 .. TARGET-1} (1 - (c'/15)^L):
// one stage per coin still needed, and each stage fails only after l straight
// misses on a full cell; the tests check the two against each other.)
//
// Pricing (fixed prize). prize = RTP / P(START, L) is locked at the bet and the
// cash-out is prize * P(c, l). P is the conditional chance of one fixed event
// given everything spun so far, so it is a martingale: the recursion above is
// exactly E[P after one spin] = P now. By optional stopping every way of
// stopping returns exactly RTP. The largest payout is the largest prize.

import type { Rng, Volatility } from '@originals/game-sdk';

export const RTP = 0.99;
export const CELLS = 15;
export const TARGET = 14;
export const START = 5;
/** Respins on offer. L = 1 is deliberately not offered. */
export const RESPINS = [2, 3, 4, 5] as const;
export type Respins = (typeof RESPINS)[number];
export const DEFAULT_RESPINS: Respins = 4;

const tables = new Map<number, Float64Array>();
function table(L: number): Float64Array {
  let t = tables.get(L);
  if (t) return t;
  t = new Float64Array((TARGET + 1) * (L + 1));
  const at = (c: number, l: number) => c * (L + 1) + l;
  for (let l = 0; l <= L; l++) t[at(TARGET, l)] = 1;
  for (let c = TARGET - 1; c >= 0; c--) {
    t[at(c, 0)] = 0;
    // P(c, l) depends on P(c + 1, L) (done) and P(c, l - 1).
    for (let l = 1; l <= L; l++) t[at(c, l)] = ((CELLS - c) / CELLS) * t[at(c + 1, L)] + (c / CELLS) * t[at(c, l - 1)];
  }
  tables.set(L, t);
  return t;
}

/** Exact chance to reach TARGET coins from c coins with l respins left (budget L). */
export function winChance(c: number, l: number, L: number): number {
  if (c >= TARGET) return 1;
  if (l <= 0) return 0;
  return table(L)[c * (L + 1) + l];
}

/** The headline chance for a respin count: the start position. */
export const headline = (L: number) => winChance(START, L, L);
export const prizeFor = (L: number) => RTP / headline(L);
export const MAX_MULTIPLIER = Math.max(...RESPINS.map(prizeFor));

export const VOLATILITY: Record<Respins, Volatility> = { 2: 'extreme', 3: 'high', 4: 'medium', 5: 'low' };
export const volatilityOf = (L: Respins) => VOLATILITY[L];

/** START distinct random cells that hold a coin at the bet. */
export function startGrid(rng: Rng): boolean[] {
  const full = new Array<boolean>(CELLS).fill(false);
  let n = 0;
  while (n < START) {
    const i = rng.int(CELLS);
    if (!full[i]) {
      full[i] = true;
      n++;
    }
  }
  return full;
}

export const coinsOf = (full: readonly boolean[]) => full.reduce((a, b) => a + (b ? 1 : 0), 0);

export interface Spin {
  cell: number;
  /** The cell was empty: it takes a coin and the respins refill. */
  hit: boolean;
  coins: number;
  respins: number;
  /** TARGET coins reached. */
  won: boolean;
  /** A full cell with no respin left. */
  lost: boolean;
}

/** One spin: a uniform cell, then the new state. */
export function spin(full: readonly boolean[], l: number, L: number, rng: Rng): Spin {
  const cell = rng.int(CELLS);
  const hit = !full[cell];
  const coins = coinsOf(full) + (hit ? 1 : 0);
  const respins = hit ? L : l - 1;
  return { cell, hit, coins, respins, won: coins >= TARGET, lost: !hit && respins <= 0 };
}

/** The cash-out multiplier after a spin (prize at a win, 0 at a loss). */
export const cashAfter = (s: Pick<Spin, 'coins' | 'respins' | 'won' | 'lost'>, L: number) =>
  s.won ? prizeFor(L) : s.lost ? 0 : prizeFor(L) * winChance(s.coins, s.respins, L);
