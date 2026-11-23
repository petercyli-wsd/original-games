// In Between: two posts are dealt on a 1-100 number line. Each next number
// (drawn without replacement) goes into one empty slot of a row that must stay
// in order. Fill every slot and you win.
//
// The row is [post, slot 1 ... slot m, post]. A drawn number x may take any
// free slot between its two placed neighbours (the largest placed value below
// x and the smallest above it). If there is none, x "fits nowhere" and the
// round is lost. A gap between two neighbours with no free slot is a red
// stretch of the line; a gap with a free slot is green.
//
// Pricing (a ladder): before a draw there are n undrawn numbers and s of them
// have a free slot. Surviving the draw has chance s/n, so the cash-out
// multiplies by n/s. The cash-out starts at RTP and is a martingale: whatever
// slot the player taps, E[next cash-out] = (s/n)(cash n/s) = cash. Choosing a
// slot changes the spread of results, never their average. A step with s = 0
// is never offered (the round cashes out), and a step that would pass MAX_WIN
// cashes out instead. Both are stopping rules, so RTP is unchanged.
//
// Best placement (used by Auto, Turbo and the tests). Take a gap of w undrawn
// values with j free slots. The next j draws that land in it are a uniform
// j-subset in random order, so
//   F(w, j) = (1/w) sum_x max_k  C(x-1,k-1) C(w-x,j-k) / C(w-1,j-1) * F(x-1,k-1) F(w-x,j-k)
// is the best chance of filling all j slots (x is the first draw, k the slot
// it takes). Several gaps are independent: the chance that the draws split as
// (g1, g2, ...) over the gaps is prod C(w_i,g_i) / C(n,r), r = free slots.
// So a whole row is worth  prod C(w_i,g_i) F(w_i,g_i) / C(n,r)  and the best
// slot for x maximises C(wL,gL) C(wR,gR) F(wL,gL) F(wR,gR).

import type { Rng, Volatility } from '@originals/game-sdk';

export const RTP = 0.99;
/** The line runs 1 to LINE. */
export const LINE = 100;
export const MAX_WIN = 10_000;
export const MAX_MULTIPLIER = MAX_WIN;

/** Inner slots, one chip each. */
export const SLOTS = [1, 2, 3, 4, 5] as const;
export type Slots = (typeof SLOTS)[number];

export const VOL_OF: Record<Slots, Volatility> = { 1: 'low', 2: 'medium', 3: 'high', 4: 'high', 5: 'extreme' };

/** A row: index 0 and m+1 are the posts, the rest are slots (null = free). Values stay in ascending order. */
export type Row = (number | null)[];

export const emptyRow = (a: number, b: number, m: number): Row => [a, ...Array<number | null>(m).fill(null), b];

const filledCount = (row: Row) => row.reduce<number>((c, v) => c + (v === null ? 0 : 1), 0);
export const freeSlots = (row: Row) => row.length - filledCount(row);
export const isFull = (row: Row) => freeSlots(row) === 0;

/** Undrawn numbers (every number that is not in the row). */
export const undrawn = (row: Row, size = LINE) => size - filledCount(row);

export interface Gap {
  lo: number;
  hi: number;
  /** Undrawn values strictly between lo and hi. */
  w: number;
  /** Free slots between the two. */
  g: number;
  /** Row index of the lower and upper neighbour. */
  li: number;
  hj: number;
}

/** The gaps between consecutive filled entries of the row. */
export function rowGaps(row: Row): Gap[] {
  const out: Gap[] = [];
  let li = 0;
  for (let j = 1; j < row.length; j++) {
    if (row[j] === null) continue;
    out.push({ lo: row[li]!, hi: row[j]!, w: row[j]! - row[li]! - 1, g: j - li - 1, li, hj: j });
    li = j;
  }
  return out;
}

/** s of n: how many undrawn numbers still find a free slot. */
export function fitCount(row: Row, size = LINE): { s: number; n: number } {
  let s = 0;
  for (const g of rowGaps(row)) if (g.g > 0) s += g.w;
  return { s, n: undrawn(row, size) };
}

/** The free slots a drawn number x may take (row indexes). Empty = it fits nowhere. */
export function legalSlots(row: Row, x: number): number[] {
  if (x < row[0]! || x > row[row.length - 1]!) return [];
  let li = 0;
  for (let i = 1; i < row.length - 1; i++) {
    const v = row[i];
    if (v !== null && v < x) li = i;
  }
  let hj = li + 1;
  while (row[hj] === null) hj++;
  const out: number[] = [];
  for (let i = li + 1; i < hj; i++) out.push(i);
  return out;
}

export function place(row: Row, slot: number, x: number): Row {
  const next = row.slice();
  next[slot] = x;
  return next;
}

/** The ranges of the line that would find no free slot (red) and those that would (green), by value 1..size. */
export function fitsMask(row: Row, size = LINE): boolean[] {
  const mask = Array<boolean>(size + 1).fill(false);
  for (const g of rowGaps(row)) if (g.g > 0) for (let v = g.lo + 1; v < g.hi; v++) mask[v] = true;
  return mask;
}

// ---------- exact chances ----------

const binomCache = new Map<number, number>();
export function binom(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  const key = n * 1000 + k;
  const hit = binomCache.get(key);
  if (hit !== undefined) return hit;
  let r = 1;
  for (let i = 1; i <= Math.min(k, n - k); i++) r = (r * (n - Math.min(k, n - k) + i)) / i;
  binomCache.set(key, r);
  return r;
}

const fCache = new Map<number, number>();
/** Best chance of filling all j slots of a gap of w undrawn values, given j draws fall in it. */
export function F(w: number, j: number): number {
  if (j === 0) return 1;
  if (w < j) return 0;
  const key = w * 100 + j;
  const hit = fCache.get(key);
  if (hit !== undefined) return hit;
  let total = 0;
  const denom = binom(w - 1, j - 1);
  for (let x = 1; x <= w; x++) {
    let best = 0;
    for (let k = 1; k <= j; k++) {
      const v = (binom(x - 1, k - 1) * binom(w - x, j - k) * F(x - 1, k - 1) * F(w - x, j - k)) / denom;
      if (v > best) best = v;
    }
    total += best;
  }
  const r = total / w;
  fCache.set(key, r);
  return r;
}

/** Best chance of filling every free slot of this row from here (any number of gaps). */
export function rowChance(row: Row, size = LINE): number {
  const free = freeSlots(row);
  let p = 1 / binom(undrawn(row, size), free);
  for (const g of rowGaps(row)) p *= binom(g.w, g.g) * F(g.w, g.g);
  return free === 0 ? 1 : p;
}

/** The value of putting x in `slot`: proportional to the chance of filling every slot afterwards. */
export function slotScore(row: Row, slot: number, x: number): number {
  let li = slot - 1;
  while (row[li] === null) li--;
  let hj = slot + 1;
  while (row[hj] === null) hj++;
  const wL = x - row[li]! - 1;
  const gL = slot - li - 1;
  const wR = row[hj]! - x - 1;
  const gR = hj - slot - 1;
  return binom(wL, gL) * binom(wR, gR) * F(wL, gL) * F(wR, gR);
}

export type Placement = 'best' | 'worst' | 'end' | 'random';

/** Which legal slot to take. `pick` is a uniform number in [0, 1) used by 'random'. */
export function chooseSlot(row: Row, x: number, how: Placement, pick = 0): number {
  const legal = legalSlots(row, x);
  if (legal.length === 0) return -1;
  if (how === 'end') return legal[0]!;
  if (how === 'random') return legal[Math.min(legal.length - 1, Math.floor(pick * legal.length))]!;
  let bestSlot = legal[0]!;
  let bestScore = slotScore(row, bestSlot, x);
  for (const s of legal.slice(1)) {
    const v = slotScore(row, s, x);
    if (how === 'best' ? v > bestScore + 1e-12 : v < bestScore - 1e-12) {
      bestScore = v;
      bestSlot = s;
    }
  }
  return bestSlot;
}

/** Chance (start of round) of filling every one of m slots with best placement, over all post pairs that leave room. */
const startCache = new Map<number, number>();
export function startChance(m: number): number {
  const hit = startCache.get(m);
  if (hit !== undefined) return hit;
  let sum = 0;
  let count = 0;
  for (let a = 1; a < LINE; a++)
    for (let b = a + 1; b <= LINE; b++) {
      const w = b - a - 1;
      if (w < m) continue;
      count++;
      sum += (binom(w, m) * F(w, m)) / binom(LINE - 2, m);
    }
  const r = sum / count;
  startCache.set(m, r);
  return r;
}

// ---------- the deal and the draw ----------

/** Two posts, lower first, with at least m numbers between them. `redeals` counts the deals thrown back. */
export function dealPosts(rng: Rng, m: number): { a: number; b: number; redeals: number } {
  let redeals = 0;
  for (;;) {
    const x = 1 + rng.int(LINE);
    let y = 1 + rng.int(LINE - 1);
    if (y >= x) y++;
    const a = Math.min(x, y);
    const b = Math.max(x, y);
    if (b - a - 1 >= m) return { a, b, redeals };
    redeals++;
  }
}

/** A uniformly random undrawn number. */
export function drawNumber(rng: Rng, row: Row, size = LINE): number {
  const used = new Set(row.filter((v): v is number => v !== null));
  let k = rng.int(undrawn(row, size));
  for (let v = 1; v <= size; v++) {
    if (used.has(v)) continue;
    if (k === 0) return v;
    k--;
  }
  throw new Error('no undrawn number');
}

/** The next step is not offered when nothing can fit, or when surviving it would pass MAX_WIN. */
export function stepStop(row: Row, cash: number): 'stuck' | 'cap' | null {
  const { s, n } = fitCount(row);
  if (s === 0) return 'stuck';
  if (cash * (n / s) > MAX_WIN + 1e-9) return 'cap';
  return null;
}

/** The cash-out after surviving a step from this row. */
export const afterSafe = (cash: number, row: Row) => {
  const { s, n } = fitCount(row);
  return cash * (n / s);
};
