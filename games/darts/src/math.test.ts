import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  BOARD_R,
  CELLS,
  DIFFICULTIES,
  MAX_MULTIPLIER,
  RTP,
  TABLES,
  TOTAL_UNITS,
  ZONES,
  bounds,
  cellPattern,
  payout,
  rtpOf,
  throwDart,
  throwFrom,
  unitsOf,
  weightedCents,
  winChance,
  zoneAt,
  zoneChance,
  type Zone,
} from './math';

// The published tables: multipliers dark, light, low, mid, high, bull; chance in units out of 120,000.
const PUBLISHED = {
  easy: { mult: [0.5, 0.8, 1.2, 1.5, 2.7, 8.5], units: [57171, 31182, 14886, 8270, 6616, 1875] },
  medium: { mult: [0.4, 0.6, 1.3, 3.1, 6, 16], units: [66198, 34620, 8991, 4995, 3996, 1200] },
  hard: { mult: [0.2, 0.5, 2.5, 3.6, 8.8, 63], units: [71225, 33133, 7605, 5070, 2535, 432] },
  expert: { mult: [0.1, 0.5, 4.8, 9.6, 42, 500], units: [82665, 30267, 4680, 1560, 780, 48] },
} as const;

describe('Darts maths', () => {
  it('multipliers and zone units match the published tables value for value', () => {
    for (const d of DIFFICULTIES) {
      ZONES.forEach((z, i) => {
        expect(payout(d, z)).toBe(PUBLISHED[d].mult[i]);
        expect(unitsOf(d)[z]).toBe(PUBLISHED[d].units[i]);
      });
    }
  });

  it('every table sums to 120,000 units and returns exactly 98% (integer sums)', () => {
    for (const d of DIFFICULTIES) {
      const u = unitsOf(d);
      expect(ZONES.reduce((s, z) => s + u[z], 0)).toBe(TOTAL_UNITS);
      expect(weightedCents(d)).toBe(11_760_000);
      expect(rtpOf(d)).toBe(RTP);
      expect(TABLES[d].cells.reduce((a, b) => a + b, 0)).toBe(CELLS);
      for (const z of ZONES) expect(Number.isInteger(TABLES[d].cents[z])).toBe(true);
    }
  });

  it('every throw returns something: the smallest payout is 0.1×', () => {
    for (const d of DIFFICULTIES) for (const z of ZONES) expect(payout(d, z)).toBeGreaterThanOrEqual(0.1);
  });

  it('profit chance and the bullseye chance match the published figures', () => {
    expect(winChance('easy')).toBeCloseTo(0.263725, 9);
    expect(winChance('medium')).toBeCloseTo(0.15985, 9);
    expect(winChance('hard')).toBeCloseTo(0.13035, 9);
    expect(winChance('expert')).toBeCloseTo(0.0589, 9);
    expect(zoneChance('easy', 'bull')).toBeCloseTo(1 / 64, 12);
    expect(zoneChance('medium', 'bull')).toBeCloseTo(0.01, 12);
    expect(zoneChance('hard', 'bull')).toBeCloseTo(0.0036, 12);
    expect(zoneChance('expert', 'bull')).toBeCloseTo(0.0004, 12);
  });

  it('cell patterns have the right counts and each cell holds equal area', () => {
    for (const d of DIFFICULTIES) {
      const p = cellPattern(d);
      expect(p.length).toBe(CELLS);
      const [nl, nm, nh] = TABLES[d].cells;
      expect([p.filter((t) => t === 'low').length, p.filter((t) => t === 'mid').length, p.filter((t) => t === 'high').length]).toEqual([nl, nm, nh]);
      const { b0, b1 } = bounds(d);
      expect(b1 - b0).toBe(CELLS * TABLES[d].cell);
    }
  });

  it('zoneAt matches the tables at every boundary (a boundary belongs to the outer zone)', () => {
    for (const d of DIFFICULTIES) {
      const { b0, b1, b2 } = bounds(d);
      const p = cellPattern(d);
      expect(zoneAt(d, 0, 0)).toBe('bull');
      expect(zoneAt(d, b0 - 1, 3)).toBe('bull');
      expect(zoneAt(d, b0, 3)).toBe(p[3]);
      expect(zoneAt(d, b1 - 1, 7)).toBe(p[7]);
      expect(zoneAt(d, b1, 7)).toBe('light');
      expect(zoneAt(d, b2 - 1, 7)).toBe('light');
      expect(zoneAt(d, b2, 7)).toBe('dark');
      expect(zoneAt(d, TOTAL_UNITS - 1, 17)).toBe('dark');
    }
  });

  it('exact enumeration over every (s, cell) gives each zone its units and the RTP', () => {
    for (const d of DIFFICULTIES) {
      const count = Object.fromEntries(ZONES.map((z) => [z, 0])) as Record<Zone, number>;
      for (let s = 0; s < TOTAL_UNITS; s++) for (let c = 0; c < CELLS; c++) count[zoneAt(d, s, c)]++;
      for (const z of ZONES) expect(count[z]).toBe(unitsOf(d)[z] * CELLS);
    }
  });

  it('the drawn point is in the paid zone, uses two draws, and lands uniformly', () => {
    const rng = createRng(seededSource(23));
    const n = 200_000;
    let calls = 0;
    let right = 0;
    let bad = 0;
    for (let i = 0; i < n; i++) {
      const t = throwDart(() => (calls++, rng.next()), 'medium');
      const r = Math.hypot(t.x, t.y);
      const s = Math.floor((r / BOARD_R) ** 2 * TOTAL_UNITS + 1e-6);
      const ang = (Math.atan2(t.y, t.x) + 2 * Math.PI) % (2 * Math.PI);
      const cell = Math.min(CELLS - 1, Math.floor((ang / (2 * Math.PI)) * CELLS));
      if (zoneAt('medium', Math.min(s, TOTAL_UNITS - 1), cell) !== t.zone && Math.abs(r - BOARD_R * Math.sqrt(t.s / TOTAL_UNITS)) > 0.5) bad++;
      if (t.x > 0) right++;
    }
    expect(calls).toBe(2 * n);
    expect(bad).toBe(0);
    expect(Math.abs(right / n - 0.5)).toBeLessThan(4 * Math.sqrt(0.25 / n));
    expect(throwFrom(0.9999999, 0.9999999, 'easy').cell).toBe(17);
  });

  it('simulated return per difficulty is within 4 SE of 98%', () => {
    const rng = createRng(seededSource(7));
    const n = 200_000;
    for (const d of DIFFICULTIES) {
      let s = 0;
      let s2 = 0;
      for (let i = 0; i < n; i++) {
        const m = throwDart(() => rng.next(), d).multiplier;
        s += m;
        s2 += m * m;
      }
      const mean = s / n;
      const se = Math.sqrt((s2 / n - mean * mean) / n);
      expect(Math.abs(mean - RTP)).toBeLessThan(4 * se);
    }
  });

  it('the max multiplier is honest', () => {
    expect(MAX_MULTIPLIER).toBe(500);
    expect(manifest.maxMultiplier).toBe(500);
    expect(throwFrom(0, 0, 'expert').multiplier).toBe(500);
    expect(manifest.status).toBe('live');
    expect(manifest.id).toBe('darts');
  });

  it('the eval matches the manifest RTP, respects the max and spreads volatility', () => {
    const reports = runEval(evalSpec, { rounds: 100_000 });
    for (const r of reports) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
    expect(reports[3].stdDev).toBeGreaterThan(5 * reports[0].stdDev);
  });
});
