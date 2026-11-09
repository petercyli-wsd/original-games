// Fairness audit: can any way of playing Condorcet beat the RTP?
//
// The pick (A, B, C or Cycle), voters and elections are fixed at the bet (the
// chips are disabled while live). The first ballot is counted at once; then at
// each checkpoint the player may count one ballot, count the rest of this
// election, or cash out (cashValue). Each action's ballots are drawn up front
// by plan() with rng.int(6), and the buttons only exist at checkpoints.
//
// The martingale check is exact. At ≥ 30 states reached by random rounds
// (every config, early and late in an election, at election boundaries):
//   - one ballot: the six outcomes of count() are averaged (each 1/6);
//   - the rest of the election: exact recursion over every ballot sequence
//     until count() says the election ended;
// and both must equal cashValue now.
//
// Strategies, per eval config, evaluated exactly (dynamic programming over
// (elections won, margins, ballots counted), since each policy only looks at
// the state) and by Monte Carlo through plan():
//   (a) the tester's: count one ballot only when it is ≥ 80% safe (1 −
//       nextLoss), else cash out;
//   (b) take any profit: cash out the moment the cash-out exceeds the bet;
//   (c) count everything out ('rest' each time);
//   (d) bank and dodge: cash out at every election boundary, and whenever
//       the next ballot can lose while the election chance is below 1/2;
//       count the rest when the election chance is ≥ 1/2, else one ballot.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import {
  ELECTIONS,
  MAX_MULTIPLIER,
  PICKS,
  RTP,
  VOTERS,
  cashValue,
  count,
  electionChance,
  newSeries,
  nextLoss,
  perElection,
  plan,
  prizeFor,
  type Mode,
  type Pick,
  type Series,
} from './math';

/** Rounds per strategy run; the audit's 200k run sets FAIRNESS_ROUNDS=200000. */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 5_000);

const BALLOTS6 = [0, 1, 2, 3, 4, 5];
const terminal = (s: Series) => (s.status === 'won' ? prizeFor(s.pick, s.voters, s.elections) : 0);
const key = (s: Series) => `${s.pick}|${s.voters}|${s.elections}|${s.won}|${s.margins.join(',')}|${s.ballots.length}`;

/** Exact value of counting the rest of the current election, then taking `after` at the next state. */
function restValue(s: Series, after: (n: Series) => number, memo = new Map<string, number>()): number {
  const k = key(s);
  const hit = memo.get(k);
  if (hit !== undefined) return hit;
  let sum = 0;
  for (const b of BALLOTS6) {
    const c = count(s, b);
    sum += c.next.status !== 'live' ? terminal(c.next) : c.ended ? after(c.next) : restValue(c.next, after, memo);
  }
  memo.set(k, sum / 6);
  return sum / 6;
}

type Act = Mode | 'cash';
type Policy = (s: Series) => Act;

const atBoundary = (s: Series) => s.won > 0 && s.ballots.length === 0;
const STRATEGIES: { name: string; policy: Policy }[] = [
  { name: '(a) count only when ≥ 80% safe', policy: (s) => (1 - nextLoss(s) >= 0.8 ? 'one' : 'cash') },
  { name: '(b) take any profit', policy: (s) => (cashValue(s) > 1 ? 'cash' : 'one') },
  { name: '(c) count everything out', policy: () => 'rest' },
  {
    name: '(d) bank each election, dodge losing ballots',
    policy: (s) => {
      if (atBoundary(s)) return 'cash';
      const e = electionChance(s);
      if (nextLoss(s) > 0 && e < 0.5) return 'cash';
      return e >= 0.5 ? 'rest' : 'one';
    },
  },
];

/** Exact expected payout of a policy over a whole round (the first ballot is automatic). */
function exactRtp(pick: Pick, voters: number, elections: number, policy: Policy): number {
  const memo = new Map<string, number>();
  const restMemo = new Map<string, number>();
  const V = (s: Series): number => {
    if (s.status !== 'live') return terminal(s);
    const k = key(s);
    const hit = memo.get(k);
    if (hit !== undefined) return hit;
    const a = policy(s);
    const out = a === 'cash' ? cashValue(s) : a === 'rest' ? restValue(s, V, restMemo) : BALLOTS6.reduce((acc, b) => acc + V(count(s, b).next), 0) / 6;
    memo.set(k, out);
    return out;
  };
  const s0 = newSeries(pick, voters, elections);
  return BALLOTS6.reduce((acc, b) => acc + V(count(s0, b).next), 0) / 6;
}

/** One round as Game.tsx plays it: plan() draws each action's ballots, the policy acts at each checkpoint. */
function playRound(pick: Pick, voters: number, elections: number, policy: Policy, rng: Rng): number {
  let s = newSeries(pick, voters, elections);
  let mode: Mode = 'one';
  for (;;) {
    const counts = plan(s, mode, rng);
    s = counts[counts.length - 1].next;
    if (s.status !== 'live') return terminal(s);
    const a = policy(s);
    if (a === 'cash') return cashValue(s);
    mode = a;
  }
}

/** Checkpoints met while playing random rounds out with random actions. */
function reachedStates(count_: number, rng: Rng): Series[] {
  const out: Series[] = [];
  const configs = evalSpec.configs.map((c) => c.params);
  for (let i = 0; out.length < count_; i++) {
    const { pick, voters, elections } = configs[i % configs.length];
    let s = newSeries(pick, voters, elections);
    for (;;) {
      const counts = plan(s, rng.next() < 0.2 ? 'rest' : 'one', rng);
      s = counts[counts.length - 1].next;
      if (s.status !== 'live') break;
      if (rng.next() < 0.3) out.push(s);
    }
  }
  return out.slice(0, count_);
}

function mc(play: (rng: Rng) => number, rounds: number, seed: number) {
  const rng = createRng(seededSource(seed));
  let s = 0;
  let s2 = 0;
  let max = 0;
  for (let i = 0; i < rounds; i++) {
    const x = play(rng);
    s += x;
    s2 += x * x;
    if (x > max) max = x;
  }
  const mean = s / rounds;
  return { mean, se: Math.sqrt(Math.max(0, s2 / rounds - mean * mean) / rounds), max };
}

describe('Condorcet fairness', () => {
  it('every bet is worth RTP and the four results share each election exactly', () => {
    for (const n of VOTERS) {
      expect(PICKS.reduce((a, p) => a + perElection(p, n), 0)).toBeCloseTo(1, 12);
      for (const k of ELECTIONS) for (const p of PICKS) expect(cashValue(newSeries(p, n, k))).toBeCloseTo(RTP, 12);
    }
  });

  it('martingale, exact: at 40 reached states, one ballot and "count the rest" are fair bets', () => {
    const rng = createRng(seededSource(123));
    const cashRestMemo = new Map<string, number>();
    const states = reachedStates(40, rng);
    // Include every election boundary and the last ballot of an election.
    for (const n of VOTERS) {
      for (const k of ELECTIONS) {
        if (k > 1) states.push({ ...newSeries('cycle', n, k), won: k - 1 });
      }
    }
    expect(states.some((s) => s.voters - s.ballots.length <= 2)).toBe(true);
    expect(states.some(atBoundary)).toBe(true);
    for (const s of states) {
      const V = cashValue(s);
      const one = BALLOTS6.reduce((a, b) => a + cashValue(count(s, b).next), 0) / 6;
      expect(Math.abs(one - V)).toBeLessThan(1e-11 * Math.max(1, V));
      const rest = restValue(s, cashValue, cashRestMemo);
      expect(Math.abs(rest - V)).toBeLessThan(1e-11 * Math.max(1, V));
    }
  });

  it('every strategy returns exactly RTP on every eval config, and on every pick for 9 voters (exact DP)', () => {
    for (const cfg of evalSpec.configs) {
      const { pick, voters, elections } = cfg.params;
      for (const { policy } of STRATEGIES) expect(exactRtp(pick, voters, elections, policy)).toBeCloseTo(RTP, 9);
    }
    for (const p of PICKS) for (const k of ELECTIONS) for (const { policy } of STRATEGIES) expect(exactRtp(p, 9, k, policy)).toBeCloseTo(RTP, 9);
  });

  it.each(STRATEGIES.map((s) => [s.name, s] as const))('strategy %s: Monte Carlo RTP within 4 SE on every eval config', (_, { name, policy }) => {
    evalSpec.configs.forEach((cfg, i) => {
      const { pick, voters, elections } = cfg.params;
      const r = mc((g) => playRound(pick, voters, elections, policy, g), ROUNDS, 900 + i * 7 + name.length);
      const z = (r.mean - RTP) / r.se;
      if (import.meta.env.FAIRNESS_ROUNDS)
        console.log(`${name} | ${cfg.label} | RTP ${(r.mean * 100).toFixed(3)}% ± ${(r.se * 100).toFixed(3)}% | z ${z.toFixed(2)} | max ${r.max.toFixed(2)}`);
      expect(Math.abs(z)).toBeLessThan(4);
      expect(r.max).toBeLessThanOrEqual(MAX_MULTIPLIER + 1e-9);
    });
  });
});
