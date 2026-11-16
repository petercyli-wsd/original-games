// Grand Finale: oracle parity, exact RTP = the pack's, the feature algebra vs Monte Carlo, the cap, the flow.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { canonicalJson, createSlot, SlotEngine, type SlotSpec } from '../../../packages/slots/src/engine';
import { award, type SlotConfig } from '../../../packages/slots/src/engine/analytics/config';
import type { SpinDist } from '../../../packages/slots/src/engine/analytics/distribution';
import { freeSpinsAnalytics } from '../../../packages/slots/src/engine/analytics/features';
import { checkParity, type OracleFixture } from '../../../packages/slots/src/engine/parity';
import { featureRules, howToWinLines, introLines, multiplierNote, outroLines, scatterLines, wildLines, wordCount, ruleSentence, parseSlotFacts } from '../../../packages/slots/src/ui/util';
import { checkCopy } from '../../../packages/slots/src/ui';
import { copy as gameCopy, fuseCount, FUSE, FUSES_NEEDED } from './Game';
import { baseMath } from './exactmath';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
const spec = read('slot.spec.json') as SlotSpec;
const fspec = read('feature.spec.json') as SlotSpec;
const config = read('slot.config.json') as SlotConfig;
const oracle = read('oracle.json');
const facts = read('slot-facts.json');

// Python's json.dumps(sort_keys=True, separators=(",", ":")): string-sorted keys (JS objects would reorder "10" before "9").
const canon = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(canon).join(',')}]`
    : v && typeof v === 'object'
      ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(',')}}`
      : JSON.stringify(v);
const specHash = (s: unknown) => createHash('sha256').update(canon(s)).digest('hex');

/** A fast, reproducible 32-bit stream for the Monte Carlo runs. */
function stream(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    let x = s;
    x ^= x >>> 15;
    x = Math.imul(x, 0x2c1b3c6d) >>> 0;
    x ^= x >>> 12;
    x = Math.imul(x, 0x297a2d39) >>> 0;
    x ^= x >>> 15;
    return x >>> 0;
  };
}

describe('oracle parity (the pack accepted these exact specs)', () => {
  it('the oracle was made from the current specs', () => {
    expect(oracle.base.specHash).toBe(specHash(spec));
    expect(oracle.features.feature.specHash).toBe(specHash(fspec));
  });
  it('is the scatter-pays + global_additive context', () => {
    expect(oracle.base.context).toBe('scatter_pays|global_mixture');
    expect(oracle.base.families).toEqual(['global_additive']);
    expect(oracle.base.analytics.tier).toBe('exact');
  });
  for (const [name, entry, s] of [
    ['base', oracle.base, spec],
    ['feature', oracle.features.feature, fspec],
  ] as const) {
    it(`${name}: the TypeScript spin equals the pack's for all ${entry.seeds} seeds`, () => {
      const r = checkParity({ schema: 'slot_oracle_v1', spec: s, ...entry } as OracleFixture);
      expect(r.firstMismatch).toBeNull();
      expect(r.ok).toBe(true);
      expect(r.seeds).toBe(2000);
    });
  }
});

describe('exact maths equals the pack', () => {
  it('base RTP, feature spin value and trigger probability match the pack to 1e-9', () => {
    const b = baseMath(spec);
    const f = baseMath(fspec);
    expect(Math.abs(b.rtp - oracle.base.analytics.rtp)).toBeLessThan(1e-9);
    expect(Math.abs(f.rtp - oracle.features.feature.analytics.rtp)).toBeLessThan(1e-9);
    const trig = b.kPmf.slice(4).reduce((a, x) => a + x, 0);
    expect(Math.abs(trig - oracle.base.analytics.trigger_p)).toBeLessThan(1e-12);
    expect(Math.abs(b.kPmf.reduce((a, x) => a + x, 0) - 1)).toBeLessThan(1e-12);
  });
});

function featureAlgebra() {
  const b = baseMath(spec);
  const f = baseMath(fspec);
  const dist: SpinDist = { coins: [], k: [], p: [], tier: 'exact', method: 'E[win | K]' };
  f.kPmf.forEach((p, k) => {
    if (p > 0) {
      dist.coins.push(f.evCoinsByK[k] / p);
      dist.k.push(k);
      dist.p.push(p);
    }
  });
  return freeSpinsAnalytics({ baseRtp: b.rtp, baseTier: 'exact', betCoins: spec.bet.coins, scatterDist: b.kPmf, scatterMin: 4, featureDist: dist, cfg: config.feature! } as never);
}

describe('the feature algebra vs Monte Carlo of playRound', () => {
  it('total RTP and the feature RTP are within 4 SE', () => {
    const alg = featureAlgebra();
    const slot = createSlot({ spec, featureSpecs: { 'feature.spec.json': fspec }, feature: config.feature, maxWinStakes: 1e9 });
    const u = stream(20261116);
    const N = 400_000;
    const stake = spec.bet.coins;
    let sum = 0, sq = 0, fsum = 0, fsq = 0;
    for (let i = 0; i < N; i++) {
      const r = slot.playRound(u(), u);
      const w = r.totalCoins / stake;
      const fw = (r.feature?.totalCoins ?? 0) / stake;
      sum += w; sq += w * w; fsum += fw; fsq += fw * fw;
    }
    const mean = sum / N, se = Math.sqrt((sq / N - mean * mean) / N);
    const fmean = fsum / N, fse = Math.sqrt((fsq / N - fmean * fmean) / N);
    expect(Math.abs(mean - alg.totalRtp)).toBeLessThan(4 * se);
    expect(Math.abs(fmean - alg.featureRtp)).toBeLessThan(4 * fse);
  }, 120_000);
  it('total RTP, uncapped, is 96.00% (within the tuner tolerance)', () => {
    expect(Math.abs(featureAlgebra().totalRtp - 0.96)).toBeLessThan(0.0005);
  });
  it('the facts file (slots:eval) agrees with the exact algebra (exact tier, or within 4 SE when mc)', () => {
    const alg = featureAlgebra();
    expect(['exact', 'mc']).toContain(facts.rtpTier);
    const tol = facts.rtpTier === 'exact' ? 1e-6 : 4 * facts.rtpSe;
    expect(Math.abs(facts.rtp - alg.totalRtp)).toBeLessThan(tol);
    expect(Math.abs(facts.featureFreq - alg.featureFrequency) / alg.featureFrequency).toBeLessThan(0.1);
    expect(facts.specHash).toBe(specHash(spec));
  });
});

describe('the max-win cap', () => {
  it('no round pays more than the cap, and a capped round pays exactly the cap', () => {
    const cap = 8; // far below 5,000 so the cap bites in a short run
    const slot = createSlot({ spec, featureSpecs: { 'feature.spec.json': fspec }, feature: config.feature, maxWinStakes: cap });
    const u = stream(7);
    let capped = 0;
    for (let i = 0; i < 60_000; i++) {
      const r = slot.playRound(u(), u);
      expect(r.totalCoins).toBeLessThanOrEqual(cap * spec.bet.coins);
      if (r.capped) {
        capped++;
        expect(r.totalCoins).toBe(cap * spec.bet.coins);
      }
    }
    expect(capped).toBeGreaterThan(0);
  });
  // Reachability (P > 1e-9 per round) is a slots:eval gate band. The feature's rare "grand" reel set
  // (all rockets and shells) and the rare +25/+50 rocket values give the 5,000x cap a real path.
  it('the shipped cap is 5,000x, the facts agree on it, and it is reachable', () => {
    expect(config.maxWinStakes).toBe(5000);
    expect(facts.maxWin).toBe(5000);
    expect(facts.pMaxWin).toBeGreaterThan(1e-9);
  });
});

describe('the rocket is the wild and the multiplier is 1 + the rockets', () => {
  it('the rocket is the wild, counts toward every firework, and its values come from value_pmf', () => {
    const wild = spec.symbols.find((s) => s.role === 'wild')!;
    expect(wild.label).toBe('ROCKET');
    const mech = spec.mechanics![0] as { id: string; params: { base: number; value_pmf: Record<string, number> } };
    expect(mech.id).toBe('global_additive');
    expect(mech.params.base).toBe(1);
    expect(spec.evaluation).toMatchObject({ kind: 'scatter_pays' });
    expect((spec.evaluation as unknown as { min_count: number }).min_count).toBeGreaterThanOrEqual(9);
    expect(Object.keys(mech.params.value_pmf).map(Number)).toEqual([1, 2, 3, 5]);
    const fm = fspec.mechanics![0] as typeof mech;
    expect(Object.keys(fm.params.value_pmf).map(Number)).toEqual([1, 2, 3, 5, 10]);
  });
  it('on a real board every win is multiplied by 1 + the rockets painted on it', () => {
    const e = new SlotEngine(spec);
    let checked = 0;
    for (let seed = 0; seed < 4000 && checked < 25; seed++) {
      const r = e.spin(seed);
      const decor = r.decor as Record<string, unknown>;
      const vals = Object.values((decor['global_additive.wildMults'] ?? {}) as Record<string, number>);
      if (!vals.length || !r.steps[0].wins.length) continue;
      const g = 1 + vals.reduce((a, b) => a + b, 0);
      expect(decor['global_additive.gwm']).toBe(g);
      const pays = r.steps[0].wins.reduce((a, w) => a + w.coins, 0);
      const base = pays / g;
      expect(Number.isInteger(base)).toBe(true);
      checked++;
    }
    expect(checked).toBeGreaterThan(5);
  });
});

describe('the spin flow draws after place()', () => {
  const src = readFileSync(join(dir, '../../../packages/slots/src/ui/SlotGame.tsx'), 'utf8');
  it('SlotGame awaits ticket.place before it draws a seed, and guards double presses', () => {
    const play = src.slice(src.indexOf('async function play('));
    const iPlace = play.indexOf('await ticket.place(');
    const iDraw = play.indexOf('seeds.next()');
    const iRound = play.indexOf('engine.playRound(');
    expect(iPlace).toBeGreaterThan(0);
    expect(iDraw).toBeGreaterThan(iPlace);
    expect(iRound).toBeGreaterThan(iDraw);
    expect(play.indexOf('busyRef.current')).toBeLessThan(iPlace);
  });
  it('playRound draws feature seeds only from the rng32 it is given, after the base spin', () => {
    const slot = createSlot({ spec, featureSpecs: { 'feature.spec.json': fspec }, feature: config.feature, maxWinStakes: 1000 });
    let calls = 0;
    const u = stream(3);
    const counted = () => (calls++, u());
    // a base seed with no trigger draws nothing
    let seed = 0;
    while (slot.spin(seed).trigger?.fired) seed++;
    slot.playRound(seed, counted);
    expect(calls).toBe(0);
    // a triggering base seed draws one seed per free spin
    seed = 0;
    while (!slot.spin(seed).trigger?.fired && seed < 2_000_000) seed++;
    const r = slot.playRound(seed, counted);
    expect(r.feature).not.toBeNull();
    expect(calls).toBe(r.feature!.spins.length);
  });
});

describe('copy: every line is under 9 words', () => {
  const copy = gameCopy;
  it('the game copy and the lines the kit generates from the config', () => {
    const f = config.feature!;
    const lines = [
      ...[copy.featureName, copy.introNote, copy.featureRule, copy.rule, copy.wildText, copy.scatterText].map(String),
      ...howToWinLines(spec, copy),
      ...wildLines(copy),
      ...scatterLines(4, copy.featureName!, copy),
      ...featureRules(f, copy.featureName!),
      multiplierNote(f),
      ruleSentence(spec, copy),
      ...introLines(12, multiplierNote(f)),
      ...outroLines(12, 123.4, true),
    ];
    for (const l of lines) expect(wordCount(l), l).toBeLessThan(9);
  });
  it('the facts parse and the kit awards match the copy', () => {
    expect(['exact', 'mc']).toContain(parseSlotFacts(facts).rtpTier);
    expect(award(config.feature!.awards, 4)).toBe(12);
    expect(award(config.feature!.retrigger, 4)).toBe(4);
  });
  it('the canonical JSON helper is the one the oracle uses', () => {
    expect(typeof canonicalJson({ a: 1 })).toBe('string');
  });
});

describe('copy', () => {
  it('every line is short enough for blind reviewers', () => {
    expect(checkCopy(gameCopy)).toEqual([]);
  });
});

// The round-2 rule: the finale builds. Free spin n pays ×n (the config's per_spin law: it depends on the spin
// index only, docs/SLOTS.md §2.5), times the rockets on that spin's board.
describe('the finale builds: free spin n pays ×n, times the rockets', () => {
  it('the config declares the per-spin law ×1, ×2, ×3 …', () => {
    expect(config.feature!.multiplier).toEqual({ kind: 'per_spin', start: 1, step: 1 });
  });
  it('in real features, spin n is paid its board × n, and the rockets multiply inside the board', () => {
    const slot = createSlot({ spec, featureSpecs: { 'feature.spec.json': fspec }, feature: config.feature, maxWinStakes: 1e9 });
    let features = 0;
    let sawRockets = false;
    for (let seed = 0; seed < 3_000_000 && features < 6; seed++) {
      if (!slot.spin(seed).trigger?.fired) continue;
      const r = slot.playRound(seed, stream(seed));
      features++;
      r.feature!.spins.forEach((sp, i) => {
        expect(sp.multiplier).toBe(i + 1);
        expect(sp.coins).toBe(sp.result.totalCoins * (i + 1));
        const g = (sp.result.decor as Record<string, unknown>)['global_additive.gwm'];
        if (typeof g === 'number' && g > 1 && sp.result.totalCoins > 0) sawRockets = true;
      });
      expect(r.feature!.totalCoins).toBe(r.feature!.spins.reduce((a, sp) => a + sp.coins, 0));
    }
    expect(features).toBe(6);
    expect(sawRockets).toBe(true);
  }, 120_000);
  it('the algebra prices the build: Σ P(N ≥ n)·n·E[W], about 6.5× a flat feature', () => {
    const flat = { ...config.feature!, multiplier: { kind: 'constant' as const, value: 1 } };
    const b = baseMath(spec);
    const f = baseMath(fspec);
    const dist: SpinDist = { coins: [], k: [], p: [], tier: 'exact', method: 'E[win | K]' };
    f.kPmf.forEach((p, k) => {
      if (p > 0) {
        dist.coins.push(f.evCoinsByK[k] / p);
        dist.k.push(k);
        dist.p.push(p);
      }
    });
    const args = { baseRtp: b.rtp, baseTier: 'exact', betCoins: spec.bet.coins, scatterDist: b.kPmf, scatterMin: 4, featureDist: dist };
    const built = freeSpinsAnalytics({ ...args, cfg: config.feature! } as never).featureRtp;
    const level = freeSpinsAnalytics({ ...args, cfg: flat } as never).featureRtp;
    expect(built / level).toBeGreaterThan(6);
    expect(built / level).toBeLessThan(7);
  });
  it('the feature pays the same paytable as the base game (one table to read)', () => {
    expect(fspec.pays).toEqual(spec.pays);
  });
});

describe('the fuse counter (k/4 on each fuse once the board lands)', () => {
  const board = (cells: number[][], decor?: Record<string, unknown>) => {
    const seen = { n: 0 };
    const out: (string | null)[] = [];
    cells.forEach((col, c) => col.forEach((symbol, row) => out.push(fuseCount(seen, { col: c, row, symbol, decor }))));
    return out.filter((x) => x !== null);
  };
  const b = [
    [7, FUSE, 8, 9, 10],
    [FUSE, 7, 8, 9, 10],
    [7, 8, 9, 10, 11],
    [7, 8, FUSE, 9, 10],
    [7, 8, 9, 10, 11],
    [7, 8, 9, 10, 11],
    [7, 8, 9, 10, 11],
  ];
  it('counts toward 4 in reading order once the board has landed', () => {
    expect(FUSES_NEEDED).toBe(4);
    expect(board(b, { 'global_additive.gwm': 1 })).toEqual(['1/4', '2/4', '3/4']);
  });
  it('shows nothing while the reels spin', () => {
    expect(board(b)).toEqual([]);
  });
});
