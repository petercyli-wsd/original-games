// Coin Flip (the streak format from Stake, Roobet and BC.Game).
//
// Each flip you call Heads or Tails (or let the game pick at random) and the
// coins are tossed. Every coin is a fair, independent ½–½ toss, decided by the
// rng and independent of your call, so the call never changes the odds.
//
// The risk knob is the classic format extended to several coins: flip n coins
// (1–5) and win the flip when at least k of them (1–n) land on your call. Of
// the 2^n equally likely outcomes exactly
//
//   W(n, k) = Σ_{j=k..n} C(n, j)
//
// win, so a flip wins with probability p = W / 2^n (one coin: ½, as on every
// casino). n = 1, k = 1 is the familiar game; 5 coins needing 2 is a gentle
// 81.25% flip, 5 coins needing all 5 is a 1-in-32 shot.
//
// Pricing (one edge, applied once): after s winning flips the cash-out is
//
//   cash(s) = RTP · f^s,   f = 1/p = 2^n / W(n, k),
//
// so the first one-coin win pays 0.99 × 2 = 1.98× and each further win doubles
// it (3.96×, 7.92×, …). Every flip is a fair bet: p · f · c + (1 − p) · 0 = c.
// The cash-out is therefore a martingale starting at RTP = 0.99, and by
// optional stopping every strategy (any calls, any cash-out rule, the auto
// cash-out at the top of the ladder) returns exactly 99%. In closed form,
// stopping after s wins pays RTP · f^s with probability p^s, which is RTP for
// every s.
//
// Ladder length: up to MAX_FLIPS = 20 winning flips, and never past
// RTP · 2^20 (= 1,038,090.24×, the one-coin 20-flip prize). The top rung is
//   S(n, k) = max { s ≤ 20 : f^s ≤ 2^20 },
// fixed before the round starts. Reaching it cashes out automatically: a
// stopping rule, so the RTP is unchanged and MAX_MULTIPLIER is an honest bound.
// (Stake compounds its edge on every flip; ours takes the 1% once.)

import type { Rng, Volatility } from '@originals/game-sdk';

export const RTP = 0.99;
export const MAX_FLIPS = 20;
/** The largest ladder factor allowed: f^s ≤ 2^20. */
export const CAP_FACTOR = 2 ** MAX_FLIPS;
export const MAX_MULTIPLIER = RTP * CAP_FACTOR;

export type Side = 0 | 1;
export const HEADS: Side = 0;
export const TAILS: Side = 1;
export const SIDE_NAMES = ['Heads', 'Tails'] as const;
export const SIDE_KEYS = ['H', 'T'] as const;

/** What the player calls for a flip; 'random' is resolved by the rng when the flip starts. */
export type Call = Side | 'random';
/** Auto-bet call patterns: a fixed side, a random side each flip, or alternating. */
export type AutoCall = Call | 'alternate';

export const COINS = [1, 2, 3, 4, 5] as const;
export type Coins = (typeof COINS)[number];

export function binom(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let c = 1;
  for (let i = 1; i <= k; i++) c = (c * (n - k + i)) / i;
  return Math.round(c);
}

/** Outcomes (out of 2^n) in which at least `need` of the n coins show the called side. */
export function winWays(n: number, need: number): number {
  let w = 0;
  for (let j = need; j <= n; j++) w += binom(n, j);
  return w;
}

export const outcomes = (n: number) => 2 ** n;

/** Chance that one flip wins. */
export const flipChance = (n: number, need: number) => winWays(n, need) / outcomes(n);

/** Cash-out factor per winning flip: exactly 1 / flipChance. */
export const flipFactor = (n: number, need: number) => outcomes(n) / winWays(n, need);

/** The default "need" for n coins: a majority (one coin: 1, three: 2, five: 3). */
export const majority = (n: number) => Math.floor(n / 2) + 1;

const ladderCache = new Map<string, number[]>();

/** Cash-outs after 1..S winning flips (S = the top rung for these settings). */
export function ladder(n: number, need: number): number[] {
  const key = `${n}/${need}`;
  const hit = ladderCache.get(key);
  if (hit) return hit;
  const f = flipFactor(n, need);
  const out: number[] = [];
  let g = 1;
  for (let s = 1; s <= MAX_FLIPS; s++) {
    g *= f;
    // Tolerance only absorbs float error on exact powers of two (f = 32, s = 4).
    if (g > CAP_FACTOR * (1 + 1e-12)) break;
    out.push(RTP * g);
  }
  ladderCache.set(key, out);
  return out;
}

/** Top rung: the most winning flips a round can reach; reaching it cashes out. */
export const maxFlips = (n: number, need: number) => ladder(n, need).length;

/** Cash-out after s winning flips (s = 0 is the stake's fair value, not cashable). */
export function cashAfter(n: number, need: number, s: number): number {
  if (s <= 0) return RTP;
  const l = ladder(n, need);
  return l[Math.min(s, l.length) - 1];
}

/** Chance of reaching s winning flips from the start: p^s. */
export const reachChance = (n: number, need: number, s: number) => flipChance(n, need) ** s;

export interface Flip {
  /** The side that was called (a random call is already resolved). */
  call: Side;
  /** Whether the call was the random pick. */
  random: boolean;
  /** Each coin's face. */
  coins: Side[];
  /** How many coins show the called side. */
  matches: number;
  win: boolean;
}

export const resolveCall = (call: Call, rng: Rng): Side => (call === 'random' ? (rng.int(2) as Side) : call);

/** Tosses n fair coins for a call; wins when at least `need` match. */
export function flip(n: number, need: number, call: Call, rng: Rng): Flip {
  const side = resolveCall(call, rng);
  const coins: Side[] = [];
  for (let i = 0; i < n; i++) coins.push(rng.int(2) as Side);
  const matches = coins.filter((c) => c === side).length;
  return { call: side, random: call === 'random', coins, matches, win: matches >= need };
}

/** The call an auto pattern makes on its i-th flip of a round. */
export function autoCallAt(pattern: AutoCall, i: number): Call {
  if (pattern === 'alternate') return (i % 2) as Side;
  return pattern;
}

export interface AutoRound {
  multiplier: number;
  /** Flips made. */
  steps: number;
  flips: Flip[];
}

/** One automatic round: flip with the pattern until `target` wins (cash out there) or a loss. */
export function autoRound(n: number, need: number, target: number, pattern: AutoCall, rng: Rng): AutoRound {
  const t = Math.max(1, Math.min(maxFlips(n, need), Math.floor(target)));
  const flips: Flip[] = [];
  for (let s = 0; s < t; s++) {
    const f = flip(n, need, autoCallAt(pattern, s), rng);
    flips.push(f);
    if (!f.win) return { multiplier: 0, steps: flips.length, flips };
  }
  return { multiplier: cashAfter(n, need, t), steps: flips.length, flips };
}

export function volatilityOf(n: number, need: number): Volatility {
  const p = flipChance(n, need);
  return p >= 0.7 ? 'low' : p >= 0.4 ? 'medium' : p >= 0.1 ? 'high' : 'extreme';
}
