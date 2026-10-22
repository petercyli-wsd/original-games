// Pivot: a committee of weighted voters joins a coalition one at a time, in a
// uniformly random order. The pivot is the voter whose weight first takes the
// coalition's total to the quota or beyond. You back one voter before the
// round; you win if your voter is the pivot.
//
// Shapley–Shubik. The chance that voter i is the pivot of a uniformly random
// order is its Shapley–Shubik power index φᵢ. The indices of a committee add
// up to 1 (every order has exactly one pivot) and are not proportional to the
// weights: in the Council [5, 4, 3, 2, 1] with quota 9 they are
// 11/30, 17/60, 1/5, 7/60, 1/30.
//
// Exact odds mid-round. Say the voters in J have joined (total s < quota q)
// and your voter i (weight w) has not. The rest R (m voters, i among them)
// join in a uniformly random order, so the set T of voters ahead of i is: a
// size k uniform on 0…m−1, then a uniform k-subset of R∖{i}. Voter i tips the
// quota exactly when q − w ≤ s + sum(T) ≤ q − 1 (no prefix of T can reach the
// quota first, since its sum is smaller still). So
//   P(i pivots | J) = Σₖ N_k · k!·(m−1−k)! / m!,
// where N_k counts k-subsets of R∖{i} whose weight lands in that gap: a
// subset-sum DP over (size, sum). The numerator is an integer ≤ 10!, so
// "certain" (numerator = m!) and "impossible" (0) are exact tests.
//
// Pricing (fixed prize). Backing voter i pays prize = RTP / φᵢ, and the
// cash-out is prize · P(i pivots | J). The next voter to join is uniform over
// R, so P(· | J) is the plain average over R of the chance after each possible
// join: the cash-out is a martingale starting at RTP, and every stopping rule
// returns exactly RTP. Choosing which voter to back only moves φᵢ (so the
// volatility), never the value. The board draws that average: one equal-width
// column per voter who could join next, filled to your chance if it does; the
// green share of the columns is your chance now.
//
// Rules that end the round early (all leave every value unchanged): if your
// chance hits 0 the round is lost at once; if it hits 1 the remaining joins
// play out by themselves. The largest payout is the biggest prize,
// RTP / min φ ≈ 42.3× (a weight-1 voter in the Boss committee).

import type { Rng, Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

export interface Committee {
  id: CommitteeId;
  name: string;
  weights: readonly number[];
  quota: number;
}

export const COMMITTEE_IDS = ['council', 'board', 'assembly', 'boss'] as const;
export type CommitteeId = (typeof COMMITTEE_IDS)[number];

export const COMMITTEES: Record<CommitteeId, Committee> = {
  council: { id: 'council', name: 'Council', weights: [5, 4, 3, 2, 1], quota: 9 },
  board: { id: 'board', name: 'Board', weights: [4, 3, 3, 2, 2, 1], quota: 8 },
  assembly: { id: 'assembly', name: 'Senate', weights: [6, 5, 4, 3, 2, 2, 1, 1, 1], quota: 13 },
  boss: { id: 'boss', name: 'Boss', weights: [10, 2, 2, 1, 1, 1, 1, 1, 1, 1], quota: 13 },
};

export const totalWeight = (c: Committee) => c.weights.reduce((a, b) => a + b, 0);
export const voterName = (i: number) => String.fromCharCode(65 + i);

const FACT = [1, 1, 2, 6, 24, 120, 720, 5040, 40320, 362880, 3628800, 39916800];

const memo = new Map<string, number>();

/**
 * m!·P(voter i is the pivot | the voters in `joined` are in), as an exact
 * integer, where m is the number still to join (i among them). Returns 0 if i
 * has joined or the quota is already reached.
 */
export function pivotCount(cid: CommitteeId, i: number, joined: number): number {
  const key = `${cid}:${i}:${joined}`;
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  const { weights, quota } = COMMITTEES[cid];
  let s = 0;
  const others: number[] = [];
  weights.forEach((w, j) => {
    if (joined & (1 << j)) s += w;
    else if (j !== i) others.push(w);
  });
  let out = 0;
  if (!(joined & (1 << i)) && s < quota) {
    const lo = quota - weights[i] - s;
    const hi = quota - 1 - s;
    // N[k][t]: k-subsets of the others with weight t (t capped at hi + 1).
    const cap = hi + 1;
    let N: number[][] = [Array.from({ length: cap + 1 }, (_, t) => (t === 0 ? 1 : 0))];
    for (const w of others) {
      const next = N.map((row) => row.slice());
      next.push(new Array(cap + 1).fill(0));
      N.forEach((row, k) =>
        row.forEach((n, t) => {
          if (n) next[k + 1][Math.min(cap, t + w)] += n;
        }),
      );
      N = next;
    }
    const m = others.length + 1;
    N.forEach((row, k) => {
      let hits = 0;
      for (let t = Math.max(0, lo); t <= hi; t++) hits += row[t];
      out += hits * FACT[k] * FACT[m - 1 - k];
    });
  }
  memo.set(key, out);
  return out;
}

const remainingCount = (cid: CommitteeId, joined: number) =>
  COMMITTEES[cid].weights.filter((_, j) => !(joined & (1 << j))).length;

/** Exact chance that voter i is the pivot, given who has joined. */
export const pivotChance = (cid: CommitteeId, i: number, joined: number) => pivotCount(cid, i, joined) / FACT[remainingCount(cid, joined)];

/** The Shapley–Shubik power index: voter i's chance to be the pivot of a random order. */
export const shapley = (cid: CommitteeId, i: number) => pivotChance(cid, i, 0);
export const prizeFor = (cid: CommitteeId, i: number) => RTP / shapley(cid, i);

/** The range of coalition totals at which your voter's joining tips the quota: [from, to]. */
export function tipZone(cid: CommitteeId, i: number): { from: number; to: number } {
  const { weights, quota } = COMMITTEES[cid];
  return { from: Math.max(0, quota - weights[i]), to: quota - 1 };
}

/** "5–8", or "12" for a single total. */
export const zoneText = (z: { from: number; to: number }) => (z.from === z.to ? `${z.from}` : `${z.from}–${z.to}`);

export type Ending = 'tipped' | 'early' | 'beaten' | 'reach' | 'cashed';

export interface Round {
  committee: CommitteeId;
  backed: number;
  /** Voters in the coalition, in join order. */
  order: number[];
  status: 'live' | 'won' | 'lost';
  ending: Ending | null;
}

export const newRound = (committee: CommitteeId, backed: number): Round => ({ committee, backed, order: [], status: 'live', ending: null });

export const maskOf = (order: readonly number[]) => order.reduce((m, j) => m | (1 << j), 0);
export const coalitionSum = (cid: CommitteeId, order: readonly number[]) => order.reduce((s, j) => s + COMMITTEES[cid].weights[j], 0);
export const remaining = (r: Round) => COMMITTEES[r.committee].weights.flatMap((_, j) => (r.order.includes(j) ? [] : [j]));

/** Chance to win from here. */
export function winChance(r: Round): number {
  if (r.status !== 'live') return r.status === 'won' ? 1 : 0;
  return pivotChance(r.committee, r.backed, maskOf(r.order));
}

export const certain = (r: Round) =>
  r.status === 'live' && pivotCount(r.committee, r.backed, maskOf(r.order)) === FACT[remainingCount(r.committee, maskOf(r.order))];

export const cashValue = (r: Round) => prizeFor(r.committee, r.backed) * winChance(r);

/** Voter j joins the coalition. */
export function join(r: Round, j: number): Round {
  if (r.status !== 'live' || r.order.includes(j)) throw new Error(`voter ${j} cannot join`);
  const { weights, quota } = COMMITTEES[r.committee];
  const s = coalitionSum(r.committee, r.order);
  const order = [...r.order, j];
  if (j === r.backed) return s + weights[j] >= quota ? { ...r, order, status: 'won', ending: 'tipped' } : { ...r, order, status: 'lost', ending: 'early' };
  if (s + weights[j] >= quota) return { ...r, order, status: 'lost', ending: 'beaten' };
  const next: Round = { ...r, order };
  return pivotCount(r.committee, r.backed, maskOf(order)) === 0 ? { ...next, status: 'lost', ending: 'reach' } : next;
}

/**
 * One player action, drawn in full before anything animates: the next voter
 * joins, and while your voter is then certain to tip the quota the rest keep
 * joining by themselves until it does.
 */
export function plan(r: Round, rng: Rng): Round[] {
  const out: Round[] = [];
  let cur = r;
  do {
    const rest = remaining(cur);
    cur = join(cur, rest[rng.int(rest.length)]);
    out.push(cur);
  } while (cur.status === 'live' && certain(cur));
  return out;
}

export interface Column {
  voter: number;
  /** Your chance if this voter joins next. */
  p: number;
  /** What happens to the round if it does (null while it goes on). */
  ends: 'won' | 'lost' | null;
}

/** Every voter who could join next, with your chance if it does. Their average is your chance now. */
export function columns(r: Round): Column[] {
  if (r.status !== 'live') return [];
  return remaining(r).map((voter) => {
    const n = join(r, voter);
    return { voter, p: winChance(n), ends: n.status === 'live' ? null : n.status };
  });
}

/** The shaded share of the column chart: each column equally wide, filled to its p. */
export const shadedShare = (cols: readonly Column[]) => (cols.length ? cols.reduce((a, c) => a + c.p, 0) / cols.length : 0);

/** Share of next joins that end the round against you. */
export const nextLoss = (cols: readonly Column[]) => (cols.length ? cols.filter((c) => c.ends === 'lost').length / cols.length : 0);

export function volatilityOf(cid: CommitteeId, i: number): Volatility {
  const p = shapley(cid, i);
  return p > 0.4 ? 'low' : p > 0.15 ? 'medium' : p > 0.05 ? 'high' : 'extreme';
}

export const VOLATILITY: Record<Volatility, { committee: CommitteeId; voter: number }> = {
  low: { committee: 'boss', voter: 0 },
  medium: { committee: 'council', voter: 1 },
  high: { committee: 'assembly', voter: 3 },
  extreme: { committee: 'boss', voter: 9 },
};

/** The prize is the largest payout: cash-outs are prize × a probability. */
export const MAX_MULTIPLIER = Math.max(...COMMITTEE_IDS.flatMap((c) => COMMITTEES[c].weights.map((_, i) => prizeFor(c, i))));
