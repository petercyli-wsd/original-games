import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  CALL_BETS,
  CALL_KEYS,
  MAX_MULTIPLIER,
  POCKETS,
  RTP,
  SPOTS,
  SPOT_BY_ID,
  WHEEL_ORDER,
  addCall,
  addNeighbours,
  addTo,
  callChipCount,
  callNumbers,
  colourOf,
  layoutStats,
  neighbours,
  payoutFor,
  pocketOf,
  scaleLayout,
  spin,
  totalOf,
  volatilityOf,
  type Layout,
} from './math';

const count = (kind: string) => SPOTS.filter((s) => s.kind === kind).length;

describe('Roulette table', () => {
  it('is the single-zero wheel: 37 pockets, 18 red, 18 black, one green, each number once', () => {
    expect([...WHEEL_ORDER].sort((a, b) => a - b)).toEqual(Array.from({ length: 37 }, (_, i) => i));
    const cols = Array.from({ length: 37 }, (_, n) => colourOf(n));
    expect(cols.filter((c) => c === 'red')).toHaveLength(18);
    expect(cols.filter((c) => c === 'black')).toHaveLength(18);
    expect(cols.filter((c) => c === 'green')).toHaveLength(1);
    // Colours alternate around the wheel after zero.
    for (let i = 1; i < 36; i++) expect(colourOf(WHEEL_ORDER[i])).not.toBe(colourOf(WHEEL_ORDER[i + 1]));
  });

  it('has every standard bet position (157) with the standard coverage', () => {
    expect(SPOTS).toHaveLength(157);
    expect(new Set(SPOTS.map((s) => s.id)).size).toBe(157);
    expect(count('straight')).toBe(37);
    expect(count('split')).toBe(60);
    expect(count('street')).toBe(12);
    expect(count('trio')).toBe(2);
    expect(count('corner')).toBe(22);
    expect(count('basket')).toBe(1);
    expect(count('line')).toBe(11);
    expect(count('column')).toBe(3);
    expect(count('dozen')).toBe(3);
    for (const k of ['red', 'black', 'odd', 'even', 'low', 'high']) expect(SPOT_BY_ID[k].nums).toHaveLength(18);
    const sizes: Record<string, number> = { straight: 1, split: 2, street: 3, trio: 3, corner: 4, basket: 4, line: 6, column: 12, dozen: 12 };
    for (const s of SPOTS) if (sizes[s.kind]) expect(s.nums).toHaveLength(sizes[s.kind]);
  });

  it('pays the standard x-to-1 odds: 35, 17, 11, 8, 5, 2, 1', () => {
    const toOne = (id: string) => SPOT_BY_ID[id].pays - 1;
    expect(toOne('straight:17')).toBe(35);
    expect(toOne('split:17-20')).toBe(17);
    expect(toOne('street:16-17-18')).toBe(11);
    expect(toOne('trio:0-2-3')).toBe(11);
    expect(toOne('corner:16-17-19-20')).toBe(8);
    expect(toOne('basket:0-1-2-3')).toBe(8);
    expect(toOne('line:16-17-18-19-20-21')).toBe(5);
    expect(toOne('column:2')).toBe(2);
    expect(toOne('dozen:3')).toBe(2);
    expect(toOne('red')).toBe(1);
  });

  it('every bet returns exactly 36/37 (enumerating all 37 pockets)', () => {
    expect(RTP).toBeCloseTo(0.972972972972973, 15);
    for (const s of SPOTS) {
      let paid = 0;
      for (let p = 0; p < POCKETS; p++) paid += payoutFor({ [s.id]: 1 }, p);
      // Integer arithmetic: total paid over the 37 pockets is exactly 36.
      expect(paid).toBeCloseTo(36, 12);
    }
  });

  it('any mix of chips returns exactly 36/37 (linearity, checked by enumeration)', () => {
    const rng = createRng(seededSource(11));
    for (let t = 0; t < 300; t++) {
      let layout: Layout = {};
      const n = 1 + rng.int(8);
      for (let i = 0; i < n; i++) layout = addTo(layout, SPOTS[rng.int(SPOTS.length)].id, 0.1 * (1 + rng.int(50)));
      expect(layoutStats(layout).rtp).toBeCloseTo(RTP, 12);
    }
  });

  it('simulated spins hit every pocket at 1/37 and a straight-up returns 36/37 (4 SE)', () => {
    const rng = createRng(seededSource(5));
    const n = 370_000;
    const hits = new Array(POCKETS).fill(0);
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const r = spin({ 'straight:17': 1 }, rng.next());
      hits[r.pocket]++;
      sum += r.multiplier;
      sumSq += r.multiplier ** 2;
    }
    const p = 1 / POCKETS;
    for (const h of hits) expect(Math.abs(h / n - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / n));
    const mean = sum / n;
    const se = Math.sqrt((sumSq / n - mean ** 2) / n);
    expect(Math.abs(mean - RTP)).toBeLessThan(4 * se);
  });

  it('simulated return of a mixed layout with a call bet is 36/37 within 4 SE', () => {
    const rng = createRng(seededSource(9));
    let layout = addCall({}, 'voisins', 1);
    layout = addTo(addTo(layout, 'red', 5), 'dozen:2', 2);
    const n = 200_000;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const m = spin(layout, rng.next()).multiplier;
      sum += m;
      sumSq += m * m;
    }
    const mean = sum / n;
    const se = Math.sqrt((sumSq / n - mean ** 2) / n);
    expect(Math.abs(mean - RTP)).toBeLessThan(4 * se);
  });

  it('paytable is sane: payouts fall as coverage grows; the odds shown equal coverage / 37', () => {
    const sorted = [...SPOTS].sort((a, b) => a.nums.length - b.nums.length);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i].pays).toBeLessThanOrEqual(sorted[i - 1].pays);
    for (const s of SPOTS) expect(layoutStats({ [s.id]: 1 }).pHit).toBeCloseTo(s.nums.length / 37, 12);
  });

  it('announced bets: chip counts and coverage are the standard ones', () => {
    expect(CALL_KEYS.map(callChipCount)).toEqual([9, 6, 5, 4]);
    expect(callNumbers('voisins')).toHaveLength(17);
    expect(callNumbers('tiers')).toEqual([5, 8, 10, 11, 13, 16, 23, 24, 27, 30, 33, 36]);
    expect(callNumbers('orphelins')).toEqual([1, 6, 9, 14, 17, 20, 31, 34]);
    expect(callNumbers('zero')).toEqual([0, 3, 12, 15, 26, 32, 35]);
    // Voisins, Tiers and Orphelins split the wheel: 17 + 12 + 8 = 37 pockets, no overlap.
    const all = [...callNumbers('voisins'), ...callNumbers('tiers'), ...callNumbers('orphelins')];
    expect(new Set(all).size).toBe(37);
    // Every chip of every call is a real table position.
    for (const c of CALL_KEYS) for (const [id] of CALL_BETS[c].chips) expect(SPOT_BY_ID[id]).toBeDefined();
    // Tiers sits on contiguous wheel pockets 27…33.
    const i27 = WHEEL_ORDER.indexOf(27);
    expect(WHEEL_ORDER.slice(i27, i27 + 12).sort((a, b) => a - b)).toEqual(callNumbers('tiers'));
    expect(totalOf(addCall({}, 'voisins', 0.5))).toBeCloseTo(4.5, 10);
  });

  it('neighbours bets cover 2k+1 adjacent pockets with one straight-up each', () => {
    expect(neighbours(0, 2)).toEqual([3, 26, 0, 32, 15]);
    expect(neighbours(26, 1)).toEqual([3, 26, 0]);
    const layout = addNeighbours({}, 17, 4, 1);
    expect(Object.keys(layout)).toHaveLength(9);
    expect(layoutStats(layout).pHit).toBeCloseTo(9 / 37, 12);
  });

  it('the max multiplier is honest: 36 on a lone straight-up, never exceeded by any layout', () => {
    expect(MAX_MULTIPLIER).toBe(36);
    expect(layoutStats({ 'straight:0': 2 }).maxMult).toBe(36);
    const rng = createRng(seededSource(21));
    for (let t = 0; t < 300; t++) {
      let layout: Layout = {};
      for (let i = 0; i < 1 + rng.int(6); i++) layout = addTo(layout, SPOTS[rng.int(SPOTS.length)].id, 0.01 * (1 + rng.int(500)));
      expect(layoutStats(layout).maxMult).toBeLessThanOrEqual(MAX_MULTIPLIER + 1e-12);
    }
  });

  it('one spin consumes exactly one uniform and resolves once (the auto-bet play path)', () => {
    let calls = 0;
    const u = 0.5;
    const r = spin({ red: 1 }, (calls++, u));
    expect(calls).toBe(1);
    expect(r.pocket).toBe(pocketOf(u));
    expect(pocketOf(0)).toBe(0);
    expect(pocketOf(0.999999999)).toBe(36);
    expect(r.winners.every((id) => SPOT_BY_ID[id].nums.includes(r.pocket))).toBe(true);
  });

  it('auto-bet scaling keeps the proportions and hits the target total to the cent', () => {
    const base = addCall(addTo({}, 'red', 3), 'tiers', 1);
    for (const target of [0.37, 1, 4.5, 18, 123.45]) {
      const s = scaleLayout(base, target);
      expect(Math.round(totalOf(s) * 100)).toBe(Math.round(target * 100));
      expect(Object.keys(s).sort()).toEqual(Object.keys(base).sort());
    }
  });

  it('volatility spans low to extreme, and P(win) spans over 25:1', () => {
    expect(volatilityOf(layoutStats({ red: 1 }).sd)).toBe('low');
    expect(volatilityOf(layoutStats({ 'dozen:1': 1 }).sd)).toBe('medium');
    expect(volatilityOf(layoutStats({ 'street:1-2-3': 1 }).sd)).toBe('high');
    expect(volatilityOf(layoutStats({ 'straight:5': 1 }).sd)).toBe('extreme');
    const wide = layoutStats({ 'dozen:1': 1, 'dozen:2': 1, 'dozen:3': 1 }).pHit;
    expect(wide / layoutStats({ 'straight:5': 1 }).pHit).toBeGreaterThanOrEqual(25);
  });

  it('runEval RTP is within 4 SE of the manifest and the max is honest', () => {
    for (const r of runEval(evalSpec, { rounds: 60_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
