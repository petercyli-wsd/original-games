// Card Duel: two face-up rows of numbered cards. Yours is 2, 4, 6, 8, 10; the
// house's is 1, 3, 5, ... up to 2n - 1. The front cards duel on a spinner: you
// win with a / (a + b), where a is your number and b the house's. The loser is
// out and the winner goes to the back of its row. You win the round when the
// house row is empty, and lose when yours is.
//
// Exact odds. Each duel is a race of exponential clocks (rate a against rate
// b), so which card of a pair wins does not depend on which pair is at the
// front: the chance to win the round depends only on WHICH cards are left, not
// on their order. We compute it by a DP over the two sets (bitmasks), always
// duelling the lowest card of each set:
//   W(S, H) = a/(a+b) W(S, H minus b) + b/(a+b) W(S minus a, H),
//   W(S, {}) = 1, W({}, H) = 0.
// The test suite checks the order independence over random orderings.
//
// The chance always moves the way the rows do: a win removes a house card
// (up), a loss removes one of yours (down), and the sum of each side's card
// numbers moves the same way on every duel (the board's strength bar).
//
// Pricing (fixed prize, contract pattern 1). prize = RTP / W(all cards) and the
// cash-out is prize * W(cards left), a martingale over the duels, so every
// stopping rule returns exactly RTP. The knob (the house row's size n) changes
// the prize and the volatility, never the expected return.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;
export const YOURS = [2, 4, 6, 8, 10] as const;
/** House row sizes the player can pick. */
export const SIZES = [3, 5, 8, 10] as const;
export type Size = (typeof SIZES)[number];
const MAX_N = 10;

/** The two queues, front card first. */
export interface Cards {
  y: number[];
  h: number[];
}

export const houseRow = (n: number): number[] => Array.from({ length: n }, (_, j) => 2 * j + 1);
export const start = (n: number): Cards => ({ y: [...YOURS], h: houseRow(n) });
export const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);

const yBit = (v: number) => 1 << (v / 2 - 1);
const hBit = (v: number) => 1 << ((v - 1) / 2);
const mask = (a: number[], bit: (v: number) => number) => a.reduce((m, v) => m | bit(v), 0);

const memo = new Float64Array((1 << 5) * (1 << MAX_N)).fill(-1);

function wMask(ym: number, hm: number): number {
  if (hm === 0) return 1;
  if (ym === 0) return 0;
  const k = ym * (1 << MAX_N) + hm;
  if (memo[k] >= 0) return memo[k];
  const yi = 31 - Math.clz32(ym & -ym);
  const hi = 31 - Math.clz32(hm & -hm);
  const a = 2 * (yi + 1);
  const b = 2 * hi + 1;
  const v = (a / (a + b)) * wMask(ym, hm & ~(1 << hi)) + (b / (a + b)) * wMask(ym & ~(1 << yi), hm);
  memo[k] = v;
  return v;
}

/** The chance you knock out the whole house row from these cards. */
export const winChance = (c: Cards) => wMask(mask(c.y, yBit), mask(c.h, hBit));

/** The front duel's numbers: yours, the house's. */
export const front = (c: Cards) => ({ a: c.y[0], b: c.h[0] });
/** Your share of the duel spinner. */
export const duelShare = (a: number, b: number) => a / (a + b);
/** The duel spinner: green (yours) is [0, a/(a+b)). */
export const isYours = (u: number, a: number, b: number) => u < duelShare(a, b);

export function winner(c: Cards): 'you' | 'house' | null {
  if (c.h.length === 0) return 'you';
  if (c.y.length === 0) return 'house';
  return null;
}

/** After the front duel: the loser is out, the winner goes to the back. */
export function duel(c: Cards, you: boolean): Cards {
  const [a, ...ys] = c.y;
  const [b, ...hs] = c.h;
  return you ? { y: [...ys, a], h: hs } : { y: ys, h: [...hs, b] };
}

/** Your chance if you win the next duel, and if you lose it. */
export function forecast(c: Cards) {
  return { ifYou: winChance(duel(c, true)), ifHouse: winChance(duel(c, false)) };
}

export const prizeFor = (n: number) => RTP / winChance(start(n));

export function volatilityOf(n: number): Volatility {
  const w = winChance(start(n));
  return w > 0.7 ? 'low' : w > 0.3 ? 'medium' : w > 0.04 ? 'high' : 'extreme';
}

export const VOLATILITY: Record<Volatility, { n: Size }> = {
  low: { n: 3 },
  medium: { n: 5 },
  high: { n: 8 },
  extreme: { n: 10 },
};

/** Auto cash-out targets (x stake); null = play to the end. */
export const CASH_AT = [null, 1.5, 2, 3, 5] as const;
export type CashAt = (typeof CASH_AT)[number];

export interface AutoResult {
  /** The duel (who won, and the numbers) and the cards after it, in order. */
  steps: { you: boolean; a: number; b: number; u: number; after: Cards }[];
  multiplier: number;
  outcome: 'win' | 'lose' | 'cashed';
}

/** One whole Auto round: duel until the round is decided, or cash out once the cash-out reaches `cashAt`. */
export function autoRound(n: number, cashAt: CashAt, rnd: () => number): AutoResult {
  const prize = prizeFor(n);
  let c = start(n);
  const steps: AutoResult['steps'] = [];
  for (;;) {
    const { a, b } = front(c);
    const u = rnd();
    const you = isYours(u, a, b);
    c = duel(c, you);
    steps.push({ you, a, b, u, after: c });
    const w = winner(c);
    if (w) return { steps, multiplier: w === 'you' ? prize : 0, outcome: w === 'you' ? 'win' : 'lose' };
    const cash = prize * winChance(c);
    if (cashAt !== null && cash >= cashAt) return { steps, multiplier: cash, outcome: 'cashed' };
  }
}

/** Every payout is at most its prize, and the largest prize is the biggest house row's. */
export const MAX_MULTIPLIER = Math.max(...SIZES.map(prizeFor));
