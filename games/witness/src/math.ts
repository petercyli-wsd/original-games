// Witness: a hidden odd number N is drawn uniformly from an odd range, and
// the Miller–Rabin test is run on it with fresh random bases a ∈ [2, N − 2].
//
// Write N − 1 = 2^s·d with d odd. Base a passes ("probably prime") when
// a^d ≡ 1 or a^(2^i·d) ≡ −1 (mod N) for some i < s. Every prime passes every
// base. A composite fails most bases (they are *witnesses* to its
// compositeness); the bases it passes are its *strong liars*. Rabin: a
// composite has at most φ(N)/4 strong liars, so its liar rate
//
//   f(N) = #{strong liars in [2, N − 2]} / (N − 3)  <  1/4.
//
// Monier's formula counts them exactly from the factorisation
// N = Π p_i^(e_i) (k distinct primes, ν = min v₂(p_i − 1), and x* the odd
// part of x):
//
//   S(N) = (1 + (2^(kν) − 1)/(2^k − 1)) · Π gcd(N − 1*, p_i − 1*),
//
// which includes the two trivial liars ±1, hence f = (S − 2)/(N − 3).
//
// Bayes. Only "passed" or "witness found" is shown during the round (the
// bases stay sealed until the end), so after r passes the posterior weight
// of a candidate is 1 for a prime and f(c)^r for a composite:
//
//   P(N = c | r passes) = w_c / Σ w,   w_c = 1 (prime) or f(c)^r.
//
// A witness proves N composite and ends the round. After T passes the
// player can cash out or reveal N.
//
// Bets: Prime (N is prime), Composite (N is composite) and Fooled (N is
// composite and passes all T tests). Each candidate's eventual winning
// weight is 1 (prime, for Prime), f^r (composite, for Composite: it either
// gets caught or survives to the reveal) or f^T (composite, for Fooled), so
//
//   P(win | r passes) = Σ win_c / Σ w_c,
//
// drawn on the board literally as the lit dot area over the total dot area.
//
// Pricing (fixed prize). A win pays prize = RTP / P(win | start), and the
// cash-out after r passes is prize × P(win | r passes). This is exact Bayes
// for the information on screen, so by the law of total probability
// P(win | r) = P(pass)·P(win | r + 1) + P(witness)·P(win | witness), and
// the cash-out is a martingale starting at RTP. By optional stopping every
// cash-out rule returns exactly RTP. No payout exceeds the prize, so
// maxMultiplier is the largest prize on offer (Fooled is limited to two
// tests to keep that under 4,000×).

import type { Rng, Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

export interface Range {
  lo: number;
  hi: number;
  label: string;
}

/** The odd ranges N is drawn from (both ends odd and included). */
export const RANGES: readonly Range[] = [
  { lo: 5, hi: 99, label: '5–99' },
  { lo: 101, hi: 999, label: '101–999' },
  { lo: 1001, hi: 1999, label: '1001–1999' },
];
export type RangeIx = 0 | 1 | 2;
export const RANGE_IXS: readonly RangeIx[] = [0, 1, 2];

/** How many Miller–Rabin tests run before N is revealed. */
export const TESTS = [1, 2, 3] as const;
export type Tests = (typeof TESTS)[number];
/** Fooled pays RTP / P(fooled), which grows ~13× per test; two tests keep it under 4,000×. */
export const MAX_FOOLED_TESTS = 2;

export const BETS = ['composite', 'prime', 'fooled'] as const;
export type Bet = (typeof BETS)[number];
export const BET_LABEL: Record<Bet, string> = { prime: 'Prime', composite: 'Composite', fooled: 'Fooled' };

export interface Settings {
  range: RangeIx;
  bet: Bet;
  tests: Tests;
}

export const VOLATILITY: Record<Volatility, Settings> = {
  low: { bet: 'composite', range: 2, tests: 2 },
  medium: { bet: 'prime', range: 1, tests: 2 },
  high: { bet: 'fooled', range: 0, tests: 1 },
  extreme: { bet: 'fooled', range: 1, tests: 2 },
};

export const allowed = (bet: Bet, tests: Tests) => bet !== 'fooled' || tests <= MAX_FOOLED_TESTS;

// ---------- Number theory ----------

/** a^e mod n (n < 2^26, so every product is exact in a double). */
export function powMod(a: number, e: number, n: number): number {
  let r = 1;
  let b = a % n;
  while (e > 0) {
    if (e & 1) r = (r * b) % n;
    b = (b * b) % n;
    e = Math.floor(e / 2);
  }
  return r;
}

/** One Miller–Rabin round: true when base a says "probably prime" for odd n ≥ 5. */
export function passes(a: number, n: number): boolean {
  let d = n - 1;
  let s = 0;
  while (d % 2 === 0) {
    d /= 2;
    s++;
  }
  let x = powMod(a, d, n);
  if (x === 1 || x === n - 1) return true;
  for (let i = 1; i < s; i++) {
    x = (x * x) % n;
    if (x === n - 1) return true;
  }
  return false;
}

export function isPrime(n: number): boolean {
  if (n < 2) return false;
  if (n % 2 === 0) return n === 2;
  for (let p = 3; p * p <= n; p += 2) if (n % p === 0) return false;
  return true;
}

/** Prime factorisation by trial division: [prime, exponent] pairs. */
export function factorize(n: number): [number, number][] {
  const out: [number, number][] = [];
  for (let p = 2; p * p <= n; p++) {
    let e = 0;
    while (n % p === 0) {
      n /= p;
      e++;
    }
    if (e) out.push([p, e]);
  }
  if (n > 1) out.push([n, 1]);
  return out;
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
const oddPart = (x: number) => {
  while (x % 2 === 0) x /= 2;
  return x;
};
const v2 = (x: number) => {
  let k = 0;
  while (x % 2 === 0) {
    x /= 2;
    k++;
  }
  return k;
};

/** Monier: the number of strong liars of an odd composite n in [1, n − 1] (including ±1). */
export function strongLiars(n: number): number {
  const ps = factorize(n).map(([p]) => p);
  const k = ps.length;
  const nu = Math.min(...ps.map((p) => v2(p - 1)));
  const ns = oddPart(n - 1);
  let prod = 1;
  for (const p of ps) prod *= gcd(ns, oddPart(p - 1));
  return (1 + (2 ** (k * nu) - 1) / (2 ** k - 1)) * prod;
}

/** The chance one random base a ∈ [2, n − 2] passes n: 1 for a prime, the liar rate for a composite. */
export const passRate = (n: number) => (isPrime(n) ? 1 : (strongLiars(n) - 2) / (n - 3));

const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const sup = (e: number) => [...String(e)].map((c) => SUP[Number(c)]).join('');
/** "701 is prime", "703 = 19 × 37", "25 = 5²". */
export function describe(n: number): string {
  if (isPrime(n)) return `${n} is prime`;
  return `${n} = ${factorize(n)
    .map(([p, e]) => (e > 1 ? `${p}${sup(e)}` : `${p}`))
    .join(' × ')}`;
}

// ---------- Candidates and the posterior ----------

export interface Candidates {
  n: number[];
  prime: boolean[];
  /** Pass rate per base: 1 for primes, the strong-liar rate (< 1/4) for composites. */
  f: number[];
  primes: number;
}

const cache = new Map<RangeIx, Candidates>();

export function candidates(range: RangeIx): Candidates {
  const hit = cache.get(range);
  if (hit) return hit;
  const { lo, hi } = RANGES[range];
  const c: Candidates = { n: [], prime: [], f: [], primes: 0 };
  for (let n = lo; n <= hi; n += 2) {
    const p = isPrime(n);
    c.n.push(n);
    c.prime.push(p);
    c.f.push(p ? 1 : passRate(n));
    if (p) c.primes++;
  }
  cache.set(range, c);
  return c;
}

/** Posterior weight of candidate i after r passes. */
export const weight = (c: Candidates, i: number, r: number) => (c.prime[i] ? 1 : c.f[i] ** r);

/** The part of candidate i's weight that ends in a win for this bet. */
export function winWeight(c: Candidates, i: number, bet: Bet, tests: number, r: number): number {
  if (c.prime[i]) return bet === 'prime' ? 1 : 0;
  if (bet === 'composite') return c.f[i] ** r;
  if (bet === 'fooled') return c.f[i] ** tests;
  return 0;
}

const sumCache = new Map<string, { total: number; win: number }>();

function sums(range: RangeIx, bet: Bet, tests: number, r: number) {
  const key = `${range}|${bet}|${tests}|${r}`;
  const hit = sumCache.get(key);
  if (hit) return hit;
  const c = candidates(range);
  let total = 0;
  let win = 0;
  for (let i = 0; i < c.n.length; i++) {
    total += weight(c, i, r);
    win += winWeight(c, i, bet, tests, r);
  }
  const s = { total, win };
  sumCache.set(key, s);
  return s;
}

/** Exact P(win | r passes so far, no witness yet). */
export function chance(range: RangeIx, bet: Bet, tests: number, r = 0): number {
  const { total, win } = sums(range, bet, tests, r);
  return win / total;
}

/** Exact P(the next test passes | r passes so far). */
export function passChance(range: RangeIx, r: number): number {
  return sums(range, 'prime', 1, r + 1).total / sums(range, 'prime', 1, r).total;
}

/** Exact P(N is prime | r passes). */
export const primeChance = (range: RangeIx, r: number) => chance(range, 'prime', 1, r);

/** The fixed prize, set when the bet is placed. */
export const prize = (s: Settings) => RTP / chance(s.range, s.bet, s.tests, 0);

/** Whether the bet wins once N is known after its tests (witness = composite proven). */
export function wins(bet: Bet, n: number, allPassed: boolean): boolean {
  if (bet === 'prime') return isPrime(n);
  if (bet === 'composite') return !isPrime(n);
  return !isPrime(n) && allPassed;
}

/** Draws N uniformly from the range. */
export function drawN(range: RangeIx, rng: Rng): number {
  const c = candidates(range);
  return c.n[rng.int(c.n.length)];
}

export interface TestResult {
  base: number;
  pass: boolean;
}

/** One Miller–Rabin round with a uniform base in [2, N − 2]. */
export function runTest(n: number, rng: Rng): TestResult {
  const base = 2 + rng.int(n - 3);
  return { base, pass: passes(base, n) };
}

export const MAX_MULTIPLIER = Math.max(
  ...RANGE_IXS.flatMap((range) => BETS.flatMap((bet) => TESTS.filter((t) => allowed(bet, t)).map((tests) => prize({ range, bet, tests })))),
);
