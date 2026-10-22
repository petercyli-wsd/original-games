// Gossip: push rumour spreading on a complete graph of n nodes. One node knows
// a rumour. Each round every informed node calls one uniformly random *other*
// node and tells it. Win if everyone knows within R rounds.
//
// The theorem (Frieze–Grimmett 1985, Pittel 1987): the number of rounds until
// everyone knows is log₂n + ln n + O(1). Early on almost every call reaches
// someone new, so the informed count doubles (the log₂n doubling phase). Once
// most nodes know, most calls are wasted on people who already know, and each
// uninformed node is missed by all i callers with chance (1 − 1/(n−1))^i ≈ 1/e,
// so the uninformed count shrinks by a factor of about e per round (the ln n
// mop-up phase).
//
// Exact odds. By symmetry only the informed count i matters. Each of the i
// callers is informed, so every uninformed node is one of its n − 1 "others":
// each call lands on any given uninformed node with chance 1/(n − 1),
// independently. The number K of new nodes in a round is therefore the number
// of distinct boxes hit among u = n − i marked boxes when i balls are thrown
// into N = n − 1 boxes (an occupancy distribution):
//
//   P(K = k) = C(u, k) Σ_j (−1)^j C(k, j) ((N − u + k − j)/N)^i.
//
// The alternating sum cancels badly, so prices use the all-positive one-ball
// recursion (ball b hits a new marked box with chance (u − h)/N), which the
// tests check against the closed form. Then, with r rounds left,
//
//   W(n, ·) = 1,  W(i, 0) = 0 (i < n),  W(i, r) = Σ_k P(K = k | i)·W(i + k, r − 1).
//
// All terms are positive. W(i, r) > 0 exactly when i·2^r ≥ n (the count can at
// most double), and the round ends as a loss as soon as that fails.
//
// Pricing (fixed prize). prize = RTP / W(1, R) is locked at the bet and the
// cash-out is prize × W(i, r). The recursion above is exactly
// E[W after a round] = W before, so the cash-out is a martingale starting at
// RTP, and by optional stopping every cash-out rule returns exactly RTP. The
// cash-out never exceeds the prize, so the largest payout is the largest prize
// on offer (MAX_MULTIPLIER); no cap is needed.

import type { Rng, Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

/** Network sizes. */
export const SIZES = [8, 12, 16, 24, 32] as const;
export type Size = (typeof SIZES)[number];

/** Round budgets on offer per size: every headline chance lies in about [0.02%, 98%]. */
export const BUDGETS: Record<Size, { min: number; max: number }> = {
  8: { min: 3, max: 8 },
  12: { min: 4, max: 9 },
  16: { min: 5, max: 10 },
  24: { min: 6, max: 11 },
  32: { min: 6, max: 12 },
};

export const VOLATILITY: Record<Volatility, { n: Size; R: number }> = {
  low: { n: 8, R: 6 },
  medium: { n: 16, R: 6 },
  high: { n: 24, R: 6 },
  extreme: { n: 12, R: 4 },
};

/** Rounds tabulated for W (enough for the finish-time chart and the mean). */
export const TOP_ROUNDS = 40;

export const clampBudget = (n: Size, R: number) => Math.min(BUDGETS[n].max, Math.max(BUDGETS[n].min, Math.round(R)));

const spreadCache = new Map<number, Float64Array[]>();

/**
 * spreadTable(n)[i][k] = chance that a round with i informed callers informs
 * exactly k new nodes (k = 0..n − i). Built by the one-call recursion.
 */
export function spreadTable(n: number): Float64Array[] {
  let t = spreadCache.get(n);
  if (t) return t;
  const N = n - 1;
  t = [new Float64Array(n + 1)];
  t[0][0] = 1;
  for (let i = 1; i <= n; i++) {
    const u = n - i;
    let dp = new Float64Array(u + 1);
    dp[0] = 1;
    for (let b = 0; b < i; b++) {
      const nd = new Float64Array(u + 1);
      for (let h = 0; h <= u; h++) {
        if (dp[h] === 0) continue;
        const p = (u - h) / N;
        nd[h] += dp[h] * (1 - p);
        if (h < u) nd[h + 1] += dp[h] * p;
      }
      dp = nd;
    }
    t.push(dp);
  }
  spreadCache.set(n, t);
  return t;
}

/**
 * The occupancy closed form for P(K = k | i), evaluated exactly in integers
 * (BigInt) so the alternating sum cannot cancel: C(u, k)·Σ_j (−1)^j C(k, j)(N − u + k − j)^i / N^i.
 * Used by the tests to check the recursion.
 */
export function occupancy(n: number, i: number, k: number): number {
  const N = n - 1;
  const u = n - i;
  if (k < 0 || k > u) return 0;
  const bc = (a: number, b: number) => {
    let c = 1n;
    for (let j = 0; j < b; j++) c = (c * BigInt(a - j)) / BigInt(j + 1);
    return c;
  };
  let s = 0n;
  for (let j = 0; j <= k; j++) s += (j % 2 ? -1n : 1n) * bc(k, j) * BigInt(N - u + k - j) ** BigInt(i);
  const num = bc(u, k) * s;
  const SCALE = 10n ** 30n;
  return Number((num * SCALE) / BigInt(N) ** BigInt(i)) / 1e30;
}

export function binom(a: number, b: number): number {
  if (b < 0 || b > a) return 0;
  let c = 1;
  for (let j = 0; j < b; j++) c = (c * (a - j)) / (j + 1);
  return c;
}

const winCache = new Map<number, Float64Array[]>();

/** winTable(n)[r][i] = W(i, r): chance that i informed reach all n within r rounds. */
export function winTable(n: number): Float64Array[] {
  let t = winCache.get(n);
  if (t) return t;
  const sp = spreadTable(n);
  t = [new Float64Array(n + 1)];
  t[0][n] = 1;
  for (let r = 1; r <= TOP_ROUNDS; r++) {
    const prev = t[r - 1];
    const w = new Float64Array(n + 1);
    w[n] = 1;
    for (let i = 1; i < n; i++) {
      const d = sp[i];
      let s = 0;
      for (let k = 0; k < d.length; k++) s += d[k] * prev[i + k];
      w[i] = s;
    }
    t.push(w);
  }
  winCache.set(n, t);
  return t;
}

/** Exact chance that i informed nodes (of n) inform everyone within r rounds. */
export function winChance(n: number, i: number, r: number): number {
  if (i >= n) return 1;
  if (r <= 0 || i <= 0) return 0;
  return winTable(n)[Math.min(r, TOP_ROUNDS)][i];
}

/** Whether everyone can still be reached: the informed count at most doubles per round. */
export const reachable = (n: number, i: number, r: number) => i >= n || i * 2 ** Math.max(0, r) >= n;

export const headline = (n: number, R: number) => winChance(n, 1, R);
export const prizeFor = (n: number, R: number) => RTP / headline(n, R);

/**
 * When the last node hears it, counted in rounds from now: finishShares(n, i, H)[s]
 * for s = 1..H is P(finish in exactly round s), and [H + 1] is P(later than H).
 * Index 0 is P(already done). The shares up to r are exactly W(i, r).
 */
export function finishShares(n: number, i: number, H: number): number[] {
  const out = new Array<number>(H + 2).fill(0);
  if (i >= n) {
    out[0] = 1;
    return out;
  }
  let prev = 0;
  for (let s = 1; s <= H; s++) {
    const w = winChance(n, i, s);
    out[s] = Math.max(0, w - prev);
    prev = w;
  }
  out[H + 1] = Math.max(0, 1 - prev);
  return out;
}

/** Exact mean number of rounds to inform everyone from one node: Σ_r (1 − W(1, r)). */
export function meanRounds(n: number): number {
  let s = 0;
  for (let r = 0; r <= TOP_ROUNDS; r++) s += 1 - winChance(n, 1, r);
  return s;
}

/** The asymptotic spread time log₂n + ln n. */
export const spreadEstimate = (n: number) => Math.log2(n) + Math.log(n);

/** Chance the next round leaves everyone out of reach (W becomes 0). */
export function deadChance(n: number, i: number, r: number): number {
  if (i >= n || r <= 0) return 0;
  const d = spreadTable(n)[i];
  let s = 0;
  for (let k = 0; k < d.length; k++) if (!reachable(n, i + k, r - 1)) s += d[k];
  return s;
}

/** Expected new nodes next round: u·(1 − (1 − 1/(n−1))^i). */
export const expectedNew = (n: number, i: number) => (n - i) * (1 - (1 - 1 / (n - 1)) ** i);

export interface Call {
  from: number;
  to: number;
  /** The target did not know before this round. */
  fresh: boolean;
}

/** One round of the raw process: every informed node calls a uniform other node. */
export function playRound(n: number, informed: readonly boolean[], rng: Rng): { calls: Call[]; informed: boolean[] } {
  const next = informed.slice();
  const calls: Call[] = [];
  for (let from = 0; from < n; from++) {
    if (!informed[from]) continue;
    let to = rng.int(n - 1);
    if (to >= from) to++;
    calls.push({ from, to, fresh: !informed[to] && !next[to] });
    next[to] = true;
  }
  return { calls, informed: next };
}

export const countOf = (informed: readonly boolean[]) => informed.reduce((c, on) => c + (on ? 1 : 0), 0);

export const startInformed = (n: number) => Array.from({ length: n }, (_, j) => j === 0);

/** "doubling" while at most half know (most calls find someone new), then "mop-up". */
export const phaseOf = (n: number, i: number): 'doubling' | 'mop-up' => (i * 2 <= n ? 'doubling' : 'mop-up');

export function volatilityOf(n: number, R: number): Volatility {
  const p = headline(n, R);
  return p > 0.3 ? 'low' : p > 0.08 ? 'medium' : p > 0.01 ? 'high' : 'extreme';
}

/** The budget for size n whose headline chance is closest to p (keeps the feel when the size changes). */
export function budgetNear(n: Size, p: number): number {
  const { min, max } = BUDGETS[n];
  let best = min;
  for (let R = min; R <= max; R++) if (Math.abs(Math.log(headline(n, R) / p)) < Math.abs(Math.log(headline(n, best) / p))) best = R;
  return best;
}

/** The largest prize on offer: no cash-out can exceed its round's prize. */
export const MAX_MULTIPLIER = Math.max(...SIZES.map((n) => prizeFor(n, BUDGETS[n].min)));
