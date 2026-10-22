import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  LENGTHS,
  MAX_MULTIPLIER,
  Q,
  RTP,
  chanceIfLands,
  eulerZigzag,
  headline,
  headlineExact,
  integral01,
  prizeFor,
  stepSafe,
  survives,
  upChance,
  upPolyExact,
  winChance,
  type Settings,
} from './math';

const rng = createRng(seededSource(11));
const ALL: Settings[] = LENGTHS.flatMap((n) => [false, true].map((either) => ({ n, either })));

/** A random reachable live state: bars drawn by the real process, stopped early. */
function randomState(s: Settings): number[] {
  for (;;) {
    const bars = [rng.next()];
    const stop = 1 + rng.int(s.n - 1);
    let ok = true;
    while (ok && bars.length < stop) {
      const y = rng.next();
      ok = survives(bars, y, s.either);
      bars.push(y);
    }
    if (ok) return bars;
  }
}

/** Composite Simpson over [a, b]. Endpoints are nudged inside, so a jump at a or b uses its one-sided limit. */
function simpson(f: (y: number) => number, a: number, b: number, N = 2000) {
  if (b <= a) return 0;
  const h = (b - a) / N;
  const eps = 1e-12;
  let s = f(a + eps) + f(b - eps);
  for (let i = 1; i < N; i++) s += f(a + i * h) * (i % 2 ? 4 : 2);
  return (s * h) / 3;
}

describe('Zigzag maths', () => {
  it('André: the headline chance is exactly E_n / n! (Euler zigzag numbers from the boustrophedon)', () => {
    const E = eulerZigzag(12);
    expect(E.map(Number)).toEqual([1, 1, 1, 2, 5, 16, 61, 272, 1385, 7936, 50521, 353792, 2702765]);
    let fact = 1n;
    for (let n = 1; n <= 12; n++) {
      fact *= BigInt(n);
      if (n < 2) continue;
      expect(integral01(upPolyExact(n - 1)).eq(new Q(E[n], fact))).toBe(true);
      // u_m(0) = E_m / m!
      expect(upChance(n, 0)).toBeCloseTo(Number(E[n]) / Number(fact), 14);
    }
    for (const n of LENGTHS) expect(headlineExact({ n, either: true }).eq(headlineExact({ n, either: false }).add(headlineExact({ n, either: false })))).toBe(true);
  });

  it('the polynomials satisfy u_m(x) = ∫ₓ¹ u_{m−1}(1 − y) dy and u_m(1) = 0', () => {
    for (let m = 1; m <= 11; m++) {
      expect(upChance(m, 1)).toBeCloseTo(0, 12);
      for (const x of [0, 0.13, 0.5, 0.77]) expect(simpson((y) => upChance(m - 1, 1 - y), x, 1)).toBeCloseTo(upChance(m, x), 10);
    }
  });

  it('playing to the end fills the board exactly as often as the formula says', () => {
    for (const s of ALL) {
      const rounds = 20000;
      let wins = 0;
      for (let r = 0; r < rounds; r++) {
        const bars = [rng.next()];
        let ok = true;
        while (ok && bars.length < s.n) {
          const y = rng.next();
          ok = survives(bars, y, s.either);
          bars.push(y);
        }
        if (ok) wins++;
      }
      const p = headline(s);
      expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-4);
    }
  });

  it('the live chance from a mid-round state matches a direct simulation', () => {
    for (const s of [{ n: 7, either: false }, { n: 6, either: true }] as Settings[]) {
      for (let t = 0; t < 4; t++) {
        const start = randomState(s);
        const rounds = 20000;
        let wins = 0;
        for (let r = 0; r < rounds; r++) {
          const bars = [...start];
          let ok = true;
          while (ok && bars.length < s.n) {
            const y = rng.next();
            ok = survives(bars, y, s.either);
            bars.push(y);
          }
          if (ok) wins++;
        }
        const p = winChance(start, s);
        expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-4);
      }
    }
  });

  it('each bar is a fair bet: E[cash-out after the next bar] = cash-out now', () => {
    for (const s of ALL) {
      const prize = prizeFor(s);
      // From the start: the first bar is free and uniform.
      expect(simpson((x) => prize * winChance([x], s), 0, 1)).toBeCloseTo(RTP, 9);
      for (let t = 0; t < 10; t++) {
        const bars = randomState(s);
        const x = bars[bars.length - 1];
        const now = prize * winChance(bars, s);
        const after = simpson((y) => prize * chanceIfLands(bars, y, s), 0, x) + simpson((y) => prize * chanceIfLands(bars, y, s), x, 1);
        expect(Math.abs(after - now)).toBeLessThan(1e-9 * Math.max(1, prize));
      }
    }
  });

  it('the green zone on the board is exactly where the next bar survives', () => {
    for (const s of ALL) {
      for (let t = 0; t < 10; t++) {
        const bars = randomState(s);
        const x = bars[bars.length - 1];
        const q = stepSafe(bars, s.either);
        const N = 2000;
        let safe = 0;
        for (let i = 0; i < N; i++) {
          const y = (i + 0.5) / N;
          if (survives(bars, y, s.either)) safe++;
        }
        expect(Math.abs(safe / N - q)).toBeLessThan(1 / N + 1e-12);
        if (bars.length >= 2 || !s.either) {
          const up = survives(bars, Math.min(1, x + 1e-6), s.either);
          // The zone is one side of the last bar: above (1 − x) or below (x).
          expect(q).toBeCloseTo(up ? 1 - x : x, 12);
        }
      }
    }
  });

  it('the max multiplier is the largest prize, and cash-outs never exceed the prize', () => {
    expect(MAX_MULTIPLIER).toBeCloseTo((RTP * 479001600) / 2702765, 9);
    for (const s of ALL) for (let t = 0; t < 10; t++) expect(winChance(randomState(s), s)).toBeLessThanOrEqual(1);
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
