import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  MAX_WIN,
  RTP,
  TARGETS,
  afterSafeDrop,
  allShare,
  completeChance,
  core,
  hitsCap,
  meets,
  redSquares,
  risk,
  shareChance,
  type Interval,
} from './math';

const rng = createRng(seededSource(11));
const drawInterval = (): Interval => ({ u: rng.next(), v: rng.next() });

/** A random reachable live state: k intervals that still share a point. */
function liveState(k: number): Interval[] {
  const ivs: Interval[] = [];
  while (ivs.length < k) {
    const iv = drawInterval();
    if (meets(core(ivs), iv)) ivs.push(iv);
  }
  return ivs;
}

describe('Core maths', () => {
  it('2ⁿ(n!)²/(2n)!: the closed form for small n', () => {
    expect(shareChance(1)).toBe(1);
    expect(shareChance(2)).toBeCloseTo(2 / 3, 14);
    expect(shareChance(3)).toBeCloseTo(2 / 5, 14);
    expect(shareChance(4)).toBeCloseTo(8 / 35, 14);
    const fact = (n: number): number => (n <= 1 ? 1 : n * fact(n - 1));
    for (const n of TARGETS) expect(shareChance(n)).toBeCloseTo((2 ** n * fact(n) ** 2) / fact(2 * n), 14);
  });

  it('dropping until the first miss reaches n intervals as often as the formula says', () => {
    for (const n of TARGETS) {
      const rounds = 30_000;
      let wins = 0;
      for (let k = 0; k < rounds; k++) {
        const ivs: Interval[] = [];
        let ok = true;
        while (ok && ivs.length < n) {
          ivs.push(drawInterval());
          ok = allShare(ivs);
        }
        if (ok) wins++;
      }
      const p = shareChance(n);
      expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-4);
    }
  });

  it('Helly in 1D: pairwise meeting ⇔ the core is non-empty, and the core rule matches the raw rule', () => {
    for (let t = 0; t < 4000; t++) {
      const ivs = Array.from({ length: 2 + rng.int(5) }, drawInterval);
      const { l, r } = core(ivs);
      expect(allShare(ivs)).toBe(l <= r);
      const last = ivs[ivs.length - 1];
      const prev = ivs.slice(0, -1);
      if (allShare(prev)) expect(meets(core(prev), last)).toBe(allShare(ivs));
    }
  });

  it('the drawn red squares are exactly the busting endpoint pairs, and their area is the risk', () => {
    const N = 160;
    for (let t = 0; t < 24; t++) {
      const ivs = liveState(1 + rng.int(6));
      const c = core(ivs);
      const q = risk(c);
      const [s1, s2] = redSquares(c);
      expect(s1.side ** 2 + s2.side ** 2).toBeCloseTo(q, 14);
      let busting = 0;
      for (let i = 0; i < N; i++)
        for (let j = 0; j < N; j++) {
          const iv = { u: (i + 0.5) / N, v: (j + 0.5) / N };
          const bust = !allShare([...ivs, iv]);
          if (bust) busting++;
          const inRed = [s1, s2].some((s) => iv.u > s.x && iv.u < s.x + s.side && iv.v > s.y && iv.v < s.y + s.side);
          const nearEdge = [c.l, c.r].some((e) => Math.abs(iv.u - e) < 1 / N || Math.abs(iv.v - e) < 1 / N);
          if (!nearEdge) expect(bust).toBe(inRed);
        }
      // Midpoint counts converge on the area to within the boundary cells.
      expect(Math.abs(busting / N ** 2 - q)).toBeLessThan(4 / N);
    }
  });

  it('each drop is a fair bet: E[cash-out after] = cash-out before', () => {
    for (let t = 0; t < 200; t++) {
      const c = core(liveState(1 + rng.int(8)));
      const q = risk(c);
      const before = RTP * (1 + 50 * rng.next());
      expect((1 - q) * afterSafeDrop(before, q) + q * 0).toBeCloseTo(before, 9);
    }
  });

  it('the chance to complete is exact: base cases, symmetry, simulation and the one-step martingale', () => {
    for (const n of TARGETS) expect(completeChance({ l: 0, r: 1 }, n)).toBeCloseTo(shareChance(n), 12);
    for (let t = 0; t < 200; t++) {
      const c = core(liveState(1 + rng.int(5)));
      // One interval to go: the chance is exactly 1 − q.
      expect(completeChance(c, 1)).toBeCloseTo(1 - risk(c), 12);
      // Mirror symmetry x → 1 − x.
      const m = 1 + rng.int(10);
      expect(completeChance(c, m)).toBeCloseTo(completeChance({ l: 1 - c.r, r: 1 - c.l }, m), 12);
    }
    // Against a direct simulation of the raw process from random live cores.
    for (let t = 0; t < 6; t++) {
      const ivs = liveState(1 + rng.int(3));
      const m = 2 + rng.int(4);
      const rounds = 20_000;
      let wins = 0;
      for (let k = 0; k < rounds; k++) {
        const all = [...ivs];
        for (let j = 0; j < m; j++) all.push(drawInterval());
        if (allShare(all)) wins++;
      }
      const p = completeChance(core(ivs), m);
      expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-4);
    }
    // E[P(complete | next core)] = P(complete | now), integrated over the endpoint square (midpoint rule).
    for (let t = 0; t < 8; t++) {
      const c = core(liveState(1 + rng.int(3)));
      const m = 2 + rng.int(4);
      const N = 400;
      let s = 0;
      for (let i = 0; i < N; i++)
        for (let j = 0; j < N; j++) {
          const iv = { u: (i + 0.5) / N, v: (j + 0.5) / N };
          if (meets(c, iv)) s += completeChance(core([{ u: c.l, v: c.r }, iv]), m - 1);
        }
      expect(s / N ** 2).toBeCloseTo(completeChance(c, m), 2);
    }
  });

  it('the max-win stop never lets a payout exceed MAX_WIN', () => {
    expect(hitsCap(MAX_WIN / 2, 0.6)).toBe(true);
    expect(hitsCap(MAX_WIN / 2, 0.4)).toBe(false);
    expect(hitsCap(1, 1)).toBe(true);
    expect(manifest.maxMultiplier).toBe(MAX_WIN);
  });

  it('simulated RTP matches the manifest under random stopping', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
