import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import { RTP, TARGETS, WINDOWS, afterSafeDrop, danger, fitChance, fits } from './math';

const rng = createRng(seededSource(7));

describe('Half Moon maths', () => {
  it('Wendel: n points fit in a half circle with chance n / 2^(n-1)', () => {
    for (let n = 1; n <= 10; n++) expect(fitChance(n, 180)).toBeCloseTo(n / 2 ** (n - 1), 12);
  });

  it('the drawn bust arc is exactly where a new point breaks the window', () => {
    for (const window of WINDOWS) {
      for (let trial = 0; trial < 60; trial++) {
        const points = [rng.next()];
        for (let tries = 0; points.length < 6 && tries < 40; tries++) {
          const p = rng.next();
          if (fits([...points, p], window)) points.push(p);
        }
        const { q, arc } = danger(points, window);
        // Sweep the circle: busting positions must be exactly the arc.
        let busting = 0;
        const N = 1440;
        for (let i = 0; i < N; i++) {
          const x = (i + 0.5) / N;
          const bust = !fits([...points, x], window);
          if (bust) busting++;
          if (arc) {
            const d = (((x - arc.start) % 1) + 1) % 1;
            const inside = d < arc.length;
            if (Math.min(d, arc.length - d, 1 - d) > 2 / N) expect(bust).toBe(inside);
          } else {
            expect(bust).toBe(false);
          }
        }
        expect(Math.abs(busting / N - q)).toBeLessThan(2 / N + 1e-9);
      }
    }
  });

  it('playing to the end reaches the target exactly as often as the formula says', () => {
    for (const window of WINDOWS) {
      for (const target of TARGETS) {
        const rounds = 20000;
        let wins = 0;
        for (let r = 0; r < rounds; r++) {
          const points: number[] = [];
          let ok = true;
          while (ok && points.length < target) {
            points.push(rng.next());
            ok = fits(points, window);
          }
          if (ok) wins++;
        }
        const p = fitChance(target, window);
        expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-3);
      }
    }
  });

  it('each drop is a fair bet: E[cash-out after] = cash-out before', () => {
    for (const window of WINDOWS) {
      const points = [0.1, 0.18];
      const { q } = danger(points, window);
      const before = RTP * 1.7;
      expect((1 - q) * afterSafeDrop(before, q)).toBeCloseTo(before, 12);
    }
  });

  it('simulated RTP matches the manifest under random stopping', () => {
    for (const r of runEval(evalSpec, { rounds: 60_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
