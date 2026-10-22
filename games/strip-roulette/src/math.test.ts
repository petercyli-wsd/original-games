import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  BET_KEYS,
  EMPTY_LAYOUT,
  MAX_MULTIPLIER,
  RTP,
  STRIPS,
  chanceOf,
  covers,
  drawSlot,
  layoutStats,
  payoutAmount,
  payoutOf,
  scaleLayout,
  slotsCovered,
  spin,
  stripOrder,
  totalOf,
  volatilityOf,
  type Layout,
} from './math';

const randomLayout = (rng: { next(): number }): Layout => {
  const l: Layout = { ...EMPTY_LAYOUT };
  for (const k of BET_KEYS) if (rng.next() < 0.6) l[k] = Math.round(rng.next() * 1000) / 100;
  if (totalOf(l) === 0) l.red = 1;
  return l;
};

describe('Strip Roulette maths', () => {
  it('the classic strip is 7 red, 7 black, 1 green and pays 2.1214× / 14.85× / 7.425×', () => {
    const s = stripOrder(15);
    expect(s.filter((x) => x.colour === 'red')).toHaveLength(7);
    expect(s.filter((x) => x.colour === 'black')).toHaveLength(7);
    expect(s.filter((x) => x.colour === 'green')).toHaveLength(1);
    expect(payoutOf('red', 15)).toBeCloseTo((0.99 * 15) / 7, 12);
    expect(payoutOf('black', 15)).toBeCloseTo(2.1214285714, 9);
    expect(payoutOf('green', 15)).toBeCloseTo(14.85, 12);
    expect(payoutOf('edge', 15)).toBeCloseTo(7.425, 12);
  });

  it('every strip alternates colours, numbers each slot once and puts the edge slots next to green', () => {
    for (const n of STRIPS) {
      const s = stripOrder(n);
      expect(new Set(s.map((x) => x.number)).size).toBe(n);
      for (let i = 1; i < n - 1; i++) expect(s[i].colour).not.toBe(s[i + 1].colour);
      expect(s[0].colour).toBe('green');
      expect(s.filter((x) => x.edge).map((x) => x.number)).toEqual([1, n - 1]);
      // The strip wraps: the slots either side of green (positions 1 and n-1) are the edge slots.
      expect(s[1].edge && s[n - 1].edge).toBe(true);
    }
  });

  it('every bet on every strip returns exactly 99% (enumerating all slots)', () => {
    for (const n of STRIPS) {
      for (const k of BET_KEYS) {
        let hits = 0;
        for (let i = 0; i < n; i++) if (covers(k, i, n)) hits++;
        expect(hits).toBe(slotsCovered(k, n));
        expect(hits / n).toBeCloseTo(chanceOf(k, n), 14);
        expect((hits / n) * payoutOf(k, n)).toBeCloseTo(RTP, 12);
      }
    }
  });

  it('any mix of bets returns exactly 99% (linearity, checked by enumeration)', () => {
    const rng = createRng(seededSource(11));
    for (let t = 0; t < 400; t++) {
      const n = STRIPS[t % STRIPS.length];
      expect(layoutStats(randomLayout(rng), n).rtp).toBeCloseTo(RTP, 12);
    }
  });

  it('simulated spins match the exact chance of each bet (4 SE)', () => {
    const rng = createRng(seededSource(5));
    for (const n of [15, 55]) {
      const N = 150_000;
      const counts = new Map(BET_KEYS.map((k) => [k, 0]));
      for (let r = 0; r < N; r++) {
        const i = drawSlot(rng.next(), n);
        for (const k of BET_KEYS) if (covers(k, i, n)) counts.set(k, counts.get(k)! + 1);
      }
      for (const k of BET_KEYS) {
        const p = chanceOf(k, n);
        expect(Math.abs(counts.get(k)! / N - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / N));
      }
    }
  });

  it('simulated return of a mixed layout is 99% within 4 SE', () => {
    const rng = createRng(seededSource(8));
    const layout: Layout = { red: 2, green: 0.5, black: 0, edge: 1 };
    const stats = layoutStats(layout, 15);
    const N = 200_000;
    let sum = 0;
    for (let r = 0; r < N; r++) sum += spin(layout, 15, rng.next()).multiplier;
    expect(Math.abs(sum / N - RTP)).toBeLessThan((4 * stats.sd) / Math.sqrt(N));
  });

  it('paytable is sane: rarer bets pay more, longer strips pay more for green', () => {
    for (const n of STRIPS) {
      const ordered = [...BET_KEYS].sort((a, b) => chanceOf(b, n) - chanceOf(a, n));
      for (let i = 1; i < ordered.length; i++) expect(payoutOf(ordered[i], n)).toBeGreaterThanOrEqual(payoutOf(ordered[i - 1], n));
      expect(payoutOf('red', n)).toBeGreaterThan(1);
    }
    for (let i = 1; i < STRIPS.length; i++) expect(payoutOf('green', STRIPS[i])).toBeGreaterThan(payoutOf('green', STRIPS[i - 1]));
  });

  it('the max multiplier is honest: green on the 55 strip, never exceeded by any layout', () => {
    expect(MAX_MULTIPLIER).toBeCloseTo(RTP * 55, 12);
    expect(layoutStats({ ...EMPTY_LAYOUT, green: 1 }, 55).maxMult).toBeCloseTo(MAX_MULTIPLIER, 12);
    const rng = createRng(seededSource(21));
    for (let t = 0; t < 500; t++) {
      const n = STRIPS[t % STRIPS.length];
      expect(layoutStats(randomLayout(rng), n).maxMult).toBeLessThanOrEqual(MAX_MULTIPLIER + 1e-12);
    }
  });

  it('one spin consumes exactly one uniform and resolves once (the auto-bet play path)', () => {
    let calls = 0;
    const rng = createRng(seededSource(3));
    const counted = { next: () => (calls++, rng.next()) };
    const layout: Layout = { red: 1, green: 1, black: 0, edge: 0 };
    for (let r = 0; r < 1000; r++) {
      const res = spin(layout, 25, counted.next());
      expect(res.paid).toBeCloseTo(payoutAmount(layout, 25, res.slot), 12);
      expect(res.multiplier).toBeCloseTo(res.paid / 2, 12);
    }
    expect(calls).toBe(1000);
  });

  it('auto-bet scaling keeps the proportions and hits the target total to the cent', () => {
    const base: Layout = { red: 1, green: 0.1, black: 0, edge: 0.5 };
    for (const target of [0.5, 1.6, 3.2, 12.8, 1024.7]) {
      const l = scaleLayout(base, target);
      expect(totalOf(l)).toBeCloseTo(target, 8);
      expect(l.black).toBe(0);
      const f = target / totalOf(base);
      expect(Math.abs(l.edge - base.edge * f)).toBeLessThanOrEqual(0.0051);
      expect(Math.abs(l.green - base.green * f)).toBeLessThanOrEqual(0.0101);
    }
    expect(scaleLayout(scaleLayout(base, 1024), totalOf(base))).toEqual(base);
  });

  it('volatility knob spans low to extreme and P(win) over 25:1', () => {
    expect(volatilityOf(layoutStats({ ...EMPTY_LAYOUT, red: 1 }, 15).sd)).toBe('low');
    expect(volatilityOf(layoutStats({ ...EMPTY_LAYOUT, edge: 1 }, 15).sd)).toBe('medium');
    expect(volatilityOf(layoutStats({ ...EMPTY_LAYOUT, green: 1 }, 15).sd)).toBe('high');
    expect(volatilityOf(layoutStats({ ...EMPTY_LAYOUT, green: 1 }, 55).sd)).toBe('extreme');
    expect(chanceOf('red', 15) / chanceOf('green', 55)).toBeGreaterThan(25);
  });

  it('runEval RTP is within 4 SE of the manifest and the max is honest', () => {
    const reports = runEval(evalSpec, { rounds: 60_000 });
    for (const r of reports) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
