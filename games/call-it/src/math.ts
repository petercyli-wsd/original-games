// Call It: a deck of r red and b black cards is turned over one card at a
// time. At a moment of your choosing you call "the next card is red".
//
// The theorem (the red-card martingale, Winkler): let n = r + b cards remain
// and p = r / n be the red share of what is left. Turning one card over moves
// p to (r − 1)/(n − 1) with chance r/n, or to r/(n − 1) with chance b/n, and
//
//   E[p after] = (r(r − 1) + b·r) / (n(n − 1)) = r(n − 1) / (n(n − 1)) = r / n.
//
// So p is a martingale, and calling at any stopping time wins with chance
// exactly p at the start: no timing rule beats (or loses to) calling at once.
//
// Pricing (fixed prize). The prize is locked at the bet: prize = RTP / p₀ =
// RTP·(r₀ + b₀)/r₀. Calling pays the prize with chance p, so its value is
// prize·p, which is also the cash-out. The cash-out is a bounded martingale
// that starts at RTP, so by optional stopping every mix of turning, calling
// and cashing out returns exactly RTP.
//
// The round also ends by itself: with no red cards left the call cannot win
// (cash-out 0); with no black cards left the call is certain (it pays the
// prize). That covers "the last card forces the call".
//
// RNG tie rule: a uniform u in [0, 1) deals a red card iff u < r / n, so the
// boundary value goes to black and P(red) = r / n exactly.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

export interface Deck {
  red: number;
  black: number;
}

/** The deck presets, safest first. */
export const DECKS: readonly Deck[] = [
  { red: 13, black: 13 },
  { red: 8, black: 16 },
  { red: 5, black: 20 },
  { red: 2, black: 23 },
  { red: 1, black: 49 },
];

export const deckKey = (d: Deck) => `${d.red}/${d.black}`;
export const deckByKey = (key: string): Deck => DECKS.find((d) => deckKey(d) === key) ?? DECKS[0];

export const VOLATILITY: Record<Volatility, Deck> = {
  low: DECKS[0],
  medium: DECKS[2],
  high: DECKS[3],
  extreme: DECKS[4],
};

export function volatilityOf(d: Deck): Volatility {
  const p = share(d.red, d.black);
  return p >= 0.5 ? 'low' : p >= 0.2 ? 'medium' : p >= 0.05 ? 'high' : 'extreme';
}

/** The red share of the cards left: the chance the next card is red. */
export const share = (red: number, black: number) => (red + black > 0 ? red / (red + black) : 0);

/** The prize, locked when the bet is placed. */
export const prizeFor = (d: Deck) => RTP / share(d.red, d.black);

/** Whether a uniform draw u ∈ [0, 1) deals a red card (ties go to black). */
export const dealsRed = (red: number, black: number, u: number) => u < share(red, black);

/** The cards left after one is turned over. */
export const afterTurn = (red: number, black: number, isRed: boolean): Deck =>
  isRed ? { red: red - 1, black } : { red, black: black - 1 };

/** Cash-out value as a multiple of the stake: prize × red share. */
export const cashOut = (prize: number, red: number, black: number) => prize * share(red, black);

/** Whether the round is already decided: no reds (lost) or only reds (the call is certain). */
export function settled(red: number, black: number): 'lost' | 'won' | null {
  if (red <= 0) return 'lost';
  if (black <= 0) return 'won';
  return null;
}

/**
 * The deck bar: the cards left, reds first, as segments of a bar of the given
 * width. Its red length divided by its total length is the red share.
 */
export function deckBar(red: number, black: number, width: number) {
  const n = red + black;
  const w = n > 0 ? width / n : 0;
  return {
    cell: w,
    redWidth: red * w,
    cells: Array.from({ length: n }, (_, i) => ({ x: i * w, red: i < red })),
  };
}

/**
 * Exact best (or worst) win chance over every calling strategy, by dynamic
 * programming over (red, black). Winkler's theorem says both equal r / n;
 * the tests check this, and it is never used for pricing.
 */
export function bestCallChance(red: number, black: number, mode: 'max' | 'min' = 'max'): number {
  const memo = new Map<string, number>();
  const pick = mode === 'max' ? Math.max : Math.min;
  const v = (r: number, b: number): number => {
    const s = settled(r, b);
    if (s) return s === 'won' ? 1 : 0;
    const k = `${r},${b}`;
    const hit = memo.get(k);
    if (hit !== undefined) return hit;
    const p = share(r, b);
    const out = pick(p, p * v(r - 1, b) + (1 - p) * v(r, b - 1));
    memo.set(k, out);
    return out;
  };
  return v(red, black);
}

/** Every payout is at most the largest locked prize (cash-outs are prize × a share ≤ 1). */
export const MAX_MULTIPLIER = Math.max(...DECKS.map(prizeFor));
