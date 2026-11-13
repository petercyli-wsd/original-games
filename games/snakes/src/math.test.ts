import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  CELL,
  DIFFICULTIES,
  MAX_MULTIPLIER,
  MAX_ROLLS,
  MAX_WIN,
  RTP,
  TABLES,
  canRoll,
  drawDice,
  exactRuleValue,
  factorAt,
  factorFor,
  maxFactor,
  multiplierCount,
  pitChance,
  pitCount,
  resolveRoll,
  safeWays,
  survival,
  tileOf,
  weightedSum,
  ways,
} from './math';
import { runAutoRound } from './round';

const rng = createRng(seededSource(11));

describe('Snakes tables (match the original game)', () => {
  it('Start plus 11 tiles; 1/3/5/7/9 snakes and 10/8/6/4/2 multiplier tiles', () => {
    expect(CELL).toHaveLength(12);
    expect(DIFFICULTIES.map(pitCount)).toEqual([1, 3, 5, 7, 9]);
    expect(DIFFICULTIES.map(multiplierCount)).toEqual([10, 8, 6, 4, 2]);
  });

  it('published tables, value for value, symmetric about 7', () => {
    expect(TABLES).toEqual({
      easy: [200, 130, 120, 110, 108, 0],
      medium: [400, 220, 160, 120, 0, 0],
      hard: [750, 300, 150, 0, 0, 0],
      expert: [1000, 400, 0, 0, 0, 0],
      master: [1800, 0, 0, 0, 0, 0],
    });
    for (const d of DIFFICULTIES) for (let s = 2; s <= 12; s++) expect(factorFor(d, s)).toBe(factorFor(d, 14 - s));
  });

  it('every table has an expected factor of exactly 1: sum of ways(s) x f(s) = 3600 in integers', () => {
    for (const d of DIFFICULTIES) {
      expect(weightedSum(d)).toBe(3600);
      let e = 0;
      for (let s = 2; s <= 12; s++) e += (ways(s) * factorFor(d, s)) / 36;
      expect(e).toBeCloseTo(1, 12);
    }
  });

  it('safe chance per roll is 30, 20, 12, 6, 2 in 36 (what the bar shows is the true risk)', () => {
    expect(DIFFICULTIES.map(safeWays)).toEqual([30, 20, 12, 6, 2]);
    for (const d of DIFFICULTIES) {
      let pit = 0;
      for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) if (resolveRoll(d, 1, a, b).pit) pit += 1 / 36;
      expect(pit).toBeCloseTo(pitChance(d), 12);
    }
  });

  it('tile j holds the factor of total j + 1; tile 0 is Start', () => {
    expect(tileOf(2)).toBe(1);
    expect(tileOf(12)).toBe(11);
    for (const d of DIFFICULTIES) for (let s = 2; s <= 12; s++) expect(factorAt(d, tileOf(s))).toBe(factorFor(d, s));
  });

  it('harder difficulties bust more and pay more at the top', () => {
    for (let i = 1; i < DIFFICULTIES.length; i++) {
      const [a, b] = [DIFFICULTIES[i - 1], DIFFICULTIES[i]];
      expect(pitChance(b)).toBeGreaterThan(pitChance(a));
      expect(maxFactor(b)).toBeGreaterThan(maxFactor(a));
    }
  });
});

describe('Snakes maths', () => {
  it('martingale: at random reachable states, E[value after one roll] = value now', () => {
    for (const d of DIFFICULTIES) {
      for (let t = 0; t < 40; t++) {
        const cash = RTP * (0.5 + 3 * rng.next());
        let e = 0;
        for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) e += resolveRoll(d, cash, a, b).cash / 36;
        expect(e).toBeCloseTo(cash, 10);
      }
    }
  });

  it('exact RTP by enumeration of every dice path: every fixed-roll and target rule returns 99%', () => {
    for (const d of DIFFICULTIES) {
      for (let rolls = 1; rolls <= MAX_ROLLS; rolls++) expect(exactRuleValue(d, { rolls, target: 0 })).toBeCloseTo(RTP, 12);
      for (const target of [1.2, 2, 5, 50]) expect(exactRuleValue(d, { rolls: MAX_ROLLS, target })).toBeCloseTo(RTP, 12);
    }
  });

  it('five rolls cap the round: the best payout is 0.99 x 18^5 and the cap never binds', () => {
    expect(MAX_MULTIPLIER).toBeCloseTo(RTP * 18 ** 5, 2);
    expect(MAX_MULTIPLIER).toBeLessThanOrEqual(MAX_WIN);
    for (const d of DIFFICULTIES) expect(canRoll(d, RTP * maxFactor(d) ** (MAX_ROLLS - 1))).toBe(true);
    expect(exactRuleValue('master', { rolls: 9, target: 0 })).toBeCloseTo(RTP, 12);
  });

  it('the raw dice process busts within n rolls as often as 1 - (safe/36)^n', () => {
    for (const d of DIFFICULTIES) {
      const n = 3;
      const rounds = 40_000;
      let alive = 0;
      for (let r = 0; r < rounds; r++) {
        let ok = true;
        for (let k = 0; k < n && ok; k++) ok = !resolveRoll(d, 1, ...drawDice(rng)).pit;
        if (ok) alive++;
      }
      const p = survival(d, n);
      expect(Math.abs(alive / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-9);
    }
  });
});

describe('Snakes auto-bet', () => {
  it('play resolves once per round, with the settled multiplier, in at most 5 rolls', async () => {
    for (const d of DIFFICULTIES) {
      for (let t = 0; t < 200; t++) {
        let settles = 0;
        let settled = -1;
        let animations = 0;
        const result = await runAutoRound({
          d,
          rule: { rolls: 1 + rng.int(9), target: rng.next() < 0.5 ? 0 : 1 + 4 * rng.next() },
          dice: () => drawDice(rng),
          animate: async () => {
            animations++;
            return true;
          },
          settle: (m) => {
            settles++;
            settled = m;
          },
        });
        expect(settles).toBe(1);
        expect(result).toBe(settled);
        expect(animations).toBeGreaterThanOrEqual(1);
        expect(animations).toBeLessThanOrEqual(MAX_ROLLS);
      }
    }
  });

  it('an interrupted round resolves null without settling', async () => {
    let settles = 0;
    const result = await runAutoRound({ d: 'easy', rule: { rolls: 5, target: 0 }, dice: () => [1, 1], animate: async () => false, settle: () => settles++ });
    expect(result).toBeNull();
    expect(settles).toBe(0);
  });

  it('auto with a fixed roll count returns 99% in simulation', async () => {
    const rounds = 30_000;
    let sum = 0;
    let sumSq = 0;
    for (let r = 0; r < rounds; r++) {
      const m = (await runAutoRound({ d: 'medium', rule: { rolls: 3, target: 0 }, dice: () => drawDice(rng), animate: async () => true, settle: () => {} }))!;
      sum += m;
      sumSq += m * m;
    }
    const mean = sum / rounds;
    const se = Math.sqrt((sumSq / rounds - mean ** 2) / rounds);
    expect(Math.abs(mean - RTP)).toBeLessThan(4 * se);
  });
});

describe('Snakes eval', () => {
  it('simulated RTP matches the manifest, and the max is within maxMultiplier', () => {
    expect(manifest.maxMultiplier).toBe(MAX_MULTIPLIER);
    for (const r of runEval(evalSpec, { rounds: 60_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
