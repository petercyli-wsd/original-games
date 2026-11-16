// Honeycomb maths checks: oracle parity, exact RTP, the respin feature's algebra against the engine,
// the max-win cap, and the spin flow (draw after place).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createSlot, type SlotSpec } from '@originals/slots';
import { exactRtp } from '../../../packages/slots/src/engine/analytics/exact';
import { checkParity, type OracleFixture } from '../../../packages/slots/src/engine/parity';
import { featureStats } from './maths';
import config from './slot.config.json';
import specJson from './slot.spec.json';
import facts from './slot-facts.json';

const here = dirname(fileURLToPath(import.meta.url));
const spec = specJson as unknown as SlotSpec;
const oracle = JSON.parse(readFileSync(join(here, 'oracle.json'), 'utf8'));
const BET = spec.bet.coins;

// Spec without the respin mechanic: the ways part, which has an exact closed form.
const ways = exactRtp({ ...spec, mechanics: [] } as SlotSpec).rtp;
const stats = featureStats(spec, 2_000_000, 99);
const featureRtp = stats.pTrig * stats.mean;
const featureSe = stats.pTrig * stats.se;

describe('oracle parity', () => {
  it('the TypeScript spins equal the pack for all 2,000 seeds', () => {
    const b = oracle.base;
    const fx: OracleFixture = { schema: 'slot_oracle_v1', spec, packVersion: oracle.packVersion, specHash: b.specHash, context: b.context, families: b.families, decorSchema: b.decorSchema, seeds: b.seeds, spinHashes: b.spinHashes, fullSeeds: b.fullSeeds, spins: b.spins };
    const r = checkParity(fx);
    expect(r.firstMismatch).toBeNull();
    expect(r.seeds).toBe(2000);
  }, 120_000);

  it('the pack accepted a ways|hold-and-spin spec', () => {
    expect(oracle.base.context).toBe('ways|global_mixture');
    expect(oracle.base.families).toEqual(['hold_and_spin_lock_respin']);
  });
});

describe('RTP', () => {
  it('ways part (exact) + respin part (Monte Carlo) is 96% before the cap, within the stated error', () => {
    const total = ways + featureRtp;
    expect(Math.abs(total - 0.96)).toBeLessThan(0.0005 + 4 * featureSe);
  });
  it('the facts file states the same RTP, with its tier', () => {
    expect(facts.rtpTier).toBe('mc');
    expect(Math.abs(facts.rtp - (ways + featureRtp))).toBeLessThan(4 * facts.rtpSe + 0.001);
  });
  it('the pack Monte Carlo agrees within 4 SE', () => {
    const a = oracle.base.analytics;
    expect(a.tier).toBe('mc');
    expect(Math.abs(a.rtp - (ways + featureRtp))).toBeLessThan(4 * Math.hypot(a.rtp_se, featureSe));
  });
});

describe('respin feature', () => {
  it('the engine matches the independent respin model within 4 SE', () => {
    const slot = createSlot({ spec, maxWinStakes: 1e9 });
    let n = 0;
    let sum = 0;
    let sum2 = 0;
    for (let seed = 1; n < 3000 && seed < 3_000_000; seed++) {
      const r = slot.spin(seed);
      const x = r.extras.reduce((a, e) => a + e.coins, 0) / BET;
      if (x > 0) {
        n++;
        sum += x;
        sum2 += x * x;
      }
    }
    expect(n).toBe(3000);
    const mean = sum / n;
    const se = Math.sqrt((sum2 / n - mean * mean) / n);
    expect(Math.abs(mean - stats.mean)).toBeLessThan(4 * Math.hypot(se, stats.se));
  }, 300_000);

  it('triggers on 6 or more honey cells, 1 in about 118 spins', () => {
    expect(1 / stats.pTrig).toBeGreaterThan(100);
    expect(1 / stats.pTrig).toBeLessThan(135);
  });
  it('coin values are 1x to 500x and a full comb adds 1,000x', () => {
    const p = spec.mechanics[0].params as { value_pmf: Record<string, number>; full_grid_bonus: number };
    const v = Object.keys(p.value_pmf).map((k) => Number(k) / BET);
    expect(Math.min(...v)).toBe(1);
    expect(Math.max(...v)).toBe(500);
    expect(p.full_grid_bonus).toBe(1000);
  });
});

describe('max win', () => {
  it('declares a cap that the respins can really reach (about 1 in 60 million rounds)', () => {
    expect(config.maxWinStakes).toBe(2000);
    expect(facts.maxWin).toBe(2000);
    expect(facts.pMaxWin).toBeGreaterThan(1e-9);
  });
  it('no round pays above the cap, and a capped round pays exactly the cap', () => {
    const cap = 8;
    const slot = createSlot({ spec, maxWinStakes: cap });
    let capped = 0;
    for (let seed = 1; seed < 40_000; seed++) {
      const r = slot.playRound(seed, () => 0);
      expect(r.totalCoins).toBeLessThanOrEqual(cap * BET);
      if (r.capped) {
        capped++;
        expect(r.totalCoins).toBe(cap * BET);
      }
    }
    expect(capped).toBeGreaterThan(0);
    const real = createSlot({ spec, maxWinStakes: config.maxWinStakes });
    for (let seed = 1; seed < 20_000; seed++) expect(real.playRound(seed, () => 0).totalCoins).toBeLessThanOrEqual(2000 * BET);
  });
});

describe('spin flow', () => {
  it('the kit draws the seed only after the bet is placed, and Honeycomb engine is createSlot with only a label rewrite', () => {
    const kit = readFileSync(join(here, '../../../packages/slots/src/ui/SlotGame.tsx'), 'utf8');
    const play = kit.slice(kit.indexOf('async function play('));
    expect(play.indexOf('await ticket.place(')).toBeGreaterThan(-1);
    expect(play.indexOf('await ticket.place(')).toBeLessThan(play.indexOf('seeds.next()'));
    expect(play.indexOf('seeds.next()')).toBeLessThan(play.indexOf('engine.playRound('));
    expect(play).toContain('if (busyRef.current) return null;');
    const game = readFileSync(join(here, 'Game.tsx'), 'utf8');
    expect(game).toContain('createSlot(');
    expect(game).not.toMatch(/rng|Math\.random/);
  });
});
