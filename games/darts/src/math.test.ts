import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  AREA_UNITS,
  BOARD_R,
  DIFFICULTIES,
  INNER_R,
  MAX_MULTIPLIER,
  OUTER_R,
  PAY_CENTS,
  RTP,
  TOTAL_UNITS,
  ZONES,
  payout,
  returnChance,
  rtpOf,
  tiersFor,
  throwDart,
  throwFrom,
  topPrize,
  weightedCents,
  winChance,
  zoneAt,
  zoneChance,
  type Zone,
} from './math';

const within4se = (hits: number, n: number, p: number) => Math.abs(hits / n - p) < 4 * Math.sqrt((p * (1 - p)) / n);

describe('Darts maths', () => {
  it('each zone chance is its exact share of the board area', () => {
    let sum = 0;
    for (const z of ZONES) {
      const area = Math.PI * (OUTER_R[z] ** 2 - INNER_R[z] ** 2);
      expect(zoneChance(z)).toBeCloseTo(area / (Math.PI * BOARD_R ** 2), 14);
      sum += AREA_UNITS[z];
    }
    expect(sum).toBe(TOTAL_UNITS);
    expect(AREA_UNITS).toEqual({ bullseye: 25, bull: 75, inner: 1925, triple: 475, outer: 3900, double: 825, miss: 2775 });
    // Rings tile the disc with no gaps.
    for (let i = 1; i < ZONES.length; i++) expect(INNER_R[ZONES[i]]).toBe(OUTER_R[ZONES[i - 1]]);
  });

  it('every difficulty returns exactly 99% (integer sum over the table)', () => {
    for (const d of DIFFICULTIES) {
      expect(weightedCents(d)).toBe(990_000); // 0.99 × 10,000 area units × 100 cents
      expect(rtpOf(d)).toBe(RTP);
      for (const z of ZONES) expect(Number.isInteger(PAY_CENTS[d][z])).toBe(true);
    }
  });

  it('paytables are monotone: closer to the centre and the scoring bands pay more, harder pays more for the bull', () => {
    const rank: Zone[] = ['bullseye', 'bull', 'triple', 'double', 'inner', 'outer', 'miss'];
    for (const d of DIFFICULTIES) {
      for (let i = 1; i < rank.length; i++) expect(payout(d, rank[i - 1])).toBeGreaterThanOrEqual(payout(d, rank[i]));
      expect(payout(d, 'miss')).toBe(0);
    }
    for (let i = 1; i < DIFFICULTIES.length; i++) {
      expect(payout(DIFFICULTIES[i], 'bullseye')).toBeGreaterThan(payout(DIFFICULTIES[i - 1], 'bullseye'));
      expect(winChance(DIFFICULTIES[i])).toBeLessThan(winChance(DIFFICULTIES[i - 1]));
    }
    expect(winChance('easy')).toBeCloseTo(0.7225, 12);
    expect(winChance('expert')).toBeCloseTo(0.0575, 12);
    expect(returnChance('medium')).toBeCloseTo(0.7225, 12);
  });

  it('a geometric simulation of a uniform point on the disc hits each ring with its area share', () => {
    // Independent of the game's sampler: rejection-sample the square, classify by radius.
    const rng = createRng(seededSource(11));
    const counts = Object.fromEntries(ZONES.map((z) => [z, 0])) as Record<Zone, number>;
    let n = 0;
    while (n < 300_000) {
      const x = (rng.next() * 2 - 1) * BOARD_R;
      const y = (rng.next() * 2 - 1) * BOARD_R;
      if (x * x + y * y >= BOARD_R * BOARD_R) continue;
      counts[zoneAt(Math.hypot(x, y))]++;
      n++;
    }
    for (const z of ZONES) expect(within4se(counts[z], n, zoneChance(z))).toBe(true);
  });

  it("the game's sampler lands uniformly: the drawn point is in the paid zone, zone and quadrant frequencies match", () => {
    const rng = createRng(seededSource(23));
    const n = 300_000;
    const counts = Object.fromEntries(ZONES.map((z) => [z, 0])) as Record<Zone, number>;
    let rightHalf = 0;
    let bad = 0;
    for (let i = 0; i < n; i++) {
      const t = throwDart(() => rng.next(), 'medium');
      // The drawn point is the paid point: on the board, and its distance from the centre is in the paid ring.
      if (!(t.r < BOARD_R) || Math.abs(Math.hypot(t.x, t.y) - t.r) > 1e-9 || zoneAt(t.r) !== t.zone) bad++;
      counts[t.zone]++;
      if (t.x > 0) rightHalf++;
    }
    expect(bad).toBe(0);
    for (const z of ZONES) expect(within4se(counts[z], n, zoneChance(z))).toBe(true);
    expect(within4se(rightHalf, n, 0.5)).toBe(true);
  });

  it('sweeping the radius: every drawn ring boundary is where the paid zone changes (ties go outwards)', () => {
    for (const z of ZONES) {
      expect(throwFrom(INNER_R[z] ** 2 / TOTAL_UNITS, 0, 'easy').zone).toBe(z);
      expect(throwFrom((OUTER_R[z] ** 2 - 1e-6) / TOTAL_UNITS, 0.3, 'easy').zone).toBe(z);
    }
    for (let r = 0; r < BOARD_R; r += 0.25) {
      const z = zoneAt(r);
      expect(r).toBeGreaterThanOrEqual(INNER_R[z]);
      expect(r).toBeLessThan(OUTER_R[z]);
    }
  });

  it('simulated return per difficulty is within 4 SE of 99%', () => {
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

  it('an auto bet resolves once per round: one throw, two RNG draws, one payout', () => {
    let calls = 0;
    const src = seededSource(5);
    const counted = () => {
      calls++;
      return src();
    };
    for (let i = 0; i < 100; i++) {
      const t = throwDart(counted, 'hard');
      expect(t.multiplier).toBe(payout('hard', t.zone));
    }
    expect(calls).toBe(200);
  });

  it('ring colours rank the paying zones, so every zone keeps its colour until it stops paying', () => {
    expect(tiersFor('easy')).toEqual({ bullseye: 'top', bull: 'second', inner: 'fifth', triple: 'third', outer: 'sixth', double: 'fourth', miss: 'zero' });
    expect(tiersFor('medium').outer).toBe('part');
    expect(tiersFor('expert')).toEqual({ bullseye: 'top', bull: 'second', inner: 'zero', triple: 'third', outer: 'zero', double: 'zero', miss: 'zero' });
  });

  it('the max multiplier is honest', () => {
    expect(MAX_MULTIPLIER).toBe(200);
    expect(manifest.maxMultiplier).toBe(MAX_MULTIPLIER);
    expect(Math.max(...DIFFICULTIES.map(topPrize))).toBe(200);
    expect(throwFrom(0, 0, 'expert').multiplier).toBe(200);
    expect(manifest.collection).toBe('classics');
    expect(manifest.status).toBe('live');
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
