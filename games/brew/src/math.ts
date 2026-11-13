// Brew: push-your-luck from an open bag. The bag holds 18 chips, drawn without
// replacement: 10 green, and 8 white chips worth 1, 1, 1, 1, 2, 2, 3, 3. You
// pick a target k before the round. Every green chip fills one slot of the
// potion; every white chip adds its number to the heat. You win when the k-th
// green chip lands; you lose the moment the heat passes 7.
//
// "Boils over" is the literal count the board draws: a white chip is red when
// the heat plus its number would pass 7. The next chip boils the potion over
// with chance (red chips in the bag) / (chips in the bag).
//
// Exact odds: a state is (whites left per value, greens left, heat, greens
// still needed), and W is computed by the one-chip recursion. Pricing (fixed
// prize, contract pattern 1): prize = RTP / W(start, k) and the cash-out is
// prize * W(state), a martingale in the chips, so every stopping rule returns
// exactly RTP. The knob k changes the prize and the volatility, never the RTP.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;
/** The heat at which the potion is still safe; one more boils it over. */
export const LIMIT = 7;
/** The bag in fixed slots: greens first, then the whites by number. */
export const CHIPS: readonly number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 3, 3]; // 0 = green
export const GREENS = 10;
/** Targets the player can pick. */
export const TARGETS = [2, 4, 6, 8, 10] as const;
export type Target = (typeof TARGETS)[number];

/** What is left in the bag and how the round stands. */
export interface State {
  /** Which of the 18 slots are still in the bag. */
  bag: readonly boolean[];
  heat: number;
  /** Green chips drawn so far. */
  filled: number;
  /** The target. */
  k: number;
}

export const start = (k: number): State => ({ bag: CHIPS.map(() => true), heat: 0, filled: 0, k });

export interface Counts {
  /** Whites left with value 1, 2, 3. */
  w: readonly [number, number, number];
  g: number;
}

export function countsOf(bag: readonly boolean[]): Counts {
  const w: [number, number, number] = [0, 0, 0];
  let g = 0;
  bag.forEach((there, i) => {
    if (!there) return;
    const v = CHIPS[i];
    if (v === 0) g++;
    else w[v - 1]++;
  });
  return { w, g };
}

export const inBag = (s: State) => s.bag.filter(Boolean).length;
/** A white chip boils the potion over when the heat plus its number passes the limit. */
export const boils = (heat: number, v: number) => v > 0 && heat + v > LIMIT;
/** Chips in the bag that would boil it over now. */
export const redCount = (s: State) => s.bag.reduce((n, there, i) => n + (there && boils(s.heat, CHIPS[i]) ? 1 : 0), 0);

export function winner(s: State): 'you' | 'boil' | null {
  if (s.heat > LIMIT) return 'boil';
  if (s.filled >= s.k) return 'you';
  return null;
}

const memo = new Map<string, number>();
function W(n1: number, n2: number, n3: number, g: number, h: number, m: number): number {
  if (m === 0) return 1;
  const key = `${n1},${n2},${n3},${g},${h},${m}`;
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  const t = n1 + n2 + n3 + g;
  let v = (g / t) * W(n1, n2, n3, g - 1, h, m - 1);
  if (n1 && h + 1 <= LIMIT) v += (n1 / t) * W(n1 - 1, n2, n3, g, h + 1, m);
  if (n2 && h + 2 <= LIMIT) v += (n2 / t) * W(n1, n2 - 1, n3, g, h + 2, m);
  if (n3 && h + 3 <= LIMIT) v += (n3 / t) * W(n1, n2, n3 - 1, g, h + 3, m);
  memo.set(key, v);
  return v;
}

/** Your chance to fill the potion before the heat passes the limit, from this state. */
export function winChance(s: State): number {
  const w = winner(s);
  if (w) return w === 'you' ? 1 : 0;
  const { w: c, g } = countsOf(s.bag);
  return W(c[0], c[1], c[2], g, s.heat, s.k - s.filled);
}

/** Draw the chip in slot i: the new state. */
export function take(s: State, i: number): State {
  const v = CHIPS[i];
  const bag = s.bag.map((b, j) => (j === i ? false : b));
  return { bag, heat: s.heat + v, filled: s.filled + (v === 0 ? 1 : 0), k: s.k };
}

/** The slot a uniform u in [0, 1) draws: the j-th chip still in the bag. */
export function slotFor(s: State, u: number): number {
  const left = s.bag.flatMap((b, i) => (b ? [i] : []));
  return left[Math.min(left.length - 1, Math.floor(u * left.length))];
}

/** Your chance after the next chip, if it is green and if it is white (averaged over the whites). */
export function forecast(s: State) {
  const left = s.bag.flatMap((b, i) => (b ? [i] : []));
  let g = 0;
  let ng = 0;
  let wh = 0;
  let nw = 0;
  for (const i of left) {
    const p = winChance(take(s, i));
    if (CHIPS[i] === 0) {
      g += p;
      ng++;
    } else {
      wh += p;
      nw++;
    }
  }
  return { ifGreen: ng ? g / ng : 0, ifWhite: nw ? wh / nw : 0 };
}

export const prizeFor = (k: number) => RTP / winChance(start(k));

/** The volatility of target k, from the win chance. */
export function volatilityOf(k: number): Volatility {
  const w = winChance(start(k));
  return w > 0.4 ? 'low' : w > 0.15 ? 'medium' : w > 0.04 ? 'high' : 'extreme';
}

/** Auto cash-out targets (× stake); null = play to the end. */
export const CASH_AT = [null, 1.5, 2, 3, 5] as const;
export type CashAt = (typeof CASH_AT)[number];

export interface AutoResult {
  /** The state after every chip, with the slot drawn. */
  steps: { s: State; slot: number }[];
  multiplier: number;
  outcome: 'win' | 'lose' | 'cashed';
}

/** One whole Auto round: draw until decided, or cash out once the cash-out reaches `cashAt`. */
export function autoRound(k: number, cashAt: CashAt, u: () => number): AutoResult {
  const prize = prizeFor(k);
  let s = start(k);
  const steps: { s: State; slot: number }[] = [];
  for (;;) {
    const slot = slotFor(s, u());
    s = take(s, slot);
    steps.push({ s, slot });
    const w = winner(s);
    if (w) return { steps, multiplier: w === 'you' ? prize : 0, outcome: w === 'you' ? 'win' : 'lose' };
    const cash = prize * winChance(s);
    if (cashAt !== null && cash >= cashAt) return { steps, multiplier: cash, outcome: 'cashed' };
  }
}

/** Every payout is at most its prize, and the largest prize is the largest target's. */
export const MAX_MULTIPLIER = Math.max(...TARGETS.map(prizeFor));
