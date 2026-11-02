// Knight: a knight starts on g1 and makes HOPS = 5 uniformly random legal
// knight moves on an 8×8 board. You win if its final square is in your target:
// the rim, the centre 4×4, one corner quadrant, or a single square you pick.
// The target is the only risk control; the number of hops is fixed.
//
// The knight's walk is a Markov chain on the 64 squares. Let h_t(x) be the
// chance of ending in the target with t hops left from square x. Then
//
//   h_0(x) = [x is in the target],   h_t(x) = mean of h_{t−1}(y) over the deg(x) legal moves x → y,
//
// a 6-row table of exact averages (computed in floating point, no sampling).
// The first-step identity above is exactly the martingale property: the
// expected chance after the next hop is the chance now.
//
// Pricing (fixed prize): prize = RTP / h_5(g1); cash-out at (x, t) = prize × h_t(x).
// The cash-out is a bounded martingale that starts at RTP, so by optional
// stopping every way of deciding when to cash out (including "run to the end")
// returns exactly RTP. The payout can never exceed the prize, so maxMultiplier
// is the largest prize over every target the panel offers. Picking a different
// target before the bet only changes the prize, never the 99% value.
//
// Colour: every knight move changes square colour and g1 is dark, so after an
// odd number of hops the knight is always on a light square. Only light squares
// can be the final square; the board fills only those target squares green and
// only light squares can be picked as a single-square target.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;
/** g1: file g, rank 1. Squares are numbered x + 8y with a1 = 0, h8 = 63. */
export const START = 6;
/** Hops per round (fixed). */
export const HOPS = 5;

export type Region = 'rim' | 'centre' | 'corner' | 'square';
export const REGIONS: Region[] = ['rim', 'centre', 'corner', 'square'];
export const REGION_LABEL: Record<Region, string> = { rim: 'Rim', centre: 'Centre', corner: 'Corner', square: 'Square' };

/** Corner quadrants, named by their corner square. */
export const CORNERS = ['a8', 'h8', 'a1', 'h1'] as const;
export type Corner = (typeof CORNERS)[number];

export interface Target {
  region: Region;
  corner: Corner;
  /** The chosen square (used when region = 'square'). */
  square: number;
}

const KNIGHT_DELTAS = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
] as const;

export const fileOf = (s: number) => s % 8;
export const rankOf = (s: number) => Math.floor(s / 8);
export const squareName = (s: number) => `${'abcdefgh'[fileOf(s)]}${rankOf(s) + 1}`;
export const isLight = (s: number) => (fileOf(s) + rankOf(s)) % 2 === 1;

/** Legal knight moves from each square. */
export const MOVES: readonly (readonly number[])[] = Array.from({ length: 64 }, (_, s) => {
  const x = fileOf(s);
  const y = rankOf(s);
  return KNIGHT_DELTAS.map(([dx, dy]) => [x + dx, y + dy] as const)
    .filter(([a, b]) => a >= 0 && a < 8 && b >= 0 && b < 8)
    .map(([a, b]) => a + 8 * b);
});

export const degree = (s: number) => MOVES[s].length;
/** Σ deg over the board: twice the number of knight-move edges (2 × 168 = 336). */
export const TOTAL_DEGREE = MOVES.reduce((a, m) => a + m.length, 0);

export function inTarget(s: number, t: Target): boolean {
  const x = fileOf(s);
  const y = rankOf(s);
  switch (t.region) {
    case 'rim':
      return x === 0 || x === 7 || y === 0 || y === 7;
    case 'centre':
      return x >= 2 && x <= 5 && y >= 2 && y <= 5;
    case 'corner': {
      const right = t.corner[0] === 'h';
      const top = t.corner[1] === '8';
      return (right ? x >= 4 : x < 4) && (top ? y >= 4 : y < 4);
    }
    case 'square':
      return s === t.square;
  }
}

/** The corner quadrant a square belongs to. */
export function cornerOf(s: number): Corner {
  return `${fileOf(s) < 4 ? 'a' : 'h'}${rankOf(s) < 4 ? '1' : '8'}` as Corner;
}

export const targetKey = (t: Target) => (t.region === 'corner' ? `corner:${t.corner}` : t.region === 'square' ? `square:${t.square}` : t.region);

const tables = new Map<string, Float64Array[]>();

/** rows[t][x] = chance of ending in the target with t hops left from x (t = 0…HOPS). */
export function table(t: Target): Float64Array[] {
  const key = targetKey(t);
  const hit = tables.get(key);
  if (hit) return hit;
  const rows = [Float64Array.from({ length: 64 }, (_, s) => (inTarget(s, t) ? 1 : 0))];
  for (let k = 1; k <= HOPS; k++) {
    const prev = rows[k - 1];
    rows.push(Float64Array.from(MOVES, (ms) => ms.reduce((a, y) => a + prev[y], 0) / ms.length));
  }
  tables.set(key, rows);
  return rows;
}

/** Chance to end in the target with `left` hops to go from square s. */
export const chance = (s: number, left: number, t: Target) => table(t)[left][s];

/** Win chance at the start of a round. */
export const startChance = (t: Target) => chance(START, HOPS, t);
export const prizeFor = (t: Target) => RTP / startChance(t);

/** Distribution of the knight's square after k more hops from s (row s of the k-th matrix power). */
export function endDistribution(s: number, k: number): Float64Array {
  let v = new Float64Array(64);
  v[s] = 1;
  for (let i = 0; i < k; i++) {
    const next = new Float64Array(64);
    for (let x = 0; x < 64; x++) {
      if (v[x] === 0) continue;
      const share = v[x] / MOVES[x].length;
      for (const y of MOVES[x]) next[y] += share;
    }
    v = next;
  }
  return v;
}

/** Whether the knight can finish on square s (after 5 hops from g1: exactly the light squares). */
export const reachable = (s: number) => startChance({ region: 'square', corner: 'a8', square: s }) > 0;

export function volatilityOf(p: number): Volatility {
  return p > 0.2 ? 'low' : p > 0.06 ? 'medium' : p > 0.015 ? 'high' : 'extreme';
}

/** Cash-out after the knight lands on s with `left` hops to go. */
export const cashAt = (prize: number, s: number, left: number, t: Target) => prize * chance(s, left, t);

export type Verdict = 'win' | 'lost' | null;
/** A round ends early once the chance is exactly 0 or 1 (all table values are exact averages). */
export function verdict(s: number, left: number, t: Target): Verdict {
  const p = chance(s, left, t);
  if (p >= 1) return 'win';
  if (p <= 0) return 'lost';
  return null;
}

/**
 * Draws the hops for one button press, all decided up front: one hop ("Next
 * hop"), or every remaining hop until the result is certain ("Run to the end").
 * `pick(n)` returns a uniform index in 0…n−1 (host.rng.int).
 */
export function drawHops(from: number, left: number, t: Target, all: boolean, pick: (n: number) => number): number[] {
  const out: number[] = [];
  let s = from;
  for (let k = left; k > 0; k--) {
    s = MOVES[s][pick(MOVES[s].length)];
    out.push(s);
    if (!all || verdict(s, k - 1, t)) break;
  }
  return out;
}

/** Every target the panel can offer (single squares only where the knight can finish). */
export function allTargets(): Target[] {
  const out: Target[] = [
    { region: 'rim', corner: 'a8', square: 0 },
    { region: 'centre', corner: 'a8', square: 0 },
  ];
  for (const corner of CORNERS) out.push({ region: 'corner', corner, square: 0 });
  for (let s = 0; s < 64; s++) if (reachable(s)) out.push({ region: 'square', corner: 'a8', square: s });
  return out;
}

/** The payout never exceeds the prize, so the largest prize over all targets bounds every payout. */
export const MAX_MULTIPLIER = Math.max(...allTargets().map((t) => prizeFor(t)));

export interface Config {
  target: Target;
}

const sq = (name: string) => 'abcdefgh'.indexOf(name[0]) + 8 * (Number(name[1]) - 1);

export const VOLATILITY: Record<Volatility, Config> = {
  low: { target: { region: 'centre', corner: 'a8', square: 0 } },
  medium: { target: { region: 'corner', corner: 'a8', square: 0 } },
  high: { target: { region: 'square', corner: 'a8', square: sq('e6') } },
  extreme: { target: { region: 'square', corner: 'a8', square: sq('a8') } },
};

export const squareIndex = sq;
