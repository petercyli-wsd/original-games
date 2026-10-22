import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  DIFFICULTIES,
  DIFFICULTY,
  MAX_MULTIPLIER,
  PATTERNS,
  ROWS,
  RTP,
  afterSafe,
  buildTower,
  climb,
  multiplier,
  patternColumns,
  reachChance,
  rowSafe,
  summit,
  type Difficulty,
} from './math';

const rng = createRng(seededSource(23));
const shuffle = <T,>(xs: readonly T[]) => rng.shuffle(xs);

/** Every s-subset of t tiles, as boolean rows. */
function rowsOf(d: Difficulty): boolean[][] {
  const { tiles, safe } = DIFFICULTY[d];
  const out: boolean[][] = [];
  for (let mask = 0; mask < 1 << tiles; mask++) {
    const row = Array.from({ length: tiles }, (_, c) => !!(mask & (1 << c)));
    if (row.filter(Boolean).length === safe) out.push(row);
  }
  return out;
}

/** Exact value of the stopping rule "cash out when stopAt(k)" by backward induction over k. */
function strategyValue(d: Difficulty, stopAt: (k: number) => boolean): number {
  const value = (k: number): number => {
    if (k === ROWS || (k > 0 && stopAt(k))) return multiplier(d, k);
    return rowSafe(d) * value(k + 1);
  };
  return value(0);
}

describe('Tower maths', () => {
  it('pays RTP / p^k: every fixed target row is worth exactly 99%', () => {
    for (const d of DIFFICULTIES) {
      for (let k = 0; k <= ROWS; k++) expect(reachChance(d, k) * multiplier(d, k)).toBeCloseTo(RTP, 12);
    }
    expect(multiplier('easy', 1)).toBeCloseTo((0.99 * 4) / 3, 12);
    expect(multiplier('hard', 9)).toBeCloseTo(506.88, 9);
    expect(summit('expert')).toBeCloseTo(0.99 * 19683, 6);
    expect(summit('master')).toBeCloseTo(259_522.56, 4);
  });

  it('exact enumeration: every tile of every row is safe with chance s / t, whatever the column', () => {
    for (const d of DIFFICULTIES) {
      const all = rowsOf(d);
      const { tiles, safe } = DIFFICULTY[d];
      // C(t, s) equally likely rows.
      const binom = (n: number, k: number): number => (k === 0 ? 1 : (binom(n - 1, k - 1) * n) / k);
      expect(all.length).toBe(binom(tiles, safe));
      for (let c = 0; c < tiles; c++) {
        expect(all.filter((r) => r[c]).length / all.length).toBeCloseTo(safe / tiles, 12);
      }
    }
  });

  it('exact enumeration over two rows: any column pair survives with chance p², and every pattern pays 99%', () => {
    for (const d of DIFFICULTIES) {
      const all = rowsOf(d);
      const t = DIFFICULTY[d].tiles;
      for (let c0 = 0; c0 < t; c0++)
        for (let c1 = 0; c1 < t; c1++) {
          let ev = 0;
          for (const r0 of all) for (const r1 of all) ev += climb([r0, r1], d, [c0, c1]).multiplier / all.length ** 2;
          expect(ev).toBeCloseTo(RTP, 12);
        }
    }
  });

  it('every stopping rule returns exactly RTP (analytic, backward induction)', () => {
    for (const d of DIFFICULTIES) {
      expect(strategyValue(d, () => false)).toBeCloseTo(RTP, 10); // go for the summit
      for (let t = 1; t <= ROWS; t++) expect(strategyValue(d, (k) => k >= t)).toBeCloseTo(RTP, 10);
      for (const target of [2, 10, 100]) expect(strategyValue(d, (k) => multiplier(d, k) >= target)).toBeCloseTo(RTP, 10);
      for (let trial = 0; trial < 40; trial++) {
        const stops = Array.from({ length: ROWS + 1 }, () => rng.next() < 0.3);
        expect(strategyValue(d, (k) => stops[k])).toBeCloseTo(RTP, 10);
      }
    }
  });

  it('each row is a fair bet: E[cash-out after] = cash-out before', () => {
    for (const d of DIFFICULTIES) {
      for (let k = 0; k < ROWS; k++) {
        const before = multiplier(d, k);
        expect(rowSafe(d) * afterSafe(before, d)).toBeCloseTo(before, 9);
        expect(afterSafe(before, d) / multiplier(d, k + 1)).toBeCloseTo(1, 12);
      }
    }
  });

  it('builds rows with exactly s safe tiles', () => {
    for (const d of DIFFICULTIES) {
      const tower = buildTower(d, shuffle);
      expect(tower.length).toBe(ROWS);
      for (const row of tower) {
        expect(row.length).toBe(DIFFICULTY[d].tiles);
        expect(row.filter(Boolean).length).toBe(DIFFICULTY[d].safe);
      }
    }
  });

  it('a direct simulation of the raw tower survives k rows as often as p^k says, for every pattern', () => {
    const n = 16_000;
    for (const [d, k] of [
      ['easy', 9],
      ['medium', 5],
      ['hard', 4],
      ['expert', 2],
      ['master', 2],
    ] as [Difficulty, number][]) {
      const p = reachChance(d, k);
      for (const { value: pattern } of PATTERNS) {
        const custom = [1, 0, 1, 0, 1, 0, 1, 0, 1];
        let wins = 0;
        for (let r = 0; r < n; r++) {
          const tower = buildTower(d, shuffle);
          if (climb(tower, d, patternColumns(pattern, d, k, custom, (m) => rng.int(m))).bust === null) wins++;
        }
        expect(Math.abs(wins / n - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / n));
      }
    }
  });

  it('the shown odds are the true odds: the next row is safe s / t of the time in every column, after any history', () => {
    const d: Difficulty = 'medium';
    const n = 90_000;
    const hits = [0, 0, 0];
    let kept = 0;
    for (let r = 0; r < n; r++) {
      const tower = buildTower(d, shuffle);
      // Condition on surviving rows 0–2 with columns 0, 2, 1.
      if (!tower[0][0] || !tower[1][2] || !tower[2][1]) continue;
      kept++;
      for (let c = 0; c < 3; c++) hits[c] += tower[3][c] ? 1 : 0;
    }
    const p = rowSafe(d);
    for (const h of hits) expect(Math.abs(h / kept - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / kept));
  });

  it('patterns pick legal columns and custom columns clamp to the row width', () => {
    for (const d of DIFFICULTIES) {
      const t = DIFFICULTY[d].tiles;
      for (const { value } of PATTERNS) {
        const cols = patternColumns(value, d, ROWS, [3, 3, 3, 0, 0, 0, 2, 2, 2], (m) => rng.int(m));
        expect(cols.length).toBe(ROWS);
        for (const c of cols) expect(c >= 0 && c < t).toBe(true);
      }
      expect(patternColumns('right', d, 3, [], () => 0)).toEqual([t - 1, t - 1, t - 1]);
      expect(patternColumns('zigzag', d, 3, [], () => 0)).toEqual([0, t - 1, 0]);
    }
  });

  it('the paytable is monotone and the max multiplier is honest', () => {
    for (const d of DIFFICULTIES) {
      for (let k = 1; k <= ROWS; k++) {
        expect(multiplier(d, k)).toBeGreaterThan(multiplier(d, k - 1));
        expect(multiplier(d, k)).toBeLessThanOrEqual(MAX_MULTIPLIER + 1e-9);
      }
    }
    // Harder difficulties pay more for the same row.
    const order: Difficulty[] = ['easy', 'medium', 'hard', 'expert', 'master'];
    for (let i = 1; i < order.length; i++) expect(multiplier(order[i], 1)).toBeGreaterThan(multiplier(order[i - 1], 1));
    expect(MAX_MULTIPLIER).toBe(summit('master'));
    expect(manifest.maxMultiplier).toBe(MAX_MULTIPLIER);
  });

  it('an auto bet resolves once, to M(target) or 0, and returns 99%', () => {
    const d: Difficulty = 'medium';
    const target = 4;
    const n = 50_000;
    let sum = 0;
    let sumSq = 0;
    for (let r = 0; r < n; r++) {
      const tower = buildTower(d, shuffle);
      const cols = patternColumns('zigzag', d, target, [], () => 0);
      const res = climb(tower, d, cols);
      if (res.bust === null) {
        expect(res.picks).toEqual(cols);
        expect(res.multiplier).toBeCloseTo(multiplier(d, target), 12);
      } else {
        expect(res.multiplier).toBe(0);
        expect(res.picks.length).toBe(res.bust + 1);
        expect(tower[res.bust][res.picks[res.bust]]).toBe(false);
        expect(res.picks.slice(0, -1).every((c, row) => tower[row][c])).toBe(true);
      }
      sum += res.multiplier;
      sumSq += res.multiplier ** 2;
    }
    const mean = sum / n;
    const se = Math.sqrt((sumSq / n - mean ** 2) / n);
    expect(Math.abs(mean - RTP)).toBeLessThan(4 * se);
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 40_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
