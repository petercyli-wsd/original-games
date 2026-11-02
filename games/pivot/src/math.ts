// Pivot: six blocks of sizes 7, 5, 4, 3, 2, 1 stack up one at a time, in a
// uniformly random order. The block whose top end first takes the stack to the
// line (16) or over it is the pivot. You back one block before the round; you
// win if your block is the pivot. Put plainly: your block wins if, sitting on
// the stack when it joins, its top end crosses the line. If it lands with its
// top still under the line it is too early; if another block crosses first,
// you are out.
//
// Shapley–Shubik. The chance that block i is the pivot of a uniformly random
// order is its Shapley–Shubik power index φᵢ. The indices add up to 1 (every
// order has exactly one pivot) and are not proportional to the sizes: here
// they are 27/60, 12/60, 9/60, 7/60, 4/60, 1/60, so the one board runs from
// near even money (A, 45%) to a long shot (F, 1 in 60), a 27:1 range.
//
// Exact odds mid-round. Say the blocks in J have joined (stack s < line q)
// and your block i (size w) has not. The rest R (m blocks, i among them) join
// in a uniformly random order, so the set T of blocks ahead of i is: a size k
// uniform on 0…m−1, then a uniform k-subset of R∖{i}. Block i crosses the line
// exactly when q − w ≤ s + sum(T) ≤ q − 1 (no prefix of T can reach the line
// first, since its sum is smaller still). So
//   P(i pivots | J) = Σₖ N_k · k!·(m−1−k)! / m!,
// where N_k counts k-subsets of R∖{i} whose size lands in that gap: a
// subset-sum DP over (count, sum). The numerator is an integer ≤ 6!, so
// "certain" (numerator = m!) and "impossible" (0) are exact tests.
//
// Pricing (fixed prize). Backing block i pays prize = RTP / φᵢ, and the
// cash-out is prize · P(i pivots | J). The next block to join is uniform over
// R, so P(· | J) is the plain average over R of the chance after each possible
// join: the cash-out is a martingale starting at RTP, and every stopping rule
// returns exactly RTP. Choosing which block to back only moves φᵢ (so the
// volatility), never the value.
//
// The board draws every waiting block standing on the current stack at its
// full size, so the player sees which ones would cross the line if they joined
// next. A waiting block is red exactly when its joining next leaves you no
// chance: another block crossing first, yours landing short, or a "dead end"
// (no order of the rest lets yours cross). The red count over the waiting
// count is the next join's risk, the figure on the "Next block" button.
//
// Joins that need no decision play out by themselves (both leave every value
// unchanged): while your chance is 1 (you are sure to win) or 0 (the round can
// only end with yours short or another block crossing first), the next blocks
// keep joining until the round ends. So every loss the player sees is one of
// those two. The largest payout is the biggest prize, RTP / (1/60) = 59.4×.

import type { Rng, Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

/** Block sizes, A to F. */
export const SIZES: readonly number[] = [7, 5, 4, 3, 2, 1];
/** The line: the block that takes the stack here or over it is the pivot. */
export const LINE = 16;
export const TOTAL = SIZES.reduce((a, b) => a + b, 0);
export const BLOCKS = SIZES.length;

export const blockName = (i: number) => String.fromCharCode(65 + i);

const FACT = [1, 1, 2, 6, 24, 120, 720, 5040];

const memo = new Map<string, number>();

/**
 * m!·P(block i is the pivot | the blocks in `joined` are in), as an exact
 * integer, where m is the number still to join (i among them). Returns 0 if i
 * has joined or the line is already reached.
 */
export function pivotCount(i: number, joined: number): number {
  const key = `${i}:${joined}`;
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  let s = 0;
  const others: number[] = [];
  SIZES.forEach((w, j) => {
    if (joined & (1 << j)) s += w;
    else if (j !== i) others.push(w);
  });
  let out = 0;
  if (!(joined & (1 << i)) && s < LINE) {
    const lo = LINE - SIZES[i] - s;
    const hi = LINE - 1 - s;
    // N[k][t]: k-subsets of the others with size t (t capped at hi + 1).
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

const remainingCount = (joined: number) => SIZES.filter((_, j) => !(joined & (1 << j))).length;

/** Exact chance that block i is the pivot, given who has joined. */
export const pivotChance = (i: number, joined: number) => pivotCount(i, joined) / FACT[remainingCount(joined)];

/** The Shapley–Shubik power index: block i's chance to be the pivot of a random order. */
export const startChance = (i: number) => pivotChance(i, 0);
export const prizeFor = (i: number) => RTP / startChance(i);

export type Ending = 'won' | 'early' | 'passed' | 'cashed';

export interface Round {
  backed: number;
  /** Blocks on the stack, in join order, bottom first. */
  order: number[];
  status: 'live' | 'won' | 'lost';
  ending: Ending | null;
}

export const newRound = (backed: number): Round => ({ backed, order: [], status: 'live', ending: null });

export const maskOf = (order: readonly number[]) => order.reduce((m, j) => m | (1 << j), 0);
export const totalOf = (order: readonly number[]) => order.reduce((s, j) => s + SIZES[j], 0);
export const remaining = (r: Round) => SIZES.flatMap((_, j) => (r.order.includes(j) ? [] : [j]));

/** Chance to win from here. */
export function winChance(r: Round): number {
  if (r.status !== 'live') return r.status === 'won' ? 1 : 0;
  return pivotChance(r.backed, maskOf(r.order));
}

/** True while the next join needs no decision: the round is already sure to be won, or sure to be lost. */
export function decided(r: Round): boolean {
  if (r.status !== 'live') return false;
  const n = pivotCount(r.backed, maskOf(r.order));
  return n === 0 || n === FACT[remainingCount(maskOf(r.order))];
}

export const cashValue = (r: Round) => prizeFor(r.backed) * winChance(r);

/** Block j joins the top of the stack. */
export function join(r: Round, j: number): Round {
  if (r.status !== 'live' || r.order.includes(j)) throw new Error(`block ${j} cannot join`);
  const s = totalOf(r.order);
  const order = [...r.order, j];
  if (j === r.backed) return s + SIZES[j] >= LINE ? { ...r, order, status: 'won', ending: 'won' } : { ...r, order, status: 'lost', ending: 'early' };
  if (s + SIZES[j] >= LINE) return { ...r, order, status: 'lost', ending: 'passed' };
  return { ...r, order };
}

/**
 * One player action, drawn in full before anything animates: the next block
 * joins, and while the result is then already decided (chance 1 or 0) the rest
 * keep joining by themselves until the round ends.
 */
export function plan(r: Round, rng: Rng): Round[] {
  const out: Round[] = [];
  let cur = r;
  do {
    const rest = remaining(cur);
    cur = join(cur, rest[rng.int(rest.length)]);
    out.push(cur);
  } while (decided(cur));
  return out;
}

/** Would block j, joining next, take the stack over the line? */
export const crosses = (r: Round, j: number) => totalOf(r.order) + SIZES[j] >= LINE;

export interface Column {
  block: number;
  /** Your chance if this block joins next. */
  p: number;
  /** What happens to the round if it does (null while it goes on). */
  ends: 'won' | 'lost' | null;
}

/** Every block waiting to join, with your chance if it joins next. Their average is your chance now. */
export function columns(r: Round): Column[] {
  if (r.status !== 'live') return [];
  return remaining(r).map((block) => {
    const n = join(r, block);
    return { block, p: winChance(n), ends: n.status === 'live' ? null : n.status };
  });
}

/** Share of waiting blocks drawn red: joining next would leave you no chance. */
export const nextLoss = (cols: readonly Column[]) => (cols.length ? cols.filter((c) => c.p === 0).length / cols.length : 0);

export function volatilityOf(i: number): Volatility {
  const p = startChance(i);
  return p > 0.3 ? 'low' : p > 0.12 ? 'medium' : p > 0.04 ? 'high' : 'extreme';
}

/** One block per level for the eval: A (45%), B (20%), D (11.7%), F (1.7%). */
export const VOLATILITY: Record<Volatility, number> = { low: 0, medium: 1, high: 3, extreme: 5 };

/** The prize is the largest payout: cash-outs are prize × a probability. */
export const MAX_MULTIPLIER = Math.max(...SIZES.map((_, i) => prizeFor(i)));
