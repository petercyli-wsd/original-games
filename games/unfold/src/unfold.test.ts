import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createSlot, type SlotSpec } from '@originals/slots';
import { checkParity, type OracleFixture } from '../../../packages/slots/src/engine/parity';
import type { FreeSpinsConfig } from '../../../packages/slots/src/engine/analytics/config';
import { scatterCountDist } from '../../../packages/slots/src/engine/analytics/exact';
import { freeSpinsAnalytics } from '../../../packages/slots/src/engine/analytics/features';
import type { SpinDist } from '../../../packages/slots/src/engine/analytics/distribution';
import { checkCopy } from '@originals/slots/ui';
import { copy } from './copy';
import { components, mixtureRtp } from './mixture';
import spec from './slot.spec.json';
import featureSpec from './feature.spec.json';
import config from './slot.config.json';
import oracle from './oracle.json';

const here = dirname(fileURLToPath(import.meta.url));
const base = spec as unknown as SlotSpec;
const feat = featureSpec as unknown as SlotSpec;
const cfg = config.feature as unknown as FreeSpinsConfig;
const BET = base.bet.coins;

function rng32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

describe('oracle parity (the engine pack)', () => {
  it('base spec: 2,000 seeds identical to the pack', () => {
    const o = oracle.base as unknown as OracleFixture & { file: string };
    const r = checkParity({ ...o, spec: base });
    expect(r.firstMismatch).toBeNull();
    expect(r.ok).toBe(true);
  });
  it('feature spec: 2,000 seeds identical to the pack', () => {
    const o = (oracle.features as Record<string, unknown>).feature as unknown as OracleFixture;
    const r = checkParity({ ...o, spec: feat });
    expect(r.firstMismatch).toBeNull();
    expect(r.ok).toBe(true);
  });
});

describe('exact RTP (mystery_reveal as an exact mixture over reveal_pmf)', () => {
  it('equals the pack for the base spec and the feature spec to 1e-9', () => {
    expect(oracle.base.analytics.tier).toBe('exact_mixture');
    expect(Math.abs(mixtureRtp(base) - oracle.base.analytics.rtp)).toBeLessThan(1e-9);
    const fo = (oracle.features as Record<string, { analytics: { rtp: number } }>).feature;
    expect(Math.abs(mixtureRtp(feat) - fo.analytics.rtp)).toBeLessThan(1e-9);
  });
  it('the reveal weights sum to 1 and never reveal a scatter', () => {
    const cs = components(base);
    expect(cs.reduce((a, c) => a + c.w, 0)).toBeCloseTo(1, 12);
    for (const c of [...cs, ...components(feat)]) expect([1, 12]).not.toContain(c.sym);
  });
});

describe('feature algebra vs Monte Carlo of playRound (within 4 SE)', () => {
  it('base RTP, feature RTP and their sum', () => {
    // Expectations need only the mean spin win and the scatter law, both exact.
    const meanOf = (s: SlotSpec) => mixtureRtp(s) * BET;
    const ks = scatterCountDist(components(base)[0].spec);
    const fks = scatterCountDist(components(feat)[0].spec);
    const dist = (m: number, p: number[]): SpinDist => ({ coins: p.map(() => m), k: p.map((_, k) => k), p, tier: 'exact', method: 'mean' });
    const fa = freeSpinsAnalytics({ baseRtp: mixtureRtp(base), baseTier: 'exact_mixture', betCoins: BET, scatterDist: ks, scatterMin: 3, featureDist: dist(meanOf(feat), fks), cfg });
    const slot = createSlot({ spec: base, featureSpecs: { 'feature.spec.json': feat }, feature: config.feature as never, maxWinStakes: 1e9 });
    const rand = rng32(2026);
    const N = 150_000;
    let b1 = 0, b2 = 0, f1 = 0, f2 = 0, t1 = 0, t2 = 0;
    for (let i = 0; i < N; i++) {
      const r = slot.playRound(rand(), rand);
      const b = r.base.totalCoins / BET;
      const f = (r.feature?.totalCoins ?? 0) / BET;
      b1 += b; b2 += b * b; f1 += f; f2 += f * f; t1 += b + f; t2 += (b + f) ** 2;
    }
    const check = (name: string, sum: number, sum2: number, want: number) => {
      const mean = sum / N;
      const se = Math.sqrt((sum2 / N - mean * mean) / N);
      expect(Math.abs(mean - want), `${name}: ${mean} vs ${want} (se ${se})`).toBeLessThan(4 * se);
    };
    check('base', b1, b2, fa.baseRtp);
    check('feature', f1, f2, fa.featureRtp);
    check('total', t1, t2, fa.totalRtp);
    expect(fa.totalRtp).toBeGreaterThan(0.9595);
    expect(fa.totalRtp).toBeLessThan(0.9605);
  }, 120_000);
});

describe('max win cap', () => {
  it('no round pays more than the cap, and a small cap is reached', () => {
    const cap = config.maxWinStakes;
    const slot = createSlot({ spec: base, featureSpecs: { 'feature.spec.json': feat }, feature: config.feature as never, maxWinStakes: cap });
    const tiny = createSlot({ spec: base, featureSpecs: { 'feature.spec.json': feat }, feature: config.feature as never, maxWinStakes: 3 });
    const rand = rng32(7);
    let capped = 0;
    for (let i = 0; i < 20_000; i++) {
      const s = rand();
      expect(slot.playRound(s, rng32(s)).totalCoins).toBeLessThanOrEqual(cap * BET);
      const t = tiny.playRound(s, rng32(s));
      expect(t.totalCoins).toBeLessThanOrEqual(3 * BET);
      if (t.capped) {
        capped++;
        expect(t.totalCoins).toBe(3 * BET);
      }
    }
    expect(capped).toBeGreaterThan(0);
  });
});

describe('spin flow', () => {
  it('SlotGame draws only after ticket.place() succeeds, and guards double presses', () => {
    const src = readFileSync(join(here, '../../../packages/slots/src/ui/SlotGame.tsx'), 'utf8');
    const play = src.slice(src.indexOf('async function play('));
    const place = play.indexOf('ticket.place(');
    const draw = play.indexOf('engine.playRound(');
    expect(place).toBeGreaterThan(0);
    expect(draw).toBeGreaterThan(place);
    expect(play.slice(0, place)).toMatch(/busyRef\.current/);
  });
  it('a round with no trigger draws nothing from the host RNG', () => {
    const slot = createSlot({ spec: base, featureSpecs: { 'feature.spec.json': feat }, feature: config.feature as never, maxWinStakes: config.maxWinStakes });
    let draws = 0;
    let plain = 0;
    for (let seed = 0; seed < 200 && plain < 20; seed++) {
      const before = draws;
      const r = slot.playRound(seed, () => (draws++, seed));
      if (!r.feature) { plain++; expect(draws).toBe(before); }
    }
    expect(plain).toBeGreaterThan(0);
  });
});

describe('backdrops', () => {
  it('base and feature scenes are drawn and differ', async () => {
    const { unfoldTheme } = await import('./art');
    const base = JSON.stringify(unfoldTheme.backdrop?.(600, 480));
    const feat = JSON.stringify(unfoldTheme.featureBackdrop?.(600, 480));
    expect(base.length).toBeGreaterThan(100);
    expect(feat).not.toEqual(base);
  });
});

describe('Free folds rule: bigger squares open into animals only', () => {
  const ANIMALS = [3, 4, 5, 6]; // Crane, Fox, Koi, Frog
  const squares = (s: SlotSpec) => s.board_law.reel_sets![0].strips.map((st) => st.filter((v) => v === 12).length);
  it('the feature reveals only animals; the base game reveals any paying symbol', () => {
    expect(components(feat).map((c) => c.sym).sort()).toEqual(ANIMALS);
    expect(components(base).some((c) => !ANIMALS.includes(c.sym))).toBe(true);
  });
  it('the feature strips carry more and stacked squares than the base strips', () => {
    const b = squares(base), f = squares(feat);
    expect(f.reduce((a, x) => a + x, 0)).toBeGreaterThanOrEqual(4 * b.reduce((a, x) => a + x, 0));
    for (const st of feat.board_law.reel_sets![0].strips) expect(st.join(',')).toContain('12,12,12,12');
  });
  it('every free spin with a reveal opens into an animal (playRound)', () => {
    const slot = createSlot({ spec: base, featureSpecs: { 'feature.spec.json': feat }, feature: config.feature as never, maxWinStakes: config.maxWinStakes });
    const rand = rng32(11);
    let reveals = 0;
    for (let i = 0; i < 20_000 && reveals < 200; i++) {
      const r = slot.playRound(rand(), rand);
      for (const s of r.feature?.spins ?? []) {
        const v = (s.result as { decor?: Record<string, unknown> }).decor?.['mystery_reveal.mysteryReveal'];
        if (typeof v === 'number') { reveals++; expect(ANIMALS).toContain(v); }
      }
    }
    expect(reveals).toBeGreaterThan(50);
  });
});

describe('copy', () => {
  it('has no line of 9 or more words', () => {
    expect(checkCopy(copy)).toEqual([]);
    for (const t of Object.values(copy.symbolText ?? {})) expect(t.split(/\s+/).length).toBeLessThan(9);
  });
});
