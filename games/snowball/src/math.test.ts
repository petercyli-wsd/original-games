import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  PACES,
  PRESETS,
  PRESET_IDS,
  RTP,
  betaBinomialPmf,
  cashMultiplier,
  drawColour,
  maxMultiplier,
  prize,
  winProbability,
} from './math';

describe('Snowball maths', () => {
  it('beta-binomial pmf sums to 1', () => {
    for (const [n, a, b] of [[11, 1, 1], [21, 10, 10], [41, 1, 5], [5, 3, 1]]) {
      expect(betaBinomialPmf(n, a, b).reduce((s, p) => s + p, 0)).toBeCloseTo(1, 12);
    }
  });

  it('a 1:1 urn makes every final blue count equally likely (uniform)', () => {
    for (const p of betaBinomialPmf(10, 1, 1)) expect(p).toBeCloseTo(1 / 11, 12);
  });

  it('P(win) matches a Monte Carlo of the urn', () => {
    const rng = createRng(seededSource(42));
    const trials = 40_000;
    for (const [blue0, red0, n] of [[1, 1, 11], [1, 3, 21], [3, 1, 11], [4, 6, 9], [1, 5, 11]]) {
      let wins = 0;
      for (let t = 0; t < trials; t++) {
        let blue = blue0;
        let red = red0;
        for (let d = 0; d < n; d++) {
          if (drawColour(blue, red, rng.next()) === 'blue') blue++;
          else red++;
        }
        if (blue > red) wins++;
      }
      const p = winProbability(blue0, red0, n);
      expect(Math.abs(wins / trials - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / trials) + 1e-9);
    }
  });

  it('decided rounds report exactly 0 or 1', () => {
    expect(winProbability(10, 3, 5)).toBe(1);
    expect(winProbability(3, 10, 5)).toBe(0);
    expect(winProbability(6, 5, 0)).toBe(1);
    expect(winProbability(5, 6, 0)).toBe(0);
  });

  it('ties are impossible: every preset ends with an odd number of balls', () => {
    for (const id of PRESET_IDS) {
      for (const n of PACES) expect((PRESETS[id].blue + PRESETS[id].red + n) % 2).toBe(1);
    }
  });

  it('the expected cash-out after any number of draws is exactly the RTP', () => {
    // After k draws the number of blues drawn is BetaBinomial(k, blue, red), so
    // the expectation of M × P_k can be summed exactly over every reachable urn.
    for (const id of PRESET_IDS) {
      const { blue, red } = PRESETS[id];
      for (const n of PACES) {
        for (const k of [0, 1, 2, 5, Math.floor(n / 2), n - 1, n]) {
          const pmf = betaBinomialPmf(k, blue, red);
          let ev = 0;
          pmf.forEach((p, j) => (ev += p * cashMultiplier(id, n, blue + j, red + k - j, n - k)));
          expect(ev).toBeCloseTo(RTP, 10);
        }
      }
    }
  });

  it('cash-out never exceeds the prize', () => {
    expect(cashMultiplier('longshot', 11, 12, 1, 3)).toBeCloseTo(prize('longshot', 11), 12);
    expect(cashMultiplier('wild', 21, 2, 1, 20)).toBeLessThan(prize('wild', 21));
  });

  it('manifest covers every reachable payout', () => {
    for (const id of PRESET_IDS) for (const n of PACES) expect(prize(id, n)).toBeLessThanOrEqual(manifest.maxMultiplier);
    expect(manifest.maxMultiplier).toBe(maxMultiplier());
    expect(manifest.rtp).toBe(RTP);
    expect(new Set(PRESET_IDS.map((id) => PRESETS[id].volatility))).toEqual(new Set(manifest.volatility));
  });

  it('simulated RTP matches the manifest', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
