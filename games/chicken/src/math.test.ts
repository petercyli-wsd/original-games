import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  DIFFICULTIES,
  DIFFICULTY,
  LANES,
  MAX_MULTIPLIER,
  OUT_OF,
  RTP,
  afterSafe,
  buildRoad,
  cross,
  finish,
  hitChance,
  laneSafe,
  multiplier,
  reachChance,
  type Difficulty,
} from './math';

const rng = createRng(seededSource(41));
const int = (n: number) => rng.int(n);

/** Exact value of the stopping rule "cash out when stopAt(k)" by backward induction over k. */
function strategyValue(d: Difficulty, stopAt: (k: number) => boolean): number {
  const value = (k: number): number => {
    if (k === LANES || (k > 0 && stopAt(k))) return multiplier(d, k);
    return laneSafe(d) * value(k + 1);
  };
  return value(0);
}

describe('Chicken maths', () => {
  it('pays RTP / (1 − h)^k: every fixed target lane is worth exactly 99%', () => {
    for (const d of DIFFICULTIES) {
      for (let k = 0; k <= LANES; k++) expect(reachChance(d, k) * multiplier(d, k)).toBeCloseTo(RTP, 12);
    }
    expect(hitChance('easy')).toBe(1 / 25);
    expect(hitChance('medium')).toBe(3 / 25);
    expect(hitChance('hard')).toBe(5 / 25);
    expect(hitChance('daredevil')).toBe(10 / 25);
    expect(multiplier('hard', 1)).toBeCloseTo(1.2375, 12);
    expect(finish('easy')).toBeCloseTo(0.99 * (25 / 24) ** 20, 12);
    expect(finish('hard')).toBeCloseTo(0.99 * 1.25 ** 20, 9);
    expect(finish('daredevil')).toBeCloseTo((0.99 * 5 ** 20) / 3 ** 20, 6);
  });

  it('exact enumeration: the per-lane hit is int(25) < hits, so its chance is exactly hits / 25', () => {
    for (const d of DIFFICULTIES) {
      let hit = 0;
      for (let u = 0; u < OUT_OF; u++) if (u < DIFFICULTY[d].hits) hit++;
      expect(hit / OUT_OF).toBe(hitChance(d));
    }
  });

  it('exact enumeration over a short road: every target pays 99%', () => {
    // Enumerate all 25^3 draws for three lanes; each target 1..3 is worth RTP.
    for (const d of DIFFICULTIES) {
      const hits = DIFFICULTY[d].hits;
      for (let target = 1; target <= 3; target++) {
        let ev = 0;
        for (let a = 0; a < OUT_OF; a++)
          for (let b = 0; b < OUT_OF; b++)
            for (let c = 0; c < OUT_OF; c++) {
              const road = [a < hits, b < hits, c < hits, ...new Array(LANES - 3).fill(false)];
              ev += cross(road, d, target).multiplier;
            }
        expect(ev / OUT_OF ** 3).toBeCloseTo(RTP, 12);
      }
    }
  });

  it('every stopping rule returns exactly RTP (analytic, backward induction)', () => {
    for (const d of DIFFICULTIES) {
      expect(strategyValue(d, () => false)).toBeCloseTo(RTP, 10); // to the far kerb
      for (let t = 1; t <= LANES; t++) expect(strategyValue(d, (k) => k >= t)).toBeCloseTo(RTP, 10);
      for (const target of [1.5, 3, 10, 100, 5000]) expect(strategyValue(d, (k) => multiplier(d, k) >= target)).toBeCloseTo(RTP, 10);
      for (let trial = 0; trial < 40; trial++) {
        const stops = Array.from({ length: LANES + 1 }, () => rng.next() < 0.2);
        expect(strategyValue(d, (k) => stops[k])).toBeCloseTo(RTP, 10);
      }
    }
  });

  it('each lane is a fair bet: E[cash-out after] = cash-out before', () => {
    for (const d of DIFFICULTIES) {
      for (let k = 0; k < LANES; k++) {
        const before = multiplier(d, k);
        expect(laneSafe(d) * afterSafe(before, d)).toBeCloseTo(before, 9);
        expect(afterSafe(before, d) / multiplier(d, k + 1)).toBeCloseTo(1, 12);
      }
    }
  });

  it('a direct simulation of the raw road reaches lane k as often as (1 − h)^k says', () => {
    const n = 40_000;
    for (const [d, k] of [
      ['easy', 20],
      ['medium', 8],
      ['hard', 5],
      ['daredevil', 3],
    ] as [Difficulty, number][]) {
      const p = reachChance(d, k);
      let wins = 0;
      for (let r = 0; r < n; r++) if (cross(buildRoad(d, int), d, k).hit === null) wins++;
      expect(Math.abs(wins / n - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / n));
    }
  });

  it('the shown odds are the true odds: the next lane is hit h of the time, after any history', () => {
    for (const d of DIFFICULTIES) {
      const n = 60_000;
      let kept = 0;
      let hit = 0;
      const lanes = new Array<number>(LANES).fill(0);
      for (let r = 0; r < n; r++) {
        const road = buildRoad(d, int);
        road.forEach((h, i) => (lanes[i] += h ? 1 : 0));
        // Condition on lanes 1–2 being safe; lane 3 must still be hit with chance h.
        if (road[0] || road[1]) continue;
        kept++;
        if (road[2]) hit++;
      }
      const h = hitChance(d);
      expect(Math.abs(hit / kept - h)).toBeLessThan(4 * Math.sqrt((h * (1 - h)) / kept));
      for (const c of lanes) expect(Math.abs(c / n - h)).toBeLessThan(4 * Math.sqrt((h * (1 - h)) / n));
    }
  });

  it('an auto bet resolves once, to M(target) or 0, and returns 99%', () => {
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
        expect(res.multiplier).toBeCloseTo(multiplier(d, target), 12);
        expect(road.slice(0, target).some(Boolean)).toBe(false);
      } else {
        expect(res.multiplier).toBe(0);
        expect(res.lanes).toBe(res.hit);
        expect(road[res.hit - 1]).toBe(true);
        expect(road.slice(0, res.hit - 1).some(Boolean)).toBe(false);
      }
      sum += res.multiplier;
      sumSq += res.multiplier ** 2;
    }
    const mean = sum / n;
    const se = Math.sqrt((sumSq / n - mean ** 2) / n);
    expect(Math.abs(mean - RTP)).toBeLessThan(4 * se);
    // Targets clamp to 1..20.
    expect(cross(new Array(LANES).fill(false), d, 99).lanes).toBe(LANES);
    expect(cross(new Array(LANES).fill(false), d, 0).lanes).toBe(1);
  });

  it('the paytable is monotone and the max multiplier is honest', () => {
    for (const d of DIFFICULTIES) {
      for (let k = 1; k <= LANES; k++) {
        expect(multiplier(d, k)).toBeGreaterThan(multiplier(d, k - 1));
        expect(multiplier(d, k)).toBeLessThanOrEqual(MAX_MULTIPLIER + 1e-9);
      }
    }
    for (let i = 1; i < DIFFICULTIES.length; i++) expect(multiplier(DIFFICULTIES[i], 1)).toBeGreaterThan(multiplier(DIFFICULTIES[i - 1], 1));
    expect(MAX_MULTIPLIER).toBe(finish('daredevil'));
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
