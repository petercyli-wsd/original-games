// Fairness audit: can any way of playing Homecoming beat the RTP?
//
// Dimension and side are fixed at the bet (the chips are disabled while live),
// so the only decision is when to cash out: at each checkpoint, take
// cashAt(pos, left) or press Step. The walk is a finite-horizon Markov chain
// on (position, steps left), so the best possible stopping rule is given by
// backward induction (the Snell envelope): U = max(cash now, E[U after a
// step]). If U at the start equals RTP, no strategy, however clever or
// history-dependent, returns more. The exact test computes U for every
// setting, through the game's own walkStep() over each of the 2d moves.
//
// Strategies, per eval config:
//   (a) the tester's: step while the next step's survival (the chance it
//       does not settle as a loss) is ≥ 80%, else cash out;
//   (b) take any profit: cash out the moment V > 1;
//   (c) walk to the end;
//   (d) the strongest: the optimal (Snell) rule, exact; and by Monte Carlo
//       "lock in any rise" (cash out after a step that raised V), a 50%
//       stop-loss, and "bail once the backed side drops below 30%".

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { BUDGET, DIMS, RTP, SIDES, cashAt, movesOf, origin, prizeFor, randomMove, sideChance, walkStep, type Pos, type Settings } from './math';

/** Rounds per Monte Carlo run (each walkStep prices the state, so this is kept small); the audit's heavy run sets FAIRNESS_ROUNDS=200000. */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 4_000);

/** The u that walkStep reads as move i (the middle of its slice). */
const uOf = (dim: number, i: number) => (i + 0.5) / (2 * dim);

/** The 2d equally likely next steps from (p, left), each through the real walkStep. */
const outcomes = (s: Settings, p: Pos, left: number) => movesOf(s.dim).map((_, i) => walkStep(s, p, left, uOf(s.dim, i)));

/** Canonical key: sorted absolute coordinates and steps left (the chance only depends on these). */
const keyOf = (p: Pos, left: number) => `${p.map(Math.abs).sort((a, b) => a - b).join(',')}|${left}`;

type Stop = (s: Settings, p: Pos, left: number, cash: number) => boolean;

/** Exact value of a Markov stopping rule from the start (stop = cash out at this checkpoint). */
function exactValue(s: Settings, stop: Stop): number {
  const memo = new Map<string, number>();
  const value = (p: Pos, left: number): number => {
    const cash = cashAt(s, p, left);
    if (stop(s, p, left, cash)) return cash;
    const k = keyOf(p, left);
    const hit = memo.get(k);
    if (hit !== undefined) return hit;
    let v = 0;
    for (const st of outcomes(s, p, left)) v += (st.verdict ? st.cash : value(st.to, left - 1)) / (2 * s.dim);
    memo.set(k, v);
    return v;
  };
  return value(origin(s.dim), BUDGET);
}

/** The Snell envelope: the value of the best possible stopping rule, from the start. */
function optimalValue(s: Settings): number {
  const memo = new Map<string, number>();
  const value = (p: Pos, left: number): number => {
    const k = keyOf(p, left);
    const hit = memo.get(k);
    if (hit !== undefined) return hit;
    let cont = 0;
    for (const st of outcomes(s, p, left)) cont += (st.verdict ? st.cash : value(st.to, left - 1)) / (2 * s.dim);
    const v = Math.max(cashAt(s, p, left), cont);
    memo.set(k, v);
    return v;
  };
  return value(origin(s.dim), BUDGET);
}

/** Chance the next step does not settle as a loss for the backed side. */
const survivalMemo = new Map<string, number>();
function survival(s: Settings, p: Pos, left: number): number {
  const k = `${s.dim}${s.side}|${keyOf(p, left)}`;
  let v = survivalMemo.get(k);
  if (v === undefined) survivalMemo.set(k, (v = outcomes(s, p, left).filter((st) => st.verdict !== 'lost').length / (2 * s.dim)));
  return v;
}

/** One round exactly as Game.tsx plays it (step / cashOut), with a stopping rule that may look at the previous cash. */
function playRound(s: Settings, stop: (p: Pos, left: number, cash: number, prev: number | null) => boolean, rng: Rng): number {
  let pos: Pos = origin(s.dim);
  let left = BUDGET;
  let cash = RTP;
  let prev: number | null = null;
  for (;;) {
    if (stop(pos, left, cash, prev)) return cash;
    const st = walkStep(s, pos, left, rng.next());
    if (st.verdict) return st.cash;
    prev = cash;
    pos = st.to;
    left--;
    cash = st.cash;
  }
}

function mc(play: (rng: Rng) => number, rounds: number, seed: number) {
  const rng = createRng(seededSource(seed));
  let s = 0;
  let s2 = 0;
  for (let i = 0; i < rounds; i++) {
    const x = play(rng);
    s += x;
    s2 += x * x;
  }
  const mean = s / rounds;
  return { mean, se: Math.sqrt(Math.max(0, s2 / rounds - mean * mean) / rounds) };
}

const ALL: Settings[] = DIMS.flatMap((dim) => SIDES.map((side) => ({ dim, side })));

describe('Homecoming fairness', () => {
  it('randomMove splits [0, 1) into 2d equal slices, one per move', () => {
    for (const dim of DIMS) {
      const moves = movesOf(dim);
      const eps = 2 ** -32;
      for (let i = 0; i < 2 * dim; i++) {
        expect(randomMove(dim, i / (2 * dim))).toEqual(moves[i]);
        expect(randomMove(dim, (i + 1) / (2 * dim) - eps)).toEqual(moves[i]);
      }
      expect(randomMove(dim, 1 - eps)).toEqual(moves[2 * dim - 1]);
      expect(new Set(moves.map((m) => `${m.axis}${m.sign}`)).size).toBe(2 * dim);
    }
  });

  it('martingale: at 30+ reached states per setting, the cash-out equals its average over the next step', () => {
    const rng = createRng(seededSource(4242));
    for (const s of ALL) {
      const states = new Map<string, { p: Pos; left: number }>();
      for (let r = 0; r < 400 && states.size < 200; r++) {
        let p: Pos = origin(s.dim);
        let left = BUDGET;
        for (;;) {
          states.set(keyOf(p, left), { p, left });
          const st = walkStep(s, p, left, rng.next());
          if (st.verdict) break;
          p = st.to;
          left--;
        }
      }
      // Near the end: one step left, at every distance that can still settle either way.
      for (let d = 1; d <= 3; d++) {
        const p = origin(s.dim);
        p[0] = d;
        for (const left of [1, 2, 3]) if (d <= left) states.set(keyOf(p, left), { p, left });
      }
      expect(states.size).toBeGreaterThanOrEqual(30);
      for (const { p, left } of states.values()) {
        let ev = 0;
        for (const st of outcomes(s, p, left)) ev += st.cash / (2 * s.dim);
        expect(Math.abs(ev - cashAt(s, p, left))).toBeLessThan(1e-12);
        // The cash-out is the prize times the chance shown on screen.
        if (left < BUDGET || p.some((v) => v !== 0)) expect(cashAt(s, p, left)).toBeCloseTo(prizeFor(s) * sideChance(s.side, s.dim, p, left), 12);
      }
    }
  });

  it('exact: the best possible stopping rule (Snell envelope) and (a)–(c) are all worth exactly RTP on every setting', () => {
    for (const s of ALL) {
      expect(optimalValue(s)).toBeCloseTo(RTP, 12);
      expect(exactValue(s, (ss, p, left) => survival(ss, p, left) < 0.8)).toBeCloseTo(RTP, 12); // (a)
      expect(exactValue(s, (_, __, ___, cash) => cash > 1)).toBeCloseTo(RTP, 12); // (b)
      expect(exactValue(s, () => false)).toBeCloseTo(RTP, 12); // (c)
      expect(exactValue(s, (ss, p, left) => sideChance(ss.side, ss.dim, p, left) < 0.3 && left < BUDGET)).toBeCloseTo(RTP, 12);
      expect(exactValue(s, (_, __, ___, cash) => cash < 0.5)).toBeCloseTo(RTP, 12);
    }
  });

  it('Monte Carlo with the real walkStep: (a)–(d) on every eval config are within 4 SE of RTP', () => {
    const rows: string[] = [];
    evalSpec.configs.forEach(({ label, params: s }, ci) => {
      const plays: { name: string; stop: (p: Pos, left: number, cash: number, prev: number | null) => boolean }[] = [
        { name: '(a) step while survival ≥ 80%', stop: (p, left) => survival(s, p, left) < 0.8 },
        { name: '(b) any profit', stop: (_, __, cash) => cash > 1 },
        { name: '(c) to the end', stop: () => false },
        { name: '(d) lock in any rise', stop: (_, __, cash, prev) => prev !== null && cash > prev },
        { name: '(d) stop-loss 50%', stop: (_, __, cash) => cash < 0.5 },
        { name: '(d) bail below 30% chance', stop: (p, left) => left < BUDGET && sideChance(s.side, s.dim, p, left) < 0.3 },
      ];
      plays.forEach(({ name, stop }, si) => {
        const { mean, se } = mc((r) => playRound(s, stop, r), ROUNDS, 6100 + 13 * ci + si);
        rows.push(`${label.padEnd(28)} ${name.padEnd(30)} ${(mean * 100).toFixed(2)}% ± ${(se * 100).toFixed(2)}%`);
        expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-9); // (+1e-9: float summation error when a rule always pays RTP, se = 0)
      });
    });
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
