import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  MAX_MULTIPLIER,
  MAX_WIN,
  MIN_WIN,
  PRESETS,
  RTP,
  SIZE,
  chanceOf,
  enumerateRtp,
  flip,
  isValid,
  isWin,
  multiplierForWins,
  multiplierOf,
  placeWidth,
  playBet,
  setEnd,
  shift,
  width,
  winCount,
  winZones,
  winsForChance,
  winsForMultiplier,
  withWins,
  type Direction,
  type Range,
} from './math';

const rng = createRng(seededSource(11));

function randomRange(dir: Direction): Range {
  const base = withWins({ low: 0, high: SIZE - 1, dir }, MIN_WIN + Math.floor(rng.next() * (MAX_WIN - MIN_WIN + 1)));
  return shift(base, Math.floor(rng.next() * (SIZE - width(base) + 1)));
}

const EDGE_CASES: Range[] = [
  { low: 0, high: 0, dir: 'in' },
  { low: 9999, high: 9999, dir: 'in' },
  { low: 0, high: 9799, dir: 'in' },
  { low: 200, high: 9999, dir: 'in' },
  { low: 0, high: 9998, dir: 'out' },
  { low: 1, high: 9999, dir: 'out' },
  { low: 0, high: 199, dir: 'out' },
  { low: 9800, high: 9999, dir: 'out' },
  { low: 4000, high: 4199, dir: 'out' },
];

describe('Range Dice maths', () => {
  it('closed form: every allowed win count returns exactly the RTP', () => {
    for (let w = MIN_WIN; w <= MAX_WIN; w++) {
      expect((w / SIZE) * multiplierForWins(w)).toBeCloseTo(RTP, 12);
    }
  });

  it('enumeration over all 10,000 numbers returns exactly the RTP, both directions', () => {
    const ranges = [...EDGE_CASES];
    for (let i = 0; i < 60; i++) ranges.push(randomRange(i % 2 ? 'in' : 'out'));
    for (const r of ranges) {
      expect(isValid(r)).toBe(true);
      let wins = 0;
      for (let n = 0; n < SIZE; n++) if (isWin(r, n)) wins++;
      expect(wins).toBe(winCount(r));
      expect(enumerateRtp(r)).toBeCloseTo(RTP, 10);
    }
  });

  it('simulated win rate and payout match the closed form (4 SE)', () => {
    const n = 200_000;
    for (const r of [
      { low: 1000, high: 3999, dir: 'in' as const },
      { low: 4500, high: 5499, dir: 'out' as const },
      { low: 7000, high: 7099, dir: 'in' as const },
    ]) {
      const p = chanceOf(r);
      const m = multiplierOf(r);
      let wins = 0;
      let paid = 0;
      for (let i = 0; i < n; i++) {
        const b = playBet(r, rng.next());
        if (b.win) wins++;
        paid += b.multiplier;
      }
      expect(Math.abs(wins / n - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / n));
      const sd = m * Math.sqrt(p * (1 - p));
      expect(Math.abs(paid / n - RTP)).toBeLessThan(4 * (sd / Math.sqrt(n)));
    }
  });

  it('the painted win zones are exactly the winning numbers (odds on screen = true odds)', () => {
    for (const r of [...EDGE_CASES, randomRange('in'), randomRange('out')]) {
      const zones = winZones(r);
      expect(zones.reduce((s, [a, b]) => s + (b - a), 0)).toBe(winCount(r));
      for (let n = 0; n < SIZE; n++) {
        const c = n + 0.5;
        expect(zones.some(([a, b]) => c >= a && c < b)).toBe(isWin(r, n));
      }
    }
  });

  it('paytable is monotone: more winning numbers, smaller payout', () => {
    for (let w = MIN_WIN + 1; w <= MAX_WIN; w++) expect(multiplierForWins(w)).toBeLessThan(multiplierForWins(w - 1));
    expect(multiplierForWins(MAX_WIN)).toBeCloseTo(0.99 / 0.98, 12);
  });

  it('the max multiplier is honest and reachable in both directions', () => {
    expect(MAX_MULTIPLIER).toBe(9900);
    expect(manifest.maxMultiplier).toBe(MAX_MULTIPLIER);
    expect(multiplierOf({ low: 42, high: 42, dir: 'in' })).toBe(9900);
    expect(multiplierOf({ low: 1, high: 9999, dir: 'out' })).toBe(9900);
    for (let i = 0; i < 2000; i++) expect(multiplierOf(randomRange(i % 2 ? 'in' : 'out'))).toBeLessThanOrEqual(MAX_MULTIPLIER);
  });

  it('linked inputs: chance and multiplier map to whole win counts', () => {
    expect(winsForChance(49.5)).toBe(4950);
    expect(winsForChance(0)).toBe(MIN_WIN);
    expect(winsForChance(100)).toBe(MAX_WIN);
    expect(winsForMultiplier(2)).toBe(4950);
    expect(winsForMultiplier(1)).toBe(MAX_WIN);
    expect(winsForMultiplier(1e9)).toBe(MIN_WIN);
    for (const m of PRESETS) expect(multiplierForWins(winsForMultiplier(m))).toBeCloseTo(m, 12);
    const r = withWins({ low: 2000, high: 2999, dir: 'out' }, 3300);
    expect(winCount(r)).toBe(3300);
    expect(multiplierOf(r)).toBeCloseTo(3, 12);
  });

  it('every editing operation keeps the range valid', () => {
    for (let i = 0; i < 5000; i++) {
      let r = randomRange(rng.next() < 0.5 ? 'in' : 'out');
      const k = Math.floor(rng.next() * 5);
      const v = Math.floor(rng.next() * 12000) - 1000;
      if (k === 0) r = setEnd(r, 'low', v);
      else if (k === 1) r = setEnd(r, 'high', v);
      else if (k === 2) r = shift(r, v);
      else if (k === 3) r = flip(r);
      else r = withWins(r, v);
      expect(isValid(r)).toBe(true);
    }
    const p = placeWidth({ low: 9990, high: 9999 }, 500);
    expect(p).toEqual({ low: 9500, high: 9999 });
  });

  it('auto-bet: each played bet resolves once, to 0 or the shown payout', () => {
    const r: Range = { low: 100, high: 2099, dir: 'out' };
    const m = multiplierOf(r);
    for (let i = 0; i < 1000; i++) {
      const b = playBet(r, rng.next());
      expect(b.multiplier === 0 || b.multiplier === m).toBe(true);
      expect(b.result).toBeGreaterThanOrEqual(0);
      expect(b.result).toBeLessThan(SIZE);
    }
  });

  it('simulated RTP matches the manifest', () => {
    for (const r of runEval(evalSpec, { rounds: 100_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
