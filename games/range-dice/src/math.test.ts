import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  MAX_MULTIPLIER,
  MAX_WIN,
  RTP,
  SIZE,
  chanceOf,
  enumerateRtp,
  isValid,
  isWin,
  maxMultiplierOf,
  multiplierForWins,
  multiplierOf,
  playBet,
  setEnd,
  setMode,
  shift,
  winCount,
  winLimits,
  winZones,
  winsForChance,
  winsForMultiplier,
  withWins,
  type Config,
  type Mode,
} from './math';

const rng = createRng(seededSource(11));
const base = (mode: Mode, low: number, high: number, low2 = 0, high2 = 0): Config => ({ mode, low, high, low2, high2 });

/** A random valid set-up in a mode. */
function randomConfig(mode: Mode): Config {
  const [minW, maxW] = winLimits(mode);
  const w = minW + rng.int(maxW - minW + 1);
  const start = withWins(base(mode, 3000, 6999, 7500, 8999), w);
  return mode === 'two' ? start : shift(start, 0, rng.int(SIZE));
}

const EDGE_CASES: Config[] = [
  base('in', 0, 0),
  base('in', 9999, 9999),
  base('in', 0, 9799),
  base('in', 200, 9999),
  base('out', 1, 9997), // W = 2, one winning number each side
  base('out', 1, 9998), // W = 1 is not allowed...
  base('out', 0, 199),
  base('out', 4000, 4199),
  base('out', 1, 200),
  base('two', 0, 0, 2, 2),
  base('two', 0, 0, 9999, 9999),
  base('two', 0, 4899, 4901, 9799 + 0),
  base('two', 100, 199, 9000, 9099),
  base('two', 4000, 4999, 5001, 5999),
];

describe('Range Dice maths', () => {
  it('closed form: every allowed win count returns exactly the RTP, in every mode', () => {
    for (const mode of ['in', 'out', 'two'] as Mode[]) {
      const [minW, maxW] = winLimits(mode);
      for (let w = minW; w <= maxW; w++) expect((w / SIZE) * multiplierForWins(w)).toBeCloseTo(RTP, 12);
    }
  });

  it('payout table: 99 / chance, 4,950x cap outside and between two, 9,900x between', () => {
    expect(multiplierForWins(5000)).toBeCloseTo(1.98, 12);
    expect(multiplierForWins(9800)).toBeCloseTo(0.99 / 0.98, 12);
    expect(maxMultiplierOf('in')).toBe(9900);
    expect(maxMultiplierOf('out')).toBe(4950);
    expect(maxMultiplierOf('two')).toBe(4950);
  });

  it('enumeration over all 10,000 numbers returns exactly the RTP, every mode', () => {
    const configs = EDGE_CASES.filter(isValid);
    expect(configs.length).toBeGreaterThanOrEqual(10);
    for (let i = 0; i < 90; i++) configs.push(randomConfig((['in', 'out', 'two'] as Mode[])[i % 3]));
    for (const c of configs) {
      expect(isValid(c)).toBe(true);
      let wins = 0;
      for (let n = 0; n < SIZE; n++) if (isWin(c, n)) wins++;
      expect(wins).toBe(winCount(c));
      expect(enumerateRtp(c)).toBeCloseTo(RTP, 10);
    }
  });

  it('limits: Roll out and two ranges need W >= 2 with a winning number each side', () => {
    expect(isValid(base('out', 0, 9998))).toBe(false); // nothing on the left
    expect(isValid(base('out', 1, 9999))).toBe(false); // nothing on the right
    expect(isValid(base('out', 1, 9998))).toBe(true); // W = 2
    expect(isValid(base('in', 5, 5))).toBe(true); // W = 1
    expect(isValid(base('two', 0, 0, 1, 1))).toBe(false); // the ranges touch
    expect(isValid(base('two', 0, 0, 2, 2))).toBe(true);
    expect(isValid(base('in', 0, 9800))).toBe(false); // W = 9801
    expect(isValid(base('two', 0, 4900, 4902, 9801))).toBe(false); // W > 9800
  });

  it('simulated win rate and payout match the closed form (4 SE)', () => {
    const n = 200_000;
    for (const r of [base('in', 1000, 3999), base('out', 4500, 5499), base('in', 7000, 7099), base('two', 1000, 1999, 6000, 6999)]) {
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
    for (const r of [...EDGE_CASES.filter(isValid), randomConfig('in'), randomConfig('out'), randomConfig('two')]) {
      const zones = winZones(r);
      expect(zones.reduce((s, [a, b]) => s + (b - a), 0)).toBe(winCount(r));
      for (let n = 0; n < SIZE; n++) {
        const c = n + 0.5;
        expect(zones.some(([a, b]) => c >= a && c < b)).toBe(isWin(r, n));
      }
    }
  });

  it('paytable is monotone: more winning numbers, smaller payout', () => {
    for (let w = 2; w <= MAX_WIN; w++) expect(multiplierForWins(w)).toBeLessThan(multiplierForWins(w - 1));
  });

  it('the max multiplier is honest per mode', () => {
    expect(MAX_MULTIPLIER).toBe(9900);
    expect(manifest.maxMultiplier).toBe(MAX_MULTIPLIER);
    expect(multiplierOf(base('in', 42, 42))).toBe(9900);
    expect(multiplierOf(base('out', 1, 9998))).toBe(4950);
    expect(multiplierOf(base('two', 0, 0, 2, 2))).toBe(4950);
    for (let i = 0; i < 3000; i++) {
      const mode = (['in', 'out', 'two'] as Mode[])[i % 3];
      expect(multiplierOf(randomConfig(mode))).toBeLessThanOrEqual(maxMultiplierOf(mode));
    }
  });

  it('linked inputs: chance and multiplier map to whole win counts', () => {
    expect(winsForChance('in', 49.5)).toBe(4950);
    expect(winsForChance('in', 0)).toBe(1);
    expect(winsForChance('out', 0)).toBe(2);
    expect(winsForChance('two', 0.01)).toBe(2);
    expect(winsForChance('in', 100)).toBe(MAX_WIN);
    expect(winsForMultiplier('in', 2)).toBe(4950);
    expect(winsForMultiplier('in', 1)).toBe(MAX_WIN);
    expect(winsForMultiplier('in', 1e9)).toBe(1);
    expect(winsForMultiplier('out', 1e9)).toBe(2);
    for (const mode of ['in', 'out', 'two'] as Mode[]) {
      const r = withWins(randomConfig(mode), 3300);
      expect(isValid(r)).toBe(true);
      expect(winCount(r)).toBe(3300);
      expect(multiplierOf(r)).toBeCloseTo(3, 12);
    }
  });

  it('two ranges: a typed W is split in proportion to the widths', () => {
    const r = withWins(base('two', 1000, 1999, 5000, 6999), 3000); // widths 1000 : 2000
    expect(r.high - r.low + 1).toBe(1000);
    expect(r.high2 - r.low2 + 1).toBe(2000);
    const tiny = withWins(base('two', 1000, 1999, 5000, 6999), 2);
    expect(winCount(tiny)).toBe(2);
    expect(isValid(tiny)).toBe(true);
  });

  it('every editing operation keeps the set-up valid, in every mode', () => {
    for (let i = 0; i < 6000; i++) {
      let r = randomConfig((['in', 'out', 'two'] as Mode[])[rng.int(3)]);
      const k = rng.int(6);
      const v = rng.int(12000) - 1000;
      if (k === 0) r = setEnd(r, 'low', v);
      else if (k === 1) r = setEnd(r, 'high', v);
      else if (k === 2) r = setEnd(r, rng.next() < 0.5 ? 'low2' : 'high2', v);
      else if (k === 3) r = shift(r, rng.int(2) as 0 | 1, v);
      else if (k === 4) r = setMode(r, (['in', 'out', 'two'] as Mode[])[rng.int(3)]);
      else r = withWins(r, v);
      expect(isValid(r)).toBe(true);
    }
  });

  it('switching tabs keeps the first range where it is when it fits', () => {
    const c = base('in', 2525, 7474);
    const out = setMode(c, 'out');
    expect([out.low, out.high]).toEqual([2525, 7474]);
    const two = setMode(c, 'two');
    expect(isValid(two)).toBe(true);
    expect(two.mode).toBe('two');
  });

  it('each played bet resolves once, to 0 or the shown payout', () => {
    const r = base('two', 100, 2099, 5000, 5999);
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
