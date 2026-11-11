// Break Point: a tennis game as a race of points. You back the returner. The
// server wins each point with the spinner's red share p, you with the green
// share q = 1 - p, independently. You win the game by reaching four points
// and leading by two; otherwise the server wins it. At level scores the game
// can loop (deuce) for as long as the points keep splitting.
//
// Exact odds. A state is (r, s) = your points, the server's points. Once both
// have three or more only the lead matters, so (r, s) is shifted down to a
// smallest equivalent state (min = 2) with the same win chance. From level
// (2, 2) you win with the geometric-tail chance
//   D = q^2 / (q^2 + p^2),
// since the first two points are won by the same side with q^2 + p^2 and
// they are yours with q^2 (a split returns to level). Every other state
// follows by the one-point recursion W(r,s) = q W(r+1,s) + p W(r,s+1).
//
// "Needs" is the fewest points a side must still win: max(4 - own, other + 2
// - own). It is the literal count the board draws. The win chance is a
// function of the two needs alone, and a point you win lowers your need by
// one (and, inside the deuce zone, raises the server's by one).
//
// Pricing (fixed prize, contract pattern 1). The prize is RTP / P(you win the
// game from 0-0) and the cash-out is prize * P(you win | points so far), a
// martingale in the points, so every stopping rule returns exactly RTP.
// The knob (the server's share) changes the prize and the volatility, never
// the expected return.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;
/** Points to win the game, before the lead rule. */
export const TARGET = 4;
/** The server's share of points the player can pick. */
export const SHARES = [0.5, 0.6, 0.65, 0.7, 0.75, 0.8, 0.82] as const;
export type Share = (typeof SHARES)[number];

/** Points so far: r = yours (the returner), s = the server's. */
export interface Score {
  r: number;
  s: number;
}
export const EMPTY: Score = { r: 0, s: 0 };

export const addPoint = (x: Score, you: boolean): Score => (you ? { r: x.r + 1, s: x.s } : { r: x.r, s: x.s + 1 });

/** Who has won the game, once it is decided. */
export function winner(x: Score): 'you' | 'server' | null {
  if (x.r >= TARGET && x.r - x.s >= 2) return 'you';
  if (x.s >= TARGET && x.s - x.r >= 2) return 'server';
  return null;
}

/** The fewest points you still have to win to take the game. */
export const needYou = (x: Score) => Math.max(0, TARGET - x.r, x.s + 2 - x.r);
/** The fewest points the server still has to win. */
export const needServer = (x: Score) => Math.max(0, TARGET - x.s, x.r + 2 - x.s);

/** Your chance to win the game from this score, when the server wins each point with `p`. */
export function winChance(x: Score, p: number): number {
  const q = 1 - p;
  const w = winner(x);
  if (w) return w === 'you' ? 1 : 0;
  const m = Math.min(x.r, x.s);
  if (m >= 3) return winChance({ r: x.r - (m - 2), s: x.s - (m - 2) }, p);
  if (x.r === 2 && x.s === 2) return (q * q) / (q * q + p * p);
  return q * winChance({ r: x.r + 1, s: x.s }, p) + p * winChance({ r: x.r, s: x.s + 1 }, p);
}

/** Your chance if you win the next point, and if you lose it (q * up + p * down = chance now). */
export function forecast(x: Score, p: number) {
  return { ifYou: winChance(addPoint(x, true), p), ifServer: winChance(addPoint(x, false), p) };
}

export const prizeFor = (p: number) => RTP / winChance(EMPTY, p);

/** The point spinner: green (yours) is [0, q), red (the server's) the rest. Ties: [lo, hi). */
export const isYours = (u: number, p: number) => u < 1 - p;

/** The volatility of backing the returner at server share p, from your chance. */
export function volatilityOf(p: number): Volatility {
  const w = winChance(EMPTY, p);
  return w > 0.4 ? 'low' : w > 0.15 ? 'medium' : w > 0.04 ? 'high' : 'extreme';
}

export const VOLATILITY: Record<Volatility, { p: Share }> = {
  low: { p: 0.5 },
  medium: { p: 0.6 },
  high: { p: 0.7 },
  extreme: { p: 0.82 },
};

/** Auto cash-out targets (× stake); null = play to the end. */
export const CASH_AT = [null, 1.5, 2, 3, 5] as const;
export type CashAt = (typeof CASH_AT)[number];

export interface AutoResult {
  /** The score after every point, in order. */
  states: Score[];
  multiplier: number;
  outcome: 'win' | 'lose' | 'cashed';
}

/** One whole Auto round: spin until the game is decided, or cash out once the cash-out reaches `cashAt`. */
export function autoRound(p: number, cashAt: CashAt, u: () => number): AutoResult {
  const prize = prizeFor(p);
  let x = EMPTY;
  const states: Score[] = [];
  for (;;) {
    x = addPoint(x, isYours(u(), p));
    states.push(x);
    const w = winner(x);
    if (w) return { states, multiplier: w === 'you' ? prize : 0, outcome: w === 'you' ? 'win' : 'lose' };
    const cash = prize * winChance(x, p);
    if (cashAt !== null && cash >= cashAt) return { states, multiplier: cash, outcome: 'cashed' };
  }
}

/** Every payout is at most its prize, and the largest prize is the steepest share's. */
export const MAX_MULTIPLIER = Math.max(...SHARES.map(prizeFor));
