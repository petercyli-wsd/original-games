// Leak: a three-room chain, waiting -> your room -> exit. 17 tokens start: 14
// waiting and 3 already in your room. Each tick one token still in play (waiting
// or in your room) is picked uniformly and moves one room on. A waiting token
// enters your room (an arrival); a token in your room leaves for the exit (a
// fuse). You pick a target k before the round: you win on the k-th arrival and
// lose on the 3rd fuse. Every arrival adds a token that can leave, so the leave
// share climbs as you score; every departure fills an exit slot for good.
//
// Exact odds: W(waiting, yours, arrivals still needed, fuses) by the one-tick
// recursion, W = w/(w+y) * W(arrival) + y/(w+y) * W(fuse). The graph is acyclic
// and a round lasts at most k + 2 ticks. Pricing (fixed prize, contract pattern
// 1): prize = RTP / W(start, k) and the cash-out is prize * W(state), a
// martingale in the ticks, so every stopping rule returns exactly RTP. The knob
// k changes the prize and the volatility, never the RTP.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;
export const TOKENS = 17;
export const WAITING = 14;
export const START_ROOM = 3;
/** The third fuse ends the round. */
export const FUSES = 3;
/** Targets the player can pick. */
export const TARGETS = [3, 5, 7, 9, 11] as const;

/** Zones a token can be in. */
export const WAIT = 0;
export const ROOM = 1;
export const OUT = 2;

export interface State {
  /** Zone of each of the 17 tokens. */
  z: readonly number[];
  /** The place of each token inside its zone (grid cell, or exit slot). */
  sl: readonly number[];
  /** Arrivals so far (new tokens that entered your room). */
  a: number;
  /** Fuses so far (tokens that left your room). */
  f: number;
  /** The target. */
  k: number;
}

export const start = (k: number): State => ({
  z: Array.from({ length: TOKENS }, (_, i) => (i < WAITING ? WAIT : ROOM)),
  sl: Array.from({ length: TOKENS }, (_, i) => (i < WAITING ? i : i - WAITING)),
  a: 0,
  f: 0,
  k,
});

export const count = (s: State, zone: number) => s.z.filter((v) => v === zone).length;
export const waiting = (s: State) => count(s, WAIT);
export const inRoom = (s: State) => count(s, ROOM);

export function winner(s: State): 'you' | 'out' | null {
  if (s.a >= s.k) return 'you';
  if (s.f >= FUSES) return 'out';
  return null;
}

const memo = new Map<string, number>();
function W(w: number, y: number, m: number, f: number): number {
  if (m === 0) return 1;
  if (f >= FUSES) return 0;
  const key = `${w},${y},${m},${f}`;
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  const t = w + y;
  const v = (w / t) * W(w - 1, y + 1, m - 1, f) + (y / t) * W(w, y - 1, m, f + 1);
  memo.set(key, v);
  return v;
}

/** Your chance to get the target in before the third fuse, from this state. */
export function winChance(s: State): number {
  const w = winner(s);
  if (w) return w === 'you' ? 1 : 0;
  return W(waiting(s), inRoom(s), s.k - s.a, s.f);
}

/** The tokens still in play, by id. */
export const inPlay = (s: State) => s.z.flatMap((v, i) => (v === OUT ? [] : [i]));

/** The token a uniform u in [0, 1) picks: the j-th token still in play. */
export function pickFor(s: State, u: number): number {
  const live = inPlay(s);
  return live[Math.min(live.length - 1, Math.floor(u * live.length))];
}

/** Move token i one room on: the new state. */
export function take(s: State, i: number): State {
  const z = s.z.slice();
  const sl = s.sl.slice();
  if (s.z[i] === WAIT) {
    const used = new Set(s.z.flatMap((v, j) => (v === ROOM ? [s.sl[j]] : [])));
    let c = 0;
    while (used.has(c)) c++;
    z[i] = ROOM;
    sl[i] = c;
    return { z, sl, a: s.a + 1, f: s.f, k: s.k };
  }
  z[i] = OUT;
  sl[i] = s.f;
  return { z, sl, a: s.a, f: s.f + 1, k: s.k };
}

export const prizeFor = (k: number) => RTP / winChance(start(k));

/** The volatility of target k, from the win chance. */
export function volatilityOf(k: number): Volatility {
  const w = winChance(start(k));
  return w > 0.4 ? 'low' : w > 0.15 ? 'medium' : w > 0.04 ? 'high' : 'extreme';
}

/** Auto cash-out targets (x stake); null = play to the end. */
export const CASH_AT = [null, 1.5, 2, 3, 5] as const;
export type CashAt = (typeof CASH_AT)[number];

export interface AutoResult {
  /** The state after every tick, with the token moved. */
  steps: { s: State; id: number }[];
  multiplier: number;
  outcome: 'win' | 'lose' | 'cashed';
}

/** One whole Auto round: tick until decided, or cash out once the cash-out reaches `cashAt`. */
export function autoRound(k: number, cashAt: CashAt, u: () => number): AutoResult {
  const prize = prizeFor(k);
  let s = start(k);
  const steps: { s: State; id: number }[] = [];
  for (;;) {
    const id = pickFor(s, u());
    s = take(s, id);
    steps.push({ s, id });
    const w = winner(s);
    if (w) return { steps, multiplier: w === 'you' ? prize : 0, outcome: w === 'you' ? 'win' : 'lose' };
    const cash = prize * winChance(s);
    if (cashAt !== null && cash >= cashAt) return { steps, multiplier: cash, outcome: 'cashed' };
  }
}

/** Every payout is at most its prize, and the largest prize is the largest target's. */
export const MAX_MULTIPLIER = Math.max(...TARGETS.map(prizeFor));
