// Fairness audit: can any way of playing Witness beat the RTP?
//
// N is drawn uniformly from the range at the bet; each test draws a fresh
// uniform base in [2, N − 2]. The player sees only "pass" or "witness" (the
// bases stay sealed), so after r passes the whole public state is r. The
// cash-out is prize × P(win | r passes) with prize = RTP / P(win | start).
//
// Decisions mid-round: cash out, run the next test, or (after the last test)
// reveal N. Bet, range and test count are locked while live, and the first
// test runs at the bet (it is priced: V before it is RTP). Space = next test
// or reveal, C = cash out; both call the same functions as the buttons. The
// test result is drawn when the test starts, every action is disabled until
// the animation ends, and the ticket reads a ref holding the resolved value
// (RTP right after the bet, then the post-result value of each step).
//
// Because the public state is just r ∈ {1..T}, a deterministic strategy is a
// stopping index, so there are only T + 1 of them per setting (randomised
// rules are mixtures). Checks, with the game's own functions:
//   - the liar rate f(N) the maths uses equals a brute-force count with the
//     game's own `passes` over every base in [2, N − 2], for every candidate;
//   - martingale at EVERY state (all settings × r = 0…T): V(r) equals prize
//     × the true posterior win chance, and E[V after the next test / reveal]
//     = V(r), outcomes enumerated exactly over candidates;
//   - every stopping rule (all T + 1 of them) on every setting returns RTP
//     exactly (forward pass over the true candidate masses);
//   - strategies (a)–(d) by Monte Carlo through drawN / runTest on every eval
//     config, as Game.tsx plays them.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  BETS,
  RANGE_IXS,
  RTP,
  TESTS,
  allowed,
  candidates,
  chance,
  drawN,
  passChance,
  passes,
  prize,
  runTest,
  wins,
  type RangeIx,
  type Settings,
} from './math';

/** Rounds per strategy run; the audit's 200k run sets FAIRNESS_ROUNDS=200000 (scratch fairness/run-heavy-witness-zigzag.sh). */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 20_000);

const SETTINGS: Settings[] = RANGE_IXS.flatMap((range) =>
  BETS.flatMap((bet) => TESTS.filter((t) => allowed(bet, t)).map((tests) => ({ range, bet, tests }))),
);

// ---------- the true process, independent of the maths' Monier formula ----------

const bruteCache = new Map<RangeIx, number[]>();
/** Per candidate: the exact chance one uniform base in [2, N − 2] passes, by counting with the game's `passes`. */
function bruteF(range: RangeIx): number[] {
  const hit = bruteCache.get(range);
  if (hit) return hit;
  const f = candidates(range).n.map((n) => {
    let c = 0;
    for (let a = 2; a <= n - 2; a++) if (passes(a, n)) c++;
    return c / (n - 3);
  });
  bruteCache.set(range, f);
  return f;
}

const V = (s: Settings, r: number) => prize(s) * chance(s.range, s.bet, s.tests, r);
/** What a witness pays: it proves N composite. */
const caughtPay = (s: Settings) => (s.bet === 'composite' ? prize(s) : 0);

/** Unconditional mass of each candidate having passed r tests: P(N = i) · f_i^r. */
function masses(s: Settings, r: number): number[] {
  const f = bruteF(s.range);
  return f.map((fi) => fi ** r / f.length);
}
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

type Action = 'cash' | 'next';
/** A rule at the checkpoint after r ≥ 1 passes ('next' = run the next test, or reveal after the last). */
type Strategy = (s: Settings, r: number) => Action;

/** P(the next event leaves V > 0): a test can only lose for Prime/Fooled; the reveal wins with the live chance. */
function survival(s: Settings, r: number): number {
  if (r >= s.tests) return chance(s.range, s.bet, s.tests, r);
  return s.bet === 'composite' ? 1 : passChance(s.range, r);
}

const STRATEGIES: { name: string; play: Strategy }[] = [
  { name: '(a) act only at ≥ 80% survival', play: (s, r) => (survival(s, r) >= 0.8 ? 'next' : 'cash') },
  { name: '(b) take any profit', play: (s, r) => (V(s, r) > 1 ? 'cash' : 'next') },
  { name: '(c) every test, then reveal', play: () => 'next' },
  // Lock in whenever ahead of the fair start, keep gambling while behind.
  { name: '(d) cash when ahead of RTP, press on when behind', play: (s, r) => (V(s, r) > RTP ? 'cash' : 'next') },
];

/** Exact expected payout of a rule, over the true candidate masses (the first test is forced at the bet). */
function exactValue(s: Settings, play: Strategy): number {
  const f = bruteF(s.range);
  const c = candidates(s.range);
  let value = 0;
  for (let r = 0; ; r++) {
    const m = masses(s, r);
    if (r >= 1 && play(s, r) === 'cash') return value + sum(m) * V(s, r);
    if (r === s.tests) return value + prize(s) * sum(m.map((mi, i) => (wins(s.bet, c.n[i], true) ? mi : 0)));
    value += caughtPay(s) * sum(m.map((mi, i) => mi * (1 - f[i])));
  }
}

/** One round as Game.tsx plays it: N drawn at the bet, the first test runs at once. */
function playRound(s: Settings, play: Strategy, rng: Rng): number {
  const pay = prize(s);
  const n = drawN(s.range, rng);
  for (let r = 0; ; ) {
    if (r === s.tests) return wins(s.bet, n, true) ? pay : 0;
    if (!runTest(n, rng).pass) return caughtPay(s);
    r++;
    if (play(s, r) === 'cash') return pay * chance(s.range, s.bet, s.tests, r);
  }
}

function mc(fn: (rng: Rng) => number, rounds: number, seed: number) {
  const rng = createRng(seededSource(seed));
  let s1 = 0;
  let s2 = 0;
  let max = 0;
  for (let i = 0; i < rounds; i++) {
    const x = fn(rng);
    s1 += x;
    s2 += x * x;
    if (x > max) max = x;
  }
  const mean = s1 / rounds;
  return { mean, se: Math.sqrt(Math.max(0, s2 / rounds - mean * mean) / rounds), max };
}

describe('Witness fairness', () => {
  it('the liar rate the maths uses equals a brute-force count over every base', () => {
    for (const range of RANGE_IXS) {
      const c = candidates(range);
      const f = bruteF(range);
      for (let i = 0; i < c.n.length; i++) expect(c.f[i]).toBeCloseTo(f[i], 14);
    }
  });

  it('martingale at every state: V is prize × the true posterior, and E[V after the next event] = V', () => {
    let states = 0;
    for (const s of SETTINGS) {
      const c = candidates(s.range);
      const f = bruteF(s.range);
      const pay = prize(s);
      expect(V(s, 0)).toBeCloseTo(RTP, 12);
      for (let r = 0; r <= s.tests; r++) {
        const m = masses(s, r);
        const M = sum(m);
        const post = m.map((x) => x / M);
        // Every candidate's chance of winning from here, under the true process.
        const winFrom = (i: number) => {
          if (c.prime[i]) return s.bet === 'prime' ? 1 : 0;
          if (s.bet === 'composite') return 1;
          if (s.bet === 'fooled') return f[i] ** (s.tests - r);
          return 0;
        };
        const truth = sum(post.map((p, i) => p * winFrom(i)));
        expect(chance(s.range, s.bet, s.tests, r)).toBeCloseTo(truth, 12);
        let after: number;
        if (r < s.tests) {
          // The displayed pass chance is the true one.
          const q = sum(post.map((p, i) => p * f[i]));
          expect(passChance(s.range, r)).toBeCloseTo(q, 12);
          after = q * V(s, r + 1) + (1 - q) * caughtPay(s);
        } else {
          after = pay * sum(post.map((p, i) => (wins(s.bet, c.n[i], true) ? p : 0)));
        }
        expect(Math.abs(after - V(s, r))).toBeLessThan(1e-9 * Math.max(1, pay));
        states++;
      }
    }
    expect(states).toBeGreaterThanOrEqual(30);
  });

  it('every stopping rule returns exactly RTP on every setting (the full strategy space)', () => {
    for (const s of SETTINGS) {
      for (let stop = 1; stop <= s.tests + 1; stop++) {
        // Cash at checkpoint `stop`, or reveal when stop = T + 1.
        const v = exactValue(s, (_s, r) => (r >= stop ? 'cash' : 'next'));
        expect(Math.abs(v - RTP)).toBeLessThan(1e-9);
      }
      for (const { play } of STRATEGIES) expect(Math.abs(exactValue(s, play) - RTP)).toBeLessThan(1e-9);
    }
  });

  it('strategies (a)–(d) through the real draws return RTP on every eval config', () => {
    const rows: string[] = [];
    evalSpec.configs.forEach((cfg, ci) => {
      STRATEGIES.forEach(({ name, play }, si) => {
        const { mean, se, max } = mc((rng) => playRound(cfg.params, play, rng), ROUNDS, 7100 + 31 * ci + si);
        rows.push(`${cfg.label} | ${name} | ${(mean * 100).toFixed(2)}% ± ${(se * 100).toFixed(2)}% | max ${max.toFixed(2)}`);
        expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-9);
        expect(max).toBeLessThanOrEqual(manifest.maxMultiplier);
      });
    });
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
