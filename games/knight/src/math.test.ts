import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  MAX_MULTIPLIER,
  MOVES,
  RTP,
  START,
  TOTAL_DEGREE,
  TURNS,
  allTargets,
  cashAt,
  chance,
  degree,
  endDistribution,
  inTarget,
  isLight,
  prizeFor,
  reachable,
  startChance,
  type Target,
} from './math';

const rng = createRng(seededSource(11));
const SOME: Target[] = allTargets().filter((t) => t.region !== 'square' || [0, 18, 28, 36, 63].includes(t.square));

describe('Knight maths', () => {
  it('the knight graph: degrees 2…8, Σ deg = 336, every move changes colour', () => {
    expect(TOTAL_DEGREE).toBe(336);
    expect(degree(0)).toBe(2);
    expect(degree(27)).toBe(8);
    for (let s = 0; s < 64; s++) for (const y of MOVES[s]) {
      expect(MOVES[y]).toContain(s);
      expect(isLight(y)).toBe(!isLight(s));
    }
  });

  it('stationary distribution is deg/336: one step of the walk leaves it unchanged', () => {
    const pi = Array.from({ length: 64 }, (_, s) => degree(s) / TOTAL_DEGREE);
    const out = new Array(64).fill(0);
    for (let s = 0; s < 64; s++) for (const y of MOVES[s]) out[y] += pi[s] / degree(s);
    for (let s = 0; s < 64; s++) expect(out[s]).toBeCloseTo(pi[s], 14);
  });

  it('exact chances match a direct simulation of the random knight (4 SE)', () => {
    for (const T of TURNS) {
      for (const t of SOME) {
        const p = startChance(T, t);
        const n = 4000;
        let hits = 0;
        for (let i = 0; i < n; i++) {
          let s = START;
          for (let k = 0; k < T; k++) s = MOVES[s][rng.int(MOVES[s].length)];
          if (inTarget(s, t)) hits++;
        }
        expect(Math.abs(hits / n - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / n) + 2e-3);
      }
    }
  });

  it('martingale: E[cash-out after the next move] = cash-out now, at every state', () => {
    for (const T of TURNS) {
      for (const t of allTargets()) {
        if (startChance(T, t) === 0) continue;
        const prize = prizeFor(T, t);
        for (let left = 1; left <= T; left++) {
          for (let s = 0; s < 64; s++) {
            const after = MOVES[s].reduce((a, y) => a + cashAt(prize, y, left - 1, t), 0) / MOVES[s].length;
            expect(Math.abs(after - cashAt(prize, s, left, t))).toBeLessThan(1e-9 * prize);
          }
        }
        expect(cashAt(prize, START, T, t)).toBeCloseTo(RTP, 12);
      }
    }
  });

  it('the drawn odds are the true risk: green dot mass and the average of the next-jump labels both equal the chance', () => {
    for (const t of SOME) {
      for (let left = 0; left <= 12; left++) {
        for (let s = 0; s < 64; s++) {
          const d = endDistribution(s, left);
          const total = d.reduce((a, x) => a + x, 0);
          expect(total).toBeCloseTo(1, 12);
          const green = d.reduce((a, x, y) => a + (inTarget(y, t) ? x : 0), 0);
          expect(green).toBeCloseTo(chance(s, left, t), 12);
          if (left > 0) {
            const avg = MOVES[s].reduce((a, y) => a + chance(y, left - 1, t), 0) / MOVES[s].length;
            expect(avg).toBeCloseTo(chance(s, left, t), 12);
          }
        }
      }
    }
  });

  it('long run: the end distribution approaches 2·deg/336 on the reachable colour', () => {
    const d = endDistribution(START, 12);
    for (let s = 0; s < 64; s++) {
      const want = isLight(s) === isLight(START) ? (2 * degree(s)) / TOTAL_DEGREE : 0;
      expect(Math.abs(d[s] - want)).toBeLessThan(0.006);
    }
  });

  it('squares the panel offers are reachable with the right colour, and the max multiplier bounds every prize', () => {
    for (const T of TURNS) {
      for (let s = 0; s < 64; s++) {
        if (reachable(T, s)) expect(isLight(s)).toBe(isLight(START) !== (T % 2 === 1));
      }
      for (const t of allTargets()) {
        const p = startChance(T, t);
        if (p > 0) expect(RTP / p).toBeLessThanOrEqual(MAX_MULTIPLIER);
      }
    }
    expect(manifest.maxMultiplier).toBe(MAX_MULTIPLIER);
  });

  it('simulated RTP matches the manifest under sampled stopping rules', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
