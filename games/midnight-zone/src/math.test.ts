// Midnight Zone maths: parity with the engine pack's oracle, the RTP, the feature algebra against
// simulated rounds, the max-win cap and the fairness of the spin flow.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createSeedSource } from '@originals/slots/ui';
import { seededSource } from '@originals/game-sdk';
import { SlotEngine, createSlot, triggerScatters, canonicalSpin, type SlotSpec } from '@originals/slots';
import type { FreeSpinsConfig, SlotConfig } from '../../../packages/slots/src/engine/analytics/config';
import { empiricalDist } from '../../../packages/slots/src/engine/analytics/distribution';
import { featureValue } from '../../../packages/slots/src/engine/analytics/features';
import { mulberry32 } from '../../../packages/slots/src/engine/analytics/rng';
import spec from './slot.spec.json';
import featureSpec from './feature.spec.json';
import config from './slot.config.json';
import oracle from './oracle.json';

const here = dirname(fileURLToPath(import.meta.url));
const base = spec as unknown as SlotSpec;
const feat = featureSpec as unknown as SlotSpec;
const cfg = config as unknown as SlotConfig;
const fcfg = cfg.feature as FreeSpinsConfig;
const bet = base.bet.coins;

describe('oracle parity (the pack and the TypeScript port draw the same spins)', () => {
  it('base spec: every seed in oracle.json gives the same spin', () => {
    const spins = oracle.base.spins as unknown[];
    expect(spins.length).toBe(oracle.base.seeds);
    for (let s = 0; s < spins.length; s++) expect(canonicalSpin(base, s)).toEqual(spins[s]);
  });
  it('feature spec: every seed in oracle.json gives the same spin', () => {
    const f = (oracle.features as Record<string, { spins: unknown[]; seeds: number }>).feature;
    for (let s = 0; s < f.spins.length; s++) expect(canonicalSpin(feat, s)).toEqual(f.spins[s]);
  });
  it('the pack accepted both specs as scatter pays with tumble and orb sum', () => {
    expect(oracle.base.context).toBe('scatter_pays|global_mixture');
    expect(oracle.base.families).toEqual(['orb_sum_terminal', 'tape_continuation_refill']);
  });
});

describe('the spec is the game', () => {
  it('has no wild, 9 paying symbols, an orb and a scatter', () => {
    const roles = base.symbols.map((s) => s.role).sort();
    expect(roles.filter((r) => r === 'wild').length).toBe(0);
    expect(roles.filter((r) => r === 'premium').length).toBe(4);
    expect(roles.filter((r) => r === 'low').length).toBe(5);
    expect(roles.filter((r) => r === 'scatter').length).toBe(1);
    expect(roles.filter((r) => r === 'mid').length).toBe(1);
  });
  it('the feature spins have a higher orb density and larger orbs', () => {
    const orbs = (s: SlotSpec) => (s.board_law.reel_sets![0].strips as number[][]).flat().filter((v) => v === 12).length;
    expect(orbs(feat)).toBeGreaterThan(orbs(base) * 3);
    const top = (s: SlotSpec) => Math.max(...Object.keys((s.mechanics![1].params as { value_pmf: object }).value_pmf).map(Number));
    expect(top(base)).toBe(100);
    expect(top(feat)).toBe(500);
  });
  it('pays rise with the count and with the symbol rank', () => {
    for (const t of Object.values(base.pays.paytable)) {
      const c = Object.keys(t).map(Number).sort((a, b) => a - b);
      for (let i = 1; i < c.length; i++) expect(t[String(c[i])]).toBeGreaterThanOrEqual(t[String(c[i - 1])]);
    }
    expect(base.pays.paytable['3']['8']).toBeGreaterThan(base.pays.paytable['4']['8']);
  });
});

function sampleDist(s: SlotSpec, n: number, seed: number) {
  const eng = new SlotEngine(s);
  const r = mulberry32(seed);
  const out: { coins: number; k: number }[] = [];
  for (let i = 0; i < n; i++) {
    const res = eng.spin(Math.floor(r() * 4294967296) >>> 0);
    out.push({ coins: res.totalCoins, k: triggerScatters(eng, res) });
  }
  return out;
}

describe('RTP', () => {
  it('the base spin RTP of the port is within 4 SE of the pack mc RTP', () => {
    const a = oracle.base.analytics as { rtp: number; rtp_se: number };
    const n = 20000;
    const xs = sampleDist(base, n, 11).map((x) => x.coins / bet);
    const m = xs.reduce((p, c) => p + c, 0) / n;
    const sd = Math.sqrt(xs.reduce((p, c) => p + (c - m) ** 2, 0) / (n - 1));
    const se = Math.hypot(sd / Math.sqrt(n), a.rtp_se);
    expect(Math.abs(m - a.rtp)).toBeLessThan(4 * se);
  }, 120000);
});

describe('the free spins algebra matches simulated rounds', () => {
  it('E[F] of a 15-spin feature, from the feature spin law, within 4 SE of played features', () => {
    const dist = empiricalDist(sampleDist(feat, 60000, 5), 'test');
    const v = featureValue({ ...dist, n: 60000 }, fcfg, 15);
    const slot = createSlot({ spec: base, featureSpecs: { 'feature.spec.json': feat }, feature: fcfg, maxWinStakes: 1e9 });
    const rng = seededSource(99);
    const rng32 = () => Math.floor(rng() * 2 ** 32) >>> 0;
    // a base seed that triggers with exactly 4 scatters (15 spins)
    const seeds: number[] = [];
    for (let s = 1; seeds.length < 1 && s < 3_000_000; s++) {
      const sp = slot.spin(s);
      if (sp.trigger?.fired && triggerScatters(slot.engine, sp) === 4) seeds.push(s);
    }
    expect(seeds.length).toBe(1);
    const N = 2500;
    const xs: number[] = [];
    let spinsSum = 0;
    for (let i = 0; i < N; i++) {
      const r = slot.playRound(seeds[0], rng32);
      const f = r.feature!;
      xs.push(f.spins.reduce((a, s) => a + s.result.totalCoins * s.multiplier, 0));
      spinsSum += f.spins.length;
    }
    const m = xs.reduce((a, b) => a + b, 0) / N;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (N - 1));
    const se = Math.hypot(sd / Math.sqrt(N), 0.35 * sd / Math.sqrt(N));
    expect(Math.abs(m - v.expectedWinCoins)).toBeLessThan(4 * se + 1);
    expect(Math.abs(spinsSum / N - v.expectedSpins)).toBeLessThan(0.5);
  }, 300000);
});

describe('the max-win cap', () => {
  it('a round never pays more than the cap, and a capped round pays exactly the cap', () => {
    const capStakes = 40;
    const slot = createSlot({ spec: base, featureSpecs: { 'feature.spec.json': feat }, feature: fcfg, maxWinStakes: capStakes });
    const rng = seededSource(3);
    let capped = 0;
    let max = 0;
    for (let s = 0; s < 40000; s++) {
      const r = slot.playRound(s, () => Math.floor(rng() * 2 ** 32) >>> 0);
      max = Math.max(max, r.totalCoins);
      if (r.capped) {
        capped++;
        expect(r.totalCoins).toBe(capStakes * bet);
      }
    }
    expect(max).toBeLessThanOrEqual(capStakes * bet);
    expect(capped).toBeGreaterThan(0);
  }, 300000);
  it('the declared cap is 15,000x', () => {
    expect(cfg.maxWinStakes).toBe(15000);
  });
});

describe('fairness of the spin flow', () => {
  it('SlotGame places the bet before it draws the seed, and guards double presses', () => {
    const src = readFileSync(join(here, '../../../packages/slots/src/ui/SlotGame.tsx'), 'utf8');
    const place = src.indexOf('await ticket.place(');
    const draw = src.indexOf('seeds.next()');
    expect(place).toBeGreaterThan(0);
    expect(draw).toBeGreaterThan(place);
    expect(/busy|spinning|locked/i.test(src)).toBe(true);
  });
  it('the seed source draws nothing until asked, and a forced seed is replayable', () => {
    const slot = createSlot({ spec: base, featureSpecs: { 'feature.spec.json': feat }, feature: fcfg, maxWinStakes: 15000 });
    let draws = 0;
    const rng = { int: (n: number) => (draws++, 12345 % n), float: () => 0.5 } as never;
    const src = createSeedSource(slot, rng, bet);
    expect(draws).toBe(0);
    src.forceSeed(77);
    const a = src.next();
    expect(a.seed).toBe(77);
    const again = createSeedSource(slot, rng, bet);
    again.forceSeed(77);
    const b = again.next();
    expect(slot.playRound(a.seed, a.rng32).totalCoins).toBe(slot.playRound(b.seed, b.rng32).totalCoins);
  });
});
