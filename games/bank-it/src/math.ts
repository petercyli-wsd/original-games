// Bank It: reach K points within five turns. Each turn you roll one die as
// often as you like. A 3-6 adds that many points to your pot; a 1 or 2 wipes
// the pot and ends the turn. Bank (between rolls) keeps the pot as score and
// ends the turn. The round is won on the roll that takes score + pot to K
// (that roll banks itself) and lost by a wipe on turn 5. Bank is not offered
// on turn 5 (it could only forfeit).
//
// State: (n, p, t) = points still needed, pot, turns left (including this one).
// Let V be the win chance under best play. Then V(n, p, 0) = 0 and, by
// backward induction (Bellman),
//
//   Roll(n, p, t) = (2/6) V(n, 0, t-1) + (1/6) Σ_{d=3..6} (p + d >= n ? 1 : V(n, p+d, t))
//   Bank(n, p, t) = V(n - p, 0, t-1)                (t >= 2, p >= 1)
//   V(n, p, t)    = max(Roll, Bank)
//
// The table is exact (about 70 x 70 x 5 states), no simulation.
//
// Pricing (fixed prize with relock): prize = RTP / V(K, 0, 5); cash-out at a
// checkpoint = prize * V(state). Averaged over the die, V after the roll
// equals V before it when the best option is taken, so the cash-out is a
// martingale starting at RTP. Taking the worse of Roll and Bank keeps the
// cash-out the same at the moment of choosing: the prize is relocked at
// value / (chance of the option taken). The choice changes risk, never value.
// Relocks above MAX_WIN are refused (the best option never relocks). By
// optional stopping every strategy returns exactly RTP.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;
export const MAX_WIN = 10_000;
export const MAX_MULTIPLIER = MAX_WIN;
export const TURNS = 5;
/** A roll of 1 or 2 wipes the pot. */
export const WIPE_FACES = 2;
const EPS = 1e-12;

/** Targets the player can pick (points to bank). */
export const TARGETS = [15, 25, 35, 45, 55, 65] as const;
export type Target = (typeof TARGETS)[number];
export const K_MAX = 65;


const W = K_MAX + 1;
let table: Float64Array | null = null;
const idx = (t: number, n: number, p: number) => (t * W + n) * W + p;

function build(): Float64Array {
  const v = new Float64Array((TURNS + 1) * W * W);
  for (let t = 1; t <= TURNS; t++)
    for (let n = 1; n <= K_MAX; n++)
      for (let p = n - 1; p >= 0; p--) {
        let r = (WIPE_FACES / 6) * v[idx(t - 1, n, 0)];
        for (let d = 3; d <= 6; d++) r += (1 / 6) * (p + d >= n ? 1 : v[idx(t, n, p + d)]);
        const b = t >= 2 && p >= 1 ? v[idx(t - 1, n - p, 0)] : -1;
        v[idx(t, n, p)] = Math.max(r, b);
      }
  return v;
}
const V = () => (table ??= build());

/** Win chance under best play: n points needed, pot p (< n), t turns left. */
export const winChance = (n: number, p: number, t: number): number => (t <= 0 ? 0 : n <= 0 ? 1 : V()[idx(t, n, p)]);

/** Chance if you roll now (best play after). */
export function rollChance(n: number, p: number, t: number): number {
  const v = V();
  let r = (WIPE_FACES / 6) * v[idx(t - 1, n, 0)];
  for (let d = 3; d <= 6; d++) r += (1 / 6) * (p + d >= n ? 1 : v[idx(t, n, p + d)]);
  return r;
}

/** Whether Bank is offered: a pot to keep and a turn left after this one. */
export const canBank = (p: number, t: number) => p >= 1 && t >= 2;

/** Chance if you bank now (0 when banking is not offered). */
export const bankChance = (n: number, p: number, t: number): number => (canBank(p, t) ? winChance(n - p, 0, t - 1) : 0);

export const startPrize = (k: number) => RTP / winChance(k, 0, TURNS);

/** Prize after taking an option of chance `chosen` when the best one had `best` (null if over MAX_WIN). */
export function relock(prize: number, best: number, chosen: number): number | null {
  if (chosen >= best - EPS) return prize;
  const next = (prize * best) / chosen;
  return !Number.isFinite(next) || next > MAX_WIN ? null : next;
}

/** Which option is best at a state. Ties go to Roll. */
export const bestIsBank = (n: number, p: number, t: number): boolean => canBank(p, t) && bankChance(n, p, t) > rollChance(n, p, t) + EPS;

export function volatilityOf(k: number): Volatility {
  const p = winChance(k, 0, TURNS);
  return p > 0.5 ? 'low' : p > 0.2 ? 'medium' : p > 0.07 ? 'high' : 'extreme';
}

/** One die: 1..6. A roll of 1 or 2 wipes. */
export const isWipe = (face: number) => face <= WIPE_FACES;
