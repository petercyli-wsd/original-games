import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import { KS, MAX_MULTIPLIER, RTP, ROCKETS, binGE, cashOut, crashFrom, playCrashes, prize, rocketChance, startChance, stopNever, winChance } from './math';

const rng = createRng(seededSource(11));

describe('Fleet maths', () => {
  it('start chances are the binomial tail: 81.25 / 50 / 18.75 / 3.125 %', () => {
    expect(startChance(2)).toBeCloseTo(26 / 32, 12);
    expect(startChance(3)).toBeCloseTo(16 / 32, 12);
    expect(startChance(4)).toBeCloseTo(6 / 32, 12);
    expect(startChance(5)).toBeCloseTo(1 / 32, 12);
    expect(MAX_MULTIPLIER).toBeCloseTo(RTP * 32, 12);
  });

  it('closed-form win chance matches a direct simulation of the raw process (4 SE)', () => {
    const n = 200_000;
    for (const k of KS) {
      let win = 0;
      for (let i = 0; i < n; i++) {
        let flying = 0;
        for (let j = 0; j < ROCKETS; j++) if (crashFrom(rng.next()) >= 2) flying++;
        if (flying >= k) win++;
      }
      const p = startChance(k);
      expect(Math.abs(win / n - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / n));
    }
  });

  it('height is the chance: a rocket flying at m reaches 2x with chance m/2', () => {
    for (const m of [1, 1.25, 1.5, 1.9]) {
      let fly = 0;
      let reach = 0;
      for (let i = 0; i < 400_000; i++) {
        const c = crashFrom(rng.next());
        if (c < m) continue;
        fly++;
        if (c >= 2) reach++;
      }
      const p = rocketChance(m);
      expect(Math.abs(reach / fly - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / fly));
    }
  });

  it('martingale: a rocket at m survives to m2 with chance m/m2, and E[cash-out] is unchanged', () => {
    for (const k of KS)
      for (let a = k; a <= ROCKETS; a++)
        for (const [m, m2] of [[1, 1.3], [1.2, 1.7], [1.5, 2], [1, 2], [1.8, 1.95]]) {
          let e = 0;
          for (let j = 0; j <= a; j++) {
            const s = m / m2;
            let c = 1;
            for (let i = 1; i <= j; i++) c = (c * (a - j + i)) / i;
            e += c * s ** j * (1 - s) ** (a - j) * cashOut(j, m2, k);
          }
          expect(e).toBeCloseTo(cashOut(a, m, k), 9);
        }
  });

  it('the climb only raises the chance, a crash only lowers it', () => {
    for (const k of KS)
      for (let a = k; a <= ROCKETS; a++) {
        expect(winChance(a, 1.6, k)).toBeGreaterThan(winChance(a, 1.2, k) - 1e-15);
        if (a > k) expect(winChance(a - 1, 1.4, k)).toBeLessThan(winChance(a, 1.4, k));
      }
    expect(binGE(5, 0.5, 0)).toBe(1);
  });

  it('runEval is within 4 SE of RTP and never above the max', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier + 1e-9);
    }
  });

  it('plays a round to 2x for the full prize', () => {
    expect(playCrashes([5, 5, 5, 5, 5], 5, stopNever).multiplier).toBeCloseTo(prize(5), 12);
    expect(playCrashes([1.2, 5, 5, 5, 5], 5, stopNever).multiplier).toBe(0);
  });
});
