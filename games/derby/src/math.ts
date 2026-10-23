// Derby: a race of independent random walkers. Every tick each runner takes a
// stride drawn from its own gait (steady 1–2, erratic 0 or 3, a sprinter that
// fades, a stayer that finishes fast, a wildcard that mostly stands still but
// sometimes bounds, a sure but slow plodder). Steady and Erratic have the same
// mean stride; Erratic wins about twice as often, because the race is decided
// by the minimum of the finishing times and spread helps the minimum. The first runner past the line wins; runners that cross
// at exactly the same instant dead-heat and split the prize.
//
// Within a tick a runner moves at constant speed, so a runner at x taking
// stride s ≥ L − x crosses the line at fraction (L − x)/s of that tick. Time is
// measured in U = 60 units per tick, so every crossing time is an integer.
//
// Exact odds. The runners are independent, so each one's remaining crossing
// time T_i depends only on its own position. R_x(τ) = P(T = τ | at x) obeys
//   R_x = Σ_s g_x(s) · ( s ≥ L − x ? δ[U(L − x)/s] : shift_U R_{x+s} ),
// solved in increasing τ (a stride of 0 refers back to R_x at τ − U). Then
//   P(i wins) = Σ_τ P(T_i = τ) · E[ 1/(1+K) ; no j has T_j < τ ],
// where K counts the runners tied at τ: with a_j = P(T_j > τ), b_j = P(T_j = τ),
// that expectation is Σ_k c_k/(k+1) for c = coefficients of Π_{j≠i}(a_j + b_j z).
// This is the catalogue's Σ_t P(T_i = t)·Π_j P(T_j > t), with dead heats split.
// The steady runner (strides 1–2) is in every field and always finishes within
// L ticks, so every sum stops there: nothing is truncated or sampled.
//
// Pricing (fixed prize). Backing runner i pays prize = RTP / P(i wins) at the
// start; the cash-out at any checkpoint is prize × P(i wins | positions), a
// martingale starting at RTP. Switching to runner j keeps the value V and
// re-locks the prize at V / P(j wins), so a switch never changes EV, only risk.
// A switch that would lock a prize above MAX_WIN is refused, so every payout is
// at most MAX_WIN (and every starting prize is far below it).

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;
/** Time units per tick (divisible by every stride 1–6, so crossing times are integers). */
export const U = 60;
/** Ticks per leg: the race pauses for a checkpoint after every leg. */
export const LEG = 3;
/** No switch may lock a prize above this. */
export const MAX_WIN = 1000;

export const TRACKS = [20, 30, 40] as const;
export type Track = (typeof TRACKS)[number];
export const TRACK_NAME: Record<Track, string> = { 20: 'Sprint', 30: 'Mile', 40: 'Marathon' };

export type GaitId = 'steady' | 'erratic' | 'sprinter' | 'stayer' | 'wildcard' | 'plodder';
/** A stride law: [stride, probability] pairs. */
export type Law = readonly (readonly [number, number])[];

const third = 1 / 3;
const LAWS = {
  steady: [[1, 0.5], [2, 0.5]],
  erratic: [[0, 0.5], [3, 0.5]],
  fast: [[2, 0.5], [3, 0.5]],
  slow: [[0, third], [1, third], [2, third]],
  wildcard: [[0, 0.8], [5, 0.2]],
  plod: [[1, 0.75], [2, 0.25]],
} as const satisfies Record<string, Law>;

export interface Gait {
  id: GaitId;
  name: string;
  /** How it runs, in a few words. */
  blurb: string;
  /** Stride law at position x on a track of length L. */
  law(x: number, L: number): Law;
}

export const GAITS: Record<GaitId, Gait> = {
  steady: { id: 'steady', name: 'Steady', blurb: '1 or 2 a tick', law: () => LAWS.steady },
  erratic: { id: 'erratic', name: 'Erratic', blurb: '0 or 3 a tick', law: () => LAWS.erratic },
  sprinter: { id: 'sprinter', name: 'Sprinter', blurb: '2–3, then 0–2 after ½', law: (x, L) => (x < L / 2 ? LAWS.fast : LAWS.slow) },
  stayer: { id: 'stayer', name: 'Stayer', blurb: '0–2, then 2–3 after ½', law: (x, L) => (x < L / 2 ? LAWS.slow : LAWS.fast) },
  wildcard: { id: 'wildcard', name: 'Wildcard', blurb: '0, or 5 one tick in 5', law: () => LAWS.wildcard },
  plodder: { id: 'plodder', name: 'Plodder', blurb: '1, or 2 one tick in 4', law: () => LAWS.plod },
};

export interface Runner {
  /** Saddle number, 1-based. */
  no: number;
  gait: GaitId;
  colour: string;
}

/** The field. Steady is always in it: it finishes within L ticks, which bounds every race. */
export const FIELD: readonly Runner[] = [
  { no: 1, gait: 'steady', colour: '#2a9d8f' },
  { no: 2, gait: 'erratic', colour: '#e9c46a' },
  { no: 3, gait: 'sprinter', colour: '#f4a261' },
  { no: 4, gait: 'stayer', colour: '#8ab4f8' },
  { no: 5, gait: 'wildcard', colour: '#e76f9a' },
  { no: 6, gait: 'plodder', colour: '#b0b8c4' },
];
export const RUNNERS = FIELD.length;

/** Mean stride at x (for the board's labels). */
export const meanStride = (law: Law) => law.reduce((m, [s, p]) => m + s * p, 0);

// ---------- Crossing-time distributions ----------
//
// Crossing times live on a sparse grid: a crossing in tick k+1 happens at
// U·k + U·d/s for a stride s and a distance d ≤ s still to go. SLOTS lists those
// instants within one tick, in time order, so a distribution is an array over
// k·SLOTS.length + slot, ordered by time. A runner with a stride of at least 1
// every tick (Steady, Plodder) crosses within L ticks, so L ticks of slots hold
// every crossing that can still decide the race.

const STRIDES = [...new Set(Object.values(LAWS).flatMap((law) => law.map(([s]) => s)))].filter((s) => s > 0);
const SLOT_UNITS = [...new Set(STRIDES.flatMap((s) => Array.from({ length: s }, (_, d) => (U * (d + 1)) / s)))].sort((a, b) => a - b);
const K = SLOT_UNITS.length;
const SLOT = new Map(SLOT_UNITS.map((u, i) => [u, i]));

/** Grid index of a crossing in tick `k + 1` with `d` still to go on stride `s`. */
export const crossIndex = (k: number, d: number, s: number) => k * K + SLOT.get((U * d) / s)!;
/** The crossing instant of a grid index, in ticks from now. */
export const indexTime = (i: number) => Math.floor(i / K) + SLOT_UNITS[i % K] / U;

const size = (L: number) => K * L;

const tables = new Map<string, Float64Array[]>();

/** R[x][i] = P(the runner, now at x, crosses the line at grid instant i). */
export function remainingTable(gait: GaitId, L: number): Float64Array[] {
  const key = `${gait}:${L}`;
  const hit = tables.get(key);
  if (hit) return hit;
  const N = size(L);
  const R: Float64Array[] = new Array(L);
  for (let x = L - 1; x >= 0; x--) {
    const law = GAITS[gait].law(x, L);
    const f = new Float64Array(N);
    let stay = 0;
    for (const [s, p] of law) {
      if (s === 0) stay += p;
      else if (s >= L - x) f[crossIndex(0, L - x, s)] += p;
      else {
        const g = R[x + s];
        for (let t = K; t < N; t++) f[t] += p * g[t - K];
      }
    }
    if (stay > 0) for (let t = K; t < N; t++) f[t] += stay * f[t - K];
    R[x] = f;
  }
  tables.set(key, R);
  return R;
}

/** Crossing-time distribution of each runner from its position. */
export const dists = (pos: readonly number[], L: number) => FIELD.map((r, i) => remainingTable(r.gait, L)[pos[i]]);

const lastCache = new WeakMap<Float64Array, number>();
/** Last instant a distribution can cross at (its support ends there). */
function lastIndex(f: Float64Array): number {
  let last = lastCache.get(f);
  if (last === undefined) {
    last = f.length - 1;
    while (last > 0 && f[last] === 0) last--;
    lastCache.set(f, last);
  }
  return last;
}

/**
 * W[i][t] = E[1/(1+K) ; nobody else crosses before t] for runner i crossing at
 * instant t, where K counts the others crossing at exactly t. Runner i's share
 * of the win is then Σ_t P(T_i = t)·W[i][t]. Only the runners in `only` are
 * filled in (all by default). Past the earliest instant by which some runner is
 * sure to have crossed, every weight is 0, so the loop stops there.
 */
export function shareWeights(D: readonly Float64Array[], only?: readonly number[]): Float64Array[] {
  const n = D.length;
  const N = D[0].length;
  const want = only ?? D.map((_, i) => i);
  const W = D.map((_, i) => (want.includes(i) ? new Float64Array(N) : EMPTY));
  let end = N - 1;
  for (const f of D) end = Math.min(end, lastIndex(f));
  const tail = new Float64Array(n).fill(1); // P(T_j ≥ t)
  const a = new Float64Array(n);
  const b = new Float64Array(n);
  const poly = new Float64Array(n + 1);
  for (let t = 0; t <= end; t++) {
    let any = false;
    for (let j = 0; j < n; j++) {
      b[j] = D[j][t];
      a[j] = Math.max(0, tail[j] - b[j]);
      if (b[j] > 0) any = true;
    }
    if (any) {
      for (const i of want) {
        if (b[i] === 0) continue;
        poly.fill(0);
        poly[0] = 1;
        let deg = 0;
        for (let j = 0; j < n; j++) {
          if (j === i) continue;
          for (let k = deg + 1; k >= 1; k--) poly[k] = poly[k] * a[j] + poly[k - 1] * b[j];
          poly[0] *= a[j];
          deg++;
        }
        let w = 0;
        for (let k = 0; k <= deg; k++) w += poly[k] / (k + 1);
        W[i][t] = w;
      }
    }
    for (let j = 0; j < n; j++) tail[j] -= b[j];
  }
  return W;
}
const EMPTY = new Float64Array(0);

const dot = (p: Float64Array, W: Float64Array, shift = 0) => {
  let s = 0;
  for (let t = 0; t + shift < W.length; t++) if (p[t] > 0) s += p[t] * W[t + shift];
  return s;
};

const shareCache = new Map<string, number[]>();

/** Each runner's exact expected share of the win (they sum to 1). Positions all < L. */
export function winChances(pos: readonly number[], L: number): number[] {
  const key = `${L}:${pos.join(',')}`;
  const hit = shareCache.get(key);
  if (hit) return hit;
  const D = dists(pos, L);
  const W = shareWeights(D);
  const out = D.map((d, i) => Math.min(1, Math.max(0, dot(d, W[i]))));
  if (shareCache.size > 20000) shareCache.clear();
  shareCache.set(key, out);
  return out;
}

/** One runner's chance (the same number as winChances, computed for that runner only). */
export function chanceOf(pos: readonly number[], L: number, i: number): number {
  const D = dists(pos, L);
  return Math.min(1, Math.max(0, dot(D[i], shareWeights(D, [i])[i])));
}

// ---------- The next leg, as seen from your runner ----------

export interface LegOutcome {
  /** Total distance your runner covers in the leg. */
  advance: number;
  prob: number;
  /** Your chance afterwards, averaged over the other runners' legs. */
  chance: number;
  /** Whether this advance takes your runner over the line. */
  crosses: boolean;
}

/**
 * Splits the next leg by how far your runner goes. Each outcome's chance is
 * E[P(win after the leg) | your advance]; weighted by prob they average to
 * your chance now (the tower property), because the others are independent.
 */
export function legOutcomes(pos: readonly number[], L: number, me: number): LegOutcome[] {
  const D = dists(pos, L);
  const W = shareWeights(D, [me])[me];
  const R = remainingTable(FIELD[me].gait, L);
  const gait = GAITS[FIELD[me].gait];
  const groups = new Map<number, { prob: number; value: number; crosses: boolean }>();
  const add = (advance: number, prob: number, value: number, crosses: boolean) => {
    const g = groups.get(advance) ?? { prob: 0, value: 0, crosses };
    g.prob += prob;
    g.value += prob * value;
    groups.set(advance, g);
  };
  const walk = (tick: number, x: number, advance: number, prob: number) => {
    // Not across after the leg: the rest of the race starts LEG ticks from now.
    if (tick === LEG) return add(advance, prob, dot(R[x], W, K * LEG), false);
    for (const [s, p] of gait.law(x, L)) {
      if (s > 0 && s >= L - x) add(advance + s, prob * p, W[crossIndex(tick, L - x, s)], true);
      else walk(tick + 1, x + s, advance + s, prob * p);
    }
  };
  walk(0, pos[me], 0, 1);
  return [...groups.entries()]
    .map(([advance, g]) => ({ advance, prob: g.prob, chance: g.prob > 0 ? g.value / g.prob : 0, crosses: g.crosses }))
    .sort((x, y) => x.advance - y.advance);
}

// ---------- Running the race ----------

/** Draws one stride from a law with a uniform u ∈ [0, 1). */
export function drawStride(law: Law, u: number): number {
  let acc = 0;
  for (const [s, p] of law) {
    acc += p;
    if (u < acc) return s;
  }
  return law[law.length - 1][0];
}

export interface Tick {
  /** Positions after the tick (may run past L for runners that crossed). */
  pos: number[];
  strides: number[];
  /** Runners that crossed this tick, with the crossing instant (fraction of the tick). */
  crossed: { runner: number; at: number }[];
  /** Winners (one, or several in a dead heat), set when someone crossed. */
  winners: number[] | null;
}

/** Plays one tick: every runner strides from its own gait. */
export function tick(pos: readonly number[], L: number, uniform: () => number): Tick {
  const n = FIELD.length;
  const strides = new Array<number>(n);
  const next = new Array<number>(n);
  const crossed: { runner: number; at: number }[] = [];
  let best = Infinity;
  let winners: number[] | null = null;
  for (let i = 0; i < n; i++) {
    const x = pos[i];
    const s = drawStride(GAITS[FIELD[i].gait].law(x, L), uniform());
    strides[i] = s;
    next[i] = x + s;
    if (s > 0 && x + s >= L) {
      // Compare crossing instants exactly, in whole units of U per tick.
      const units = (U * (L - x)) / s;
      crossed.push({ runner: i, at: (L - x) / s });
      if (units < best) {
        best = units;
        winners = [i];
      } else if (units === best) winners!.push(i);
    }
  }
  return { pos: next, strides, crossed, winners };
}

/** Plays up to one leg; stops at the tick someone crosses. */
export function leg(pos: readonly number[], L: number, uniform: () => number): Tick[] {
  const out: Tick[] = [];
  let x = pos.slice();
  for (let k = 0; k < LEG; k++) {
    const t = tick(x, L, uniform);
    out.push(t);
    if (t.winners) break;
    x = t.pos;
  }
  return out;
}

/** What your ticket pays when the race ends: the prize split among dead-heaters. */
export const payout = (prize: number, me: number, winners: readonly number[]) => (winners.includes(me) ? prize / winners.length : 0);

/** Prize locked when you switch your value to runner j (null if refused). */
export function switchPrize(value: number, chanceJ: number): number | null {
  if (!(chanceJ > 0)) return null;
  const prize = value / chanceJ;
  return prize <= MAX_WIN ? prize : null;
}

export const startChances = (L: Track) => winChances(FIELD.map(() => 0), L);
export const startPrize = (L: Track, me: number) => RTP / startChances(L)[me];

export function volatilityOf(p: number): Volatility {
  return p > 0.3 ? 'low' : p > 0.12 ? 'medium' : p > 0.04 ? 'high' : 'extreme';
}

/** Largest starting prize; switching is capped at MAX_WIN, which is larger. */
export const MAX_MULTIPLIER = Math.max(MAX_WIN, ...TRACKS.flatMap((L) => FIELD.map((_, i) => startPrize(L, i))));
