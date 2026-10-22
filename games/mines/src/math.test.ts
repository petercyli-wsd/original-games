import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  MAX_MINES,
  MAX_MULTIPLIER,
  MIN_MINES,
  RTP,
  TILES,
  afterSafe,
  choose,
  fullClear,
  gemsFor,
  multiplier,
  nextSafe,
  placeMines,
  playSelection,
  surviveChance,
} from './math';

const rng = createRng(seededSource(11));
const shuffle = <T,>(xs: readonly T[]) => rng.shuffle(xs);
const ALL_MINES = Array.from({ length: MAX_MINES - MIN_MINES + 1 }, (_, i) => i + MIN_MINES);

/** Every m-subset of the 25 tiles, as bitmasks. */
function subsets(m: number): number[] {
  const out: number[] = [];
  const rec = (start: number, left: number, mask: number) => {
    if (left === 0) return void out.push(mask);
    for (let t = start; t <= TILES - left; t++) rec(t + 1, left - 1, mask | (1 << t));
  };
  rec(0, m, 0);
  return out;
}

/** Exact value of a stopping rule "cash out when stopAt(k)" by backward induction over k. */
function strategyValue(m: number, stopAt: (k: number) => boolean): number {
  const value = (k: number): number => {
    if (k === gemsFor(m) || (k > 0 && stopAt(k))) return multiplier(m, k);
    return nextSafe(m, k) * value(k + 1);
  };
  return value(0);
}

describe('Mines maths', () => {
  it('pays RTP / P(k): every fixed number of gems is worth exactly 99%', () => {
    for (const m of ALL_MINES) {
      for (let k = 0; k <= gemsFor(m); k++) {
        expect(surviveChance(m, k) * multiplier(m, k)).toBeCloseTo(RTP, 12);
      }
    }
    expect(multiplier(3, 1)).toBeCloseTo((0.99 * 25) / 22, 12);
    expect(multiplier(24, 1)).toBeCloseTo(24.75, 12);
    expect(multiplier(1, 24)).toBeCloseTo(24.75, 12);
  });

  it('exact enumeration of every mine placement matches C(25 − m, k) / C(25, k)', () => {
    for (const m of [1, 2, 3, 21, 22, 23, 24]) {
      const all = subsets(m);
      expect(all.length).toBe(choose(TILES, m));
      // Reveal in any fixed order (here a scrambled one): count the placements that survive k reveals.
      const order = shuffle(Array.from({ length: TILES }, (_, i) => i));
      for (let k = 1; k <= gemsFor(m); k++) {
        const prefix = order.slice(0, k).reduce((mask, t) => mask | (1 << t), 0);
        const safe = all.filter((s) => (s & prefix) === 0).length;
        expect(safe / all.length).toBeCloseTo(surviveChance(m, k), 12);
      }
    }
  });

  it('every stopping rule returns exactly RTP (analytic, backward induction)', () => {
    for (const m of ALL_MINES) {
      const g = gemsFor(m);
      expect(strategyValue(m, () => false)).toBeCloseTo(RTP, 10); // clear the board
      for (let t = 1; t <= g; t++) expect(strategyValue(m, (k) => k >= t)).toBeCloseTo(RTP, 10);
      for (const theta of [0.5, 0.7, 0.9]) expect(strategyValue(m, (k) => nextSafe(m, k) < theta)).toBeCloseTo(RTP, 10);
      // Random stopping sets.
      for (let trial = 0; trial < 20; trial++) {
        const stops = Array.from({ length: g + 1 }, () => rng.next() < 0.3);
        expect(strategyValue(m, (k) => stops[k])).toBeCloseTo(RTP, 10);
      }
    }
  });

  it('each reveal is a fair bet: E[cash-out after] = cash-out before', () => {
    for (const m of ALL_MINES) {
      for (let k = 0; k < gemsFor(m); k++) {
        const before = multiplier(m, k);
        expect(nextSafe(m, k) * afterSafe(before, m, k)).toBeCloseTo(before, 9);
        expect(afterSafe(before, m, k)).toBeCloseTo(multiplier(m, k + 1), 6);
      }
    }
  });

  it('the shown odds are the true odds, whichever tile is picked', () => {
    // After 4 gems in the top row with 5 mines, the next tile is safe with chance 16/21,
    // whether it is the next tile in the row, a corner or the centre.
    const m = 5;
    const revealed = [0, 1, 2, 3];
    const candidates = [4, 24, 12];
    const n = 120_000;
    const hits = candidates.map(() => 0);
    let kept = 0;
    for (let r = 0; r < n; r++) {
      const board = placeMines(m, shuffle);
      if (revealed.some((t) => board[t])) continue;
      kept++;
      candidates.forEach((t, i) => (hits[i] += board[t] ? 0 : 1));
    }
    const p = nextSafe(m, revealed.length);
    expect(p).toBeCloseTo(16 / 21, 12);
    for (const h of hits) expect(Math.abs(h / kept - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / kept));
  });

  it('a direct simulation of the raw process survives k reveals as often as the formula says', () => {
    for (const [m, k] of [
      [1, 12],
      [3, 5],
      [10, 3],
      [20, 1],
      [24, 1],
    ]) {
      const n = 40_000;
      let wins = 0;
      for (let r = 0; r < n; r++) {
        const board = placeMines(m, shuffle);
        const picks = shuffle(Array.from({ length: TILES }, (_, i) => i)).slice(0, k);
        if (picks.every((t) => !board[t])) wins++;
      }
      const p = surviveChance(m, k);
      expect(Math.abs(wins / n - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / n));
    }
  });

  it('places exactly m mines', () => {
    for (const m of ALL_MINES) expect(placeMines(m, shuffle).filter(Boolean).length).toBe(m);
  });

  it('the paytable is monotone and the max multiplier is honest', () => {
    for (const m of ALL_MINES) {
      for (let k = 1; k <= gemsFor(m); k++) expect(multiplier(m, k)).toBeGreaterThan(multiplier(m, k - 1));
      if (m < MAX_MINES) expect(multiplier(m + 1, 1)).toBeGreaterThan(multiplier(m, 1));
      expect(fullClear(m)).toBeCloseTo(RTP * choose(TILES, m), 4);
      for (let k = 0; k <= gemsFor(m); k++) expect(multiplier(m, k)).toBeLessThanOrEqual(MAX_MULTIPLIER + 1e-6);
    }
    expect(MAX_MULTIPLIER).toBeCloseTo(0.99 * 5_200_300, 4);
    expect(manifest.maxMultiplier).toBe(MAX_MULTIPLIER);
  });

  it('an auto bet resolves once, to M(set size) or 0, and returns 99%', () => {
    const m = 3;
    const set = [0, 6, 12, 18];
    const n = 100_000;
    let sum = 0;
    let sumSq = 0;
    for (let r = 0; r < n; r++) {
      const board = placeMines(m, shuffle);
      const res = playSelection(board, m, set);
      if (res.hit === null) {
        expect(res.revealed).toEqual(set);
        expect(res.multiplier).toBeCloseTo(multiplier(m, set.length), 12);
      } else {
        expect(res.multiplier).toBe(0);
        expect(res.revealed[res.revealed.length - 1]).toBe(res.hit);
        expect(res.revealed.slice(0, -1).every((t) => !board[t])).toBe(true);
      }
      sum += res.multiplier;
      sumSq += res.multiplier ** 2;
    }
    const mean = sum / n;
    const se = Math.sqrt((sumSq / n - mean ** 2) / n);
    expect(Math.abs(mean - RTP)).toBeLessThan(4 * se);
    expect(surviveChance(m, set.length) * multiplier(m, set.length)).toBeCloseTo(RTP, 12);
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 60_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
