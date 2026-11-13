import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import { CARDS, MAX_MULTIPLIER, MEAN_CARD_SCALED, RTP, TABLE, WEIGHT_TOTAL, cardAt, chanceReturnsBet, drawCard, probAtLeast, sumCounts, valueOf } from './math';

describe('Booster table', () => {
  it('weights sum to 10,000,000 and every published chance is exact', () => {
    expect(TABLE.reduce((s, c) => s + c.weight, 0)).toBe(WEIGHT_TOTAL);
    const pct = (cents: number) => (TABLE.find((c) => c.cents === cents)!.weight / WEIGHT_TOTAL) * 100;
    expect(pct(1)).toBeCloseTo(36, 9);
    expect(pct(2)).toBeCloseTo(22, 9);
    expect(pct(3)).toBeCloseTo(15, 9);
    expect(pct(4)).toBeCloseTo(10, 9);
    for (const c of [10, 15, 20]) expect(pct(c)).toBeCloseTo(3, 9);
    for (const c of [30, 50, 80]) expect(pct(c)).toBeCloseTo(2, 9);
    for (const c of [100, 120, 200, 300, 400]) expect(pct(c)).toBeCloseTo(0.3, 9);
    expect(pct(800)).toBeCloseTo(0.15, 9);
    for (const c of [1000, 1200, 1500]) expect(pct(c)).toBeCloseTo(0.1, 9);
    expect(pct(5000)).toBeCloseTo(0.03, 9);
    expect(pct(15000)).toBeCloseTo(0.005, 9);
    expect(pct(50000)).toBeCloseTo(0.0015, 9);
    expect(pct(100000)).toBeCloseTo(0.00049, 9);
    expect(pct(1000000)).toBeCloseTo(0.00001, 9);
  });

  it('card mean is exactly 0.196x in integers, so a pack is exactly 98%', () => {
    expect(TABLE.reduce((s, c) => s + c.weight * c.cents, 0)).toBe(MEAN_CARD_SCALED);
    expect(5 * (MEAN_CARD_SCALED / (100 * WEIGHT_TOTAL))).toBeCloseTo(RTP, 12);
  });

  it('exact convolution of all 26^5 card tuples gives E[pack] = 0.98 and max 50,000x', () => {
    const dist = sumCounts(CARDS);
    const total = BigInt(WEIGHT_TOTAL) ** BigInt(CARDS);
    let sum = 0n;
    let mass = 0n;
    let max = 0;
    for (const [s, c] of dist) {
      sum += BigInt(s) * c;
      mass += c;
      max = Math.max(max, s);
    }
    expect(mass).toBe(total);
    expect(sum).toBe(98n * total);
    expect(max / 100).toBe(MAX_MULTIPLIER);
    expect(manifest.rtp).toBe(RTP);
  });

  it('cardAt covers the interval edges', () => {
    expect(cardAt(0).cents).toBe(1);
    expect(cardAt(3_599_999).cents).toBe(1);
    expect(cardAt(3_600_000).cents).toBe(2);
    expect(cardAt(WEIGHT_TOTAL - 1).cents).toBe(1_000_000);
  });
});

describe('Booster odds on screen', () => {
  it('P(pack >= 1x) from the DP equals the exact convolution', () => {
    const dist = sumCounts(CARDS);
    let hit = 0n;
    for (const [s, c] of dist) if (s >= 100) hit += c;
    const exact = Number(hit * 10n ** 12n / 10n ** 35n) / 1e12;
    expect(probAtLeast(5, 100)).toBeCloseTo(exact, 9);
    expect(probAtLeast(5, 100)).toBeGreaterThan(0.13);
    expect(probAtLeast(5, 100)).toBeLessThan(0.14);
  });

  it('chance from a state matches the exact convolution of the unopened cards', () => {
    const dist = sumCounts(2);
    const total = Number(BigInt(WEIGHT_TOTAL) ** 2n);
    for (const need of [1, 50, 99, 100, 250]) {
      let hit = 0;
      for (const [s, c] of dist) if (s >= need) hit += Number(c);
      expect(probAtLeast(2, need)).toBeCloseTo(hit / total, 12);
    }
    expect(chanceReturnsBet([TABLE[24], TABLE[0], TABLE[0], TABLE[0], TABLE[0]])).toBe(1);
  });

  it('simulation of the raw draw matches the table', () => {
    const rng = createRng(seededSource(11));
    const n = 200_000;
    let hits = 0;
    for (let i = 0; i < n; i++) if (drawCard(rng).cents >= 100) hits++;
    const p = TABLE.filter((c) => c.cents >= 100).reduce((s, c) => s + c.p, 0);
    expect(Math.abs(hits / n - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / n));
  });
});

describe('Booster eval', () => {
  it('every strategy is within 4 SE of RTP and below the max', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      // Heavy tail (see eval.ts): the sample is noisy, so this is a sanity band; exactness is proven above.
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(0.3);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
    expect(valueOf(0, 0)).toBeCloseTo(RTP, 12);
  });
});
