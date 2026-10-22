// Mediant: a fair coin walks down the Stern–Brocot tree.
//
// Start at 1/1 with bounds 0/1 and 1/0. Each step goes Left or Right with
// chance ½: Left makes the current fraction the new upper bound, Right makes it
// the new lower bound, and the new fraction is the mediant (a+c)/(b+d) of the
// two bounds. After n steps the walk sits on one of the 2ⁿ fractions at depth
// n of the tree, each with chance exactly 1/2ⁿ, and the round is decided by
// whether that fraction lies in the window the player picked.
//
// Pricing (pattern 1, fixed prize). P(win) = (# depth-n fractions in the
// window) / 2ⁿ, counted exactly. After k steps the walk can only end on the
// 2ⁿ⁻ᵏ depth-n fractions below the current node, all equally likely, so
// P(win | path) = (# of those in the window) / 2ⁿ⁻ᵏ. The two children split
// that set in half, so P(win | path) = ½ P(win | path+L) + ½ P(win | path+R)
// exactly: cash-out = prize × P(win | path) with prize = RTP / P(win) is a
// martingale starting at RTP, and every stopping rule returns RTP. The window
// only trades chance for prize. The largest prize is RTP × 2ⁿ (one lit fraction
// at depth 10), so payouts are bounded by RTP × 1024.
//
// The board draws the number line through x ↦ x/(1+x), which maps [0, ∞] onto
// [0, 1] with 1 in the middle. That map sends mediants to mediants, so the
// tree drawn there is the Farey tree, and the share of depth-n fractions left
// of a point tends to Minkowski's question-mark function ?(x/(1+x)).
//
// Exactness: window edges sit on a grid of GRID steps in t = x/(1+x), and a
// fraction p/q (t = p/(p+q)) is in the window iff lo·(p+q) ≤ p·GRID ≤ hi·(p+q),
// compared in integers. Tie rule: a fraction exactly on an edge is inside.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

/** Number of coin flips (the depth of the final fraction). */
export const DEPTHS = [4, 6, 8, 10] as const;
export type Depth = (typeof DEPTHS)[number];

/** Window edges live on this grid in t = x/(1+x) ∈ [0, 1]. */
export const GRID = 840;
/** Narrowest window, in grid steps. */
export const MIN_WIDTH = 4;

export interface Win {
  lo: number;
  hi: number;
}

export interface Preset extends Win {
  id: string;
  label: string;
}

export const PRESETS: Preset[] = [
  { id: 'half', label: '½–2', lo: 280, hi: 560 },
  { id: 'wide', label: '¾–4/3', lo: 360, hi: 480 },
  { id: 'near', label: '0.85–1.18', lo: 386, hi: 455 },
  { id: 'tight', label: '0.9–1.1', lo: 398, hi: 440 },
  { id: 'phi', label: 'near φ', lo: 517, hi: 522 },
  { id: 'big', label: '3 and up', lo: 630, hi: 840 },
];

export const presetById = (id: string) => PRESETS.find((p) => p.id === id);

export const VOLATILITY: Record<Volatility, { preset: string; depth: Depth }> = {
  low: { preset: 'half', depth: 6 },
  medium: { preset: 'wide', depth: 8 },
  high: { preset: 'near', depth: 10 },
  extreme: { preset: 'tight', depth: 10 },
};

export type Dir = 'L' | 'R';

/** A node of the tree: its fraction p/q and the bounds lp/lq < p/q < rp/rq. */
export interface Node {
  p: number;
  q: number;
  lp: number;
  lq: number;
  rp: number;
  rq: number;
}

export const ROOT: Node = { p: 1, q: 1, lp: 0, lq: 1, rp: 1, rq: 0 };

export function child(n: Node, d: Dir): Node {
  if (d === 'L') return { p: n.lp + n.p, q: n.lq + n.q, lp: n.lp, lq: n.lq, rp: n.p, rq: n.q };
  return { p: n.p + n.rp, q: n.q + n.rq, lp: n.p, lq: n.q, rp: n.rp, rq: n.rq };
}

export const nodeAt = (path: readonly Dir[]) => path.reduce(child, ROOT);

/** Position on the drawn line: t = x/(1+x) = p/(p+q). */
export const tOf = (p: number, q: number) => p / (p + q);

/** Whether p/q lies in the window (edges included), in exact integer arithmetic. */
export function inWindow(p: number, q: number, w: Win): boolean {
  const s = p + q;
  return w.lo * s <= p * GRID && p * GRID <= w.hi * s;
}

/** The depth-`depth` fractions below node n, left to right. */
export function leavesBelow(n: Node, levels: number): Node[] {
  let row = [n];
  for (let i = 0; i < levels; i++) row = row.flatMap((m) => [child(m, 'L'), child(m, 'R')]);
  return row;
}

/** Sign of t − k/GRID for t = p/s, in integers. */
const cmpT = (p: number, s: number, k: number) => Math.sign(p * GRID - k * s);

/**
 * Depth-`levels` descendants of n that lie in the window. They all lie strictly
 * between n's bounds, so a subtree whose bounds sit inside the window is all
 * lit and one whose bounds miss it is all dark; only the subtrees cut by an
 * edge are split further. The result equals filtering leavesBelow (tested).
 */
function litBelow(n: Node, levels: number, w: Win): number {
  if (levels === 0) return inWindow(n.p, n.q, w) ? 1 : 0;
  const ls = n.lp + n.lq;
  const rs = n.rp + n.rq;
  if (cmpT(n.rp, rs, w.lo) <= 0 || cmpT(n.lp, ls, w.hi) >= 0) return 0;
  if (cmpT(n.lp, ls, w.lo) >= 0 && cmpT(n.rp, rs, w.hi) <= 0) return 2 ** levels;
  return litBelow(child(n, 'L'), levels - 1, w) + litBelow(child(n, 'R'), levels - 1, w);
}

/** Lit and reachable depth-n fractions after `path`. */
export function countLit(path: readonly Dir[], depth: number, w: Win): { lit: number; total: number } {
  const levels = depth - path.length;
  return { lit: litBelow(nodeAt(path), levels, w), total: 2 ** levels };
}

/** Exact P(the walk ends in the window | path so far). */
export function winChance(path: readonly Dir[], depth: number, w: Win): number {
  const { lit, total } = countLit(path, depth, w);
  return lit / total;
}

/** The prize for a full win, locked at bet time. Infinite if nothing is lit (the bet is then blocked). */
export const prizeFor = (depth: number, w: Win) => RTP / winChance([], depth, w);

export function volatilityOf(p: number): Volatility {
  return p > 0.3 ? 'low' : p > 0.07 ? 'medium' : p > 0.01 ? 'high' : 'extreme';
}

/** x = t/(1−t) for a grid edge, Infinity at the right end. */
export const xOfGrid = (k: number) => (k >= GRID ? Infinity : k / (GRID - k));

export function fmtX(x: number): string {
  if (!Number.isFinite(x)) return '∞';
  if (Math.abs(x - Math.round(x)) < 0.005) return String(Math.round(x));
  return x < 1 ? x.toFixed(3).replace(/0$/, '') : x.toFixed(2);
}

/** Snap a window edge to the grid and keep the window at least MIN_WIDTH wide. */
export function clampWin(lo: number, hi: number): Win {
  let a = Math.round(Math.max(0, Math.min(GRID, lo)));
  let b = Math.round(Math.max(0, Math.min(GRID, hi)));
  if (a > b) [a, b] = [b, a];
  if (b - a < MIN_WIDTH) {
    if (b + MIN_WIDTH - (b - a) <= GRID) b = a + MIN_WIDTH;
    else a = b - MIN_WIDTH;
  }
  return { lo: a, hi: b };
}

/** Every node to depth n (for drawing), cached by depth. Index i at depth d is the node with path bits of i. */
const treeCache = new Map<number, Node[][]>();
export function treeRows(depth: number): Node[][] {
  let rows = treeCache.get(depth);
  if (!rows) {
    rows = [[ROOT]];
    for (let d = 0; d < depth; d++) rows.push(rows[d].flatMap((m) => [child(m, 'L'), child(m, 'R')]));
    treeCache.set(depth, rows);
  }
  return rows;
}

/** The index of a path's node within its row of treeRows (L = 0, R = 1, first step most significant). */
export const rowIndex = (path: readonly Dir[]) => path.reduce((i, d) => i * 2 + (d === 'R' ? 1 : 0), 0);

/** Upper bound on any payout: the prize with a single lit fraction at the deepest level. */
export const MAX_MULTIPLIER = RTP * 2 ** Math.max(...DEPTHS);
