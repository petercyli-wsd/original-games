import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  Q,
  RTP,
  TOPOLOGIES,
  TOPOLOGY_IDS,
  allWires,
  analyse,
  analysis,
  cashMultiplier,
  connects,
  isLost,
  isWon,
  nextWire,
  prize,
  reliability,
  simplePaths,
  type Topology,
} from './math';

const { parallel, bridge, series } = TOPOLOGIES;

/** Exact expected cash-out after at most k more reveals, cashing out otherwise. */
function expectedValue(t: Topology, order: number[], k: number, live = 0, dead = 0): number {
  if (isWon(t, live)) return prize(t);
  if (isLost(t, dead)) return 0;
  if (k === 0) return cashMultiplier(t, analysis(t, live, dead).r);
  const e = nextWire(t, live, dead, order);
  expect(e).not.toBeNull(); // an undecided network always has a wire that matters
  const bit = 1 << e!;
  return Q * expectedValue(t, order, k - 1, live | bit, dead) + (1 - Q) * expectedValue(t, order, k - 1, live, dead | bit);
}

describe('Circuit reliability', () => {
  it('stays small enough to enumerate exactly', () => {
    for (const id of TOPOLOGY_IDS) expect(TOPOLOGIES[id].edges.length).toBeLessThanOrEqual(16);
  });

  it('matches the closed forms', () => {
    for (const q of [0.3, 0.5, 0.7, 0.9]) {
      expect(reliability(series, q)).toBeCloseTo(q ** 6, 12);
      expect(reliability(parallel, q)).toBeCloseTo(1 - (1 - q ** 2) ** 4, 12);
      expect(reliability(bridge, q)).toBeCloseTo(2 * q ** 2 + 2 * q ** 3 - 5 * q ** 4 + 2 * q ** 5, 12);
    }
  });

  it('matches Monte Carlo for every preset', () => {
    const rng = createRng(seededSource(42));
    const n = 100_000;
    for (const id of TOPOLOGY_IDS) {
      const t = TOPOLOGIES[id];
      for (const q of [Q, 0.7]) {
        let hits = 0;
        for (let i = 0; i < n; i++) {
          let wires = 0;
          t.edges.forEach((_, e) => {
            if (rng.next() < q) wires |= 1 << e;
          });
          if (connects(t, wires)) hits++;
        }
        const r = reliability(t, q);
        expect(Math.abs(hits / n - r)).toBeLessThan(4 * Math.sqrt((r * (1 - r)) / n));
      }
    }
  });

  it('conditional values average back to r for every unrevealed wire', () => {
    const t = TOPOLOGIES.ladder;
    const a = analyse(t, 0b101, 0b10000);
    t.edges.forEach((_, e) => expect(Q * a.ifHolds[e] + (1 - Q) * a.ifSnaps[e]).toBeCloseTo(a.r, 12));
  });

  it('every simple path really connects S to T', () => {
    for (const id of TOPOLOGY_IDS) {
      const t = TOPOLOGIES[id];
      for (const p of simplePaths(t)) expect(connects(t, p)).toBe(true);
      expect(connects(t, allWires(t))).toBe(true);
    }
  });
});

describe('Circuit fairness', () => {
  it('the expected cash-out after any number of reveals is exactly the RTP', () => {
    const rng = createRng(seededSource(7));
    for (const id of TOPOLOGY_IDS) {
      const t = TOPOLOGIES[id];
      const orders = [t.edges.map((_, e) => e), rng.shuffle(t.edges.map((_, e) => e))];
      for (const order of orders) {
        for (let k = 0; k <= t.edges.length; k++) expect(expectedValue(t, order, k)).toBeCloseTo(RTP, 10);
      }
    }
  });

  it('playing to the end pays the prize with probability R0', () => {
    for (const id of TOPOLOGY_IDS) {
      const t = TOPOLOGIES[id];
      expect(prize(t) * reliability(t)).toBeCloseTo(RTP, 12);
    }
  });
});

describe('Circuit manifest', () => {
  it('maxMultiplier is the biggest prize', () => {
    expect(manifest.maxMultiplier).toBeCloseTo(Math.max(...TOPOLOGY_IDS.map((id) => prize(TOPOLOGIES[id]))), 12);
    for (const id of TOPOLOGY_IDS) expect(prize(TOPOLOGIES[id])).toBeLessThanOrEqual(manifest.maxMultiplier);
    expect(manifest.rtp).toBe(RTP);
    expect(manifest.id).toBe('circuit');
  });

  it('simulated RTP matches the manifest', () => {
    for (const r of runEval(evalSpec, { rounds: 30_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
