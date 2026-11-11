// Inning: a wheel of 12 equal sectors is spun until you have scored k runs or
// made three outs. A sector is an Out (8), a +1 (2), a +2 (1) or a +4 (1).
// A +n moves the batter and every runner on the diamond n bases forward;
// whoever passes the fourth base scores one run. Everyone moves together, so
// two runners never share a base.
//
// State: which of the three bases hold a runner (a 3-bit mask), the outs so
// far (0-2) and the runs still needed (1..k). P(win | state) is the exact
// result of a small DP over at most 8 x 3 x 6 = 144 states: it is the mass of
// the "k or more runs" segment of the strip drawn on the board.
//
// Pricing: the full prize is RTP / P(win at the start). Cash-out at any state
// is prize x P(win | state). That is a martingale, because P(win | state) is
// the average of P(win | next state) over the 12 equal sectors, so every
// stopping rule returns exactly RTP.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

/** Runs needed, one per chip. */
export const TARGETS = [1, 2, 3, 4, 5, 6] as const;
export type Target = (typeof TARGETS)[number];

export type Sector = 'out' | 'h1' | 'h2' | 'h4';

/** The wheel clockwise from the top. 8 Out, 2 x +1, 1 x +2, 1 x +4, outs spread round. */
export const WHEEL: readonly Sector[] = ['out', 'out', 'h1', 'out', 'out', 'h4', 'out', 'out', 'h1', 'out', 'out', 'h2'];
export const BASES_MOVED: Record<Sector, number> = { out: 0, h1: 1, h2: 2, h4: 4 };
export const OUTS_PER_INNING = 3;

export interface State {
  /** Bit i set: a runner stands on base i + 1. */
  bases: number;
  outs: number;
  /** Runs still needed to win (>= 1). */
  need: number;
}

export interface Move {
  bases: number;
  /** Runners (batter included) that reached home on this hit. */
  runs: number;
}

/** Everyone (the batter too) moves n bases; passing the third base scores. */
export function moveRunners(bases: number, n: number): Move {
  let next = 0;
  let runs = 0;
  for (let pos = 0; pos <= 3; pos++) {
    if (pos > 0 && !(bases & (1 << (pos - 1)))) continue;
    const to = pos + n;
    if (to >= 4) runs++;
    else next |= 1 << (to - 1);
  }
  return { bases: next, runs };
}

export type Step =
  | { kind: 'out'; state: State; over: boolean }
  | { kind: 'hit'; n: number; state: State; runs: number; won: boolean };

/** One spin landing on `sector`: the new state (need already reduced by runs). */
export function step(s: State, sector: Sector): Step {
  if (sector === 'out') return { kind: 'out', state: { ...s, outs: s.outs + 1 }, over: s.outs + 1 >= OUTS_PER_INNING };
  const n = BASES_MOVED[sector];
  const m = moveRunners(s.bases, n);
  return { kind: 'hit', n, runs: m.runs, won: m.runs >= s.need, state: { bases: m.bases, outs: s.outs, need: Math.max(1, s.need - m.runs) } };
}

const cache = new Map<number, number[]>();

/**
 * The distribution of how the inning ends from this state. Entry j < need is
 * the chance it ends with exactly j more runs (a loss); entry `need` is the
 * chance of winning (need or more more runs).
 */
export function ending(s: State): number[] {
  const key = (s.need * 3 + s.outs) * 8 + s.bases;
  const hit = cache.get(key);
  if (hit) return hit;
  const out = new Array<number>(s.need + 1).fill(0);
  for (const sector of WHEEL) {
    const r = step(s, sector);
    if (r.kind === 'out') {
      if (r.over) out[0] += 1 / WHEEL.length;
      else ending(r.state).forEach((p, j) => (out[j] += p / WHEEL.length));
    } else if (r.won) out[s.need] += 1 / WHEEL.length;
    else ending(r.state).forEach((p, j) => (out[r.runs + j] += p / WHEEL.length));
  }
  cache.set(key, out);
  return out;
}

export const winChance = (s: State) => ending(s)[s.need];

export const startState = (k: number): State => ({ bases: 0, outs: 0, need: k });

export const prize = (k: number) => RTP / winChance(startState(k));

/** Cash-out in stake multiples at a live state of a k-run round. */
export const cashOut = (k: number, s: State) => prize(k) * winChance(s);

export function volatilityOf(k: number): Volatility {
  const p = winChance(startState(k));
  return p > 0.3 ? 'low' : p > 0.08 ? 'medium' : p > 0.01 ? 'high' : 'extreme';
}

export const MAX_MULTIPLIER = Math.max(...TARGETS.map(prize));

/** Which sectors raise your chance and which cut it: out always cuts it, a hit never does. */
export const isGood = (sector: Sector) => sector !== 'out';
