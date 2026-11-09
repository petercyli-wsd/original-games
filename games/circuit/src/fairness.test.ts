// Fairness audit: can any way of playing Circuit beat the RTP?
//
// A round fixes a shuffled wire order at the bet; each step tests the first
// unrevealed wire in that order that still matters (nextWire), and the wire
// holds with chance Q = 1/2 (rng.next() < Q, drawn when the probe starts).
// The only decision is when to cash out ("Play it out" is just never cashing
// out). Cash-out = prize × R, R = P(S–T connected | revealed), by exact
// enumeration; a connected network pays the prize, a cut one pays 0.
//
// The martingale check is exact: at ≥ 30 states per network reached by random
// rounds of the real reducer, and for EVERY unrevealed wire (not just the one
// nextWire would pick, so any reveal order is covered), the two outcomes are
// pushed through the reducer ('probe' → 'resolve') and weighted Q / 1 − Q:
//   Q·value(holds) + (1 − Q)·value(snaps) = value now,
// where value is what the game would pay: round.mult once over, else the
// reducer's own 'cashOut' settlement.
//
// Strategies, per eval config (network):
//   (a) the tester's: test the next wire only when it is ≥ 80% safe (it can
//       only end the round lost if it is a cut wire, ifSnaps = 0), else cash;
//   (b) take any profit: cash out the moment the cash-out exceeds the bet;
//   (c) play it out;
//   (d) dodge the critical wires: cash out whenever the next wire's snap
//       would lose more than its hold would gain (R − ifSnaps > ifHolds − R),
//       or whenever it is a cut wire, else test it.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { Q, RTP, TOPOLOGIES, TOPOLOGY_IDS, analysis, cashMultiplier, maxMultiplier, nextWire, prize, type TopologyId } from './math';
import { initialState, reducer, type GameState } from './round';

/** Rounds per strategy run; the audit's 200k run sets FAIRNESS_ROUNDS=200000. */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 20_000);

/** What the open round is worth: its settled multiplier once over, else what the reducer pays on cashOut. */
function value(s: GameState): number {
  if (s.phase === 'over') return s.round!.mult;
  return reducer(s, { type: 'cashOut' }).round!.mult;
}

/** Bet with a shuffled order, as Game.tsx's startBet does; returns the probing state. */
function start(topo: TopologyId, rng: Rng): GameState {
  const t = TOPOLOGIES[topo];
  const order = rng.shuffle(t.edges.map((_, e) => e));
  return reducer(initialState(), { type: 'start', topo, bet: 1, order, first: nextWire(t, 0, 0, order)! });
}

const resolve = (s: GameState, rng: Rng) => reducer(s, { type: 'resolve', holds: rng.next() < Q });

/** Checkpoints met while playing random rounds out. */
function reachedStates(topo: TopologyId, count: number, rng: Rng): GameState[] {
  const out: GameState[] = [];
  while (out.length < count) {
    let s = resolve(start(topo, rng), rng);
    while (s.phase === 'checkpoint') {
      out.push(s);
      const rd = s.round!;
      s = resolve(reducer(s, { type: 'probe', wire: nextWire(TOPOLOGIES[topo], rd.live, rd.dead, rd.order)! }), rng);
    }
  }
  return out.slice(0, count);
}

interface Peek {
  V: number;
  r: number;
  ifHolds: number;
  ifSnaps: number;
}
type Stop = (k: Peek) => boolean;

/** One round as Game.tsx plays it (the first wire is tested at once), with a stop rule at each checkpoint. */
function playRound(topo: TopologyId, stop: Stop, rng: Rng): number {
  const t = TOPOLOGIES[topo];
  let s = resolve(start(topo, rng), rng);
  while (s.phase === 'checkpoint') {
    const rd = s.round!;
    const e = nextWire(t, rd.live, rd.dead, rd.order)!;
    const a = analysis(t, rd.live, rd.dead);
    if (stop({ V: value(s), r: a.r, ifHolds: a.ifHolds[e], ifSnaps: a.ifSnaps[e] })) return reducer(s, { type: 'cashOut' }).round!.mult;
    s = resolve(reducer(s, { type: 'probe', wire: e }), rng);
  }
  return s.round!.mult;
}

const STRATEGIES: { name: string; stop: Stop }[] = [
  { name: '(a) test only when ≥ 80% safe', stop: (k) => (k.ifSnaps === 0 ? Q : 1) < 0.8 },
  { name: '(b) take any profit', stop: (k) => k.V > 1 },
  { name: '(c) play it out', stop: () => false },
  { name: '(d) dodge critical wires', stop: (k) => k.ifSnaps === 0 || k.r - k.ifSnaps > k.ifHolds - k.r },
];

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

describe('Circuit fairness', () => {
  it('martingale, exact: at 30+ reached states per network, testing ANY unrevealed wire is a fair bet (via the reducer)', () => {
    const rng = createRng(seededSource(41));
    for (const topo of TOPOLOGY_IDS) {
      const t = TOPOLOGIES[topo];
      const states = reachedStates(topo, 30, rng);
      // The start is worth exactly RTP, the prize is RTP / R0.
      expect(cashMultiplier(t, analysis(t, 0, 0).r)).toBeCloseTo(RTP, 14);
      for (const s of states) {
        const rd = s.round!;
        const V = value(s);
        const known = rd.live | rd.dead;
        let checked = 0;
        for (let e = 0; e < t.edges.length; e++) {
          if ((known >> e) & 1) continue;
          const probing = reducer(s, { type: 'probe', wire: e });
          const held = value(reducer(probing, { type: 'resolve', holds: true }));
          const snapped = value(reducer(probing, { type: 'resolve', holds: false }));
          expect(Math.abs(Q * held + (1 - Q) * snapped - V)).toBeLessThan(1e-12 * Math.max(1, V));
          checked++;
        }
        expect(checked).toBeGreaterThan(0);
        // The wire the game picks is one that still matters.
        const e = nextWire(t, rd.live, rd.dead, rd.order);
        expect(e).not.toBeNull();
      }
    }
  });

  it('the wire draw matches Q on the host rng (200k draws)', () => {
    const rng = createRng(seededSource(9));
    let held = 0;
    const N = 200_000;
    for (let i = 0; i < N; i++) if (rng.next() < Q) held++;
    expect(Math.abs(held / N - Q)).toBeLessThan(4 * Math.sqrt((Q * (1 - Q)) / N));
  });

  it.each(STRATEGIES.map((s) => [s.name, s] as const))('strategy %s: RTP within 4 SE on every eval config', (_, { name, stop }) => {
    evalSpec.configs.forEach((cfg, i) => {
      const topo = cfg.params.topo;
      const r = mc((g) => playRound(topo, stop, g), ROUNDS, 500 + i * 13 + name.length);
      const z = (r.mean - RTP) / r.se;
      if (import.meta.env.FAIRNESS_ROUNDS)
        console.log(`${name} | ${topo} | RTP ${(r.mean * 100).toFixed(3)}% ± ${(r.se * 100).toFixed(3)}% | z ${z.toFixed(2)} | max ${r.max.toFixed(2)}`);
      expect(Math.abs(z)).toBeLessThan(4);
      expect(r.max).toBeLessThanOrEqual(maxMultiplier() + 1e-9);
      expect(r.max).toBeLessThanOrEqual(prize(TOPOLOGIES[topo]) + 1e-9);
    });
  });
});
