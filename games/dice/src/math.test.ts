import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import { MAX_MULTIPLIER, RTP, chanceForMultiplier, chanceOf, multiplierFor, roll, targetFor } from './math';

describe('Dice maths', () => {
  it('every target is worth exactly the RTP', () => {
    for (const c of [0.01, 1, 2.5, 49.5, 50, 75.25, 98]) {
      expect((c / 100) * multiplierFor(c)).toBeCloseTo(RTP, 12);
    }
  });

  it('the win chance is the green share of the track, in both directions', () => {
    const rng = createRng(seededSource(3));
    for (const dir of ['over', 'under'] as const) {
      const target = targetFor(30, dir);
      let wins = 0;
      const n = 200_000;
      for (let i = 0; i < n; i++) if (roll(rng.next(), target, dir).win) wins++;
      expect(Math.abs(wins / n - 0.3)).toBeLessThan(4 * Math.sqrt((0.3 * 0.7) / n));
      expect(chanceOf(target, dir)).toBeCloseTo(30, 10);
    }
  });

  it('multiplier and chance inputs round-trip', () => {
    expect(chanceForMultiplier(2)).toBe(49.5);
    expect(chanceForMultiplier(1e9)).toBe(0.01);
    expect(MAX_MULTIPLIER).toBeCloseTo(9900, 8);
  });

  it('simulated RTP matches the manifest', () => {
    for (const r of runEval(evalSpec, { rounds: 100_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
