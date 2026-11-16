import { describe, expect, it } from 'vitest';
import oracle from './oracle.json';
import spec from './slot.spec.json';
import featureSpec from './feature.spec.json';
import config from './slot.config.json';
import facts from './slot-facts.json';
import { mixtureModel } from './mixture';
import { createSlot, SlotEngine } from '../../../packages/slots/src/engine';
import type { SlotSpec } from '../../../packages/slots/src/engine/types';
import type { SlotConfig } from '../../../packages/slots/src/engine/analytics/config';
import { checkParity, type OracleFixture } from '../../../packages/slots/src/engine/parity';
import { distMean, distProb, exactSpinDistribution } from '../../../packages/slots/src/engine/analytics/distribution';
import { scatterCountDist, triggerProbability } from '../../../packages/slots/src/engine/analytics/exact';
import { freeSpinsAnalytics } from '../../../packages/slots/src/engine/analytics/features';
import { checkCopy } from '../../../packages/slots/src/ui';
import { copy } from './copy';
import { holdsTicket, noteSpin } from './walker';
import { createSeedSource, seededRng32 } from '../../../packages/slots/src/ui/engine-bridge';

const base = spec as unknown as SlotSpec;
const feat = featureSpec as unknown as SlotSpec;
const cfg = config as unknown as SlotConfig;
const feature = cfg.feature!;

const bm = mixtureModel(base);
const fm = mixtureModel(feat);
const bd = exactSpinDistribution(bm);
const fd = exactSpinDistribution(fm);
const baseRtp = distMean(bd) / base.bet.coins;
const alg = freeSpinsAnalytics({
  baseRtp,
  baseTier: 'exact_mixture',
  betCoins: base.bet.coins,
  featureBetCoins: feat.bet.coins,
  scatterDist: scatterCountDist(bm),
  scatterMin: 3,
  featureDist: fd,
  cfg: feature,
});

describe('oracle parity (the engine pack)', () => {
  it('base spec: 2,000 seeds identical', () => {
    const o = oracle.base as unknown as Omit<OracleFixture, 'spec'>;
    expect(checkParity({ ...o, spec: base } as OracleFixture).firstMismatch).toBeNull();
  });
  it('feature spec: 2,000 seeds identical', () => {
    const o = oracle.features.feature as unknown as Omit<OracleFixture, 'spec'>;
    expect(checkParity({ ...o, spec: feat } as OracleFixture).firstMismatch).toBeNull();
  });
  it('the pack saw the same specs', () => {
    expect(oracle.base.slug).toBe('noodle-cart');
    expect(oracle.base.analytics.tier).toBe('exact_mixture');
    expect(oracle.features.feature.families).toEqual(['expanding_wild', 'walking_wild']);
  });
});

describe('exact RTP equals the pack', () => {
  it('base spin', () => {
    expect(Math.abs(baseRtp - oracle.base.analytics.rtp)).toBeLessThan(1e-9);
  });
  it('feature spin', () => {
    expect(Math.abs(distMean(fd) / feat.bet.coins - oracle.features.feature.analytics.rtp)).toBeLessThan(1e-9);
  });
  it('trigger probability', () => {
    expect(Math.abs(triggerProbability(bm) - oracle.base.analytics.trigger_p)).toBeLessThan(1e-12);
  });
  it('total is 96.0% inside the band, and the facts agree', () => {
    const total = baseRtp + alg.featureRtp;
    expect(Math.abs(total - 0.96)).toBeLessThan(0.0005);
    expect(Math.abs(facts.rtpUncapped - total)).toBeLessThan(1e-9);
    expect(Math.abs(facts.rtp - total)).toBeLessThan(1e-4); // the cap costs under 0.001 points
  });
});

describe('the band of a medium game', () => {
  it('has the declared shape', () => {
    expect(cfg.volatility).toBe('medium');
    expect(facts.volatilitySd).toBeGreaterThan(5);
    expect(facts.volatilitySd).toBeLessThan(10);
    expect(facts.hitRate).toBeGreaterThan(0.2);
    expect(facts.hitRate).toBeLessThan(0.45);
    const oneIn = facts.featureFreq as number;
    expect(oneIn).toBeGreaterThan(80);
    expect(oneIn).toBeLessThan(300);
    expect(facts.avgFeatureWin).toBeGreaterThan(40); // the rush clearly beats the old 25x
    expect(facts.avgFeatureWin).toBeLessThan(150);
    expect(facts.dryStreakP95).toBeLessThanOrEqual(20);
    expect(distProb(bd, (c) => c > 0)).toBeGreaterThan(0.4);
  });
});

describe('feature algebra vs Monte Carlo of playRound', () => {
  it('feature and round means are within 4 SE', () => {
    const slot = createSlot({ spec: base, featureSpecs: { 'feature.spec.json': feat }, feature, maxWinStakes: 1e9 });
    const bet = base.bet.coins;
    const n = 250_000;
    let s1 = 0, s2 = 0, f1 = 0, f2 = 0, triggers = 0;
    for (let seed = 1; seed <= n; seed++) {
      const r = slot.playRound(seed, seededRng32(seed * 7919));
      const x = r.totalCoins / bet;
      const f = (r.feature?.totalCoins ?? 0) / bet;
      s1 += x; s2 += x * x; f1 += f; f2 += f * f;
      if (r.feature) triggers++;
    }
    const se = (a: number, b: number) => Math.sqrt(Math.max(0, b / n - (a / n) ** 2) / n);
    expect(Math.abs(s1 / n - (baseRtp + alg.featureRtp))).toBeLessThan(4 * se(s1, s2));
    expect(Math.abs(f1 / n - alg.featureRtp)).toBeLessThan(4 * se(f1, f2));
    const p = triggerProbability(bm);
    expect(Math.abs(triggers / n - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / n));
  }, 120_000);
});

describe('max win', () => {
  it('the cap holds and pays exactly the cap', () => {
    const lowCap = createSlot({ spec: base, featureSpecs: { 'feature.spec.json': feat }, feature, maxWinStakes: 30 });
    let capped = 0;
    for (let seed = 1; seed <= 60_000; seed++) {
      const r = lowCap.playRound(seed, seededRng32(seed));
      expect(r.totalCoins).toBeLessThanOrEqual(30 * base.bet.coins);
      if (r.capped) {
        capped++;
        expect(r.totalCoins).toBe(30 * base.bet.coins);
      }
    }
    expect(capped).toBeGreaterThan(0);
    const cap = cfg.maxWinStakes * base.bet.coins;
    expect(cap).toBe(1000 * base.bet.coins);
    const real = createSlot({ spec: base, featureSpecs: { 'feature.spec.json': feat }, feature, maxWinStakes: cfg.maxWinStakes });
    for (let seed = 1; seed <= 20_000; seed++) expect(real.playRound(seed, seededRng32(seed)).totalCoins).toBeLessThanOrEqual(cap);
  }, 120_000);
});

describe('spin flow', () => {
  it('draws only after the bet is placed', async () => {
    const slot = createSlot({ spec: base, featureSpecs: { 'feature.spec.json': feat }, feature, maxWinStakes: cfg.maxWinStakes });
    let draws = 0;
    const rng = {
      int: (n: number) => {
        draws++;
        return Math.floor(Math.random() * n);
      },
    } as never;
    const src = createSeedSource(slot, rng, base.bet.coins);
    expect(draws).toBe(0); // building the source draws nothing
    const log: string[] = [];
    const place = async () => {
      log.push('place');
      return true;
    };
    if (await place()) {
      const d = src.next();
      log.push('draw');
      slot.playRound(d.seed, d.rng32);
    }
    expect(log).toEqual(['place', 'draw']);
    expect(draws).toBeGreaterThan(0);
  });
  it('the walker turns its whole reel wild, covering any ticket there', () => {
    const eng = new SlotEngine(base);
    const walked = new Set<number>();
    for (let seed = 0; seed < 3000; seed++) {
      const r = eng.spin(seed);
      const j = r.decor['walking_wild.walker'] as number;
      walked.add(j);
      expect(r.finalBoard[j].every((v) => v === 2)).toBe(true);
    }
    expect(walked.size).toBe(5);
  });
});

describe('the ticket in the cook\'s hand', () => {
  it('is shown exactly where the walk covered a scatter, and nowhere else', () => {
    const eng = new SlotEngine(base);
    const strips = (base as unknown as { board_law: { reel_sets: { strips: number[][] }[] } }).board_law.reel_sets[0].strips;
    let withTicket = 0;
    for (let seed = 0; seed < 3000; seed++) {
      const r = eng.spin(seed);
      const j = r.decor['walking_wild.walker'] as number;
      noteSpin(base, r);
      for (let row = 0; row < 3; row++) {
        const raw = strips[j][(r.stops[j] + row) % strips[j].length];
        const shown = holdsTicket(r.decor, j, row, 2);
        expect(shown).toBe(raw === 1);
        if (shown) withTicket++;
        for (let c = 0; c < 5; c++) if (c !== j) expect(holdsTicket(r.decor, c, row, 2)).toBe(false);
      }
    }
    expect(withTicket).toBeGreaterThan(0);
  });
  it('is not drawn on a decor the engine never reported', () => {
    expect(holdsTicket(undefined, 0, 0, 2)).toBe(false);
    expect(holdsTicket({ 'walking_wild.walker': 0 }, 0, 0, 2)).toBe(false);
  });
});

describe('copy', () => {
  it('every line is under 9 words', () => {
    expect(checkCopy(copy)).toEqual([]);
  });
});
