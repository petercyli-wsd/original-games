// Full Set: a ring of k equal segments and a budget of D draws. Each draw
// lands on a uniformly random point of the ring and lights the segment under
// it. Win if every segment is lit before the draws run out.
//
// The coupon collector. D draws light all k segments with probability
//
//   P(win) = k!·S(D, k) / k^D = Σ_j (−1)^j C(k, j) (1 − j/k)^D,
//
// (S = Stirling numbers of the second kind: surjections D → k, over all k^D
// sequences; or inclusion–exclusion over the segments that are never hit).
// Mid-round only two numbers matter: m segments still dark and d draws left.
// The m dark segments must each be hit at least once in the d remaining draws:
//
//   W(m, d) = Σ_j (−1)^j C(m, j) (1 − j/k)^d.
//
// The board draws the next step literally: a draw lights a new segment with
// chance m/k, which is exactly the dark share of the ring. It is convenient to
// split the draws left into d = m + s: one draw for each dark segment plus s
// spares. A repeat (a lit segment) burns a spare; a repeat with no spare left
// makes the set impossible, so the round ends there (W = 0 once d < m).
//
// Numerics. The alternating sum cancels badly when W is small, so prices come
// from the all-positive one-draw recursion
//
//   W(0, d) = 1,  W(m, 0) = 0 (m ≥ 1),
//   W(m, d) = (m/k)·W(m − 1, d − 1) + (1 − m/k)·W(m, d − 1),
//
// tabulated once per ring size. The tests check it against the closed form
// (to 1e-9) and against exact BigInt Stirling numbers.
//
// Pricing (fixed prize). prize = RTP / P(win) is locked at the bet, and the
// cash-out is prize × W(m, d). W(m, d) is the conditional probability of one
// fixed event given everything drawn so far, so it is a martingale:
//   - "Draw once": the recursion above is exactly E[W after] = W before.
//   - "Hunt" draws until a new segment lights (or the spares run out). The
//     next new segment arrives on draw g with chance (1 − p)^(g−1)·p, p = m/k,
//     and Σ_g (1 − p)^(g−1)·p·W(m − 1, d − g) over g ≤ s + 1 equals W(m, d):
//     a bounded stopping time of the one-draw martingale. The hunt succeeds
//     with chance 1 − (1 − m/k)^(s+1): s + 1 tries at m/k each.
// Draw or hunt is the player's choice of pace, and both leave the value
// unchanged. By optional stopping every pace and every cash-out rule returns
// exactly RTP. The cash-out never exceeds the prize, so the largest payout is
// the largest prize on offer (MAX_MULTIPLIER); no cap is needed.

import type { Rng, Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

/** Ring sizes. More segments make longer rounds (k·H_k draws on average). */
export const SEGMENTS = [4, 6, 8, 12] as const;
export type Segments = (typeof SEGMENTS)[number];

/** Draw budgets on offer per ring: every headline chance lies in about [0.1%, 96%]. */
export const BUDGETS: Record<Segments, { min: number; max: number }> = {
  4: { min: 4, max: 16 },
  6: { min: 6, max: 27 },
  8: { min: 8, max: 38 },
  12: { min: 14, max: 60 },
};

export const VOLATILITY: Record<Volatility, { k: Segments; D: number }> = {
  low: { k: 4, D: 12 },
  medium: { k: 6, D: 12 },
  high: { k: 8, D: 12 },
  extreme: { k: 12, D: 18 },
};

export const clampBudget = (k: Segments, D: number) => Math.min(BUDGETS[k].max, Math.max(BUDGETS[k].min, Math.round(D)));

const tables = new Map<number, Float64Array[]>();

/** winTable(k)[m][d] = W(m, d), for m = 0..k and d = 0..max budget. Cached per ring. */
export function winTable(k: number): Float64Array[] {
  let t = tables.get(k);
  if (t) return t;
  const top = BUDGETS[k as Segments]?.max ?? 4 * k;
  t = Array.from({ length: k + 1 }, () => new Float64Array(top + 1));
  t[0].fill(1);
  for (let m = 1; m <= k; m++) {
    const p = m / k;
    for (let d = 1; d <= top; d++) t[m][d] = p * t[m - 1][d - 1] + (1 - p) * t[m][d - 1];
  }
  tables.set(k, t);
  return t;
}

/** Exact chance that m dark segments all get hit within d draws on a ring of k. */
export function winChance(k: number, m: number, d: number): number {
  if (m <= 0) return 1;
  if (d < m) return 0;
  const t = winTable(k);
  if (d < t[m].length) return t[m][d];
  return inclusionExclusion(k, m, d);
}

/** The closed form Σ_j (−1)^j C(m, j)(1 − j/k)^d (for display and tests; it cancels when small). */
export function inclusionExclusion(k: number, m: number, d: number): number {
  let sum = 0;
  let binom = 1;
  for (let j = 0; j <= m; j++) {
    sum += (j % 2 ? -1 : 1) * binom * (1 - j / k) ** d;
    binom = (binom * (m - j)) / (j + 1);
  }
  return sum;
}

/** Chance to light all k segments with D draws: k!·S(D, k)/k^D. */
export const headline = (k: number, D: number) => winChance(k, k, D);
export const prizeFor = (k: number, D: number) => RTP / headline(k, D);

/** Chance the next draw lights a new segment: the dark share of the ring. */
export const newChance = (k: number, m: number) => m / k;

/** Spare draws: draws left beyond one per dark segment. */
export const sparesOf = (m: number, d: number) => d - m;

/** Chance a hunt lights a new segment before the spares run out: s + 1 tries at m/k. */
export function huntChance(k: number, m: number, d: number): number {
  if (m <= 0 || d < m) return 0;
  return 1 - (1 - m / k) ** (d - m + 1);
}

/** Average draws to light all k segments: k·H_k. */
export function averageDraws(k: number): number {
  let h = 0;
  for (let i = 1; i <= k; i++) h += 1 / i;
  return k * h;
}

const endTables = new Map<number, Float64Array[][]>();

/**
 * How the round ends if played on: endShares(k, m, d)[j] is the chance it
 * ends with j segments still dark (j = 0 is the full set, so [0] = W(m, d)).
 * A repeat with no spare ends the round with the current m dark, so
 *   E(m, d) = (m/k)·E(m − 1, d − 1) + (1 − m/k)·(d − 1 ≥ m ? E(m, d − 1) : δ_m).
 */
export function endShares(k: number, m: number, d: number): Float64Array {
  const out = new Float64Array(k + 1);
  if (m <= 0) {
    out[0] = 1;
    return out;
  }
  if (d < m) {
    out[m] = 1;
    return out;
  }
  let t = endTables.get(k);
  if (!t) {
    const top = BUDGETS[k as Segments]?.max ?? 4 * k;
    t = Array.from({ length: k + 1 }, () => Array.from({ length: top + 1 }, () => new Float64Array(k + 1)));
    for (let dd = 0; dd <= top; dd++) t[0][dd][0] = 1;
    for (let mm = 1; mm <= k; mm++) {
      const p = mm / k;
      for (let dd = mm; dd <= top; dd++) {
        const fresh = t[mm - 1][dd - 1];
        const cell = t[mm][dd];
        for (let j = 0; j <= k; j++) cell[j] = p * fresh[j];
        if (dd - 1 >= mm) {
          const rep = t[mm][dd - 1];
          for (let j = 0; j <= k; j++) cell[j] += (1 - p) * rep[j];
        } else cell[mm] += 1 - p;
      }
    }
    endTables.set(k, t);
  }
  out.set(t[m][d]);
  return out;
}

// ---------- Geometry: the ring and where a draw lands ----------

/** Segment i covers [i/k, (i+1)/k) of a turn, clockwise from the top. */
export const segmentArc = (i: number, k: number) => ({ start: i / k, length: 1 / k });

/** The segment under ring position u ∈ [0, 1). Tie rule: a boundary belongs to the segment after it. */
export const segmentAt = (u: number, k: number) => Math.min(k - 1, Math.max(0, Math.floor(u * k)));

/** The share of the ring covered by dark segments (what the board shades as "new"). */
export const darkShare = (lit: readonly boolean[]) => lit.reduce((s, on) => s + (on ? 0 : 1 / lit.length), 0);

// ---------- Play ----------

export interface Draw {
  /** Where the draw landed, as a fraction of a turn clockwise from the top. */
  pos: number;
  seg: number;
  /** Whether it lit a new segment. */
  fresh: boolean;
}

export type Pace = 'draw' | 'hunt';

/** Which segments the draws so far have lit. */
export function litOf(k: number, draws: readonly Draw[]): boolean[] {
  const lit = new Array<boolean>(k).fill(false);
  for (const d of draws) lit[d.seg] = true;
  return lit;
}

export const darkCount = (lit: readonly boolean[]) => lit.reduce((c, on) => c + (on ? 0 : 1), 0);

/**
 * One move from a live state. 'draw' makes one draw. 'hunt' draws until a new
 * segment lights, or until a repeat leaves fewer draws than dark segments (the
 * round is then lost). Every draw lands at a uniform point of the ring.
 */
export function advance(k: number, lit: readonly boolean[], left: number, pace: Pace, rng: Rng): Draw[] {
  const seen = lit.slice();
  let m = darkCount(seen);
  let d = left;
  const out: Draw[] = [];
  while (m > 0 && d >= m) {
    const pos = rng.next();
    const seg = segmentAt(pos, k);
    const fresh = !seen[seg];
    out.push({ pos, seg, fresh });
    d--;
    if (fresh) {
      seen[seg] = true;
      m--;
    }
    if (pace === 'draw' || fresh) break;
  }
  return out;
}

export function volatilityOf(k: number, D: number): Volatility {
  const p = headline(k, D);
  return p > 0.3 ? 'low' : p > 0.08 ? 'medium' : p > 0.01 ? 'high' : 'extreme';
}

/** The budget for ring k whose headline chance is closest to p (keeps the feel when the ring changes). */
export function budgetNear(k: Segments, p: number): number {
  const { min, max } = BUDGETS[k];
  let best = min;
  for (let D = min; D <= max; D++) if (Math.abs(Math.log(headline(k, D) / p)) < Math.abs(Math.log(headline(k, best) / p))) best = D;
  return best;
}

/** The largest prize on offer: no cash-out can exceed its round's prize. */
export const MAX_MULTIPLIER = Math.max(...SEGMENTS.map((k) => prizeFor(k, BUDGETS[k].min)));
