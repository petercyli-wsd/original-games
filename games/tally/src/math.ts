// Tally: balls drop one at a time onto a floor of five bins whose widths are
// 40%, 30%, 15%, 10% and 5% of the floor. Each ball lands at a uniform point,
// so it falls into bin j with chance equal to bin j's width, and that bin's
// stack grows by one block. The first bin to stack HEIGHT = 3 blocks wins the
// race; you back one bin.
//
// The theorem: a race of Gamma clocks (Poissonization). Run the balls as a
// Poisson process of rate 1 in continuous time; by the thinning theorem bin j
// then receives its own independent Poisson stream of rate pⱼ, and the order of
// arrivals is exactly the ball sequence. Bin j needs rⱼ = 3 − cⱼ more balls, so
// it finishes at Tⱼ ~ Gamma(rⱼ, pⱼ), and
//     P(i first | stacks) = ∫ fᵢ(t) · Πⱼ≠ᵢ P(Poisson(pⱼt) < rⱼ) dt,
// a finite sum because Σ pⱼ = 1 (each term is a polynomial times e^(−t), and
// ∫ tⁿ e^(−t) dt = n!). poissonFirst() evaluates it; the tests check it
// against the DP below.
//
// The game uses the one-ball recursion over stack heights (3⁵ = 243 states):
//     P(i first | c) = Σⱼ pⱼ · ( cⱼ + 1 = 3 ? [j = i] : P(i first | c + eⱼ) ).
// The widths are whole twentieths (8, 6, 3, 2, 1) and a round lasts at most 11
// balls (all five at 2, then one more), so with n balls down every chance is
// an exact fraction N / 20^(11 − n). We run the recursion on the integer
// numerators N; all of them stay below 20¹¹·8 < 2⁵³, so the doubles hold them
// exactly and no rounding happens until the final division.
//
// The recursion is the martingale step: weighting each bin's "what if the
// next ball lands here" odds by its width averages back to the odds now.
//
// Pricing (fixed prize): prize = RTP / P(your bin first at the start) and
//     cash-out = prize · P(your bin first | stacks),
// a martingale starting at RTP, so every stopping rule returns exactly RTP.
//
// Switching (fair): at a checkpoint you may back another bin. The cash-out c
// is kept and the prize relocks at c / P(new bin first), changing risk, never
// value. A switch whose prize would exceed MAX_WIN is refused (refusing an
// EV-neutral choice changes nothing), so no payout can exceed MAX_WIN.
//
// Tie rule: a ball draws u = rng.next() in [0, 1) and lands at x = u along the
// floor; it falls into bin j iff cumⱼ ≤ 20u < cumⱼ + wⱼ (bins left to right).

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

/** Blocks a bin must stack to win the race. */
export const HEIGHT = 3;

/** Bin widths in twentieths of the floor, left to right. */
export const WIDTHS = [8, 6, 3, 2, 1] as const;
export const UNITS = 20;
export const BINS = WIDTHS.length;
/** Bin widths as shares of the floor: the chance a ball lands in each. */
export const SHARE = WIDTHS.map((w) => w / UNITS);
/** "40%", "30%", … */
export const BIN_NAME = WIDTHS.map((w) => `${(w / UNITS) * 100}%`);

/** Most balls a round can take: every bin at HEIGHT − 1, then one more. */
export const MAX_BALLS = BINS * (HEIGHT - 1) + 1;

/** No prize (including one relocked by a switch) may exceed this. */
export const MAX_WIN = 250;
export const MAX_MULTIPLIER = MAX_WIN;

export type Stacks = readonly number[];

export const emptyStacks = (): number[] => new Array<number>(BINS).fill(0);
export const balls = (c: Stacks) => c.reduce((a, b) => a + b, 0);
/** The bin that has reached HEIGHT, if any. */
export const finished = (c: Stacks) => c.findIndex((x) => x >= HEIGHT);

const keyOf = (c: Stacks) => c.reduce((k, x) => k * HEIGHT + x, 0);

/** 20^(MAX_BALLS − n): the common denominator of every chance with n balls down. */
export const denominator = (c: Stacks) => UNITS ** (MAX_BALLS - balls(c));

const numCache = new Map<number, Float64Array>();

/**
 * Integer numerators N(i | c) with P(i first | c) = N(i | c) / denominator(c),
 * for a live state (no bin at HEIGHT yet). Σᵢ N(i | c) = denominator(c).
 */
export function firstNumerators(c: Stacks): Float64Array {
  const key = keyOf(c);
  const hit = numCache.get(key);
  if (hit) return hit;
  const out = new Float64Array(BINS);
  const subDen = denominator(c) / UNITS;
  for (let j = 0; j < BINS; j++) {
    if (c[j] + 1 >= HEIGHT) out[j] += WIDTHS[j] * subDen;
    else {
      const next = c.slice();
      next[j]++;
      const sub = firstNumerators(next);
      for (let i = 0; i < BINS; i++) out[i] += WIDTHS[j] * sub[i];
    }
  }
  numCache.set(key, out);
  return out;
}

/** P(bin i is first to HEIGHT | stacks), for every bin. Sums to 1. A finished state is 1 for the winner. */
export function firstChances(c: Stacks): number[] {
  const done = finished(c);
  if (done >= 0) return c.map((_, i) => (i === done ? 1 : 0));
  const den = denominator(c);
  return Array.from(firstNumerators(c), (n) => n / den);
}

export const winChance = (c: Stacks, mine: number) => firstChances(c)[mine];

/**
 * The same chance from the Poisson race of Gamma clocks (see the header): an
 * independent closed form, used by the tests.
 */
export function poissonFirst(c: Stacks, i: number): number {
  const fact = (n: number) => {
    let f = 1;
    for (let k = 2; k <= n; k++) f *= k;
    return f;
  };
  // Polynomial in t (coefficients by power) multiplying e^(−t).
  const ri = HEIGHT - c[i];
  let poly = new Array<number>(ri).fill(0);
  poly[ri - 1] = SHARE[i] ** ri / fact(ri - 1);
  for (let j = 0; j < BINS; j++) {
    if (j === i) continue;
    const rj = HEIGHT - c[j];
    const surv = Array.from({ length: rj }, (_, k) => SHARE[j] ** k / fact(k));
    const next = new Array<number>(poly.length + rj - 1).fill(0);
    poly.forEach((a, x) => surv.forEach((b, y) => (next[x + y] += a * b)));
    poly = next;
  }
  return poly.reduce((s, a, n) => s + a * fact(n), 0);
}

/** Which bin a ball with uniform u ∈ [0, 1) falls into, left to right. */
export function landing(u: number): number {
  const x = u * UNITS;
  let cum = 0;
  for (let j = 0; j < BINS; j++) {
    if (x < cum + WIDTHS[j]) return j;
    cum += WIDTHS[j];
  }
  return BINS - 1; // u·20 rounding up to 20
}

/** Left edge of each bin as a share of the floor. */
export const BIN_LEFT = WIDTHS.map((_, j) => WIDTHS.slice(0, j).reduce((a, b) => a + b, 0) / UNITS);

export interface Ghost {
  bin: number;
  /** Chance the next ball lands here: the bin's width. */
  prob: number;
  /** Your chance to win if it does (1 if it completes your stack, 0 if it completes a rival's). */
  win: number;
}

/** Every landing of the next ball and the odds it would leave you. Σ prob·win = winChance now. */
export function ghosts(c: Stacks, mine: number): Ghost[] {
  return SHARE.map((prob, j) => {
    const next = c.slice();
    next[j]++;
    return { bin: j, prob, win: winChance(next, mine) };
  });
}

/** The fixed prize for a fresh bet on `mine`. */
export const startPrize = (mine: number) => RTP / winChance(emptyStacks(), mine);

/** The prize after switching to `mine` at a checkpoint, keeping the cash-out `cash`. Null if it would exceed MAX_WIN. */
export function relock(cash: number, c: Stacks, mine: number): number | null {
  if (finished(c) >= 0) return null;
  const p = winChance(c, mine);
  if (!(p > 0)) return null;
  const prize = cash / p;
  return prize > MAX_WIN ? null : prize;
}

export function volatilityOf(p: number): Volatility {
  return p > 0.4 ? 'low' : p > 0.15 ? 'medium' : p > 0.02 ? 'high' : 'extreme';
}
