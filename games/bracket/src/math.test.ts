import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  FIELDS,
  MAX_PRIZE,
  PRESETS,
  RTP,
  beats,
  emptyResults,
  isAlive,
  makeBracket,
  nextMatch,
  outcomes,
  playMatch,
  players,
  prizeFor,
  seedOrder,
  startOdds,
  switchPrize,
  titleOdds,
  withResult,
  type Bracket,
  type Results,
} from './math';

const rng = createRng(seededSource(11));

/** Plays matches in order from a state to a random reachable later state. */
function advance(b: Bracket, res: Results, held: number, count: number): Results {
  for (let i = 0; i < count; i++) {
    const ref = nextMatch(b, res, held);
    if (!ref) break;
    res = withResult(res, ref, playMatch(b, res, ref, rng.next()));
  }
  return res;
}

/** Plays out the whole bracket from a state and returns the champion. */
function champion(b: Bracket, res: Results): number {
  let r = res;
  for (;;) {
    const ref = nextMatch(b, r, 0);
    if (!ref) return r[b.rounds - 1][0];
    r = withResult(r, ref, playMatch(b, r, ref, rng.next()));
  }
}

describe('Bracket maths', () => {
  it('seeds the standard way: 1 v n, and 1 and 2 meet only in the final', () => {
    expect(seedOrder(8).map((s) => s + 1)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    expect(seedOrder(16).map((s) => s + 1)).toEqual([1, 16, 8, 9, 4, 13, 5, 12, 2, 15, 7, 10, 3, 14, 6, 11]);
  });

  it('the bracket DP equals exact enumeration of all 2^7 results (8 seeds)', () => {
    for (const preset of PRESETS) {
      const b = makeBracket(8, preset);
      const exact = Array<number>(8).fill(0);
      for (let mask = 0; mask < 128; mask++) {
        let res = emptyResults(b);
        let prob = 1;
        let bit = 0;
        for (let k = 0; k < b.rounds; k++) {
          for (let m = 0; m < res[k].length; m++) {
            const [x, y] = players(b, res, k, m);
            const xWins = ((mask >> bit++) & 1) === 0;
            prob *= xWins ? beats(b, x, y) : beats(b, y, x);
            res = withResult(res, { k, m }, xWins ? x : y);
          }
        }
        exact[res[b.rounds - 1][0]] += prob;
      }
      const dp = startOdds(8, preset);
      for (let i = 0; i < 8; i++) expect(dp[i]).toBeCloseTo(exact[i], 12);
    }
  });

  it('title chances match a direct simulation of the knockout (16 seeds, 4 SE)', () => {
    for (const preset of PRESETS) {
      const b = makeBracket(16, preset);
      const rounds = 15_000;
      const wins = Array<number>(16).fill(0);
      for (let r = 0; r < rounds; r++) wins[champion(b, emptyResults(b))]++;
      const p = startOdds(16, preset);
      for (let i = 0; i < 16; i++) expect(Math.abs(wins[i] / rounds - p[i])).toBeLessThan(4 * Math.sqrt((p[i] * (1 - p[i])) / rounds) + 2e-4);
    }
  });

  it('the odds drawn mid-round are the true chances from that state', () => {
    const b = makeBracket(16, 'underdog');
    const res = advance(b, emptyResults(b), 5, 9);
    const p = titleOdds(b, res);
    expect(p.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 12);
    const rounds = 15_000;
    const wins = Array<number>(16).fill(0);
    for (let r = 0; r < rounds; r++) wins[champion(b, res)]++;
    for (let i = 0; i < 16; i++) {
      if (!isAlive(b, res, i)) expect(p[i]).toBe(0);
      expect(Math.abs(wins[i] / rounds - p[i])).toBeLessThan(4 * Math.sqrt((p[i] * (1 - p[i])) / rounds) + 2e-4);
    }
  });

  it('martingale: the two "if it goes this way" odds average to the odds now', () => {
    for (const n of FIELDS) {
      for (const preset of PRESETS) {
        const b = makeBracket(n, preset);
        for (let trial = 0; trial < 40; trial++) {
          const held = rng.int(n);
          const res = advance(b, emptyResults(b), held, rng.int(n - 1));
          const ref = nextMatch(b, res, held);
          if (!ref || !isAlive(b, res, held)) continue;
          const now = titleOdds(b, res)[held];
          const [x, y] = outcomes(b, res, ref, held);
          expect(x.p + y.p).toBeCloseTo(1, 14);
          expect(x.p * x.after + y.p * y.after).toBeCloseTo(now, 12);
          // So the cash-out prize × P is a fair bet on every match.
          const prize = prizeFor(n, preset, held);
          expect(x.p * prize * x.after + y.p * prize * y.after).toBeCloseTo(prize * now, 9);
        }
      }
    }
  });

  it('switching keeps the cash-out and re-locks the prize at value / P(new seed)', () => {
    const b = makeBracket(16, 'steep');
    const res = advance(b, emptyResults(b), 0, 6);
    const p = titleOdds(b, res);
    const cash = prizeFor(16, 'steep', 0) * p[0];
    for (let t = 0; t < 16; t++) {
      const np = switchPrize(cash, p[t]);
      if (p[t] === 0) expect(np).toBeNull();
      else if (cash / p[t] > MAX_PRIZE) expect(np).toBeNull();
      else expect(np! * p[t]).toBeCloseTo(cash, 12);
    }
  });

  it('the held seed plays last in each round, and rounds go in order', () => {
    const b = makeBracket(16, 'even');
    for (const held of [0, 7, 15]) {
      let res = emptyResults(b);
      let lastRound = 0;
      for (;;) {
        const ref = nextMatch(b, res, held);
        if (!ref) break;
        expect(ref.k).toBeGreaterThanOrEqual(lastRound);
        lastRound = ref.k;
        const mine = players(b, res, ref.k, ref.m).includes(held);
        if (mine) expect(res[ref.k].filter((w) => w < 0).length).toBe(1);
        res = withResult(res, ref, mine ? held : playMatch(b, res, ref, rng.next()));
      }
      expect(res[b.rounds - 1][0]).toBe(held);
    }
  });

  it('every starting prize is within the max win, and the manifest bound is honest', () => {
    for (const n of FIELDS) for (const preset of PRESETS) for (let s = 0; s < n; s++) expect(prizeFor(n, preset, s)).toBeLessThanOrEqual(MAX_PRIZE);
    expect(manifest.maxMultiplier).toBe(MAX_PRIZE);
    expect(prizeFor(8, 'even', 0)).toBeCloseTo(RTP / startOdds(8, 'even')[0], 12);
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 30_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
