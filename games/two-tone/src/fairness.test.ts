// Fairness audit: can any way of playing Two-Tone beat the RTP?
//
// Each edge is a uniform pick among the open pairs (open[rng.int(open.length)]
// in Game.tsx). A safe edge multiplies the cash-out by 1/(1 − q), where q is
// the fatal share of the open pairs; a fatal one pays 0. So E[V after the
// edge] = (1 − q) · V/(1 − q) = V: the value is a martingale from RTP, and the
// round is bounded (at most E edges), so by optional stopping every rule
// returns RTP. The only thing that can break this is q not being the true
// fatal share of the pairs the draw picks from, which is what the martingale
// check enumerates.
//
// Decisions mid-round: only cash out or add an edge (nodes and target are
// locked while live). Free edges (q = 0) are drawn without a checkpoint, and
// the round auto-cashes at the target or when every open pair is fatal. Space
// and the button both call draw(round); there is no auto mode.
//
// Checks, with the game's own functions (openPairs, risk, isFatal, addEdge,
// afterSafeEdge, profile) and Game.tsx's flow:
//   - martingale: at 40+ checkpoints reached by random play on every offered
//     setting, every open pair is enumerated; E[V after] = V (1e-12);
//   - optimal stopping: with V = cash × h(profile, m), the Snell factor h is 1
//     at every reachable profile, so no strategy beats RTP;
//   - strategies (a)–(d) exactly (forward DP over (profile, m, cash), which is
//     a sufficient state: the future depends on the graph only through its
//     tone-class profile) on every eval config, and by Monte Carlo through the
//     real draw on every eval config.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { EDGES, NODES, RTP, addEdge, afterSafeEdge, edgesAllowed, emptyGraph, isFatal, openPairs, profile, risk, type Graph } from './math';

/** Rounds per strategy run; the audit's heavy run sets FAIRNESS_ROUNDS. */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 6_000);

const SETTINGS = NODES.flatMap((n) => EDGES.filter((e) => edgesAllowed(n, e)).map((e) => ({ nodes: n, edges: e })));
const EVAL = evalSpec.configs;
/** Settings for the exact whole-chain checks: the eval configs here, every offered setting in the heavy run (FAIRNESS_ROUNDS set). */
const EXACT = import.meta.env.FAIRNESS_ROUNDS ? SETTINGS : EVAL.map((c) => ({ nodes: c.params.nodes, edges: c.params.edges }));

/** What Game.tsx does after a safe edge: 'over' (target or saturated: auto-cash), 'free' (q = 0: draw on), or 'checkpoint'. */
function after(g: Graph, target: number): 'over' | 'free' | 'checkpoint' {
  if (g.edges.length >= target) return 'over';
  const { q } = risk(g);
  return q >= 1 ? 'over' : q === 0 ? 'free' : 'checkpoint';
}

/** A stopping rule at a checkpoint: true = cash out. */
type Stop = (g: Graph, cash: number) => boolean;

const STRATEGIES: { name: string; stop: Stop }[] = [
  { name: '(a) add while safe ≥ 0.8', stop: (g) => 1 - risk(g).q < 0.8 },
  { name: '(b) take any profit', stop: (_, cash) => cash > 1 },
  { name: '(c) place every edge', stop: () => false },
  // Ride the swings: bank 1.5×, or bail out once the next edge is a 30%+ bust.
  { name: '(d) take 1.5× or stop at q ≥ 0.3', stop: (g, cash) => cash >= 1.5 || risk(g).q >= 0.3 },
];

const profileKey = (g: Graph) => profile(g).map(([a, b]) => `${a}.${b}`).join(',');

/** Exact expected payout of a stopping rule: forward DP, merging graphs with the same (profile, cash). */
function exactValue(nodes: number, target: number, stop: Stop): { ev: number; states: number } {
  type Entry = { g: Graph; cash: number; mass: number; free: boolean };
  let level = new Map<string, Entry>([['start', { g: emptyGraph(nodes), cash: RTP, mass: 1, free: true }]]);
  let ev = 0;
  let states = 0;
  while (level.size) {
    states += level.size;
    const next = new Map<string, Entry>();
    for (const e of level.values()) {
      if (!e.free && stop(e.g, e.cash)) {
        ev += e.mass * e.cash;
        continue;
      }
      const open = openPairs(e.g);
      const { q } = risk(e.g);
      for (const [u, v] of open) {
        if (isFatal(e.g, u, v)) continue;
        const w = e.mass / open.length;
        const g = addEdge(e.g, u, v);
        const cash = afterSafeEdge(e.cash, q);
        const a = after(g, target);
        if (a === 'over') {
          ev += w * cash;
          continue;
        }
        const key = `${profileKey(g)}|${cash.toPrecision(14)}|${a}`;
        const hit = next.get(key);
        if (hit) hit.mass += w;
        else next.set(key, { g, cash, mass: w, free: a === 'free' });
      }
    }
    level = next;
  }
  return { ev, states };
}

/** The Snell factor h(profile, m): V* = cash × h. It must be 1 everywhere. */
function snell(nodes: number, target: number): { worst: number; states: number } {
  const memo = new Map<string, number>();
  let worst = 0;
  const h = (g: Graph, free: boolean): number => {
    const key = `${profileKey(g)}|${g.edges.length}|${free}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const open = openPairs(g);
    const { q } = risk(g);
    let cont = 0;
    for (const [u, v] of open) {
      if (isFatal(g, u, v)) continue;
      const c = addEdge(g, u, v);
      const a = after(c, target);
      cont += (afterSafeEdge(1, q) / open.length) * (a === 'over' ? 1 : h(c, a === 'free'));
    }
    const x = free ? cont : Math.max(1, cont);
    worst = Math.max(worst, Math.abs(cont - 1));
    memo.set(key, x);
    return x;
  };
  const top = h(emptyGraph(nodes), true);
  expect(Math.abs(top - 1)).toBeLessThan(1e-12);
  return { worst, states: memo.size };
}

/** One round through the real draw, as Game.tsx plays it. */
function playRound(nodes: number, target: number, stop: Stop, rng: Rng): number {
  let g = emptyGraph(nodes);
  let cash = RTP;
  let free = true;
  for (;;) {
    if (!free && stop(g, cash)) return cash;
    const open = openPairs(g);
    const { q } = risk(g);
    const [u, v] = open[rng.int(open.length)];
    if (isFatal(g, u, v)) return 0;
    cash = afterSafeEdge(cash, q);
    g = addEdge(g, u, v);
    const a = after(g, target);
    if (a === 'over') return cash;
    free = a === 'free';
  }
}

describe('Two-Tone fairness', () => {
  it('the value is a martingale at checkpoints on every offered setting (every open pair enumerated, 1e-12)', () => {
    let n = 0;
    for (const [si, { nodes, edges: target }] of SETTINGS.entries()) {
      const rng = createRng(seededSource(500 + si));
      let found = 0;
      for (let tries = 0; tries < 200 && found < 4; tries++) {
        // Random play to a random checkpoint, with the cash carried along the path.
        let g = emptyGraph(nodes);
        let cash = RTP;
        const stopAt = rng.int(target);
        for (;;) {
          const open = openPairs(g);
          const { q, fatal } = risk(g);
          // risk() is the literal share of open pairs that close an odd cycle.
          expect(open.length).toBe(risk(g).open);
          expect(open.filter(([u, v]) => isFatal(g, u, v)).length).toBe(fatal);
          if (q > 0 && g.edges.length >= stopAt) {
            let ev = 0;
            for (const [u, v] of open) {
              if (isFatal(g, u, v)) continue;
              ev += afterSafeEdge(cash, q) / open.length;
            }
            expect(Math.abs(ev - cash)).toBeLessThan(1e-12 * Math.max(1, cash));
            found++;
            n++;
            break;
          }
          const [u, v] = open[rng.int(open.length)];
          if (isFatal(g, u, v)) break;
          cash = afterSafeEdge(cash, q);
          g = addEdge(g, u, v);
          if (after(g, target) === 'over') break;
        }
      }
    }
    expect(n).toBeGreaterThan(30);
  });

  it(`optimal stopping: the Snell factor is 1 at every reachable profile (${EXACT.length} settings)`, () => {
    for (const s of EXACT) {
      const { worst, states } = snell(s.nodes, s.edges);
      expect(states).toBeGreaterThan(5);
      expect(worst).toBeLessThan(1e-12);
    }
  });

  it(`strategies (a)–(d) are worth exactly RTP (forward DP, ${EXACT.length} settings)`, () => {
    const rows: string[] = [];
    for (const s of EXACT) {
      for (const { name, stop } of STRATEGIES) {
        const { ev, states } = exactValue(s.nodes, s.edges, stop);
        rows.push(`${s.nodes} nodes / ${s.edges} edges | ${name} | ${(ev * 100).toFixed(10)}% (${states} states)`);
        expect(Math.abs(ev - RTP)).toBeLessThan(1e-10);
      }
    }
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });

  it(`strategies (a)–(d) through the real draw return RTP on every eval config (${ROUNDS} rounds, 4 SE)`, () => {
    const rows: string[] = [];
    for (const [ci, { label, params }] of EVAL.entries()) {
      for (const [si, { name, stop }] of STRATEGIES.entries()) {
        const rng = createRng(seededSource(77_000 + ci * 31 + si));
        let sum = 0;
        let sq = 0;
        for (let i = 0; i < ROUNDS; i++) {
          const x = playRound(params.nodes, params.edges, stop, rng);
          sum += x;
          sq += x * x;
        }
        const mean = sum / ROUNDS;
        const se = Math.sqrt(Math.max(0, sq / ROUNDS - mean * mean) / ROUNDS);
        rows.push(`${label} | ${name} | ${(mean * 100).toFixed(2)}% ± ${(se * 100).toFixed(2)}`);
        expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-9);
      }
    }
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
