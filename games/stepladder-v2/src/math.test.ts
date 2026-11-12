import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import { DICE, MAX_MULTIPLIER, ROLL_OFFS, RTP, START, cashOf, duelChance, duelChances, gridCells, matchOf, opponentsOf, prizeOf, step, titleChance, wins, type State } from './math';

const rng = createRng(seededSource(11));

const ALIVE: State[] = [0, 1, 2].map((j) => ({ j, lost: false }));

describe('Stepladder maths', () => {
  it('duel chances: smaller die (a - 1) / 2b, bigger die 1 - (b - 1) / 2a, ties to the bigger', () => {
    for (const a of DICE)
      for (const b of DICE) {
        if (a === b) continue;
        const exact = a < b ? (a - 1) / (2 * b) : 1 - (b - 1) / (2 * a);
        expect(duelChance(a, b)).toBeCloseTo(exact, 12);
        expect(duelChance(a, b) + duelChance(b, a)).toBeCloseTo(1, 12);
      }
  });

  it('opponents come biggest first, no roll-off is harder than the one before, and P(win) is the product of the three duels', () => {
    for (let x = 0; x < DICE.length; x++) {
      const opps = opponentsOf(x);
      expect(opps).toHaveLength(3);
      expect([...opps].sort((p, q) => q - p)).toEqual(opps);
      const cs = duelChances(x);
      expect(cs[1]).toBeGreaterThanOrEqual(cs[0]);
      expect(cs[2]).toBeGreaterThanOrEqual(cs[1]);
      const [p1, p2, p3] = duelChances(x);
      expect(titleChance(x, START)).toBeCloseTo(p1 * p2 * p3, 14);
    }
  });

  it('P(win) range across the four dice is at least 25:1', () => {
    const ps = DICE.map((_, x) => titleChance(x, START));
    expect(Math.max(...ps) / Math.min(...ps)).toBeGreaterThan(25);
    expect(ps[3]).toBeCloseTo(0.8750 * 0.825 * 0.725, 6);
    expect(ps[0]).toBeCloseTo((5 / 16) * (5 / 24) * (5 / 40), 8);
    expect(prizeOf(0)).toBeCloseTo(RTP / ps[0], 9);
    expect(MAX_MULTIPLIER).toBeGreaterThanOrEqual(prizeOf(0));
  });

  it('P(win) equals a direct simulation of three roll-offs', () => {
    const rounds = 200_000;
    for (let x = 0; x < DICE.length; x++) {
      let w = 0;
      for (let r = 0; r < rounds; r++) {
        let ok = true;
        for (const o of opponentsOf(x)) if (!wins(DICE[x], 1 + rng.int(DICE[x]), DICE[o], 1 + rng.int(DICE[o]))) ok = false;
        if (ok) w++;
      }
      const p = titleChance(x, START);
      expect(Math.abs(w / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-9);
    }
  });

  it('each roll-off is a fair bet: E[cash-out after] = cash-out before, for every die and state', () => {
    for (let x = 0; x < DICE.length; x++)
      for (const s of ALIVE) {
        const { a, b } = matchOf(x, s);
        let e = 0;
        for (let fa = 1; fa <= a; fa++) for (let fb = 1; fb <= b; fb++) e += cashOf(x, step(x, s, fa, fb)) / (a * b);
        expect(e).toBeCloseTo(cashOf(x, s), 12);
      }
  });

  it('the green cells are exactly the pairs where your die wins, and their share is the duel chance', () => {
    for (let x = 0; x < DICE.length; x++)
      for (const s of ALIVE) {
        const { a, b } = matchOf(x, s);
        const g = gridCells(x, s);
        for (let fa = 1; fa <= a; fa++) for (let fb = 1; fb <= b; fb++) expect(g.grid[fa - 1][fb - 1] === 'good').toBe(!step(x, s, fa, fb).lost);
        expect(g.good / g.total).toBeCloseTo(duelChances(x)[s.j], 12);
      }
    expect(ROLL_OFFS).toBe(3);
  });

  it('simulated RTP matches the manifest under random stopping', () => {
    for (const r of runEval(evalSpec, { rounds: 60_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
