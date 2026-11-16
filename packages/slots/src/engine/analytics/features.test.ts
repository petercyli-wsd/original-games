import { describe, expect, it } from 'vitest';
import type { SlotSpec } from '../types';
import type { FreeSpinsConfig, MultiplierSchedule } from './config';
import type { SpinDist } from './distribution';
import { exactRtp, scatterCountDist } from './exact';
import {
  featureProfile,
  featureValue,
  featureValues,
  freeSpinsAnalytics,
  sampleSpinIndex,
  simulateFeature,
  type FeatureValue,
} from './features';
import { boardAt, boardCoins, buildModel } from './model';
import { mulberry32 } from './rng';
import pack from './fixtures/pack-analytics.json';

// --------------------------------------------------------------------------- helpers

function dist(rows: [number, number, number][], tier: 'exact' | 'mc' = 'exact', n?: number): SpinDist {
  return { coins: rows.map((r) => r[0]), k: rows.map((r) => r[1]), p: rows.map((r) => r[2]), tier, n, method: 'synthetic' };
}

function cfgOf(multiplier: MultiplierSchedule, retrigger: Record<string, number> | null, maxSpins: number): FreeSpinsConfig {
  return { kind: 'free_spins', spec: 'feature.spec.json', awards: { '3': 10 }, retrigger, maxSpins, multiplier };
}

function moments(d: SpinDist) {
  let ew = 0;
  let ew2 = 0;
  let p0 = 0;
  d.p.forEach((p, i) => {
    ew += p * d.coins[i];
    ew2 += p * d.coins[i] ** 2;
    if (d.coins[i] === 0) p0 += p;
  });
  return { ew, ew2, varW: ew2 - ew * ew, p0 };
}

const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(1, Math.abs(b));

/** Correlated (W, K): scatters both pay and retrigger. */
const D1 = dist([
  [0, 0, 0.55],
  [4, 0, 0.2],
  [20, 0, 0.1],
  [0, 1, 0.06],
  [10, 1, 0.04],
  [0, 2, 0.02],
  [60, 2, 0.015],
  [200, 3, 0.01],
  [1000, 3, 0.005],
]);

/** Every stop combination of a 3-reel cut of the pack's plain 5x3 payline spec (33³ boards). */
function smallSpecDist(): SpinDist {
  const cases = (pack as unknown as { exact: { panel: string; spec: unknown }[] }).exact;
  const src = cases.find((c) => c.panel === 'panel-plain-line-eval-no-modifier');
  if (!src) throw new Error('fixture missing');
  const spec = JSON.parse(JSON.stringify(src.spec)) as SlotSpec & {
    evaluation: { paylines: number[][] };
    board_law: { reel_sets: { strips: number[][] }[] };
  };
  spec.geometry.cols = 3;
  spec.geometry.rows = [3, 3, 3];
  spec.evaluation.paylines = spec.evaluation.paylines.map((l) => l.slice(0, 3));
  for (const rs of spec.board_law.reel_sets) rs.strips = rs.strips.slice(0, 3);
  const m = buildModel(spec);
  const comp = m.components[0];
  const L = comp.strips.map((s) => s.length);
  const acc = new Map<string, [number, number, number]>();
  const tot = L[0] * L[1] * L[2];
  for (let a = 0; a < L[0]; a++)
    for (let b = 0; b < L[1]; b++)
      for (let c = 0; c < L[2]; c++) {
        const { coins, k } = boardCoins(m, boardAt(m, comp, [a, b, c]));
        const key = `${coins}|${k}`;
        const e = acc.get(key);
        if (e) e[2] += 1 / tot;
        else acc.set(key, [coins, k, 1 / tot]);
      }
  return { ...dist([...acc.values()]), method: 'enumerated 3-reel cut' };
}

/** Run `n` seeded features; returns the exact-vs-simulated comparison per statistic. */
function simulate(d: SpinDist, cfg: FreeSpinsConfig, init: number, n: number, seed: number) {
  const rng = mulberry32(seed);
  const s = { spins: [0, 0], f: [0, 0], f2: [0, 0], z: 0 };
  for (let i = 0; i < n; i++) {
    const r = simulateFeature(d, cfg, init, rng);
    s.spins[0] += r.spins;
    s.spins[1] += r.spins ** 2;
    s.f[0] += r.coins;
    s.f[1] += r.coins ** 2;
    s.f2[0] += r.coins ** 2;
    s.f2[1] += r.coins ** 4;
    if (r.coins === 0) s.z++;
  }
  const stat = ([a, b]: number[]) => {
    const mean = a / n;
    return { mean, se: Math.sqrt(Math.max(0, b / n - mean * mean) / n) };
  };
  const pz = s.z / n;
  return { spins: stat(s.spins), f: stat(s.f), f2: stat(s.f2), pZero: { mean: pz, se: Math.sqrt((pz * (1 - pz)) / n) } };
}

function expectWithin4Se(exact: FeatureValue, sim: ReturnType<typeof simulate>) {
  const rows: [string, number, { mean: number; se: number }][] = [
    ['E[spins]', exact.expectedSpins, sim.spins],
    ['E[F]', exact.expectedWinCoins, sim.f],
    ['E[F²]', exact.secondMomentCoins, sim.f2],
    ['P(F=0)', exact.pZero, sim.pZero],
  ];
  for (const [name, x, { mean, se }] of rows) {
    const z = (mean - x) / se;
    console.log(`  ${name.padEnd(9)} exact ${x.toPrecision(8).padStart(14)}  sim ${mean.toPrecision(8).padStart(14)} ± ${se.toPrecision(3)}  z ${z.toFixed(2)}`);
    expect(Math.abs(z), name).toBeLessThan(4);
  }
}

function binomCdf(n: number, r: number, x: number): number {
  // P(Bin(n, r) ≤ x)
  let s = 0;
  let c = 1;
  for (let i = 0; i <= Math.min(x, n); i++) {
    if (i > 0) c = (c * (n - i + 1)) / i;
    s += c * r ** i * (1 - r) ** (n - i);
  }
  return s;
}

// --------------------------------------------------------------------------- hand-checkable

describe('free spins: hand-checkable closed forms', () => {
  const { ew, ew2, varW, p0 } = moments(D1);

  it('no retrigger, constant ×m: E[spins] = N, E[F] = N·m·E[W], Var = N·m²·Var[W], P(0) = P(W=0)^N', () => {
    const N = 10;
    const m = 3;
    const v = featureValue(D1, cfgOf({ kind: 'constant', value: m }, null, 50), N);
    expect(v.expectedSpins).toBeCloseTo(N, 12);
    expect(rel(v.expectedWinCoins, N * m * ew)).toBeLessThan(1e-12);
    const varF = v.secondMomentCoins - v.expectedWinCoins ** 2;
    expect(rel(varF, N * m * m * varW)).toBeLessThan(1e-10);
    expect(rel(v.pZero, p0 ** N)).toBeLessThan(1e-12);
  });

  it('no retrigger, per_spin: E[F] = E[W]·Σ m_j, Var = Var[W]·Σ m_j², a ×0 spin counts as a zero', () => {
    const N = 12;
    const ms = Array.from({ length: N }, (_, j) => 1 + 0.5 * j);
    const v = featureValue(D1, cfgOf({ kind: 'per_spin', start: 1, step: 0.5 }, null, 40), N);
    expect(rel(v.expectedWinCoins, ew * ms.reduce((a, b) => a + b))).toBeLessThan(1e-12);
    expect(rel(v.secondMomentCoins - v.expectedWinCoins ** 2, varW * ms.reduce((a, b) => a + b * b, 0))).toBeLessThan(1e-10);
    expect(rel(v.pZero, p0 ** N)).toBeLessThan(1e-12);
    const v0 = featureValue(D1, cfgOf({ kind: 'per_spin', start: 0, step: 1 }, null, 40), N);
    expect(rel(v0.pZero, p0 ** (N - 1))).toBeLessThan(1e-12);
    expect(rel(v0.expectedWinCoins, (ew * (N - 1) * N) / 2)).toBeLessThan(1e-12);
  });

  it('the maxSpins cap clips the initial award', () => {
    const v = featureValue(D1, cfgOf({ kind: 'constant', value: 1 }, null, 7), 10);
    expect(v.initialSpins).toBe(7);
    expect(v.expectedSpins).toBeCloseTo(7, 12);
    expect(featureValue(D1, cfgOf({ kind: 'constant', value: 1 }, null, 7), 0)).toEqual({
      initialSpins: 0,
      expectedSpins: 0,
      expectedWinCoins: 0,
      secondMomentCoins: 0,
      pZero: 1,
    });
  });

  it('geometric retrigger (+1 spin w.p. q, W ⟂ K) with a cap: T = min(T_negbin, M), Wald moments', () => {
    const q = 0.3;
    const N = 5;
    const M = 30;
    const m = 2;
    const W: [number, number][] = [
      [0, 0.5],
      [10, 0.4],
      [50, 0.1],
    ];
    const rows: [number, number, number][] = [];
    for (const [w, pw] of W) {
      rows.push([w, 0, pw * (1 - q)]);
      rows.push([w, 1, pw * q]);
    }
    const d = dist(rows);
    const { ew: ew_, varW: varW_ } = moments(d);
    // uncapped: spins until the N-th non-retrigger; T ≥ t iff < N non-retriggers in the first t−1
    const surv = (t: number) => (t > M ? 0 : binomCdf(t - 1, 1 - q, N - 1));
    let eT = 0;
    let eT2 = 0;
    let pz = 0;
    for (let t = 1; t <= M; t++) {
      eT += surv(t);
      eT2 += (2 * t - 1) * surv(t);
      pz += (surv(t) - surv(t + 1)) * 0.5 ** t;
    }
    const v = featureValue(d, cfgOf({ kind: 'constant', value: m }, { '1': 1 }, M), N);
    expect(rel(v.expectedSpins, eT)).toBeLessThan(1e-12);
    expect(rel(v.expectedWinCoins, m * ew_ * eT)).toBeLessThan(1e-12);
    expect(rel(v.secondMomentCoins, m * m * (eT * varW_ + eT2 * ew_ * ew_))).toBeLessThan(1e-10);
    expect(rel(v.pZero, pz)).toBeLessThan(1e-12);
  });

  it('E[F] = Σ_j E[m_j·1{N ≥ j}]·E[W] (forward DP) = the backward DP, under per_retrigger with W–K correlation', () => {
    const cfg = cfgOf({ kind: 'per_retrigger', start: 1, step: 2 }, { '1': 2, '2': 5 }, 15);
    const prof = featureProfile(D1, cfg, 10);
    const v = featureValue(D1, cfg, 10);
    expect(rel(prof.expectedMultiplierSum * ew, v.expectedWinCoins)).toBeLessThan(1e-12);
    expect(Math.abs(prof.spinsPmf.reduce((a, b) => a + b) - 1)).toBeLessThan(1e-12);
    expect(rel(prof.survival.slice(1).reduce((a, b) => a + b), v.expectedSpins)).toBeLessThan(1e-12);
    expect(prof.survival[10]).toBeCloseTo(1, 12);
    // the second moment is NOT E[(Σ m_j)²]·…: W and K are correlated; just sanity: E[F²] ≥ E[F]²
    expect(v.secondMomentCoins).toBeGreaterThan(v.expectedWinCoins ** 2);
    expect(ew2).toBeGreaterThan(0);
  });

  it('featureValues prices several initial awards in one pass, equal to one at a time', () => {
    const cfg = cfgOf({ kind: 'per_spin', start: 1, step: 1 }, { '2': 3, '3': 5 }, 25);
    const many = featureValues(D1, cfg, [8, 10, 15]);
    for (const v of many) expect(v).toEqual(featureValue(D1, cfg, v.initialSpins));
  });
});

// --------------------------------------------------------------------------- vs the simulator

describe('free spins: exact algebra = direct simulation within 4 SE (200k features each)', () => {
  const N = 200_000;
  const cases: [string, SpinDist | (() => SpinDist), FreeSpinsConfig, number][] = [
    ['constant ×2, retrigger {2:3, 3:5}, cap 30', D1, cfgOf({ kind: 'constant', value: 2 }, { '2': 3, '3': 5 }, 30), 10],
    ['per_spin 1 + 1·(j−1), retrigger {2:3, 3:5}, cap 25', D1, cfgOf({ kind: 'per_spin', start: 1, step: 1 }, { '2': 3, '3': 5 }, 25), 10],
    ['per_retrigger 1 + 2·R, retrigger {1:2, 2:5}, tight cap 15', D1, cfgOf({ kind: 'per_retrigger', start: 1, step: 2 }, { '1': 2, '2': 5 }, 15), 10],
    ['real 3-reel spec, per_retrigger 1 + 1·R, retrigger {2:2, 3:5}, cap 40', smallSpecDist, cfgOf({ kind: 'per_retrigger', start: 1, step: 1 }, { '2': 2, '3': 5 }, 40), 10],
  ];
  cases.forEach(([name, dd, cfg, init], ci) => {
    it(name, () => {
      const d = typeof dd === 'function' ? dd() : dd;
      const exact = featureValue(d, cfg, init);
      console.log(`${name} (${d.p.length} entries)`);
      expectWithin4Se(exact, simulate(d, cfg, init, N, 1000 + ci));
    });
  });
});

// --------------------------------------------------------------------------- with the base

describe('freeSpinsAnalytics', () => {
  it('a constructed case: trigger, RTP split, frequency, average win, buy price, the cap on awards', () => {
    const d = dist([
      [0, 0, 0.5],
      [50, 0, 0.3],
      [300, 0, 0.2],
    ]); // E[W] = 75
    const cfg: FreeSpinsConfig = {
      kind: 'free_spins',
      spec: 'f.json',
      awards: { '3': 8, '4': 12, '5': 20 },
      retrigger: null,
      maxSpins: 15,
      multiplier: { kind: 'constant', value: 2 },
    };
    const scatterDist = [0.7, 0.2, 0.08, 0.015, 0.004, 0.001];
    const a = freeSpinsAnalytics({ baseRtp: 0.6, baseTier: 'exact', betCoins: 100, scatterDist, scatterMin: 3, featureDist: d, cfg });
    expect(a.tier).toBe('exact');
    expect(a.rtpSe).toBeUndefined();
    expect(a.triggerP).toBeCloseTo(0.02, 15);
    expect(a.featureFrequency).toBeCloseTo(50, 9);
    expect(a.byK.map((r) => [r.k, r.spins])).toEqual([
      [3, 8],
      [4, 12],
      [5, 15], // 20 capped at maxSpins
    ]);
    // E[F | k] = spins·2·75 = 150·spins
    const sumF = 0.015 * 8 * 150 + 0.004 * 12 * 150 + 0.001 * 15 * 150; // 18 + 7.2 + 2.25 = 27.45
    expect(a.featureRtp).toBeCloseTo(sumF / 100, 12); // 0.2745
    expect(a.totalRtp).toBeCloseTo(0.8745, 12);
    expect(a.featureShare).toBeCloseTo(0.2745 / 0.8745, 12);
    expect(a.expectedSpinsGivenTrigger).toBeCloseTo((0.015 * 8 + 0.004 * 12 + 0.001 * 15) / 0.02, 12); // 9.15
    expect(a.expectedWinGivenTriggerCoins).toBeCloseTo(27.45 / 0.02, 9); // 1372.5
    expect(a.averageFeatureWinStakes).toBeCloseTo(13.725, 9);
    expect(a.buyPriceStakes(0.96)).toBeCloseTo(13.725 / 0.96, 9);
    expect(a.perSpinEvCoins).toBeCloseTo(87.45, 9);
    expect(a.featureSpinEvCoins).toBeCloseTo(75, 12);
    // the buy, simulated: K ~ P(K | K ≥ 3), then the feature; its mean / (bet·0.96) = the price
    const rng = mulberry32(7);
    const n = 200_000;
    let s = 0;
    let s2 = 0;
    for (let i = 0; i < n; i++) {
      const u = rng() * 0.02;
      const spins = u < 0.015 ? 8 : u < 0.019 ? 12 : 20;
      const f = simulateFeature(d, cfg, spins, rng).coins;
      s += f;
      s2 += f * f;
    }
    const mean = s / n;
    const se = Math.sqrt((s2 / n - mean * mean) / n);
    expect(Math.abs(mean - a.expectedWinGivenTriggerCoins) / se).toBeLessThan(4);
    expect(Math.abs(mean / a.expectedWinGivenTriggerCoins - 1)).toBeLessThan(0.01);
    // featureBetCoins: a feature spec at bet 50 pays half as many base coins per feature coin... ×2
    const b = freeSpinsAnalytics({ baseRtp: 0.6, baseTier: 'exact', betCoins: 100, featureBetCoins: 50, scatterDist, scatterMin: 3, featureDist: d, cfg });
    expect(b.featureRtp).toBeCloseTo(2 * a.featureRtp, 12);
  });

  it('on the pack plain 5x3 base (exact) with the enumerated 3-reel feature: E[F | trigger] vs simulation', () => {
    const cases = (pack as unknown as { exact: { panel: string; spec: unknown }[] }).exact;
    const spec = cases.find((c) => c.panel === 'panel-plain-line-eval-no-modifier')!.spec as SlotSpec;
    const base = exactRtp(spec);
    const sd = scatterCountDist(spec);
    const fd = smallSpecDist();
    const cfg: FreeSpinsConfig = {
      kind: 'free_spins',
      spec: 'f.json',
      awards: { '3': 10, '4': 15, '5': 20 },
      retrigger: { '2': 2, '3': 5 },
      maxSpins: 60,
      multiplier: { kind: 'per_retrigger', start: 1, step: 1 },
    };
    const a = freeSpinsAnalytics({ baseRtp: base.rtp, baseTier: base.tier, betCoins: spec.bet.coins, scatterDist: sd, scatterMin: 3, featureDist: fd, cfg });
    expect(a.tier).toBe('exact');
    expect(Math.abs(a.triggerP - base.triggerP)).toBeLessThan(1e-12);
    expect(a.totalRtp).toBeCloseTo(base.rtp + a.featureRtp, 14);
    console.log(
      `pack plain 5x3 + 3-reel feature: base RTP ${base.rtp.toFixed(6)}, feature RTP ${a.featureRtp.toFixed(6)}, 1 in ${a.featureFrequency.toFixed(1)}, ` +
        `E[spins|trig] ${a.expectedSpinsGivenTrigger.toFixed(4)}, avg win ${a.averageFeatureWinStakes.toFixed(4)}×, SD ${(a.sdWinGivenTriggerCoins / spec.bet.coins).toFixed(4)}×, P(0|trig) ${a.pZeroGivenTrigger.toFixed(6)}`,
    );
    const rng = mulberry32(11);
    const n = 200_000;
    const ks = a.byK.filter((r) => r.pK > 0);
    let s = 0;
    let s2 = 0;
    let z = 0;
    for (let i = 0; i < n; i++) {
      let u = rng() * a.triggerP;
      let row = ks[ks.length - 1];
      for (const r of ks) {
        if (u < r.pK) {
          row = r;
          break;
        }
        u -= r.pK;
      }
      const f = simulateFeature(fd, cfg, row.spins, rng).coins;
      s += f;
      s2 += f * f;
      if (f === 0) z++;
    }
    const mean = s / n;
    const se = Math.sqrt((s2 / n - mean * mean) / n);
    console.log(`  E[F|trig] exact ${a.expectedWinGivenTriggerCoins.toFixed(2)}  sim ${mean.toFixed(2)} ± ${se.toFixed(2)}`);
    expect(Math.abs(mean - a.expectedWinGivenTriggerCoins) / se).toBeLessThan(4);
    const pz = z / n;
    expect(Math.abs(pz - a.pZeroGivenTrigger) / Math.sqrt((pz * (1 - pz)) / n + 1e-12)).toBeLessThan(4);
  });

  it('mc feature dist: tier mc, and featureRtpSe (delta method) matches the spread over 300 replicate samples', () => {
    const cfg: FreeSpinsConfig = {
      kind: 'free_spins',
      spec: 'f.json',
      awards: { '3': 10, '4': 15 },
      retrigger: { '1': 2, '2': 5 },
      maxSpins: 15,
      multiplier: { kind: 'per_retrigger', start: 1, step: 2 },
    };
    const scatterDist = [0.8, 0.15, 0.04, 0.008, 0.002];
    const args = { baseRtp: 0.5, baseTier: 'exact' as const, betCoins: 100, scatterDist, scatterMin: 3, cfg };
    const truth = freeSpinsAnalytics({ ...args, featureDist: D1 }).featureRtp;
    const rng = mulberry32(99);
    const n = 5000;
    const reps = 300;
    const est: number[] = [];
    const ses: number[] = [];
    for (let r = 0; r < reps; r++) {
      const cnt = new Map<number, number>();
      for (let i = 0; i < n; i++) {
        const idx = sampleSpinIndex(D1, rng);
        cnt.set(idx, (cnt.get(idx) ?? 0) + 1);
      }
      const rows = [...cnt.entries()].map(([i, c]) => [D1.coins[i], D1.k[i], c / n] as [number, number, number]);
      const a = freeSpinsAnalytics({ ...args, featureDist: dist(rows, 'mc', n) });
      expect(a.tier).toBe('mc');
      est.push(a.featureRtp);
      ses.push(a.featureRtpSe as number);
      expect(a.rtpSe).toBe(a.featureRtpSe);
    }
    const mean = est.reduce((a, b) => a + b) / reps;
    const sd = Math.sqrt(est.reduce((a, b) => a + (b - mean) ** 2, 0) / (reps - 1));
    const meanSe = ses.reduce((a, b) => a + b) / reps;
    console.log(`  featureRtp truth ${truth.toFixed(5)}  replicate mean ${mean.toFixed(5)}  replicate SD ${sd.toFixed(5)}  mean delta-method SE ${meanSe.toFixed(5)}`);
    expect(sd / meanSe).toBeGreaterThan(0.85);
    expect(sd / meanSe).toBeLessThan(1.15);
    expect(Math.abs(mean - truth) / (sd / Math.sqrt(reps))).toBeLessThan(4);
    // a mc base adds its SE in quadrature
    const b = freeSpinsAnalytics({ ...args, baseTier: 'mc', baseRtpSe: 0.003, featureDist: dist(D1.coins.map((c, i) => [c, D1.k[i], D1.p[i]]), 'mc', n) });
    expect(b.rtpSe).toBeCloseTo(Math.hypot(0.003, b.featureRtpSe as number), 14);
  });

  it('performance: maxSpins 200, per_retrigger, a 100k-entry SpinDist, mc (SE path) runs in < 3 s', () => {
    const rng = mulberry32(5);
    const m = 100_000;
    const raw = Array.from({ length: m }, (_, i) => [i % 7 === 0 ? 0 : Math.floor(rng() * 5000), rng() < 0.97 ? 0 : 1 + Math.floor(rng() * 4), rng()]);
    const tot = raw.reduce((a, r) => a + r[2], 0);
    const d = dist(raw.map((r) => [r[0], r[1], r[2] / tot] as [number, number, number]), 'mc', 1e7);
    const cfg: FreeSpinsConfig = {
      kind: 'free_spins',
      spec: 'f.json',
      awards: { '3': 10, '4': 15, '5': 20 },
      retrigger: { '2': 3, '3': 5, '4': 10 },
      maxSpins: 200,
      multiplier: { kind: 'per_retrigger', start: 1, step: 1 },
    };
    const t0 = performance.now();
    const a = freeSpinsAnalytics({ baseRtp: 0.6, baseTier: 'exact', betCoins: 4096, scatterDist: [0.9, 0.08, 0.015, 0.004, 0.0008, 0.0002], scatterMin: 3, featureDist: d, cfg });
    const ms = performance.now() - t0;
    console.log(`  perf: ${ms.toFixed(0)} ms, E[spins|trig] ${a.expectedSpinsGivenTrigger.toFixed(3)}, featureRtpSe ${a.featureRtpSe?.toExponential(3)}`);
    expect(ms).toBeLessThan(3000);
    expect(Number.isFinite(a.featureRtp)).toBe(true);
  });
});
