// Fairness audit: can any way of playing Pascal beat the RTP?
//
// A round deals cards from a shuffled deck of N ↘ and N ↙ cards; the bet deals
// the first card. After every card that leaves the round open the player may
// cash out (prize × P(win | cards dealt)), deal one more card, or "Run to the
// gate" (deal until the round is sealed). The gate is fixed at the bet (its
// controls are disabled while live), so the only decision is when to stop.
// The state (a, b) = (↘ dealt, ↙ dealt) is a sufficient statistic: the cards
// left are a uniform shuffle of what remains.
//
// Checks:
//  - Martingale, exact: every reachable open state of every valid gate (far
//    more than 30), for both actions (deal one, run to the gate), E[V after]
//    = V now, enumerated over the next card's two outcomes / the run's sealed
//    outcomes. P(win | state) itself is re-derived independently by
//    enumerating every deck order consistent with the cards dealt.
//  - Optimal stopping, exact: the value of the best possible strategy
//    (backward induction over (a, b) with stop / deal / run) is RTP for every
//    gate, so no strategy whatsoever beats RTP.
//  - Strategies (a)–(d) on every eval config (the config's gate or its mirror),
//    simulated with the game's own step/sealed/tally, and valued exactly by
//    backward induction (each rule depends only on the state).
//
// The deal: step() draws ↘ iff rng.next() < R/(R+L), the share of ↘ cards
// left; the frequency check below confirms it from mid-round states.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import {
  MAX_MULTIPLIER,
  N,
  RTP,
  START,
  allGates,
  cardsLeft,
  downRightChance,
  inGate,
  mirror,
  prizeFor,
  rowOf,
  runToGate,
  sealed,
  step,
  tally,
  winChance,
  type Gate,
  type Pos,
} from './math';

/** Rounds per strategy run; the audit's 200k run sets FAIRNESS_ROUNDS=200000. */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 20_000);

const key = (p: Pos) => `${p.a},${p.b}`;

/** Cash-out at a state, as Game.tsx computes it (sealed rounds pay prize or 0). */
function cashAt(p: Pos, g: Gate): number {
  const fate = sealed(p, g);
  if (fate) return fate === 'win' ? prizeFor(g) : 0;
  const t = tally(p, g);
  return (prizeFor(g) * t.through) / t.total;
}

/** The next card's outcomes with their exact chances. */
function nextCards(p: Pos): { p: number; to: Pos }[] {
  const { right, left, down } = cardsLeft(p);
  return [
    { p: right / down, to: { a: p.a + 1, b: p.b } },
    { p: left / down, to: { a: p.a, b: p.b + 1 } },
  ].filter((x) => x.p > 0);
}

/** Every open (unsealed) state reachable for a gate, the start excluded (the bet deals the first card). */
function openStates(g: Gate): Pos[] {
  const out: Pos[] = [];
  for (let a = 0; a <= N; a++) for (let b = 0; a + b <= N; b++) if (a + b > 0 && sealed({ a, b }, g) === null) out.push({ a, b });
  return out;
}

/** Exact distribution of where "Run to the gate" stops: sealed states with their chances. */
function runOutcomes(p: Pos, g: Gate): Map<string, { p: number; pos: Pos }> {
  const out = new Map<string, { p: number; pos: Pos }>();
  const walk = (q: Pos, w: number) => {
    for (const c of nextCards(q)) {
      if (sealed(c.to, g) !== null) {
        const k = key(c.to);
        const e = out.get(k);
        if (e) e.p += w * c.p;
        else out.set(k, { p: w * c.p, pos: c.to });
      } else walk(c.to, w * c.p);
    }
  };
  walk(p, 1);
  return out;
}

/** Independent P(win | state): enumerate all orders of the remaining cards (as 0/1 strings), count landings in the gate. */
function bruteWin(p: Pos, g: Gate): number {
  const { right, left } = cardsLeft(p);
  let through = 0;
  let total = 0;
  // Every order of the whole remaining deck is equally likely; the ball's tile is the ↘ count among the first N dealt.
  const full = (r: number, l: number, a: number, dealt: number): void => {
    if (r === 0 && l === 0) {
      total++;
      if (inGate(g, a)) through++;
      return;
    }
    const nextA = dealt < N ? 1 : 0;
    if (r > 0) full(r - 1, l, a + nextA, dealt + 1);
    if (l > 0) full(r, l - 1, a, dealt + 1);
  };
  full(right, left, p.a, rowOf(p));
  return through / total;
}

type Action = 'stop' | 'one' | 'run';
type Rule = (p: Pos, g: Gate) => Action;

/** P(the next card seals a loss): the risk the tester's rule looks at. */
function nextLoss(p: Pos, g: Gate): number {
  return nextCards(p).reduce((s, c) => s + (sealed(c.to, g) === 'lose' ? c.p : 0), 0);
}

const STRATEGIES: { name: string; rule: Rule }[] = [
  { name: '(a) deal while next card ≥ 80% safe', rule: (p, g) => (1 - nextLoss(p, g) >= 0.8 ? 'one' : 'stop') },
  { name: '(b) take any profit', rule: (p, g) => (cashAt(p, g) > 1 ? 'stop' : 'one') },
  { name: '(c) run to the gate', rule: () => 'run' },
  {
    // The deck "pulls back": once the ball sits off the gate's side and the deck leans away, bail;
    // when it leans towards the gate, run to the end to ride the pull.
    name: '(d) ride the deck pull, bail when it leans away',
    rule: (p, g) => {
      const pr = downRightChance(p);
      const towardsRight = g.lo + (g.width - 1) / 2 > p.a + (N - rowOf(p)) * pr;
      const lean = towardsRight ? pr : 1 - pr;
      return lean >= 0.6 ? 'run' : lean < 0.45 ? 'stop' : 'one';
    },
  },
];

/** Exact value of a state-based rule from the bet (first card forced), by backward induction. */
function exactValue(g: Gate, rule: Rule): number {
  const memo = new Map<string, number>();
  const v = (p: Pos): number => {
    if (sealed(p, g) !== null) return cashAt(p, g);
    const k = key(p);
    const hit = memo.get(k);
    if (hit !== undefined) return hit;
    const act = rule(p, g);
    let out: number;
    if (act === 'stop') out = cashAt(p, g);
    else if (act === 'run') out = [...runOutcomes(p, g).values()].reduce((s, o) => s + o.p * cashAt(o.pos, g), 0);
    else out = nextCards(p).reduce((s, c) => s + c.p * v(c.to), 0);
    memo.set(k, out);
    return out;
  };
  return nextCards(START).reduce((s, c) => s + c.p * v(c.to), 0);
}

/** The best any strategy can do: stop, deal one or run, whichever is worth most at every state. */
function optimalValue(g: Gate): number {
  const memo = new Map<string, number>();
  const v = (p: Pos): number => {
    if (sealed(p, g) !== null) return cashAt(p, g);
    const k = key(p);
    const hit = memo.get(k);
    if (hit !== undefined) return hit;
    const one = nextCards(p).reduce((s, c) => s + c.p * v(c.to), 0);
    const run = [...runOutcomes(p, g).values()].reduce((s, o) => s + o.p * cashAt(o.pos, g), 0);
    const out = Math.max(cashAt(p, g), one, run);
    memo.set(k, out);
    return out;
  };
  return nextCards(START).reduce((s, c) => s + c.p * v(c.to), 0);
}

/** One round as Game.tsx plays it: the bet deals a card; each checkpoint applies the rule. */
function playRound(g: Gate, rule: Rule, rng: Rng): number {
  let p = step(START, rng);
  for (;;) {
    if (sealed(p, g) !== null) return cashAt(p, g);
    const act = rule(p, g);
    if (act === 'stop') return cashAt(p, g);
    if (act === 'run') {
      const path = runToGate(p, g, rng);
      return cashAt(path[path.length - 1], g);
    }
    p = step(p, rng);
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

describe('Pascal fairness', () => {
  it('martingale (exact): every open state of every gate, deal one card or run to the gate, E[V after] = V now', () => {
    let states = 0;
    for (const g of allGates()) {
      for (const p of openStates(g)) {
        states++;
        const now = cashAt(p, g);
        const one = nextCards(p).reduce((s, c) => s + c.p * cashAt(c.to, g), 0);
        const run = [...runOutcomes(p, g).values()].reduce((s, o) => s + o.p * cashAt(o.pos, g), 0);
        expect(Math.abs(one - now)).toBeLessThan(1e-9 * prizeFor(g));
        expect(Math.abs(run - now)).toBeLessThan(1e-9 * prizeFor(g));
        // The win chance itself, re-derived by enumerating every remaining deck order.
        expect(Math.abs(bruteWin(p, g) - winChance(p, g))).toBeLessThan(1e-12);
      }
      // The bet's first card is priced too: E[V after card 1] = RTP.
      expect(nextCards(START).reduce((s, c) => s + c.p * cashAt(c.to, g), 0)).toBeCloseTo(RTP, 12);
    }
    expect(states).toBeGreaterThanOrEqual(30);
  });

  it('optimal stopping (exact): the best possible strategy is worth RTP for every gate', () => {
    for (const g of allGates()) expect(optimalValue(g)).toBeCloseTo(RTP, 12);
  });

  it('the deal draws ↘ at the share of ↘ cards left (100k draws from mid-round states, 4 SE)', () => {
    const rng = createRng(seededSource(9101));
    for (const p of [START, { a: 3, b: 0 }, { a: 1, b: 4 }, { a: 5, b: 5 }, { a: 2, b: 2 }]) {
      const want = downRightChance(p);
      let hits = 0;
      const n = 100_000;
      for (let i = 0; i < n; i++) if (step(p, rng).a > p.a) hits++;
      expect(Math.abs(hits / n - want)).toBeLessThan(4 * Math.sqrt((want * (1 - want)) / n) + 1e-12);
    }
  });

  it('every strategy (a)–(d) is worth exactly RTP (backward induction) on every gate', () => {
    for (const g of allGates()) for (const { rule } of STRATEGIES) expect(exactValue(g, rule)).toBeCloseTo(RTP, 12);
  });

  it('strategies (a)–(d) on every eval config return RTP within 4 SE in simulation, never above the max', () => {
    const rows: string[] = [];
    evalSpec.configs.forEach(({ label, params: { gate } }, ci) => {
      STRATEGIES.forEach(({ name, rule }, si) => {
        const res = mc((r) => playRound(r.next() < 0.5 ? gate : mirror(gate), rule, r), ROUNDS, 9200 + 17 * ci + si);
        rows.push(`${label.padEnd(30)} ${name.padEnd(48)} ${(res.mean * 100).toFixed(2)}% ± ${(res.se * 100).toFixed(2)}%  max ${res.max.toFixed(1)}×`);
        expect(Math.abs(res.mean - RTP)).toBeLessThan(4 * res.se + 1e-12);
        expect(res.max).toBeLessThanOrEqual(MAX_MULTIPLIER + 1e-9);
      });
    });
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
