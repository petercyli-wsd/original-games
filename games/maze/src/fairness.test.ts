// Fairness audit: can any way of playing Maze beat the RTP?
//
// The maze and start cell are fixed at the bet (the pickers are disabled
// while live) and the first roll of 3 moves plays at once. At each checkpoint
// the player may cash out (prize × h(ball)), Step (1 move) or Roll (3 moves);
// Auto moves one step at a time and cashes once the cash-out reaches its
// target. Every one of these is a stopping rule on the ball's walk, so the
// claim "move only when the next roll is ≥ 80% trap-free" fails exactly when
// the cash-out is a martingale for both kinds of move:
//
//     E[V(ball after a step)] = E[V(ball after a roll)] = V(ball now),
//
// with V = prize at the exit, 0 in a trap, prize × h elsewhere (Game.tsx).
// Each move picks a neighbour by rng.int(n), so the next event has finitely
// many outcomes: the test enumerates them exactly through the real `move` and
// `roll` (a scripted rng feeds the midpoint of each of the n draw bins), at
// 60+ cells reached by random rounds over every maze and start, plus every
// cell next to a trap or the exit.
//
// Strategies, per eval config, on the real `roll`/`move`:
//   (a) the tester's: Roll if the next roll is ≥ 80% trap-free, else Step if
//       the next move is ≥ 80% trap-free, else cash out;
//   (b) take any profit: Step, cash out the moment the cash-out exceeds the bet;
//   (c) Roll to the end;
//   (d) dodge traps: Step, cash out whenever a trap is next door unless the
//       exit is too (then chase it);
//   (e) Auto at ×2 (cash once the cash-out reaches 2× after any move).
// Every one of them decides by the ball's cell alone, so each is also valued
// exactly: (b)–(e) with the game's own `harmonic` solver (stop cells absorbing
// at their cash-out), and the rules that mix Roll and Step ((a), (c) and a
// "Roll, but Step near a trap or the exit" rule) by solving their own linear
// system over the enumerated move outcomes; all averaged over the exact first
// roll, from every allowed start.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { ALL_SETTINGS, MAX_MULTIPLIER, ROLL, RTP, autoStops, endOf, gaussSolve, harmonic, isEnd, maze, move, prizeFor, roll, rollOutlook, type Maze, type Settings } from './math';

/** Rounds per strategy run; the audit's 200k run sets FAIRNESS_ROUNDS=200000. */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 20_000);

/** The cash-out with the ball on a cell, exactly as Game.tsx computes it. */
const valueAt = (m: Maze, prize: number, c: number) => {
  const e = endOf(m, c);
  return e === 'exit' ? prize : e === 'trap' ? 0 : prize * m.odds[c];
};

/** An rng that replays a fixed list of draws (then fails loudly). */
function scripted(us: number[]): Rng {
  let i = 0;
  return createRng(() => {
    if (i >= us.length) throw new Error('scripted rng exhausted');
    return us[i++];
  });
}

/**
 * Every outcome of the next `n` moves from `at`, with its exact probability,
 * enumerated through the real `roll`: each move's n draw bins are fed their
 * midpoints, and the cell reached must be that bin's neighbour.
 */
function enumerateRoll(m: Maze, at: number, n: number): { cell: number; w: number }[] {
  const out: { cell: number; w: number }[] = [];
  const rec = (c: number, left: number, us: number[], w: number) => {
    if (left === 0 || isEnd(m, c)) {
      const path = roll(m, at, n, scripted(us));
      const end = path.length ? path[path.length - 1] : at;
      expect(end).toBe(c);
      out.push({ cell: c, w });
      return;
    }
    const k = m.nbrs[c].length;
    for (let i = 0; i < k; i++) {
      const u = (i + 0.5) / k;
      // The real single move with this draw goes to neighbour i.
      expect(move(m, c, scripted([u]))).toBe(m.nbrs[c][i]);
      rec(m.nbrs[c][i], left - 1, [...us, u], w / k);
    }
  };
  rec(at, n, [], 1);
  return out;
}

interface Checkpoint {
  m: Maze;
  s: Settings;
  prize: number;
  at: number;
}

/** What to do at a checkpoint: cash out, or move 1 / ROLL cells. */
type Policy = (c: Checkpoint) => 'cash' | 1 | typeof ROLL;

/** A manual round exactly as Game.tsx plays it: the first roll is automatic, then the policy decides at each checkpoint. */
function playManual(s: Settings, policy: Policy, rng: Rng): number {
  const m = maze(s.maze);
  const prize = prizeFor(s);
  let at = s.start;
  let n: number = ROLL;
  for (;;) {
    const path = roll(m, at, n, rng);
    at = path[path.length - 1];
    if (isEnd(m, at)) return valueAt(m, prize, at);
    const act = policy({ m, s, prize, at });
    if (act === 'cash') return valueAt(m, prize, at);
    n = act;
  }
}

/** An Auto round as Game.tsx plays it: one move at a time, cash out once the cash-out reaches the target. */
function playAuto(s: Settings, target: number | null, rng: Rng): number {
  const m = maze(s.maze);
  const prize = prizeFor(s);
  const tgt = target !== null && target < prize ? target : null;
  let at = s.start;
  for (;;) {
    at = move(m, at, rng);
    const cash = valueAt(m, prize, at);
    if (isEnd(m, at) || autoStops(cash, tgt)) return cash;
  }
}

const trapNext = (c: Checkpoint) => c.m.nbrs[c.at].some((v) => c.m.traps.includes(v));
const exitNext = (c: Checkpoint) => c.m.nbrs[c.at].includes(c.m.exit);
const stepTrap = (c: Checkpoint) => c.m.nbrs[c.at].filter((v) => c.m.traps.includes(v)).length / c.m.nbrs[c.at].length;

interface Strategy {
  name: string;
  play: (s: Settings, rng: Rng) => number;
  /** For cell-only Step rules: the cells where it cashes out (exact valuation). */
  stopsAt?: (c: Checkpoint) => boolean;
  /** Auto rules move from the start without the automatic first roll. */
  auto?: number | null;
  /** For cell-only rules that mix Step and Roll: the policy itself (exact valuation). */
  policy?: Policy;
}

/** The tester's rule: Roll if the next roll is ≥ 80% trap-free, else Step if the next move is, else cash out. */
const tester: Policy = (c) => (rollOutlook(c.m, c.at, ROLL).trap <= 0.2 ? ROLL : stepTrap(c) <= 0.2 ? 1 : 'cash');

const STRATEGIES: Strategy[] = [
  { name: '(a) roll/step only if ≥ 80% trap-free', play: (s, rng) => playManual(s, tester, rng), policy: tester },
  {
    name: '(b) step, take any profit',
    play: (s, rng) => playManual(s, (c) => (valueAt(c.m, c.prize, c.at) > 1 ? 'cash' : 1), rng),
    stopsAt: (c) => valueAt(c.m, c.prize, c.at) > 1,
  },
  { name: '(c) roll to the end', play: (s, rng) => playManual(s, () => ROLL, rng), stopsAt: () => false },
  {
    name: '(d) step, cash when a trap is next door',
    play: (s, rng) => playManual(s, (c) => (trapNext(c) && !exitNext(c) ? 'cash' : 1), rng),
    stopsAt: (c) => trapNext(c) && !exitNext(c),
  },
  { name: '(e) Auto, cash at ×2', play: (s, rng) => playAuto(s, 2, rng), auto: 2 },
];

/** Exact value of a strategy that cashes on a set of cells (Step play, or Auto), via the game's harmonic solver. */
function exactValue(s: Settings, st: Strategy): number {
  const m = maze(s.maze);
  const prize = prizeFor(s);
  const fixed = new Map<number, number>();
  for (let c = 0; c < m.w * m.h; c++) {
    const cp = { m, s, prize, at: c };
    if (isEnd(m, c)) fixed.set(c, valueAt(m, prize, c));
    else if (st.auto !== undefined ? autoStops(valueAt(m, prize, c), st.auto !== null && st.auto < prize ? st.auto : null) : st.stopsAt!(cp)) fixed.set(c, valueAt(m, prize, c));
  }
  const W = harmonic(m.nbrs, fixed).value;
  // Auto: the rule is checked after every move, from the start cell. Manual: the first roll of 3 is automatic.
  const first = enumerateRoll(m, s.start, st.auto !== undefined ? 1 : ROLL);
  return first.reduce((a, { cell, w }) => a + w * W[cell], 0);
}

const transitionCache = new Map<string, { cell: number; w: number }[]>();
/** enumerateRoll, cached by maze, cell and move count (it doesn't depend on the start or prize). */
function transitions(m: Maze, at: number, n: number) {
  const key = `${m.id}/${at}/${n}`;
  let t = transitionCache.get(key);
  if (!t) transitionCache.set(key, (t = enumerateRoll(m, at, n)));
  return t;
}

/**
 * Exact value of any manual policy that decides by the ball's cell (cash, Step
 * or Roll), mixing move lengths: W = cash-out on stop cells and ends, and on
 * every other cell the exact average of W over the enumerated outcomes of the
 * chosen move. A linear system, solved with the game's own Gaussian
 * elimination, then averaged over the automatic first roll.
 */
function exactPolicyValue(s: Settings, policy: Policy): number {
  const m = maze(s.maze);
  const prize = prizeFor(s);
  const n = m.w * m.h;
  const W = new Float64Array(n);
  const next: ({ cell: number; w: number }[] | null)[] = [];
  for (let c = 0; c < n; c++) {
    const act = isEnd(m, c) ? 'cash' : policy({ m, s, prize, at: c });
    if (act === 'cash') W[c] = valueAt(m, prize, c);
    next.push(act === 'cash' ? null : transitions(m, c, act));
  }
  // Unknowns: the cells where the policy moves on. Solve (I − P) W = P·(fixed cash-outs) exactly.
  const free = [...Array(n).keys()].filter((c) => next[c]);
  const at = new Map(free.map((c, k) => [c, k]));
  const A = free.map(() => new Array<number>(free.length).fill(0));
  const B = free.map(() => [0]);
  free.forEach((c, k) => {
    A[k][k] += 1;
    for (const o of next[c]!) {
      const j = at.get(o.cell);
      if (j !== undefined) A[k][j] -= o.w;
      else B[k][0] += o.w * W[o.cell];
    }
  });
  if (free.length) gaussSolve(A, B).forEach(([v], k) => (W[free[k]] = v));
  return transitions(m, s.start, ROLL).reduce((a, o) => a + o.w * W[o.cell], 0);
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

describe('Maze fairness', () => {
  it('martingale (exact): at 60+ reached cells and every cell next to a trap or the exit, E[V after a Step] = E[V after a Roll] = V now', () => {
    const rng = createRng(seededSource(901));
    const states: { s: Settings; at: number }[] = [];
    while (states.length < 60) {
      const s = ALL_SETTINGS[rng.int(ALL_SETTINGS.length)];
      const m = maze(s.maze);
      const path = roll(m, s.start, rng.int(12), rng);
      const at = path.length ? path[path.length - 1] : s.start;
      if (!isEnd(m, at)) states.push({ s, at });
    }
    for (const s of evalSpec.configs.map((c) => c.params)) {
      const m = maze(s.maze);
      for (let c = 0; c < m.w * m.h; c++) if (!isEnd(m, c) && m.nbrs[c].some((v) => isEnd(m, v))) states.push({ s, at: c });
    }
    for (const { s, at } of states) {
      const m = maze(s.maze);
      const prize = prizeFor(s);
      const v = valueAt(m, prize, at);
      for (const n of [1, ROLL]) {
        const outs = enumerateRoll(m, at, n);
        expect(Math.abs(outs.reduce((a, o) => a + o.w, 0) - 1)).toBeLessThan(1e-12);
        const after = outs.reduce((a, o) => a + o.w * valueAt(m, prize, o.cell), 0);
        expect(Math.abs(after - v)).toBeLessThan(1e-9 * prize);
      }
    }
  });

  it('the start is worth RTP: E[V after the automatic first roll] = RTP for every allowed start', () => {
    for (const s of ALL_SETTINGS) {
      const m = maze(s.maze);
      const after = enumerateRoll(m, s.start, ROLL).reduce((a, o) => a + o.w * valueAt(m, prizeFor(s), o.cell), 0);
      expect(after).toBeCloseTo(RTP, 10);
    }
  });

  it('every cell-based Step / Auto rule is worth exactly RTP from every allowed start (harmonic valuation)', () => {
    const rules = [...STRATEGIES.filter((st) => st.stopsAt || st.auto !== undefined)];
    for (const target of [null, 1.5, 3, 5, 10, 25]) rules.push({ name: `Auto ${target}`, play: () => 0, auto: target });
    for (const s of ALL_SETTINGS) for (const st of rules) expect(exactValue(s, st)).toBeCloseTo(RTP, 9);
  });

  it('rules that mix Roll and Step (the tester’s (a), Roll to the end, Roll but Step near a trap or the exit) are worth exactly RTP from every allowed start', () => {
    const late: Policy = (c) => (c.m.toTrap[c.at] <= 2 || c.m.toExit[c.at] <= 2 ? 1 : ROLL);
    for (const s of ALL_SETTINGS) {
      expect(exactPolicyValue(s, tester)).toBeCloseTo(RTP, 9);
      expect(exactPolicyValue(s, () => ROLL)).toBeCloseTo(RTP, 9);
      expect(exactPolicyValue(s, late)).toBeCloseTo(RTP, 9);
    }
  });

  it('strategies (a)–(e) on every eval config return RTP within 4 SE on the real walk, never above the max', () => {
    const rows: string[] = [];
    evalSpec.configs.forEach(({ label, params }, ci) => {
      STRATEGIES.forEach((st, si) => {
        const res = mc((r) => st.play(params, r), ROUNDS, 9100 + 13 * ci + si);
        rows.push(`${label.padEnd(44)} ${st.name.padEnd(42)} ${(res.mean * 100).toFixed(2)}% ± ${(res.se * 100).toFixed(2)}%  max ${res.max.toFixed(2)}×`);
        expect(Math.abs(res.mean - RTP)).toBeLessThan(4 * res.se + 1e-12);
        expect(res.max).toBeLessThanOrEqual(MAX_MULTIPLIER);
      });
    });
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
