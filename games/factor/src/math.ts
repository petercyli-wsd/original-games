// Factor: a hidden whole number N is drawn uniformly from 2 … 9999 and
// factored by trial division, one division at a time. You back Ω(N), the
// number of prime factors counted with repeats (12 = 2·2·3 has three): either
// "N is prime" (Ω = 1) or "N has at least k prime factors" (k = 2 … 10).
//
// The algorithm is the textbook one, run on the hidden remainder m = N / F
// (F = product of the factors found so far):
//
//   p = 2
//   while p² ≤ m:                         the guard
//     while p divides m: record p; m = m/p a hit: the tree grows a leaf
//     p = next prime                       a miss: move along the primes
//   if m > 1: record m                     whatever is left is prime
//
// Each step of the game is one division test ("does p divide m?"). After a
// miss the guard for the next prime is checked at once, so a step can end the
// algorithm: the remainder is then 1 or a prime and is shown.
//
// What the player has seen pins the candidates down exactly. The remainder m
// has no prime factor below the current divisor p (it is "p-rough"), it is at
// most hi = ⌊9999 / F⌋, and it is at least a bound lo carried by the guards:
// passing the guard at p sets lo = max(lo, p²), and a hit at p divides it,
// lo = ⌈lo / p⌉. (Older guards are implied by newer ones, so one bound is
// enough.) N is uniform, so every candidate is equally likely and the live
// chance is a literal count,
//
//   P(win | S) = #{p-rough m in [lo, hi] with ω + Ω(m) winning} / #{p-rough m in [lo, hi]},
//
// with ω = factors found. A sieve gives Ω(m) and the smallest prime factor of
// every m ≤ 9999, so each count is one pass over at most 9998 numbers, cached
// by (F, p, lo). The board draws exactly these candidates as lit cells of a
// 100 × 100 grid of N, and the tests check them against a brute-force replay
// of the algorithm on every N.
//
// Erdős–Kac: Ω(N) is asymptotically normal with mean and variance ln ln N.
// For N ≤ 9999 the exact counts are 1229, 2625, 2569, 1712, 963, 485, 231,
// 104, 47, 22, 7, 3, 1 for Ω = 1 … 13 (1229 = π(9999), the primes).
//
// Pricing (fixed prize). A win pays prize = RTP / P(win), fixed at the bet.
// The cash-out in any state is prize × P(win | S). Each division test splits
// the candidates into the hits and the misses, so by the law of total
// probability the expected chance after the test equals the chance before:
// the cash-out is a martingale starting at RTP. By optional stopping every
// cash-out rule, and every pause setting (which only decides where the player
// is offered a cash-out), returns exactly RTP. The round ends by itself the
// moment the chance is 0 or 1 (a stopping rule, so RTP is unchanged). No
// payout exceeds the prize, so maxMultiplier is the largest prize on offer.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

export const MIN_N = 2;
export const MAX_N = 9999;
/** How many values N can take. */
export const RANGE = MAX_N - MIN_N + 1;

// ---------- Sieve ----------

/** Smallest prime factor of every n ≤ MAX_N (0 for 0 and 1). */
const SPF = new Uint16Array(MAX_N + 1);
/** Ω(n): prime factors of n counted with multiplicity (0 for 1). */
const OMEGA = new Uint8Array(MAX_N + 1);
for (let n = 2; n <= MAX_N; n++) {
  if (SPF[n] === 0) for (let k = n; k <= MAX_N; k += n) if (SPF[k] === 0) SPF[k] = n;
}
for (let n = 2; n <= MAX_N; n++) OMEGA[n] = OMEGA[n / SPF[n]] + 1;

/** Ω(n) for 1 ≤ n ≤ MAX_N. */
export const bigOmega = (n: number) => OMEGA[n];
/** Smallest prime factor of n ≥ 2. */
export const smallestPrimeFactor = (n: number) => SPF[n];
export const isPrime = (n: number) => n >= 2 && SPF[n] === n;

/** The largest Ω any N in range can have (8192 = 2¹³). */
export const MAX_OMEGA = Math.max(...OMEGA);

/** Trial divisors: the primes up to 97, then 101, whose square already exceeds MAX_N (the guard always stops there). */
export const PRIMES: readonly number[] = Array.from({ length: 102 }, (_, n) => n).filter(isPrime);
/** The primes that can actually be tried (101 never is). */
export const TRIAL_PRIMES = PRIMES.filter((p) => p * p <= MAX_N);

/** Prime factors of n in ascending order, with repeats. */
export function factorize(n: number): number[] {
  const out: number[] = [];
  while (n > 1) {
    out.push(SPF[n]);
    n /= SPF[n];
  }
  return out;
}

// ---------- Bets and settings ----------

/** 1 = "N is prime" (exactly one prime factor); k ≥ 2 = "N has at least k prime factors". */
export const BETS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
export type Bet = (typeof BETS)[number];

export const betLabel = (bet: Bet) => (bet === 1 ? 'Prime' : `${bet}+`);
/** Completes "You win if …". */
export const betPhrase = (bet: Bet) => (bet === 1 ? 'N is prime' : `N has ${bet} or more prime factors`);

/** Whether a final factor count wins the bet. */
export const wins = (bet: Bet, omega: number) => (bet === 1 ? omega === 1 : omega >= bet);

/** Where the round stops to offer a cash-out: after every division, after each new factor, or never (one click). */
export const PAUSES = ['test', 'factor', 'never'] as const;
export type Pause = (typeof PAUSES)[number];
export const PAUSE_LABEL: Record<Pause, string> = { test: 'Each test', factor: 'Each factor', never: 'Never' };

export const VOLATILITY: Record<Volatility, { bet: Bet }> = {
  low: { bet: 3 },
  medium: { bet: 1 },
  high: { bet: 7 },
  extreme: { bet: 9 },
};

/** How many N in range have each Ω (index = Ω). */
export const OMEGA_COUNTS: readonly number[] = (() => {
  const c = new Array<number>(MAX_OMEGA + 1).fill(0);
  for (let n = MIN_N; n <= MAX_N; n++) c[OMEGA[n]]++;
  return c;
})();

/** How many N in range win the bet. */
export const winners = (bet: Bet) => OMEGA_COUNTS.reduce((s, c, w) => s + (wins(bet, w) ? c : 0), 0);
/** Chance to win before anything is revealed. */
export const baseChance = (bet: Bet) => winners(bet) / RANGE;
/** The full prize, fixed when the bet is placed. */
export const prize = (bet: Bet) => RTP / baseChance(bet);

export function volatilityOf(bet: Bet): Volatility {
  const p = baseChance(bet);
  return p > 0.3 ? 'low' : p > 0.08 ? 'medium' : p > 0.01 ? 'high' : 'extreme';
}

/** No payout can exceed the prize of the longest-odds bet. */
export const MAX_MULTIPLIER = Math.max(...BETS.map(prize));

// ---------- Trial division state ----------

export interface Trial {
  /** Prime factors found so far, in order. Once done, the last one may be the prime remainder. */
  factors: number[];
  /** Their product. */
  found: number;
  /** Index into PRIMES of the divisor in hand. */
  i: number;
  /** Lower bound on the hidden remainder m = N / found (from the guards). */
  lo: number;
  /** Before the first test: the guard 2² ≤ N has not been checked yet. */
  fresh: boolean;
  /** The algorithm has stopped: N is known. */
  done: boolean;
  /** How many times each prime divided, by index into PRIMES (entries up to i). */
  exps: number[];
  /** Division tests made so far. */
  tests: number;
}

export const startTrial = (): Trial => ({ factors: [], found: 1, i: 0, lo: MIN_N, fresh: true, done: false, exps: [0], tests: 0 });

/** The largest value the hidden remainder can have. */
export const maxRemainder = (t: Trial) => Math.floor(MAX_N / t.found);

/** The divisor in hand. */
export const divisor = (t: Trial) => PRIMES[t.i];

/** Whether prime index j can still be reached: the guard stops before any p with p² above the largest possible remainder. */
export const reachable = (t: Trial, j: number) => !t.done && j >= t.i && PRIMES[j] ** 2 <= maxRemainder(t);

/** Whether the hidden remainder m is still a candidate (m is p-rough and inside [lo, hi]). */
export function isCandidateRemainder(t: Trial, m: number): boolean {
  if (t.done) return m === 1;
  if (m < t.lo || m > maxRemainder(t)) return false;
  return m === 1 || SPF[m] >= PRIMES[t.i];
}

/**
 * Applies the guard for the divisor in hand: if p² exceeds the remainder the
 * algorithm stops and the remainder (1 or a prime) joins the factors.
 */
function guard(t: Trial, n: number): Trial {
  const m = n / t.found;
  const p = PRIMES[t.i];
  if (p * p > m) {
    const factors = m > 1 ? [...t.factors, m] : t.factors;
    return { ...t, factors, found: n, lo: 1, fresh: false, done: true };
  }
  return { ...t, lo: Math.max(t.lo, p * p), fresh: false };
}

/** One division test on the hidden number n (n is only used to resolve the test). */
export function step(t: Trial, n: number): Trial {
  if (t.done) return t;
  let s = t;
  if (s.fresh) {
    s = guard(s, n);
    if (s.done) return s;
  }
  const p = PRIMES[s.i];
  const m = n / s.found;
  const tests = s.tests + 1;
  if (m % p === 0) {
    const exps = [...s.exps];
    exps[s.i] += 1;
    return { ...s, factors: [...s.factors, p], found: s.found * p, lo: Math.ceil(s.lo / p), exps, tests };
  }
  return guard({ ...s, i: s.i + 1, exps: [...s.exps, 0], tests }, n);
}

/** Runs the algorithm to the end (for revealing N once a round is over). */
export function finish(t: Trial, n: number): Trial {
  let s = t;
  while (!s.done) s = step(s, n);
  return s;
}

// ---------- Exact odds ----------

const histCache = new Map<string, Int32Array>();

/**
 * Counts of Ω(m) over the candidate remainders m (index = Ω(m)). Exact: one
 * pass over [lo, hi], cached by (found, divisor, lo).
 */
export function remainderOmegas(t: Trial): Int32Array {
  const key = `${t.found}:${t.i}:${t.lo}`;
  let h = histCache.get(key);
  if (h) return h;
  h = new Int32Array(MAX_OMEGA + 1);
  const hi = maxRemainder(t);
  const p = PRIMES[t.i];
  for (let m = t.lo; m <= hi; m++) if (m === 1 || SPF[m] >= p) h[OMEGA[m]]++;
  histCache.set(key, h);
  return h;
}

/** How many candidates N have each final Ω (index = Ω(N)). */
export function finalOmegas(t: Trial): number[] {
  const out = new Array<number>(MAX_OMEGA + 1).fill(0);
  if (t.done) {
    out[t.factors.length] = 1;
    return out;
  }
  const h = remainderOmegas(t);
  const w = t.factors.length;
  for (let j = 0; j < h.length; j++) if (h[j] && w + j <= MAX_OMEGA) out[w + j] += h[j];
  return out;
}

export interface Odds {
  /** Candidates for N that win. */
  win: number;
  /** All candidates for N. */
  total: number;
  chance: number;
}

export function odds(t: Trial, bet: Bet): Odds {
  const f = finalOmegas(t);
  let win = 0;
  let total = 0;
  f.forEach((c, w) => {
    total += c;
    if (wins(bet, w)) win += c;
  });
  return { win, total, chance: total ? win / total : 0 };
}

/** The round is settled once every candidate wins or every candidate loses. */
export const decided = (o: Odds) => o.win === 0 || o.win === o.total;

/** Cash-out value (as a multiple of the stake) in a state. */
export const cashOut = (t: Trial, bet: Bet) => prize(bet) * odds(t, bet).chance;

export interface Fork {
  p: number;
  /** Share of the candidates that p divides. */
  pHit: number;
  /** Win chance if p divides, and if it doesn't. */
  ifHit: number;
  ifMiss: number;
}

/** What the next division can do to the odds. The hit branch is the state after the hit; the miss branch is the rest. */
export function fork(t: Trial, bet: Bet): Fork | null {
  if (t.done) return null;
  const p = PRIMES[t.i];
  const lo = t.fresh ? Math.max(t.lo, p * p) : t.lo;
  const hitState: Trial = { ...t, factors: [...t.factors, p], found: t.found * p, lo: Math.ceil(lo / p), fresh: false };
  const all = odds(t, bet);
  const hit = odds(hitState, bet);
  const missTotal = all.total - hit.total;
  return {
    p,
    pHit: hit.total / all.total,
    ifHit: hit.chance,
    ifMiss: missTotal > 0 ? (all.win - hit.win) / missTotal : 0,
  };
}

/** Every N still possible, as a mask over 0 … MAX_N. */
export function candidateMask(t: Trial): Uint8Array {
  const mask = new Uint8Array(MAX_N + 1);
  if (t.done) {
    mask[t.found] = 1;
    return mask;
  }
  const hi = maxRemainder(t);
  for (let m = t.lo; m <= hi; m++) if (isCandidateRemainder(t, m)) mask[m * t.found] = 1;
  return mask;
}

/** The N that win the bet, as a mask over 0 … MAX_N. */
export function winnerMask(bet: Bet): Uint8Array {
  const mask = new Uint8Array(MAX_N + 1);
  for (let n = MIN_N; n <= MAX_N; n++) if (wins(bet, OMEGA[n])) mask[n] = 1;
  return mask;
}

/** Whether to stop and offer a cash-out after this step. */
export function pausesAfter(pause: Pause, before: Trial, after: Trial): boolean {
  if (pause === 'test') return true;
  if (pause === 'factor') return after.factors.length > before.factors.length;
  return false;
}

// ---------- Formatting ----------

const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const sup = (n: number) => String(n).replace(/\d/g, (d) => SUP[Number(d)]);

/** [2, 2, 2, 3, 5] → "2³ · 3 · 5". */
export function fmtFactors(factors: readonly number[]): string {
  const parts: string[] = [];
  for (let k = 0; k < factors.length; ) {
    let e = 1;
    while (factors[k + e] === factors[k]) e++;
    parts.push(e > 1 ? `${factors[k]}${sup(e)}` : String(factors[k]));
    k += e;
  }
  return parts.join(' · ');
}

export const fmtInt = (n: number) => n.toLocaleString('en-US');
