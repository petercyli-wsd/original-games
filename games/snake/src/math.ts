// Snake: a blind snake on an N×N board. Its head starts on the centre cell
// and every step moves one cell up, right, down or left, each with chance
// 1/4. Every cell it visits stays body, so the snake grows by one cell per
// step. Running into a wall or into its own body loses. Grow to the target
// length and the round pays out.
//
// The odds you can see. Four directions, each 1 in 4. A direction is safe
// exactly when the cell it leads to is on the board and not body, so with f
// free directions the next step survives with probability f/4: the green
// quarters of the compass ring around the head, literally.
//
// The theorem (self-avoiding walks). The blind snake survives n steps exactly
// when its path is a self-avoiding walk that stays on the board. Every n-step
// path has probability 4^-n, so
//     P(reach length n + 1) = c_n / 4^n,
// where c_n counts the n-step self-avoiding walks from the centre that fit on
// the board. On the unbounded grid c_n = 4, 12, 36, 100, 284, 780, 2172, …
// (OEIS A001411) grows like μ^n with μ ≈ 2.638 (the connective constant), so
// a long snake survives about μ/4 ≈ 66% of its steps; the walls make it
// harder. Counting is exact: a depth-first enumeration of every path, summing
// dyadic probabilities 4^-k, which doubles hold exactly.
//
// Pricing (per-step fair factor). Surviving a step that had f free directions
// multiplies the cash-out by 4/f (×4/3, ×2 or ×4; the first step from the
// centre has f = 4 and is free, ×1). So E[cash-out after the step] =
// (f/4)·cash·4/f + (1 − f/4)·0 = cash: the cash-out is a martingale starting
// at RTP. A round lasts at most target − 1 steps, so by optional stopping
// every strategy (cash out by hand, the auto-step rules, play to the end)
// returns exactly RTP. Equivalently, cash-out = RTP × P_careful(path) /
// P_blind(path): the likelihood ratio between a careful snake, which picks
// uniformly among the free directions and never crashes, and the blind one.
//
// Trapped. f = 0 means the next step loses for sure. Such a step is never
// offered: the round cashes out at its current value instead. That is a
// stopping rule, so RTP is unchanged.
//
// Headline numbers. Chance to win = P(reach the target length) = c_{T−1} /
// 4^{T−1}. Played to the end, a round ends in a win, a crash or a trap, and
// E[payout; win] = RTP × P_careful(reach T) (change of measure), so the
// average win is RTP × P_careful(reach T) / P_blind(reach T); both are
// enumerated exactly. The live win chance is the same enumeration from the
// current position.
//
// Max payout. Factors are at most 4 and a round has at most target − 1
// steps, so payouts are bounded; MAX_MULTIPLIER is the exact largest
// cash-out reachable under any setting (enumerated), no cap needed.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

/** Board sizes (cells per side). The snake starts on the centre cell. */
export const GRIDS = [7, 9] as const;
export type Grid = (typeof GRIDS)[number];

/** Target lengths in cells (the head counts). The round pays out when reached. */
export const TARGETS = [4, 6, 8, 10, 12] as const;
export type Target = (typeof TARGETS)[number];

/** The eval's configs, one per volatility level. */
export const VOLATILITY: Record<Volatility, { grid: Grid; target: Target }> = {
  low: { grid: 9, target: 4 },
  medium: { grid: 9, target: 8 },
  high: { grid: 7, target: 10 },
  extreme: { grid: 7, target: 12 },
};

/** Directions, clockwise from up. */
export const DIRS = ['up', 'right', 'down', 'left'] as const;
export type Dir = 0 | 1 | 2 | 3;
export const DX = [0, 1, 0, -1] as const;
export const DY = [-1, 0, 1, 0] as const;

/** The centre cell of an n×n board (cells are numbered row by row). */
export const centre = (n: number) => ((n - 1) / 2) * n + (n - 1) / 2;

const NEIGHBOURS = new Map<number, Int16Array>();

/** neighbours(n)[cell·4 + d] is the cell one step in direction d, or −1 past a wall. */
export function neighbours(n: number): Int16Array {
  let t = NEIGHBOURS.get(n);
  if (!t) {
    t = new Int16Array(n * n * 4);
    for (let c = 0; c < n * n; c++) {
      const x = c % n;
      const y = (c - x) / n;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d];
        const ny = y + DY[d];
        t[c * 4 + d] = nx >= 0 && nx < n && ny >= 0 && ny < n ? ny * n + nx : -1;
      }
    }
    NEIGHBOURS.set(n, t);
  }
  return t;
}

export type Blocker = 'wall' | 'body' | null;

/** What blocks each of the four directions from the head (null = free). */
export function blockers(n: number, path: readonly number[]): Blocker[] {
  const nb = neighbours(n);
  const head = path[path.length - 1];
  return [0, 1, 2, 3].map((d) => {
    const c = nb[head * 4 + d];
    return c < 0 ? 'wall' : path.includes(c) ? 'body' : null;
  });
}

/** Number of free directions from the head: the next step survives with chance f/4. */
export const freeCount = (n: number, path: readonly number[]) => blockers(n, path).filter((b) => b === null).length;

/** Cash-out after surviving a step that had f free directions. */
export const afterSafeStep = (cash: number, free: number) => (cash * 4) / free;

export type Stop = 'target' | 'trapped';

/** What ends the round at this state, if anything (checked after every safe step). */
export function autoStop(n: number, target: number, path: readonly number[]): Stop | null {
  if (path.length >= target) return 'target';
  if (freeCount(n, path) === 0) return 'trapped';
  return null;
}

export interface StepResult {
  dir: Dir;
  /** The cell the head moves to, or −1 past the wall. */
  cell: number;
  safe: boolean;
  /** What it ran into, when it lost. */
  hit: Blocker;
  path: number[];
  cash: number;
}

/** One step in direction dir (the caller draws dir uniformly from 0..3). */
export function step(n: number, path: readonly number[], cash: number, dir: Dir): StepResult {
  const blocked = blockers(n, path);
  const cell = neighbours(n)[path[path.length - 1] * 4 + dir];
  const hit = blocked[dir];
  if (hit) return { dir, cell, safe: false, hit, path: [...path], cash: 0 };
  const free = blocked.filter((b) => b === null).length;
  return { dir, cell, safe: true, hit: null, path: [...path, cell], cash: afterSafeStep(cash, free) };
}

export interface Outlook {
  /** P(reach the target length), playing to the end from here. */
  win: number;
  /** P(boxed in first: auto-cashed). */
  trapped: number;
  /** P(hit a wall or itself first). */
  crash: number;
  /** E[payout × 1{win}], in stakes. */
  winPay: number;
  /** E[payout × 1{trapped}], in stakes. */
  trapPay: number;
  /** The largest cash-out reachable from here. */
  maxCash: number;
}

/**
 * Exact play-to-the-end outlook from a state, by enumerating every future
 * path (each step 1/4) with the game's own stopping rules. Probabilities are
 * sums of 4^-k, exact in doubles.
 */
export function outlook(n: number, target: number, path: readonly number[], cash: number): Outlook {
  const nb = neighbours(n);
  const seen = new Uint8Array(n * n);
  for (const c of path) seen[c] = 1;
  let win = 0;
  let trapped = 0;
  let crash = 0;
  let winPay = 0;
  let trapPay = 0;
  let maxCash = cash;
  const visit = (head: number, len: number, prob: number, value: number) => {
    if (value > maxCash) maxCash = value;
    if (len >= target) {
      win += prob;
      winPay += prob * value;
      return;
    }
    const base = head * 4;
    let f = 0;
    for (let d = 0; d < 4; d++) {
      const c = nb[base + d];
      if (c >= 0 && !seen[c]) f++;
    }
    if (f === 0) {
      trapped += prob;
      trapPay += prob * value;
      return;
    }
    const p = prob / 4;
    const next = afterSafeStep(value, f);
    crash += p * (4 - f);
    for (let d = 0; d < 4; d++) {
      const c = nb[base + d];
      if (c >= 0 && !seen[c]) {
        seen[c] = 1;
        visit(c, len + 1, p, next);
        seen[c] = 0;
      }
    }
  };
  visit(path[path.length - 1], path.length, 1, cash);
  return { win, trapped, crash, winPay, trapPay, maxCash };
}

const START = new Map<string, Outlook>();

/**
 * The outlook at the start of a round, cached by settings. The first step
 * from the centre is free (×1) and the four directions are rotations of each
 * other, so the outlook equals the one after a first step up.
 */
export function startOutlook(n: number, target: number): Outlook {
  const key = `${n}:${target}`;
  let o = START.get(key);
  if (!o) {
    const c = centre(n);
    o = outlook(n, target, [c, neighbours(n)[c * 4]], afterSafeStep(RTP, 4));
    START.set(key, o);
  }
  return o;
}

/** The chance to win with these settings: reach the target length. */
export const winChance = (n: number, target: number) => startOutlook(n, target).win;

/** Average payout of a win, playing to the end: E[payout | win]. */
export const averageWin = (n: number, target: number) => {
  const o = startOutlook(n, target);
  return o.winPay / o.win;
};

/** The smallest payout at the target: every step after the first had 3 free directions. */
export const minimumWin = (target: number) => RTP * (4 / 3) ** (target - 2);

const LIVE = new Map<string, Outlook>();

/** The outlook from a live position, cached (the stage asks for it on every render). */
export function liveOutlook(n: number, target: number, path: readonly number[], cash: number): Outlook {
  if (path.length <= 2) return startOutlook(n, target);
  const key = `${n}:${target}:${cash}:${path.join(',')}`;
  let o = LIVE.get(key);
  if (!o) {
    if (LIVE.size > 64) LIVE.clear();
    o = outlook(n, target, path, cash);
    LIVE.set(key, o);
  }
  return o;
}

/** c_k: the number of k-step self-avoiding walks from `start` that stay on an n×n board. */
export function walkCount(n: number, steps: number, start = centre(n)): number {
  const nb = neighbours(n);
  const seen = new Uint8Array(n * n);
  const visit = (head: number, left: number): number => {
    if (left === 0) return 1;
    let total = 0;
    for (let d = 0; d < 4; d++) {
      const c = nb[head * 4 + d];
      if (c >= 0 && !seen[c]) {
        seen[c] = 1;
        total += visit(c, left - 1);
        seen[c] = 0;
      }
    }
    return total;
  };
  seen[start] = 1;
  return visit(start, steps);
}

/** The largest payout under any setting: the exact maximum over every reachable state. */
export const MAX_MULTIPLIER = Math.max(...GRIDS.flatMap((g) => TARGETS.map((t) => startOutlook(g, t).maxCash)));
