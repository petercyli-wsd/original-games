// Bayes: a coin is drawn in secret, Gold with prior chance π, else Silver.
// The two coins are mirror images: Gold lands heads with chance p, Silver
// with chance 1 − p. The player backs one coin, watches up to n flips one at
// a time, and at every checkpoint can cash out, flip again, or reveal the
// coin. After the last flip the coin is revealed.
//
// The theorem (Bayes' rule). After h heads and t tails
//
//   P(Gold | flips) = π pʰ(1−p)ᵗ / (π pʰ(1−p)ᵗ + (1−π)(1−p)ʰpᵗ),
//
// or in odds: odds(Gold) = π/(1−π) · rᵈ, where r = p/(1−p) is the likelihood
// ratio of one flip and d = h − t is the evidence. A head multiplies the odds
// on Gold by r, a tail divides them by r, so only d matters.
//
// The posterior is a martingale. The next flip is heads with chance
// P(H) = P(G)·p + P(S)·(1−p), and by the law of total probability
// P(H)·P(G | H) + P(T)·P(G | T) = P(G·H) + P(G·T) = P(G).
//
// The picture (the Bayes box). A rectangle of area 1 is split into a Gold
// column of width P(G) and a Silver column of width P(S). When a flip lands,
// each column keeps the share of its height equal to the chance that coin
// would have shown that face (its likelihood) and the rest is ruled out. The
// surviving areas are P(G)·P(face | G) and P(S)·P(face | S); stretched back to
// the full height, their widths are the new posterior. That is Bayes' rule,
// area for area, and the backed coin's width is the win chance on screen.
//
// Pricing (fixed prize). Backing coin c pays prize = RTP / π_c if the coin is
// revealed as c. The cash-out in any state S is prize × P(c | S): the backed
// coin's share of the box. It starts at prize × π_c = RTP. A flip keeps its
// expectation (the martingale above), and revealing pays prize × 1[c], whose
// conditional expectation is again prize × P(c | S). So by optional stopping
// every rule for flipping, cashing out or revealing early returns exactly RTP.
// Holding to the reveal wins with the prior π_c, whatever the flips say.
//
// Bounds. Every payout is at most the prize of the rarest coin you can back:
// Gold at a 2% prior pays RTP / 0.02 = 49.5×. Cash-outs never exceed the prize,
// so maxMultiplier = 49.5 is an honest bound. Faces are discrete and p is
// strictly between 0 and 1, so no tie rule is needed and P(c | S) is never 0 or 1
// before the reveal.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

export type Coin = 'gold' | 'silver';
export const COINS: readonly Coin[] = ['gold', 'silver'];
export const COIN_NAME: Record<Coin, string> = { gold: 'Gold', silver: 'Silver' };
export const otherCoin = (c: Coin): Coin => (c === 'gold' ? 'silver' : 'gold');

export type Face = 'H' | 'T';

/** The prior chance that the drawn coin is Gold. Gold is the rare coin. */
export const PRIORS = [0.5, 0.25, 0.1, 0.02] as const;
export type Prior = (typeof PRIORS)[number];

/** How different the coins are. Gold lands heads with chance p, Silver with 1 − p. */
export const SEPARATIONS = ['subtle', 'clear', 'stark'] as const;
export type Separation = (typeof SEPARATIONS)[number];
export const HEADS_GOLD: Record<Separation, number> = { subtle: 0.55, clear: 0.7, stark: 0.85 };
export const SEP_LABEL: Record<Separation, string> = { subtle: 'Subtle', clear: 'Clear', stark: 'Stark' };

/** Flips shown before the coin is revealed. */
export const FLIPS = [5, 10, 20] as const;
export type Flips = (typeof FLIPS)[number];

export interface Settings {
  side: Coin;
  prior: Prior;
  sep: Separation;
  flips: Flips;
}

/** One preset per volatility level (the eval's configs). */
export const VOLATILITY: Record<Volatility, Settings> = {
  low: { side: 'silver', prior: 0.1, sep: 'clear', flips: 10 },
  medium: { side: 'gold', prior: 0.5, sep: 'clear', flips: 10 },
  high: { side: 'gold', prior: 0.1, sep: 'subtle', flips: 10 },
  extreme: { side: 'gold', prior: 0.02, sep: 'stark', flips: 20 },
};

/** The prior chance of a coin. */
export const priorOf = (coin: Coin, prior: number) => (coin === 'gold' ? prior : 1 - prior);

/** Headline win chance when holding to the reveal: the backed coin's prior. */
export const headlineChance = (side: Coin, prior: number) => priorOf(side, prior);

/** The full prize for backing `side`, paid if the coin is revealed as `side`. */
export const prize = (side: Coin, prior: number) => RTP / priorOf(side, prior);

/** P(face | coin): the chance that coin lands on that face. */
export function likelihood(face: Face, coin: Coin, sep: Separation): number {
  const p = HEADS_GOLD[sep];
  const heads = coin === 'gold' ? p : 1 - p;
  return face === 'H' ? heads : 1 - heads;
}

/** The likelihood ratio r = P(H | Gold) / P(H | Silver) = p / (1 − p). A tail has ratio 1/r. */
export const ratio = (sep: Separation) => HEADS_GOLD[sep] / (1 - HEADS_GOLD[sep]);

/** The evidence d = heads − tails. */
export const evidence = (faces: readonly Face[]) => faces.reduce((d, f) => d + (f === 'H' ? 1 : -1), 0);

/** Closed form: P(Gold | evidence d) = π rᵈ / (π rᵈ + 1 − π). */
export function posteriorGold(prior: number, sep: Separation, d: number): number {
  const r = ratio(sep);
  const g = prior * (d > 0 ? r ** d : 1);
  const s = (1 - prior) * (d < 0 ? r ** -d : 1);
  return g / (g + s);
}

/** One step of Bayes' rule: P(Gold) after seeing `face`. */
export function update(pGold: number, face: Face, sep: Separation): number {
  const g = pGold * likelihood(face, 'gold', sep);
  const s = (1 - pGold) * likelihood(face, 'silver', sep);
  return g / (g + s);
}

/** The predictive chance the next flip is heads. */
export const headsNext = (pGold: number, sep: Separation) => pGold * likelihood('H', 'gold', sep) + (1 - pGold) * likelihood('H', 'silver', sep);

/** The backed coin's posterior: the live win chance. */
export const winChance = (side: Coin, pGold: number) => (side === 'gold' ? pGold : 1 - pGold);

/** Fair cash-out: prize × P(backed coin | flips). */
export const cashOut = (side: Coin, prior: number, pGold: number) => prize(side, prior) * winChance(side, pGold);

/** Odds of Gold as "a : b", scaled so the smaller side reads 1. */
export function oddsText(pGold: number): string {
  if (pGold <= 0) return '0 : 1';
  if (pGold >= 1) return '1 : 0';
  const g = pGold;
  const s = 1 - pGold;
  const fmt = (x: number) => (x >= 100 ? Math.round(x).toLocaleString('en-US') : x >= 10 ? x.toFixed(1) : x.toFixed(2).replace(/\.?0+$/, ''));
  return g >= s ? `${fmt(g / s)} : 1` : `1 : ${fmt(s / g)}`;
}

export interface BoxColumn {
  coin: Coin;
  /** Left edge and width, as fractions of the box width. */
  x: number;
  width: number;
  /** Kept height, as a fraction of the box height (1 unless a face is cutting). */
  height: number;
}

/**
 * The Bayes box. Gold is the left column and Silver the right, with widths
 * P(Gold) and P(Silver). When `face` is given, each column keeps only the
 * share of its height that would have shown that face; the kept areas are
 * proportional to the posterior after the flip.
 */
export function bayesBox(pGold: number, sep: Separation, face: Face | null): { gold: BoxColumn; silver: BoxColumn } {
  return {
    gold: { coin: 'gold', x: 0, width: pGold, height: face ? likelihood(face, 'gold', sep) : 1 },
    silver: { coin: 'silver', x: pGold, width: 1 - pGold, height: face ? likelihood(face, 'silver', sep) : 1 },
  };
}

/** Volatility of a setting (holding to the reveal is a binary bet at the prior). */
export function volatilityOf(side: Coin, prior: number): Volatility {
  const p = priorOf(side, prior);
  return p >= 0.6 ? 'low' : p >= 0.2 ? 'medium' : p >= 0.05 ? 'high' : 'extreme';
}

/** The largest payout under any setting: the prize for the rarest backable coin. */
export const MAX_MULTIPLIER = Math.max(...PRIORS.flatMap((p) => COINS.map((c) => prize(c, p))));
