import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  COINS,
  MAX_FLIPS,
  MAX_MULTIPLIER,
  RTP,
  autoRound,
  binom,
  cashAfter,
  flip,
  flipChance,
  flipFactor,
  ladder,
  majority,
  maxFlips,
  outcomes,
  reachChance,
  winWays,
  type AutoCall,
  type Side,
} from './math';

const rng = createRng(seededSource(23));

/** Every (coins, need) setting the panel offers. */
const SETTINGS = COINS.flatMap((n) => Array.from({ length: n }, (_, i) => ({ n, need: i + 1 })));

/** Exact win count by listing all 2^n coin outcomes for a call. */
function enumerateWins(n: number, need: number, call: Side): number {
  let w = 0;
  for (let mask = 0; mask < 2 ** n; mask++) {
    let matches = 0;
    for (let i = 0; i < n; i++) if (((mask >> i) & 1) === call) matches++;
    if (matches >= need) w++;
  }
  return w;
}

describe('Coin Flip maths', () => {
  it('the classic single coin: ½ per flip, first win 1.98×, each win doubles, 20 flips', () => {
    expect(flipChance(1, 1)).toBe(0.5);
    expect(cashAfter(1, 1, 1)).toBeCloseTo(1.98, 12);
    expect(cashAfter(1, 1, 2)).toBeCloseTo(3.96, 12);
    expect(maxFlips(1, 1)).toBe(MAX_FLIPS);
    expect(cashAfter(1, 1, 20)).toBeCloseTo(0.99 * 2 ** 20, 6);
  });

  it('the win count W(n, k) matches enumeration of all 2^n outcomes, for both calls', () => {
    for (const { n, need } of SETTINGS) {
      expect(winWays(n, need)).toBe(enumerateWins(n, need, 0));
      expect(winWays(n, need)).toBe(enumerateWins(n, need, 1));
      expect(flipChance(n, need) * flipFactor(n, need)).toBeCloseTo(1, 14);
    }
    expect(binom(5, 2)).toBe(10);
    expect(winWays(5, 2)).toBe(26);
  });

  it('a raw simulation of tosses wins as often as the formula says, for every call', () => {
    for (const { n, need } of SETTINGS) {
      const trials = 40_000;
      let wins = 0;
      for (let i = 0; i < trials; i++) if (flip(n, need, i % 3 === 2 ? 'random' : ((i % 3) as Side), rng).win) wins++;
      const p = flipChance(n, need);
      expect(Math.abs(wins / trials - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / trials) + 1e-9);
    }
  });

  it('every flip is a fair bet: E[cash-out after] = cash-out now', () => {
    for (const { n, need } of SETTINGS) {
      const p = flipChance(n, need);
      for (let s = 0; s < maxFlips(n, need); s++) {
        const now = cashAfter(n, need, s);
        expect(Math.abs(p * cashAfter(n, need, s + 1) - now) / now).toBeLessThan(1e-12);
      }
    }
  });

  it('exact RTP: stopping after any number of wins returns exactly 99%', () => {
    for (const { n, need } of SETTINGS) {
      for (let s = 1; s <= maxFlips(n, need); s++) {
        expect(reachChance(n, need, s) * cashAfter(n, need, s)).toBeCloseTo(RTP, 10);
      }
    }
  });

  it('ladders rise, stop at the cap and the max multiplier is honest', () => {
    for (const { n, need } of SETTINGS) {
      const l = ladder(n, need);
      expect(l.length).toBeGreaterThanOrEqual(4);
      expect(l.length).toBeLessThanOrEqual(MAX_FLIPS);
      for (let i = 1; i < l.length; i++) expect(l[i]).toBeGreaterThan(l[i - 1]);
      expect(l[l.length - 1]).toBeLessThanOrEqual(MAX_MULTIPLIER * (1 + 1e-12));
      // The next rung (when under 20) would break the cap.
      if (l.length < MAX_FLIPS) expect(l[l.length - 1] * flipFactor(n, need)).toBeGreaterThan(MAX_MULTIPLIER);
    }
    expect(maxFlips(5, 5)).toBe(4);
    expect(maxFlips(3, 3)).toBe(6);
    expect(manifest.maxMultiplier).toBe(MAX_MULTIPLIER);
  });

  it('the odds strip shows exactly the winning share of outcomes', () => {
    for (const { n, need } of SETTINGS) expect(winWays(n, need) / outcomes(n)).toBe(flipChance(n, need));
    for (const n of COINS) expect(flipChance(n, majority(n))).toBeLessThanOrEqual(0.5);
  });

  it('an auto round resolves once, to 0 or the target cash-out, at the right rate', () => {
    const patterns: AutoCall[] = ['random', 'alternate', 0, 1];
    for (const [n, need] of [
      [1, 1],
      [3, 2],
      [4, 4],
    ]) {
      for (const target of [1, 3]) {
        const trials = 20_000;
        let wins = 0;
        let total = 0;
        for (let i = 0; i < trials; i++) {
          const r = autoRound(n, need, target, patterns[i % 4], rng);
          expect(r.steps).toBe(r.flips.length);
          if (r.multiplier > 0) {
            expect(r.multiplier).toBeCloseTo(cashAfter(n, need, target), 10);
            expect(r.flips.every((f) => f.win)).toBe(true);
            expect(r.steps).toBe(target);
            wins++;
          } else {
            expect(r.flips[r.flips.length - 1].win).toBe(false);
          }
          total += r.multiplier;
        }
        const p = reachChance(n, need, target);
        expect(Math.abs(wins / trials - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / trials));
        const sd = cashAfter(n, need, target) * Math.sqrt(p * (1 - p));
        expect(Math.abs(total / trials - RTP)).toBeLessThan(4 * (sd / Math.sqrt(trials)));
      }
    }
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 60_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
