// Line of Sight: you stand at the origin of an orchard with a tree at every
// lattice point (a, b), 1 ≤ a, b ≤ N. A tree is in sight when no other tree
// stands on the straight line from you to it. The trees on that segment are
// exactly the points k·(a/g, b/g) for k = 1 … g − 1, where g = gcd(a, b), so
//
//   (a, b) is in sight  ⇔  gcd(a, b) = 1,
//
// and a hidden tree has g − 1 trees in the way. Counting by Möbius inversion,
// the orchard holds V(N) = Σ_{d ≤ N} μ(d)·⌊N/d⌋² trees in sight (equivalently
// 2·Σ_{n ≤ N} φ(n) − 1), and V(N)/N² → 6/π² = 1/ζ(2) ≈ 60.8%: the chance that
// two random integers are coprime. Whatever the orchard size, about 61% of the
// trees are in sight and 39% are in shadow.
//
// More generally exactly V(⌊N/g⌋) trees have gcd g (scale a coprime pair by
// g), so the trees with gcd ≥ 3 ("two or more trees in the way") number
// N² − V(N) − V(⌊N/2⌋), a share tending to 1 − (1 + 1/4)·6/π² ≈ 24%.
//
// A round has k targets (k = 1, 2, 3, 5, 8), each an independent uniform tree.
// Back "In sight" (every target visible, gcd = 1), "In shadow" (every target
// hidden, gcd ≥ 2) or "Deep shadow" (gcd ≥ 3, at most 3 targets so the prize
// stays bounded).
// Each target is revealed in two stages: first its column a, then its row b.
// Once the column is shown, the target's chance is a literal count: the lit
// rows of column a over N. For In sight those are the rows coprime to a,
// Legendre's count C(a, N) = Σ_{d | a} μ(d)·⌊N/d⌋ (the hidden rows are the
// multiples of a's prime factors, a striped pattern with period rad(a)). The
// rows with gcd exactly 2 are b = 2b' with gcd(a/2, b') = 1, so Deep shadow
// lights N − C(a, N) − C(a/2, ⌊N/2⌋) rows of an even column (N − C(a, N) of
// an odd one).
//
// Pricing (fixed prize). The win chance at the bet is p^k with p = lit/N², and
// a full win pays prize = RTP / p^k. In any state S the targets are still
// independent, so
//
//   P(win | S) = Π_i P_i,   P_i = 1 or 0 once resolved, lit(a_i)/N once its
//                                 column is shown, p before,
//
// and the cash-out is prize × P(win | S). A column reveal draws a uniformly
// from 1 … N, and the average of lit(a)/N over the columns is lit/N² = p (the
// orchard is the union of its columns). A row reveal draws b uniformly, and
// the target survives with chance lit(a)/N, leaving P_i = 1. Either way
// E[cash-out after the reveal | S] = cash-out(S), so the cash-out is a
// martingale that starts at RTP, and by optional stopping every cash-out rule
// returns exactly RTP. A reveal that zeroes P (a lost target, or a column with
// no lit row: column 1 for In shadow, columns 1 and 2 for Deep shadow) ends
// the round; resolving the last
// target pays the prize. Everything is integer counting, so there are no
// floating-point boundaries to break ties on. No payout exceeds the prize, so
// maxMultiplier is the largest prize over the settings.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

/** Orchard side N: trees at (a, b) for 1 ≤ a, b ≤ N. */
export const SIZES = [10, 20, 50] as const;
export type Size = (typeof SIZES)[number];

/** Targets per round. More targets: a longer round and a bigger prize. */
export const COUNTS = [1, 2, 3, 5, 8] as const;
export type Count = (typeof COUNTS)[number];

export const BETS = ['sight', 'shadow', 'deep'] as const;
export type Bet = (typeof BETS)[number];

export const BET_LABEL: Record<Bet, string> = { sight: 'In sight', shadow: 'In shadow', deep: 'Deep shadow' };
/** For sentences: "every target in sight". */
export const BET_PHRASE: Record<Bet, string> = { sight: 'in sight', shadow: 'in shadow', deep: 'in deep shadow' };
/** The gcd condition a winning tree meets. */
export const BET_RULE: Record<Bet, string> = { sight: 'gcd = 1', shadow: 'gcd ≥ 2', deep: 'gcd ≥ 3' };

/** Most targets a bet allows: Deep shadow stops at 3 so the prize stays bounded. */
export const maxCount = (bet: Bet): Count => (bet === 'deep' ? 3 : 8);

export interface Settings {
  bet: Bet;
  size: Size;
  count: Count;
}

export const VOLATILITY: Record<Volatility, Settings> = {
  low: { bet: 'sight', size: 20, count: 1 },
  medium: { bet: 'sight', size: 20, count: 3 },
  high: { bet: 'shadow', size: 20, count: 3 },
  extreme: { bet: 'deep', size: 20, count: 3 },
};

export function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

/** Whether the tree at (a, b) can be seen from the origin. */
export const visible = (a: number, b: number) => gcd(a, b) === 1;

/** Whether a target landing on (a, b) wins the bet: the tree is "lit". */
export function wins(bet: Bet, a: number, b: number): boolean {
  const g = gcd(a, b);
  return bet === 'sight' ? g === 1 : bet === 'shadow' ? g >= 2 : g >= 3;
}

/** Prime factorisation as [prime, exponent] pairs, smallest prime first. */
export function factorise(n: number): [number, number][] {
  const out: [number, number][] = [];
  for (let p = 2; p * p <= n; p++) {
    if (n % p) continue;
    let e = 0;
    while (n % p === 0) {
      n /= p;
      e++;
    }
    out.push([p, e]);
  }
  if (n > 1) out.push([n, 1]);
  return out;
}

export const primeFactors = (n: number) => factorise(n).map(([p]) => p);

/** Möbius μ(n): 0 if a square divides n, else (−1)^(number of primes). */
export function mobius(n: number): number {
  const f = factorise(n);
  return f.some(([, e]) => e > 1) ? 0 : f.length % 2 ? -1 : 1;
}

/**
 * Rows b in 1 … N with gcd(a, b) = 1, by inclusion–exclusion over the primes
 * of a (Legendre): Σ over squarefree d | a of μ(d)·⌊N/d⌋.
 */
export function coprimeRows(a: number, N: number): number {
  const ps = primeFactors(a);
  let total = 0;
  for (let mask = 0; mask < 1 << ps.length; mask++) {
    let d = 1;
    let sign = 1;
    for (let j = 0; j < ps.length; j++) {
      if (mask & (1 << j)) {
        d *= ps[j];
        sign = -sign;
      }
    }
    total += sign * Math.floor(N / d);
  }
  return total;
}

/** Rows b in 1 … N with gcd(a, b) = 2: b = 2b' with gcd(a/2, b') = 1. */
export const gcdTwoRows = (a: number, N: number) => (a % 2 ? 0 : coprimeRows(a / 2, Math.floor(N / 2)));

/** Lit (winning) rows in column a. */
export function litRows(bet: Bet, a: number, N: number): number {
  if (bet === 'sight') return coprimeRows(a, N);
  if (bet === 'shadow') return N - coprimeRows(a, N);
  return N - coprimeRows(a, N) - gcdTwoRows(a, N);
}

/** Trees in sight in the N×N orchard: Σ_{d ≤ N} μ(d)·⌊N/d⌋². */
export function visibleCount(N: number): number {
  let v = 0;
  for (let d = 1; d <= N; d++) v += mobius(d) * Math.floor(N / d) ** 2;
  return v;
}

/** Lit (winning) trees in the whole orchard; V(⌊N/2⌋) of them have gcd exactly 2. */
export function litCount(bet: Bet, N: number): number {
  if (bet === 'sight') return visibleCount(N);
  if (bet === 'shadow') return N * N - visibleCount(N);
  return N * N - visibleCount(N) - visibleCount(Math.floor(N / 2));
}

/** Chance a fresh target wins: the lit share of the orchard. */
export const targetChance = (bet: Bet, N: number) => litCount(bet, N) / (N * N);

/** Chance every target wins, at the bet. */
export const winChance = (s: Settings) => targetChance(s.bet, s.size) ** s.count;

/** What a full win pays. */
export const prizeOf = (s: Settings) => RTP / winChance(s);

/** One target: its column a and row b, each null until revealed. */
export interface Target {
  a: number | null;
  b: number | null;
}

/** Chance this target ends up winning, given what has been revealed of it. */
export function chanceOf(s: Settings, t: Target | undefined): number {
  if (!t || t.a === null) return targetChance(s.bet, s.size);
  if (t.b === null) return litRows(s.bet, t.a, s.size) / s.size;
  return wins(s.bet, t.a, t.b) ? 1 : 0;
}

/** P(win | revealed so far). The targets are independent, so their chances multiply. */
export function liveChance(s: Settings, targets: readonly Target[]): number {
  let p = 1;
  for (let i = 0; i < s.count; i++) p *= chanceOf(s, targets[i]);
  return p;
}

/** The fair cash-out: prize × P(win | S). */
export const cashOut = (s: Settings, targets: readonly Target[]) => prizeOf(s) * liveChance(s, targets);

export interface Step {
  index: number;
  kind: 'column' | 'row';
}

/** The next reveal, or null when every target is resolved. */
export function nextStep(s: Settings, targets: readonly Target[]): Step | null {
  for (let i = 0; i < s.count; i++) {
    const t = targets[i];
    if (!t || t.a === null) return { index: i, kind: 'column' };
    if (t.b === null) return { index: i, kind: 'row' };
  }
  return null;
}

/** Applies the next reveal: value is the column a or the row b, in 1 … N. */
export function reveal(s: Settings, targets: readonly Target[], value: number): Target[] {
  const step = nextStep(s, targets);
  if (!step) throw new Error('Nothing left to reveal');
  const out = targets.map((t) => ({ ...t }));
  out[step.index] = step.kind === 'column' ? { a: value, b: null } : { a: out[step.index].a, b: value };
  return out;
}

/** Columns with no lit row: a target landing there is lost at once (column 1 for In shadow, 1 and 2 for Deep shadow). */
export function deadColumns(bet: Bet, N: number): number {
  let dead = 0;
  for (let a = 1; a <= N; a++) if (litRows(bet, a, N) === 0) dead++;
  return dead;
}

/** Chance the next reveal ends the round lost: the unlit share it is drawn from. */
export function stepRisk(s: Settings, targets: readonly Target[]): number {
  const step = nextStep(s, targets);
  if (!step) return 0;
  if (step.kind === 'row') return 1 - chanceOf(s, targets[step.index]);
  return deadColumns(s.bet, s.size) / s.size;
}

/** The trees strictly between the origin and (a, b) on the line of sight, nearest first. */
export function blockers(a: number, b: number): [number, number][] {
  const g = gcd(a, b);
  const out: [number, number][] = [];
  for (let k = 1; k < g; k++) out.push([(k * a) / g, (k * b) / g]);
  return out;
}

const SUP: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };

/** "12 = 2²·3", "7 is prime", "1". */
export function factorLabel(n: number): string {
  if (n === 1) return '1';
  const f = factorise(n);
  if (f.length === 1 && f[0][1] === 1) return `${n} is prime`;
  return `${n} = ` + f.map(([p, e]) => (e > 1 ? p + String(e).replace(/\d/g, (d) => SUP[d]) : String(p))).join('·');
}

export const ALL_SETTINGS: Settings[] = BETS.flatMap((bet) =>
  SIZES.flatMap((size) => COUNTS.filter((count) => count <= maxCount(bet)).map((count) => ({ bet, size, count }))),
);

/** Every payout is at most the prize, so this bounds any multiplier. */
export const MAX_MULTIPLIER = Math.max(...ALL_SETTINGS.map(prizeOf));

export function volatilityOf(s: Settings): Volatility {
  const p = winChance(s);
  return p > 0.3 ? 'low' : p > 0.08 ? 'medium' : p > 0.01 ? 'high' : 'extreme';
}
