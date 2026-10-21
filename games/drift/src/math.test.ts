import { runEval } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import { RTP, TRACKS, cashMultiplier, endingAt, expectedSteps, maxMultiplier, prizeMultiplier, startPresets, type AutoRules } from './math';

/** Solves p(0)=0, p(W)=1, p(x) = ½p(x−1) + ½p(x+1) with the Thomas algorithm. */
function solveWinChance(W: number): number[] {
  // Unknowns p(1)..p(W−1): −½p(x−1) + p(x) − ½p(x+1) = 0. The known p(W) = 1
  // enters through the back substitution of the last row.
  const n = W - 1;
  const c = new Float64Array(n);
  const d = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const denom = 1 + (i > 0 ? 0.5 * c[i - 1] : 0);
    c[i] = -0.5 / denom;
    d[i] = (i > 0 ? 0.5 * d[i - 1] : 0) / denom;
  }
  const p = new Array<number>(W + 1).fill(0);
  p[W] = 1;
  for (let i = n - 1; i >= 0; i--) p[i + 1] = d[i] - c[i] * p[i + 2];
  return p;
}

/**
 * Exact expected multiplier of a stopping rule, by pushing the probability
 * distribution of the walk forward one step at a time. `stop(x, t)` sees the
 * position and the step count (so it covers timed and checkpoint rules).
 */
function expectedMultiplier(
  W: number,
  x0: number,
  stop: (x: number, t: number) => boolean,
  rules: AutoRules = { takeProfit: null, stopLoss: null },
) {
  let dist = new Float64Array(W + 1);
  dist[x0] = 1;
  let ev = 0;
  for (let t = 1; t < 1_000_000; t++) {
    const next = new Float64Array(W + 1);
    for (let x = 1; x < W; x++) {
      next[x - 1] += dist[x] / 2;
      next[x + 1] += dist[x] / 2;
    }
    let alive = 0;
    for (let x = 0; x <= W; x++) {
      if (next[x] === 0) continue;
      if (endingAt(x, W, rules) || stop(x, t)) {
        ev += next[x] * cashMultiplier(x, x0);
        next[x] = 0;
      } else alive += next[x];
    }
    dist = next;
    if (alive < 1e-14) return ev;
  }
  throw new Error('walk did not finish');
}

describe('Drift maths', () => {
  it('the win chance from x is exactly x / W', () => {
    for (const W of TRACKS) {
      const p = solveWinChance(W);
      for (let x = 0; x <= W; x++) expect(p[x]).toBeCloseTo(x / W, 12);
    }
  });

  it('the forward walk agrees: holding to a wall wins x0 / W of the time', () => {
    for (const [W, x0] of [
      [10, 3],
      [20, 1],
      [40, 30],
    ]) {
      // Prize × P(win) = RTP, so the win chance is EV / prize.
      const ev = expectedMultiplier(W, x0, () => false);
      expect(ev / prizeMultiplier(W, x0)).toBeCloseTo(x0 / W, 9);
    }
  });

  it('cash-out value is prize × win chance, and 0 / RTP / prize at red / start / green', () => {
    for (const W of TRACKS) {
      for (let x0 = 1; x0 < W; x0++) {
        expect(cashMultiplier(0, x0)).toBe(0);
        expect(cashMultiplier(x0, x0)).toBeCloseTo(RTP, 12);
        expect(cashMultiplier(W, x0)).toBeCloseTo(prizeMultiplier(W, x0), 12);
        expect(cashMultiplier(x0 + 1, x0)).toBeCloseTo(prizeMultiplier(W, x0) * ((x0 + 1) / W), 12);
      }
    }
  });

  it('every stopping rule returns exactly the RTP', () => {
    const W = 20;
    for (const x0 of [1, 5, 10, 17]) {
      const cases: [string, number][] = [
        ['hold to a wall', expectedMultiplier(W, x0, () => false)],
        ['cash after 1 step', expectedMultiplier(W, x0, (_, t) => t === 1)],
        ['cash after 37 steps', expectedMultiplier(W, x0, (_, t) => t === 37)],
        ['take-profit at +3', expectedMultiplier(W, x0, () => false, { takeProfit: Math.min(W, x0 + 3), stopLoss: null })],
        ['stop-loss at half', expectedMultiplier(W, x0, () => false, { takeProfit: null, stopLoss: Math.floor(x0 / 2) })],
        ['take-profit + stop-loss', expectedMultiplier(W, x0, () => false, { takeProfit: x0 + 2, stopLoss: x0 - 1 })],
        ['first 5-step checkpoint above start', expectedMultiplier(W, x0, (x, t) => t % 5 === 0 && x > x0)],
        ['first 10-step checkpoint in the top half', expectedMultiplier(W, x0, (x, t) => t % 10 === 0 && x >= W / 2)],
      ];
      for (const [name, ev] of cases) expect(ev, `${name} from ${x0}`).toBeCloseTo(RTP, 9);
    }
  });

  it('rounds take x(W−x) steps on average', () => {
    // E[steps] by the same forward pass: each surviving step adds its mass.
    const W = 20;
    const x0 = 6;
    let dist = new Float64Array(W + 1);
    dist[x0] = 1;
    let mean = 0;
    for (let t = 0; t < 100_000; t++) {
      const next = new Float64Array(W + 1);
      let alive = 0;
      for (let x = 1; x < W; x++) {
        alive += dist[x];
        next[x - 1] += dist[x] / 2;
        next[x + 1] += dist[x] / 2;
      }
      mean += alive;
      next[0] = next[W] = 0;
      dist = next;
    }
    expect(mean).toBeCloseTo(expectedSteps(x0, W), 6);
  });

  it('start presets are whole steps and the manifest covers the top prize', () => {
    expect(startPresets(10)).toEqual([5, 1]);
    expect(startPresets(100)).toEqual([50, 25, 10, 5, 2, 1]);
    for (const W of TRACKS) for (let x0 = 1; x0 < W; x0++) expect(prizeMultiplier(W, x0)).toBeLessThanOrEqual(manifest.maxMultiplier);
    expect(manifest.maxMultiplier).toBe(maxMultiplier);
    expect(maxMultiplier).toBeCloseTo(99, 9);
  });

  it('simulated RTP matches the manifest', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
