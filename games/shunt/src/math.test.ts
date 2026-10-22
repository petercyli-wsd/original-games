import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  CARS,
  MAX_MULTIPLIER,
  allOrders,
  arrive,
  cashOf,
  catalan,
  clearChance,
  clearingOrders,
  clears,
  has231,
  initialYard,
  nextRisk,
  prizeOf,
  startChance,
  wouldJam,
  type Cars,
  type Yard,
} from './math';

const rng = createRng(seededSource(11));

function permutations(items: number[]): number[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((x, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((p) => [x, ...p]));
}

function shuffle(n: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i + 1);
  for (let i = n - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** A random reachable, still-live yard after some arrivals. */
function randomLiveYard(n: Cars): Yard {
  for (;;) {
    let y = initialYard(n);
    const k = rng.int(n);
    let ok = true;
    for (let s = 0; s < k; s++) {
      y = arrive(y, y.rest[rng.int(y.rest.length)]).yard;
      if (y.jammed !== null) {
        ok = false;
        break;
      }
    }
    if (ok) return y;
  }
}

describe('Shunt maths', () => {
  it('Knuth: the greedy siding clears exactly the 231-avoiding orders, Catalan(n) of n!', () => {
    for (let n = 1; n <= 7; n++) {
      const all = permutations(Array.from({ length: n }, (_, i) => i + 1));
      let count = 0;
      for (const p of all) {
        const ok = clears(p);
        expect(ok).toBe(!has231(p));
        if (ok) count++;
      }
      expect(count).toBe(catalan(n));
    }
  });

  it('live odds: ∏ Catalan(block) equals the exact count of clearing completions', () => {
    for (const n of [4, 5, 6, 7] as Cars[]) {
      for (let t = 0; t < 40; t++) {
        const y = randomLiveYard(n);
        const prefix = [...y.out, ...y.stack]; // the cars that have arrived (as a set)
        expect(prefix.length + y.rest.length).toBe(n);
        // Brute force: replay every completion of this exact yard.
        let ok = 0;
        for (const p of permutations(y.rest)) {
          let z = y;
          let jam = false;
          for (const c of p) {
            z = arrive(z, c).yard;
            if (z.jammed !== null) {
              jam = true;
              break;
            }
          }
          if (!jam) ok++;
        }
        expect(clearingOrders(y)).toBe(ok);
        expect(allOrders(y)).toBe(permutations(y.rest).length);
      }
    }
  });

  it('playing to the end clears as often as Catalan(n)/n! says (simulation)', () => {
    for (const n of CARS) {
      const rounds = 20000;
      let wins = 0;
      for (let r = 0; r < rounds; r++) if (clears(shuffle(n))) wins++;
      const p = startChance(n);
      expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds));
    }
  });

  it('the red cars are exactly the ones that jam next, and their share is the risk', () => {
    for (const n of CARS) {
      for (let t = 0; t < 50; t++) {
        const y = randomLiveYard(n);
        let jams = 0;
        for (const c of y.rest) {
          const after = arrive(y, c).yard;
          expect(after.jammed !== null).toBe(wouldJam(y, c));
          if (after.jammed !== null) jams++;
        }
        expect(nextRisk(y)).toBeCloseTo(jams / y.rest.length, 15);
      }
    }
  });

  it('martingale: E[cash-out after the next car] = cash-out now', () => {
    for (const n of CARS) {
      for (let t = 0; t < 60; t++) {
        const y = randomLiveYard(n);
        if (y.rest.length === 0) continue;
        const mean = y.rest.reduce((s, c) => s + cashOf(arrive(y, c).yard), 0) / y.rest.length;
        expect(mean).toBeCloseTo(cashOf(y), 9);
      }
      expect(cashOf(initialYard(n))).toBeCloseTo(manifest.rtp, 12);
    }
  });

  it('cash-out never exceeds the prize, and the prize never exceeds maxMultiplier', () => {
    for (const n of CARS) {
      for (let t = 0; t < 30; t++) expect(clearChance(randomLiveYard(n))).toBeLessThanOrEqual(1);
      expect(prizeOf(n)).toBeLessThanOrEqual(MAX_MULTIPLIER + 1e-12);
    }
    expect(manifest.maxMultiplier).toBeCloseTo(0.99 * (362880 / 4862), 9);
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
