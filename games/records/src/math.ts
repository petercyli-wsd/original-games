// Records: n items arrive one at a time in a uniformly random order. Item t is
// a *record* if it beats every item before it. You win if the queue produces
// at least k records.
//
// Rényi's record theorem. When item t arrives, it slots in among the t items
// seen so far at a uniformly random rank R_t ∈ {1, …, t}, and the relative
// ranks R_1, …, R_n are independent. Item t is a record exactly when it takes
// the top slot (R_t = t), so the record indicators are independent with
// P(item t is a record) = 1/t. The board shows those t slots as a ladder with
// the top one pink: the record chance is one slot in t, literally.
//
// The number of records is therefore a sum of independent Bernoulli(1/t): its
// mean is the harmonic number H_n and P(exactly m records) = c(n, m)/n!, the
// unsigned Stirling numbers of the first kind (Foata's bijection: records in a
// random order ↔ cycles of a random permutation). From any state (j items
// seen, r records) the win chance is a Poisson-binomial tail, computed exactly
// by a backward DP:
//   T(j, d) = P(at least d records among items j+1..n),
//   T(n, d) = [d ≤ 0],   T(j, d) = (1/(j+1))·T(j+1, d−1) + (j/(j+1))·T(j+1, d).
//
// Pricing (fixed prize). prize = RTP / P(win), locked at the bet, and
// cash-out = prize × P(win | j, r). P(win | state) is the conditional
// probability of one fixed event, so it is a martingale under both moves:
//   - "Next item": the recursion above is exactly E[P after] = P before.
//   - "Run to the next record": the next record after item j ≥ 1 is item m
//     with chance j/(m(m−1)), because "no record in j+1..m−1" telescopes:
//     ∏ (1 − 1/i) = j/(m−1). So Σ_m j/(m(m−1))·T(m, d−1) = T(j, d). The run
//     also stops, lost, the moment too few items remain for the target; its
//     value is 0 either way.
// By optional stopping every pace and every cash-out rule returns exactly
// RTP. The cash-out never exceeds the prize, so the largest payout is the
// largest prize on offer (MAX_MULTIPLIER).

import type { Rng, Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

/** Queue lengths. Longer queues hold more records, but late items rarely set one. */
export const ITEMS = [10, 20, 50, 100] as const;
export type Items = (typeof ITEMS)[number];

/** Record targets on offer per queue length: every headline chance lies in [0.1%, 95%]. */
export const TARGETS: Record<Items, readonly number[]> = {
  10: [2, 3, 4, 5, 6, 7],
  20: [2, 3, 4, 5, 6, 7, 8, 9],
  50: [3, 4, 5, 6, 7, 8, 9, 10, 11],
  100: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
};

export const VOLATILITY: Record<Volatility, { n: Items; k: number }> = {
  low: { n: 20, k: 3 },
  medium: { n: 50, k: 6 },
  high: { n: 100, k: 9 },
  extreme: { n: 50, k: 10 },
};

export const clampTarget = (n: Items, k: number) => {
  const ks = TARGETS[n];
  return Math.min(ks[ks.length - 1], Math.max(ks[0], k));
};

const tables = new Map<number, Float64Array[]>();

/** tailTable(n)[j][d] = P(at least d records among items j+1..n), for d = 0..n+1. Cached per n. */
export function tailTable(n: number): Float64Array[] {
  let t = tables.get(n);
  if (t) return t;
  t = Array.from({ length: n + 1 }, () => new Float64Array(n + 2));
  t[n][0] = 1;
  for (let j = n - 1; j >= 0; j--) {
    const p = 1 / (j + 1);
    t[j][0] = 1;
    for (let d = 1; d <= n + 1; d++) t[j][d] = p * t[j + 1][d - 1] + (1 - p) * t[j + 1][d];
  }
  tables.set(n, t);
  return t;
}

/** Records still needed. */
export const needed = (k: number, r: number) => Math.max(0, k - r);

/** True once the target is out of reach: fewer items remain than records needed (integer test, no tie issue). */
export const outOfReach = (n: number, k: number, j: number, r: number) => r < k && n - j < k - r;

/** Exact chance of finishing with at least k records, given j items seen and r records so far. */
export function winChance(n: number, k: number, j: number, r: number): number {
  const d = k - r;
  if (d <= 0) return 1;
  if (n - j < d) return 0;
  return tailTable(n)[j][d];
}

export const headline = (n: number, k: number) => winChance(n, k, 0, 0);
export const prizeFor = (n: number, k: number) => RTP / headline(n, k);

/** Mean number of records in n items: the harmonic number H_n. */
export function harmonic(n: number): number {
  let h = 0;
  for (let i = 1; i <= n; i++) h += 1 / i;
  return h;
}

/** The ladder: item t has t equal slots and only the top one is a record. */
export const recordChance = (t: number) => 1 / t;

/** Chance that the next record after item j is item m (m > j). Item 1 is always a record. */
export const nextRecordChance = (j: number, m: number) => (j === 0 ? (m === 1 ? 1 : 0) : m > j ? j / (m * (m - 1)) : 0);

export interface RunWindow {
  /** Items seen so far. */
  seen: number;
  /** The last item the next record may land on and still leave the target reachable. */
  until: number;
  /** P(the next record lands on items seen+1..until) = 1 − seen/until. */
  chance: number;
}

/**
 * What "Run to the next record" risks. A record after item `until` leaves too
 * few items for the target, so the run succeeds iff the next record lands in
 * (seen, until]. "No record in seen+1..until" telescopes to seen/until, so the
 * green share of the bracket [0, until] drawn under the board is the chance.
 */
export function runWindow(n: number, k: number, j: number, r: number): RunWindow | null {
  const d = k - r;
  if (d <= 0 || n - j < d) return null;
  const until = n - d + 1;
  return { seen: j, until, chance: 1 - j / until };
}

export interface FinishShare {
  /** Final record count (for the win share: the target, meaning "this many or more"). */
  count: number;
  p: number;
  win: boolean;
}

/**
 * The "where you finish" strip: every way the round can end, split by the
 * final record count if the queue were played out. Counts below k lose; the
 * last share is "k or more" and equals winChance exactly.
 */
export function finishShares(n: number, k: number, j: number, r: number): FinishShare[] {
  if (r >= k) return [{ count: k, p: 1, win: true }];
  const t = tailTable(n)[j];
  const out: FinishShare[] = [];
  for (let c = r; c < k; c++) {
    const p = (t[c - r] ?? 0) - (t[c - r + 1] ?? 0);
    if (p > 0) out.push({ count: c, p, win: false });
  }
  out.push({ count: k, p: winChance(n, k, j, r), win: true });
  return out;
}

/** Relative rank of item t among the first t items: uniform on 1..t (t = the top slot, a record). */
export const drawRank = (t: number, rng: Rng) => 1 + rng.int(t);

export const isRecord = (rank: number, t: number) => rank === t;

export const countRecords = (ranks: readonly number[]) => ranks.reduce((c, rank, i) => c + (rank === i + 1 ? 1 : 0), 0);

export type Pace = 'item' | 'run';

/**
 * One move from a live state with `ranks` revealed and `records` records.
 * 'item' reveals one item. 'run' reveals items until the next record, or until
 * the target is out of reach, or the queue ends. Returns the new ranks.
 */
export function advance(n: number, k: number, seen: number, records: number, pace: Pace, rng: Rng): number[] {
  const out: number[] = [];
  let t = seen;
  let rec = records;
  while (t < n) {
    t++;
    const rank = drawRank(t, rng);
    out.push(rank);
    const hit = isRecord(rank, t);
    if (hit) rec++;
    if (pace === 'item' || hit || outOfReach(n, k, t, rec)) break;
  }
  return out;
}

export function volatilityOf(n: number, k: number): Volatility {
  const p = headline(n, k);
  return p > 0.3 ? 'low' : p > 0.08 ? 'medium' : p > 0.01 ? 'high' : 'extreme';
}

/** The largest prize on offer: no cash-out can exceed its round's prize. */
export const MAX_MULTIPLIER = Math.max(...ITEMS.flatMap((n) => TARGETS[n].map((k) => prizeFor(n, k))));
