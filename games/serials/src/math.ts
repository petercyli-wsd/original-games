// Serials: the German tank problem as a bet.
//
// A hidden top serial N is drawn uniformly from {10, …, 100}. Then k serials
// (k ∈ {2, …, 6}) are drawn without replacement from 1..N and shown one at a
// time, and finally N is revealed. The player bets N ≤ X for a cut X they pick.
//
// The theorem (Bayes for an unknown maximum). After j draws whose largest is
// m, the chance of seeing exactly those serials in that order is
// 1 / (N (N−1) ⋯ (N−j+1)) = 1 / (j! · C(N, j)) when N ≥ m, and 0 when N < m.
// The prior is flat, so
//
//   P(N | draws) ∝ 1 / C(N, j)   for max(10, m) ≤ N ≤ 100,
//
// and only j and m matter (m is a sufficient statistic). The win chance on
// screen is the posterior mass left of the cut: P(N ≤ X | draws). It is a
// finite sum of exact integer reciprocals: no simulation, no integration.
// (Off the cap at 100 the tail sums telescope: Σ_{N≥n} 1/C(N, j) =
// j / ((j−1) C(n−1, j−1)), the classic German tank estimate's engine.)
//
// The predictive law of the next draw s (any serial not yet drawn) is
// P(s | draws) = Σ_{N ≥ max(lo, s)} P(N | draws) / (N − j): pick N from the
// posterior, then one of its N − j unseen serials. Averaging the updated
// posterior over s gives back the current one (Bayes' rule is a martingale),
// so P(N ≤ X | draws) is a martingale too. A draw above X makes it 0: the
// round is lost on the spot.
//
// Pricing (fixed prize). Betting N ≤ X pays prize = RTP / P(N ≤ X), where the
// prior chance is (X − 9) / 91. The cash-out in any state is
// prize × P(N ≤ X | draws). It starts at RTP, every draw keeps its
// expectation, and revealing N pays prize × 1[N ≤ X], whose expectation is the
// cash-out again. By optional stopping every rule for drawing, cashing out or
// revealing early returns exactly RTP.
//
// The choice (moving the cut). At a checkpoint the player may move the cut to
// X'. The cash-out V is kept and the prize is re-locked at V / P(N ≤ X' |
// draws), so the value is unchanged at the moment of choosing: the choice
// moves volatility, never EV. Re-cuts are only offered where the re-locked
// prize stays ≤ MAX_PRIZE (P(N ≤ X') grows with X', so the allowed cuts are
// one interval [minCut, 99]). Every payout is at most a prize, and every
// prize is ≤ MAX_PRIZE (the opening prizes are at most 91 × RTP ≈ 90×), so
// maxMultiplier = MAX_PRIZE is an honest bound. Serials are integers, so no
// floating tie rule is needed: N ≤ X is an integer comparison.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

/** The hidden top serial is uniform on [N_MIN, N_MAX]. */
export const N_MIN = 10;
export const N_MAX = 100;
export const N_COUNT = N_MAX - N_MIN + 1;

/** The cut X ranges over [CUT_MIN, CUT_MAX]; X = 100 would be a sure thing. */
export const CUT_MIN = 10;
export const CUT_MAX = 99;

/** Serials drawn before N is revealed. */
export const DRAWS = [2, 3, 4, 5, 6] as const;
export type Draws = (typeof DRAWS)[number];

/** No prize, opening or re-locked, ever exceeds this. */
export const MAX_PRIZE = 1000;
export const MAX_MULTIPLIER = MAX_PRIZE;

export interface Settings {
  cut: number;
  draws: Draws;
}

/** One preset per volatility level (the eval's configs). */
export const VOLATILITY: Record<Volatility, Settings> = {
  low: { cut: 80, draws: 4 },
  medium: { cut: 50, draws: 4 },
  high: { cut: 25, draws: 3 },
  extreme: { cut: 12, draws: 5 },
};

/** C(n, k) exactly (all values here are below 2^31). */
export function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let c = 1;
  for (let i = 1; i <= k; i++) c = (c * (n - k + i)) / i;
  return Math.round(c);
}

/** Prior chance that N ≤ X. */
export const priorChance = (cut: number) => Math.min(1, Math.max(0, (cut - N_MIN + 1) / N_COUNT));

/** The prize for betting N ≤ X at the start. */
export const openingPrize = (cut: number) => RTP / priorChance(cut);

/** Lowest N still possible after seeing max m. */
export const lowestN = (max: number) => Math.max(N_MIN, max);

const cache = new Map<string, Float64Array>();

/**
 * The posterior over N after `count` draws whose largest is `max`, as an
 * array indexed by N − N_MIN (zeros below the largest serial seen).
 */
export function posterior(count: number, max: number): Float64Array {
  const key = `${count}:${max}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const out = new Float64Array(N_COUNT);
  if (max > N_MAX) throw new RangeError('serial above the largest possible N');
  let z = 0;
  for (let n = lowestN(max); n <= N_MAX; n++) {
    const w = 1 / choose(n, count);
    out[n - N_MIN] = w;
    z += w;
  }
  for (let i = 0; i < N_COUNT; i++) out[i] /= z;
  cache.set(key, out);
  return out;
}

/** P(N ≤ cut | draws): the mass left of the cut. */
export function winChance(count: number, max: number, cut: number): number {
  if (max > cut) return 0;
  const post = posterior(count, max);
  let p = 0;
  for (let n = lowestN(max); n <= Math.min(cut, N_MAX); n++) p += post[n - N_MIN];
  return Math.min(1, p);
}

/** Predictive chance that the next draw is the (not yet drawn) serial s. */
export function nextDrawChance(count: number, max: number, s: number): number {
  const post = posterior(count, max);
  let p = 0;
  for (let n = Math.max(lowestN(max), s); n <= N_MAX; n++) p += post[n - N_MIN] / (n - count);
  return p;
}

/**
 * Chance the next draw lands above the cut (and loses the round), given all
 * serials so far are at most the cut: Σ_N P(N) · (N − X)⁺ / (N − j).
 */
export function nextBust(count: number, max: number, cut: number): number {
  if (max > cut) return 1;
  const post = posterior(count, max);
  let q = 0;
  for (let n = Math.max(lowestN(max), cut + 1); n <= N_MAX; n++) q += (post[n - N_MIN] * (n - cut)) / (n - count);
  return q;
}

/** Expected N under the posterior (for the caption). */
export function posteriorMean(count: number, max: number): number {
  const post = posterior(count, max);
  let e = 0;
  for (let n = lowestN(max); n <= N_MAX; n++) e += n * post[n - N_MIN];
  return e;
}

/** Fair cash-out for a locked prize. */
export const cashOut = (prize: number, count: number, max: number, cut: number) => prize * winChance(count, max, cut);

/** Re-locked prize when moving the cut while holding cash-out `cash`. */
export function relockPrize(cash: number, count: number, max: number, cut: number): number {
  const p = winChance(count, max, cut);
  return p > 0 ? cash / p : Infinity;
}

/** Whether moving the cut there is allowed (the prize stays ≤ MAX_PRIZE). */
export const cutAllowed = (cash: number, count: number, max: number, cut: number) =>
  cut >= CUT_MIN && cut <= CUT_MAX && relockPrize(cash, count, max, cut) <= MAX_PRIZE + 1e-9;

/** The lowest cut the player may move to; every cut from here to CUT_MAX is allowed. */
export function minCut(cash: number, count: number, max: number): number {
  for (let x = Math.max(CUT_MIN, max); x <= CUT_MAX; x++) if (cutAllowed(cash, count, max, x)) return x;
  return CUT_MAX;
}

/** Draws a serial uniformly from 1..n, avoiding those already drawn. */
export function drawSerial(n: number, drawn: readonly number[], u: number): number {
  const free: number[] = [];
  for (let s = 1; s <= n; s++) if (!drawn.includes(s)) free.push(s);
  return free[Math.min(free.length - 1, Math.floor(u * free.length))];
}

/** The hidden N from a uniform u in [0, 1). */
export const drawTop = (u: number) => N_MIN + Math.min(N_COUNT - 1, Math.floor(u * N_COUNT));

export function volatilityOf(cut: number): Volatility {
  const p = priorChance(cut);
  return p >= 0.5 ? 'low' : p >= 0.2 ? 'medium' : p >= 0.06 ? 'high' : 'extreme';
}
