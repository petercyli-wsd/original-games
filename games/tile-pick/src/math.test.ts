import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  DIFFICULTIES,
  MAX_MULTIPLIER,
  PICK_COUNTS,
  RTP,
  TABLE,
  TILE_COUNT,
  WEIGHT_TOTAL,
  itemIndex,
  lossChance,
  playRound,
  profitChance,
  randomPicks,
  roundDistribution,
  roundRtp,
  rtpOf,
  stdDev,
  tileValue,
  topItem,
  weightedCents,
} from './math';

const PUBLISHED: Record<string, [number, number][]> = {
  easy: [[40, 156500], [80, 425500], [100, 250000], [150, 100000], [200, 50000], [400, 15000], [900, 3000]],
  medium: [[30, 406750], [70, 264250], [120, 200000], [200, 90000], [500, 30000], [1000, 8000], [3300, 1000]],
  hard: [[10, 52475], [50, 761305], [150, 120000], [400, 50000], [1000, 15000], [5000, 1200], [70500, 20]],
  expert: [[0, 277844], [50, 574000], [200, 120000], [1000, 25000], [5000, 3000], [30000, 150], [300000, 6]],
};

describe('Tile Pick tables', () => {
  it('match the spec value for value and every table returns exactly 99% (integers)', () => {
    for (const d of DIFFICULTIES) {
      expect(TABLE[d].map((it) => [it.cents, it.weight])).toEqual(PUBLISHED[d]);
      expect(TABLE[d].reduce((s, it) => s + it.weight, 0)).toBe(WEIGHT_TOTAL);
      expect(weightedCents(d)).toBe(99 * WEIGHT_TOTAL);
      expect(rtpOf(d)).toBeCloseTo(RTP, 14);
    }
    expect(manifest.rtp).toBe(RTP);
  });

  it('every difficulty and pick count returns exactly 99% by enumeration of all 7^n tuples', () => {
    for (const d of DIFFICULTIES)
      for (const n of PICK_COUNTS) {
        const dist = roundDistribution(d, n);
        expect([...dist.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
        expect(roundRtp(d, n)).toBeCloseTo(RTP, 12);
        // Integer check: Σ P(sum)·sum = 99·n·100 / ... compare in cents.
        let ev = 0;
        for (const [s, p] of dist) ev += p * s;
        expect(ev / (100 * n)).toBeCloseTo(RTP, 12);
      }
  });

  it('profit chances match the spec figures', () => {
    const want: Record<string, number[]> = {
      easy: [16.8, 27.7, 35.0, 35.4, 34.4],
      medium: [32.9, 28.1, 27.6, 29.7, 28.8],
      hard: [18.6, 14.3, 22.3, 24.6, 30.2],
      expert: [14.8, 20.8, 12.1, 17.0, 17.4],
    };
    for (const d of DIFFICULTIES) PICK_COUNTS.forEach((n, i) => expect(profitChance(d, n) * 100).toBeCloseTo(want[d][i], 0));
    for (const d of DIFFICULTIES) for (const n of PICK_COUNTS) expect(lossChance(d, n) + profitChance(d, n)).toBeLessThanOrEqual(1 + 1e-12);
  });

  it('volatility rises with difficulty and falls with picks (spread well over 5x)', () => {
    for (let k = 1; k < DIFFICULTIES.length; k++) expect(stdDev(DIFFICULTIES[k], 1)).toBeGreaterThan(stdDev(DIFFICULTIES[k - 1], 1));
    expect(stdDev('expert', 1) / stdDev('easy', 5)).toBeGreaterThan(5);
    for (const d of DIFFICULTIES) expect(stdDev(d, 4)).toBeCloseTo(stdDev(d, 1) / 2, 12);
  });

  it('the chances shown are the true odds: u maps to exactly w_i of the 1,000,000 slots', () => {
    for (const d of DIFFICULTIES) {
      const counts = new Array(TABLE[d].length).fill(0);
      for (let k = 0; k < WEIGHT_TOTAL; k += 1) counts[itemIndex((k + 0.5) / WEIGHT_TOTAL, d)]++;
      expect(counts).toEqual(TABLE[d].map((it) => it.weight));
      expect(itemIndex(0, d)).toBe(0);
      expect(itemIndex(1 - 1e-12, d)).toBe(TABLE[d].length - 1);
    }
  });

  it('one bet draws 30 tiles, pays the average of the picks, and tile labels sum to the payout', () => {
    for (const n of PICK_COUNTS) {
      let draws = 0;
      const rng = createRng(seededSource(5 + n));
      const picks = randomPicks((k) => rng.int(k), n);
      expect(new Set(picks).size).toBe(n);
      const r = playRound(() => (draws++, rng.next()), 'medium', picks);
      expect(draws).toBe(TILE_COUNT);
      expect(r.tiles).toHaveLength(TILE_COUNT);
      const sum = picks.reduce((s, t) => s + tileValue('medium', r.tiles[t], n), 0);
      expect(r.multiplier).toBeCloseTo(sum, 12);
    }
  });

  it('simulated tile frequencies and RTP match (4 SE)', () => {
    const rng = createRng(seededSource(11));
    const rounds = 20_000;
    for (const d of DIFFICULTIES) {
      const counts = new Array(TABLE[d].length).fill(0);
      let sum = 0;
      for (let i = 0; i < rounds; i++) {
        const r = playRound(() => rng.next(), d, [0]);
        for (const it of r.tiles) counts[it]++;
        sum += r.multiplier;
      }
      const N = rounds * TILE_COUNT;
      TABLE[d].forEach((it, i) => expect(Math.abs(counts[i] / N - it.p)).toBeLessThan(4 * Math.sqrt((it.p * (1 - it.p)) / N) + 1e-9));
      expect(Math.abs(sum / rounds - RTP)).toBeLessThan(4 * (stdDev(d, 1) / Math.sqrt(rounds)));
    }
  });

  it('the max multiplier is honest', () => {
    expect(MAX_MULTIPLIER).toBe(3000);
    expect(manifest.maxMultiplier).toBe(topItem('expert').mult);
    for (const d of DIFFICULTIES) for (const n of PICK_COUNTS) for (const s of roundDistribution(d, n).keys()) expect(s / (100 * n)).toBeLessThanOrEqual(MAX_MULTIPLIER);
  });

  it('simulated RTP matches the manifest in every eval config', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - (r.targetRtp ?? manifest.rtp))).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
