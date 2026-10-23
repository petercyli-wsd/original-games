// Bracket: a single-elimination knockout of 8 or 16 seeds. Each seed has a
// rating r, and a match between i and j is won by i with probability
// rᵢ / (rᵢ + rⱼ) (the Bradley–Terry model). You back one seed to win the title.
//
// The bracket DP. For every match node, the winner's distribution is
//   W(i) = A(i) · Σⱼ B(j) · rᵢ/(rᵢ + rⱼ)          (i from side A, j from side B)
// where A and B are the winner distributions of the two feeder sub-brackets
// (a leaf is a point mass on its seed, and a played match is a point mass on
// its winner). The root's distribution is every seed's exact title chance.
// Matches are independent, so the order they are played in never changes
// these numbers; only the results so far do.
//
// Pricing (fixed prize, re-locked on a switch). Backing seed s pays
// prize = RTP / P(s wins) if s takes the title. At any state the cash-out is
// prize × P(s wins | results so far): a conditional expectation of the final
// payout, so a martingale that starts at RTP. Switching to another live seed t
// keeps the cash-out V and re-locks the prize at V / P(t), so the value is the
// same the moment you switch. By optional stopping, every way of playing,
// cashing out or switching returns exactly RTP.
//
// Max win. A switch is only offered while the new prize stays ≤ MAX_PRIZE,
// and every starting prize is below it, so no payout can exceed MAX_PRIZE
// (the cash-out is prize × P ≤ prize).

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;
export const MAX_PRIZE = 10_000;

export const FIELDS = [8, 16] as const;
export type Field = (typeof FIELDS)[number];

export const PRESETS = ['even', 'underdog', 'steep'] as const;
export type Preset = (typeof PRESETS)[number];

export const PRESET_LABEL: Record<Preset, string> = { even: 'Even', underdog: 'Underdog', steep: 'Steep' };
export const PRESET_NOTE: Record<Preset, string> = {
  even: 'a close field, upsets everywhere',
  underdog: 'low seeds close to mid seeds',
  steep: 'top seeds usually win',
};

/**
 * Rating of seed k (1-based), on a 1000 scale. Integers, so every match's odds
 * are a plain fraction. Even: 5% weaker per seed. Underdog: 1000/√k, so the
 * low seeds sit close to the middle of the field. Steep: 1000/k (Zipf).
 */
export function rating(preset: Preset, k: number): number {
  if (preset === 'even') return Math.round(1000 * 0.95 ** (k - 1));
  if (preset === 'underdog') return Math.round(1000 / Math.sqrt(k));
  return Math.round(1000 / k);
}

/** Standard seeding order: 1 v n, the halves of the top seeds kept apart. Returns 0-based seeds by slot. */
export function seedOrder(n: number): number[] {
  let order = [1, 2];
  while (order.length < n) {
    const m = order.length * 2 + 1;
    order = order.flatMap((s) => [s, m - s]);
  }
  return order.map((s) => s - 1);
}

export interface Bracket {
  n: Field;
  preset: Preset;
  /** Ratings by 0-based seed. */
  ratings: number[];
  /** Seed in each first-round slot, top to bottom. */
  order: number[];
  /** Number of rounds: 3 for 8 seeds, 4 for 16. */
  rounds: number;
}

const bracketCache = new Map<string, Bracket>();
export function makeBracket(n: Field, preset: Preset): Bracket {
  const key = `${n}-${preset}`;
  let b = bracketCache.get(key);
  if (!b) {
    b = {
      n,
      preset,
      ratings: Array.from({ length: n }, (_, i) => rating(preset, i + 1)),
      order: seedOrder(n),
      rounds: Math.log2(n),
    };
    bracketCache.set(key, b);
  }
  return b;
}

/** results[k][m] is the winner (0-based seed) of match m in round k, or -1 if not played. */
export type Results = number[][];

export const emptyResults = (b: Bracket): Results => Array.from({ length: b.rounds }, (_, k) => Array<number>(b.n >> (k + 1)).fill(-1));

/** Chance seed i beats seed j. */
export const beats = (b: Bracket, i: number, j: number) => b.ratings[i] / (b.ratings[i] + b.ratings[j]);

/** The two seeds meeting in match (k, m), or -1 where a feeder match is unplayed. */
export function players(b: Bracket, res: Results, k: number, m: number): [number, number] {
  if (k === 0) return [b.order[2 * m], b.order[2 * m + 1]];
  return [res[k - 1][2 * m], res[k - 1][2 * m + 1]];
}

/** Winner distribution of match (k, m) given the results; k = -1 is a first-round slot. */
function dist(b: Bracket, res: Results, k: number, m: number): Map<number, number> {
  if (k < 0) return new Map([[b.order[m], 1]]);
  const w = res[k][m];
  if (w >= 0) return new Map([[w, 1]]);
  const A = dist(b, res, k - 1, 2 * m);
  const B = dist(b, res, k - 1, 2 * m + 1);
  const out = new Map<number, number>();
  for (const [i, pa] of A) {
    let s = 0;
    for (const [j, pb] of B) s += pb * beats(b, i, j);
    out.set(i, pa * s);
  }
  for (const [j, pb] of B) {
    let s = 0;
    for (const [i, pa] of A) s += pa * beats(b, j, i);
    out.set(j, pb * s);
  }
  return out;
}

/** Every seed's exact chance to win the title (0 once knocked out). */
export function titleOdds(b: Bracket, res: Results): number[] {
  const root = dist(b, res, b.rounds - 1, 0);
  return Array.from({ length: b.n }, (_, i) => root.get(i) ?? 0);
}

const startCache = new Map<string, number[]>();
/** Title chances before a ball is kicked (cached per bracket). */
export function startOdds(n: Field, preset: Preset): number[] {
  const key = `${n}-${preset}`;
  let p = startCache.get(key);
  if (!p) {
    const b = makeBracket(n, preset);
    p = titleOdds(b, emptyResults(b));
    startCache.set(key, p);
  }
  return p;
}

export const prizeFor = (n: Field, preset: Preset, seed: number) => RTP / startOdds(n, preset)[seed];

/** Whether seed i is still in (not beaten in any played match). */
export function isAlive(b: Bracket, res: Results, i: number): boolean {
  for (let k = 0; k < b.rounds; k++) {
    for (let m = 0; m < res[k].length; m++) {
      const w = res[k][m];
      if (w < 0) continue;
      const [x, y] = players(b, res, k, m);
      if ((x === i || y === i) && w !== i) return false;
    }
  }
  return true;
}

export interface MatchRef {
  k: number;
  m: number;
}

/**
 * The next match to play. Rounds go in order; inside a round, every other
 * match is played before the held seed's own, so its match comes last.
 */
export function nextMatch(b: Bracket, res: Results, held: number): MatchRef | null {
  for (let k = 0; k < b.rounds; k++) {
    const open = res[k].map((w, m) => (w < 0 ? m : -1)).filter((m) => m >= 0);
    if (open.length === 0) continue;
    const other = open.find((m) => !players(b, res, k, m).includes(held));
    return { k, m: other ?? open[0] };
  }
  return null;
}

export const withResult = (res: Results, { k, m }: MatchRef, winner: number): Results =>
  res.map((row, i) => (i === k ? row.map((w, j) => (j === m ? winner : w)) : row));

export interface Outcome {
  /** The seed that wins this outcome. */
  winner: number;
  /** Its chance to win the match. */
  p: number;
  /** The held seed's title chance afterwards. */
  after: number;
}

/** Both outcomes of a match with their chances and the title chance each would leave the held seed. */
export function outcomes(b: Bracket, res: Results, ref: MatchRef, held: number): [Outcome, Outcome] {
  const [x, y] = players(b, res, ref.k, ref.m);
  const px = beats(b, x, y);
  return [
    { winner: x, p: px, after: titleOdds(b, withResult(res, ref, x))[held] },
    { winner: y, p: 1 - px, after: titleOdds(b, withResult(res, ref, y))[held] },
  ];
}

/** Plays a match from a uniform draw u: the first-listed seed wins when u < its chance. */
export function playMatch(b: Bracket, res: Results, ref: MatchRef, u: number): number {
  const [x, y] = players(b, res, ref.k, ref.m);
  return u < beats(b, x, y) ? x : y;
}

/** The prize after switching to `to` with cash-out `cash`, or null if the switch is not allowed. */
export function switchPrize(cash: number, pTo: number): number | null {
  if (!(pTo > 0)) return null;
  const prize = cash / pTo;
  return prize <= MAX_PRIZE ? prize : null;
}

export const matchesIn = (b: Bracket) => b.n - 1;
export const playedCount = (res: Results) => res.reduce((s, row) => s + row.filter((w) => w >= 0).length, 0);

export function volatilityOf(p: number): Volatility {
  return p > 0.3 ? 'low' : p > 0.08 ? 'medium' : p > 0.012 ? 'high' : 'extreme';
}

export const ROUND_NAMES: Record<number, string[]> = {
  3: ['Quarter-finals', 'Semi-finals', 'Final'],
  4: ['Round of 16', 'Quarter-finals', 'Semi-finals', 'Final'],
};

/** Upper bound on any payout: starting prizes and switch prizes never exceed MAX_PRIZE. */
export const MAX_MULTIPLIER = MAX_PRIZE;
