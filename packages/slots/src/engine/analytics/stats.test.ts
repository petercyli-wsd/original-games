import { describe, expect, it } from 'vitest';
import type { SlotSpec } from '../types';
import { award, multiplierAt, type FreeSpinsConfig, type SlotConfig } from './config';
import { distMean, distProb, distSecondMoment, exactSpinDistribution, type SpinDist } from './distribution';
import { exactRtp, triggerProbability } from './exact';
import { buildSlotFacts, canonicalJson, pyFloatRepr, type OracleCheck } from './facts';
import { boardAt, boardCoins, buildModel, type SlotModel } from './model';
import { mulberry32 } from './rng';
import { computeSlotStats, dryStreakQuantile, featureTailBounds, flatFeatureAnchor, flatTables, longestRunCdf, type SlotStats } from './stats';
import { normaliseFacts } from '../../../../../scripts/slots/review-lib/facts';
import pack from './fixtures/pack-analytics.json';
import sampleSpec from './fixtures/sample-game/slot.spec.json';
import sampleFeature from './fixtures/sample-game/feature.spec.json';
import sampleConfig from './fixtures/sample-game/slot.config.json';

const cases = (pack as unknown as { exact: { panel: string; rtp: number; spec: unknown }[] }).exact;
const BASE = sampleSpec as unknown as SlotSpec;
const FEAT = sampleFeature as unknown as SlotSpec;
const CFG = sampleConfig as unknown as SlotConfig;

const row = (s: SlotStats, key: string) => s.rows.find((r) => r.key === key)!;
const z = (a: number, b: number, se: number) => Math.abs(a - b) / se;

// --------------------------------------------------------------------------- a direct round simulator

/** Rounds played from uniform reel stops and the config law (config.ts), independent of the SpinDists and features.ts. */
function directRounds(spec: SlotSpec, fspec: SlotSpec | null, cfg: FreeSpinsConfig | null, capCoins: number, n: number, seed: number) {
  const rng = mulberry32(seed);
  const spinOf = (m: SlotModel) => {
    const u = rng();
    let ci = 0;
    let acc = 0;
    for (; ci < m.components.length - 1; ci++) if (u < (acc += m.components[ci].weight)) break;
    const comp = m.components[ci];
    return boardCoins(m, boardAt(m, comp, comp.strips.map((st) => Math.floor(rng() * st.length))));
  };
  const mb = buildModel(spec);
  const mf = fspec ? buildModel(fspec) : null;
  const smin = Number(spec.trigger?.scatter_min ?? Infinity);
  const bet = spec.bet.coins;
  const s = { hit: 0, x: 0, x2: 0, xu: 0, xu2: 0, xu4: 0, over: 0, big: 0, cap: 0 };
  for (let i = 0; i < n; i++) {
    const { coins: B, k: K } = spinOf(mb);
    let F = 0;
    if (cfg && mf && K >= smin && B < capCoins) {
      let awarded = Math.min(award(cfg.awards, K), cfg.maxSpins);
      let j = 0;
      let R = 0;
      while (j < awarded) {
        j++;
        const { coins: W, k: Kf } = spinOf(mf);
        F += multiplierAt(cfg.multiplier, j, R) * W;
        const a = award(cfg.retrigger, Kf);
        if (a > 0) {
          R++;
          awarded += Math.min(a, cfg.maxSpins - awarded);
        }
      }
    }
    const xu = (B + F) / bet;
    const x = Math.min(B + F, capCoins) / bet;
    if (x > 0) s.hit++;
    s.x += x;
    s.x2 += x * x;
    s.xu += xu;
    s.xu2 += xu * xu;
    s.xu4 += xu ** 4;
    if (x > 1) s.over++;
    if (x >= 100) s.big++;
    if (B + F >= capCoins) s.cap++;
  }
  const p = (c: number) => ({ mean: c / n, se: Math.sqrt(((c / n) * (1 - c / n)) / n) });
  return {
    n,
    hit: p(s.hit),
    over: p(s.over),
    big: p(s.big),
    cap: p(s.cap),
    x: { mean: s.x / n, se: Math.sqrt((s.x2 / n - (s.x / n) ** 2) / n) },
    xu2: { mean: s.xu2 / n, se: Math.sqrt((s.xu4 / n - (s.xu2 / n) ** 2) / n) },
  };
}

// --------------------------------------------------------------------------- base-only, exact

describe('stats on a pure base game (pack example, exact tier)', () => {
  const c = cases.find((x) => x.panel === 'panel-plain-ways-substitution-no-overlay')!;
  const spec = c.spec as SlotSpec;
  const bet = spec.bet.coins;
  const d = exactSpinDistribution(spec);
  const cfg: SlotConfig = { maxWinStakes: 5000, volatility: 'medium', targetRtp: 0.96 };

  it('RTP = exactRtp, hit rate / SD / tails = values read directly off the enumerated distribution', () => {
    const s = computeSlotStats({ spec, config: cfg, baseDist: d, mc: { sessions: 2000 } });
    expect(s.rtpTier).toBe('exact');
    expect(Math.abs(s.rtp - exactRtp(spec).rtp)).toBeLessThan(1e-12);
    expect(Math.abs(s.rtp - c.rtp)).toBeLessThan(1e-9);
    expect(s.capLoss).toMatchObject({ value: 0, tier: 'exact' });
    expect(s.hitRate).toBeCloseTo(distProb(d, (x) => x > 0), 14);
    const m1 = distMean(d);
    expect(s.sdStakes).toBeCloseTo(Math.sqrt(distSecondMoment(d) - m1 * m1) / bet, 12);
    expect(s.winOverStake).toMatchObject({ tier: 'exact', mcMass: 0 });
    expect(s.winOverStake.value).toBeCloseTo(distProb(d, (x) => x > bet), 14);
    expect(s.pWin100.value).toBeCloseTo(distProb(d, (x) => x >= 100 * bet), 14);
    expect(s.feature).toBeNull();
    expect(row(s, 'featureShare')).toMatchObject({ value: 0, pass: true });
    expect(row(s, 'featureFrequency').value).toBeNull();
    expect(s.dryStreakP95).toBe(dryStreakQuantile(s.hitRate));
    for (const r of s.rows) if (r.key !== 'session') expect(r.tier === null || r.tier === 'exact', r.key).toBe(true);
    console.log(`  ${c.panel}: hit ${(s.hitRate * 100).toFixed(2)}%, SD ${s.sdStakes.toFixed(3)}, dry p95 ${s.dryStreakP95}, P(cap) ${s.reach.best}`);
  });

  it('a cap the base can exceed: exact cap loss Σ p·(B − cap)+ / bet, exact P(B ≥ cap)', () => {
    const low: SlotConfig = { ...cfg, maxWinStakes: 3 };
    const C = 3 * bet;
    const s = computeSlotStats({ spec, config: low, baseDist: d, mc: { sessions: 2000 } });
    let loss = 0;
    d.p.forEach((p, i) => (loss += p * Math.max(0, d.coins[i] - C)));
    expect(loss).toBeGreaterThan(0);
    expect(s.capLoss.tier).toBe('exact');
    expect(s.capLoss.value).toBeCloseTo(loss / bet, 14);
    expect(s.rtp).toBeCloseTo(exactRtp(spec).rtp - loss / bet, 14);
    expect(s.rtpTier).toBe('exact');
    expect(s.reach.best).toBeCloseTo(distProb(d, (x) => x >= C), 14);
    expect(row(s, 'maxWinReach').tier).toBe('exact');
  });
});

// --------------------------------------------------------------------------- dry streak

describe('dry streak: the longest-miss-run DP', () => {
  it('equals brute force over every hit/miss sequence (n = 14)', () => {
    const n = 14;
    const q = 0.63;
    const exact = new Array<number>(n + 1).fill(0);
    for (let mask = 0; mask < 1 << n; mask++) {
      let run = 0;
      let longest = 0;
      let p = 1;
      for (let t = 0; t < n; t++) {
        const miss = (mask >> t) & 1;
        p *= miss ? q : 1 - q;
        run = miss ? run + 1 : 0;
        if (run > longest) longest = run;
      }
      exact[longest] += p;
    }
    let cdf = 0;
    for (let L = 0; L <= n; L++) {
      cdf += exact[L];
      expect(Math.abs(longestRunCdf(q, n, L) - cdf)).toBeLessThan(1e-12);
    }
  });

  it('agrees with simulated 100-round sessions within 4 SE at the p95', () => {
    const hit = 0.2809;
    const p95 = dryStreakQuantile(hit);
    const rng = mulberry32(99);
    const N = 40_000;
    let le = 0;
    let le1 = 0;
    for (let i = 0; i < N; i++) {
      let run = 0;
      let longest = 0;
      for (let t = 0; t < 100; t++) {
        run = rng() < hit ? 0 : run + 1;
        if (run > longest) longest = run;
      }
      if (longest <= p95) le++;
      if (longest <= p95 - 1) le1++;
    }
    const pa = longestRunCdf(1 - hit, 100, p95);
    const pb = longestRunCdf(1 - hit, 100, p95 - 1);
    expect(pa).toBeGreaterThanOrEqual(0.95);
    expect(pb).toBeLessThan(0.95);
    expect(z(le / N, pa, Math.sqrt((pa * (1 - pa)) / N))).toBeLessThan(4);
    expect(z(le1 / N, pb, Math.sqrt((pb * (1 - pb)) / N))).toBeLessThan(4);
    console.log(`  p95 at hit 28.09%: ${p95} (P ≤ ${p95} = ${pa.toFixed(4)}, sim ${(le / N).toFixed(4)}); §3 quotes: 33% → ${dryStreakQuantile(0.33)}, 25% → ${dryStreakQuantile(0.25)}`);
  });
});

// --------------------------------------------------------------------------- feature tail bounds

/** Exact P(F ≥ t), t = 0..T, by walking every spin path (tiny feature). */
function bruteTail(d: SpinDist, cfg: FreeSpinsConfig, n0: number, T: number): number[] {
  const out = new Array<number>(T + 2).fill(0);
  const rec = (A: number, j: number, R: number, sum: number, p: number) => {
    if (j === A) {
      for (let t = 0; t <= Math.min(sum, T + 1); t++) out[t] += p;
      return;
    }
    const m = multiplierAt(cfg.multiplier, j + 1, R);
    for (let i = 0; i < d.p.length; i++) {
      const a = award(cfg.retrigger, d.k[i]);
      rec(a > 0 ? A + Math.min(a, cfg.maxSpins - A) : A, j + 1, a > 0 ? R + 1 : R, sum + m * d.coins[i], p * d.p[i]);
    }
  };
  rec(Math.min(n0, cfg.maxSpins), 0, 0, 0, 1);
  return out;
}

describe('featureTailBounds (the max-win reach bounds)', () => {
  const d: SpinDist = { coins: [0, 1, 3, 0, 5], k: [0, 0, 0, 3, 3], p: [0.5, 0.2, 0.15, 0.1, 0.05], tier: 'exact', method: 'synthetic' };
  const T = 40;

  it('with a 1-coin grid, lower = upper = the exact tail (per_spin, retriggers clipped at maxSpins)', () => {
    const cfg: FreeSpinsConfig = { kind: 'free_spins', spec: 'f', awards: { '3': 3 }, retrigger: { '3': 2 }, maxSpins: 6, multiplier: { kind: 'per_spin', start: 1, step: 1 } };
    const tb = featureTailBounds(d, cfg, 1, T, T);
    expect(tb.g).toBe(1);
    for (const n0 of [1, 3, 6]) {
      const ex = bruteTail(d, cfg, n0, T);
      for (let t = 1; t <= T; t++) {
        expect(Math.abs(tb.lower(n0, t) - ex[t]), `n0 ${n0} t ${t}`).toBeLessThan(1e-12);
        expect(Math.abs(tb.upper(n0, t) - ex[t])).toBeLessThan(1e-12);
      }
    }
  });

  it('per_retrigger and a coarse grid: lower ≤ exact ≤ upper', () => {
    const cfg: FreeSpinsConfig = { kind: 'free_spins', spec: 'f', awards: { '3': 3 }, retrigger: { '3': 2 }, maxSpins: 6, multiplier: { kind: 'per_retrigger', start: 1, step: 2 } };
    const tb = featureTailBounds(d, cfg, 1, T, 7);
    const ex = bruteTail(d, cfg, 3, T);
    let gap = 0;
    for (let t = 1; t <= T; t++) {
      expect(tb.lower(3, t)).toBeLessThanOrEqual(ex[t] + 1e-12);
      expect(tb.upper(3, t)).toBeGreaterThanOrEqual(ex[t] - 1e-12);
      gap += tb.upper(3, t) - tb.lower(3, t);
    }
    expect(gap).toBeGreaterThan(0);
  });
});

// --------------------------------------------------------------------------- with a feature

const OPTS = { rounds: 50_000, sessions: 2000, seed: 5 };
let featureStats: SlotStats | null = null;
/** The sample game's stats, computed once for the tests that read them. */
const sampleStats = () => (featureStats ??= computeSlotStats({ spec: BASE, featureSpec: FEAT, config: CFG, mc: OPTS }));

describe('stats with free spins (the sample game) vs a direct round simulation', () => {
  const opts = OPTS;
  const s = sampleStats();
  const bet = BASE.bet.coins;
  const sim = directRounds(BASE, FEAT, CFG.feature!, Math.floor(CFG.maxWinStakes * bet), 250_000, 11);

  it('exact rows: RTP, hit rate, SD (E[X²]) within 4 SE of the simulation', () => {
    expect(s.rtpUncappedTier).toBe('exact');
    expect(s.feature!.tier).toBe('exact');
    expect(row(s, 'hitRate').tier).toBe('exact');
    expect(row(s, 'volatility').tier).toBe('exact');
    const ex2 = s.sdStakes ** 2 + s.rtpUncapped ** 2;
    const zs = { rtp: z(sim.x.mean, s.rtp, sim.x.se), hit: z(sim.hit.mean, s.hitRate, sim.hit.se), ex2: z(sim.xu2.mean, ex2, sim.xu2.se) };
    console.log(
      `  rtp ${s.rtp.toFixed(5)} sim ${sim.x.mean.toFixed(5)} ± ${sim.x.se.toFixed(5)}; hit ${s.hitRate.toFixed(5)} sim ${sim.hit.mean.toFixed(5)}; ` +
        `E[X²] ${ex2.toFixed(2)} sim ${sim.xu2.mean.toFixed(2)} ± ${sim.xu2.se.toFixed(2)}; z ${JSON.stringify(zs, (_, v) => (typeof v === 'number' ? +v.toFixed(2) : v))}`,
    );
    expect(zs.rtp).toBeLessThan(4);
    expect(zs.hit).toBeLessThan(4);
    expect(zs.ex2).toBeLessThan(4);
    expect(Math.abs(s.rtp - exactRtp(BASE).rtp - s.featureRtp)).toBeLessThan(1e-12); // cap not observed: rtp = uncapped
  });

  it('mc rows carry se and n and agree with the simulation', () => {
    for (const key of ['winOverStake', 'pWin100']) {
      const r = row(s, key);
      if (r.tier === 'mc') {
        expect(r.se, key).toBeGreaterThan(0);
        expect(r.n, key).toBe(opts.rounds);
      }
    }
    expect(z(sim.over.mean, s.winOverStake.value, Math.hypot(sim.over.se, s.winOverStake.se ?? 0))).toBeLessThan(4);
    expect(z(sim.big.mean, s.pWin100.value, Math.hypot(sim.big.se, s.pWin100.se ?? 0))).toBeLessThan(4);
    const sess = row(s, 'session');
    expect(sess).toMatchObject({ tier: 'mc', n: opts.sessions });
    expect(sess.se).toBeGreaterThan(0);
    expect(s.capLoss).toMatchObject({ tier: 'mc', hits: 0, n: opts.rounds });
    expect(s.rtpTier).toBe('exact');
    expect(s.reach.lowerBound).toBeLessThanOrEqual(s.reach.upperBound);
  });

  it('is deterministic: same seed, same output', () => {
    const small = { rounds: 5000, sessions: 300, seed: 8 };
    const a = computeSlotStats({ spec: BASE, featureSpec: FEAT, config: CFG, mc: small });
    const b = computeSlotStats({ spec: BASE, featureSpec: FEAT, config: CFG, mc: small });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const other = computeSlotStats({ spec: BASE, featureSpec: FEAT, config: CFG, mc: { ...small, seed: 9 } });
    expect(other.session.medianStakes).not.toBe(a.session.medianStakes);
    expect(other.rtp).toBe(a.rtp);
    expect(other.hitRate).toBe(a.hitRate);
  });
});

describe('a cap the feature reaches (sample game at 300×): cap loss and reach vs simulation', () => {
  const cfg: SlotConfig = { ...CFG, maxWinStakes: 300 };
  const bet = BASE.bet.coins;
  const s = computeSlotStats({ spec: BASE, featureSpec: FEAT, config: cfg, mc: { rounds: 50_000, sessions: 300, seed: 3 } });
  const sim = directRounds(BASE, FEAT, cfg.feature!, 300 * bet, 200_000, 17);

  it('capped RTP (mc) and P(X ≥ cap) agree; the exact bounds bracket the estimate', () => {
    expect(s.capLoss.tier).toBe('mc');
    expect(s.capLoss.hits).toBeGreaterThan(0);
    expect(s.capLoss.value).toBeGreaterThan(0);
    expect(s.capLoss.value).toBeLessThanOrEqual(s.capLoss.upperBound!);
    expect(s.rtpTier).toBe('mc');
    expect(s.rtp).toBeCloseTo(s.rtpUncapped - s.capLoss.value, 14);
    const mc = s.reach.mc!;
    console.log(
      `  cap 300×: rtp ${s.rtp.toFixed(5)} ± ${s.rtpSe!.toExponential(2)} (loss ${s.capLoss.value.toExponential(3)} ≤ ${s.capLoss.upperBound!.toExponential(3)}), sim ${sim.x.mean.toFixed(5)} ± ${sim.x.se.toFixed(5)}; ` +
        `P(cap) [${s.reach.lowerBound.toExponential(3)}, ${s.reach.upperBound.toExponential(3)}] mc ${mc.value.toExponential(3)} ± ${mc.se!.toExponential(1)}, sim ${sim.cap.mean.toExponential(3)}`,
    );
    expect(z(sim.x.mean, s.rtp, Math.hypot(sim.x.se, s.rtpSe!))).toBeLessThan(4);
    expect(mc.value).toBeGreaterThan(s.reach.lowerBound - 4 * mc.se!);
    expect(mc.value).toBeLessThan(s.reach.upperBound + 4 * mc.se!);
    expect(sim.cap.mean).toBeGreaterThan(s.reach.lowerBound - 4 * sim.cap.se);
    expect(sim.cap.mean).toBeLessThan(s.reach.upperBound + 4 * sim.cap.se);
    expect(row(s, 'maxWinReach').pass).toBe(true);
  });
});

// --------------------------------------------------------------------------- facts + canonical JSON

describe('slot-facts.json', () => {
  const oracle: OracleCheck = { status: 'pass', detail: 'test', checks: [] };

  it('the review CLI reads every §3 fact from it', () => {
    const s = sampleStats();
    const facts = JSON.parse(JSON.stringify(buildSlotFacts({ game: 'sample-game', specHash: 'x', config: CFG, stats: s, oracle })));
    for (const k of ['rtp', 'rtpTier', 'rtpSe', 'hitRate', 'volatility', 'volatilitySd', 'maxWin', 'featureFreq', 'featureShare']) expect(facts[k], k).not.toBeUndefined();
    expect(facts.schema).toBe('slot_facts_v1');
    const { facts: f, missing } = normaliseFacts(facts);
    expect(missing).toEqual([]);
    expect(f.rtp).toBe(s.rtp);
    expect(f.rtpTier).toBe(s.rtpTier);
    expect(f.rtpSe ?? 0).toBe(0);
    expect(f.hitRate).toBe(s.hitRate);
    expect(f.winOverStake).toBe(s.winOverStake.value);
    expect(f.sd).toBe(s.sdStakes);
    expect(f.measuredVolatility).toBe(s.volatilityMeasured);
    expect(f.featureOneIn).toBeCloseTo(s.feature!.frequency, 9);
    expect(f.featureShare).toBe(s.feature!.share);
    expect(f.avgFeatureWin).toBe(s.feature!.averageWinStakes);
    expect(f.bigWinOneIn).toBeCloseTo(1 / s.pWin100.value, 6);
    expect(f.maxWin).toBe(CFG.maxWinStakes);
    expect(f.maxWinOneIn).toBeCloseTo(1 / s.reach.best!, 0);
    expect(f.dryStreakP95).toBe(s.dryStreakP95);
    expect(f.sessionMedian).toBe(s.session.medianStakes);
    expect(facts.stats).toHaveLength(s.rows.length);
  });

  it('canonicalJson prints exactly what Python json.dumps(sort_keys, compact, ensure_ascii) prints', () => {
    // input and output generated with the pack's Python 3.12
    const text = JSON.parse(
      '"{\\"b\\": [1.0, 0.0, -0.0, 1e16, 1.5e-7, 0.0001, 0.00001, 123456789012345678901234567890, 1E5, 2.50, -3, 1e400, 0.1, 100.0, 1e15, 12345678901234567.0],\\n \\"a\\": {\\"z\\": \\"caf\\u00e9 \\\\\\"q\\\\\\" \\\\\\\\ / \\\\n\\\\t\\\\u0001 \\ud83c\\udfb0 \\\\u007f\\", \\"y\\": [true, false, null]}, \\"a2\\": {}, \\"dup\\": 1, \\"dup\\": 2, \\"\\": []}"',
    ) as string;
    const want = JSON.parse(
      '"{\\"\\":[],\\"a\\":{\\"y\\":[true,false,null],\\"z\\":\\"caf\\\\u00e9 \\\\\\"q\\\\\\" \\\\\\\\ / \\\\n\\\\t\\\\u0001 \\\\ud83c\\\\udfb0 \\\\u007f\\"},\\"a2\\":{},\\"b\\":[1.0,0.0,-0.0,1e+16,1.5e-07,0.0001,1e-05,123456789012345678901234567890,100000.0,2.5,-3,Infinity,0.1,100.0,1000000000000000.0,1.2345678901234568e+16],\\"dup\\":2}"',
    ) as string;
    expect(canonicalJson(text)).toBe(want);
    expect(pyFloatRepr(0.96)).toBe('0.96');
    expect(pyFloatRepr(4096)).toBe('4096.0');
    expect(pyFloatRepr(1e-4)).toBe('0.0001');
    expect(pyFloatRepr(2e-5)).toBe('2e-05');
    expect(pyFloatRepr(9999999999999998)).toBe('9999999999999998.0');
    expect(pyFloatRepr(1e16)).toBe('1e+16');
    expect(pyFloatRepr(5e-324)).toBe('5e-324');
    expect(pyFloatRepr(1.7976931348623157e308)).toBe('1.7976931348623157e+308');
    expect(pyFloatRepr(0.1 + 0.2)).toBe('0.30000000000000004');
  });
});

// --------------------------------------------------------------------------- noise and anchors

describe('Monte-Carlo noise never fails a band', () => {
  const c = cases.find((x) => x.panel === 'panel-plain-ways-substitution-no-overlay')!;
  const spec = c.spec as SlotSpec;
  const bet = spec.bet.coins;
  const d = exactSpinDistribution(spec);
  const cfg: SlotConfig = { maxWinStakes: 5000, volatility: 'medium', targetRtp: 0.96 };

  it('an mc RTP outside the band by ≤ 3 SE passes within noise; by more it fails the gate', () => {
    // whiteout at 10M spins read 95.43% ± 0.34%: 0.07 below the band = 0.2 SE
    const near = computeSlotStats({ spec, config: cfg, baseDist: d, baseRtp: { rtp: 0.9543, tier: 'mc', se: 0.0034, n: 10_000_000 }, mc: { sessions: 200 } });
    expect(row(near, 'rtp')).toMatchObject({ tier: 'mc', pass: true, withinNoise: true, gate: true });
    expect(near.gateFailed).not.toContain('rtp');
    expect(near.withinNoise).toContain('rtp');
    const far = computeSlotStats({ spec, config: cfg, baseDist: d, baseRtp: { rtp: 0.9543, tier: 'mc', se: 0.0001, n: 10_000_000 }, mc: { sessions: 200 } });
    expect(row(far, 'rtp').pass).toBe(false);
    expect(row(far, 'rtp').withinNoise).toBeUndefined();
    expect(far.gateFailed).toContain('rtp');
    // the facts row carries it
    const oracle: OracleCheck = { status: 'pass', detail: '', checks: [] };
    const facts = buildSlotFacts({ game: 't', specHash: 'x', config: cfg, stats: near, oracle });
    expect(facts.stats.find((r) => r.key === 'rtp')).toMatchObject({ pass: true, withinNoise: true });
    expect(facts.withinNoise).toEqual(['rtp']);
  });

  it('the dry-streak p95 (a step in the hit rate) is within noise when hit rate ± 3 SE crosses the step', () => {
    // the hit rate where p95 steps from 21 to 20 (medium's limit is 20)
    let lo = 0.2;
    let hi = 0.3;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (dryStreakQuantile(mid) > 20) lo = mid;
      else hi = mid;
    }
    const h = hi - 0.002;
    expect(dryStreakQuantile(h)).toBe(21);
    const dist = (n: number): SpinDist => ({ coins: [0, 5 * bet], k: [0, 0], p: [1 - h, h], tier: 'mc', n, method: 'synthetic' });
    const noisy = computeSlotStats({ spec, config: cfg, baseDist: dist(100_000), mc: { sessions: 200 } });
    expect(row(noisy, 'dryStreakP95')).toMatchObject({ value: 21, pass: true, withinNoise: true });
    const sure = computeSlotStats({ spec, config: cfg, baseDist: dist(10_000_000), mc: { sessions: 200 } });
    expect(row(sure, 'dryStreakP95')).toMatchObject({ value: 21, pass: false });
    expect(sure.gateFailed).toContain('dryStreakP95');
  });
});

describe('flat award tables: the exact feature anchor', () => {
  it('P(trigger)·Σ_j E[m_j 1{N ≥ j}]·E[W] equals the full algebra when every K awards the same', () => {
    const cfg: SlotConfig = { ...CFG, feature: { ...CFG.feature!, awards: { '3': 10 }, retrigger: { '3': 5 }, maxSpins: 40 } };
    const ft = flatTables(BASE, FEAT, cfg.feature!);
    expect(ft).toMatchObject({ flat: true, rmin: 3, smin: Number(BASE.trigger!.scatter_min) });
    expect(flatTables(BASE, FEAT, CFG.feature!).why).toContain('awards differ by K');
    const s = computeSlotStats({ spec: BASE, featureSpec: FEAT, config: cfg, mc: { rounds: 2000, sessions: 200 } });
    const fd = exactSpinDistribution(FEAT);
    const bet = BASE.bet.coins;
    const a = flatFeatureAnchor(cfg.feature!, ft.smin, ft.rmin, triggerProbability(BASE), exactRtp(FEAT).rtp * bet, distProb(fd, (_c, k) => k >= 3), bet, 'test');
    expect(a.featureRtp).toBeCloseTo(s.featureRtp, 12);
    expect(a.averageWinStakes).toBeCloseTo(s.feature!.averageWinStakes, 10);
    // and the stats take it as given
    const anchored = computeSlotStats({ spec: BASE, featureSpec: FEAT, config: cfg, featureAnchor: { ...a, featureRtp: a.featureRtp + 0.01 }, mc: { rounds: 2000, sessions: 200 } });
    expect(anchored.featureRtp).toBeCloseTo(s.featureRtp + 0.01, 12);
    expect(anchored.featureRtpTier).toBe('exact');
  });
});

describe('max-win reach: no hit is never P = 0', () => {
  const c = cases.find((x) => x.panel === 'panel-plain-ways-substitution-no-overlay')!;
  const spec = c.spec as SlotSpec;
  const bet = spec.bet.coins;
  const cfg: SlotConfig = { maxWinStakes: 5000, volatility: 'medium', targetRtp: 0.96 };
  const sampled = (n: number): SpinDist => ({ coins: [0, 5 * bet], k: [0, 0], p: [0.7, 0.3], tier: 'mc', n, method: 'synthetic' });

  it('a sample with no hit reports the interval [0, 3/n]: unresolved (passes, within noise) while 3/n > 1e-9', () => {
    const s = computeSlotStats({ spec, config: cfg, baseDist: sampled(1_000_000), mc: { sessions: 200 } });
    const r = row(s, 'maxWinReach');
    expect(r).toMatchObject({ value: null, pass: true, withinNoise: true, gate: true, tier: 'mc' });
    expect(s.reach.best).toBeNull();
    expect(s.reach.interval[0]).toBe(0);
    expect(s.reach.interval[1]).toBeCloseTo(3e-6, 12);
    const facts = buildSlotFacts({ game: 't', specHash: 'x', config: cfg, stats: s, oracle: { status: 'pass', detail: '', checks: [] } });
    expect(facts.pMaxWin).toBeNull();
    expect(facts.pMaxWinBounds).toMatchObject({ lower: 0, unresolved: true });
    // 3/n below 1e-9: even the upper bound says unreachable
    const big = computeSlotStats({ spec, config: cfg, baseDist: sampled(1e10), mc: { sessions: 200 } });
    expect(row(big, 'maxWinReach')).toMatchObject({ value: null, pass: false });
    expect(big.gateFailed).toContain('maxWinReach');
  });

  it('an exact distribution that never reaches the cap is exactly 0 and fails', () => {
    const exact: SpinDist = { ...sampled(0), tier: 'exact', n: undefined };
    const s = computeSlotStats({ spec, config: cfg, baseDist: exact, baseRtp: { rtp: 1.5, tier: 'exact' }, mc: { sessions: 200 } });
    expect(row(s, 'maxWinReach')).toMatchObject({ value: 0, pass: false, tier: 'exact' });
  });

  it('the split with an importance-sampled tail reports P(T)·P(X ≥ cap | T) with its SE', () => {
    const exactDist: SpinDist = { coins: [0, bet], k: [0, 0], p: [0.6, 0.4], tier: 'exact', method: 'synthetic' };
    const cond = { n: 1000, x: [3 * bet], b0: [0], k: [0], k0: [0], count: [1000] };
    const tail = { n: 1_000_000, hits: 5000, p: 2e-6, pSe: 2e-7, loss: 1e-6 * bet, lossSe: 1e-7 * bet, method: 'test' };
    const s = computeSlotStats({ spec, config: cfg, split: { exactDist, pT: 0.01, cond, method: 'test', tail }, mc: { sessions: 200 } });
    const r = row(s, 'maxWinReach');
    expect(r.value).toBeCloseTo(0.01 * 2e-6, 15);
    expect(r.se).toBeCloseTo(0.01 * 2e-7, 15);
    expect(r.pass).toBe(true);
    expect(s.capLoss.value).toBeCloseTo(0.01 * 1e-6, 15);
  });
});
