import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import { BURROWS, CRITTERS, MAX_MULTIPLIER, MAX_WIN, RTP, afterFind, autoClimb, findChance, floor2, hide, maxFinds, reachChance, tap, value } from './math';

const rng = createRng(seededSource(23));
const shuffle = <T,>(xs: readonly T[]) => rng.shuffle(xs);

/** The published table (hits 1 to 9, 98% RTP); the 1-critter column stops at 8 hits. */
const PUBLISHED: Record<number, number[]> = {
  1: [6.86, 48.02, 336.14, 2352.98, 16470.86, 115296.02, 807072.14, 5649504.98],
  2: [3.43, 12.0, 42.01, 147.06, 514.71, 1801.5, 6305.25, 22068.37, 77239.32],
  3: [2.28, 5.33, 12.45, 29.04, 67.78, 158.15, 369.03, 861.07, 2009.17],
  4: [1.71, 3.0, 5.25, 9.19, 16.08, 28.14, 49.26, 86.2, 150.85],
  5: [1.37, 1.92, 2.68, 3.76, 5.27, 7.37, 10.33, 14.46, 20.24],
  6: [1.14, 1.33, 1.55, 1.81, 2.11, 2.47, 2.88, 3.36, 3.92],
};

/** Every order of the 7 burrows, for exact enumeration of the shuffle. */
function permutations(n: number): number[][] {
  if (n === 1) return [[0]];
  const out: number[][] = [];
  for (const p of permutations(n - 1)) for (let i = 0; i <= p.length; i++) out.push([...p.slice(0, i), n - 1, ...p.slice(i)]);
  return out;
}
const PERMS = permutations(BURROWS);

describe('Burrows maths', () => {
  it('matches the published payout table value for value (display is truncated, a few cells round)', () => {
    for (const m of CRITTERS) {
      PUBLISHED[m].forEach((cell, i) => {
        const v = value(m, i + 1);
        expect(Math.abs(v - cell)).toBeLessThan(0.0100001);
        expect(Math.abs(floor2(v) - cell)).toBeLessThan(0.0100001);
      });
    }
    expect(value(1, 8)).toBeCloseTo(5_649_504.98, 2);
    expect(MAX_WIN).toBeCloseTo(5_649_504.98, 2);
    expect(MAX_MULTIPLIER).toBe(MAX_WIN);
  });

  it('every fixed target of k finds is worth exactly RTP: (m/7)^k · RTP · (7/m)^k', () => {
    for (const m of CRITTERS) for (let k = 0; k <= maxFinds(m); k++) expect(reachChance(m, k) * value(m, k)).toBeCloseTo(RTP, 12);
    expect(afterFind(value(3, 4), 3)).toBeCloseTo(value(3, 5), 6);
  });

  it('max finds per setting: 8, 12, 18, 27, 46, 100, each last value <= MAX_WIN < the next', () => {
    expect(CRITTERS.map(maxFinds)).toEqual([8, 12, 18, 27, 46, 100]);
    for (const m of CRITTERS) {
      expect(value(m, maxFinds(m))).toBeLessThanOrEqual(MAX_WIN * (1 + 1e-12));
      expect(value(m, maxFinds(m) + 1)).toBeGreaterThan(MAX_WIN);
    }
  });

  it('exact enumeration of the shuffle: every burrow holds a critter in exactly m of 7 draws, in every pair too', () => {
    for (const m of CRITTERS) {
      const per = new Array<number>(BURROWS).fill(0);
      for (const p of PERMS) {
        const hidden = hide(m, <T,>(xs: readonly T[]) => p.map((i) => xs[i]));
        expect(hidden.filter(Boolean).length).toBe(m);
        hidden.forEach((h, b) => h && per[b]++);
      }
      for (const c of per) expect(c / PERMS.length).toBeCloseTo(findChance(m), 12);
    }
  });

  it('simulating the raw process: a tap finds with chance m/7 whatever the burrow and whatever came before (4 SE)', () => {
    const n = 60_000;
    for (const m of CRITTERS) {
      const p = findChance(m);
      for (const b of [0, 3, 6]) {
        let hits = 0;
        let afterHit = 0;
        let afterHitFound = 0;
        let prev = false;
        for (let i = 0; i < n; i++) {
          const t = tap(m, b, shuffle);
          if (t.hit) hits++;
          if (prev) {
            afterHit++;
            if (t.hit) afterHitFound++;
          }
          prev = t.hit;
        }
        const se = Math.sqrt((p * (1 - p)) / n);
        expect(Math.abs(hits / n - p)).toBeLessThan(4 * se);
        expect(Math.abs(afterHitFound / afterHit - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / afterHit));
      }
    }
  });

  it('martingale: p · V(n+1) = V(n) at every n below the cap, for every setting', () => {
    let states = 0;
    for (const m of CRITTERS)
      for (let n = 0; n < maxFinds(m); n++) {
        expect((findChance(m) * value(m, n + 1)) / value(m, n)).toBeCloseTo(1, 12);
        states++;
      }
    expect(states).toBeGreaterThanOrEqual(30);
  });

  it('the eval returns the manifest RTP within 4 SE on every config, max <= maxMultiplier', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000, seed: 7 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });

  it('autoClimb pays V(k) when every planned tap finds, else 0', () => {
    for (let i = 0; i < 2000; i++) {
      const m = CRITTERS[rng.int(6)];
      const k = 1 + rng.int(Math.min(6, maxFinds(m)));
      const picks = Array.from({ length: k }, () => rng.int(7));
      const r = autoClimb(m, picks, shuffle);
      const all = r.taps.length === k && r.taps.every((t) => t.hit);
      expect(r.multiplier).toBe(all ? value(m, k) : 0);
    }
  });
});
