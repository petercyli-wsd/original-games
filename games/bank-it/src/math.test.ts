import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import { MAX_WIN, RTP, TARGETS, TURNS, bankChance, bestIsBank, canBank, relock, rollChance, startPrize, winChance } from './math';

const rng = createRng(seededSource(7));

// Independent exact solver: plain memoised recursion in rationals-free doubles,
// written differently (turn by turn, pot as the loop variable).
function exact(n: number, p: number, t: number, memo = new Map<string, number>()): number {
  if (t === 0) return 0;
  const key = `${n},${p},${t}`;
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  let roll = (2 / 6) * exact(n, 0, t - 1, memo);
  for (const d of [3, 4, 5, 6]) roll += (1 / 6) * (p + d >= n ? 1 : exact(n, p + d, t, memo));
  const bank = t >= 2 && p >= 1 ? exact(n - p, 0, t - 1, memo) : 0;
  const v = Math.max(roll, bank);
  memo.set(key, v);
  return v;
}

describe('win chance', () => {
  it('matches the independent solver', () => {
    for (const [n, p, t] of [[10, 0, 5], [30, 0, 5], [30, 9, 3], [65, 0, 5], [20, 7, 1], [40, 15, 4]] as const) {
      expect(winChance(n, p, t)).toBeCloseTo(exact(n, p, t), 10);
    }
  });

  it('matches a direct simulation of best play', () => {
    for (const k of [15, 35, 65]) {
      const N = 60_000;
      let wins = 0;
      for (let i = 0; i < N; i++) {
        let n = k, pot = 0, t = TURNS, done = false;
        while (!done) {
          if (canBank(pot, t) && bestIsBank(n, pot, t)) { n -= pot; pot = 0; t--; continue; }
          const f = 1 + rng.int(6);
          if (f <= 2) { pot = 0; if (--t === 0) done = true; }
          else { pot += f; if (pot >= n) { wins++; done = true; } }
        }
      }
      const p = winChance(k, 0, TURNS);
      expect(Math.abs(wins / N - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / N));
    }
  });

  it('has the table values and a 25:1 spread across the targets', () => {
    expect(winChance(30, 0, 5)).toBeCloseTo(0.396, 3);
    expect(winChance(TARGETS[0], 0, 5) / winChance(TARGETS[TARGETS.length - 1], 0, 5)).toBeGreaterThan(25);
  });
});

describe('martingale and odds on screen', () => {
  const states: [number, number, number][] = [];
  for (const n of [12, 30, 65]) for (const p of [0, 3, 8, 11]) for (const t of [1, 2, 3, 5]) if (p < n) states.push([n, p, t]);

  it('the best option keeps the value; the cash-out is a martingale', () => {
    for (const [n, p, t] of states) {
      const v = winChance(n, p, t);
      expect(Math.max(rollChance(n, p, t), bankChance(n, p, t))).toBeCloseTo(v, 12);
      let after = (2 / 6) * winChance(n, 0, t - 1);
      for (const d of [3, 4, 5, 6]) after += (1 / 6) * (p + d >= n ? 1 : winChance(n, p + d, t));
      expect(after).toBeCloseTo(rollChance(n, p, t), 12);
      if (!bestIsBank(n, p, t)) expect(after).toBeCloseTo(v, 12);
    }
  });

  it('every scoring roll raises the chance and every wipe lowers it', () => {
    for (let n = 3; n <= 65; n += 2) for (let t = 1; t <= TURNS; t++) for (let p = 0; p < n; p++) {
      const v = winChance(n, p, t);
      for (const d of [3, 4, 5, 6]) {
        const after = p + d >= n ? 1 : winChance(n, p + d, t);
        if (v < 1 - 1e-12) expect(after).toBeGreaterThanOrEqual(v - 1e-12);
      }
      if (t >= 1 && p > 0) expect(winChance(n, 0, t - 1)).toBeLessThanOrEqual(v + 1e-12);
    }
  });

  it('relock keeps the cash-out and refuses only above MAX_WIN', () => {
    const prize = startPrize(35);
    const best = 0.4, chosen = 0.3;
    const next = relock(prize, best, chosen)!;
    expect(next * chosen).toBeCloseTo(prize * best, 12);
    expect(relock(prize, best, best)).toBe(prize);
    expect(relock(1000, 1, 1e-6)).toBeNull();
    expect(MAX_WIN).toBe(10_000);
  });
});

describe('eval', () => {
  it('pays the RTP in every config, within the max, and rounds stay short', () => {
    const rows = runEval(evalSpec, { rounds: 40_000, seed: 3 });
    expect(rows).toHaveLength(TARGETS.length);
    for (const r of rows) {
      expect(Math.abs(r.rtp - RTP)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
      expect(r.p99Steps).toBeLessThanOrEqual(30);
    }
  });
});
