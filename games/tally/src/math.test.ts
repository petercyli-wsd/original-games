import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  BINS,
  BIN_LEFT,
  HEIGHT,
  MAX_BALLS,
  MAX_WIN,
  RTP,
  SHARE,
  WIDTHS,
  denominator,
  emptyStacks,
  finished,
  firstChances,
  firstNumerators,
  ghosts,
  landing,
  poissonFirst,
  relock,
  startPrize,
  winChance,
} from './math';

const rng = createRng(seededSource(41));

/** Every live state (no bin at HEIGHT): all 3⁵ stack vectors. */
const allLive: number[][] = [];
for (let k = 0; k < HEIGHT ** BINS; k++) {
  const c: number[] = [];
  for (let j = 0, x = k; j < BINS; j++, x = Math.floor(x / HEIGHT)) c.unshift(x % HEIGHT);
  allLive.push(c);
}

describe('Tally maths', () => {
  it('the widths are the five bins of the concept and fill the floor', () => {
    expect(SHARE).toEqual([0.4, 0.3, 0.15, 0.1, 0.05]);
    expect(WIDTHS.reduce((a, b) => a + b, 0)).toBe(20);
    expect(MAX_BALLS).toBe(11);
    expect(allLive.length).toBe(243);
  });

  it('the DP works in exact integers: every numerator is a whole number below 2^53 and they sum to the denominator', () => {
    for (const c of allLive) {
      const n = firstNumerators(c);
      let sum = 0;
      for (const x of n) {
        expect(Number.isInteger(x)).toBe(true);
        expect(x).toBeLessThan(2 ** 53);
        sum += x;
      }
      expect(sum).toBe(denominator(c));
    }
  });

  it('the DP matches the Poisson race of Gamma clocks at every state', () => {
    for (const c of allLive) {
      const p = firstChances(c);
      expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 14);
      for (let i = 0; i < BINS; i++) expect(p[i]).toBeCloseTo(poissonFirst(c, i), 12);
    }
  });

  it('start odds: 56.6%, 32.6%, 7.4%, 2.8%, 0.48% (118:1)', () => {
    const p = firstChances(emptyStacks());
    // Fractions over 20^11 = 2^22·5^11 are finite decimals, so these are the exact values.
    [0.566017624, 0.326340947250, 0.0744198165, 0.02844704125, 0.004774571].forEach((x, i) => expect(p[i]).toBeCloseTo(x, 13));
    expect(p[0] / p[4]).toBeGreaterThan(118);
    expect(firstNumerators(emptyStacks())[4]).toBe(0.004774571 * 20 ** 11);
  });

  it('the start odds match a direct simulation of balls on the floor', () => {
    const rounds = 60_000;
    const wins = new Array<number>(BINS).fill(0);
    for (let r = 0; r < rounds; r++) {
      const c = emptyStacks();
      // The raw process: a uniform point on [0, 1), and the bin whose span holds it.
      for (;;) {
        const x = rng.next();
        let j = 0;
        let edge = SHARE[0];
        while (x >= edge && j < BINS - 1) edge += SHARE[++j];
        if (++c[j] === HEIGHT) {
          wins[j]++;
          break;
        }
      }
    }
    const p = firstChances(emptyStacks());
    for (let i = 0; i < BINS; i++) expect(Math.abs(wins[i] / rounds - p[i])).toBeLessThan(4 * Math.sqrt((p[i] * (1 - p[i])) / rounds) + 1e-9);
  });

  it('martingale: the ghosts, weighted by bin width, average back to the odds now (exactly, in integers)', () => {
    for (const c of allLive) {
      const now = firstNumerators(c);
      const sub = denominator(c) / 20;
      for (let mine = 0; mine < BINS; mine++) {
        let n = 0;
        for (let j = 0; j < BINS; j++) {
          const next = c.slice();
          next[j]++;
          n += WIDTHS[j] * (finished(next) >= 0 ? (j === mine ? sub : 0) : firstNumerators(next)[mine]);
        }
        expect(n).toBe(now[mine]);
        const g = ghosts(c, mine);
        expect(g.reduce((a, e) => a + e.prob * e.win, 0)).toBeCloseTo(winChance(c, mine), 14);
        const prize = startPrize(mine);
        expect(g.reduce((a, e) => a + e.prob * prize * e.win, 0)).toBeCloseTo(prize * winChance(c, mine), 10);
        // A block in your bin never hurts you; a block for a rival never helps.
        const w0 = winChance(c, mine);
        for (const e of g) {
          if (e.bin === mine) expect(e.win).toBeGreaterThanOrEqual(w0 - 1e-15);
          else expect(e.win).toBeLessThanOrEqual(w0 + 1e-15);
        }
      }
    }
  });

  it('the drawn bin widths are the landing odds: sweeping the floor lands in each bin that often', () => {
    const N = 20_000;
    const hits = new Array<number>(BINS).fill(0);
    for (let i = 0; i < N; i++) {
      const u = (i + 0.5) / N;
      const j = landing(u);
      // The drawn bin j spans [BIN_LEFT[j], BIN_LEFT[j] + SHARE[j]).
      expect(u >= BIN_LEFT[j] - 1e-12 && u < BIN_LEFT[j] + SHARE[j] + 1e-12).toBe(true);
      hits[j]++;
    }
    for (let j = 0; j < BINS; j++) expect(hits[j] / N).toBeCloseTo(SHARE[j], 12);
    expect(landing(0)).toBe(0);
    expect(landing(1 - 2 ** -53)).toBe(BINS - 1);
    // Tie rule: a point exactly on an edge belongs to the bin on its right.
    expect(landing(0.4)).toBe(1);
    expect(landing(0.95)).toBe(4);
  });

  it('the title bar is the true chance: its pieces are the first-to-3 odds and sum to 1', () => {
    for (let t = 0; t < 50; t++) {
      const c = allLive[rng.int(allLive.length)];
      const pieces = firstChances(c);
      expect(pieces.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 14);
      for (let i = 0; i < BINS; i++) expect(pieces[i]).toBe(winChance(c, i));
    }
    const done = [3, 1, 0, 2, 0];
    expect(firstChances(done)).toEqual([1, 0, 0, 0, 0]);
  });

  it('switching keeps the cash-out and relocks the prize fairly, within the cap', () => {
    for (let t = 0; t < 600; t++) {
      const c = allLive[rng.int(allLive.length)];
      const cash = 0.05 + rng.next() * 30;
      const mine = rng.int(BINS);
      const prize = relock(cash, c, mine);
      const p = winChance(c, mine);
      if (prize === null) expect(cash / p).toBeGreaterThan(MAX_WIN);
      else {
        expect(prize * p).toBeCloseTo(cash, 12);
        expect(prize).toBeLessThanOrEqual(MAX_WIN);
      }
    }
  });

  it('every fresh prize is under the cap', () => {
    for (let i = 0; i < BINS; i++) expect(startPrize(i)).toBeLessThanOrEqual(MAX_WIN);
    expect(manifest.maxMultiplier).toBe(MAX_WIN);
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
    expect(manifest.rtp).toBe(RTP);
  });
});
