import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec, { FAMILIES, configRtp } from './eval';
import manifest from './manifest';
import {
  ALL_ROLLS,
  BETS,
  BET_BY_ID,
  MAX_MULTIPLIER,
  RTP,
  TOTAL_PAYS,
  betStats,
  layoutRtp,
  layoutStats,
  returnOf,
  rollDice,
  scaleLayout,
  settle,
  totalOf,
  type Layout,
} from './math';

// Closed forms from the header: Σ returns over the 216 rolls, per bet.
const TOTAL_COUNTS: Record<number, number> = { 3: 1, 4: 3, 5: 6, 6: 10, 7: 15, 8: 21, 9: 25, 10: 27, 11: 27, 12: 25, 13: 21, 14: 15, 15: 10, 16: 6, 17: 3, 18: 1 };
function closedFormSum(id: string): number {
  const b = BET_BY_ID[id];
  switch (b.kind) {
    case 'small':
    case 'big':
    case 'odd':
    case 'even':
      return 2 * 105;
    case 'total':
      return (TOTAL_PAYS[b.a!] + 1) * TOTAL_COUNTS[b.a!];
    case 'single':
      return 2 * 75 + 3 * 15 + 4 * 1;
    case 'combo':
      return 6 * 30;
    case 'double':
      return 11 * 16;
    case 'triple':
      return 181;
    case 'anyTriple':
      return 31 * 6;
  }
}

describe('Sic Bo maths', () => {
  it('the table has the 50 standard bets plus odd / even', () => {
    expect(BETS).toHaveLength(52);
    expect(new Set(BETS.map((b) => b.id)).size).toBe(52);
    expect(ALL_ROLLS).toHaveLength(216);
  });

  it('every bet returns exactly its closed-form RTP (enumeration of 216 rolls)', () => {
    for (const b of BETS) {
      const s = betStats(b.id);
      expect(s.sum, b.id).toBe(closedFormSum(b.id));
      expect(s.rtp).toBeCloseTo(closedFormSum(b.id) / 216, 14);
    }
    expect(RTP).toBeCloseTo(35 / 36, 14);
    expect(manifest.rtp).toBeCloseTo(0.972222222222, 10);
    // Spot-check the familiar house edges.
    expect(betStats('single-4').rtp).toBeCloseTo(199 / 216, 14); // 7.87%
    expect(betStats('double-2').rtp).toBeCloseTo(176 / 216, 14); // 18.52%
    expect(betStats('triple-6').rtp).toBeCloseTo(181 / 216, 14); // 16.20%
    expect(betStats('total-9').rtp).toBeCloseTo(175 / 216, 14); // 18.98%
  });

  it('win counts match the combinatorics', () => {
    expect(betStats('small').wins).toBe(105);
    expect(betStats('odd').wins).toBe(105);
    expect(betStats('single-1').wins).toBe(91); // 216 − 125
    expect(betStats('combo-2-5').wins).toBe(30); // 216 − 125 − 125 + 64
    expect(betStats('double-3').wins).toBe(16);
    expect(betStats('anyTriple').wins).toBe(6);
    for (let t = 4; t <= 17; t++) expect(betStats(`total-${t}`).wins).toBe(TOTAL_COUNTS[t]);
  });

  it('paytable sanity: totals symmetric, rarer totals never pay less', () => {
    for (let t = 4; t <= 10; t++) expect(TOTAL_PAYS[t]).toBe(TOTAL_PAYS[21 - t]);
    for (let t = 4; t < 10; t++) {
      expect(TOTAL_COUNTS[t]).toBeLessThan(TOTAL_COUNTS[t + 1]);
      expect(TOTAL_PAYS[t]).toBeGreaterThanOrEqual(TOTAL_PAYS[t + 1]);
    }
    // Every bet is a house bet (RTP < 1) and Big / Small is the best.
    for (const b of BETS) {
      expect(betStats(b.id).rtp).toBeLessThan(1);
      expect(betStats(b.id).rtp).toBeLessThanOrEqual(RTP + 1e-15);
    }
    // Triples lose Big / Small / Odd / Even.
    for (const n of [1, 2, 3, 4, 5, 6]) for (const id of ['small', 'big', 'odd', 'even']) expect(returnOf(BET_BY_ID[id], [n, n, n])).toBe(0);
  });

  it('a layout returns the stake-weighted average RTP, exactly', () => {
    const rng = createRng(seededSource(11));
    for (let i = 0; i < 40; i++) {
      const l: Layout = {};
      for (const b of BETS) if (rng.next() < 0.15) l[b.id] = 1 + Math.floor(rng.next() * 9);
      if (totalOf(l) === 0) l.big = 1;
      let sum = 0;
      for (const d of ALL_ROLLS) sum += settle(l, d).paid;
      expect(sum / 216 / totalOf(l)).toBeCloseTo(layoutRtp(l), 12);
      expect(layoutStats(l).rtp).toBeCloseTo(layoutRtp(l), 12);
      expect(layoutStats(l).maxMult).toBeLessThanOrEqual(MAX_MULTIPLIER);
    }
  });

  it('the shown chances equal the simulated frequency of the raw dice', () => {
    const rng = createRng(seededSource(5));
    const n = 200_000;
    const ids = ['big', 'even', 'total-10', 'single-3', 'combo-1-6', 'double-5', 'anyTriple'];
    const hits = Object.fromEntries(ids.map((id) => [id, 0]));
    const faces = [0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      const d = rollDice(rng.next(), rng.next(), rng.next());
      faces[d[0]]++;
      for (const id of ids) if (returnOf(BET_BY_ID[id], d) > 0) hits[id]++;
    }
    for (const id of ids) {
      const p = betStats(id).chance;
      expect(Math.abs(hits[id] / n - p), id).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / n));
    }
    for (let f = 1; f <= 6; f++) expect(Math.abs(faces[f] / n - 1 / 6)).toBeLessThan(4 * Math.sqrt(5 / 36 / n));
  });

  it('simulated return of each bet matches its exact RTP', () => {
    const rng = createRng(seededSource(9));
    const n = 150_000;
    for (const id of ['small', 'odd', 'total-7', 'single-2', 'combo-3-4', 'double-1', 'anyTriple']) {
      const b = BET_BY_ID[id];
      let s1 = 0;
      let s2 = 0;
      for (let i = 0; i < n; i++) {
        const r = returnOf(b, rollDice(rng.next(), rng.next(), rng.next()));
        s1 += r;
        s2 += r * r;
      }
      const mean = s1 / n;
      const se = Math.sqrt((s2 / n - mean * mean) / n);
      expect(Math.abs(mean - betStats(id).rtp), id).toBeLessThan(4 * se);
    }
  });

  it('auto-bet scaling keeps proportions and hits the target total exactly', () => {
    const base: Layout = { big: 3, 'total-11': 1, 'triple-6': 0.5 };
    for (const target of [0.07, 1, 4.5, 9.99, 123.45]) {
      const s = scaleLayout(base, target);
      expect(totalOf(s)).toBeCloseTo(target, 9);
      expect(Object.keys(s).sort()).toEqual(Object.keys(base).sort());
    }
    // One auto round = one roll settled once: the multiplier times the stake is the paid amount.
    const d = rollDice(0.9, 0.1, 0.5);
    const r = settle(scaleLayout(base, 9), d);
    expect(r.paid).toBeCloseTo(r.multiplier * 9, 9);
  });

  it('eval configs declare their exact RTP and the max payout is honest', () => {
    expect(configRtp(FAMILIES[0].layouts)).toBeCloseTo(35 / 36, 14);
    expect(configRtp(FAMILIES[3].layouts)).toBeCloseTo(181 / 216, 14);
    expect(MAX_MULTIPLIER).toBe(181);
    for (const r of runEval(evalSpec, { rounds: 60_000 })) {
      expect(Math.abs(r.rtp - r.targetRtp!), r.label).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
