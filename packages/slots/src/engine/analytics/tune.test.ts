import { describe, expect, it } from 'vitest';
import type { SlotSpec } from '../types';
import type { SlotConfig } from './config';
import { spinDistribution } from './distribution';
import { exactRtp, scatterCountDist } from './exact';
import { freeSpinsAnalytics } from './features';
import { buildModel } from './model';
import { makeTotalContext, measure, reel0Wilds, scatterGapViolations, totalRtp, tuneGame } from './tune';
import pack from './fixtures/pack-analytics.json';
import sampleSpec from './fixtures/sample-game/slot.spec.json';
import sampleFeature from './fixtures/sample-game/feature.spec.json';
import sampleConfig from './fixtures/sample-game/slot.config.json';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const cfg = (sampleConfig as unknown as SlotConfig).feature!;

function scalePays(s: SlotSpec, f: number): SlotSpec {
  const c = clone(s);
  for (const t of Object.values(c.pays.paytable)) for (const k of Object.keys(t)) t[k] = Math.round(t[k] * f);
  for (const k of Object.keys(c.pays.scatter_pay ?? {})) c.pays.scatter_pay![k] = Math.round(c.pays.scatter_pay![k] * f);
  return c;
}

/** The constraints the tuner promises, checked on the output. */
function checkOrder(before: SlotSpec, after: SlotSpec): void {
  for (const [sym, t] of Object.entries(after.pays.paytable)) {
    const counts = Object.keys(t).sort((a, b) => Number(a) - Number(b));
    for (let i = 1; i < counts.length; i++) expect(t[counts[i]]).toBeGreaterThan(t[counts[i - 1]]);
    void sym;
  }
  const sp = after.pays.scatter_pay ?? {};
  const sc = Object.keys(sp).sort((a, b) => Number(a) - Number(b));
  for (let i = 1; i < sc.length; i++) expect(sp[sc[i]]).toBeGreaterThan(sp[sc[i - 1]]);
  const syms = Object.keys(before.pays.paytable);
  for (const a of syms)
    for (const b of syms)
      for (const k of Object.keys(before.pays.paytable[a]))
        if (before.pays.paytable[a][k] > before.pays.paytable[b]?.[k]) expect(after.pays.paytable[a][k]).toBeGreaterThanOrEqual(after.pays.paytable[b][k]);
}

// the fixture holds the tuned pays; scale them up so the tuner has work to do
const spec0 = () => scalePays(sampleSpec as unknown as SlotSpec, 1.41);
const feat0 = () => scalePays(sampleFeature as unknown as SlotSpec, 1.41);

describe('total RTP as a function of the pays', () => {
  it('is linear (no cap): total(2x pays) = 2 total(pays) to 1e-12', () => {
    const b = spec0();
    const f = feat0();
    const ctx = makeTotalContext(b, f, cfg);
    const t1 = totalRtp(ctx, b, f);
    const t2 = totalRtp(ctx, scalePays(b, 2), scalePays(f, 2));
    expect(Math.abs(t2 - 2 * t1)).toBeLessThan(1e-12);
  });

  it('equals freeSpinsAnalytics(...).totalRtp to 1e-9 on the sample game', () => {
    const b = spec0();
    const f = feat0();
    const t = totalRtp(makeTotalContext(b, f, cfg), b, f);
    const bm = buildModel(b);
    const ex = exactRtp(bm);
    const a = freeSpinsAnalytics({
      baseRtp: ex.rtp,
      baseTier: ex.tier,
      betCoins: b.bet.coins,
      scatterDist: scatterCountDist(bm),
      scatterMin: 3,
      featureDist: spinDistribution(f),
      cfg,
    });
    expect(Math.abs(t - a.totalRtp)).toBeLessThan(1e-9);
    expect(Math.abs(measure(b, f, cfg).totalRtp - a.totalRtp)).toBeLessThan(1e-12);
  });
});

describe('tuneGame', () => {
  it('lands the sample game on 96% (feature included) and keeps the order constraints', () => {
    const b = spec0();
    const r = tuneGame(b, feat0(), cfg, 0.96);
    console.log(`sample game: ${(r.before.totalRtp * 100).toFixed(4)}% -> ${(r.after.totalRtp * 100).toFixed(6)}%, |error| ${r.error.toExponential(2)}`);
    expect(r.error).toBeLessThan(0.0005);
    expect(r.error).toBeLessThan(1e-5);
    expect(r.lockstep).toBe(true);
    checkOrder(b, r.base);
    expect(r.feature!.pays).toEqual(r.base.pays);
    // independent re-check with the feature algebra
    const bm = buildModel(r.base);
    const ex = exactRtp(bm);
    const a = freeSpinsAnalytics({
      baseRtp: ex.rtp, baseTier: ex.tier, betCoins: 4096, scatterDist: scatterCountDist(bm), scatterMin: 3,
      featureDist: spinDistribution(r.feature!), cfg,
    });
    expect(Math.abs(a.totalRtp - 0.96)).toBeLessThan(1e-5);
    expect(Object.values(r.base.pays.paytable).every((t) => Object.values(t).every((v) => Number.isInteger(v) && v >= 1))).toBe(true);
  });

  it('tunes a pack example back to 96% after its pays were scaled x1.1 (base only)', () => {
    const ex = (pack as unknown as { exact: { spec: SlotSpec }[] }).exact;
    for (const i of [0]) {
      // (example 3, both_max lines, also lands within 1e-9 but takes ~28 s: its enumeration is heavy)
      const original = clone(ex[i].spec);
      const scaled = scalePays(original, 1.1);
      const r = tuneGame(scaled, null, null, 0.96);
      console.log(`pack example ${i}: ${(r.before.totalRtp * 100).toFixed(4)}% -> ${(r.after.totalRtp * 100).toFixed(6)}%`);
      expect(r.before.totalRtp).toBeGreaterThan(1.0);
      expect(r.error).toBeLessThan(0.0005);
      checkOrder(scaled, r.base);
    }
  });

  it('--hit-rate moves the hit rate the requested way and keeps the scatter gap and reel 1 wild-free', () => {
    const b = spec0();
    const h0 = measure(b, feat0(), cfg).baseHitRate;
    const up = tuneGame(b, feat0(), cfg, 0.96, { hitRate: h0 + 0.05 });
    expect(up.after.baseHitRate).toBeGreaterThan(h0 + 0.02);
    const down = tuneGame(b, feat0(), cfg, 0.96, { hitRate: h0 - 0.04 });
    expect(down.after.baseHitRate).toBeLessThan(h0 - 0.015);
    for (const r of [up, down]) {
      expect(scatterGapViolations(r.base)).toEqual(scatterGapViolations(b));
      expect(reel0Wilds(r.base)).toEqual([]);
      expect(r.error).toBeLessThan(0.0005);
      expect(r.feature!.board_law).toEqual(r.base.board_law);
      // scatter and wild stops are exactly where they were
      const fixed = (s: SlotSpec) => s.board_law.reel_sets![0].strips.map((st) => st.map((x) => (x === 1 || x === 2 ? x : 0)));
      expect(fixed(r.base)).toEqual(fixed(b));
    }
  });

  it('--volatility moves the SD into the band and still lands on target', () => {
    const r = tuneGame(spec0(), feat0(), cfg, 0.96, { volatility: 'medium' });
    expect(r.before.sdStakes).toBeGreaterThan(10);
    expect(r.after.sdStakes).toBeGreaterThanOrEqual(5);
    expect(r.after.sdStakes).toBeLessThanOrEqual(10);
    expect(r.error).toBeLessThan(0.0005);
  });

  it('refuses a spec with no closed form, by reason', () => {
    const b = spec0();
    b.mechanics = [{ id: 'tape_continuation_refill' }];
    expect(() => tuneGame(b, null, null, 0.96)).toThrow(/no closed form/);
  });
});
