// Fairness audit: can any way of playing Euler beat the RTP?
//
// The tester's claim: "keep going only when the next step is ≥ 80% safe, cash
// out otherwise, and you come out ahead." The only decision in a round is
// when to stop: nodes, edges and the backed parity are locked while live. So
// the claim fails exactly when the cash-out is a martingale over each edge.
// The game is finite: an edge is one of the C(n, 2) pairs, uniformly, and k
// (the odd count) with r edges left is the whole state.
//
//   - Martingale: at 30+ reached states (all node counts, edge budgets and
//     bets, including the last edge), enumerate all C(n, 2) next pairs on
//     the real degree vector through nextK / decided / cashOut, exactly as
//     Game.tsx's draw() prices them. E[cash-out after] must equal the
//     cash-out now to 1e-12.
//   - Strategies, per eval config: (a) the tester's 80% rule, (b) take any
//     profit, (c) play to the end, (d) a parity reader (continue only while
//     the next edge is at least as likely to move k toward the backed zone
//     as away, take ≥ 2×), each computed exactly by recursion over the pair
//     split and by Monte Carlo through the real drawPair (4 SE); plus the
//     Snell envelope (optimal stopping, the best any rule can do).
//
// FAIRNESS_ROUNDS sets the Monte Carlo rounds (the audit's heavy run uses 200k).

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { BETS, EDGES, NODES, RTP, cashOut, decided, drawPair, nextK, prize, split, type Settings } from './math';

const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 30_000);

/** The cash-out after an edge, exactly as Game.tsx's draw() computes it. */
function cashAfter(s: Settings, k: number, left: number): number {
  const end = decided(s.nodes, s.bet, k, left);
  return end === 'lost' ? 0 : end === 'won' ? prize(s) : cashOut(s, k, left);
}

/** The next-edge outcomes from k with r edges left: [weight, next k]. */
function moves(n: number, k: number): [number, number][] {
  const sp = split(n, k);
  const out: [number, number][] = [];
  if (sp.heal) out.push([sp.heal / sp.total, k - 2]);
  if (sp.shift) out.push([sp.shift / sp.total, k]);
  if (sp.add) out.push([sp.add / sp.total, k + 2]);
  return out;
}

/** Chance the next edge does not end the round lost. */
function survival(s: Settings, k: number, left: number): number {
  let p = 0;
  for (const [w, k2] of moves(s.nodes, k)) if (decided(s.nodes, s.bet, k2, left - 1) !== 'lost') p += w;
  return p;
}

interface View {
  s: Settings;
  k: number;
  left: number;
  cash: number;
}
type Stop = (v: View) => boolean;

const STRATEGIES: { name: string; stop: Stop }[] = [
  { name: '(a) continue only if next edge ≥ 80% safe', stop: (v) => survival(v.s, v.k, v.left) < 0.8 },
  { name: '(b) take any profit', stop: (v) => v.cash > 1 },
  { name: '(c) play to the end', stop: () => false },
  {
    // Chase while behind; once ahead, keep going only while some next edge
    // would at least double the cash-out (a heal toward an "all even" finish).
    name: '(d) chase while behind, else go only if an edge can double it',
    stop: (v) => {
      if (v.cash < 1) return false;
      const best = Math.max(...moves(v.s.nodes, v.k).map(([, k2]) => cashAfter(v.s, k2, v.left - 1)));
      return best < 2 * v.cash;
    },
  },
];

/** Exact value of a stopping rule from a checkpoint (k, left) reached with this cash-out. */
function exact(s: Settings, k: number, left: number, stop: Stop | 'snell'): number {
  const end = decided(s.nodes, s.bet, k, left);
  const cash = cashAfter(s, k, left);
  if (end) return cash;
  let cont = 0;
  for (const [w, k2] of moves(s.nodes, k)) cont += w * exact(s, k2, left - 1, stop);
  if (stop === 'snell') return Math.max(cash, cont);
  return stop({ s, k, left, cash }) ? cash : cont;
}

/** The value of a round from the bet (the bet draws the first edge, no decision before it). */
function exactRound(s: Settings, stop: Stop | 'snell'): number {
  let v = 0;
  for (const [w, k2] of moves(s.nodes, 0)) v += w * exact(s, k2, s.edges - 1, stop);
  return v;
}

/** One round through the real draw, as Game.tsx plays it. */
function play(s: Settings, stop: Stop, rng: Rng): number {
  const degrees = new Array<number>(s.nodes).fill(0);
  let k = 0;
  for (let left = s.edges - 1; ; left--) {
    const [u, v] = drawPair(s.nodes, rng);
    k = nextK(k, degrees[u] % 2 === 1, degrees[v] % 2 === 1);
    degrees[u]++;
    degrees[v]++;
    const cash = cashAfter(s, k, left);
    if (decided(s.nodes, s.bet, k, left)) return cash;
    if (stop({ s, k, left, cash })) return cash;
  }
}

function mc(play1: (rng: Rng) => number, rounds: number, seed: number) {
  const rng = createRng(seededSource(seed));
  let sum = 0;
  let s2 = 0;
  for (let i = 0; i < rounds; i++) {
    const x = play1(rng);
    sum += x;
    s2 += x * x;
  }
  const mean = sum / rounds;
  return { mean, se: Math.sqrt(Math.max(0, s2 / rounds - mean * mean) / rounds) };
}

const CONFIGS = evalSpec.configs.map((c) => c.params);

describe('Euler fairness', () => {
  it('martingale: at 30+ reached states, E[cash-out after the next edge] = cash-out now (all C(n, 2) pairs, real degrees)', () => {
    const rng = createRng(seededSource(31));
    let states = 0;
    let lastEdge = 0;
    for (let tries = 0; states < 80 && tries < 10_000; tries++) {
      const s: Settings = { nodes: NODES[rng.int(NODES.length)], edges: EDGES[rng.int(EDGES.length)], bet: BETS[rng.int(BETS.length)].id };
      const degrees = new Array<number>(s.nodes).fill(0);
      let k = 0;
      for (let left = s.edges - 1; left > 0; left--) {
        const [u, v] = drawPair(s.nodes, rng);
        k = nextK(k, degrees[u] % 2 === 1, degrees[v] % 2 === 1);
        degrees[u]++;
        degrees[v]++;
        if (decided(s.nodes, s.bet, k, left)) break;
        if (rng.next() < 0.4) continue;
        const now = cashAfter(s, k, left);
        let sum = 0;
        let pairs = 0;
        for (let a = 0; a < s.nodes; a++) {
          for (let b = a + 1; b < s.nodes; b++) {
            sum += cashAfter(s, nextK(k, degrees[a] % 2 === 1, degrees[b] % 2 === 1), left - 1);
            pairs++;
          }
        }
        expect(Math.abs(sum / pairs - now)).toBeLessThan(1e-12 * Math.max(1, now));
        states++;
        if (left === 1) lastEdge++;
      }
    }
    expect(states).toBeGreaterThanOrEqual(30);
    expect(lastEdge).toBeGreaterThan(0);
  });

  it('every strategy and optimal stopping, computed exactly over every setting, return RTP', () => {
    for (const nodes of NODES) {
      for (const edges of EDGES) {
        for (const { id: bet } of BETS) {
          const s: Settings = { nodes, edges, bet };
          for (const { stop } of STRATEGIES) expect(exactRound(s, stop)).toBeCloseTo(RTP, 10);
          expect(exactRound(s, 'snell')).toBeCloseTo(RTP, 10);
        }
      }
    }
  });

  it(`adversarial strategies by Monte Carlo (${ROUNDS} rounds each) are within 4 SE of RTP`, () => {
    const rows: string[] = [];
    let seed = 900;
    for (const s of CONFIGS) {
      const cells: string[] = [];
      for (const { stop } of STRATEGIES) {
        const r = mc((rng) => play(s, stop, rng), ROUNDS, seed++);
        expect(Math.abs(r.mean - RTP)).toBeLessThan(4 * r.se + 1e-12);
        cells.push(`${(r.mean * 100).toFixed(2)} ± ${(r.se * 100).toFixed(2)}`);
      }
      rows.push(`${s.nodes} nodes ${s.edges} edges ${s.bet}: ${cells.join(' | ')}`);
    }
    console.log(`Euler RTP % (${ROUNDS} rounds) — ${STRATEGIES.map((x) => x.name).join(' | ')}\n${rows.join('\n')}`);
  });
});
