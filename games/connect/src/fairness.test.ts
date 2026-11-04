// Fairness audit: can any way of playing Connect beat the RTP?
//
// The side, node count and edge budget are fixed when the bet is placed (the
// chips are disabled while live), and each pays prize = RTP / P₀. During a
// round the only decision is when to stop. So the questions are:
//   1. is the cash-out V = prize · P(win | graph) a martingale under the real
//      edge draw (a uniform pick from openPairList, as Game.tsx and eval.ts do)?
//   2. do the early ends ("decided") pay the true result?
//   3. does any stopping rule, including the optimal one, return more than RTP?
// Question 1 is checked by enumerating every open pair of real graphs exactly.
// Question 3 is answered exactly by dynamic programming over (component sizes,
// edges placed), whose transitions question 1 ties to the real graph, for
// every offered setting, and by Monte Carlo on real graphs for the eval
// configs:
//   (a) the tester's: add an edge only while it goes your way with chance
//       ≥ 0.8 (a merge when backing Connected, no merge when backing Split),
//       else cash out;
//   (b) take any profit: cash out the moment V > 1;
//   (c) play to the end;
//   (d) the optimal stopping rule (backward induction: cash out exactly when
//       V beats the value of going on). If V were mispriced anywhere this
//       would find it. For Monte Carlo, the one-step look-ahead version.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import {
  NODES,
  RTP,
  SIDES,
  SPARES,
  budgetOf,
  components,
  crossPairs,
  decided,
  mergeChance,
  mergeParts,
  offered,
  openPairList,
  openPairs,
  partsOf,
  prizeFor,
  singletons,
  winChance,
  type Edge,
  type Nodes,
  type Parts,
  type Side,
  type Spare,
} from './math';

/** Rounds per Monte Carlo run. The audit's 200k run sets FAIRNESS_ROUNDS=200000. */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 2_500);

interface Setting {
  side: Side;
  n: number;
  E: number;
  prize: number;
}

const settings: Setting[] = SIDES.flatMap((side) =>
  NODES.flatMap((n) => SPARES.filter((x) => offered(n, x)).map((x) => ({ side, n, E: budgetOf(n, x), prize: prizeFor(side, n, x) }))),
);

/** V at a checkpoint, as Game.tsx computes it. */
const value = (st: Setting, parts: Parts, m: number) => st.prize * winChance(st.side, parts, m, st.E);

/** Chance the next edge goes the backed side's way (what the tester reads off the button). */
const goodChance = (st: Setting, parts: Parts, m: number) => (st.side === 'connect' ? mergeChance(parts, m) : 1 - mergeChance(parts, m));

type Rule = (st: Setting, parts: Parts, m: number) => boolean;

/** One step of the partition chain: [probability, next sizes]. */
function transitions(parts: Parts, m: number): [number, number[]][] {
  const n = parts.reduce((a, b) => a + b, 0);
  const open = openPairs(n, m);
  const out: [number, number[]][] = [];
  const internal = open - crossPairs(parts);
  if (internal > 0) out.push([internal / open, [...parts]]);
  for (let i = 0; i < parts.length; i++)
    for (let j = i + 1; j < parts.length; j++) out.push([(parts[i] * parts[j]) / open, mergeParts(parts, i, j)]);
  return out;
}

/**
 * Exact value of a round under a stopping rule (stop = cash out at this
 * checkpoint). The first edge is placed with the bet, and decided states end
 * the round at V, exactly as Game.tsx does. `optimal` replaces the rule with
 * max(V, value of going on).
 */
function exactValue(st: Setting, stop: Rule | 'optimal'): number {
  const memo = new Map<string, number>();
  const after = (parts: Parts, m: number): number => {
    let s = 0;
    for (const [p, next] of transitions(parts, m)) s += p * at(next, m + 1);
    return s;
  };
  const at = (parts: Parts, m: number): number => {
    const key = `${parts.join(',')}|${m}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const v = value(st, parts, m);
    let out: number;
    if (decided(parts, m, st.E)) out = v;
    else if (stop === 'optimal') out = Math.max(v, after(parts, m));
    else out = stop(st, parts, m) ? v : after(parts, m);
    memo.set(key, out);
    return out;
  };
  return after(singletons(st.n), 0);
}

const RULES: { name: string; stop: Rule }[] = [
  { name: '(a) tester: go on while ≥ 80% your way', stop: (st, parts, m) => goodChance(st, parts, m) < 0.8 },
  { name: '(b) take any profit', stop: (st, parts, m) => value(st, parts, m) > 1 },
  { name: '(c) play to the end', stop: () => false },
];

/** One round on the real graph, drawn as Game.tsx draws it. */
function playRound(st: Setting, stop: Rule, rng: Rng): number {
  const edges: Edge[] = [];
  for (;;) {
    const open = openPairList(st.n, edges);
    const pick = open[rng.int(open.length)];
    edges.push([pick.a, pick.b]);
    const parts = partsOf(st.n, edges);
    const m = edges.length;
    if (decided(parts, m, st.E) || stop(st, parts, m)) return value(st, parts, m);
  }
}

/** (d) for Monte Carlo: cash out when the exact one-step look-ahead says going on is worth less than V. */
const lookAhead: Rule = (st, parts, m) => {
  let ev = 0;
  for (const [p, next] of transitions(parts, m)) ev += p * value(st, next, m + 1);
  return ev < value(st, parts, m) * (1 - 1e-12);
};

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

describe('Connect fairness', () => {
  it('every offered setting starts at RTP: V before the first edge is RTP', () => {
    for (const st of settings) {
      expect(value(st, singletons(st.n), 0)).toBeCloseTo(RTP, 12);
      expect(Number.isFinite(st.prize) && st.prize <= 99).toBe(true);
    }
  });

  it('martingale: at 40+ reached real graphs, the average V over every open pair equals V now', () => {
    const rng = createRng(seededSource(8101));
    let checked = 0;
    let nearEnd = 0;
    for (let round = 0; checked < 60 || nearEnd < 10; round++) {
      const st = settings[rng.int(settings.length)];
      const edges: Edge[] = [];
      // Walk a real round and test every live checkpoint on the way.
      for (;;) {
        const open = openPairList(st.n, edges);
        const pick = open[rng.int(open.length)];
        edges.push([pick.a, pick.b]);
        const parts = partsOf(st.n, edges);
        const m = edges.length;
        if (decided(parts, m, st.E)) break;
        const v = value(st, parts, m);
        // The next event: every open pair, each with chance 1 / open.length.
        const next = openPairList(st.n, edges);
        expect(next.length).toBe(openPairs(st.n, m));
        expect(next.filter((p) => p.cross).length).toBe(crossPairs(parts));
        let ev = 0;
        for (const p of next) {
          const e2: Edge[] = [...edges, [p.a, p.b]];
          ev += value(st, partsOf(st.n, e2), m + 1) / next.length;
        }
        expect(Math.abs(ev - v)).toBeLessThan(1e-9 * st.prize);
        checked++;
        if (st.E - m <= 2) nearEnd++;
        if (rng.next() < 0.3) break;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(40);
  });

  it('decided states pay the true result: playing the remaining edges out never changes it', () => {
    const rng = createRng(seededSource(8102));
    let seen = 0;
    for (let round = 0; round < 3000; round++) {
      const st = settings[rng.int(settings.length)];
      const edges: Edge[] = [];
      let parts: number[] = [];
      for (;;) {
        const open = openPairList(st.n, edges);
        const pick = open[rng.int(open.length)];
        edges.push([pick.a, pick.b]);
        parts = partsOf(st.n, edges);
        if (decided(parts, edges.length, st.E)) break;
      }
      const p = winChance(st.side, parts, edges.length, st.E);
      expect(p === 0 || p === 1).toBe(true);
      // Play the rest of the budget out (adversarially too: the remaining
      // edges inside the largest group first, then at random).
      for (const greedy of [false, true]) {
        const e2 = [...edges];
        while (e2.length < st.E) {
          let open = openPairList(st.n, e2);
          if (greedy) {
            const inner = open.filter((o) => !o.cross);
            if (inner.length) open = inner;
          }
          const pick = open[rng.int(open.length)];
          e2.push([pick.a, pick.b]);
        }
        const connected = new Set(components(st.n, e2)).size === 1;
        const won = st.side === 'connect' ? connected : !connected;
        expect(won ? 1 : 0).toBe(p);
      }
      seen++;
    }
    expect(seen).toBe(3000);
  });

  it('exact: (a), (b), (c) and the optimal stopping rule are worth RTP on every offered setting', () => {
    for (const st of settings) {
      for (const { stop } of RULES) expect(Math.abs(exactValue(st, stop) - RTP)).toBeLessThan(1e-9);
      // The best any player can do: max over all stopping rules.
      expect(exactValue(st, 'optimal')).toBeLessThan(RTP + 1e-9);
    }
  });

  it(`strategies on real graphs, every eval config (${ROUNDS} rounds each, within 4 SE)`, () => {
    const rows: string[] = [];
    let seed = 8200;
    for (const cfg of evalSpec.configs) {
      const { side, n, spare } = cfg.params as { side: Side; n: Nodes; spare: Spare };
      const st: Setting = { side, n, E: budgetOf(n, spare), prize: prizeFor(side, n, spare) };
      for (const { name, stop } of [...RULES, { name: '(d) one-step look-ahead', stop: lookAhead }]) {
        const r = mc((rng) => playRound(st, stop, rng), ROUNDS, seed++);
        rows.push(`${cfg.label} | ${name} | ${(100 * r.mean).toFixed(3)}% ± ${(100 * r.se).toFixed(3)}%`);
        expect(Math.abs(r.mean - RTP)).toBeLessThan(4 * r.se + 1e-9);
      }
    }
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
