// Fairness audit: can any way of playing Pivot beat the RTP?
//
// The backed block is chosen before the bet (the chips are disabled while
// live) and locks the prize at RTP / φᵢ. The bet starts the first action; an
// action is plan(): one uniformly random block joins, and while the result is
// then certain (chance 0 or 1) the rest keep joining by themselves. At each
// checkpoint the player may cash out (prize × P(win | blocks joined)) or take
// the next action. So the only decision is when to stop. The set of joined
// blocks is a sufficient statistic: the rest join in a uniform random order.
//
// Checks:
//  - P(win | state) re-derived by enumerating every order of the waiting blocks,
//    at every live state of every backed block (6 × up to 63 states).
//  - Martingale, exact: at every live state, E[V after one join] = V now; and
//    at every checkpoint, E[V after a whole plan() action] = V now, the action's
//    outcomes enumerated exactly.
//  - Optimal stopping, exact: backward induction over (backed, joined) with
//    stop / next action gives RTP for every block: no strategy beats RTP.
//  - Strategies (a)–(d) on every eval config, simulated with the game's own
//    plan(), and valued exactly by backward induction.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import {
  BLOCKS,
  LINE,
  MAX_MULTIPLIER,
  RTP,
  SIZES,
  cashValue,
  columns,
  decided,
  join,
  maskOf,
  newRound,
  nextLoss,
  pivotChance,
  plan,
  prizeFor,
  remaining,
  totalOf,
  type Round,
} from './math';

/** Rounds per strategy run; the audit's 200k run sets FAIRNESS_ROUNDS=200000. */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 5_000);

/** The settled value of a round state: prize or 0 once over, else the cash-out. */
const value = (r: Round) => (r.status === 'won' ? prizeFor(r.backed) : r.status === 'lost' ? 0 : cashValue(r));

/** Every live state for a backed block: joined sets that leave it waiting with the stack under the line, reached in some order. */
function liveStates(backed: number): Round[] {
  const out = new Map<number, Round>();
  const grow = (r: Round) => {
    const m = maskOf(r.order);
    if (out.has(m)) return;
    out.set(m, r);
    for (const j of remaining(r)) {
      const n = join(r, j);
      if (n.status === 'live') grow(n);
    }
  };
  grow(newRound(backed));
  return [...out.values()];
}

/** Independent P(win | state): enumerate every order of the waiting blocks. */
function bruteWin(r: Round): number {
  const rest = remaining(r);
  let wins = 0;
  let total = 0;
  const perm = (left: number[], s: number, done: boolean, won: boolean) => {
    if (left.length === 0) {
      total++;
      if (won) wins++;
      return;
    }
    for (let k = 0; k < left.length; k++) {
      const j = left[k];
      const nextLeft = [...left.slice(0, k), ...left.slice(k + 1)];
      if (done) perm(nextLeft, s, true, won);
      else if (s + SIZES[j] >= LINE) perm(nextLeft, s + SIZES[j], true, j === r.backed);
      else perm(nextLeft, s + SIZES[j], j === r.backed, false); // yours landing short ends the race lost
    }
  };
  perm(rest, totalOf(r.order), false, false);
  return wins / total;
}

/** Exact outcomes of one plan() action from r: the states it can stop at, with their chances. */
function planOutcomes(r: Round): { p: number; to: Round }[] {
  const out: { p: number; to: Round }[] = [];
  const walk = (cur: Round, w: number) => {
    const rest = remaining(cur);
    for (const j of rest) {
      const n = join(cur, j);
      if (decided(n)) walk(n, w / rest.length);
      else out.push({ p: w / rest.length, to: n });
    }
  };
  walk(r, 1);
  return out;
}

type Stop = (r: Round) => boolean;

const STRATEGIES: { name: string; stop: Stop }[] = [
  { name: '(a) next block while ≥ 80% safe', stop: (r) => 1 - nextLoss(columns(r)) < 0.8 },
  { name: '(b) take any profit', stop: (r) => cashValue(r) > 1 },
  { name: '(c) play to the end', stop: () => false },
  {
    // Bail when yours would still land short if it joined now and a third or more of the waiting blocks are red.
    name: '(d) bail when early and ≥ 1/3 red',
    stop: (r) => totalOf(r.order) + SIZES[r.backed] < LINE && nextLoss(columns(r)) >= 1 / 3,
  },
];

/** Exact value of a stopping rule (or the optimum when `stop` is null) from the bet, by backward induction. */
function exactValue(backed: number, stop: Stop | null): number {
  const memo = new Map<number, number>();
  const cont = (r: Round): number => planOutcomes(r).reduce((s, o) => s + o.p * v(o.to), 0);
  const v = (r: Round): number => {
    if (r.status !== 'live') return value(r);
    const m = maskOf(r.order);
    const hit = memo.get(m);
    if (hit !== undefined) return hit;
    const out = stop === null ? Math.max(cashValue(r), cont(r)) : stop(r) ? cashValue(r) : cont(r);
    memo.set(m, out);
    return out;
  };
  return cont(newRound(backed));
}

/** One round as Game.tsx / eval.ts play it: the bet runs the first action; each checkpoint applies the rule. */
function playRound(backed: number, stop: Stop, rng: Rng): number {
  let r = newRound(backed);
  for (;;) {
    const joins = plan(r, rng);
    r = joins[joins.length - 1];
    if (r.status !== 'live') return value(r);
    if (stop(r)) return cashValue(r);
  }
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

describe('Pivot fairness', () => {
  it('P(win | state) = every order of the waiting blocks counted, at every live state of every block', () => {
    let n = 0;
    for (let b = 0; b < BLOCKS; b++)
      for (const r of liveStates(b)) {
        expect(Math.abs(bruteWin(r) - pivotChance(b, maskOf(r.order)))).toBeLessThan(1e-12);
        n++;
      }
    expect(n).toBeGreaterThanOrEqual(30);
  });

  it('martingale (exact): E[V after one join] = V now at every live state; E[V after a plan() action] = V at every checkpoint', () => {
    let checkpoints = 0;
    for (let b = 0; b < BLOCKS; b++)
      for (const r of liveStates(b)) {
        const rest = remaining(r);
        const one = rest.reduce((s, j) => s + value(join(r, j)), 0) / rest.length;
        expect(Math.abs(one - cashValue(r))).toBeLessThan(1e-9 * prizeFor(b));
        if (decided(r)) continue;
        checkpoints++;
        const act = planOutcomes(r).reduce((s, o) => s + o.p * value(o.to), 0);
        expect(Math.abs(act - cashValue(r))).toBeLessThan(1e-9 * prizeFor(b));
      }
    expect(checkpoints).toBeGreaterThanOrEqual(30);
  });

  it('optimal stopping (exact): the best possible strategy is worth RTP for every block', () => {
    for (let b = 0; b < BLOCKS; b++) expect(exactValue(b, null)).toBeCloseTo(RTP, 12);
  });

  it('every strategy (a)–(d) is worth exactly RTP (backward induction) for every block', () => {
    for (let b = 0; b < BLOCKS; b++) for (const { stop } of STRATEGIES) expect(exactValue(b, stop)).toBeCloseTo(RTP, 12);
  });

  it('strategies (a)–(d) on every eval config return RTP within 4 SE in simulation, never above the max', () => {
    const rows: string[] = [];
    evalSpec.configs.forEach(({ label, params: { block } }, ci) => {
      STRATEGIES.forEach(({ name, stop }, si) => {
        const res = mc((rng) => playRound(block, stop, rng), ROUNDS, 9400 + 17 * ci + si);
        rows.push(`${label.padEnd(30)} ${name.padEnd(36)} ${(res.mean * 100).toFixed(2)}% ± ${(res.se * 100).toFixed(2)}%  max ${res.max.toFixed(2)}×`);
        expect(Math.abs(res.mean - RTP)).toBeLessThan(4 * res.se + 1e-12);
        expect(res.max).toBeLessThanOrEqual(MAX_MULTIPLIER + 1e-9);
      });
    });
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
