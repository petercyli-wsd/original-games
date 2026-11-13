// Fairness audit: can any way of playing Snakes beat the RTP?
//
// Each roll draws two dice (rng.int(6) each), lands on the tile for their
// total and multiplies the value by its factor (0 on a pit). Rolls are
// independent. The only decision is at a checkpoint: cash out, or roll again,
// for at most 5 rolls. The difficulty is locked once the stake is placed and
// the first roll is part of the bet.
//
// Binding checks are exact:
//   - rng.int(6) on the 2^32 RNG grid: every face within 2^-32 of 1/6;
//   - the martingale step through the real resolveRoll() (all 36 dice
//     outcomes) at 30+ states per difficulty, for every roll count 0-4;
//   - the best and the worst stopping strategy over every dice path (DP over
//     roll count x exponent vector of the safe factors): both are worth RTP.
// Monte Carlo then plays the hostile strategies and the eval mix on the real
// dice, and the async Auto runner is checked against the manual maths.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  DIFFICULTIES,
  MAX_ROLLS,
  RTP,
  TABLES,
  canRoll,
  drawDice,
  exactRuleValue,
  factorFor,
  pitChance,
  resolveRoll,
  ways,
  type Difficulty,
} from './math';
import { runAutoRound } from './round';

const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 100_000);
const GRID = 2 ** 32;

function mc(play: (rng: Rng) => number, rounds: number, seed: number) {
  const rng = createRng(seededSource(seed));
  let s = 0;
  let s2 = 0;
  let max = 0;
  for (let i = 0; i < rounds; i++) {
    const m = play(rng);
    s += m;
    s2 += m * m;
    if (m > max) max = m;
  }
  const mean = s / rounds;
  return { rtp: mean, se: Math.sqrt(Math.max(0, s2 / rounds - mean * mean) / rounds), max };
}

/** true = cash out at this checkpoint (after `done` >= 1 rolls). */
type Policy = (d: Difficulty, cash: number, done: number, lastFactor: number) => boolean;

/** One manual round as Game.tsx plays it: first roll is part of the bet; after roll 5 the round cashes out. */
function playRound(d: Difficulty, rng: Rng, cashOut: Policy): number {
  let cash = RTP;
  let last = 1;
  for (let done = 0; ; ) {
    if (done >= MAX_ROLLS || (done > 0 && (!canRoll(d, cash) || cashOut(d, cash, done, last)))) return cash;
    const r = resolveRoll(d, cash, ...drawDice(rng));
    done++;
    if (r.pit) return 0;
    cash = r.cash;
    last = r.factor;
  }
}

const POLICIES: Record<string, Policy> = {
  '(a) roll iff P(safe) >= 0.8': (d) => 1 - pitChance(d) < 0.8,
  '(b) cash once V > 1': (_d, cash) => cash > 1,
  '(c) play to the end': () => false,
  '(d1) cash after a weak tile / at 3x': (_d, cash, _n, last) => last < 1.2 || cash >= 3,
  '(d2) Auto 3 rolls': (_d, _c, done) => done >= 3,
  '(d3) Auto target 2x': (_d, cash) => cash >= 2 - 1e-9,
};

const safeFactors = (d: Difficulty) => [...new Set(TABLES[d].filter((v) => v > 0))].map((v) => v / 100);

/** Exact best and worst value over every stopping strategy: DP over (rolls done, exponent vector). */
function extremes(d: Difficulty) {
  const fs = safeFactors(d);
  const memo = new Map<string, [number, number]>();
  const go = (cash: number, done: number, exps: number[]): [number, number] => {
    if (done >= MAX_ROLLS) return [cash, cash];
    const key = `${done}|${exps.join(',')}`;
    const hit = memo.get(key);
    if (hit) return hit;
    let hi = 0;
    let lo = 0;
    for (let s = 2; s <= 12; s++) {
      const r = resolveRoll(d, cash, s - 1 > 6 ? 6 : 1, s - 1 > 6 ? s - 6 : s - 1);
      if (r.pit) continue;
      const next = exps.slice();
      next[fs.indexOf(r.factor)]++;
      const [h, l] = go(r.cash, done + 1, next);
      hi += (h * ways(s)) / 36;
      lo += (l * ways(s)) / 36;
    }
    const out: [number, number] = done > 0 ? [Math.max(cash, hi), Math.min(cash, lo)] : [hi, lo];
    memo.set(key, out);
    return out;
  };
  const [sup, inf] = go(RTP, 0, fs.map(() => 0));
  return { sup, inf, states: memo.size };
}

describe('Snakes fairness', () => {
  it('rng.int(6) on the 2^32 RNG grid: every face within 2^-32 of 1/6', () => {
    for (let k = 0; k < 6; k++) {
      const lo = Math.ceil((k * GRID) / 6);
      const hi = Math.ceil(((k + 1) * GRID) / 6);
      const at = (j: number) => drawDice(createRng(() => j / GRID))[0];
      expect(at(lo)).toBe(k + 1);
      expect(at(hi - 1)).toBe(k + 1);
      expect(Math.abs((hi - lo) / GRID - 1 / 6)).toBeLessThanOrEqual(1 / GRID);
    }
  });

  it('martingale through the real resolveRoll() at 30+ reachable states per difficulty, every roll count 0-4', () => {
    const rng = createRng(seededSource(31));
    for (const d of DIFFICULTIES) {
      let n = 0;
      const seen = new Set<number>();
      for (let tries = 0; n < 40 && tries < 200_000; tries++) {
        // Reachable states: dice conditioned on a safe roll, for 0-4 rolls done (every roll count in turn).
        const stopAt = n % MAX_ROLLS;
        let cash = RTP;
        for (let done = 0; done < stopAt; done++) {
          let r = resolveRoll(d, cash, ...drawDice(rng));
          while (r.pit) r = resolveRoll(d, cash, ...drawDice(rng));
          cash = r.cash;
        }
        let e = 0;
        for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) e += resolveRoll(d, cash, a, b).cash / 36;
        expect(Math.abs(e - cash)).toBeLessThan(1e-12 * Math.max(1, cash));
        seen.add(stopAt);
        n++;
      }
      expect(n).toBeGreaterThanOrEqual(30);
      expect(seen.size).toBe(MAX_ROLLS);
    }
  });

  it('exact: the best and the worst stopping strategy are both worth RTP on every difficulty', () => {
    for (const d of DIFFICULTIES) {
      const { sup, inf } = extremes(d);
      expect(Math.abs(sup - RTP)).toBeLessThan(1e-9);
      expect(Math.abs(inf - RTP)).toBeLessThan(1e-9);
    }
  });

  it('exact: every Auto rule (1-5 rolls, with and without a target) is worth RTP', () => {
    for (const d of DIFFICULTIES)
      for (let rolls = 1; rolls <= MAX_ROLLS; rolls++)
        for (const target of [0, 1.5, 4]) expect(Math.abs(exactRuleValue(d, { rolls, target }) - RTP)).toBeLessThan(1e-9);
  });

  it('the async Auto runner pays exactly what the same rule pays in the manual maths, roll for roll', async () => {
    for (const d of DIFFICULTIES) {
      const a = createRng(seededSource(600));
      const b = createRng(seededSource(600));
      for (let i = 0; i < 2_000; i++) {
        const rule = { rolls: 1 + (i % 5), target: i % 3 === 0 ? 2 : 0 };
        let paid = -1;
        const got = await runAutoRound({ d, rule, dice: () => drawDice(a), animate: async () => true, settle: (m) => (paid = m) });
        const want = playRound(d, b, (_d, cash, done) => done >= rule.rolls || (rule.target > 0 && cash >= rule.target - 1e-9));
        expect(got).toBe(want);
        expect(paid).toBe(want);
      }
    }
  });

  it('strategies on the real dice for every eval config, plus the eval mix: RTP within 4 SE', () => {
    evalSpec.configs.forEach(({ params }, ci) => {
      Object.entries(POLICIES).forEach(([, policy], pi) => {
        const r = mc((rng) => playRound(params.d, rng, policy), ROUNDS, 3100 + 10 * ci + pi);
        // A run so rare that no round in the sample survives (Master, play to the end) has no estimate; the exact tests bind there.
        if (r.rtp > 0) expect(Math.abs(r.rtp - RTP)).toBeLessThan(4 * r.se + 1e-9);
        expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
      });
      const e = mc((rng) => evalSpec.playRound(params, rng).multiplier, ROUNDS, 3900 + ci);
      expect(Math.abs(e.rtp - RTP)).toBeLessThan(4 * e.se);
    });
    expect(factorFor('master', 2)).toBe(18);
  });
});
