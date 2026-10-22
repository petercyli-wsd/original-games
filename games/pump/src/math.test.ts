import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec, { deepest, sampleTarget } from './eval';
import manifest from './manifest';
import { runAutoRound } from './round';
import {
  DIFFICULTIES,
  MAX_MULTIPLIER,
  POPS,
  POSITIONS,
  RTP,
  drawPositions,
  firstPop,
  ladder,
  maxPumps,
  multiplier,
  playToTarget,
  popChance,
  survival,
  topMultiplier,
} from './math';

const rng = createRng(seededSource(11));

const binom = (n: number, k: number) => {
  let c = 1;
  for (let i = 0; i < k; i++) c = (c * (n - i)) / (i + 1);
  return c;
};

describe('Pump maths', () => {
  it('matches the closed form 0.99 · C(25, k) / C(25 − d, k)', () => {
    for (const x of DIFFICULTIES) {
      const d = POPS[x];
      for (let k = 0; k <= maxPumps(d); k++) {
        expect(multiplier(d, k) / (RTP * (binom(POSITIONS, k) / binom(POSITIONS - d, k)))).toBeCloseTo(1, 12);
        expect(survival(d, k) / (binom(POSITIONS - d, k) / binom(POSITIONS, k))).toBeCloseTo(1, 12);
      }
    }
  });

  it('every stopping point is worth exactly the RTP (exact enumeration over all C(25, d) layouts for d ≤ 3)', () => {
    for (const x of DIFFICULTIES) {
      const d = POPS[x];
      for (let k = 1; k <= maxPumps(d); k++) expect(survival(d, k) * multiplier(d, k)).toBeCloseTo(RTP, 10);
    }
    // Enumerate every placement of the pops for Easy and Medium and every fixed stop.
    for (const d of [1, 3]) {
      const layouts: boolean[][] = [];
      const pick = (start: number, chosen: number[]) => {
        if (chosen.length === d) {
          const pos = new Array<boolean>(POSITIONS).fill(false);
          for (const c of chosen) pos[c] = true;
          layouts.push(pos);
          return;
        }
        for (let i = start; i < POSITIONS; i++) pick(i + 1, [...chosen, i]);
      };
      pick(0, []);
      expect(layouts.length).toBe(binom(POSITIONS, d));
      for (let t = 1; t <= maxPumps(d); t++) {
        let total = 0;
        for (const pos of layouts) total += playToTarget(pos, d, t).multiplier;
        expect(total / layouts.length).toBeCloseTo(RTP, 10);
      }
    }
  });

  it('each pump is a fair bet: (1 − q) · next rung = current cash-out', () => {
    for (const x of DIFFICULTIES) {
      const d = POPS[x];
      for (let k = 0; k < maxPumps(d); k++) {
        const q = popChance(d, k);
        expect((1 - q) * multiplier(d, k + 1)).toBeCloseTo(multiplier(d, k), 9);
        expect(q).toBeCloseTo(d / (POSITIONS - k), 15);
      }
      expect(popChance(d, maxPumps(d))).toBe(1); // never offered: the round cashes out
    }
  });

  it('the drawn layout has exactly d pops, uniformly placed, and survival matches simulation', () => {
    for (const x of DIFFICULTIES) {
      const d = POPS[x];
      const n = 60_000;
      const firstCounts = new Array<number>(POSITIONS + 2).fill(0);
      const k = Math.min(4, maxPumps(d));
      let survived = 0;
      for (let i = 0; i < n; i++) {
        const pos = drawPositions(rng, d);
        if (pos.filter(Boolean).length !== d) throw new Error('wrong pop count');
        firstCounts[firstPop(pos)]++;
        if (playToTarget(pos, d, k).multiplier > 0) survived++;
      }
      const p = survival(d, k);
      expect(Math.abs(survived / n - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / n));
      // First pop on pump j: S(j − 1) − S(j).
      for (let j = 1; j <= 3; j++) {
        const pj = survival(d, j - 1) - survival(d, j);
        expect(Math.abs(firstCounts[j] / n - pj)).toBeLessThan(4 * Math.sqrt((pj * (1 - pj)) / n));
      }
    }
  });

  it('pumping to the end on Easy hits the top rung 1 time in 25', () => {
    const n = 100_000;
    let hits = 0;
    for (let i = 0; i < n; i++) if (playToTarget(drawPositions(rng, 1), 1, 24).multiplier > 0) hits++;
    const p = 1 / 25;
    expect(Math.abs(hits / n - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / n));
    expect(topMultiplier(1)).toBeCloseTo(24.75, 10);
  });

  it('the ladder rises and the max multiplier is honest', () => {
    for (const x of DIFFICULTIES) {
      const l = ladder(POPS[x]);
      expect(l.length).toBe(maxPumps(POPS[x]));
      for (let i = 1; i < l.length; i++) expect(l[i]).toBeGreaterThan(l[i - 1]);
      expect(l[l.length - 1]).toBeLessThanOrEqual(MAX_MULTIPLIER);
    }
    expect(topMultiplier(3)).toBeCloseTo(2277, 8);
    expect(topMultiplier(5)).toBeCloseTo(52598.7, 6);
    expect(MAX_MULTIPLIER).toBeCloseTo(0.99 * binom(25, 10), 4);
    expect(manifest.maxMultiplier).toBe(MAX_MULTIPLIER);
  });

  it('the auto target and sampled strategies stay on the ladder', () => {
    for (const x of DIFFICULTIES) {
      const d = POPS[x];
      for (let i = 0; i < 2000; i++) {
        const t = sampleTarget(d, rng.next(), rng.next(), rng.int);
        expect(t).toBeGreaterThanOrEqual(1);
        expect(t).toBeLessThanOrEqual(deepest(d));
      }
    }
  });

  it('auto play resolves once per round, with the same payout as the maths', async () => {
    for (const x of DIFFICULTIES) {
      const d = POPS[x];
      for (let i = 0; i < 300; i++) {
        const positions = drawPositions(rng, d);
        const target = 1 + rng.int(maxPumps(d));
        let settles = 0;
        let settled = -1;
        let pumps = 0;
        const m = await runAutoRound({
          positions,
          d,
          target,
          animate: async () => (pumps++, true),
          settle: (v) => {
            settles++;
            settled = v;
          },
        });
        const want = playToTarget(positions, d, target);
        expect(settles).toBe(1);
        expect(m).toBe(settled);
        expect(m).toBe(want.multiplier);
        expect(pumps).toBe(want.pumps);
      }
    }
    // Interrupted mid-animation: no settle, resolves null.
    let settles = 0;
    const m = await runAutoRound({ positions: drawPositions(rng, 3), d: 3, target: 5, animate: async () => false, settle: () => settles++ });
    expect(m).toBeNull();
    expect(settles).toBe(0);
  });

  it('simulated RTP matches the manifest across sampled strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000, seed: 5 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
