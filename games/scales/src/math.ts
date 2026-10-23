// Scales: n beads drop onto a balance, one at a time. Each bead falls into
// the left or the right pan with chance ½ each, and weighs 1 to 6 with
// chance 1/6 each, so its effect on the difference D = left − right is a
// uniform draw X from {−6, …, −1, +1, …, +6} (12 values, 1/12 each). You bet
// on the final difference: Left heavier (D > 0), Right heavier (D < 0),
// Balanced (|D| ≤ 1), or Left by at least k (D ≥ k).
//
// Exact odds. With m beads still to drop, the final difference is today's D
// plus S_m = X_1 + … + X_m. The law of S_m is the m-fold convolution of the
// one-bead law, built by dynamic programming (a probability vector over
// −6m … 6m, convolved with X once per bead). So P(win | D, m) is a finite sum,
// computed exactly (to float rounding), never sampled. A bet is settled the
// moment no remaining sequence can change its result, which is exactly when
// the winning (or losing) mass is zero.
//
// Pricing (fixed prize, contract pattern 1). A bet pays prize = RTP / P(win)
// at the start, and the cash-out is prize × P(win | D, m). By the law of total
// probability P(win | D, m) = (1/12) Σ_x P(win | D + x, m − 1), so the chance
// is a martingale in the drops, the cash-out is one too, and every stopping
// rule (cash out now, at a target, or play to the end) returns exactly RTP.
// The per-bead forecast drawn on the board is those twelve terms: they
// average to the current chance.
//
// Margins k are offered only while the prize stays within MAX_PRIZE, and every
// payout is at most its prize, so MAX_MULTIPLIER is an honest bound.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;
/** No prize (and so no payout) can exceed this. */
export const MAX_PRIZE = 1000;

export const BEAD_COUNTS = [8, 12, 16, 20] as const;
export type Beads = (typeof BEAD_COUNTS)[number];

export const WEIGHTS = [1, 2, 3, 4, 5, 6] as const;
export type Side = 'L' | 'R';

/** What you back. K = Left by at least k. */
export type BetKind = 'L' | 'B' | 'R' | 'K';
export const BET_KINDS: readonly BetKind[] = ['L', 'R', 'B', 'K'];
export const BET_NAME: Record<BetKind, string> = { L: 'Left heavier', R: 'Right heavier', B: 'Balanced ±1', K: 'Left by ≥ k' };

export interface Bet {
  kind: BetKind;
  /** The margin for K (ignored otherwise). */
  k: number;
}

export const betLabel = (b: Bet) => (b.kind === 'K' ? `Left by ≥ ${b.k}` : BET_NAME[b.kind]);

/** Whether a final difference D = left − right wins the bet. */
export function wins(bet: Bet, D: number): boolean {
  switch (bet.kind) {
    case 'L':
      return D > 0;
    case 'R':
      return D < 0;
    case 'B':
      return Math.abs(D) <= 1;
    case 'K':
      return D >= bet.k;
  }
}

export interface Bead {
  side: Side;
  w: number;
}

/** The signed effect of a bead on D = left − right. */
export const effect = (b: Bead) => (b.side === 'L' ? b.w : -b.w);

/** A uniform u ∈ [0, 1) picks one of the 12 equally likely beads. */
export function beadFrom(u: number): Bead {
  const i = Math.min(11, Math.floor(u * 12));
  return { side: i < 6 ? 'L' : 'R', w: (i % 6) + 1 };
}

// ---------- The convolution DP ----------

const lawCache: Float64Array[] = [Float64Array.of(1)];

/**
 * The law of S_m, the sum of m beads' effects: entry i is P(S_m = i − 6m).
 * Built once per m by convolving with the one-bead law.
 */
export function law(m: number): Float64Array {
  for (let j = lawCache.length; j <= m; j++) {
    const prev = lawCache[j - 1];
    const next = new Float64Array(12 * j + 1);
    // prev index a ↔ value a − 6(j−1); adding x moves it to a + x + 6 in next.
    for (let a = 0; a < prev.length; a++) {
      const p = prev[a] / 12;
      if (p === 0) continue;
      for (let x = 1; x <= 6; x++) {
        next[a + 6 + x] += p;
        next[a + 6 - x] += p;
      }
    }
    lawCache.push(next);
  }
  return lawCache[m];
}

/** Exact P(the bet wins | difference D now, m beads still to drop). Returns exactly 0 or 1 once the result is certain. */
export function chance(bet: Bet, D: number, m: number): number {
  const f = law(m);
  let win = 0;
  let lose = 0;
  for (let i = 0; i < f.length; i++) {
    if (f[i] === 0) continue;
    if (wins(bet, D + i - 6 * m)) win += f[i];
    else lose += f[i];
  }
  if (lose === 0) return 1;
  if (win === 0) return 0;
  return win / (win + lose);
}

/** The distribution of the final difference given D now and m to drop: [value, probability] pairs. */
export function finalLaw(D: number, m: number): { d: number; p: number }[] {
  const f = law(m);
  const out: { d: number; p: number }[] = [];
  for (let i = 0; i < f.length; i++) if (f[i] > 0) out.push({ d: D + i - 6 * m, p: f[i] });
  return out;
}

export const openChance = (n: number, bet: Bet) => chance(bet, 0, n);
export const prizeFor = (n: number, bet: Bet) => RTP / openChance(n, bet);

// ---------- Round state ----------

export interface Pans {
  n: number;
  beads: Bead[];
}

export const diffOf = (s: Pans) => s.beads.reduce((d, b) => d + effect(b), 0);
export const totalOf = (s: Pans, side: Side) => s.beads.reduce((t, b) => t + (b.side === side ? b.w : 0), 0);
export const leftToDrop = (s: Pans) => s.n - s.beads.length;
export const chanceAt = (s: Pans, bet: Bet) => chance(bet, diffOf(s), leftToDrop(s));

export const addBead = (s: Pans, b: Bead): Pans => ({ n: s.n, beads: [...s.beads, b] });

/** 'win' or 'lose' once no remaining beads can change the result. */
export function settled(s: Pans, bet: Bet): 'win' | 'lose' | null {
  const p = chanceAt(s, bet);
  return p === 1 ? 'win' : p === 0 ? 'lose' : null;
}

export interface Forecast {
  /** Your chance after a bead of weight WEIGHTS[i] lands on that side. Each of the 12 has chance 1/12. */
  L: number[];
  R: number[];
}

/** What each possible next bead would do to your chance. The 12 values average to the chance now. */
export function forecast(s: Pans, bet: Bet): Forecast {
  const D = diffOf(s);
  const m = leftToDrop(s) - 1;
  return {
    L: WEIGHTS.map((w) => chance(bet, D + w, m)),
    R: WEIGHTS.map((w) => chance(bet, D - w, m)),
  };
}

// ---------- Margins, volatility, auto ----------

export const K_MIN = 2;

/** The largest margin k whose prize stays within MAX_PRIZE. */
export function kMax(n: number): number {
  let k = K_MIN;
  while (k + 1 <= 6 * n && prizeFor(n, { kind: 'K', k: k + 1 }) <= MAX_PRIZE) k++;
  return k;
}

export const clampK = (n: number, k: number) => Math.max(K_MIN, Math.min(kMax(n), Math.round(k)));

/** A bet is offered when it can still go either way and its prize is within the cap. */
export function allowed(n: number, bet: Bet): boolean {
  const p = openChance(n, bet);
  return p > 0 && p < 1 && RTP / p <= MAX_PRIZE;
}

export function volatilityOf(n: number, bet: Bet): Volatility {
  const p = openChance(n, bet);
  return p > 0.3 ? 'low' : p > 0.05 ? 'medium' : p > 0.012 ? 'high' : 'extreme';
}

export const VOLATILITY: Record<Volatility, { n: Beads; bet: Bet }> = {
  low: { n: 12, bet: { kind: 'L', k: 0 } },
  medium: { n: 16, bet: { kind: 'B', k: 0 } },
  high: { n: 12, bet: { kind: 'K', k: 26 } },
  extreme: { n: 8, bet: { kind: 'K', k: 30 } },
};

/** Auto cash-out targets (× stake); null = play to the end. */
export const CASH_AT = [null, 1.5, 2, 3, 5, 10] as const;
export type CashAt = (typeof CASH_AT)[number];

export interface AutoResult {
  beads: Bead[];
  multiplier: number;
  outcome: 'win' | 'lose' | 'cashed';
}

/**
 * One whole Auto round: drop until the bet is settled, or cash out as soon as
 * the cash-out reaches `cashAt` (a stopping rule, so RTP is unchanged).
 */
export function autoRound(n: number, bet: Bet, cashAt: CashAt, u: () => number): AutoResult {
  const prize = prizeFor(n, bet);
  let s: Pans = { n, beads: [] };
  for (;;) {
    s = addBead(s, beadFrom(u()));
    const r = settled(s, bet);
    if (r) return { beads: s.beads, multiplier: r === 'win' ? prize : 0, outcome: r };
    const cash = prize * chanceAt(s, bet);
    if (cashAt !== null && cash >= cashAt) return { beads: s.beads, multiplier: cash, outcome: 'cashed' };
  }
}

/** Every offered prize is within the cap, and every payout is at most its prize. */
export const MAX_MULTIPLIER = MAX_PRIZE;
