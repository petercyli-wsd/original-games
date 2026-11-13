import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  DIFFICULTIES,
  DIFFICULTY,
  MAX_MULTIPLIER,
  RTP,
  SLOTS,
  afterSafe,
  buildRoad,
  choose,
  cross,
  finish,
  finishChance,
  hazardChance,
  lanesOf,
  multiplier,
  reachChance,
  type Difficulty,
} from './math';

const rng = createRng(seededSource(41));
const int = (n: number) => rng.int(n);

/** Exact value of the stopping rule "cash out when stopAt(k)" by backward induction over k. */
function strategyValue(d: Difficulty, stopAt: (k: number) => boolean): number {
  const value = (k: number): number => {
    if (k === lanesOf(d) || (k > 0 && stopAt(k))) return multiplier(d, k);
    return (1 - hazardChance(d, k)) * value(k + 1);
  };
  return value(0);
}

describe('Chicken maths (Stake road: 20 slots, 98%)', () => {
  it('matches the published Stake table: lanes, first lane, top prize, chance to finish', () => {
    const table: Record<Difficulty, [number, number, number, number]> = {
      easy: [19, 1.03, 19.6, 20],
      medium: [17, 1.15, 1117.2, 1140],
      hard: [15, 1.31, 15193.92, 15504],
      expert: [10, 1.96, 181060.88, 184756],
    };
    for (const d of DIFFICULTIES) {
      const [lanes, first, top, oneIn] = table[d];
      expect(lanesOf(d)).toBe(lanes);
      expect(multiplier(d, 1)).toBeCloseTo(first, 2);
      expect(finish(d)).toBeCloseTo(top, 2);
      expect(finishChance(d, 0)).toBeCloseTo(1 / oneIn, 12);
      expect(reachChance(d, lanes)).toBeCloseTo(1 / oneIn, 12);
    }
    expect(RTP).toBe(0.98);
    expect(multiplier('medium', 4)).toBeCloseTo(2, 2); // 2.00x shown: Medium takes 4 lanes to reach 2x
    expect(multiplier('medium', 3)).toBeLessThan(2);
    expect(MAX_MULTIPLIER).toBeCloseTo(181060.88, 2);
  });

  it('every payout table is exactly RTP: M(k) * C(20 - k, m) / C(20, m) = 0.98 for every k (subset counting)', () => {
    for (const d of DIFFICULTIES) {
      const m = DIFFICULTY[d].hazards;
      for (let k = 0; k <= lanesOf(d); k++) {
        // Subsets of m hazards with none in slots 1..k: C(20 - k, m) of C(20, m).
        const p = choose(SLOTS - k, m) / choose(SLOTS, m);
        expect(p * multiplier(d, k)).toBeCloseTo(RTP, 10);
        expect(reachChance(d, k)).toBeCloseTo(p, 12);
        expect(multiplier(d, k)).toBeCloseTo((RTP * choose(SLOTS, k)) / choose(SLOTS - m, k), 6 - Math.floor(Math.log10(multiplier(d, k) + 1)));
      }
    }
  });

  it('exact enumeration of buildRoad: every hazard subset is equally likely (Easy, Medium)', () => {
    for (const d of ['easy', 'medium'] as Difficulty[]) {
      const m = DIFFICULTY[d].hazards;
      const counts = new Map<string, number>();
      const walk = (draws: number[]) => {
        if (draws.length === m) {
          let i = 0;
          const road = buildRoad(d, () => draws[i++]);
          expect(road.filter(Boolean).length).toBe(m);
          const key = road.map((x) => (x ? 1 : 0)).join('');
          counts.set(key, (counts.get(key) ?? 0) + 1);
          return;
        }
        for (let u = 0; u < SLOTS - draws.length; u++) walk([...draws, u]);
      };
      walk([]);
      expect(counts.size).toBe(choose(SLOTS, m));
      expect(new Set(counts.values()).size).toBe(1);
    }
  });

  it('every stopping rule returns exactly RTP (analytic, backward induction)', () => {
    for (const d of DIFFICULTIES) {
      expect(strategyValue(d, () => false)).toBeCloseTo(RTP, 10);
      for (let t = 1; t <= lanesOf(d); t++) expect(strategyValue(d, (k) => k >= t)).toBeCloseTo(RTP, 10);
      for (const target of [1.5, 3, 10, 100, 5000]) expect(strategyValue(d, (k) => multiplier(d, k) >= target)).toBeCloseTo(RTP, 10);
      for (let trial = 0; trial < 40; trial++) {
        const stops = Array.from({ length: lanesOf(d) + 1 }, () => rng.next() < 0.2);
        expect(strategyValue(d, (k) => stops[k])).toBeCloseTo(RTP, 10);
      }
    }
  });

  it('each lane is a fair bet: E[cash-out after] = cash-out before', () => {
    for (const d of DIFFICULTIES) {
      for (let k = 0; k < lanesOf(d); k++) {
        const before = multiplier(d, k);
        expect((1 - hazardChance(d, k)) * afterSafe(before, d, k)).toBeCloseTo(before, 9);
        expect(afterSafe(before, d, k) / multiplier(d, k + 1)).toBeCloseTo(1, 12);
      }
    }
  });

  it('a direct simulation of the raw road reaches lane k as often as C(20 - m, k) / C(20, k) says', () => {
    const n = 40_000;
    for (const [d, k] of [
      ['easy', 19],
      ['medium', 8],
      ['hard', 5],
      ['expert', 3],
    ] as [Difficulty, number][]) {
      const p = reachChance(d, k);
      let wins = 0;
      for (let r = 0; r < n; r++) if (cross(buildRoad(d, int), d, k).hit === null) wins++;
      expect(Math.abs(wins / n - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / n));
    }
  });

  it('the shown odds are the true odds: after 2 safe hops the next slot is a hazard m / 18 of the time', () => {
    for (const d of DIFFICULTIES) {
      const n = 60_000;
      let kept = 0;
      let hit = 0;
      for (let r = 0; r < n; r++) {
        const road = buildRoad(d, int);
        if (road[0] || road[1]) continue;
        kept++;
        if (road[2]) hit++;
      }
      const h = hazardChance(d, 2);
      expect(h).toBe(DIFFICULTY[d].hazards / 18);
      expect(Math.abs(hit / kept - h)).toBeLessThan(4 * Math.sqrt((h * (1 - h)) / kept));
      // The whole-bet bar: 1 / C(18, m) to clear everything from there.
      expect(finishChance(d, 2)).toBeCloseTo(reachChance(d, lanesOf(d)) / reachChance(d, 2), 12);
    }
  });

  it('an auto bet resolves once, to M(target) or 0, and returns 98%', () => {
    const d: Difficulty = 'medium';
    const target = 5;
    const n = 60_000;
    let sum = 0;
    let sumSq = 0;
    for (let r = 0; r < n; r++) {
      const road = buildRoad(d, int);
      const res = cross(road, d, target);
      if (res.hit === null) {
        expect(res.lanes).toBe(target);
        expect(road.slice(0, target).some(Boolean)).toBe(false);
      } else {
        expect(res.multiplier).toBe(0);
        expect(road[res.hit - 1]).toBe(true);
        expect(road.slice(0, res.hit - 1).some(Boolean)).toBe(false);
      }
      sum += res.multiplier;
      sumSq += res.multiplier ** 2;
    }
    const mean = sum / n;
    const se = Math.sqrt((sumSq / n - mean ** 2) / n);
    expect(Math.abs(mean - RTP)).toBeLessThan(4 * se);
    expect(cross(new Array(SLOTS).fill(false), d, 99).lanes).toBe(lanesOf(d));
    expect(cross(new Array(SLOTS).fill(false), d, 0).lanes).toBe(1);
  });

  it('the paytable is monotone and the max multiplier is honest', () => {
    for (const d of DIFFICULTIES) {
      for (let k = 1; k <= lanesOf(d); k++) {
        expect(multiplier(d, k)).toBeGreaterThan(multiplier(d, k - 1));
        expect(multiplier(d, k)).toBeLessThanOrEqual(MAX_MULTIPLIER + 1e-9);
      }
    }
    expect(MAX_MULTIPLIER).toBe(finish('expert'));
    expect(manifest.maxMultiplier).toBe(MAX_MULTIPLIER);
    expect(manifest.rtp).toBe(RTP);
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
