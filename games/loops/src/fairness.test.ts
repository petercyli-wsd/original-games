// Fairness audit: can any way of playing Loops beat the RTP?
//
// The box count and limit are locked at the bet (round.n, round.limit; the
// chips are disabled while live). Game.tsx draws the whole permutation with
// rng.shuffle at the bet and opens boxes with pickFor(board, perm); the Bet
// itself opens the first box. At every checkpoint the player can cash out,
// open one box, or follow the loop (which opens boxes until it closes, the
// round ends, or the next box is the loop's last chance). Under a uniform
// permutation the next arrow is uniform over candidates(b), so:
//   - Open box has exactly candidates(b).length equally likely outcomes:
//     enumerated exactly with open();
//   - Follow is a finite tree of opens: enumerated exactly with open() and
//     follow()'s stopping rule, memoised by (R, j), the only things the value
//     depends on (winChanceAt(n, limit, R, j)).
//
// Strategies (every eval config), against RTP:
//   (a) the tester's: open the next box only when its survival chance
//       (1 − bustChanceNext) is ≥ 80%, else cash out;
//   (a') the same, following the loop instead of single boxes;
//   (b) take any profit: cash out the moment V > bet (follow otherwise);
//   (c) play to the end (follow);
//   (d) dodge every decider: cash out at each loop's last chance;
//   (d') dodge deciders only when ahead (V > RTP), else take the shot.
// Each is computed exactly, and simulated the way Game.tsx draws (rng.shuffle
// + pickFor). Default: 5k rounds per cell, 4 SE; FAIRNESS_FULL=1 runs every
// cell until its SE is ≤ 0.3%.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import {
  BOX_COUNTS,
  MAX_MULTIPLIER,
  RTP,
  SHARES,
  VOLATILITY,
  bustChanceNext,
  candidates,
  cashValue,
  follow,
  lastChance,
  limitFor,
  newBoard,
  open,
  openedInLoop,
  pickFor,
  prizeFor,
  remaining,
  type Board,
} from './math';

const FULL = !!import.meta.env.FAIRNESS_FULL;

type Mode = 'box' | 'loop';
/** At a checkpoint: cash out, or which way to continue. */
type Rule = (b: Board) => 'cash' | Mode;

const STRATEGIES: { name: string; rule: Rule }[] = [
  { name: '(a) open box only at ≥ 80% safe', rule: (b) => (1 - bustChanceNext(b) >= 0.8 ? 'box' : 'cash') },
  { name: "(a') follow only at ≥ 80% safe", rule: (b) => (1 - bustChanceNext(b) >= 0.8 ? 'loop' : 'cash') },
  { name: '(b) take any profit', rule: (b) => (cashValue(b) > 1 ? 'cash' : 'loop') },
  { name: '(c) play to the end', rule: () => 'loop' },
  { name: '(d) dodge every decider', rule: (b) => (lastChance(b) ? 'cash' : 'loop') },
  { name: "(d') dodge deciders when ahead", rule: (b) => (lastChance(b) && cashValue(b) > RTP ? 'cash' : 'loop') },
];

const done = (b: Board) => b.status !== 'live';
/** Where follow() stops after an open. */
const followStops = (b: Board) => done(b) || b.chain.length === 0 || lastChance(b);
const key = (b: Board) => `${remaining(b)}:${openedInLoop(b)}:${b.status}`;

/** Exact E[V after one Open box]: every candidate, equally likely. */
function afterBox(b: Board): number {
  const k = candidates(b).length;
  let s = 0;
  for (let i = 0; i < k; i++) s += cashValue(open(b, i));
  return s / k;
}

/** Exact distribution of where Follow stops: a list of (probability, board). */
function followOutcomes(b: Board, memo = new Map<string, [number, Board][]>()): [number, Board][] {
  const hit = memo.get(key(b));
  if (hit) return hit;
  const k = candidates(b).length;
  const out: [number, Board][] = [];
  for (let i = 0; i < k; i++) {
    const c = open(b, i);
    if (followStops(c)) out.push([1 / k, c]);
    else for (const [p, d] of followOutcomes(c, memo)) out.push([p / k, d]);
  }
  // Merge by state so the lists stay small.
  const merged = new Map<string, [number, Board]>();
  for (const [p, d] of out) {
    const m = merged.get(key(d));
    if (m) m[0] += p;
    else merged.set(key(d), [p, d]);
  }
  const res = [...merged.values()];
  memo.set(key(b), res);
  return res;
}

/** Exact expected payout of following `rule` from checkpoint b (memoised by (R, j)). */
function exactValue(b0: Board, rule: Rule, mode0: Mode | null = null): number {
  const memo = new Map<string, number>();
  const fmemo = new Map<string, [number, Board][]>();
  const at = (b: Board): number => {
    if (done(b)) return cashValue(b);
    const k = key(b);
    const hit = memo.get(k);
    if (hit !== undefined) return hit;
    const act = rule(b);
    const v = act === 'cash' ? cashValue(b) : step(b, act);
    memo.set(k, v);
    return v;
  };
  const step = (b: Board, mode: Mode): number => {
    if (mode === 'loop') return followOutcomes(b, fmemo).reduce((s, [p, d]) => s + p * at(d), 0);
    const n = candidates(b).length;
    return (at(open(b, 0)) + (n - 1) * at(open(b, 1))) / n;
  };
  return mode0 ? step(b0, mode0) : at(b0);
}

/** One round as Game.tsx plays it: shuffle at the bet, the bet opens one box, then the rule at each checkpoint. */
function playRound(n: number, limit: number, rule: Rule, rng: Rng): number {
  const perm = rng.shuffle([...Array(n).keys()]);
  const pick = (b: Board) => pickFor(b, perm);
  let b = open(newBoard(n, limit), pick(newBoard(n, limit)));
  while (!done(b)) {
    const act = rule(b);
    if (act === 'cash') break;
    if (act === 'box') b = open(b, pick(b));
    else {
      const seq = follow(b, pick);
      b = seq[seq.length - 1];
    }
  }
  return cashValue(b);
}

function mc(play: (rng: Rng) => number, rounds: number, seed: number, adaptive = false, maxRounds = 40_000_000) {
  const rng = createRng(seededSource(seed));
  let s = 0;
  let s2 = 0;
  let n = 0;
  let max = 0;
  const stat = () => {
    const mean = s / n;
    return { mean, se: Math.sqrt(Math.max(0, s2 / n - mean * mean) / n), max, n };
  };
  for (;;) {
    const goal = n + (n < rounds ? rounds - n : 100_000);
    for (; n < goal; n++) {
      const x = play(rng);
      s += x;
      s2 += x * x;
      if (x > max) max = x;
    }
    if (!adaptive || stat().se <= 0.003 || n >= maxRounds) return stat();
  }
}

const CONFIGS = Object.entries(VOLATILITY).map(([level, { n, share }]) => ({ level, n, limit: limitFor(n, share) }));
const ALL = BOX_COUNTS.flatMap((n) => SHARES.map((s) => ({ n, limit: limitFor(n, s) })));

describe('Loops fairness', () => {
  it('martingale at 60 checkpoints reached by play (incl. deciders and late boards): Open box and Follow both keep E[V] = V, exactly', () => {
    const rng = createRng(seededSource(71));
    let deciders = 0;
    let late = 0;
    let states = 0;
    for (let guard = 0; states < 60 && guard < 10_000; guard++) {
      const { n, limit } = ALL[rng.int(ALL.length)];
      const perm = rng.shuffle([...Array(n).keys()]);
      let b = open(newBoard(n, limit), pickFor(newBoard(n, limit), perm));
      const depth = rng.int(n);
      for (let i = 0; i < depth && !done(b); i++) b = open(b, pickFor(b, perm));
      if (done(b)) continue;
      const v = cashValue(b);
      expect(Math.abs(afterBox(b) - v)).toBeLessThan(1e-9 * Math.max(1, v));
      const outs = followOutcomes(b);
      expect(Math.abs(outs.reduce((s, [p]) => s + p, 0) - 1)).toBeLessThan(1e-12);
      expect(Math.abs(outs.reduce((s, [p, d]) => s + p * cashValue(d), 0) - v)).toBeLessThan(1e-9 * Math.max(1, v));
      if (lastChance(b)) deciders++;
      if (remaining(b) <= limit + 2) late++;
      states++;
    }
    expect(states).toBe(60);
    expect(deciders).toBeGreaterThan(0);
    expect(late).toBeGreaterThan(0);
  });

  it('martingale, exhaustive over (R, j): every live state of every setting, Open box and Follow keep E[V] = V', () => {
    for (const { n, limit } of ALL) {
      // Reach each (R, j) with the game's own opens: close loops of length 1 until R boxes remain, then extend j times.
      for (let R = n; R > limit; R--) {
        for (let j = 0; j < Math.min(limit, R); j++) {
          let b = newBoard(n, limit);
          while (remaining(b) > R) b = open(b, 0);
          for (let i = 0; i < j; i++) b = open(b, 1);
          if (done(b)) continue;
          expect(remaining(b)).toBe(R);
          expect(openedInLoop(b)).toBe(j);
          const v = cashValue(b);
          expect(Math.abs(afterBox(b) - v)).toBeLessThan(1e-9 * Math.max(1, v));
          expect(Math.abs(exactValue(b, () => 'cash', 'loop') - v)).toBeLessThan(1e-9 * Math.max(1, v));
        }
      }
      // The bet's own first box, from RTP.
      expect(Math.abs(afterBox(newBoard(n, limit)) - RTP)).toBeLessThan(1e-12);
    }
  });

  it('strategies, exactly: every rule returns RTP to 1e-9 on every setting', () => {
    for (const { n, limit } of ALL) {
      for (const { rule } of STRATEGIES) expect(Math.abs(exactValue(newBoard(n, limit), rule, 'box') - RTP)).toBeLessThan(1e-9);
    }
  });

  it(`strategies, simulated as Game.tsx draws (shuffle + pickFor): every eval config × rule within 4 SE of RTP${FULL ? ' (SE ≤ 0.3%)' : ''}`, () => {
    const rows: string[] = [];
    let seed = 800;
    for (const { level, n, limit } of CONFIGS) {
      for (const { name, rule } of STRATEGIES) {
        const r = mc((rng) => playRound(n, limit, rule, rng), FULL ? 200_000 : 5_000, seed++, FULL);
        rows.push(`${level.padEnd(8)} ${name.padEnd(36)} ${(100 * r.mean).toFixed(2)}% ± ${(100 * r.se).toFixed(2)}%  n=${r.n}  max=${r.max.toFixed(2)}`);
        expect(Math.abs(r.mean - RTP)).toBeLessThan(4 * r.se + 1e-9);
        expect(r.max).toBeLessThanOrEqual(prizeFor(n, limit) + 1e-9);
      }
    }
    expect(Math.max(...ALL.map(({ n, limit }) => prizeFor(n, limit)))).toBeLessThanOrEqual(MAX_MULTIPLIER);
    if (FULL) console.log(rows.join('\n'));
  }, 600_000);
});
