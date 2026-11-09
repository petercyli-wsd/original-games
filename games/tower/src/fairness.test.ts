// Fairness audit: can any way of playing Tower beat the RTP?
//
// The tower is built at bet time (buildTower with the host shuffle: one
// Fisher–Yates per row, safe = the first s of the order). The player then picks
// one tile per row and may cash out after any safe row; the summit auto-pays.
// Decisions: which column, and when to stop. Difficulty is locked while live,
// Random pick draws the column from rng.int independent of the tower, keys 1–4
// call the same pick(), and Auto climbs a preset column list on a real tower
// (climb). The board renders only revealed tiles (no safe/trap class or label
// on a hidden tile), and Cash out / Random pick / tiles are disabled while a
// tile flips, so nothing leaks before the decision.
//
// The claim "cash out whenever the next row is under 80% safe" fails exactly
// when, at every reachable state and for every tile c of the next row,
//
//     P(c is safe | history) · M(k + 1) = M(k).
//
// The martingale check computes P(c is safe | history) exactly by running the
// real buildTower on every permutation the shuffle could return for the
// previous row and the next row (rows are independent draws, so earlier rows
// only condition on themselves), conditioned on the previous pick being safe,
// at ≥ 30 states from real rounds, including the last row before the summit.
// A Monte Carlo pass on 100k real towers per difficulty checks the same rates
// with the host shuffle, also conditioned on the previous row.
//
// Strategies on every eval config (the extreme config samples Expert or
// Master each round, as the eval does):
//   (a) the tester's: climb while the next row is ≥ 80% safe, else cash out.
//       Every row is ≤ 75% safe, so this is "cash out after the mandatory
//       first row";
//   (b) take any profit: cash out the moment the cash-out exceeds the bet;
//   (c) climb to the summit;
//   (d) "hot column": pick the column that was safe in the row below (zigzag
//       after a switch), cash out at ≥ 3× or after two rows on Master;
//       and every Auto pattern to row 4.
// Every rule stops on k only (the column cannot matter), so each is also
// valued exactly by backward induction. A summit on Hard/Expert/Master is too
// rare to sample, so (c) is asserted by Monte Carlo only on Easy and Medium
// and by the exact value everywhere.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import {
  DIFFICULTIES,
  DIFFICULTY,
  MAX_MULTIPLIER,
  PATTERNS,
  ROWS,
  RTP,
  buildTower,
  climb,
  multiplier,
  patternColumns,
  rowSafe,
  type Difficulty,
  type Tower,
} from './math';

/** Rounds per strategy run; the audit's heavy run sets FAIRNESS_ROUNDS=200000. */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 5_000);

function permutations(n: number): number[][] {
  if (n === 1) return [[0]];
  const out: number[][] = [];
  for (const p of permutations(n - 1)) for (let i = 0; i <= p.length; i++) out.push([...p.slice(0, i), n - 1, ...p.slice(i)]);
  return out;
}

/** Builds a tower with the real buildTower, the shuffle returning the given order for each row. */
function towerFrom(d: Difficulty, orders: number[][]): Tower {
  let row = 0;
  return buildTower(d, <T,>(xs: readonly T[]) => orders[row++].map((i) => xs[i]));
}

/** Stop rule: cash out with k ≥ 1 rows cleared? */
type Stop = (d: Difficulty, k: number) => boolean;

/** Exact value of a stop-on-k rule: the first row is mandatory, the summit auto-pays. */
function exactValue(d: Difficulty, stop: Stop): number {
  const p = rowSafe(d);
  let v = multiplier(d, ROWS);
  for (let k = ROWS - 1; k >= 0; k--) v = k > 0 && stop(d, k) ? multiplier(d, k) : p * v;
  return v;
}

/** A manual round as Game.tsx plays it, on a real tower; `col` picks the column for row k. */
function manualRound(d: Difficulty, rng: Rng, stop: Stop, col: (k: number, tower: Tower, picks: number[]) => number): number {
  const tower = buildTower(d, (xs) => rng.shuffle(xs));
  const picks: number[] = [];
  for (let k = 0; ; ) {
    const c = col(k, tower, picks);
    picks.push(c);
    if (!tower[k][c]) return 0;
    k++;
    if (k >= ROWS) return multiplier(d, k);
    if (stop(d, k)) return multiplier(d, k);
  }
}

describe('Tower fairness', () => {
  it('martingale (exact): P(tile safe | history) · M(k+1) = M(k) for every tile, real buildTower on every shuffle order', () => {
    const rng = createRng(seededSource(12));
    let states = 0;
    for (const d of DIFFICULTIES) {
      const { tiles } = DIFFICULTY[d];
      const perms = permutations(tiles);
      // Every row, from the first pick to the last row below the summit, with a random previous pick.
      for (let k = 0; k < ROWS; k++) {
        const prevPick = rng.int(tiles);
        // Rows below k − 1 are fixed to orders that make some pick safe; they are separate shuffles and do not matter.
        const fixed = Array.from({ length: ROWS }, () => perms[0]);
        let n = 0;
        const safeCount = new Array<number>(tiles).fill(0);
        for (const pPrev of k > 0 ? perms : [perms[0]])
          for (const pNext of perms) {
            const orders = fixed.slice();
            if (k > 0) orders[k - 1] = pPrev;
            orders[k] = pNext;
            const tower = towerFrom(d, orders);
            if (k > 0 && !tower[k - 1][prevPick]) continue; // condition on the previous pick being safe
            n++;
            for (let c = 0; c < tiles; c++) if (tower[k][c]) safeCount[c]++;
          }
        for (let c = 0; c < tiles; c++) {
          const p = safeCount[c] / n;
          expect(p).toBeCloseTo(rowSafe(d), 12);
          expect(p * multiplier(d, k + 1)).toBeCloseTo(multiplier(d, k), 9);
        }
        states++;
      }
    }
    expect(states).toBeGreaterThanOrEqual(30);
  });

  it('martingale (Monte Carlo, host shuffle): every tile’s safe rate given the previous pick was safe, 100k towers per difficulty, 4 SE', () => {
    const rng = createRng(seededSource(99));
    for (const d of DIFFICULTIES) {
      const { tiles } = DIFFICULTY[d];
      const p = rowSafe(d);
      const k = 1 + rng.int(ROWS - 1);
      const prev = rng.int(tiles);
      const hits = new Array<number>(tiles).fill(0);
      let n = 0;
      for (let i = 0; i < 100_000; i++) {
        const t = buildTower(d, (xs) => rng.shuffle(xs));
        if (!t[k - 1][prev]) continue;
        n++;
        for (let c = 0; c < tiles; c++) if (t[k][c]) hits[c]++;
      }
      const se = Math.sqrt((p * (1 - p)) / n);
      for (let c = 0; c < tiles; c++) expect(Math.abs(hits[c] / n - p)).toBeLessThan(4 * se);
    }
  });

  it('Auto is the same maths as manual: climb on a tower pays what picking the same columns by hand pays', () => {
    const rng = createRng(seededSource(5));
    for (let n = 0; n < 3000; n++) {
      const d = DIFFICULTIES[rng.int(DIFFICULTIES.length)];
      const target = 1 + rng.int(ROWS);
      const pattern = PATTERNS[rng.int(PATTERNS.length)].value;
      const custom = Array.from({ length: ROWS }, () => rng.int(4));
      const tower = buildTower(d, (xs) => rng.shuffle(xs));
      const cols = patternColumns(pattern, d, target, custom, (m) => rng.int(m));
      let manual = multiplier(d, target);
      for (let k = 0; k < target; k++) if (!tower[k][cols[k]]) {
        manual = 0;
        break;
      }
      expect(climb(tower, d, cols).multiplier).toBe(manual);
    }
  });

  const tester: Stop = (d) => rowSafe(d) < 0.8;
  const profit: Stop = (d, k) => multiplier(d, k) > 1;
  const summitRule: Stop = () => false;
  const hotStop: Stop = (d, k) => multiplier(d, k) >= 3 || (d === 'master' && k >= 2);
  const hotCol = (k: number, tower: Tower, picks: number[]) => (k === 0 ? 0 : tower[k - 1][picks[k - 1]] ? picks[k - 1] : (picks[k - 1] + 1) % tower[k].length);

  it('every strategy is worth exactly RTP (backward induction) on every difficulty', () => {
    for (const d of DIFFICULTIES) for (const s of [tester, profit, summitRule, hotStop]) expect(exactValue(d, s)).toBeCloseTo(RTP, 10);
  });

  it('strategies (a)–(d) on every eval config return RTP within 4 SE on real towers, never above the max', () => {
    const rows: string[] = [];
    const band = (cfg: (typeof evalSpec.configs)[number]) => (cfg.params as { band: Difficulty[] }).band;
    const run = (label: string, play: (rng: Rng) => number, seed: number, assert = true) => {
      const rng = createRng(seededSource(seed));
      let s = 0;
      let s2 = 0;
      let max = 0;
      for (let i = 0; i < ROUNDS; i++) {
        const m = play(rng);
        s += m;
        s2 += m * m;
        max = Math.max(max, m);
      }
      const mean = s / ROUNDS;
      const se = Math.sqrt(Math.max(0, s2 / ROUNDS - mean * mean) / ROUNDS);
      rows.push(`${label.padEnd(46)} ${(mean * 100).toFixed(2)}% ± ${(se * 100).toFixed(2)}%  z=${((mean - RTP) / (se || 1)).toFixed(2)}${assert ? '' : '  (exact only)'}`);
      if (assert) expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-12);
      expect(max).toBeLessThanOrEqual(MAX_MULTIPLIER);
    };
    evalSpec.configs.forEach((cfg, i) => {
      const ds = band(cfg);
      const pick = (rng: Rng) => ds[rng.int(ds.length)];
      const randomCol = (rng: Rng) => (k: number, t: Tower) => rng.int(t[k].length);
      run(`(a) ≥80% safe · ${cfg.label}`, (rng) => manualRound(pick(rng), rng, tester, randomCol(rng)), 10 * i + 1);
      run(`(b) any profit · ${cfg.label}`, (rng) => manualRound(pick(rng), rng, profit, randomCol(rng)), 10 * i + 2);
      // A summit is sampled often enough only on Easy (7.5%) and Medium (2.6%).
      run(`(c) summit · ${cfg.label}`, (rng) => manualRound(pick(rng), rng, summitRule, randomCol(rng)), 10 * i + 3, ds.every((d) => d === 'easy' || d === 'medium'));
      run(`(d) hot column, ≥3× · ${cfg.label}`, (rng) => manualRound(pick(rng), rng, hotStop, hotCol), 10 * i + 4);
      run(
        `(d) auto pattern to row 4 · ${cfg.label}`,
        (rng) => {
          const d = pick(rng);
          const pattern = PATTERNS[rng.int(PATTERNS.length)].value;
          const custom = Array.from({ length: ROWS }, () => rng.int(DIFFICULTY[d].tiles));
          const tower = buildTower(d, (xs) => rng.shuffle(xs));
          return climb(tower, d, patternColumns(pattern, d, 4, custom, (m) => rng.int(m))).multiplier;
        },
        10 * i + 5,
      );
    });
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
