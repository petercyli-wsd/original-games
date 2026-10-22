import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  CUT_MAX,
  CUT_MIN,
  MAX_PRIZE,
  N_COUNT,
  N_MAX,
  N_MIN,
  RTP,
  choose,
  cutAllowed,
  drawSerial,
  drawTop,
  minCut,
  nextBust,
  nextDrawChance,
  openingPrize,
  posterior,
  priorChance,
  relockPrize,
  winChance,
} from './math';

const rng = createRng(seededSource(11));

describe('Serials maths', () => {
  it('the posterior is 1/C(N, j) normalised on [max(10, m), 100]', () => {
    for (const [j, m] of [
      [1, 3],
      [2, 40],
      [4, 9],
      [6, 77],
    ]) {
      const post = posterior(j, m);
      let z = 0;
      for (let n = Math.max(N_MIN, m); n <= N_MAX; n++) z += 1 / choose(n, j);
      for (let n = N_MIN; n <= N_MAX; n++) {
        const want = n < Math.max(N_MIN, m) ? 0 : 1 / choose(n, j) / z;
        expect(post[n - N_MIN]).toBeCloseTo(want, 14);
      }
    }
    expect(choose(100, 6)).toBe(1192052400);
  });

  it('the posterior matches a direct simulation of the raw process (4 SE)', () => {
    // Condition on (j draws, max m) by rejection and count N ≤ X.
    const cases = [
      { j: 2, m: 30, x: 40 },
      { j: 3, m: 55, x: 60 },
      { j: 4, m: 18, x: 22 },
    ];
    for (const { j, m, x } of cases) {
      let kept = 0;
      let wins = 0;
      for (let r = 0; kept < 6000 && r < 3_000_000; r++) {
        const n = drawTop(rng.next());
        if (n < m) continue;
        const drawn: number[] = [];
        for (let i = 0; i < j; i++) drawn.push(drawSerial(n, drawn, rng.next()));
        if (Math.max(...drawn) !== m) continue;
        kept++;
        if (n <= x) wins++;
      }
      const p = winChance(j, m, x);
      expect(kept).toBe(6000);
      expect(Math.abs(wins / kept - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / kept) + 1e-3);
    }
  });

  it('holding to the reveal wins with the prior chance (X − 9) / 91', () => {
    for (const x of [12, 40, 80]) {
      expect(priorChance(x)).toBeCloseTo((x - 9) / 91, 14);
      expect(winChance(0, 0, x)).toBeCloseTo(priorChance(x), 12);
      expect(openingPrize(x) * priorChance(x)).toBeCloseTo(RTP, 12);
    }
  });

  it('the predictive law of the next draw sums to 1', () => {
    for (const drawn of [[5], [50, 7, 21], [99, 1, 2, 3, 60]]) {
      const j = drawn.length;
      const m = Math.max(...drawn);
      let total = 0;
      for (let s = 1; s <= N_MAX; s++) if (!drawn.includes(s)) total += nextDrawChance(j, m, s);
      expect(total).toBeCloseTo(1, 12);
    }
  });

  it('martingale: E[win chance after the next draw] = win chance now, at random states', () => {
    for (let trial = 0; trial < 200; trial++) {
      const n = drawTop(rng.next());
      const j = 1 + rng.int(5);
      const drawn: number[] = [];
      for (let i = 0; i < j; i++) drawn.push(drawSerial(n, drawn, rng.next()));
      const m = Math.max(...drawn);
      const x = Math.max(m, CUT_MIN) + rng.int(CUT_MAX - Math.max(m, CUT_MIN) + 1);
      let e = 0;
      let bust = 0;
      for (let s = 1; s <= N_MAX; s++) {
        if (drawn.includes(s)) continue;
        const p = nextDrawChance(j, m, s);
        e += p * winChance(j + 1, Math.max(m, s), x);
        if (s > x) bust += p;
      }
      expect(e).toBeCloseTo(winChance(j, m, x), 12);
      // The shown next-draw risk is exactly the predictive mass above the cut.
      expect(nextBust(j, m, x)).toBeCloseTo(bust, 12);
    }
  });

  it('the shaded mass left of the cut equals the true win chance at every cut', () => {
    for (const [j, m] of [
      [2, 14],
      [5, 63],
    ]) {
      const post = posterior(j, m);
      for (let x = CUT_MIN; x <= CUT_MAX; x++) {
        let green = 0;
        for (let i = 0; i < N_COUNT; i++) if (N_MIN + i <= x) green += post[i];
        expect(winChance(j, m, x)).toBeCloseTo(x < m ? 0 : green, 12);
      }
    }
  });

  it('moving the cut keeps the cash-out and never lifts a prize above the cap', () => {
    for (let trial = 0; trial < 200; trial++) {
      const j = 1 + rng.int(5);
      const n = drawTop(rng.next());
      const drawn: number[] = [];
      for (let i = 0; i < j; i++) drawn.push(drawSerial(n, drawn, rng.next()));
      const m = Math.max(...drawn);
      if (m > CUT_MAX) continue; // a serial of 100 has already lost every cut
      const cash = 0.05 + rng.next() * 60;
      const lo = minCut(cash, j, m);
      for (let x = lo; x <= CUT_MAX; x++) {
        expect(cutAllowed(cash, j, m, x)).toBe(true);
        const prize = relockPrize(cash, j, m, x);
        expect(prize).toBeLessThanOrEqual(MAX_PRIZE + 1e-9);
        expect(prize * winChance(j, m, x)).toBeCloseTo(cash, 9);
      }
      if (lo > Math.max(m, CUT_MIN)) expect(cutAllowed(cash, j, m, lo - 1)).toBe(false);
    }
    expect(openingPrize(CUT_MIN)).toBeLessThan(MAX_PRIZE);
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
