import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec, { deepest } from './eval';
import manifest from './manifest';
import {
  DIFFICULTIES,
  MAX_WIN,
  PATTERNS,
  RTP,
  SQUARES,
  board,
  canRoll,
  drawDice,
  exactRuleValue,
  expectedFactorFrom,
  landingWays,
  maxFactor,
  resolveRoll,
  safeFactors,
  snakeChance,
  snakeChanceFrom,
  snakeCount,
  survival,
} from './math';
import { runAutoRound } from './round';

const rng = createRng(seededSource(11));

describe('Snakes boards', () => {
  it('every pattern averages exactly 1 (hundredths sum to 600), and opposite squares match', () => {
    for (const d of DIFFICULTIES) {
      expect(PATTERNS[d]).toHaveLength(6);
      expect(PATTERNS[d].reduce((a, b) => a + b, 0)).toBe(600);
      const b = board(d);
      for (let j = 0; j < 6; j++) expect(b[j]).toBe(b[j + 6]);
      expect(b[0]).toBeGreaterThan(0); // Start is always safe
    }
  });

  it('difficulty sets the snake count: 2, 4, 6, 8, 10', () => {
    expect(DIFFICULTIES.map(snakeCount)).toEqual([2, 4, 6, 8, 10]);
  });

  it('harder boards bust more often and pay more on their best and average safe square', () => {
    for (let i = 1; i < DIFFICULTIES.length; i++) {
      const [a, b] = [DIFFICULTIES[i - 1], DIFFICULTIES[i]];
      expect(snakeChance(b)).toBeGreaterThan(snakeChance(a));
      expect(maxFactor(b)).toBeGreaterThan(maxFactor(a));
      const avg = (d: (typeof DIFFICULTIES)[number]) => safeFactors(d).reduce((x, y) => x + y, 0) / safeFactors(d).length;
      expect(avg(b)).toBeGreaterThan(avg(a));
    }
  });
});

describe('Snakes maths', () => {
  it('landing odds: 36 ways from every square, never the next square, opposite squares always total 6 ways', () => {
    for (let p = 0; p < SQUARES; p++) {
      let total = 0;
      for (let j = 0; j < SQUARES; j++) total += landingWays(p, j);
      expect(total).toBe(36);
      expect(landingWays(p, (p + 1) % SQUARES)).toBe(0);
      for (let j = 0; j < 6; j++) expect(landingWays(p, j) + landingWays(p, j + 6)).toBe(6);
    }
  });

  it('every roll is fair from every square: enumerating the 36 dice outcomes gives an expected factor of exactly 1', () => {
    for (const d of DIFFICULTIES) {
      for (let p = 0; p < SQUARES; p++) {
        let e = 0;
        let bust = 0;
        for (let a = 1; a <= 6; a++)
          for (let b = 1; b <= 6; b++) {
            const r = resolveRoll(d, p, 1, a, b);
            e += r.factor / 36;
            if (r.snake) bust += 1 / 36;
          }
        expect(e).toBeCloseTo(1, 12);
        expect(expectedFactorFrom(d, p)).toBeCloseTo(1, 12);
        // The bust chance drawn on the board (sum of landing odds on snake squares) is the true risk.
        expect(bust).toBeCloseTo(snakeChance(d), 12);
        expect(snakeChanceFrom(d, p)).toBeCloseTo(snakeChance(d), 12);
      }
    }
  });

  it('martingale: at random reachable states, E[value after one roll] = value now', () => {
    for (const d of DIFFICULTIES) {
      for (let t = 0; t < 40; t++) {
        const p = rng.int(SQUARES);
        const cash = RTP * (0.5 + 3 * rng.next());
        let e = 0;
        for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) e += resolveRoll(d, p, cash, a, b).cash / 36;
        expect(e).toBeCloseTo(cash, 10);
      }
    }
  });

  it('exact RTP by enumeration of every dice path: fixed-roll and target rules all return 99%', () => {
    for (const d of DIFFICULTIES) {
      for (const rolls of [1, 2, 3]) expect(exactRuleValue(d, { rolls, target: 0 })).toBeCloseTo(RTP, 12);
      for (const target of [1.2, 2, 5]) expect(exactRuleValue(d, { rolls: 3, target })).toBeCloseTo(RTP, 12);
    }
  });

  it('a target rule near the max-win cap is still exact (the cap is a stopping rule)', () => {
    // Master: 0.99 · 6^5 = 7,698× is the last value that may roll again (×6 would pass 10,000×).
    expect(canRoll('master', RTP * 6 ** 4)).toBe(true);
    expect(canRoll('master', RTP * 6 ** 5)).toBe(false);
    expect(exactRuleValue('master', { rolls: 8, target: 0 })).toBeCloseTo(RTP, 12);
    expect(exactRuleValue('expert', { rolls: 5, target: 400 })).toBeCloseTo(RTP, 12);
  });

  it('the raw dice process busts within n rolls as often as 1 − (1 − q)^n', () => {
    for (const d of DIFFICULTIES) {
      const n = 3;
      const rounds = 40_000;
      let alive = 0;
      for (let r = 0; r < rounds; r++) {
        let pos = 0;
        let ok = true;
        for (let k = 0; k < n && ok; k++) {
          const [a, b] = drawDice(rng);
          const roll = resolveRoll(d, pos, 1, a, b);
          ok = !roll.snake;
          pos = roll.to;
        }
        if (ok) alive++;
      }
      const p = survival(d, n);
      expect(Math.abs(alive / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-9);
    }
  });

  it('the max win is honest: no roll is offered that could pass MAX_WIN', () => {
    expect(manifest.maxMultiplier).toBe(MAX_WIN);
    for (const d of DIFFICULTIES) {
      let cash = RTP;
      while (canRoll(d, cash)) cash *= maxFactor(d);
      expect(cash).toBeLessThanOrEqual(MAX_WIN);
    }
  });
});

describe('Snakes auto-bet', () => {
  it('play resolves once per round, with the settled multiplier', async () => {
    for (const d of DIFFICULTIES) {
      for (let t = 0; t < 200; t++) {
        let settles = 0;
        let settled = -1;
        let animations = 0;
        const result = await runAutoRound({
          d,
          rule: { rolls: 1 + rng.int(6), target: rng.next() < 0.5 ? 0 : 1 + 4 * rng.next() },
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
      }
    }
  });

  it('an interrupted round resolves null without settling', async () => {
    let settles = 0;
    const result = await runAutoRound({
      d: 'easy',
      rule: { rolls: 5, target: 0 },
      dice: () => [1, 1],
      animate: async () => false,
      settle: () => settles++,
    });
    expect(result).toBeNull();
    expect(settles).toBe(0);
  });

  it('auto with a fixed roll count returns 99% in simulation', async () => {
    const d = 'medium';
    const rounds = 30_000;
    let sum = 0;
    let sumSq = 0;
    for (let r = 0; r < rounds; r++) {
      const m = (await runAutoRound({ d, rule: { rolls: 3, target: 0 }, dice: () => drawDice(rng), animate: async () => true, settle: () => {} }))!;
      sum += m;
      sumSq += m * m;
    }
    const mean = sum / rounds;
    const se = Math.sqrt((sumSq / rounds - mean ** 2) / rounds);
    expect(Math.abs(mean - RTP)).toBeLessThan(4 * se);
  });
});

describe('Snakes eval', () => {
  it('samples deep enough on every board', () => {
    for (const d of DIFFICULTIES) expect(deepest(d)).toBeGreaterThanOrEqual(3);
  });

  it('simulated RTP matches the manifest, and the max is within maxMultiplier', () => {
    for (const r of runEval(evalSpec, { rounds: 60_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
