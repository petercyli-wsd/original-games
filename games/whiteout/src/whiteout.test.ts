// Whiteout: oracle parity, RTP against the pack, feature algebra against playRound, the max-win cap,
// the spin flow, and the copy rules. Whiteout is a Monte Carlo (mc) game: tumbles and a height law have no
// closed form, so "exact RTP" here means the TypeScript port replays the pack's own draw and matches it.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import { award, validateSlotConfig, type SlotConfig } from '../../../packages/slots/src/engine/analytics/config';
import { featureValue, freeSpinsAnalytics } from '../../../packages/slots/src/engine/analytics/features';
import { mcRtp, mcSpinDistribution } from '../../../packages/slots/src/engine/analytics/mc';
import { checkParity, type OracleFixture } from '../../../packages/slots/src/engine/parity';
import { SlotEngine, canonicalSpin, createSlot, Mulberry32, triggerScatters, type SlotSpec } from '../../../packages/slots/src/engine/index';
import { featureRules, introLines, wordCount } from '../../../packages/slots/src/ui/util';
import { createSeedSource } from '../../../packages/slots/src/ui/engine-bridge';
import { copy } from './Game';
import manifest from './manifest';
import facts from './slot-facts.json';

const here = dirname(fileURLToPath(import.meta.url));
const read = (f: string) => readFileSync(join(here, f), 'utf8');
const spec = JSON.parse(read('slot.spec.json')) as SlotSpec;
const fspec = JSON.parse(read('feature.spec.json')) as SlotSpec;
const config = JSON.parse(read('slot.config.json')) as SlotConfig;
const oracle = JSON.parse(read('oracle.json')) as {
  base: { specHash: string; spinHashes: string[]; spins: unknown[]; seeds: number; fullSeeds: number; context: string; families: string[]; decorSchema: Record<string, string>; analytics: { rtp: number; rtp_se: number; n_mc: number; instrument: { seed: number } } };
  features: Record<string, { specHash: string; spinHashes: string[]; spins: unknown[]; seeds: number; fullSeeds: number; context: string; families: string[]; decorSchema: Record<string, string>; analytics: { rtp: number; rtp_se: number; n_mc: number; instrument: { seed: number } } }>;
};

const fixtureOf = (s: SlotSpec, e: typeof oracle.base): OracleFixture =>
  ({ schema: 'slot_oracle_v1', spec: s, packVersion: '', specHash: e.specHash, context: e.context, families: e.families, decorSchema: e.decorSchema, seeds: e.seeds, spinHashes: e.spinHashes, fullSeeds: e.fullSeeds, spins: e.spins }) as unknown as OracleFixture;

function scatters(s: SlotSpec) {
  const eng = new SlotEngine(s);
  return (r: ReturnType<typeof canonicalSpin>) => triggerScatters(eng, r);
}

describe('whiteout oracle parity', () => {
  it('the pack accepted the spec on ways|heights with the tumble and the ladder', () => {
    expect(oracle.base.context).toBe('ways|heights');
    expect(oracle.base.families).toEqual(['cascade_step_ladder', 'tape_continuation_refill']);
  });
  it('base spec: 2,000 seeds equal the pack spin for spin', () => {
    const r = checkParity(fixtureOf(spec, oracle.base));
    expect(r.firstMismatch).toBeNull();
    expect(r.ok).toBe(true);
    expect(r.fullChecked).toBe(2000);
  });
  it('feature spec: 2,000 seeds equal the pack spin for spin', () => {
    const r = checkParity(fixtureOf(fspec, oracle.features.feature));
    expect(r.firstMismatch).toBeNull();
    expect(r.ok).toBe(true);
  });
  it('the config is valid and all six reels draw 2 to 7 rows', () => {
    expect(validateSlotConfig(config)).toEqual([]);
    for (const reel of (spec as unknown as { height_law: { reels: { pmf: Record<string, number> }[] } }).height_law.reels) expect(Object.keys(reel.pmf).sort()).toEqual(['2', '3', '4', '5', '6', '7']);
    const rows = new Set<number>();
    for (let s = 0; s < 400; s++) for (const col of canonicalSpin(spec, s).steps[0].board) rows.add(col.length);
    expect([...rows].sort()).toEqual([2, 3, 4, 5, 6, 7]);
  });
});

describe('whiteout RTP', () => {
  it('replaying the pack Monte Carlo draw gives the pack RTP to 1e-12', () => {
    const a = oracle.base.analytics;
    const r = mcRtp(spec, canonicalSpin, a.n_mc, a.instrument.seed, { consecutiveSeeds: true, scatters: scatters(spec) });
    expect(Math.abs(r.rtp - a.rtp)).toBeLessThan(1e-12);
    const f = oracle.features.feature.analytics;
    const rf = mcRtp(fspec, canonicalSpin, f.n_mc, f.instrument.seed, { consecutiveSeeds: true, scatters: scatters(fspec) });
    expect(Math.abs(rf.rtp - f.rtp)).toBeLessThan(1e-12);
  }, 300_000);

  it('the headline facts are the measured ones, consistent with the 96% target within 4 SE', () => {
    expect(facts.rtpTier).toBe('mc');
    expect(Math.abs(facts.rtp - config.targetRtp)).toBeLessThan(4 * facts.rtpSe);
    expect(manifest.rtp).toBeCloseTo(facts.rtp, 3);
    expect(manifest.maxMultiplier).toBe(config.maxWinStakes);
  });
});

describe('whiteout feature algebra vs playRound', () => {
  it('E[feature win | trigger] from the algebra is within 4 SE of the rounds playRound plays', () => {
    const bet = spec.bet.coins;
    const slot = createSlot({ spec, featureSpecs: { 'feature.spec.json': fspec }, feature: config.feature, maxWinStakes: 1e9 });
    const cfg = config.feature!;
    // feature spin distribution by engine sampling
    const nDist = 300_000;
    const fd = mcSpinDistribution(fspec, canonicalSpin, nDist, 777, { scatters: scatters(fspec) });
    let ew = 0;
    let ew2 = 0;
    fd.p.forEach((p, i) => {
      ew += p * fd.coins[i];
      ew2 += p * fd.coins[i] ** 2;
    });
    const seW = Math.sqrt(Math.max(0, ew2 - ew * ew) / nDist);
    // triggered base spins, by seed search (unbiased: every seed is an independent spin)
    const eng = new SlotEngine(spec);
    const min = Number(spec.trigger!.scatter_min);
    const diffs: number[] = [];
    let algSum = 0;
    let n = 0;
    for (let seed = 1; n < 2500 && seed < 3_000_000; seed++) {
      const base = canonicalSpin(spec, seed);
      const k = triggerScatters(eng, base);
      if (k < min) continue;
      const round = slot.playRound(seed, (() => { const r = new Mulberry32(seed ^ 0x5bd1e995); return () => r.u32(); })());
      expect(round.feature).not.toBeNull();
      const played = round.feature!.spins.reduce((a, s) => a + s.coins, 0);
      const alg = featureValue(fd, cfg, Math.min(award(cfg.awards, k), cfg.maxSpins)).expectedWinCoins;
      diffs.push(played);
      algSum += alg;
      n++;
    }
    expect(n).toBe(2500);
    const mean = diffs.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(diffs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
    const seMc = sd / Math.sqrt(n);
    const alg = algSum / n;
    const seAlg = Math.abs(alg) * (seW / (ew || 1));
    const tol = 4 * Math.sqrt(seMc ** 2 + seAlg ** 2);
    expect(Math.abs(mean - alg), `played ${(mean / bet).toFixed(1)}x vs algebra ${(alg / bet).toFixed(1)}x, tol ${(tol / bet).toFixed(1)}x`).toBeLessThan(tol);
    // and the algebra's trigger law is the engine's: 1 in N from the scatter distribution it prices
    const fa = freeSpinsAnalytics({ baseRtp: 0.48, baseTier: 'mc', baseRtpSe: 0.01, betCoins: bet, scatterDist: [0, 0, 0, 0, 0.0037], scatterMin: min, featureDist: fd, cfg });
    expect(fa.expectedSpinsGivenTrigger).toBeGreaterThan(12);
    expect(fa.expectedSpinsGivenTrigger).toBeLessThan(14);
  }, 600_000);

  it('spin j pays x j, awards are 12 / 15 / 18, one retrigger of +4, 36 spins at most', () => {
    const cfg = config.feature!;
    expect(cfg.awards).toEqual({ '4': 12, '5': 15, '6': 18 });
    expect(cfg.retrigger).toEqual({ '4': 4 });
    expect(cfg.maxSpins).toBe(36);
    expect(cfg.multiplier).toEqual({ kind: 'per_spin', start: 1, step: 1 });
    const slot = createSlot({ spec, featureSpecs: { 'feature.spec.json': fspec }, feature: cfg, maxWinStakes: 1e9 });
    const eng = new SlotEngine(spec);
    let seen = 0;
    for (let seed = 1; seen < 3 && seed < 2_000_000; seed++) {
      if (triggerScatters(eng, canonicalSpin(spec, seed)) < 4) continue;
      const r = slot.playRound(seed, (() => { const g = new Mulberry32(seed); return () => g.u32(); })());
      r.feature!.spins.forEach((s, i) => expect(s.multiplier).toBe(i + 1));
      seen++;
    }
    expect(seen).toBe(3);
  }, 300_000);
});

describe('whiteout max win', () => {
  it('a round never pays more than the cap, and a round that reaches it pays exactly the cap', () => {
    const cap = 40; // a low cap, so ordinary rounds reach it
    const slot = createSlot({ spec, featureSpecs: { 'feature.spec.json': fspec }, feature: config.feature, maxWinStakes: cap });
    const bet = spec.bet.coins;
    const eng = new SlotEngine(spec);
    let capped = 0;
    let checked = 0;
    for (let seed = 1; checked < 600 && seed < 4_000_000; seed++) {
      const triggers = triggerScatters(eng, canonicalSpin(spec, seed)) >= 4;
      if (!triggers && seed % 40 !== 0) continue;
      const r = slot.playRound(seed, (() => { const g = new Mulberry32(seed); return () => g.u32(); })());
      expect(r.totalCoins).toBeLessThanOrEqual(cap * bet);
      if (r.capped) {
        expect(r.totalCoins).toBe(cap * bet);
        capped++;
      }
      checked++;
    }
    expect(capped).toBeGreaterThan(0);
    expect(config.maxWinStakes).toBe(20000);
  }, 300_000);
});

describe('whiteout spin flow', () => {
  it('nothing is drawn before place(): the seed source does not touch the RNG until next()', () => {
    let calls = 0;
    const counting = createRng(() => {
      calls++;
      return 0.5;
    });
    const slot = createSlot({ spec, featureSpecs: { 'feature.spec.json': fspec }, feature: config.feature, maxWinStakes: config.maxWinStakes });
    const seeds = createSeedSource(slot, counting, spec.bet.coins);
    expect(calls).toBe(0);
    seeds.next();
    expect(calls).toBeGreaterThan(0);
  });
  it('the kit places the bet, then draws; it guards the spin with a ref', () => {
    const src = readFileSync(join(here, '../../../packages/slots/src/ui/SlotGame.tsx'), 'utf8');
    const place = src.indexOf('await ticket.place(stake)');
    const draw = src.indexOf('seeds.next()');
    expect(place).toBeGreaterThan(0);
    expect(draw).toBeGreaterThan(place);
    expect(src.indexOf('busyRef.current = true')).toBeLessThan(place);
  });
});

describe('whiteout copy', () => {
  const lines = [
    copy.featureName,
    copy.introNote,
    copy.rule,
    copy.wildText,
    copy.scatterText,
    ...featureRules(config.feature!, copy.featureName),
    ...introLines(4, copy.introNote ?? ''),
  ].filter(Boolean) as string[];
  it('every line is under 9 words', () => {
    for (const l of lines) expect(wordCount(l), l).toBeLessThan(9);
  });
  it('never uses a trademarked mechanic name', () => {
    const all = [read('Game.tsx'), read('art.tsx'), read('manifest.ts'), JSON.stringify(copy)].join('\n');
    expect(all).not.toMatch(/mega ?ways|hold ?(&|and|n) ?win|cash ?collect|avalanche spins/i);
  });
  it('the summit marker is a flag, not a cross', () => {
    expect(read('art.tsx')).toContain('Summit flag');
  });
});
