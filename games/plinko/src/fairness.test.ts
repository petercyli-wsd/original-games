// Fairness audit: can any way of playing Plinko beat the RTP?
//
// Plinko has no mid-round decision. Each ball is one bet: resolveDrop() draws
// the whole path (`rows` fair bounces, right iff rng.next() < ½) the moment the
// stake is accepted (tickets.ts draws inside place()), and the ball settles at
// that table value on landing or on unmount. Rows and risk are locked while any
// ball is in flight or Auto runs, and each ball's path and pay come from the
// same (rows, risk) snapshot. So the tester's rule (a) and take-profit (b)
// have nothing to act on: they collapse to (c), one drop at the chosen table.
// The only levers are between balls: which table, how much to stake, when to
// stop, i.e. betting systems on i.i.d. bets, each worth exactly RTP per unit.
//
// Checks:
//  - Exact: every one of the 27 tables pays Σ C(n,k)·mₖ / 2ⁿ = RTP (rationals in
//    BigInt, plus the float table the game settles with), and E[pay | path so
//    far] after every prefix of bounces averages back to RTP (the drop's
//    value is a martingale over its bounces, so even a mid-flight settle at the
//    drawn result is fair).
//  - The bounce: right iff u < ½ (u = ½ goes left), P(right) = ½ exactly on the
//    rng's grid; the bucket frequencies at 16 rows match C(16,k)/2¹⁶ (4.5 SE each).
//  - Strategies per eval config: (c) one drop at a sampled table, as the eval
//    does; (d) the strongest table/stake play: chase the highest-variance table
//    after a loss and drop to the lowest after a win, with a doubling stake
//    progression capped at 2⁶, scored as return per unit staked.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { MAX_MULTIPLIER, RISKS, ROWS, RTP, binom, plateauFraction, plateauOf, resolveDrop, tableFor, type Risk } from './math';

/** Rounds per strategy run; the audit's 200k run sets FAIRNESS_ROUNDS=200000. */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 40_000);

const ALL = RISKS.flatMap((risk) => ROWS.map((rows) => ({ rows, risk })));

/** E[pay | k rights in the first j bounces], exactly over the remaining bounces. */
function condValue(rows: number, risk: Risk, j: number, k: number): number {
  const t = tableFor(rows, risk);
  const left = rows - j;
  let v = 0;
  for (let x = 0; x <= left; x++) v += (binom(left, x) / 2 ** left) * t.mults[k + x];
  return v;
}

function mcStaked(play: (rng: Rng) => { pay: number; stake: number }, rounds: number, seed: number) {
  // Ratio estimator Σpay / Σstake with a delta-method SE.
  const rng = createRng(seededSource(seed));
  let P = 0;
  let S = 0;
  const xs: { pay: number; stake: number }[] = [];
  let max = 0;
  for (let i = 0; i < rounds; i++) {
    const r = play(rng);
    P += r.pay;
    S += r.stake;
    xs.push(r);
    max = Math.max(max, r.pay / r.stake);
  }
  const ratio = P / S;
  const meanS = S / rounds;
  let v = 0;
  for (const r of xs) v += (r.pay - ratio * r.stake) ** 2;
  return { mean: ratio, se: Math.sqrt(v / rounds) / meanS / Math.sqrt(rounds), max };
}

describe('Plinko fairness', () => {
  it('every table pays exactly RTP: Σ C(n,k)·mₖ = 0.99·2ⁿ in exact rationals, and the float table the game settles with', () => {
    for (const { rows, risk } of ALL) {
      const t = tableFor(rows, risk);
      const { num, den } = plateauFraction(rows, risk);
      const plateau = new Set(plateauOf(rows, risk));
      // Σ over buckets, scaled by 100·den so the plateau term num/den is an integer.
      let sum = 0n;
      for (let k = 0; k <= rows; k++) {
        const c = BigInt(binom(rows, k));
        sum += plateau.has(k) ? c * BigInt(num) * 100n : c * BigInt(Math.round(t.mults[k] * 100)) * BigInt(den);
      }
      expect(sum).toBe(99n * 2n ** BigInt(rows) * BigInt(den));
      expect(Math.abs(t.mults.reduce((s, m, k) => s + m * t.probs[k], 0) - RTP)).toBeLessThan(1e-12);
      expect(t.max).toBeLessThanOrEqual(MAX_MULTIPLIER);
    }
  });

  it('martingale over the bounces: E[pay | path so far] averages back to RTP after every prefix, all 27 tables', () => {
    let states = 0;
    for (const { rows, risk } of ALL) {
      expect(condValue(rows, risk, 0, 0)).toBeCloseTo(RTP, 12);
      for (let j = 0; j < rows; j++)
        for (let k = 0; k <= j; k++) {
          const now = condValue(rows, risk, j, k);
          const next = 0.5 * condValue(rows, risk, j + 1, k + 1) + 0.5 * condValue(rows, risk, j + 1, k);
          expect(Math.abs(next - now)).toBeLessThan(1e-9 * Math.max(1, now));
          states++;
        }
    }
    expect(states).toBeGreaterThanOrEqual(30);
  });

  it('a bounce goes right iff u < ½ (u = ½ goes left), and 16-row buckets match C(16,k)/2¹⁶', () => {
    const at = (u: number) => resolveDrop(() => u, 8, 'low').bucket;
    expect(at(0.5)).toBe(0);
    expect(at(0.5 - 2 ** -53)).toBe(8);
    expect(at(0)).toBe(8);
    const rng = createRng(seededSource(9501));
    const n = 16;
    const N = 100_000;
    const counts = new Array(n + 1).fill(0);
    for (let i = 0; i < N; i++) counts[resolveDrop(() => rng.next(), n, 'high').bucket]++;
    for (let k = 0; k <= n; k++) {
      const p = binom(n, k) / 2 ** n;
      expect(Math.abs(counts[k] / N - p)).toBeLessThan(4.5 * Math.sqrt((p * (1 - p)) / N) + 1e-12);
    }
  });

  it('strategies on every eval config return RTP per unit staked within 4 SE, never above the max', () => {
    // (a) and (b) have no in-round decision to act on and are the same as (c).
    const rows: string[] = [];
    evalSpec.configs.forEach(({ label, params }, ci) => {
      const tables = params.risks.flatMap((risk) => params.rows.map((n) => tableFor(n, risk)));
      const wildest = tables.reduce((a, b) => (b.stdDev > a.stdDev ? b : a));
      const calmest = tables.reduce((a, b) => (b.stdDev < a.stdDev ? b : a));
      const c = mcStaked(
        (rng) => {
          const risk = params.risks[rng.int(params.risks.length)];
          const n = params.rows[rng.int(params.rows.length)];
          return { pay: resolveDrop(() => rng.next(), n, risk).multiplier, stake: 1 };
        },
        ROUNDS,
        9600 + ci,
      );
      // (d) a betting system: after a loss double the stake (cap 64) and switch to the wildest table; after a win reset to 1 on the calmest.
      let stake = 1;
      let t = calmest;
      const d = mcStaked(
        (rng) => {
          const m = resolveDrop(() => rng.next(), t.rows, t.risk).multiplier;
          const out = { pay: stake * m, stake };
          if (m < 1) {
            stake = Math.min(64, stake * 2);
            t = wildest;
          } else {
            stake = 1;
            t = calmest;
          }
          return out;
        },
        ROUNDS,
        9700 + ci,
      );
      for (const [name, res] of [
        ['(c) one drop, sampled table', c],
        ['(d) chase losses: double + wildest table', d],
      ] as const) {
        rows.push(`${label.padEnd(34)} ${name.padEnd(42)} ${(res.mean * 100).toFixed(2)}% ± ${(res.se * 100).toFixed(2)}%  max ${res.max.toFixed(1)}×`);
        expect(Math.abs(res.mean - RTP)).toBeLessThan(4 * res.se + 1e-12);
        expect(res.max).toBeLessThanOrEqual(MAX_MULTIPLIER);
      }
    });
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
