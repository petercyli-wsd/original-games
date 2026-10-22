// Deep: keys drawn uniformly from [0, 1] are inserted, one at a time, into a
// binary search tree (root at depth 0). Place all K keys without any key
// sitting deeper than the limit H and the round pays a fixed prize.
//
// The geometry. The n keys so far cut [0, 1] into n + 1 gaps. Every gap is
// one empty slot of the tree: a new key that falls in the gap (a, b) between
// neighbouring keys is compared on its way down with exactly the ancestors
// of a and b, and ends as a child of the deeper of the two. So the gap has a
// fixed "slot depth" d = max(depth a, depth b) + 1 (an end gap uses its one
// neighbour), and the board draws it as a ledge at row d spanning (a, b).
// Ledges below the limit are red: the next key busts exactly when it lands in
// a red gap, so the red length on the number line is the next key's bust
// chance, literally. A key landing at x in a gap of depth d splits it into
// two gaps of depth d + 1, and nothing else changes.
//
// The theorem. Uniform keys arrive in uniformly random relative order, so
// the tree is a random BST, the same shapes as quicksort's recursion. Let
// h(n, c) = P(a random BST on n keys has height ≤ c) (one key: height 0).
// The root is uniform among the n ranks, and both subtrees are again random
// BSTs, so
//     h(0, c) = 1,  h(n, −1) = 0 (n ≥ 1),
//     h(n, c) = (1/n) · Σ_{r=1..n} h(r − 1, c − 1) · h(n − r, c − 1).
// The headline chance to place K keys within depth H is h(K, H).
//
// Live odds, exactly. Keys that fall into the same gap never interact with
// keys in other gaps: the j keys that land in a gap of slot depth d grow a
// random BST of their own hanging from that slot, and it fits iff its height
// is ≤ H − d. The m keys still to come split among the gaps multinomially
// with chances equal to the gap lengths L_i. Hence
//     P(win | tree) = Σ_{j_1+…+j_g = m} m!/(j_1!…j_g!) Π_i L_i^{j_i} h(j_i, H − d_i)
//                   = m! · [z^m] Π_i F_{H − d_i}(L_i z),   F_c(z) = Σ_j h(j, c) z^j / j!,
// a product of truncated polynomials (degree ≤ m ≤ 20): exact, no sampling.
// A red gap has c < 0, so F = 1: a key there contributes nothing (it busts).
//
// Pricing (fixed prize). A full win pays prize = RTP / h(K, H). At every
// checkpoint the cash-out is prize × P(win | tree). By the tower property
// E[P(win | next tree)] = P(win | tree) (a bust has P = 0), so the cash-out
// is a martingale that starts at RTP. Every round ends within K keys, so by
// optional stopping every strategy (any cash-out rule, playing to the end)
// returns exactly RTP. The cash-out never exceeds the prize, so the largest
// prize on offer is an honest maxMultiplier and no max-win cap is needed.
//
// No dead ends. A key landing in a slot of depth d ≤ H uses exactly one of the
// 2^(H − d + 1) − 1 positions the perfect tree of height H has below that
// slot, and leaves the other positions as its two child slots. So the room
// left within the limit is always 2^(H + 1) − 1 − n, every offered target K
// fits, and P(win | tree) > 0 while the round is alive.
//
// One exact shortcut: if no gap is red and even a chain of all m remaining
// keys from the deepest gap stays within H, nothing can bust, P = 1, and the
// rest of the keys drop automatically for the full prize. It is an integer
// test, so no floating comparison decides it.
//
// The landing profile. If the next key lands at a fraction u of a gap of
// length L and depth d, that gap becomes two gaps L·u and L·(1 − u) at d + 1,
// so P(win | tree + key) is a polynomial in u: an arch over each gap, flat
// zero over red gaps. The board draws these arches, and their average height
// over [0, 1] is exactly the current P(win) (the martingale, drawn).
//
// Tie rule. A key equal to an existing key goes right (the gap with lo = x),
// as in BST insertion with "x < key ? left : right". Gaps of zero length
// carry no probability and are ignored by the sure test.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

/** Depth limits: no key may sit deeper than this (the root is depth 0). */
export const LIMITS = [3, 4, 5, 6] as const;
export type Limit = (typeof LIMITS)[number];

/** Keys to place, per limit (the round pays out when the last one lands within the limit). */
export const KEY_CHOICES: Record<Limit, readonly number[]> = {
  3: [6, 8, 10, 12, 14],
  4: [8, 10, 12, 14, 16],
  5: [10, 12, 14, 16, 18],
  6: [12, 14, 16, 18, 20],
};

/** The eval's configs, one per volatility level. */
export const VOLATILITY: Record<Volatility, { limit: Limit; keys: number }> = {
  low: { limit: 5, keys: 12 },
  medium: { limit: 4, keys: 12 },
  high: { limit: 3, keys: 10 },
  extreme: { limit: 3, keys: 12 },
};

// ---------- Random BST heights ----------

const hTable = new Map<number, Float64Array>();

/** Most keys a tree of height ≤ c can hold. */
export const fullSize = (c: number) => (c < 0 ? 0 : 2 ** (c + 1) - 1);

/** h(n, c): chance that a random BST on n keys has height ≤ c (empty tree: height −1). */
export function heightAtMost(n: number, c: number): number {
  if (n === 0) return 1;
  if (c < 0 || n > fullSize(c)) return 0;
  let row = hTable.get(c);
  if (!row) {
    const N = fullSize(c);
    row = new Float64Array(N + 1);
    row[0] = 1;
    for (let k = 1; k <= N; k++) {
      let s = 0;
      for (let r = 1; r <= k; r++) s += heightAtMost(r - 1, c - 1) * heightAtMost(k - r, c - 1);
      row[k] = s / k;
    }
    hTable.set(c, row);
  }
  return row[n];
}

/** Headline chance: K keys all land within depth H. */
export const winChanceAtStart = (keys: number, limit: number) => heightAtMost(keys, limit);

/** The fixed prize for placing every key. */
export const prizeFor = (keys: number, limit: number) => RTP / heightAtMost(keys, limit);

export function volatilityOf(keys: number, limit: number): Volatility {
  const p = heightAtMost(keys, limit);
  return p >= 0.4 ? 'low' : p >= 0.12 ? 'medium' : p >= 0.02 ? 'high' : 'extreme';
}

/** Largest prize on offer: every cash-out is prize × a probability, so this bounds every payout. */
export const MAX_MULTIPLIER = Math.max(...LIMITS.flatMap((H) => KEY_CHOICES[H].map((K) => prizeFor(K, H))));

// ---------- The tree as gaps ----------

export interface Key {
  x: number;
  depth: number;
  /** Index of the parent key (−1 for the root). */
  parent: number;
}

/** An empty slot: the interval (lo, hi) between neighbouring keys and the depth a key landing there gets. */
export interface Gap {
  lo: number;
  hi: number;
  depth: number;
  /** Indices of the bounding keys (−1 at the ends of [0, 1]). */
  left: number;
  right: number;
}

export interface Tree {
  keys: Key[];
  /** Left to right; they tile [0, 1]. */
  gaps: Gap[];
}

export const emptyTree = (): Tree => ({ keys: [], gaps: [{ lo: 0, hi: 1, depth: 0, left: -1, right: -1 }] });

/** Index of the gap a key at x falls in (lo ≤ x < hi; ties go right). */
export function gapAt(gaps: readonly Gap[], x: number): number {
  let lo = 0;
  let hi = gaps.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (gaps[mid].lo <= x) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Inserts a key: it takes its gap's slot depth and splits the gap into two one level deeper. */
export function insert(tree: Tree, x: number): { tree: Tree; key: Key; gap: number } {
  const i = gapAt(tree.gaps, x);
  const g = tree.gaps[i];
  const depth = g.depth;
  // The parent is the deeper of the two neighbours (one is the other's ancestor).
  const parent = depth === 0 ? -1 : g.left >= 0 && tree.keys[g.left].depth === depth - 1 ? g.left : g.right;
  const key: Key = { x, depth, parent };
  const k = tree.keys.length;
  const gaps = [
    ...tree.gaps.slice(0, i),
    { lo: g.lo, hi: x, depth: depth + 1, left: g.left, right: k },
    { lo: x, hi: g.hi, depth: depth + 1, left: k, right: g.right },
    ...tree.gaps.slice(i + 1),
  ];
  return { tree: { keys: [...tree.keys, key], gaps }, key, gap: i };
}

/** Total length of gaps at exactly depth d. */
const lengthAt = (gaps: readonly Gap[], test: (d: number) => boolean) =>
  gaps.reduce((s, g) => (test(g.depth) ? s + (g.hi - g.lo) : s), 0);

/** The next key's bust chance: the red length (gaps below the limit). */
export const bustChance = (gaps: readonly Gap[], limit: number) => lengthAt(gaps, (d) => d > limit);

/** Chance the next key lands on the last allowed level (safe, but it opens red below itself). */
export const edgeChance = (gaps: readonly Gap[], limit: number) => lengthAt(gaps, (d) => d === limit);

/** No way left to bust: P(win) = 1 exactly. */
export function sure(gaps: readonly Gap[], left: number, limit: number): boolean {
  if (left === 0) return true;
  let deepest = -1;
  for (const g of gaps) if (g.hi > g.lo) deepest = Math.max(deepest, g.depth);
  return deepest + left - 1 <= limit;
}

const invFact: number[] = [1];
const fact = (n: number) => {
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return f;
};
function inverseFactorial(j: number) {
  while (invFact.length <= j) invFact.push(invFact[invFact.length - 1] / invFact.length);
  return invFact[j];
}

/**
 * P(win | tree): the chance that the `left` keys still to come all land
 * within the limit. m! · [z^m] Π_gaps F_{H−d}(L z), exactly (see the header).
 */
export function winChance(gaps: readonly Gap[], left: number, limit: number): number {
  if (left === 0) return 1;
  if (sure(gaps, left, limit)) return 1;
  return seriesChance(gaps, left, limit);
}

/** The bare formula m! · [z^m] Π F_{H−d}(L z), without the sure shortcut (the tests compare the two). */
export function seriesChance(gaps: readonly Gap[], left: number, limit: number): number {
  let acc = unit(left);
  for (const g of gaps) acc = times(acc, slotSeries(g.hi - g.lo, limit - g.depth, left));
  return clamp01(acc[left] * fact(left));
}

const clamp01 = (p: number) => Math.min(1, Math.max(0, p));

/** The series 1 (truncated at degree m). */
function unit(m: number) {
  const a = new Float64Array(m + 1);
  a[0] = 1;
  return a;
}

/** F_c(L z) = Σ_j h(j, c) (L z)^j / j!, truncated at degree m. c < 0 (a red slot) gives 1. */
function slotSeries(L: number, c: number, m: number): Float64Array {
  const t = unit(m);
  if (L <= 0 || c < 0) return t;
  let pow = 1;
  for (let j = 1; j <= m; j++) {
    pow *= L;
    t[j] = heightAtMost(j, c) * pow * inverseFactorial(j);
  }
  return t;
}

/** Product of two series, truncated at the shorter one's degree. */
function times(a: Float64Array, b: Float64Array): Float64Array {
  const m = Math.min(a.length, b.length) - 1;
  const out = new Float64Array(m + 1);
  for (let i = 0; i <= m; i++) {
    const v = a[i];
    if (v === 0) continue;
    for (let j = 0; i + j <= m; j++) out[i + j] += v * b[j];
  }
  return out;
}

export interface ProfilePoint {
  x: number;
  /** P(win) if the next key lands at x (0 over red gaps). */
  p: number;
}

/**
 * The landing profile: for each gap, P(win | the next key lands at x) at a
 * few points across it (both ends included). One arch per gap, in order.
 * `left` is the number of keys still to place, including the next one.
 */
export function landingProfile(gaps: readonly Gap[], left: number, limit: number, resolution = 220): ProfilePoint[][] {
  const m = left - 1; // keys after the next one
  const n = gaps.length;
  // Prefix and suffix products, so each gap's "everything else" is one product.
  const pre: Float64Array[] = [unit(Math.max(m, 0))];
  for (let i = 0; i < n; i++) pre.push(times(pre[i], slotSeries(gaps[i].hi - gaps[i].lo, limit - gaps[i].depth, Math.max(m, 0))));
  const suf: Float64Array[] = new Array(n + 1);
  suf[n] = unit(Math.max(m, 0));
  for (let i = n - 1; i >= 0; i--) suf[i] = times(suf[i + 1], slotSeries(gaps[i].hi - gaps[i].lo, limit - gaps[i].depth, Math.max(m, 0)));
  const fm = fact(Math.max(m, 0));

  return gaps.map((g, i) => {
    const L = g.hi - g.lo;
    const samples = Math.max(2, Math.min(48, Math.ceil(L * resolution) + 1));
    const xs = Array.from({ length: samples }, (_, k) => g.lo + (L * k) / (samples - 1));
    if (g.depth > limit) return xs.map((x) => ({ x, p: 0 }));
    if (m === 0) return xs.map((x) => ({ x, p: 1 }));
    const others = times(pre[i], suf[i + 1]);
    const c = limit - g.depth - 1;
    return xs.map((x) => {
      const u = L > 0 ? (x - g.lo) / L : 0;
      const s = times(times(others, slotSeries(L * u, c, m)), slotSeries(L * (1 - u), c, m));
      return { x, p: clamp01(s[m] * fm) };
    });
  });
}

/** P(win) if the next key lands at x: the same number the arches draw, for one point. */
export function chanceIfLandsAt(tree: Tree, x: number, keys: number, limit: number): number {
  const { tree: next, key } = insert(tree, x);
  return key.depth > limit ? 0 : winChance(next.gaps, keys - next.keys.length, limit);
}

/** The cash-out of a live tree: prize × P(win | tree). */
export const cashOut = (tree: Tree, keys: number, limit: number) =>
  prizeFor(keys, limit) * winChance(tree.gaps, keys - tree.keys.length, limit);
