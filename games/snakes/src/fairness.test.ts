// Fairness audit: can any way of playing Snakes beat the RTP?
//
// Each roll draws two dice (rng.int(6) each), moves the token by the sum and
// multiplies the value by the landed square's factor (0 on a snake). The only
// decision is at a checkpoint: cash out at the value, or roll again. The
// difficulty is locked once the stake is placed, the first roll is part of
// the bet, and a roll that could pass MAX_WIN is never offered (auto-cash).
//
// Binding checks are exact:
//   - rng.int(6) on the 2^32 RNG grid: every face within 2^-32 of 1/6;
//   - the martingale step through the real `resolveRoll()` (all 36 dice
//     outcomes) from every square of every board, and at ≥ 30 reachable
//     states per board including states at the cap;
//   - the best and the worst stopping strategy over every dice path (dynamic
//     programming over square × exponent vector, which the value is a
//     function of): both are worth exactly RTP. Unbounded for every board
//     but Easy (its 0.90 square lets a round wander forever); Easy is solved
//     for every strategy that stops within 20 rolls (12 in the quick run, where
//     Medium is also cut at 20 rolls; the heavy run solves Medium unbounded).
// Monte Carlo then plays (a)–(d) and the eval mix on the real dice, and the
// async Auto runner is checked to pay exactly what the manual maths pays.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  DIFFICULTIES,
  MAX_WIN,
  PATTERNS,
  RTP,
  SQUARES,
  canRoll,
  drawDice,
  exactRuleValue,
  factorAt,
  maxFactor,
  resolveRoll,
  snakeChance,
  ways,
  type Difficulty,
} from './math';
import { runAutoRound } from './round';

const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 100_000);
const GRID = 2 ** 32;

/** RTP = mean payout per unit stake, with its standard error. */
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

/** true = cash out at this checkpoint (after `done` ≥ 1 rolls). */
type Policy = (d: Difficulty, cash: number, done: number, pos: number) => boolean;

/** One manual round as Game.tsx plays it: the first roll is part of the bet; a roll past MAX_WIN is never offered. */
function playRound(d: Difficulty, rng: Rng, cashOut: Policy): number {
  let pos = 0;
  let cash = RTP;
  for (let done = 0; ; ) {
    if (done > 0 && (!canRoll(d, cash) || cashOut(d, cash, done, pos))) return cash;
    const [a, b] = drawDice(rng);
    const r = resolveRoll(d, pos, cash, a, b);
    done++;
    if (r.snake) return 0;
    pos = r.to;
    cash = r.cash;
  }
}

const POLICIES: Record<string, Policy> = {
  // (a) Roll only when the roll is safe with chance ≥ 0.8 (Easy: 5/6, so it rolls to a bite or the cap; the others cash after the first roll).
  '(a) roll iff P(safe) ≥ 0.8': (d) => 1 - snakeChance(d) < 0.8,
  '(b) cash once V > 1': (_d, cash) => cash > 1,
  '(c) play to the end': () => false,
  // (d1) Ride only good streaks: cash the first time a roll lands on a factor below 1.2 (or when ahead 3×).
  '(d1) cash after a weak square / at 3×': (d, cash, _n, pos) => factorAt(d, pos) < 1.2 || cash >= 3,
  // (d2) Auto: 3 rolls, then cash.
  '(d2) Auto 3 rolls': (_d, _c, done) => done >= 3,
  // (d3) Auto target 2×, at most 10 rolls.
  '(d3) Auto target 2×': (_d, cash, done) => cash >= 2 - 1e-9 || done >= 10,
};

/** Distinct safe factors of a board, and the squares that hold each (opposite pairs). */
function factorsOf(d: Difficulty) {
  const fs = [...new Set(PATTERNS[d].filter((v) => v > 0))].map((v) => v / 100);
  return fs;
}

/**
 * Exact best and worst value over every stopping strategy, by memoised DP over
 * (square, exponent vector of the safe factors). The value at a state is
 * RTP · Π f_i^e_i, computed the way the game computes it (one multiplication
 * per roll) along the path that first reaches the state. `horizon` forces a
 * cash-out after that many rolls (Infinity = none).
 */
function extremes(d: Difficulty, horizon: number) {
  const fs = factorsOf(d);
  const memo = new Map<string, [number, number]>();
  const go = (pos: number, cash: number, done: number, exps: number[]): [number, number] => {
    if (done > 0 && (!canRoll(d, cash) || done >= horizon)) return [cash, cash];
    const key = `${pos}|${exps.join(',')}`;
    const hit = memo.get(key);
    if (hit) return hit;
    let hi = 0;
    let lo = 0;
    // resolveRoll depends on the dice only through their sum: one call per sum, weighted by its ways.
    for (let s = 2; s <= 12; s++) {
      const r = resolveRoll(d, pos, cash, s - 1 > 6 ? 6 : 1, s - 1 > 6 ? s - 6 : s - 1);
      if (r.snake) continue;
      const next = exps.slice();
      next[fs.indexOf(r.factor)]++;
      const [h, l] = go(r.to, r.cash, done + 1, next);
      hi += (h * ways(s)) / 36;
      lo += (l * ways(s)) / 36;
    }
    const out: [number, number] = done > 0 ? [Math.max(cash, hi), Math.min(cash, lo)] : [hi, lo];
    memo.set(key, out);
    return out;
  };
  const [sup, inf] = go(0, RTP, 0, fs.map(() => 0));
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

  it('martingale through the real resolveRoll(): from every square of every board, and at ≥ 30 reachable states per board (incl. the cap)', () => {
    for (const d of DIFFICULTIES)
      for (let p = 0; p < SQUARES; p++) {
        let e = 0;
        for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) e += resolveRoll(d, p, 1, a, b).cash / 36;
        expect(Math.abs(e - 1)).toBeLessThan(1e-12);
      }
    const rng = createRng(seededSource(31));
    for (const d of DIFFICULTIES) {
      let n = 0;
      let capped = 0;
      for (let tries = 0; n < 40 && tries < 200_000; tries++) {
        let pos = 0;
        let cash = RTP;
        const stopAt = 1 + rng.int(60);
        let alive = true;
        for (let done = 0; done < stopAt; done++) {
          if (done > 0 && !canRoll(d, cash)) break;
          const r = resolveRoll(d, pos, cash, ...drawDice(rng));
          if (r.snake) {
            alive = false;
            break;
          }
          pos = r.to;
          cash = r.cash;
        }
        if (!alive) continue;
        if (!canRoll(d, cash)) {
          // At the cap the round auto-cashes; the value is within MAX_WIN.
          expect(cash).toBeLessThanOrEqual(MAX_WIN);
          capped++;
          continue;
        }
        let e = 0;
        for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) e += resolveRoll(d, pos, cash, a, b).cash / 36;
        expect(Math.abs(e - cash)).toBeLessThan(1e-12 * Math.max(1, cash));
        // The best square stays within the cap whenever a roll is offered.
        expect(cash * maxFactor(d)).toBeLessThanOrEqual(MAX_WIN);
        n++;
      }
      expect(n).toBeGreaterThanOrEqual(30);
      if (d === 'master' || d === 'expert') expect(capped).toBeGreaterThan(0);
    }
  });

  it('exact: the best and the worst stopping strategy are both worth RTP on every board', () => {
    for (const d of DIFFICULTIES) {
      const t0 = performance.now();
      // Easy needs a horizon (its 0.90 square lets a round run forever). The heavy run
      // (FAIRNESS_ROUNDS set) solves Medium unbounded (~400k states, ~4 s) and Easy to 20 rolls.
      const heavy = !!import.meta.env.FAIRNESS_ROUNDS;
      const horizon = d === 'easy' ? (heavy ? 20 : 12) : d === 'medium' && !heavy ? 20 : Infinity;
      const { sup, inf, states } = extremes(d, horizon);
      if (import.meta.env.FAIRNESS_ROUNDS) console.log(`${d}: sup ${sup} inf ${inf} over ${states} states in ${(performance.now() - t0).toFixed(0)} ms`);
      expect(Math.abs(sup - RTP)).toBeLessThan(1e-9);
      expect(Math.abs(inf - RTP)).toBeLessThan(1e-9);
    }
    expect(MAX_WIN).toBeLessThanOrEqual(manifest.maxMultiplier);
  });

  it('exact: every Auto rule (1–10 rolls, with and without a target) is worth RTP', () => {
    for (const d of DIFFICULTIES)
      for (const rolls of [1, 2, 3])
        for (const target of [0, 1.5, 4]) expect(Math.abs(exactRuleValue(d, { rolls, target }) - RTP)).toBeLessThan(1e-9);
  });

  it('the async Auto runner pays exactly what the same rule pays in the manual maths, roll for roll', async () => {
    for (const d of DIFFICULTIES) {
      const a = createRng(seededSource(600));
      const b = createRng(seededSource(600));
      for (let i = 0; i < 2_000; i++) {
        const rule = { rolls: 1 + (i % 10), target: i % 3 === 0 ? 2 : 0 };
        let paid = -1;
        const got = await runAutoRound({ d, rule, dice: () => drawDice(a), animate: async () => true, settle: (m) => (paid = m) });
        const want = playRound(d, b, (_d, cash, done) => done >= rule.rolls || (rule.target > 0 && cash >= rule.target - 1e-9));
        expect(got).toBe(want);
        expect(paid).toBe(want);
      }
    }
  });

  it('strategies: (a)–(d) on the real dice for every eval config, plus the eval mix: RTP within 4 SE', () => {
    const rows: string[] = [];
    evalSpec.configs.forEach(({ label, params }, ci) => {
      Object.entries(POLICIES).forEach(([name, policy], pi) => {
        const r = mc((rng) => playRound(params.d, rng, policy), ROUNDS, 3100 + 10 * ci + pi);
        rows.push(`${label.padEnd(28)} ${name.padEnd(36)} ${(r.rtp * 100).toFixed(3)}% ± ${(r.se * 100).toFixed(3)}%  max ${r.max.toFixed(2)}`);
        expect(Math.abs(r.rtp - RTP)).toBeLessThan(4 * r.se + 1e-9);
        expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
      });
      const e = mc((rng) => evalSpec.playRound(params, rng).multiplier, ROUNDS, 3900 + ci);
      rows.push(`${label.padEnd(28)} ${'eval mix'.padEnd(36)} ${(e.rtp * 100).toFixed(3)}% ± ${(e.se * 100).toFixed(3)}%`);
      expect(Math.abs(e.rtp - RTP)).toBeLessThan(4 * e.se);
    });
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
