// Fairness audit: can any way of playing Euclid beat the RTP?
//
// The tester's claim: "cash out whenever the next step is under ~80% safe,
// keep going when it's 80%+, and you come out ahead." The only decision in a
// round is when to stop: the call (coprime / square / long run) and the range
// N are locked while live. So the claim fails exactly when the cash-out is a
// martingale over each reveal, and Euclid is a finite game: the hidden pair is
// uniform over the N(N−1)/2 pairs, so every expectation below is an exact sum.
//
//   - Martingale: at 30+ reached states (all sizes and offered bets, early,
//     mid-run, and "run finished, scale hidden"), step every candidate pair
//     through the real reveal() and average the resulting cash-out, computed
//     exactly as Game.tsx's step() does (0 on a loss, the full prize on a
//     certain win, else prize × W/C). Must equal the cash-out now to 1e-9.
//   - Strategies, per eval config: (a) the tester's 80% rule, (b) take any
//     profit, (c) play to the end, (d) optimal stopping, i.e. the Snell
//     envelope max(cash now, E[best later]) by backward induction over the
//     clue tree (no stopping rule can beat it), plus a mixed heuristic run
//     by Monte Carlo. (a)–(c) are computed exactly by enumerating every
//     pair, and also by Monte Carlo through drawPair (4 SE).
//
// FAIRNESS_ROUNDS sets the Monte Carlo rounds (the audit's heavy run uses 200k).

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { CUTS, NO_CLUES, RTP, SIZES, drawPair, nodeAt, odds, offered, prize, reveal, tree, winCount, type Bet, type Clues, type Node, type Pair, type Size } from './math';

const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 20_000);

/** The cash-out after a reveal, exactly as Game.tsx's step() computes it. */
function cashAfter(size: Size, bet: Bet, clues: Clues): number {
  const full = prize(size, bet);
  const o = odds(size, bet, clues);
  return o.wins === 0 ? 0 : o.wins === o.total ? full : full * o.p;
}

const isOver = (size: Size, bet: Bet, clues: Clues) => {
  const o = odds(size, bet, clues);
  return o.wins === 0 || o.wins === o.total;
};

/** Chance the next reveal does not end the round lost, from the clue tree's children. */
const survivalCache = new WeakMap<Node, Map<string, number>>();
function survival(node: Node, bet: Bet): number {
  const key = `${bet.kind}${bet.cuts}`;
  let m = survivalCache.get(node);
  if (!m) survivalCache.set(node, (m = new Map()));
  let s = m.get(key);
  if (s === undefined) {
    let ok = 0;
    for (const child of node.children.values()) if (winCount(child, bet) > 0) ok += child.pairs.length;
    s = ok / node.pairs.length;
    m.set(key, s);
  }
  return s;
}

interface View {
  size: Size;
  bet: Bet;
  clues: Clues;
  cash: number;
  node: Node;
}
/** Cash out now? Called at each checkpoint (after the first cut, which the bet makes). */
type Stop = (v: View) => boolean;

const STRATEGIES: { name: string; stop: Stop }[] = [
  { name: '(a) continue only if next step ≥ 80% safe', stop: (v) => survival(v.node, v.bet) < 0.8 },
  { name: '(b) take any profit', stop: (v) => v.cash > 1 },
  { name: '(c) play to the end', stop: () => false },
  {
    // A "reader" of the rectangle: bail when the next cut can lose more than a
    // quarter of the time, chase while behind, take 2× or better.
    name: '(d) mixed: bail if next ≥ 25% fatal unless behind, take ≥ 2×',
    stop: (v) => v.cash >= 2 || (v.cash >= 0.5 && survival(v.node, v.bet) < 0.75),
  },
];

/** One round on a given pair, as Game.tsx plays it. */
function play(size: Size, bet: Bet, pair: Pair, stop: Stop): number {
  let clues: Clues = NO_CLUES;
  for (;;) {
    clues = reveal(pair, clues)!;
    const cash = cashAfter(size, bet, clues);
    if (isOver(size, bet, clues)) return cash;
    if (stop({ size, bet, clues, cash, node: nodeAt(size, clues)! })) return cash;
  }
}

/** The best any stopping rule can do from a node: max(cash now, E[best after the next reveal]). */
function snell(size: Size, bet: Bet, node: Node, full: number): number {
  const w = winCount(node, bet);
  const total = node.pairs.length;
  if (w === 0) return 0;
  if (w === total) return full;
  let cont = 0;
  for (const child of node.children.values()) cont += (child.pairs.length / total) * snell(size, bet, child, full);
  return node === tree(size) ? cont : Math.max(full * (w / total), cont);
}

function mc(play1: (rng: Rng) => number, rounds: number, seed: number) {
  const rng = createRng(seededSource(seed));
  let s = 0;
  let s2 = 0;
  for (let i = 0; i < rounds; i++) {
    const x = play1(rng);
    s += x;
    s2 += x * x;
  }
  const mean = s / rounds;
  return { mean, se: Math.sqrt(Math.max(0, s2 / rounds - mean * mean) / rounds) };
}

const CONFIGS = evalSpec.configs.map((c) => c.params);

describe('Euclid fairness', () => {
  it('martingale: at 30+ reached states, E[cash-out after the next reveal] = cash-out now (exact, every candidate)', () => {
    const rng = createRng(seededSource(77));
    const bets: Bet[] = [{ kind: 'coprime', cuts: 3 }, { kind: 'square', cuts: 3 }, ...CUTS.map((cuts) => ({ kind: 'cuts' as const, cuts }))];
    let states = 0;
    let finishedRuns = 0;
    let deep = 0;
    for (let tries = 0; states < 60 && tries < 5000; tries++) {
      const size = SIZES[rng.int(SIZES.length)];
      const bet = bets[rng.int(bets.length)];
      if (!offered(size, bet)) continue;
      const pair = drawPair(size, (n) => rng.int(n));
      let clues: Clues = NO_CLUES;
      for (let c = reveal(pair, clues); c; c = reveal(pair, c)) {
        clues = c;
        if (isOver(size, bet, clues)) break;
        if (rng.next() < 0.6) continue;
        // A live checkpoint: enumerate the next reveal over every candidate pair.
        const node = nodeAt(size, clues)!;
        const now = cashAfter(size, bet, clues);
        let sum = 0;
        for (const p of node.pairs) sum += cashAfter(size, bet, reveal(p, clues)!);
        expect(Math.abs(sum / node.pairs.length - now)).toBeLessThan(1e-9);
        states++;
        if (clues.done) finishedRuns++;
        if (clues.quotients.length >= 4) deep++;
      }
    }
    expect(states).toBeGreaterThanOrEqual(30);
    expect(finishedRuns).toBeGreaterThan(0);
    expect(deep).toBeGreaterThan(0);
  });

  it('martingale at every node of the clue tree, every offered bet (exact counts)', () => {
    let bad = 0;
    let nodes = 0;
    for (const size of SIZES) {
      for (const bet of [{ kind: 'coprime', cuts: 3 }, { kind: 'square', cuts: 3 }, ...CUTS.map((cuts) => ({ kind: 'cuts' as const, cuts }))] as Bet[]) {
        if (!offered(size, bet)) continue;
        const walk = (node: Node) => {
          if (node.children.size === 0) return;
          let w = 0;
          let c = 0;
          for (const ch of node.children.values()) {
            w += winCount(ch, bet);
            c += ch.pairs.length;
            walk(ch);
          }
          // The children partition the candidates, so Σ W_child = W and Σ C_child = C.
          nodes++;
          if (c !== node.pairs.length || w !== winCount(node, bet)) bad++;
        };
        walk(tree(size));
      }
    }
    expect(nodes).toBeGreaterThan(10_000);
    expect(bad).toBe(0);
  });

  it('every strategy, computed exactly over every pair, returns RTP; optimal stopping returns RTP', () => {
    for (const { size, bet } of CONFIGS) {
      const all = tree(size).pairs;
      for (const { stop } of STRATEGIES) {
        let s = 0;
        for (const p of all) s += play(size, bet, p, stop);
        expect(s / all.length).toBeCloseTo(RTP, 9);
      }
      expect(snell(size, bet, tree(size), prize(size, bet))).toBeCloseTo(RTP, 9);
    }
  });

  it(`adversarial strategies by Monte Carlo (${ROUNDS} rounds each) are within 4 SE of RTP`, () => {
    const rows: string[] = [];
    let seed = 500;
    for (const { size, bet } of CONFIGS) {
      const cells: string[] = [];
      for (const { stop } of STRATEGIES) {
        const r = mc((rng) => play(size, bet, drawPair(size, (n) => rng.int(n)), stop), ROUNDS, seed++);
        expect(Math.abs(r.mean - RTP)).toBeLessThan(4 * r.se + 1e-12);
        cells.push(`${(r.mean * 100).toFixed(2)} ± ${(r.se * 100).toFixed(2)}`);
      }
      rows.push(`N=${size} ${bet.kind}${bet.kind === 'cuts' ? bet.cuts : ''}: ${cells.join(' | ')}`);
    }
    console.log(`Euclid RTP % (${ROUNDS} rounds) — ${STRATEGIES.map((s) => s.name).join(' | ')}\n${rows.join('\n')}`);
  });
});
