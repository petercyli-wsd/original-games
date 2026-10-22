import { createRng, runEval, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  FAMILIES,
  GENERATIONS,
  MAX_MULTIPLIER,
  OFFSPRING,
  POP_CAP,
  RTP,
  cashValue,
  childrenDistribution,
  dieOutChance,
  extinctWithin,
  lineSlices,
  lineSurvives,
  prize,
  sampleChildren,
  winChance,
  type Family,
} from './math';

const rng = createRng(seededSource(11));

/** Runs the raw process from z nodes for t generations; true if anyone is alive at the end. */
function survives(family: Family, z: number, t: number, r: Rng): boolean {
  for (let i = 0; i < t && z > 0; i++) {
    let next = 0;
    for (let j = 0; j < z; j++) next += sampleChildren(family, r.next());
    z = next;
  }
  return z > 0;
}

const within4se = (hits: number, n: number, p: number) => Math.abs(hits / n - p) < 4 * Math.sqrt((p * (1 - p)) / n) + 1e-3;

describe('Branching maths', () => {
  it('the inverse-CDF sampler draws each child count with its stated probability', () => {
    for (const family of FAMILIES) {
      const n = 40_000;
      const counts = [0, 0, 0, 0];
      for (let i = 0; i < n; i++) counts[sampleChildren(family, rng.next())]++;
      OFFSPRING[family].forEach((p, k) => expect(within4se(counts[k], n, p)).toBe(true));
    }
  });

  it('q_t = f^(t)(0) equals P(Z_t = 0) from the full population distribution', () => {
    for (const family of FAMILIES) {
      // Exact distribution of the generation size, by convolution.
      let dist = [0, 1];
      for (let t = 1; t <= 5; t++) {
        const next: number[] = [];
        dist.forEach((pn, n) => {
          if (pn === 0) return;
          childrenDistribution(family, n).forEach((pm, m) => (next[m] = (next[m] ?? 0) + pn * pm));
        });
        dist = next.map((x) => x ?? 0);
        expect(dist[0]).toBeCloseTo(extinctWithin(family, t), 12);
      }
    }
  });

  it('closed form 1 − q_G matches a direct simulation of the raw process', () => {
    for (const family of FAMILIES) {
      for (const gens of GENERATIONS) {
        const n = 12_000;
        let wins = 0;
        for (let r = 0; r < n; r++) if (survives(family, 1, gens, rng)) wins++;
        expect(within4se(wins, n, winChance(family, gens, 0, 1))).toBe(true);
      }
    }
  });

  it('each generation is a fair bet: E[cash-out after] = cash-out before', () => {
    for (const family of FAMILIES) {
      for (const gens of GENERATIONS) {
        for (let trial = 0; trial < 25; trial++) {
          const g = rng.int(gens);
          const z = g === 0 ? 1 : 1 + rng.int(POP_CAP);
          const before = cashValue(family, gens, g, z);
          let after = 0;
          childrenDistribution(family, z).forEach((pm, m) => (after += pm * cashValue(family, gens, g + 1, m)));
          expect(Math.abs(after - before)).toBeLessThan(1e-12 * prize(family, gens));
        }
        // The round starts at exactly RTP.
        expect(cashValue(family, gens, 0, 1)).toBeCloseTo(RTP, 12);
      }
    }
  });

  it('the lit share of the goal ring is exactly the win chance, slice by slice', () => {
    for (const family of FAMILIES) {
      for (const gens of GENERATIONS) {
        for (let g = 0; g < gens; g++) {
          const s = lineSurvives(family, gens - g);
          for (let z = 1; z <= 60; z++) {
            const slices = lineSlices(s, z);
            let edge = 0;
            for (const sl of slices) {
              expect(sl.start).toBeCloseTo(edge, 12);
              expect(sl.length).toBeGreaterThan(0);
              edge = sl.start + sl.length;
            }
            expect(slices[0].length).toBeCloseTo(s, 12);
            expect(edge).toBeCloseTo(winChance(family, gens, g, z), 12);
            expect(1 - edge).toBeCloseTo((1 - s) ** z, 12);
            expect(1 - edge).toBeCloseTo(dieOutChance(family, gens, g, z), 12);
          }
        }
      }
    }
  });

  it('the drawn odds match simulation: one line survives s, z lines survive 1 − (1 − s)^z', () => {
    for (const family of FAMILIES) {
      for (const [z, t] of [
        [1, 2],
        [1, 6],
        [2, 4],
        [3, 7],
        [5, 3],
      ]) {
        const n = 8_000;
        let hits = 0;
        for (let r = 0; r < n; r++) if (survives(family, z, t, rng)) hits++;
        const s = lineSurvives(family, t);
        expect(within4se(hits, n, 1 - (1 - s) ** z)).toBe(true);
        expect(1 - (1 - s) ** z).toBeCloseTo(winChance(family, 12, 12 - t, z), 12);
      }
    }
  });

  it('the settings move the win chance over at least 25:1', () => {
    const ps = FAMILIES.flatMap((f) => GENERATIONS.map((g) => winChance(f, g, 0, 1)));
    expect(Math.max(...ps) / Math.min(...ps)).toBeGreaterThan(25);
    expect(MAX_MULTIPLIER).toBeCloseTo(Math.max(...FAMILIES.flatMap((f) => GENERATIONS.map((g) => prize(f, g)))), 12);
  });

  it('simulated RTP matches the manifest under mixed stopping rules', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
