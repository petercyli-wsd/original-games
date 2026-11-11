// Seven Out: roll two dice. Each total other than 7 lights up the first time
// it is rolled; a repeat of a lit total changes nothing; a 7 ends the round.
// Win if k different totals light before the first 7.
//
// The state is the set L of lit totals. With G = the ways (of the 36 dice
// pairs) that make a total not yet lit, the next roll that counts (a new total
// or a 7) is a new total t with chance w_t / (G + 6) and the 7 with chance
// 6 / (G + 6). Repeats are skipped: they change nothing, so
//
//   W(L) = 1                                  if |L| >= k
//   W(L) = sum over unlit t of w_t / (G + 6) * W(L + t)   otherwise,
//
// computed exactly (positive terms only) over the 2^10 lit sets. With one total
// left to make, W = G / (G + 6): the green cells over green plus red cells.
//
// Pricing (fixed prize). prize = RTP / W(empty) is locked at the bet and the
// cash-out is prize * W(L). W(L) is the conditional probability of one fixed
// event, so the cash-out is a martingale; a step (roll until something counts)
// is a stopping time of the roll sequence, so by optional stopping every
// cash-out rule returns exactly RTP. The cash-out never exceeds the prize, so
// the largest payout is the k = 10 prize (MAX_MULTIPLIER).

import type { Rng, Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

/** The ten totals that can light, in order. 7 is the losing total. */
export const TOTALS = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12] as const;
export const SEVEN_WAYS = 6;
/** Ways (of 36) to roll each total. */
export const waysOf = (t: number) => 6 - Math.abs(t - 7);

export const KS = [3, 4, 5, 6, 7, 8, 9, 10] as const;
export type K = (typeof KS)[number];
export const FULL = (1 << TOTALS.length) - 1;
const bitOf = (t: number) => 1 << (TOTALS as readonly number[]).indexOf(t);

export const popcount = (m: number) => {
  let c = 0;
  for (; m; m &= m - 1) c++;
  return c;
};
export const isLit = (mask: number, t: number) => (mask & bitOf(t)) !== 0;
export const light = (mask: number, t: number) => mask | bitOf(t);

/** Dice pairs (of 36) that make a total not yet lit: the green cells. */
export function greenCells(mask: number): number {
  let g = 0;
  for (const t of TOTALS) if (!(mask & bitOf(t))) g += waysOf(t);
  return g;
}

const tables = new Map<number, Float64Array>();
function table(k: number): Float64Array {
  let w = tables.get(k);
  if (w) return w;
  w = new Float64Array(FULL + 1);
  // Supersets first: a state's value uses only states with one more lit total.
  for (let mask = FULL; mask >= 0; mask--) {
    if (popcount(mask) >= k) {
      w[mask] = 1;
      continue;
    }
    const g = greenCells(mask);
    let s = 0;
    for (const t of TOTALS) if (!(mask & bitOf(t))) s += (waysOf(t) / (g + SEVEN_WAYS)) * w[mask | bitOf(t)];
    w[mask] = s;
  }
  tables.set(k, w);
  return w;
}

/** Exact chance to light k totals from this lit set before a 7. */
export const winChance = (k: number, mask: number) => table(k)[mask];
export const headline = (k: number) => winChance(k, 0);
export const prizeFor = (k: number) => RTP / headline(k);
export const MAX_MULTIPLIER = prizeFor(10);

/** Chance that the next roll that counts is a 7 (the red share of the live cells). */
export const sevenShare = (mask: number) => SEVEN_WAYS / (greenCells(mask) + SEVEN_WAYS);

export const VOLATILITY: Record<Volatility, { k: K }> = {
  low: { k: 3 },
  medium: { k: 5 },
  high: { k: 7 },
  extreme: { k: 10 },
};
export const volatilityOf = (k: number): Volatility => (k <= 3 ? 'low' : k <= 5 ? 'medium' : k <= 8 ? 'high' : 'extreme');

export type Kind = 'new' | 'repeat' | 'seven';
export interface Roll {
  a: number;
  b: number;
  t: number;
  kind: Kind;
}

/** One roll against a lit set. */
export function rollOnce(mask: number, rng: Rng): Roll {
  const a = rng.int(6) + 1;
  const b = rng.int(6) + 1;
  const t = a + b;
  return { a, b, t, kind: t === 7 ? 'seven' : isLit(mask, t) ? 'repeat' : 'new' };
}

/** A step: roll until something counts (a new total or a 7). The repeats on the way are returned too. */
export function advance(mask: number, rng: Rng): { rolls: Roll[]; mask: number } {
  const rolls: Roll[] = [];
  for (;;) {
    const r = rollOnce(mask, rng);
    rolls.push(r);
    if (r.kind === 'new') return { rolls, mask: light(mask, r.t) };
    if (r.kind === 'seven') return { rolls, mask };
  }
}

/** The cash-out after a step: prize at k lit, 0 after a 7, else prize * W. */
export function cashOf(k: number, mask: number, sevened: boolean): number {
  if (sevened) return 0;
  return prizeFor(k) * winChance(k, mask);
}
