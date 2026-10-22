// Slide Rule: Benford's law, built one multiplication at a time.
//
// A round starts at 1 and multiplies k random factors (k = 1…6), each uniform
// on {2, …, 9}. You win if the final product's leading digit is one of the
// digits you backed (one digit, or several for a safer bet).
//
// The board is a circular slide rule. The dial is log-scaled: digit d owns the
// arc from log₁₀ d to log₁₀(d + 1) of a turn, and multiplying by f turns the
// cursor by log₁₀ f. So the cursor always sits at frac(log₁₀ product) (the
// log of the mantissa) and the leading digit is simply the sector it points
// into. Sums of independent log-factors wrap round the circle and spread out
// towards the uniform distribution, so the leading digit tends to Benford's
// law, P(d) = log₁₀(1 + 1/d): exactly the width of digit d's sector. With six
// factors every digit is already within 0.7 points of Benford.
//
// Exact odds. Let N_j(p) be how many of the 8^j factor sequences of length j
// multiply to p (a small table: 658 distinct products for j = 6). From a
// product c with j factors still to come,
//
//   P(win | c, j) = Σ_p N_j(p)·[lead(c·p) ∈ S] / 8^j.
//
// The numerator is an integer count and 8^j is a power of two, so the division
// is exact in floating point. Leading digits are read from the integer
// product, never from a logarithm, so no floating-point boundary is consulted.
// Tie rule: a product exactly on a sector line (20, 100, 3000…) belongs to the
// digit whose sector starts there (20 leads with 2, 100 with 1).
//
// Pricing (fixed prize). A full win pays prize = RTP / P(win | 1, k), and the
// cash-out at product c with j to go is prize × P(win | c, j). Splitting off
// the next factor, count(c, j) = Σ_f count(c·f, j − 1), so the cash-out is
// exactly the average of its 8 equally likely successors (the 8 landing dots
// on the board): a martingale that starts at RTP. By optional stopping every
// strategy, any cash-out rule at all, is worth exactly RTP. The round also
// ends by itself when P(win | c, j) reaches 0 (no remaining factors can rescue
// it) or 1 (every remaining path wins, so the prize is paid at once). Those
// are stopping rules too, so RTP is unchanged. The cash-out never exceeds the
// prize, so the largest payout is RTP over the smallest non-zero starting
// chance: 0.99 × 64 for a leading 9 after two factors (only 3 × 3 = 9).

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

/** Each multiplication uses one of these, uniformly at random. */
export const FACTORS = [2, 3, 4, 5, 6, 7, 8, 9] as const;
export const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

/** Number of factors in a round. */
export const LENGTHS = [1, 2, 3, 4, 5, 6] as const;
export type Length = (typeof LENGTHS)[number];

/** A set of leading digits, as a bit mask (bit d is digit d). */
export type DigitSet = number;

export const digitSet = (...digits: number[]): DigitSet => digits.reduce((m, d) => m | (1 << d), 0);
export const hasDigit = (s: DigitSet, d: number) => ((s >> d) & 1) === 1;
export const toggleDigit = (s: DigitSet, d: number): DigitSet => s ^ (1 << d);
export const digitsIn = (s: DigitSet): number[] => DIGITS.filter((d) => hasDigit(s, d));

/** "1", "1 or 2", "1, 2 or 3", "2–6". */
export function digitList(s: DigitSet): string {
  const ds = digitsIn(s);
  if (ds.length <= 1) return ds.join('');
  const run = ds.length >= 3 && ds[ds.length - 1] - ds[0] === ds.length - 1;
  if (run) return `${ds[0]}–${ds[ds.length - 1]}`;
  return `${ds.slice(0, -1).join(', ')} or ${ds[ds.length - 1]}`;
}

/** Leading digit of a positive integer. */
export function leadingDigit(n: number): number {
  let x = n;
  while (x >= 10) x = Math.floor(x / 10);
  return x;
}

/** Where a positive integer sits on the log dial: frac(log₁₀ n), as a fraction of a turn clockwise from the top. */
export function dialPosition(n: number): number {
  let scale = 1;
  while (n / scale >= 10) scale *= 10;
  return Math.log10(n / scale);
}

/** Digit d's sector on the dial runs from log₁₀ d to log₁₀(d + 1); its width is Benford's P(d). */
export const sectorStart = (d: number) => Math.log10(d);
export const benford = (d: number) => Math.log10(1 + 1 / d);

/** How far the cursor turns when the product is multiplied by f (a fraction of a turn). */
export const turnFor = (f: number) => Math.log10(f);

const tables: Map<number, number>[] = [new Map([[1, 1]])];

/** N_j: for each product p, how many of the 8^j factor sequences of length j multiply to p. */
export function productCounts(j: number): ReadonlyMap<number, number> {
  while (tables.length <= j) {
    const prev = tables[tables.length - 1];
    const next = new Map<number, number>();
    for (const [p, n] of prev) for (const f of FACTORS) next.set(p * f, (next.get(p * f) ?? 0) + n);
    tables.push(next);
  }
  return tables[j];
}

/** Number of equally likely factor sequences with j factors to go. */
export const sequences = (j: number) => 8 ** j;

const digitCache = new Map<number, readonly number[]>();

/**
 * counts[d] = how many of the 8^j sequences of the remaining factors leave the
 * product (now c) leading with digit d. Index 0 is unused. Cached by (c, j).
 */
export function digitCounts(c: number, j: number): readonly number[] {
  const key = c * 16 + j;
  const hit = digitCache.get(key);
  if (hit) return hit;
  const counts = new Array<number>(10).fill(0);
  for (const [p, n] of productCounts(j)) counts[leadingDigit(c * p)] += n;
  digitCache.set(key, counts);
  return counts;
}

/** The live chance of each final leading digit (index d): the bars round the dial. */
export function digitOdds(c: number, j: number): number[] {
  const total = sequences(j);
  return digitCounts(c, j).map((n) => n / total);
}

/** Of the 8^j remaining sequences, how many end on one of your digits. */
export function winCount(c: number, j: number, s: DigitSet): number {
  const counts = digitCounts(c, j);
  let n = 0;
  for (const d of DIGITS) if (hasDigit(s, d)) n += counts[d];
  return n;
}

/** Exact P(final product leads with a digit in s | product c now, j factors to go). */
export const winChance = (c: number, j: number, s: DigitSet) => winCount(c, j, s) / sequences(j);

/** The chance before the first factor. */
export const startChance = (s: DigitSet, k: Length) => winChance(1, k, s);

/** The fixed prize for a full win. */
export const prizeFor = (s: DigitSet, k: Length) => RTP / startChance(s, k);

/** Fair cash-out: prize × P(win | now). */
export const cashOut = (prize: number, c: number, j: number, s: DigitSet) => prize * winChance(c, j, s);

export interface Landing {
  factor: number;
  /** The product if this factor comes up. */
  product: number;
  /** Where the cursor would land, as a fraction of a turn. */
  at: number;
  digit: number;
  /** Your win chance if this factor comes up (the fill of its dot). */
  chance: number;
}

/**
 * The 8 equally likely places the next factor can send the cursor, with
 * c the product now and j the factors left including this one. Their chances
 * average to exactly winChance(c, j, s): the martingale, drawn.
 */
export const nextLandings = (c: number, j: number, s: DigitSet): Landing[] =>
  FACTORS.map((f) => ({
    factor: f,
    product: c * f,
    at: dialPosition(c * f),
    digit: leadingDigit(c * f),
    chance: winChance(c * f, j - 1, s),
  }));

/** Why these settings can't be bet, if they can't. */
export function blockReason(s: DigitSet, k: Length): string | undefined {
  if (s === 0) return 'Pick at least one digit';
  const p = startChance(s, k);
  if (p <= 0) return k === 1 ? 'One factor never leads with 1' : 'These digits can never lead';
  if (p >= 1) return 'Every product wins: drop a digit';
  return undefined;
}

export function volatilityOf(p: number): Volatility {
  return p >= 0.45 ? 'low' : p >= 0.15 ? 'medium' : p >= 0.05 ? 'high' : 'extreme';
}

/** Quick picks, one per volatility level (also the eval's configs). */
export const VOLATILITY: Record<Volatility, { digits: DigitSet; factors: Length }> = {
  low: { digits: digitSet(1, 2, 3, 4), factors: 4 },
  medium: { digits: digitSet(1), factors: 4 },
  high: { digits: digitSet(5), factors: 5 },
  extreme: { digits: digitSet(9), factors: 4 },
};

/** Smallest non-zero starting chance over every setting (a single digit; adding digits only raises it). */
export function smallestChance(): number {
  let min = 1;
  for (const k of LENGTHS) {
    const counts = digitCounts(1, k);
    for (const d of DIGITS) if (counts[d] > 0) min = Math.min(min, counts[d] / sequences(k));
  }
  return min;
}

/** No payout exceeds the prize, and no prize exceeds RTP / smallest chance (= 0.99 × 64). */
export const MAX_MULTIPLIER = RTP / smallestChance();
