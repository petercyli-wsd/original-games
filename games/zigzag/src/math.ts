// Zigzag: bars of uniform random height in [0, 1) arrive one at a time and
// must alternate up, down, up, down… Fill all n slots and the round pays a
// fixed prize.
//
// The next bar's safe zone is literal: when an up is due it must land above
// the last bar (chance 1 − x), when a down is due below it (chance x).
//
// André's theorem. n uniform values alternate starting with an up with
// probability Eₙ / n!, where Eₙ are the Euler zigzag numbers
// (1, 1, 1, 2, 5, 16, 61, 272, 1385, …), the Taylor coefficients of
// sec t + tan t.
//
// The live chance is a polynomial. Let uₘ(x) be the chance that m more bars
// keep alternating, given the last bar has height x and the next must go up.
// By the reflection y ↦ 1 − y, a down from x has the same chance uₘ(1 − x).
// The next bar y must land in (x, 1) and then a down is due from y, so
//
//   u₀ = 1,   uₘ(x) = ∫ₓ¹ uₘ₋₁(1 − y) dy.
//
// Each uₘ is a polynomial of degree m with rational coefficients (these are
// the Entringer / boustrophedon polynomials: uₘ(0) = Eₘ / m!). We build them
// exactly with BigInt fractions, so nothing here is simulated or tabulated.
// The headline chance with the first bar free is ∫₀¹ uₙ₋₁(x) dx = Eₙ / n!.
//
// Either first direction. With this option the second bar may go either
// way and sets the pattern, so it can never bust: after the first bar x the
// chance is uₙ₋₁(x) + uₙ₋₁(1 − x), and the headline doubles to 2Eₙ / n!.
//
// Pricing (pattern 1, fixed prize). prize = RTP / P₀ and the cash-out is
// prize × P(win | bars so far). The recursion above says exactly that the
// average of the next chance over the next bar equals the chance now, so the
// cash-out is a martingale starting at RTP and every stopping rule returns
// RTP. The prize is the largest possible payout, so maxMultiplier is the
// largest prize (n = 12, a forced first up: 0.99 · 12! / E₁₂ ≈ 175.46×).
//
// Tie rule. A bar exactly level with the last one (probability 0) breaks the
// pattern when a direction is due. On the free second bar of "either" mode a
// tie counts as a down.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

/** Bars needed to fill the board. */
export const LENGTHS = [4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
export type Length = (typeof LENGTHS)[number];

export type Dir = 'up' | 'down';

export interface Settings {
  n: Length;
  /** The second bar may go either way (and sets the pattern). */
  either: boolean;
}

export const VOLATILITY: Record<Volatility, Settings> = {
  low: { n: 4, either: true },
  medium: { n: 6, either: false },
  high: { n: 9, either: false },
  extreme: { n: 12, either: false },
};

// ---------------------------------------------------------------- rationals

const babs = (a: bigint) => (a < 0n ? -a : a);
function gcd(a: bigint, b: bigint): bigint {
  a = babs(a);
  b = babs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

export class Q {
  readonly n: bigint;
  readonly d: bigint;
  constructor(n: bigint, d: bigint = 1n) {
    if (d === 0n) throw new RangeError('zero denominator');
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    const g = gcd(n, d) || 1n;
    this.n = n / g;
    this.d = d / g;
  }
  add(o: Q) {
    return new Q(this.n * o.d + o.n * this.d, this.d * o.d);
  }
  sub(o: Q) {
    return new Q(this.n * o.d - o.n * this.d, this.d * o.d);
  }
  mul(o: Q) {
    return new Q(this.n * o.n, this.d * o.d);
  }
  eq(o: Q) {
    return this.n === o.n && this.d === o.d;
  }
  toNumber() {
    return Number(this.n) / Number(this.d);
  }
}

const ZERO = new Q(0n);
const ONE = new Q(1n);

/** A polynomial as rational coefficients, constant term first. */
export type Poly = Q[];

/** p(1 − y) as a polynomial in y. */
function reflect(p: Poly): Poly {
  const out: Poly = p.map(() => ZERO);
  // (1 − y)^k = Σⱼ C(k, j) (−y)^j
  p.forEach((c, k) => {
    let binom = 1n;
    for (let j = 0; j <= k; j++) {
      const term = c.mul(new Q(j % 2 ? -binom : binom));
      out[j] = out[j].add(term);
      binom = (binom * BigInt(k - j)) / BigInt(j + 1);
    }
  });
  return out;
}

/** x ↦ ∫ₓ¹ p(y) dy. */
function tailIntegral(p: Poly): Poly {
  const anti: Poly = [ZERO, ...p.map((c, k) => c.mul(new Q(1n, BigInt(k + 1))))];
  const atOne = anti.reduce((s, c) => s.add(c), ZERO);
  return anti.map((c, k) => (k === 0 ? atOne.sub(c) : ZERO.sub(c)));
}

/** ∫₀¹ p. */
export function integral01(p: Poly): Q {
  return p.reduce((s, c, k) => s.add(c.mul(new Q(1n, BigInt(k + 1)))), ZERO);
}

const exact: Poly[] = [[ONE]];
const floats: number[][] = [[1]];

/** uₘ exactly: the chance m more bars alternate when the last is x and an up is due. */
export function upPolyExact(m: number): Poly {
  while (exact.length <= m) {
    const next = tailIntegral(reflect(exact[exact.length - 1]));
    exact.push(next);
    floats.push(next.map((c) => c.toNumber()));
  }
  return exact[m];
}

function horner(c: number[], x: number) {
  let s = 0;
  for (let k = c.length - 1; k >= 0; k--) s = s * x + c[k];
  return s;
}

/** uₘ(x). */
export function upChance(m: number, x: number): number {
  upPolyExact(m);
  return Math.min(1, Math.max(0, horner(floats[m], x)));
}

/** Chance m more bars alternate when the last bar is x and `dir` is due next. */
export const restChance = (m: number, x: number, dir: Dir) => upChance(m, dir === 'up' ? x : 1 - x);

/** Exact headline chance Eₙ/n! (doubled for "either"). */
export function headlineExact({ n, either }: Settings): Q {
  const p = integral01(upPolyExact(n - 1));
  return either ? p.add(p) : p;
}

const headlineCache = new Map<string, number>();
export function headline(s: Settings): number {
  const key = `${s.n}:${s.either}`;
  let v = headlineCache.get(key);
  if (v === undefined) headlineCache.set(key, (v = headlineExact(s).toNumber()));
  return v;
}

export const prizeFor = (s: Settings) => RTP / headline(s);

export const MAX_MULTIPLIER = Math.max(...LENGTHS.flatMap((n) => [false, true].map((either) => prizeFor({ n, either }))));

// ---------------------------------------------------------------- the round

/**
 * The direction the next bar must take, or 'either' for the free second bar.
 * Direction i (between bar i and bar i+1, 1-based) alternates from the first.
 */
export function nextDir(bars: readonly number[], either: boolean): Dir | 'either' | null {
  const k = bars.length;
  if (k === 0) return null;
  if (either && k === 1) return 'either';
  const first: Dir = either ? (bars[1] > bars[0] ? 'up' : 'down') : 'up';
  // Steps already taken: k − 1. The next is step k; odd steps go `first`.
  const flip = (k - 1) % 2 === 1;
  return flip ? (first === 'up' ? 'down' : 'up') : first;
}

/** The required direction of every step 1…n−1 (null = still open in "either" mode). */
export function pattern(bars: readonly number[], s: Settings): (Dir | null)[] {
  const first: Dir | null = s.either ? (bars.length >= 2 ? (bars[1] > bars[0] ? 'up' : 'down') : null) : 'up';
  return Array.from({ length: s.n - 1 }, (_, i) => (first === null ? null : i % 2 === 0 ? first : first === 'up' ? 'down' : 'up'));
}

/** Whether bar y is a legal next bar. */
export function survives(bars: readonly number[], y: number, either: boolean): boolean {
  const dir = nextDir(bars, either);
  if (dir === null || dir === 'either') return true;
  const x = bars[bars.length - 1];
  return dir === 'up' ? y > x : y < x;
}

/** Chance the next bar is legal (the literal safe zone). */
export function stepSafe(bars: readonly number[], either: boolean): number {
  const dir = nextDir(bars, either);
  if (dir === null || dir === 'either') return 1;
  const x = bars[bars.length - 1];
  return dir === 'up' ? 1 - x : x;
}

/** Exact chance to fill the board from here (bars all legal so far). */
export function winChance(bars: readonly number[], s: Settings): number {
  const k = bars.length;
  if (k === 0) return headline(s);
  if (k >= s.n) return 1;
  const m = s.n - k;
  const x = bars[k - 1];
  const dir = nextDir(bars, s.either);
  if (dir === 'either') return Math.min(1, upChance(m, x) + upChance(m, 1 - x));
  return restChance(m, x, dir as Dir);
}

/** Chance to fill the board if the next bar lands at y (0 if it breaks the pattern). */
export function chanceIfLands(bars: readonly number[], y: number, s: Settings): number {
  if (!survives(bars, y, s.either)) return 0;
  return winChance([...bars, y], s);
}

export function volatilityOf(s: Settings): Volatility {
  const p = headline(s);
  return p > 0.3 ? 'low' : p > 0.07 ? 'medium' : p > 0.02 ? 'high' : 'extreme';
}

/** Euler zigzag numbers E₀…E_N from the Seidel–Entringer (boustrophedon) triangle. */
export function eulerZigzag(N: number): bigint[] {
  const out: bigint[] = [1n];
  let row: bigint[] = [1n];
  for (let i = 1; i <= N; i++) {
    const next: bigint[] = [0n];
    for (let j = 0; j < i; j++) next.push(next[j] + row[i - 1 - j]);
    row = next;
    out.push(row[i]);
  }
  return out;
}
