// Fairness audit: can any way of playing Factor beat the RTP?
//
// The tester's claim: "keep dividing only when the next test is ≥ 80% safe,
// cash out otherwise, and you come out ahead." The decisions in a round are
// when to stop, plus the pause setting ("each test", "each factor", "never"),
// which is locked at the bet and only decides where a cash-out is offered.
// The board also shows the next test's fork (chance p divides, and the win
// chance on each branch) before the player chooses. So the claim fails
// exactly when the cash-out is a martingale over each division test.
//
// The game is finite: N is uniform on 2 … 9999. Replaying the real step() on
// every N gives the exact tree of observable states (keyed as math.test.ts
// keys them), with how many N pass through each, so every strategy can be
// evaluated exactly, not only sampled.
//
//   - Martingale: at 40 states reached by random rounds (early, deep, many
//     factors found, last tests before the guard stops the run), enumerate
//     every candidate remainder through the real step() and average the
//     cash-out computed exactly as Game.tsx's divide() does (0 / full prize
//     when decided, else prize × chance). Must equal the cash-out now (1e-10),
//     for every bet.
//   - Strategies, per eval config and every pause setting: (a) the tester's
//     80% rule, (b) take any profit, (c) play to the end, (d) a fork reader
//     that uses the fork shown on the button: go on only while the worse
//     branch keeps ≥ 70% of the chance now (or while behind), take ≥ 2×. Each
//     is computed exactly over every N and by Monte Carlo (4 SE); plus the
//     Snell envelope over the state tree (optimal stopping, the best any rule
//     can do).
//
// FAIRNESS_ROUNDS sets the Monte Carlo rounds (the audit's heavy run uses 200k).

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import {
  BETS,
  MAX_N,
  MIN_N,
  PAUSES,
  RANGE,
  RTP,
  decided,
  fork,
  isCandidateRemainder,
  maxRemainder,
  odds,
  pausesAfter,
  prize,
  startTrial,
  step,
  type Bet,
  type Pause,
  type Trial,
} from './math';

const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 30_000);

/** The cash-out after a test, exactly as Game.tsx's divide() computes it. */
function cashAfter(t: Trial, bet: Bet): number {
  const o = odds(t, bet);
  const full = prize(bet);
  return decided(o) ? (o.win ? full : 0) : full * o.chance;
}

const stateKey = (t: Trial) => `${t.found}|${t.i}|${t.lo}|${t.done}|${t.factors.join('.')}`;

// ---------- The observable state tree, from the real step() on every N ----------

interface Node {
  id: number;
  t: Trial;
  /** How many N reach this state. */
  count: number;
  /** Child node id → how many N take that branch. */
  children: Map<number, number>;
}

const nodes: Node[] = [];
const byKey = new Map<string, Node>();
function nodeFor(t: Trial): Node {
  const key = stateKey(t);
  let nd = byKey.get(key);
  if (!nd) {
    nd = { id: nodes.length, t, count: 0, children: new Map() };
    nodes.push(nd);
    byKey.set(key, nd);
  }
  return nd;
}
const ROOT = nodeFor(startTrial());
/** paths[n] = the node ids after each test for hidden number n (until the run ends). */
const paths: number[][] = [];
for (let n = MIN_N; n <= MAX_N; n++) {
  let t = startTrial();
  let prev = ROOT;
  prev.count++;
  const path: number[] = [];
  while (!t.done) {
    t = step(t, n);
    const nd = nodeFor(t);
    nd.count++;
    prev.children.set(nd.id, (prev.children.get(nd.id) ?? 0) + 1);
    path.push(nd.id);
    prev = nd;
  }
  paths[n] = path;
}

/** Per-bet caches over the tree: cash-out after reaching each node, and whether it ends the round. */
const perBet = new Map<Bet, { cash: Float64Array; end: Uint8Array; surv: Float64Array }>();
function tables(bet: Bet) {
  let tb = perBet.get(bet);
  if (tb) return tb;
  const cash = new Float64Array(nodes.length);
  const end = new Uint8Array(nodes.length);
  for (const nd of nodes) {
    cash[nd.id] = cashAfter(nd.t, bet);
    end[nd.id] = decided(odds(nd.t, bet)) ? 1 : 0;
  }
  // Survival: the share of N at this node whose next test does not end the round lost.
  const surv = new Float64Array(nodes.length);
  for (const nd of nodes) {
    let ok = 0;
    let all = 0;
    for (const [c, w] of nd.children) {
      all += w;
      if (!(end[c] && cash[c] === 0)) ok += w;
    }
    surv[nd.id] = all ? ok / all : 1;
  }
  tb = { cash, end, surv };
  perBet.set(bet, tb);
  return tb;
}

interface View {
  t: Trial;
  bet: Bet;
  cash: number;
  surv: number;
}
type Stop = (v: View) => boolean;

const STRATEGIES: { name: string; stop: Stop }[] = [
  { name: '(a) continue only if next test ≥ 80% safe', stop: (v) => v.surv < 0.8 },
  { name: '(b) take any profit', stop: (v) => v.cash > 1 },
  { name: '(c) play to the end', stop: () => false },
  {
    name: '(d) fork reader: go while worse branch keeps ≥ 70% (or behind), take ≥ 2×',
    stop: (v) => {
      if (v.cash >= 2) return true;
      if (v.cash < 1) return false;
      const f = fork(v.t, v.bet)!;
      const now = odds(v.t, v.bet).chance;
      const branches = [...(f.pHit > 0 ? [f.ifHit] : []), ...(f.pHit < 1 ? [f.ifMiss] : [])];
      return Math.min(...branches) < 0.7 * now;
    },
  },
];

/** One round on hidden number n, as Game.tsx plays it (pause decides where the player may stop). */
function play(n: number, bet: Bet, pause: Pause, stop: Stop): number {
  const { cash, end, surv } = tables(bet);
  let before = ROOT;
  for (const id of paths[n]) {
    const nd = nodes[id];
    if (end[id]) return cash[id];
    if (pausesAfter(pause, before.t, nd.t) && stop({ t: nd.t, bet, cash: cash[id], surv: surv[id] })) return cash[id];
    before = nd;
  }
  throw new Error('a finished run is always decided');
}

/** Optimal stopping over the tree (decisions only where the pause setting offers a cash-out). */
function snell(bet: Bet, pause: Pause): number {
  const { cash, end } = tables(bet);
  const memo = new Map<number, number>();
  const value = (nd: Node, parent: Node | null): number => {
    // Memo key: node id plus whether a cash-out is offered here (pausesAfter depends on the parent).
    const offeredHere = parent !== null && pausesAfter(pause, parent.t, nd.t);
    const key = nd.id * 2 + (offeredHere ? 1 : 0);
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    let v: number;
    if (parent !== null && end[nd.id]) v = cash[nd.id];
    else {
      let cont = 0;
      let all = 0;
      for (const [c, w] of nd.children) {
        cont += w * value(nodes[c], nd);
        all += w;
      }
      cont /= all;
      v = offeredHere ? Math.max(cash[nd.id], cont) : cont;
    }
    memo.set(key, v);
    return v;
  };
  return value(ROOT, null);
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

const CONFIGS = evalSpec.configs.map((c) => c.params.bet);

describe('Factor fairness', () => {
  it('the state tree covers every N, and its branch counts are the candidate counts', () => {
    expect(ROOT.count).toBe(RANGE);
    let bad = 0;
    for (const nd of nodes) if (!nd.t.done && nd.count !== odds(nd.t, 1).total) bad++;
    expect(bad).toBe(0);
  });

  it('martingale: at 40 reached states, E[cash-out after the next test] = cash-out now (every candidate, every bet)', () => {
    const rng = createRng(seededSource(97));
    const picked: Trial[] = [];
    let deep = 0;
    let manyFactors = 0;
    while (picked.length < 40) {
      const n = MIN_N + rng.int(RANGE);
      const path = paths[n].map((id) => nodes[id].t).filter((t) => !t.done);
      if (path.length === 0) continue;
      // Every fourth pick is the last live state before the run ends.
      const t = picked.length % 4 === 0 ? path[path.length - 1] : path[rng.int(path.length)];
      picked.push(t);
      if (t.tests >= 10) deep++;
      if (t.factors.length >= 3) manyFactors++;
    }
    expect(deep).toBeGreaterThan(0);
    expect(manyFactors).toBeGreaterThan(0);
    for (const t of picked) {
      const next: Trial[] = [];
      for (let m = t.lo; m <= maxRemainder(t); m++) if (isCandidateRemainder(t, m)) next.push(step(t, m * t.found));
      for (const bet of BETS) {
        if (decided(odds(t, bet))) continue;
        let sum = 0;
        for (const s of next) sum += cashAfter(s, bet);
        const now = cashAfter(t, bet);
        expect(Math.abs(sum / next.length - now)).toBeLessThan(1e-10 * Math.max(1, now));
      }
    }
  });

  it('every strategy and pause setting, computed exactly over every N, returns RTP; optimal stopping returns RTP', () => {
    for (const bet of CONFIGS) {
      for (const pause of PAUSES) {
        for (const { stop } of STRATEGIES) {
          let s = 0;
          for (let n = MIN_N; n <= MAX_N; n++) s += play(n, bet, pause, stop);
          expect(s / RANGE).toBeCloseTo(RTP, 9);
        }
        expect(snell(bet, pause)).toBeCloseTo(RTP, 9);
      }
    }
  });

  it(`adversarial strategies by Monte Carlo (${ROUNDS} rounds each, pause = each test) are within 4 SE of RTP`, () => {
    const rows: string[] = [];
    let seed = 2100;
    for (const bet of CONFIGS) {
      const cells: string[] = [];
      for (const { stop } of STRATEGIES) {
        const r = mc((rng) => play(MIN_N + rng.int(RANGE), bet, 'test', stop), ROUNDS, seed++);
        expect(Math.abs(r.mean - RTP)).toBeLessThan(4 * r.se + 1e-12);
        cells.push(`${(r.mean * 100).toFixed(2)} ± ${(r.se * 100).toFixed(2)}`);
      }
      rows.push(`bet ${bet === 1 ? 'prime' : `${bet}+`}: ${cells.join(' | ')}`);
    }
    console.log(`Factor RTP % (${ROUNDS} rounds) — ${STRATEGIES.map((x) => x.name).join(' | ')}\n${rows.join('\n')}`);
  });
});
