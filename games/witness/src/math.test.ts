import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  BETS,
  MAX_MULTIPLIER,
  RANGE_IXS,
  RTP,
  TESTS,
  allowed,
  candidates,
  chance,
  drawN,
  isPrime,
  passChance,
  passes,
  prize,
  runTest,
  strongLiars,
  weight,
  winWeight,
  wins,
} from './math';

const rng = createRng(seededSource(11));

describe('Witness maths', () => {
  it("Monier's formula matches a brute-force count of strong liars, and Rabin's 1/4 bound holds", () => {
    for (let n = 9; n < 2000; n += 2) {
      if (isPrime(n)) {
        // Every base passes a prime.
        for (let a = 2; a <= Math.min(n - 2, 40); a++) expect(passes(a, n)).toBe(true);
        continue;
      }
      let liars = 0;
      for (let a = 1; a < n; a++) if (passes(a, n)) liars++;
      expect(strongLiars(n)).toBe(liars);
      expect((liars - 2) / (n - 3)).toBeLessThan(0.25);
    }
  });

  it('the exact win chance matches a direct simulation of the draw and the tests', () => {
    for (const range of RANGE_IXS) {
      for (const tests of TESTS) {
        const rounds = 20_000;
        const hits = { prime: 0, composite: 0, fooled: 0 };
        for (let k = 0; k < rounds; k++) {
          const n = drawN(range, rng);
          let all = true;
          for (let t = 0; t < tests && all; t++) all = runTest(n, rng).pass;
          for (const bet of BETS) if (wins(bet, n, all)) hits[bet]++;
        }
        for (const bet of BETS) {
          const p = chance(range, bet, tests, 0);
          const se = Math.sqrt((p * (1 - p)) / rounds);
          expect(Math.abs(hits[bet] / rounds - p)).toBeLessThan(4 * se + 2e-4);
        }
      }
    }
  });

  it('the chance a test passes matches simulation after r passes', () => {
    const range = 0;
    const rounds = 40_000;
    let pass0 = 0;
    let ones = 0;
    let pass1 = 0;
    for (let k = 0; k < rounds; k++) {
      const n = drawN(range, rng);
      if (!runTest(n, rng).pass) continue;
      pass0++;
      ones++;
      if (runTest(n, rng).pass) pass1++;
    }
    const p0 = passChance(range, 0);
    expect(Math.abs(pass0 / rounds - p0)).toBeLessThan(4 * Math.sqrt((p0 * (1 - p0)) / rounds));
    const p1 = passChance(range, 1);
    expect(Math.abs(pass1 / ones - p1)).toBeLessThan(4 * Math.sqrt((p1 * (1 - p1)) / ones));
  });

  it('every test is a fair bet: E[cash-out after] = cash-out before', () => {
    for (const range of RANGE_IXS) {
      for (const bet of BETS) {
        for (const tests of TESTS) {
          const pay = prize({ range, bet, tests });
          expect(pay * chance(range, bet, tests, 0)).toBeCloseTo(RTP, 12);
          for (let r = 0; r < tests; r++) {
            const q = passChance(range, r);
            const caught = bet === 'composite' ? pay : 0;
            const after = q * pay * chance(range, bet, tests, r + 1) + (1 - q) * caught;
            expect(after).toBeCloseTo(pay * chance(range, bet, tests, r), 10);
          }
          // The reveal after T passes: N's posterior decides it.
          const c = candidates(range);
          let total = 0;
          let win = 0;
          for (let i = 0; i < c.n.length; i++) {
            const w = weight(c, i, tests);
            total += w;
            if (wins(bet, c.n[i], true)) win += w;
          }
          expect(win / total).toBeCloseTo(chance(range, bet, tests, tests), 12);
        }
      }
    }
  });

  it('the lit dot area over the total dot area is the live chance', () => {
    for (const range of RANGE_IXS) {
      const c = candidates(range);
      for (const bet of BETS) {
        for (const tests of TESTS) {
          for (let r = 0; r <= tests; r++) {
            let outer = 0;
            let lit = 0;
            for (let i = 0; i < c.n.length; i++) {
              const w = weight(c, i, r);
              const l = winWeight(c, i, bet, tests, r);
              expect(l).toBeLessThanOrEqual(w + 1e-15);
              outer += w;
              lit += l;
            }
            expect(lit / outer).toBeCloseTo(chance(range, bet, tests, r), 12);
          }
        }
      }
    }
  });

  it('simulated RTP matches the manifest under sampled strategies, and payouts stay under the cap', () => {
    for (const range of RANGE_IXS)
      for (const bet of BETS) for (const tests of TESTS) if (allowed(bet, tests)) expect(prize({ range, bet, tests })).toBeLessThanOrEqual(MAX_MULTIPLIER);
    expect(MAX_MULTIPLIER).toBeLessThanOrEqual(manifest.maxMultiplier);
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
