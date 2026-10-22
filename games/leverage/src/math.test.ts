import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  EXPIRIES,
  MAX_LEVERAGE,
  MAX_MULTIPLIER,
  MIN_LEVERAGE,
  RTP,
  barrierHit,
  barriersOf,
  bustPrice,
  bustTicks,
  levFromSlider,
  odds,
  playPosition,
  priceAt,
  sliderFromLev,
  slTicks,
  startOdds,
  tickMove,
  tickSize,
  ticksFor,
  tpTicks,
  valueAt,
  type Barriers,
  type Direction,
} from './math';

describe('Leverage lattice', () => {
  it('the bust price is exactly n ticks away, and the value there is exactly 0', () => {
    for (let lev = MIN_LEVERAGE; lev <= MAX_LEVERAGE; lev++) {
      const n = bustTicks(lev);
      expect(Number.isInteger(n) && n >= 10).toBe(true);
      // A tick is about one basis point for every leverage.
      expect(tickSize(lev)).toBeGreaterThan(0.9e-4);
      expect(tickSize(lev)).toBeLessThan(1.11e-4);
      for (const dir of ['up', 'down'] as Direction[]) {
        expect(priceAt(5000, lev, dir, -n)).toBeCloseTo(bustPrice(5000, lev, dir), 9);
      }
      expect(valueAt(-n, n)).toBe(0);
      expect(valueAt(0, n)).toBe(RTP);
      // Every tick moves the value by exactly RTP/n of the stake, so stake × (1 + L·return) holds on the lattice.
      for (const k of [-n + 1, -3, 0, 7, 3 * n]) {
        expect(valueAt(k + 1, n) - valueAt(k, n)).toBeCloseTo(RTP / n, 12);
        const ret = (priceAt(5000, lev, 'up', k) - 5000) / 5000;
        expect(valueAt(k, n)).toBeCloseTo(RTP * (1 + lev * ret), 9);
      }
    }
  });

  it('the value is a martingale at every live state', () => {
    for (const lev of [2, 37, 100, 999, 1000]) {
      const n = bustTicks(lev);
      for (let k = -n + 1; k < n * 3; k += Math.max(1, Math.floor(n / 7))) {
        expect(0.5 * valueAt(k + 1, n) + 0.5 * valueAt(k - 1, n)).toBeCloseTo(valueAt(k, n), 12);
      }
    }
    expect(tickMove(0.4999999)).toBe(1);
    expect(tickMove(0.5)).toBe(-1);
  });

  it('take profit and stop loss snap to the lattice on the right side of the typed level', () => {
    for (const lev of [2, 50, 333, 1000]) {
      const n = bustTicks(lev);
      for (const tp of [1.01, 1.5, 2, 7.77]) {
        const b = tpTicks(tp, n)!;
        expect(valueAt(b, n)).toBeGreaterThanOrEqual(tp - 1e-9);
        expect(valueAt(b - 1, n) < tp - 1e-9 || b === 1).toBe(true);
      }
      for (const sl of [0.01, 0.3, 0.9, 0.98]) {
        const a = slTicks(sl, n);
        expect(a).toBeGreaterThanOrEqual(-n);
        expect(a).toBeLessThanOrEqual(-1);
        if (a > -n) expect(valueAt(a, n)).toBeLessThanOrEqual(sl + 1e-9);
        if (a > -n) expect(valueAt(a + 1, n)).toBeGreaterThan(sl - 1e-9);
      }
      expect(slTicks(null, n)).toBe(-n);
      expect(tpTicks(null, n)).toBeNull();
    }
  });
});

describe('Leverage odds (exact DP)', () => {
  it('every setup is worth exactly RTP: the DP expectation of holding equals the value now', () => {
    for (const lev of [2, 10, 100, 250, 1000]) {
      for (const expiry of EXPIRIES) {
        for (const tp of [null, 1.2, 3]) {
          for (const sl of [null, 0.5]) {
            const b = barriersOf({ lev, dir: 'up', expiry, tp, sl });
            const o = odds(0, b, b.T);
            expect(o.ev).toBeCloseTo(RTP, 9);
            expect(o.tp + o.lo + o.expire).toBeCloseTo(1, 9);
            expect(o.profit).toBeLessThanOrEqual(1 + 1e-12);
            // And from mid-round states too.
            for (const k of [b.lo + 1, -1, 3]) {
              if (barrierHit(k, b)) continue;
              expect(odds(k, b, Math.floor(b.T / 3)).ev).toBeCloseTo(valueAt(k, b.n), 9);
            }
          }
        }
      }
    }
  });

  it('with a long clock the DP matches gambler’s ruin a/(a+b)', () => {
    const b: Barriers = { n: 10, lo: -10, hi: 20, T: 20_000 };
    const o = odds(0, b, b.T);
    expect(o.tp).toBeCloseTo(10 / 30, 9);
    expect(o.lo).toBeCloseTo(20 / 30, 9);
    expect(o.expire).toBeLessThan(1e-12);
  });

  it('the odds shown equal the simulated frequencies (4 SE)', () => {
    const rng = createRng(seededSource(11));
    for (const [lev, expiry, tp, sl] of [
      [1000, 10, 2, null],
      [400, 30, 1.5, 0.5],
      [100, 10, null, null],
    ] as const) {
      const b = barriersOf({ lev, dir: 'down', expiry, tp, sl });
      const o = odds(0, b, b.T);
      const N = 40_000;
      let tpHits = 0;
      let loHits = 0;
      let profit = 0;
      for (let i = 0; i < N; i++) {
        const r = playPosition(b, rng);
        if (r.outcome === 'tp') tpHits++;
        if (r.outcome === 'sl' || r.outcome === 'bust') loHits++;
        if (r.multiplier > 1) profit++;
      }
      for (const [p, hits] of [
        [o.tp, tpHits],
        [o.lo, loHits],
        [o.profit, profit],
      ]) {
        expect(Math.abs(hits / N - p)).toBeLessThanOrEqual(4 * Math.sqrt((p * (1 - p)) / N) + 1e-12);
      }
    }
  });

  it('the walk lands on the bust level, never past it', () => {
    const rng = createRng(seededSource(5));
    const b = barriersOf({ lev: 1000, dir: 'up', expiry: 60, tp: null, sl: null });
    let busts = 0;
    for (let i = 0; i < 20_000; i++) {
      const r = playPosition(b, rng);
      expect(r.k).toBeGreaterThanOrEqual(-b.n);
      expect(r.multiplier).toBeGreaterThanOrEqual(0);
      expect(r.ticks).toBeLessThanOrEqual(b.T);
      if (r.outcome === 'bust') {
        busts++;
        expect(r.k).toBe(-b.n);
        expect(r.multiplier).toBe(0);
      }
    }
    expect(busts / 20_000).toBeCloseTo(startOdds(b).lo, 1);
  });

  it('a position resolves exactly once, within the expiry (the Auto mode round)', () => {
    const rng = createRng(seededSource(9));
    for (let i = 0; i < 2000; i++) {
      const b = barriersOf({ lev: 2 + rng.int(999), dir: 'up', expiry: EXPIRIES[rng.int(3)], tp: rng.next() < 0.5 ? 1.5 : null, sl: null });
      const r = playPosition(b, rng);
      expect(r.ticks).toBeGreaterThan(0);
      expect(r.ticks).toBeLessThanOrEqual(b.T);
      expect(['tp', 'sl', 'bust', 'expired']).toContain(r.outcome);
    }
  });
});

describe('Leverage limits and RTP', () => {
  it('the max multiplier is an honest bound', () => {
    for (let lev = MIN_LEVERAGE; lev <= MAX_LEVERAGE; lev++) {
      expect(valueAt(ticksFor(60), bustTicks(lev))).toBeLessThanOrEqual(MAX_MULTIPLIER + 1e-9);
    }
    expect(valueAt(ticksFor(60), bustTicks(1000))).toBeCloseTo(MAX_MULTIPLIER, 9);
    expect(manifest.maxMultiplier).toBe(MAX_MULTIPLIER);
  });

  it('the leverage slider covers 2× to 1000×', () => {
    expect(levFromSlider(0)).toBe(2);
    expect(levFromSlider(1000)).toBe(1000);
    for (const lev of [2, 10, 100, 1000]) expect(levFromSlider(sliderFromLev(lev))).toBe(lev);
  });

  it('simulated RTP matches the manifest for every volatility level', () => {
    for (const r of runEval(evalSpec, { rounds: 30_000, seed: 3 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
