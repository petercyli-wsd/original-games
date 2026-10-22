import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  BETS,
  EDGES,
  NODES,
  RTP,
  cashOut,
  decided,
  drawPair,
  nextK,
  oddCount,
  oddDistribution,
  prize,
  split,
  states,
  winChance,
  wins,
  type Settings,
} from './math';

const rng = createRng(seededSource(11));

describe('Euler maths', () => {
  it('the DP matches the Fourier (Krawtchouk) closed form for every final odd count', () => {
    for (const n of NODES) {
      for (const T of [1, 2, ...EDGES]) {
        let total = 0;
        for (const k of states(n)) {
          const exact = oddDistribution(n, T, k);
          total += exact;
          if (k === 0) expect(winChance(n, 'circuit', 0, T)).toBeCloseTo(exact, 12);
        }
        expect(total).toBeCloseTo(1, 12);
        expect(winChance(n, 'trail', 0, T)).toBeCloseTo(oddDistribution(n, T, 0) + oddDistribution(n, T, 2), 12);
        expect(winChance(n, 'tangle', 0, T)).toBeCloseTo(1 - oddDistribution(n, T, 0) - oddDistribution(n, T, 2), 12);
      }
      // All even tends to 1 / 2^(n−1): the parity vector is uniform on the even-weight cube.
      expect(oddDistribution(n, 400, 0)).toBeCloseTo(1 / 2 ** (n - 1), 12);
    }
  });

  it('the closed form matches a direct simulation of random edges', () => {
    for (const n of NODES) {
      const T = 6;
      const rounds = 20_000;
      const counts = new Array<number>(n + 1).fill(0);
      for (let r = 0; r < rounds; r++) {
        const deg = new Array<number>(n).fill(0);
        for (let e = 0; e < T; e++) {
          const [u, v] = drawPair(n, rng);
          deg[u]++;
          deg[v]++;
        }
        counts[oddCount(deg)]++;
      }
      for (const k of states(n)) {
        const p = oddDistribution(n, T, k);
        expect(Math.abs(counts[k] / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-3);
      }
    }
  });

  it('pairs are uniform over the C(n, 2) distinct pairs', () => {
    const n = 6;
    const hits = new Map<string, number>();
    const rounds = 30_000;
    for (let i = 0; i < rounds; i++) {
      const [u, v] = drawPair(n, rng);
      expect(u).toBeLessThan(v);
      hits.set(`${u}-${v}`, (hits.get(`${u}-${v}`) ?? 0) + 1);
    }
    expect(hits.size).toBe(15);
    for (const c of hits.values()) expect(Math.abs(c / rounds - 1 / 15)).toBeLessThan(4 * Math.sqrt((1 / 15) * (14 / 15) / rounds));
  });

  it('the drawn pair split is exactly the chance of each move of k', () => {
    for (const n of NODES) {
      for (const k of states(n)) {
        // Enumerate every pair against a concrete parity vector with k odd nodes.
        const odd = Array.from({ length: n }, (_, i) => i < k);
        let heal = 0;
        let shift = 0;
        let add = 0;
        for (let u = 0; u < n; u++)
          for (let v = u + 1; v < n; v++) {
            const k2 = nextK(k, odd[u], odd[v]);
            if (k2 === k - 2) heal++;
            else if (k2 === k) shift++;
            else add++;
          }
        const s = split(n, k);
        expect([s.heal, s.shift, s.add]).toEqual([heal, shift, add]);
        expect(s.heal + s.shift + s.add).toBe(s.total);
      }
    }
  });

  it('each edge is a fair bet: E[cash-out after] = cash-out now, at every state', () => {
    for (const nodes of NODES)
      for (const edges of EDGES)
        for (const { id: bet } of BETS) {
          const s: Settings = { nodes, edges, bet };
          expect(cashOut(s, 0, edges)).toBeCloseTo(RTP, 12);
          for (let r = 1; r <= edges; r++)
            for (const k of states(nodes)) {
              const sp = split(nodes, k);
              const at = (k2: number) => cashOut(s, k2, r - 1);
              let after = 0;
              if (sp.heal) after += (sp.heal / sp.total) * at(k - 2);
              if (sp.shift) after += (sp.shift / sp.total) * at(k);
              if (sp.add) after += (sp.add / sp.total) * at(k + 2);
              expect(Math.abs(after - cashOut(s, k, r))).toBeLessThan(1e-9 * Math.max(1, prize(s)));
            }
        }
  });

  it('decided states are exact: lost means P = 0, won means P = 1, and r = 0 is the rule itself', () => {
    for (const n of NODES)
      for (const { id: bet } of BETS)
        for (let r = 0; r <= Math.max(...EDGES); r++)
          for (const k of states(n)) {
            const p = winChance(n, bet, k, r);
            const d = decided(n, bet, k, r);
            if (d === 'lost') expect(p).toBe(0);
            if (d === 'won') expect(p).toBeCloseTo(1, 12);
            if (d === null) expect(p > 0 && p < 1).toBe(true);
            if (r === 0) expect(d).toBe(wins(bet, k) ? 'won' : 'lost');
            // All-even needs k / 2 heals, and each edge heals at most one pair.
            // (From k = 0 one edge always makes two odd nodes, so k = 0 with one edge left is lost too.)
            if (bet === 'circuit') expect(d === 'lost').toBe(k / 2 > r || (k === 0 && r === 1));
            if (bet === 'tangle' && k - 2 * r >= 4) expect(d).toBe('won');
          }
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
