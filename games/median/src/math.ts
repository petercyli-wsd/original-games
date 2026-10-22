// Median: n = 2m + 1 points drop uniformly on [0, 1]. Before the bet the
// player places a window [a, b]. The round is won if the sample median (the
// (m + 1)-th smallest point) lands inside the window.
//
// The theorem. The median of n uniforms has the Beta(m + 1, m + 1) law, so
// P(win) = I_b(m+1, m+1) − I_a(m+1, m+1), the Beta mass of the window. The
// combinatorial reason is a tug of war: the median is below a exactly when at
// least m + 1 points fall below a, and above b exactly when at least m + 1
// points fall above b. So the median is in the window iff neither side gets
// m + 1 points. Each point independently lands below / inside / above with
// probabilities (a, b − a, 1 − b), the lengths of the line's three segments.
//
// Live pricing. After some points, with `below` points under a, `above`
// points over b and r points still to come, the chance of a win is the exact
// multinomial sum over how the remaining points split:
//
//   P = Σ_{l ≤ m − below, h ≤ m − above} r! / (l! h! (r−l−h)!) · a^l (1−b)^h (b−a)^(r−l−h).
//
// Pricing is pattern 1 (fixed prize): prize = RTP / P(start), cash-out =
// prize × P(now). P(now) is a martingale point by point (the next point lands
// below / inside / above with probabilities a, b − a, 1 − b), so the cash-out
// is a martingale from RTP and every stopping rule returns exactly RTP. Where
// the window goes only trades chance for prize, never value.
//
// Max win. The window is restricted to placements whose prize is at most
// MAX_PRIZE, and the cash-out never exceeds the prize, so MAX_PRIZE bounds
// every payout. Tie rule: the window is closed, a point equal to a or b counts
// as inside (probability zero anyway).

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;
export const MAX_PRIZE = 1000;
export const MAX_MULTIPLIER = MAX_PRIZE;

/** How many points drop (always odd, so the median is one of them). */
export const POINTS = [3, 5, 9, 15, 25] as const;
export type Points = (typeof POINTS)[number];

/** Window widths, in percent of the line. */
export const WIDTHS = [5, 10, 20, 40] as const;
export type Width = (typeof WIDTHS)[number];

export interface Settings {
  n: Points;
  width: Width;
  /** Left end of the window, integer percent. */
  lo: number;
}

/** m: each side may hold at most m points. */
export const half = (n: number) => (n - 1) / 2;

/** Points dropped per step: at most 5 checkpoints per round. */
export const burstSize = (n: number) => Math.ceil(n / 5);

const MAXN = 25;
const BINOM: number[][] = [];
for (let i = 0; i <= MAXN; i++) {
  BINOM[i] = [1];
  for (let j = 1; j <= i; j++) BINOM[i][j] = (BINOM[i - 1][j - 1] ?? 0) + (j < i ? BINOM[i - 1][j] : 0);
}
export const binom = (n: number, k: number) => (k < 0 || k > n ? 0 : BINOM[n][k]);

export type Side = 'below' | 'inside' | 'above';

/** Where a point falls relative to the closed window [a, b]. */
export const sideOf = (x: number, a: number, b: number): Side => (x < a ? 'below' : x > b ? 'above' : 'inside');

export interface Tally {
  below: number;
  inside: number;
  above: number;
}

export function tally(points: readonly number[], a: number, b: number): Tally {
  const t: Tally = { below: 0, inside: 0, above: 0 };
  for (const x of points) t[sideOf(x, a, b)]++;
  return t;
}

/** 'win' once no side can reach m + 1, 'bust' once one side has; else null. */
export function decided(n: number, t: Tally): 'win' | 'bust' | null {
  const m = half(n);
  const left = n - t.below - t.inside - t.above;
  if (t.below > m || t.above > m) return 'bust';
  if (Math.max(t.below, t.above) + left <= m) return 'win';
  return null;
}

export interface Outcomes {
  /** The median ends up below the window. */
  low: number;
  /** The median ends up in the window. */
  win: number;
  /** The median ends up above the window. */
  high: number;
}

/** Chance that `need` or more of r points land on a side of length p. */
function tail(r: number, need: number, p: number): number {
  if (need <= 0) return 1;
  let s = 0;
  for (let k = need; k <= r; k++) s += binom(r, k) * p ** k * (1 - p) ** (r - k);
  return s;
}

/** Exact chances of where the median finishes, from a tally with the rest still to drop. */
export function outcomes(n: number, t: Tally, a: number, b: number): Outcomes {
  const m = half(n);
  const r = n - t.below - t.inside - t.above;
  const d = decided(n, t);
  if (d === 'bust') return t.below > m ? { low: 1, win: 0, high: 0 } : { low: 0, win: 0, high: 1 };
  if (d === 'win') return { low: 0, win: 1, high: 0 };
  const w = b - a;
  const up = 1 - b;
  let win = 0;
  for (let l = 0; l <= Math.min(r, m - t.below); l++) {
    for (let h = 0; h <= Math.min(r - l, m - t.above); h++) {
      win += binom(r, l) * binom(r - l, h) * a ** l * up ** h * w ** (r - l - h);
    }
  }
  // The two losing events are disjoint (both would need 2m + 2 points).
  return { low: tail(r, m + 1 - t.below, a), win, high: tail(r, m + 1 - t.above, up) };
}

export const winChance = (n: number, t: Tally, a: number, b: number) => outcomes(n, t, a, b).win;

const NONE: Tally = { below: 0, inside: 0, above: 0 };

/** Chance the median of n uniforms lands in [a, b]: the Beta(m+1, m+1) mass of the window. */
export const startChance = (n: number, a: number, b: number) => winChance(n, NONE, a, b);

export const windowOf = (s: Settings) => ({ a: s.lo / 100, b: (s.lo + s.width) / 100 });

export function settingsChance(s: Settings): number {
  const { a, b } = windowOf(s);
  return startChance(s.n, a, b);
}

/** The full-win prize, locked at bet time. */
export const prizeFor = (s: Settings) => RTP / settingsChance(s);

/** Beta(m+1, m+1) density: the law of the median of n = 2m + 1 uniforms. */
export function medianDensity(n: number, x: number): number {
  const m = half(n);
  return n * binom(n - 1, m) * x ** m * (1 - x) ** m;
}

const rangeCache = new Map<string, { min: number; max: number }>();

/**
 * The window positions allowed for (n, width): those whose prize is at most
 * MAX_PRIZE. The Beta density is symmetric and unimodal, so this is an
 * interval around the centre.
 */
export function loRange(n: Points, width: Width): { min: number; max: number } {
  const key = `${n}/${width}`;
  let r = rangeCache.get(key);
  if (!r) {
    let min = 100;
    let max = 0;
    for (let lo = 0; lo + width <= 100; lo++) {
      if (prizeFor({ n, width, lo }) <= MAX_PRIZE) {
        min = Math.min(min, lo);
        max = Math.max(max, lo);
      }
    }
    r = { min, max };
    rangeCache.set(key, r);
  }
  return r;
}

export function clampLo(n: Points, width: Width, lo: number): number {
  const { min, max } = loRange(n, width);
  return Math.min(max, Math.max(min, Math.round(lo)));
}

/** The final median, once all n points are in. */
export function median(points: readonly number[]): number {
  const s = [...points].sort((x, y) => x - y);
  return s[(s.length - 1) / 2];
}

export function volatilityOf(p: number): Volatility {
  return p > 0.6 ? 'low' : p > 0.2 ? 'medium' : p > 0.04 ? 'high' : 'extreme';
}

export const VOLATILITY: Record<Volatility, Settings> = {
  low: { n: 25, width: 40, lo: 30 },
  medium: { n: 9, width: 20, lo: 40 },
  high: { n: 5, width: 10, lo: 60 },
  extreme: { n: 15, width: 10, lo: 72 },
};
