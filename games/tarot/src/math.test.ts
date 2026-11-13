import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  CORE_MEAN,
  DIFFICULTIES,
  MAX_MULTIPLIER,
  RTP,
  SIDE_MEAN,
  TABLES,
  chancesGiven,
  distribution,
  drawIndex,
  mean,
  playRound,
  productOf,
  profitChance,
  returnChance,
  rtpOf,
  stdDevOf,
  topPrize,
} from './math';

describe('Tarot maths', () => {
  it('the tables are the published ones, value for value', () => {
    const show = (t: { value: number; p: number }[]) => t.map((c) => `${c.value}:${c.p}`).join(' ');
    expect(show(TABLES.easy.core)).toBe('1:0.51 2:0.22 3:0.1 4:0.1 5:0.07');
    expect(show(TABLES.easy.side)).toBe('0:0.1 0.4:0.6 1.1:0.1 1.5:0.1 2:0.1');
    expect(show(TABLES.medium.core)).toBe('1:0.55 2:0.23 3:0.13 5:0.06 10:0.03');
    expect(show(TABLES.medium.side)).toBe('0:0.19 0.3:0.5 0.6:0.15 2:0.09 4:0.07');
    expect(show(TABLES.hard.core)).toBe('1:0.6 2:0.26 4:0.1 8:0.03 24:0.01');
    expect(show(TABLES.hard.side)).toBe('0:0.26 0.15:0.4 0.55:0.2 2:0.09 7:0.05');
    expect(show(TABLES.expert.core)).toBe('1:0.6 2:0.3 5:0.08 10:0.015 50:0.005');
    expect(show(TABLES.expert.side)).toBe('0:0.47 0.15:0.2 0.35:0.2 3:0.1 10:0.03');
  });

  it('every table is a distribution; the core is never below 1x and the side has a 0x', () => {
    for (const d of DIFFICULTIES) {
      for (const t of [TABLES[d].core, TABLES[d].side]) {
        expect(t.reduce((a, c) => a + c.p, 0)).toBeCloseTo(1, 14);
        for (let i = 1; i < t.length; i++) expect(t[i].value).toBeGreaterThan(t[i - 1].value);
      }
      expect(Math.min(...TABLES[d].core.map((c) => c.value))).toBeGreaterThanOrEqual(1);
      expect(TABLES[d].side[0].value).toBe(0);
    }
  });

  it('closed form: core mean 2.00, side mean 0.70, so RTP = 2 x 0.7^2 = 0.98 on every difficulty', () => {
    expect(RTP).toBe(0.98);
    for (const d of DIFFICULTIES) {
      expect(mean(TABLES[d].core)).toBeCloseTo(CORE_MEAN, 12);
      expect(mean(TABLES[d].side)).toBeCloseTo(SIDE_MEAN, 12);
      expect(CORE_MEAN * SIDE_MEAN ** 2).toBeCloseTo(RTP, 12);
    }
  });

  it('enumerating all 125 triples gives exactly 98% on every difficulty', () => {
    for (const d of DIFFICULTIES) {
      const { core, side } = TABLES[d];
      let ev = 0;
      let mass = 0;
      let n = 0;
      for (const c of core)
        for (const l of side)
          for (const r of side) {
            ev += c.p * l.p * r.p * c.value * l.value * r.value;
            mass += c.p * l.p * r.p;
            n++;
          }
      expect(n).toBe(125);
      expect(mass).toBeCloseTo(1, 13);
      expect(Math.abs(ev - RTP)).toBeLessThan(1e-12);
      expect(Math.abs(rtpOf(d) - RTP)).toBeLessThan(1e-12);
      expect(distribution(d).reduce((a, o) => a + o.p, 0)).toBeCloseTo(1, 13);
    }
  });

  it('published chances: any return and profit', () => {
    const any = [0.81, 0.6561, 0.5476, 0.2809];
    const profit = [0.24, 0.1936, 0.1329, 0.0863];
    DIFFICULTIES.forEach((d, i) => {
      expect(returnChance(d)).toBeCloseTo(any[i], 10);
      expect(profitChance(d)).toBeCloseTo(profit[i], 3);
      expect(chancesGiven(d, []).profit).toBeCloseTo(profitChance(d), 12);
      expect(chancesGiven(d, []).zero).toBeCloseTo(1 - returnChance(d), 12);
    });
  });

  it('max wins are 20x, 160x, 1176x, 5000x', () => {
    expect(DIFFICULTIES.map(topPrize)).toEqual([20, 160, 1176, 5000]);
    expect(MAX_MULTIPLIER).toBe(5000);
    expect(manifest.maxMultiplier).toBe(5000);
    for (const d of DIFFICULTIES) {
      const dist = distribution(d);
      expect(dist[dist.length - 1].multiplier).toBe(topPrize(d));
    }
  });

  it('the draw honours every face chance (simulation, 4 SE)', () => {
    const rng = createRng(seededSource(11));
    const n = 200_000;
    for (const d of DIFFICULTIES)
      for (const t of [TABLES[d].core, TABLES[d].side]) {
        const counts = new Array(t.length).fill(0);
        for (let i = 0; i < n; i++) counts[drawIndex(t, rng.next())]++;
        t.forEach((c, i) => expect(Math.abs(counts[i] / n - c.p)).toBeLessThan(4 * Math.sqrt((c.p * (1 - c.p)) / n)));
      }
  });

  it('a round takes exactly three uniforms, core then left then right, and pays the product', () => {
    const us = [0.99, 0.05, 0.5];
    let k = 0;
    const r = playRound(() => us[k++], 'medium');
    expect(k).toBe(3);
    expect(r.values).toEqual([10, 0, 0.3]);
    expect(r.multiplier).toBe(0);
    const rng = createRng(seededSource(5));
    let calls = 0;
    for (let i = 0; i < 500; i++) {
      const before = calls;
      const x = playRound(() => (calls++, rng.next()), 'hard');
      expect(calls - before).toBe(3);
      expect(x.multiplier).toBe(productOf(x.values));
    }
    expect(productOf([5, 1.1, 1.1])).toBe(6.05);
  });

  it('the simulated payout matches the exact profit chance and RTP (4 SE)', () => {
    const rng = createRng(seededSource(23));
    const n = 200_000;
    for (const d of DIFFICULTIES) {
      let sum = 0;
      let wins = 0;
      for (let i = 0; i < n; i++) {
        const m = playRound(rng.next, d).multiplier;
        sum += m;
        if (m > 1) wins++;
      }
      const p = profitChance(d);
      expect(Math.abs(wins / n - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / n));
      expect(Math.abs(sum / n - RTP)).toBeLessThan(4 * (stdDevOf(d) / Math.sqrt(n)));
    }
  });

  it('difficulty raises volatility and lowers the hit rate, never the return', () => {
    const sds = DIFFICULTIES.map(stdDevOf);
    for (let i = 1; i < 4; i++) {
      expect(sds[i]).toBeGreaterThan(sds[i - 1]);
      expect(profitChance(DIFFICULTIES[i])).toBeLessThan(profitChance(DIFFICULTIES[i - 1]));
    }
    expect(sds[3] / sds[0]).toBeGreaterThan(5);
  });

  it('simulated RTP matches the manifest on every config', () => {
    for (const r of runEval(evalSpec, { rounds: 60_000 })) {
      expect(Math.abs(r.rtp - (r.targetRtp ?? manifest.rtp))).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
