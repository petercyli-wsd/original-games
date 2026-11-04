// Fairness audit: can any way of playing Spanning beat the RTP?
//
// Each sweep reveals the rest of one layer edge by edge, each edge IN with its
// exact conditional chance (Kirchhoff: rng.next() < marginal), stopping early
// once the backed edges are settled. The prize is locked at RTP / P₀ (exact
// integer tree counts) and the cash-out is prize × P(win | revealed)
// (Burton–Pemantle determinant), so the value is a bounded martingale starting
// at RTP; by optional stopping every rule returns RTP.
//
// Decisions: the backed edges (IN or OUT) are chosen before the bet and
// priced at RTP / P₀, so the choice trades chance for prize, never value; they
// and the grid are locked while live. Mid-round there is only cash out or
// sweep on (Space and the button both call sweep(round); no auto mode). So
// every way of playing is a stopping rule at layer boundaries. Bet sweeps the
// first layer straight away: no decision before it.
//
// Checks, with the game's own functions (initialState, step, marginal,
// decide, resolution, winChance, prizeFor, quickPicks, allSets) and Game.tsx's
// settlement (win → prize, lose → 0, else prize × winChance):
//   - martingale: at 40+ checkpoints reached by random play on every grid,
//     every outcome of the next sweep is enumerated edge by edge with its
//     marginal chance: E[V after] = V (1e-9, float linear algebra);
//   - optimal stopping: the Snell envelope over the whole reveal tree equals
//     V (and the martingale step holds at every node) for 12 sampled pick
//     sets of the 3×3 and 3×4 eval pools; the heavy run (FAIRNESS_ROUNDS set)
//     does every set of those pools plus 8 sets each of the 4×4 and 4×5 ones;
//   - strategies (a)–(d) exactly on the same trees, and by Monte Carlo through
//     step() on every eval config (Monte Carlo is slow here, ~0.5 ms a round
//     with the strategies' look-ahead, so the default is 300 rounds).

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { RTP, SIZES, VOLATILITY, allSets, decide, grid, initialState, marginal, prizeFor, quickPicks, resolution, step, winChance, type Pick, type QuickPick, type Size, type TreeState } from './math';

/** Rounds per strategy run; the audit's heavy run sets FAIRNESS_ROUNDS. */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 300);
const HEAVY = !!import.meta.env.FAIRNESS_ROUNDS;

const EVAL = evalSpec.configs;

/** Game.tsx's value of a state after a sweep. */
function value(st: TreeState, picks: readonly Pick[], prize: number): { v: number; over: boolean } {
  const r = resolution(st, picks);
  if (r) return { v: r === 'win' ? prize : 0, over: true };
  return { v: prize * winChance(st, picks), over: false };
}

/** Every outcome of the next sweep (the rest of the layer, edge by edge, stopping once resolved), with its chance. */
function sweepOutcomes(st: TreeState, picks: readonly Pick[]): { st: TreeState; w: number }[] {
  const g = grid(st.size);
  const layer = g.edges[st.next].layer;
  const out: { st: TreeState; w: number }[] = [];
  const go = (s: TreeState, w: number) => {
    if (s.next >= g.edges.length || g.edges[s.next].layer !== layer || resolution(s, picks)) {
      out.push({ st: s, w });
      return;
    }
    const p = marginal(s, s.next);
    if (p > 0) go(decide(s, true), w * p);
    if (p < 1) go(decide(s, false), w * (1 - p));
  };
  go(st, 1);
  return out;
}

/** A stopping rule at a checkpoint: true = cash out. Gets the cash-out and the next sweep's outcomes. */
type Stop = (cash: number, kids: { v: number; over: boolean; w: number }[]) => boolean;

const STRATEGIES: { name: string; stop: Stop }[] = [
  // Survival: P(the next sweep doesn't settle the bet as lost).
  { name: '(a) sweep while survival ≥ 0.8', stop: (_, kids) => kids.reduce((s, k) => s + (k.over && k.v === 0 ? 0 : k.w), 0) < 0.8 },
  { name: '(b) take any profit', stop: (cash) => cash > 1 },
  { name: '(c) sweep to the end', stop: () => false },
  // Ride the swings: bank 1.5×, or bail out when some outcome of the next sweep would halve the value.
  { name: '(d) take 1.5× or dodge a halving', stop: (cash, kids) => cash >= 1.5 || kids.some((k) => k.w > 1e-12 && k.v <= 0.5 * cash) },
];

/**
 * Exact values over the whole reveal tree, in one traversal: [the Snell
 * envelope (checked equal to V at every node), then each strategy]. Also
 * checks the martingale step at every node.
 */
function exactValues(size: Size, picks: readonly Pick[]): { values: number[]; nodes: number } {
  const prize = prizeFor(size, picks);
  let nodes = 0;
  const go = (st: TreeState, canStop: boolean): number[] => {
    const here = value(st, picks, prize);
    if (here.over) return Array(STRATEGIES.length + 1).fill(here.v);
    nodes++;
    const outs = sweepOutcomes(st, picks);
    const kids = outs.map((o) => ({ ...value(o.st, picks, prize), w: o.w }));
    const mean = kids.reduce((s, k) => s + k.w * k.v, 0);
    expect(Math.abs(mean - here.v)).toBeLessThan(1e-9 * Math.max(1, here.v));
    const cont = Array(STRATEGIES.length + 1).fill(0);
    for (const o of outs) go(o.st, true).forEach((x, i) => (cont[i] += o.w * x));
    const snell = canStop ? Math.max(here.v, cont[0]) : cont[0];
    expect(Math.abs(snell - here.v)).toBeLessThan(1e-9 * Math.max(1, here.v));
    return [snell, ...STRATEGIES.map(({ stop }, i) => (canStop && stop(here.v, kids) ? here.v : cont[i + 1]))];
  };
  return { values: go(initialState(size), false), nodes };
}

/** One round through step(), as Game.tsx plays it. */
function playRound(size: Size, picks: readonly Pick[], stop: Stop, rng: Rng): number {
  const prize = prizeFor(size, picks);
  let st = initialState(size);
  let first = true;
  for (;;) {
    const here = value(st, picks, prize);
    if (here.over) return here.v;
    if (!first) {
      const kids = sweepOutcomes(st, picks).map((o) => ({ ...value(o.st, picks, prize), w: o.w }));
      if (stop(here.v, kids)) return here.v;
    }
    first = false;
    st = step(st, picks, rng).state;
  }
}

/** Pick sets for the exact checks: a sample of each small eval pool, or the whole pool in the heavy run. */
function exactSets(size: Size, k: number, kind: QuickPick, count: number, rng: Rng): Pick[][] {
  if (HEAVY) {
    const all = allSets(size).filter((x) => x.picks.length === k);
    const sorted = kind === 'random' ? all : [...all].sort((a, b) => (kind === 'safe' ? b.p - a.p : a.p - b.p));
    const pool = kind === 'random' ? sorted : sorted.slice(0, Math.max(1, Math.floor(sorted.length / 4)));
    return pool.map((x) => x.picks);
  }
  return Array.from({ length: count }, () => quickPicks(size, k, kind, rng));
}

describe('Spanning fairness', () => {
  it('the value is a martingale at checkpoints on every grid (every sweep outcome enumerated)', () => {
    const rng = createRng(seededSource(4242));
    let n = 0;
    for (const size of SIZES) {
      let found = 0;
      for (let t = 0; t < 80 && found < 10; t++) {
        const k = 1 + rng.int(3);
        const kind = (['safe', 'random', 'long'] as const)[rng.int(3)];
        const picks = quickPicks(size, k, kind, rng);
        const prize = prizeFor(size, picks);
        // The start is worth RTP.
        expect(Math.abs(prize * winChance(initialState(size), picks) - RTP)).toBeLessThan(1e-9);
        let st = step(initialState(size), picks, rng).state;
        const depth = rng.int(grid(size).layers);
        for (let d = 0; d < depth && !resolution(st, picks); d++) st = step(st, picks, rng).state;
        const here = value(st, picks, prize);
        if (here.over) continue;
        const outs = sweepOutcomes(st, picks);
        expect(Math.abs(outs.reduce((s, o) => s + o.w, 0) - 1)).toBeLessThan(1e-12);
        const after = outs.reduce((s, o) => s + o.w * value(o.st, picks, prize).v, 0);
        expect(Math.abs(after - here.v)).toBeLessThan(1e-9 * Math.max(1, here.v));
        n++;
        found++;
      }
    }
    expect(n).toBeGreaterThan(30);
  });

  it('optimal stopping and strategies (a)–(d) are exactly RTP over the whole reveal tree (3×3 / 3×4 pools; 4×4 / 4×5 samples in the heavy run)', () => {
    const rng = createRng(seededSource(77));
    const rows: string[] = [];
    const levels = HEAVY ? (['low', 'medium', 'high', 'extreme'] as const) : (['low', 'medium'] as const);
    for (const level of levels) {
      const { size, k, kind } = VOLATILITY[level];
      const sets = level === 'high' || level === 'extreme' ? Array.from({ length: 8 }, () => quickPicks(size, k, kind, rng)) : exactSets(size, k, kind, 12, rng);
      const sums = Array(STRATEGIES.length + 1).fill(0);
      let nodes = 0;
      for (const picks of sets) {
        const r = exactValues(size, picks);
        nodes += r.nodes;
        r.values.forEach((ev, i) => {
          expect(Math.abs(ev - RTP)).toBeLessThan(1e-9);
          sums[i] += ev;
        });
      }
      ['Snell envelope', ...STRATEGIES.map((s) => s.name)].forEach((name, i) =>
        rows.push(`${level} ${size} (${sets.length} sets, ${nodes} live nodes) | ${name} | ${((sums[i] / sets.length) * 100).toFixed(9)}%`),
      );
    }
    if (HEAVY) console.log(rows.join('\n'));
  });

  it(`strategies (a)–(d) through step() return RTP on every eval config (${ROUNDS} rounds, 4 SE)`, () => {
    const rows: string[] = [];
    for (const [ci, { label, params }] of EVAL.entries()) {
      for (const [si, { name, stop }] of STRATEGIES.entries()) {
        const rng = createRng(seededSource(55_000 + ci * 31 + si));
        let sum = 0;
        let sq = 0;
        for (let i = 0; i < ROUNDS; i++) {
          const picks = quickPicks(params.size, params.k, params.kind, rng);
          const x = playRound(params.size, picks, stop, rng);
          sum += x;
          sq += x * x;
        }
        const mean = sum / ROUNDS;
        const se = Math.sqrt(Math.max(0, sq / ROUNDS - mean * mean) / ROUNDS);
        rows.push(`${label} | ${name} | ${(mean * 100).toFixed(2)}% ± ${(se * 100).toFixed(2)}`);
        expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-9);
      }
    }
    if (HEAVY) console.log(rows.join('\n'));
  });
});
