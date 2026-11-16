// Caldera's maths checks: parity with the engine pack (oracle.json), the RTP the pack measured, the free-spins
// algebra against the engine, the max-win cap, and the order of the spin flow (draw only after place()).
// This is a cluster game with a cascade ladder, so its RTP has no closed form: the "exact" check is the port
// replaying the pack's own Monte Carlo draw (same seeds, same spins) and matching the pack's RTP to 1e-12.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SlotEngine, createSlot, triggerScatters, type SlotSpec } from '@originals/slots';
import { award, multiplierAt, type SlotConfig } from '../../../packages/slots/src/engine/analytics/config';
import { featureValue } from '../../../packages/slots/src/engine/analytics/features';
import { mcSpinDistribution, spinSeeds } from '../../../packages/slots/src/engine/analytics/mc';
import { checkParity, type OracleFixture } from '../../../packages/slots/src/engine/parity';
import { Mulberry32 } from '../../../packages/slots/src/engine/rng';
import oracle from './oracle.json';
import featureSpecJson from './feature.spec.json';
import configJson from './slot.config.json';
import specJson from './slot.spec.json';

const dir = dirname(fileURLToPath(import.meta.url));
const spec = specJson as unknown as SlotSpec;
const featureSpec = featureSpecJson as unknown as SlotSpec;
const config = configJson as unknown as SlotConfig;
const feat = config.feature!;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ora = oracle as any;

const fixture = (entry: typeof ora.base, s: SlotSpec): OracleFixture => ({ ...entry, schema: 'slot_oracle_v1', spec: s });

describe('oracle parity (the TypeScript engine is the pack, spin for spin)', () => {
  it('base: all 2,000 seeds identical', () => {
    const r = checkParity(fixture(ora.base, spec));
    expect(r.firstMismatch).toBeNull();
    expect(r.seeds).toBe(2000);
  });
  it('feature: all 2,000 seeds identical', () => {
    const r = checkParity(fixture(ora.features.feature, featureSpec));
    expect(r.firstMismatch).toBeNull();
  });
  it('oracle.json is for this spec (the pack accepted a cluster + cascade_step_ladder build)', () => {
    expect(ora.base.context).toBe('cluster|global_mixture');
    expect(ora.base.families).toEqual(['cascade_step_ladder']);
    expect(ora.base.analytics.tier ?? 'mc').toBe('mc');
  });
});

describe('RTP equals the pack', () => {
  for (const [name, entry, s] of [
    ['base', ora.base, spec],
    ['feature', ora.features.feature, featureSpec],
  ] as const) {
    it(`${name}: replaying the pack's one-stream Monte Carlo gives the pack's RTP to 1e-12`, () => {
      // the pack's mc_stream: ONE Mulberry32(content seed) stream runs through n_mc consecutive spins
      const eng = new SlotEngine(s);
      const a = entry.analytics;
      const rng = new Mulberry32(a.instrument.seed);
      let sum = 0;
      for (let i = 0; i < a.n_mc; i++) sum += eng.spinRaw(rng).totalCoins;
      expect(Math.abs(sum / a.n_mc / s.bet.coins - a.rtp)).toBeLessThan(1e-12);
    }, 60_000);
  }
});

describe('the free-spins algebra against the engine', () => {
  it('E[feature win | 3 scatters] from the algebra is within 4 SE of playing the feature spin by spin', () => {
    const eng = new SlotEngine(featureSpec);
    const n0 = award(feat.awards, 3);
    // the algebra, from a Monte Carlo of the feature spin's own (coins, K) distribution
    const dist = mcSpinDistribution(featureSpec, (_s, seed) => eng.spin(seed), 300_000, 11, { scatters: (r) => triggerScatters(eng, r) });
    const algebra = featureValue(dist, feat, n0);
    // the engine: the same law (awards, retrigger, multiplier) played out, as createSlot.playRound does
    const rng = new Mulberry32(99);
    const plays = 20_000;
    let sum = 0;
    let sum2 = 0;
    for (let i = 0; i < plays; i++) {
      let left = n0;
      let granted = n0;
      let played = 0;
      let retriggers = 0;
      let total = 0;
      while (left > 0) {
        const res = eng.spin(rng.u32());
        total += res.totalCoins * multiplierAt(feat.multiplier, played + 1, retriggers);
        const a = award(feat.retrigger, triggerScatters(eng, res));
        const extra = Math.max(0, Math.min(a, feat.maxSpins - granted));
        granted += extra;
        if (a > 0) retriggers += 1;
        left += extra - 1;
        played += 1;
      }
      sum += total;
      sum2 += total * total;
    }
    const mean = sum / plays;
    const se = Math.sqrt((sum2 / plays - mean * mean) / plays);
    // the algebra's own error: its spin distribution is sampled too (spins per feature × per-spin SE)
    const spinSd = Math.sqrt(dist.p.reduce((s, p, i) => s + p * dist.coins[i] ** 2, 0) - dist.p.reduce((s, p, i) => s + p * dist.coins[i], 0) ** 2);
    const seAlg = (spinSd / Math.sqrt(300_000)) * algebra.expectedSpins;
    expect(Math.abs(mean - algebra.expectedWinCoins)).toBeLessThan(4 * Math.sqrt(se * se + seAlg * seAlg));
  }, 240_000);
});

describe('the max-win cap', () => {
  it('config caps a round at 3,000 stakes', () => {
    expect(config.maxWinStakes).toBe(3000);
    expect(createSlot({ spec, featureSpecs: { 'feature.spec.json': featureSpec }, feature: feat, maxWinStakes: config.maxWinStakes }).maxWinCoins).toBe(3000 * 100);
  });
  it('no round pays more than the cap, and a round that reaches it says so', () => {
    const cap = 12; // a tiny cap so that capped rounds are common
    const slot = createSlot({ spec, featureSpecs: { 'feature.spec.json': featureSpec }, feature: feat, maxWinStakes: cap });
    const rng = new Mulberry32(5);
    let capped = 0;
    let withFeature = 0;
    for (const seed of spinSeeds(6000, 3)) {
      const r = slot.playRound(seed, () => rng.u32());
      expect(r.totalCoins).toBeLessThanOrEqual(cap * 100);
      if (r.capped) {
        capped++;
        expect(r.totalCoins).toBe(cap * 100);
      }
      if (r.feature) withFeature++;
    }
    expect(capped).toBeGreaterThan(0);
    expect(withFeature).toBeGreaterThan(0);
  }, 120_000);
});

describe('the spin flow draws after place()', () => {
  const kit = readFileSync(join(dir, '../../../packages/slots/src/ui/SlotGame.tsx'), 'utf8');
  const game = readFileSync(join(dir, 'Game.tsx'), 'utf8');
  it("the kit awaits ticket.place before it takes a seed or calls playRound, behind a busy guard", () => {
    const play = kit.slice(kit.indexOf('async function play('));
    const guard = play.indexOf('busyRef.current');
    const place = play.indexOf('await ticket.place(');
    const seed = play.indexOf('seeds.next()');
    const round = play.indexOf('engine.playRound(');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(place);
    expect(place).toBeLessThan(seed);
    expect(seed).toBeLessThan(round);
  });
  it('the game hands the kit its spec and never spins or draws by itself', () => {
    expect(game).not.toMatch(/playRound|\.spin\(|Math\.random|engine=/);
    expect(game).toMatch(/<SlotGame/);
  });
});
