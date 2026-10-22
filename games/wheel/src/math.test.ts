import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import { MAX_MULTIPLIER, RISKS, RTP, SEGMENTS, hundredthsSum, segmentFor, spin, spreadLayout, tableFor } from './math';

const ALL = RISKS.flatMap((risk) => SEGMENTS.map((n) => ({ risk, n })));

describe('Wheel maths', () => {
  it('every (risk, segments) table is exactly 99% in integer arithmetic', () => {
    for (const { risk, n } of ALL) {
      expect(hundredthsSum(risk, n)).toBe(99 * n);
      const t = tableFor(risk, n);
      expect(t.entries.reduce((s, e) => s + e.count, 0)).toBe(n);
      expect(t.rtp).toBeCloseTo(RTP, 12);
      // The laid-out wheel averages to the same value.
      expect(t.layout.reduce((s, m) => s + m, 0) / n).toBeCloseTo(RTP, 12);
      console.log(`${risk.padEnd(6)} ${String(n).padStart(2)}: RTP ${(t.rtp * 100).toFixed(4)}%  hit ${(t.chanceHit * 100).toFixed(0)}%  max ${t.max}×  sd ${t.stdDev.toFixed(3)}`);
    }
  });

  it('the layout carries each multiplier on exactly its count of segments, evenly spread', () => {
    for (const { risk, n } of ALL) {
      const t = tableFor(risk, n);
      t.entries.forEach((e, i) => {
        expect(t.layoutEntry.filter((x) => x === i).length).toBe(e.count);
        expect(t.layout.filter((m) => m === e.mult).length).toBe(e.count);
      });
      // Medium risk alternates zero and prize segments.
      if (risk === 'medium') for (let i = 0; i < n; i++) expect(t.layout[i] === 0).not.toBe(t.layout[(i + 1) % n] === 0);
    }
    expect(spreadLayout([2, 2])).toEqual([0, 1, 0, 1]);
  });

  it('the drawn segment is uniform: the arc share of each colour is its true chance', () => {
    const rng = createRng(seededSource(11));
    for (const { risk, n } of [
      { risk: 'medium' as const, n: 30 as const },
      { risk: 'low' as const, n: 10 as const },
    ]) {
      const t = tableFor(risk, n);
      const hits = t.entries.map(() => 0);
      const rounds = 150_000;
      for (let i = 0; i < rounds; i++) hits[t.layoutEntry[spin(() => rng.next(), t).index]]++;
      t.entries.forEach((e, i) => {
        expect(Math.abs(hits[i] / rounds - e.prob)).toBeLessThan(4 * Math.sqrt((e.prob * (1 - e.prob)) / rounds) + 1e-12);
      });
    }
    // Sweep u: each segment owns exactly 1/N of [0, 1).
    const counts = new Array(20).fill(0);
    for (let k = 0; k < 20_000; k++) counts[segmentFor((k + 0.5) / 20_000, 20)]++;
    expect(counts.every((c) => c === 1000)).toBe(true);
    expect(segmentFor(0.9999999999, 50)).toBe(49);
  });

  it('simulated spins match the exact RTP for every table', () => {
    const rng = createRng(seededSource(7));
    for (const { risk, n } of ALL) {
      const t = tableFor(risk, n);
      const rounds = 40_000;
      let sum = 0;
      for (let i = 0; i < rounds; i++) sum += spin(() => rng.next(), t).multiplier;
      expect(Math.abs(sum / rounds - RTP)).toBeLessThan(4 * (t.stdDev / Math.sqrt(rounds)));
    }
  });

  it('paytables are sane: risk lowers the hit rate, segments raise the high-risk jackpot', () => {
    for (const n of SEGMENTS) {
      const [lo, me, hi] = RISKS.map((r) => tableFor(r, n));
      expect(lo.chanceHit).toBe(0.8);
      expect(me.chanceHit).toBe(0.5);
      expect(hi.chanceHit).toBeCloseTo(1 / n, 12);
      expect(lo.stdDev).toBeLessThan(me.stdDev);
      expect(me.stdDev).toBeLessThan(hi.stdDev);
      expect(hi.max).toBeCloseTo(0.99 * n, 12);
      for (const t of [lo, me, hi]) {
        // Entries are strictly increasing and the 0× segment is always there.
        expect(t.entries[0].mult).toBe(0);
        for (let i = 1; i < t.entries.length; i++) expect(t.entries[i].mult).toBeGreaterThan(t.entries[i - 1].mult);
        // Every prize is a profit except on Low risk, where 1.2× still is.
        expect(t.chanceProfit).toBeCloseTo(t.chanceHit, 12);
      }
    }
    for (let i = 1; i < SEGMENTS.length; i++) expect(tableFor('high', SEGMENTS[i]).max).toBeGreaterThan(tableFor('high', SEGMENTS[i - 1]).max);
  });

  it('the max multiplier is honest', () => {
    const max = Math.max(...ALL.map(({ risk, n }) => tableFor(risk, n).max));
    expect(max).toBe(MAX_MULTIPLIER);
    expect(manifest.maxMultiplier).toBe(MAX_MULTIPLIER);
  });

  it('auto-bet style play resolves once per round (one spin, two RNG draws)', () => {
    let calls = 0;
    const src = seededSource(5);
    const counted = () => {
      calls++;
      return src();
    };
    const t = tableFor('medium', 20);
    for (let i = 0; i < 100; i++) {
      const r = spin(counted, t);
      expect(r.multiplier).toBe(t.layout[r.index]);
      expect(r.offset).toBeGreaterThan(0);
      expect(r.offset).toBeLessThan(1);
    }
    expect(calls).toBe(200);
  });

  it('simulated RTP matches the manifest in every band', () => {
    const reports = runEval(evalSpec, { rounds: 100_000 });
    for (const r of reports) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
    expect(reports[3].stdDev).toBeGreaterThan(5 * reports[0].stdDev);
  });
});
