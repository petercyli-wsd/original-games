// Last Slice: a wheel of k slices (5–8) of unequal sizes. Each spin lands
// with chance proportional to slice size, and the slice it lands on is
// removed; the wheel closes up (renormalises) around the slices left. You
// back one slice to be the last one standing.
//
// The theorem: Plackett–Luce elimination. Removing slices one at a time, each
// with chance wⱼ / W(remaining), gives exactly the same order as an exponential
// race: give every slice an independent clock Tⱼ ~ Exp(wⱼ); slices go out in
// the order their clocks ring (memorylessness makes the next ring land on j
// with chance wⱼ / W, whatever has happened so far). So slice i is last iff its
// clock rings after all the others:
//     P(i last | S) = ∫ wᵢe^(−wᵢt) Πⱼ≠ᵢ (1 − e^(−wⱼt)) dt
//                   = Σ_{A ⊆ S∖{i}} (−1)^|A| · wᵢ / (wᵢ + w(A))        (inclusion–exclusion)
// We compute it with the one-spin recursion over subsets,
//     P(i last | S) = Σ_{j ∈ S, j ≠ i} (wⱼ / W(S)) · P(i last | S ∖ {j}),   P(i last | {i}) = 1,
// at most 2^8 subsets, exact (the tests check it against inclusion–exclusion).
// Big slices get hit early, so the smallest slice is the favourite and the
// biggest the longshot. (Sibling: Half-Life uses the same law.)
//
// The recursion is the martingale step: weighting each possible next landing
// by its slice angle averages the odds it would leave back to the odds now.
//
// Pricing (fixed prize): prize = RTP / P(yours last at the start) and
//     cash-out = prize · P(yours last | slices left),
// a martingale starting at RTP, so every stopping rule returns exactly RTP.
//
// Switching (fair): at a checkpoint you may back a different slice that is
// still on the wheel. The cash-out c is kept and the prize relocks at
// c / P(new slice last), changing risk, never value. A switch whose prize
// would exceed MAX_WIN is refused (refusing an EV-neutral choice changes
// nothing), so no payout can exceed MAX_WIN, the honest maxMultiplier.
//
// Tie rule: a spin draws u = rng.next() in [0, 1) and lands on slice j iff
// cum_j ≤ u·W < cum_j + wⱼ, walking the remaining slices clockwise from A.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

export const SLICE_COUNTS = [5, 6, 7, 8] as const;
export type SliceCount = (typeof SLICE_COUNTS)[number];

export const SHAPES = ['even', 'mixed', 'steep'] as const;
export type Shape = (typeof SHAPES)[number];
/** Biggest slice ÷ smallest slice. */
export const SHAPE: Record<Shape, { label: string; ratio: number }> = {
  even: { label: 'Even', ratio: 2 },
  mixed: { label: 'Mixed', ratio: 4 },
  steep: { label: 'Steep', ratio: 12 },
};

/** No prize (including one relocked by a switch) may exceed this. */
export const MAX_WIN = 1000;
export const MAX_MULTIPLIER = MAX_WIN;

export const LETTERS = 'ABCDEFGH';

const wheelCache = new Map<string, number[]>();

/**
 * Slice sizes in wheel order (clockwise from the top, A first). Sizes grow
 * geometrically from 1 to the shape's ratio, and are dealt round the wheel
 * big, small, big, small… so neighbours differ.
 */
export function wheel(k: SliceCount, shape: Shape): number[] {
  const key = `${k}:${shape}`;
  const hit = wheelCache.get(key);
  if (hit) return hit;
  const r = SHAPE[shape].ratio;
  const byRank = Array.from({ length: k }, (_, i) => r ** (i / (k - 1)));
  const order: number[] = [];
  for (let lo = 0, hi = k - 1; lo <= hi; ) {
    order.push(hi--);
    if (lo <= hi) order.push(lo++);
  }
  const w = order.map((rank) => byRank[rank]);
  wheelCache.set(key, w);
  return w;
}

export const fullMask = (k: number) => (1 << k) - 1;
export const has = (mask: number, i: number) => ((mask >> i) & 1) === 1;
export const countAlive = (mask: number) => {
  let c = 0;
  for (let m = mask; m; m &= m - 1) c++;
  return c;
};
export const aliveList = (mask: number, k: number) => Array.from({ length: k }, (_, i) => i).filter((i) => has(mask, i));

export function totalWeight(w: readonly number[], mask: number): number {
  let W = 0;
  for (let i = 0; i < w.length; i++) if (has(mask, i)) W += w[i];
  return W;
}

const lastCache = new Map<readonly number[], Map<number, Float64Array>>();

/** P(i is the last slice | slices `mask` left), for every i (0 for slices already out). Sums to 1. */
export function lastChances(w: readonly number[], mask: number): Float64Array {
  let memo = lastCache.get(w);
  if (!memo) lastCache.set(w, (memo = new Map()));
  const hit = memo.get(mask);
  if (hit) return hit;
  const k = w.length;
  const out = new Float64Array(k);
  const alive = aliveList(mask, k);
  if (alive.length === 1) out[alive[0]] = 1;
  else if (alive.length > 1) {
    const W = totalWeight(w, mask);
    for (const j of alive) {
      const sub = lastChances(w, mask & ~(1 << j));
      const pj = w[j] / W;
      for (const i of alive) if (i !== j) out[i] += pj * sub[i];
    }
  }
  memo.set(mask, out);
  return out;
}

/** Inclusion–exclusion over subsets of rivals: an independent closed form, used by the tests. */
export function lastChanceIE(w: readonly number[], mask: number, i: number): number {
  if (!has(mask, i)) return 0;
  const rivals = aliveList(mask, w.length).filter((j) => j !== i);
  let p = 0;
  for (let s = 0; s < 1 << rivals.length; s++) {
    let sum = 0;
    let bits = 0;
    for (let b = 0; b < rivals.length; b++)
      if ((s >> b) & 1) {
        sum += w[rivals[b]];
        bits++;
      }
    p += (bits % 2 ? -1 : 1) * (w[i] / (w[i] + sum));
  }
  return p;
}

export const winChance = (w: readonly number[], mask: number, mine: number) => lastChances(w, mask)[mine];

/** The chance the next spin lands on each slice: its share of the wheel (0 for slices already out). */
export function spinChances(w: readonly number[], mask: number): number[] {
  const W = totalWeight(w, mask);
  return w.map((x, i) => (has(mask, i) ? x / W : 0));
}

export interface NextEvent {
  slice: number;
  /** Chance the next spin lands here: the slice's angle ÷ 360°. */
  prob: number;
  /** Your chance to win after it: 0 if it is your slice. */
  win: number;
}

/** Every possible landing of the next spin, in wheel order. Σ prob·win = winChance now. */
export function nextEvents(w: readonly number[], mask: number, mine: number): NextEvent[] {
  const W = totalWeight(w, mask);
  return aliveList(mask, w.length).map((j) => ({
    slice: j,
    prob: w[j] / W,
    win: j === mine ? 0 : winChance(w, mask & ~(1 << j), mine),
  }));
}

/** Where a spin with uniform u ∈ [0, 1) lands: the slice and how far into it (0–1), walking clockwise from A. */
export function landing(w: readonly number[], mask: number, u: number): { slice: number; within: number } {
  const W = totalWeight(w, mask);
  const x = u * W;
  let cum = 0;
  let last = -1;
  for (let i = 0; i < w.length; i++) {
    if (!has(mask, i)) continue;
    last = i;
    if (x < cum + w[i]) return { slice: i, within: (x - cum) / w[i] };
    cum += w[i];
  }
  return { slice: last, within: 1 - 1e-9 }; // u·W rounding up to W
}

/** The fixed prize for a fresh bet on `mine`. */
export const startPrize = (w: readonly number[], mine: number) => RTP / winChance(w, fullMask(w.length), mine);

/** The prize after switching to `mine` at a checkpoint, keeping the cash-out `cash`. Null if it would exceed MAX_WIN. */
export function relock(cash: number, w: readonly number[], mask: number, mine: number): number | null {
  if (!has(mask, mine)) return null;
  const p = winChance(w, mask, mine);
  if (!(p > 0)) return null;
  const prize = cash / p;
  return prize > MAX_WIN ? null : prize;
}

export function volatilityOf(p: number): Volatility {
  return p > 0.25 ? 'low' : p > 0.08 ? 'medium' : p > 0.02 ? 'high' : 'extreme';
}

/** The smallest, middle and biggest slices of a wheel (by size). */
export function bySize(w: readonly number[]): number[] {
  return w.map((_, i) => i).sort((a, b) => w[a] - w[b]);
}

/** The largest fresh-bet prize over every setting: the biggest slice of the steepest 8-slice wheel. */
export function maxStartPrize(): number {
  let best = 0;
  for (const k of SLICE_COUNTS)
    for (const s of SHAPES) {
      const w = wheel(k, s);
      for (let i = 0; i < k; i++) best = Math.max(best, startPrize(w, i));
    }
  return best;
}
