import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  CASES,
  DIFFICULTIES,
  MAX_MULTIPLIER,
  REEL_LENGTH,
  RTP,
  WEIGHT_TOTAL,
  WIN_SLOT,
  itemIndex,
  playRound,
  profitChance,
  reelFor,
  rtpOf,
  stdDev,
  topItem,
  weightedCents,
} from './math';

describe('Cases paytables', () => {
  it('every table returns exactly 98% (integer arithmetic)', () => {
    for (const d of DIFFICULTIES) {
      const items = CASES[d];
      expect(items.reduce((s, it) => s + it.weight, 0)).toBe(WEIGHT_TOTAL);
      expect(items.every((it) => Number.isInteger(it.weight) && it.weight > 0 && Number.isInteger(it.cents))).toBe(true);
      expect(weightedCents(d)).toBe(98 * WEIGHT_TOTAL);
      expect(rtpOf(d)).toBeCloseTo(RTP, 14);
    }
    expect(manifest.rtp).toBe(RTP);
  });

  it('matches the published Stake tables: 7 / 11 / 15 / 19 items, P(profit) 24 / 25 / 18 / 14.61%', () => {
    expect(DIFFICULTIES.map((d) => CASES[d].length)).toEqual([7, 11, 15, 19]);
    expect(DIFFICULTIES.map((d) => Math.round(profitChance(d) * 1e6) / 1e4)).toEqual([24, 25, 18, 14.61]);
    expect(CASES.easy.map((i) => i.mult)).toEqual([0.1, 0.4, 1.09, 2, 3, 10, 23]);
    expect(CASES.expert.at(-1)).toMatchObject({ mult: 10000, weight: 2 });
    expect(topItem('hard').mult).toBe(1000);
  });

  it('the exact RTP by enumeration of items is 98% for every difficulty', () => {
    for (const d of DIFFICULTIES) expect(CASES[d].reduce((s, it) => s + it.p * it.mult, 0)).toBeCloseTo(RTP, 12);
  });

  it('is shaped like a case: payouts rise, bigger prizes are rarer, harder cases are riskier', () => {
    for (const d of DIFFICULTIES) {
      const items = CASES[d];
      for (let i = 1; i < items.length; i++) expect(items[i].cents).toBeGreaterThan(items[i - 1].cents);
      // From the first winning item up, each prize is rarer than the one below.
      const first = items.findIndex((it) => it.cents > 100);
      for (let i = first + 1; i < items.length; i++) expect(items[i].weight).toBeLessThan(items[i - 1].weight);
    }
    for (let k = 1; k < DIFFICULTIES.length; k++) {
      const [a, b] = [DIFFICULTIES[k - 1], DIFFICULTIES[k]];
      expect(topItem(b).mult).toBeGreaterThan(topItem(a).mult);
      expect(stdDev(b)).toBeGreaterThan(stdDev(a));
      // Stake's Medium has a slightly higher profit chance (25%) than Easy (24%): only the volatility is monotone.
      if (k > 1) expect(profitChance(b)).toBeLessThan(profitChance(a));
    }
    // Volatility spread across the knobs is well over 5x.
    expect(stdDev('expert') / stdDev('easy')).toBeGreaterThan(5);
  });

  it('the chances shown are the true odds: the u → item map covers exactly w_i of the 1,000,000 slots', () => {
    for (const d of DIFFICULTIES) {
      const counts = new Array(CASES[d].length).fill(0);
      for (let k = 0; k < WEIGHT_TOTAL; k++) counts[itemIndex((k + 0.5) / WEIGHT_TOTAL, d)]++;
      expect(counts).toEqual(CASES[d].map((it) => it.weight));
      // Boundaries: u = 0 is the first item, u just below 1 the last.
      expect(itemIndex(0, d)).toBe(0);
      expect(itemIndex(1 - 1e-12, d)).toBe(CASES[d].length - 1);
    }
  });

  it('simulated item frequencies and RTP match the exact values (4 SE)', () => {
    const rng = createRng(seededSource(11));
    const n = 200_000;
    for (const d of DIFFICULTIES) {
      const counts = new Array(CASES[d].length).fill(0);
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const r = playRound(() => rng.next(), d);
        counts[r.index]++;
        sum += r.multiplier;
      }
      CASES[d].forEach((it, i) => expect(Math.abs(counts[i] / n - it.p)).toBeLessThan(4 * Math.sqrt((it.p * (1 - it.p)) / n) + 1e-9));
      expect(Math.abs(sum / n - RTP)).toBeLessThan(4 * (stdDev(d) / Math.sqrt(n)));
    }
  });

  it('one bet resolves once, with exactly one RNG draw', () => {
    let draws = 0;
    const rng = createRng(seededSource(6));
    const r = playRound(() => (draws++, rng.next()), 'medium');
    expect(draws).toBe(1);
    expect(r.multiplier).toBe(CASES.medium[r.index].mult);
  });

  it('the reel is decoration: the won item sits under the marker and the strip is deterministic', () => {
    for (const d of DIFFICULTIES)
      for (let i = 0; i < CASES[d].length; i++) {
        const a = reelFor(d, i, 0.123 + i / 100);
        const b = reelFor(d, i, 0.123 + i / 100);
        expect(a).toEqual(b);
        expect(a.strip).toHaveLength(REEL_LENGTH);
        expect(a.strip[WIN_SLOT]).toBe(i);
        expect(Math.abs(a.jitter)).toBeLessThan(0.4);
      }
  });

  it('the max multiplier is honest', () => {
    expect(MAX_MULTIPLIER).toBe(10_000);
    expect(manifest.maxMultiplier).toBe(Math.max(...DIFFICULTIES.flatMap((d) => CASES[d].map((it) => it.mult))));
    for (const d of DIFFICULTIES) for (const it of CASES[d]) expect(it.mult).toBeLessThanOrEqual(MAX_MULTIPLIER);
  });

  it('simulated RTP matches the manifest in every eval config', () => {
    for (const r of runEval(evalSpec, { rounds: 60_000 })) {
      expect(Math.abs(r.rtp - (r.targetRtp ?? manifest.rtp))).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
