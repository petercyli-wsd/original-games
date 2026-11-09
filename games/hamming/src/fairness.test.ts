// Fairness audit: can any way of playing Hamming beat the RTP?
//
// The side (Decoded / Fooled), noise and block count are fixed at the bet
// (the chips are disabled while live). Bet sends the first bit at once; then
// at each checkpoint the player may cash out, send one bit, or send the rest
// of the block. Game.tsx's send() draws every bit of the action up front
// (rng.next() < noise) through sendBit(), stops once decided(), and pays
// prize when winChance > 1/2 at a decided state, else 0. Every button is
// hidden while the bits animate. play() below is that same loop.
//
// Every action has finitely many outcomes (≤ 2^7 bit patterns), so the
// checks are exact:
//   - martingale: at EVERY live state of every one of the 40 settings (both
//     sides, all noises and block counts), "one bit" and "rest of block" are
//     fair bets, and settled states are worth exactly prize or 0;
//   - strategies: exact DP over (block, bits sent, flips), then Monte Carlo:
//       (a) the tester's: send a bit only while it is ≥ 80% safe (the
//           chance the value after it is > 0), else cash out;
//       (b) take any profit: cash out the moment the cash-out exceeds the bet;
//       (c) send everything (rest of block each time);
//       (d1) dodge: send bit by bit, cash out whenever the next bit can end
//           the round as a loss;
//       (d2) chase the swing: Decoded sends the rest of a clean block but
//           bit by bit after a flip, banking at 2×; Fooled bursts after a
//           flip (hunting the second) and creeps bit by bit while clean.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import {
  ALL_SETTINGS,
  BITS,
  MAX_MULTIPLIER,
  RTP,
  START,
  bitsToBlockEnd,
  cashAt,
  decided,
  prizeFor,
  sendBit,
  winChance,
  type Settings,
  type State,
} from './math';

/** Rounds per strategy run; the audit's 200k run sets FAIRNESS_ROUNDS=200000. */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 5_000);

type Act = 'cash' | 'bit' | 'rest';
type Policy = (s: Settings, st: State) => Act;

/** The settlement Game.tsx uses at a decided state. */
const payout = (s: Settings, st: State) => (winChance(s, st) > 0.5 ? prizeFor(s) : 0);

/** All outcomes of sending up to n bits (stopping once decided), with their probabilities (equal states merged). */
function sends(s: Settings, st: State, n: number): { st: State; prob: number }[] {
  const p = s.noise / 100;
  let out = [{ st, prob: 1 }];
  for (let i = 0; i < n; i++) {
    const next = new Map<string, { st: State; prob: number }>();
    const add = (x: State, prob: number) => {
      const key = `${x.block}|${x.sent}|${x.flips}`;
      const o = next.get(key);
      if (o) o.prob += prob;
      else next.set(key, { st: x, prob });
    };
    for (const o of out) {
      if (decided(s, o.st)) add(o.st, o.prob);
      else {
        add(sendBit(o.st, false), o.prob * (1 - p));
        add(sendBit(o.st, true), o.prob * p);
      }
    }
    out = [...next.values()];
  }
  return out;
}

const bitsFor = (st: State, a: Act) => (a === 'bit' ? 1 : bitsToBlockEnd(st));

/** Exact expected value of taking action a at st, then following the policy. */
function actValue(s: Settings, st: State, a: Act, policy: Policy, memo: Map<string, number>): number {
  return sends(s, st, bitsFor(st, a)).reduce((acc, o) => acc + o.prob * nodeValue(s, o.st, policy, memo), 0);
}

function nodeValue(s: Settings, st: State, policy: Policy, memo: Map<string, number>): number {
  if (decided(s, st)) return payout(s, st);
  const key = `${st.block}|${st.sent}|${st.flips}`;
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  const a = policy(s, st);
  const v = a === 'cash' ? cashAt(s, st) : actValue(s, st, a, policy, memo);
  memo.set(key, v);
  return v;
}

/** Exact RTP: Bet sends the first bit at once. */
const exactRtp = (s: Settings, policy: Policy) => actValue(s, START, 'bit', policy, new Map());

/** One round as Game.tsx plays it. */
function play(s: Settings, policy: Policy, rng: Rng): number {
  let st = START;
  let a: Act = 'bit';
  for (;;) {
    const n = bitsFor(st, a);
    for (let i = 0; i < n && !decided(s, st); i++) st = sendBit(st, rng.next() < s.noise / 100);
    if (decided(s, st)) return payout(s, st);
    a = policy(s, st);
    if (a === 'cash') return cashAt(s, st);
  }
}

/** The chance the value after one more bit is still > 0. */
const bitSafe = (s: Settings, st: State) => sends(s, st, 1).reduce((acc, o) => acc + (nodeValue(s, o.st, () => 'cash', new Map()) > 0 ? o.prob : 0), 0);

const STRATEGIES: { name: string; policy: Policy }[] = [
  { name: '(a) send a bit only while ≥ 80% safe', policy: (s, st) => (bitSafe(s, st) >= 0.8 ? 'bit' : 'cash') },
  { name: '(b) take any profit', policy: (s, st) => (cashAt(s, st) > 1 ? 'cash' : 'bit') },
  { name: '(c) send everything', policy: () => 'rest' },
  { name: '(d1) dodge every possible loss', policy: (s, st) => (bitSafe(s, st) < 1 ? 'cash' : 'bit') },
  {
    name: '(d2) chase the swing',
    policy: (s, st) => {
      const flipped = st.flips === 1 && st.sent < BITS;
      if (s.side === 'decoded') return cashAt(s, st) >= 2 ? 'cash' : flipped ? 'bit' : 'rest';
      return flipped ? 'rest' : 'bit';
    },
  },
];

/** Every live state of a setting (a finished clean block is the next block with nothing sent). */
function liveStates(s: Settings): State[] {
  const out: State[] = [];
  for (let block = 0; block < s.blocks; block++)
    for (let sent = 0; sent <= BITS; sent++)
      for (let flips = 0; flips <= Math.min(1, sent); flips++) {
        const st = { block, sent, flips };
        if (!decided(s, st)) out.push(st);
      }
  return out;
}

function mc(play_: (rng: Rng) => number, rounds: number, seed: number) {
  const rng = createRng(seededSource(seed));
  let s = 0;
  let s2 = 0;
  let max = 0;
  for (let i = 0; i < rounds; i++) {
    const x = play_(rng);
    s += x;
    s2 += x * x;
    if (x > max) max = x;
  }
  const mean = s / rounds;
  return { mean, se: Math.sqrt(Math.max(0, s2 / rounds - mean * mean) / rounds), max };
}

describe('Hamming fairness', () => {
  it('martingale, exact: at every live state of all 40 settings, one bit and the rest of the block are fair bets', () => {
    let n = 0;
    for (const s of ALL_SETTINGS) {
      const memo = new Map<string, number>();
      for (const st of liveStates(s)) {
        const V = cashAt(s, st);
        for (const a of ['bit', 'rest'] as const) {
          const after = sends(s, st, bitsFor(st, a)).reduce((acc, o) => acc + o.prob * (decided(s, o.st) ? payout(s, o.st) : cashAt(s, o.st)), 0);
          expect(Math.abs(after - V)).toBeLessThan(1e-12 * Math.max(1, V));
        }
        // The cash-out never exceeds the prize, and is what the exact DP says it is worth.
        expect(V).toBeLessThanOrEqual(prizeFor(s) * (1 + 1e-12));
        expect(Math.abs(nodeValue(s, st, () => 'cash', memo) - V)).toBe(0);
        n++;
      }
    }
    expect(n).toBeGreaterThan(30);
  });

  it('settled states are worth exactly the prize or 0, so the settlement rule matches the cash-out', () => {
    for (const s of ALL_SETTINGS) {
      const ends = sends(s, START, s.blocks * BITS).filter((o) => decided(s, o.st));
      expect(ends.reduce((a, o) => a + o.prob, 0)).toBeCloseTo(1, 12);
      for (const o of ends) expect(Math.abs(cashAt(s, o.st) - payout(s, o.st))).toBeLessThan(1e-12 * prizeFor(s));
      expect(cashAt(s, START)).toBeCloseTo(RTP, 12);
    }
  });

  it('every strategy returns exactly RTP on all 40 settings (exact DP)', () => {
    for (const s of ALL_SETTINGS) for (const { policy } of STRATEGIES) expect(exactRtp(s, policy)).toBeCloseTo(RTP, 10);
  });

  it.each(STRATEGIES.map((s) => [s.name, s] as const))('strategy %s: Monte Carlo RTP within 4 SE on every eval config', (_, { name, policy }) => {
    evalSpec.configs.forEach((cfg, i) => {
      const s = cfg.params;
      const r = mc((g) => play(s, policy, g), ROUNDS, 300 + i * 11 + name.length);
      if (import.meta.env.FAIRNESS_ROUNDS)
        console.log(`${name} | ${cfg.label} | RTP ${(r.mean * 100).toFixed(3)}% ± ${(r.se * 100).toFixed(3)}% | exact ${(exactRtp(s, policy) * 100).toFixed(6)}% | max ${r.max.toFixed(2)}`);
      expect(Math.abs(r.mean - RTP)).toBeLessThanOrEqual(4 * r.se + 1e-9);
      expect(r.max).toBeLessThanOrEqual(MAX_MULTIPLIER + 1e-9);
    });
  });
});
