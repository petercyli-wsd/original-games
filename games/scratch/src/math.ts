// Scratch: "reverse mines". A board of `cards` face-down cards hides exactly
// one winner, placed uniformly at random. The player has `goes` scratches.
//
//   Prize      M = RTP × cards / goes, paid when the winner is scratched.
//   Live odds  with g goes left and r unscratched cards, P(win) = g / r
//              (each miss just removes a card the winner was never behind,
//              so the winner is uniform over the r cards still covered).
//   Sell       remaining goes are worth M × g / r of the main bet.
//   Buy        one extra go adds 1 / r to the win chance, i.e. M / r of
//              value, and is priced at (M / r) / RTP = cards / (goes × r)
//              per unit of main bet. The prize never changes.
//
// Fairness: V = M × g / r is a martingale under scratching (a hit pays M with
// probability 1/r; a miss leaves M(g−1)/(r−1)), starts at M × goes / cards =
// RTP, and each purchase adds exactly RTP × its price. So for ANY strategy of
// scratching, selling and buying, E[payout] = RTP × E[total staked]. The tests
// check this by exact enumeration.

import { floor8, type Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

export const MIN_CARDS = 2;
export const MAX_CARDS = 100;

export type Mode = Volatility;

export interface Setup {
  cards: number;
  goes: number;
}

/** Odds of 1 in 2, 5, 12.5 and 50: each step up roughly doubles the std dev. */
export const PRESETS: Record<Mode, Setup> = {
  low: { cards: 8, goes: 4 },
  medium: { cards: 15, goes: 3 },
  high: { cards: 25, goes: 2 },
  extreme: { cards: 50, goes: 1 },
};

export const MODE_NAMES = Object.keys(PRESETS) as Mode[];

export const presetOf = (s: Setup): Mode | null =>
  MODE_NAMES.find((m) => PRESETS[m].cards === s.cards && PRESETS[m].goes === s.goes) ?? null;

/** Keeps a custom board legal: 2..100 cards and 1..cards−1 goes. */
export function clampSetup(cards: number, goes: number): Setup {
  const c = Math.min(MAX_CARDS, Math.max(MIN_CARDS, Math.round(cards) || MIN_CARDS));
  const g = Math.min(c - 1, Math.max(1, Math.round(goes) || 1));
  return { cards: c, goes: g };
}

/** The prize multiplier M, paid on the main bet when the winner is found. */
export const prizeMultiplier = ({ cards, goes }: Setup) => (RTP * cards) / goes;

/** P(win) holding g goes with r cards still covered. */
export const winChance = (g: number, r: number) => (r > 0 ? Math.min(1, g / r) : 0);

/** What selling g goes with r cards left pays, as a multiple of the main bet. */
export const sellMultiplier = (s: Setup, g: number, r: number) => prizeMultiplier(s) * winChance(g, r);

/** Fair price of one extra go with r cards left, as a multiple of the main bet. */
export const buyPriceMultiplier = ({ cards, goes }: Setup, r: number) => cards / (goes * r);

/** Buy price in currency, rounded down to 8 dp (never above the fair price). */
export const buyPrice = (s: Setup, bet: number, r: number) => floor8(bet * buyPriceMultiplier(s, r));

/**
 * A go can be bought only when it adds something: at least two cards left and
 * the goes don't already cover every remaining card.
 */
export const canBuyAt = (g: number, r: number) => r > 1 && g < r;

/** Largest multiplier of the main bet: M for 1 go of 100 cards. */
export const MAX_MULTIPLIER = RTP * MAX_CARDS;

/**
 * Columns for a board of n portrait (3:4) cards so the whole grid is close to
 * `targetAspect` (width / height) without leaving a ragged last row.
 */
export function gridColumns(n: number, targetAspect: number): number {
  let best = 1;
  let bestScore = Infinity;
  for (let c = 1; c <= n; c++) {
    const rows = Math.ceil(n / c);
    const aspect = (c * 3) / (rows * 4);
    const empty = c * rows - n;
    const score = Math.abs(Math.log(aspect / targetAspect)) + (empty / n) * 1.5;
    if (score < bestScore - 1e-9) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}
