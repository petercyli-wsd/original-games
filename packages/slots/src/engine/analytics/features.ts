// Exact free-spins algebra (docs/SLOTS.md §2.5): the value of a free-spins feature priced from
// the feature spin's (coins, scatters) distribution and the rules in config.ts. No Monte Carlo:
// every number here is a finite DP over the feature's state. `simulateFeature` is the direct
// simulator the tests check the algebra against (within 4 SE).
//
// ------------------------------------------------------------------------------ conventions
// The law is config.ts. Where it leaves a choice open, this file decides as follows (the
// simulator and the algebra follow the same rules):
//
//  1. A retrigger COUNTS (for R_j, the per_retrigger multiplier) whenever award(retrigger, K) > 0,
//     even when the maxSpins cap clips the spins it adds to 0. The multiplier still steps up.
//  2. A retrigger adds min(award(retrigger, K), maxSpins − awarded) spins, where `awarded` is
//     every spin awarded so far (initial + retriggered).
//  3. The initial award is capped too: a feature starts with min(initialSpins, maxSpins) spins.
//  4. Spin j's win is m_j · W_j with m_j = multiplierAt(cfg.multiplier, j, R_j). W is the spin's
//     total coins (evaluator + scatter pay), K its visible scatter count: one draw from the
//     SpinDist, so W and K are correlated (a scatter both pays and retriggers).
//  5. `pZero` is P(every free spin pays 0), which is P(F = 0) when W ≥ 0 and every m_j ≥ 0 (all
//     real configs). A spin whose multiplier is exactly 0 counts as paying 0 whatever W is.
//  6. The max-win cap is IGNORED here: it is non-linear in the round's total, so stats.ts
//     prices its effect separately. Everything below is the uncapped feature.
//  7. Coins: `featureValue` and `simulateFeature` work in the feature spec's own coins.
//     `freeSpinsAnalytics` rescales the feature's coins by betCoins / featureBetCoins so every
//     result is in base coins (the identity when both specs share bet.coins, the normal case).
//
// ------------------------------------------------------------------------------ the maths
// State before a spin: (A, j, R) = (spins awarded so far, spins played, retriggers so far);
// spins left = A − j, the feature ends when j = A. R is only tracked for per_retrigger (for
// constant / per_spin the multiplier of spin j+1 depends on j alone and R collapses).
// One spin from (A, j, R) draws (W, K), pays m·W with m = multiplierAt(j+1, R), and moves to
// s'(K) = (min(A + a(K), max), j + 1, R + [a(K) > 0]) with a(K) = award(retrigger, K).
//
// Reduction. The next state depends on K only through a = a(K), and the future after the spin
// is independent of the spin (independent draws). So group the SpinDist by a and keep, per
// group g: P_g = P(a(K) = g), μ_g = E[W·1{a(K)=g}], ν_g = E[W²·1{a(K)=g}], z_g = P(W = 0, a(K)=g).
// These four numbers are all the DP below reads: the first moment needs P_g and μ_g, the second
// needs ν_g (the W² term) and μ_g (the cross term, which is where the W–K correlation enters),
// and P(F = 0) needs z_g. A 100k-entry SpinDist becomes a handful of groups in one pass.
//
// Backward DP, with F' = the win from the remaining spins (all conditional on the state s):
//   E[spins | s] = 1 + Σ_g P_g · E[spins | s'_g]
//   E[F' | s]    = Σ_g [ m·μ_g + P_g · E[F' | s'_g] ]
//   E[F'² | s]   = Σ_g [ m²·ν_g + 2m·μ_g·E[F' | s'_g] + P_g·E[F'² | s'_g] ]
//   P(F'=0 | s)  = Σ_g (m = 0 ? P_g : z_g) · P(F'=0 | s'_g)
// The square: E[(mW + F'')² 1{a=g}] = m²E[W²1{a=g}] + 2m E[W·1{a=g}] E[F''|s'_g] + P_g E[F''²|s'_g]
// because, given the group, F'' (later spins) is independent of this spin's W.
// Terminal states (j = A) give 0, 0, 0, 1. j only increases, so the DP runs j = max−1 … 0, and
// its layer 0 holds the feature's value for every initial award at once.
//
// First moment, unrolled. E[F] = Σ_j E[W_j m_j 1{N ≥ j}] = Σ_j E[m_j 1{N ≥ j}] · E[W]: the event
// {N ≥ j} and R_j (so m_j) are functions of spins 1..j−1 only, which are independent of spin j,
// so the expectation factors. For constant / per_spin, m_j is deterministic and this is
// Σ_j P(N ≥ j)·m_j·E[W] (docs/SLOTS.md §2.5). `featureProfile` returns P(N ≥ j) and
// E[m_j 1{N ≥ j}] by the forward DP, and the tests check Σ_j E[m_j 1{N≥j}]·E[W] = the backward
// E[F]. The factorisation fails for the second moment (W_j and K_j are correlated, and K_j moves
// later multipliers and N), which is why E[F²] uses the joint (W, a(K)) groups.
//
// Cost: states (A, j) with j ≤ A ≤ max are ~max²/2; per_retrigger adds R ≤ j, ~max³/6 states
// (1.3M at max = 200) × the number of award groups.
//
// ------------------------------------------------------------------------------ tiers and SE
// Every result is 'exact' when the base is exact ('exact' or 'exact_mixture') and the feature
// SpinDist is exact; otherwise 'mc'. For an mc feature SpinDist (an empirical distribution of n
// spins), featureRtp is a smooth functional of that empirical distribution, so its sampling SE
// is the delta method's: SE = sd(IF(W, K)) / √n with the influence function
//   IF(w, k) = M·w + G_{a(k)},   M = Σ_s π(s)·m(s),   G_g = Σ_s π(s)·E[F' | s'_g(s)],
// where π(s) is the probability the feature visits pre-spin state s (forward DP), weighted
// over the base's triggering K by P(K = k) / bet. (∂E[F]/∂μ_g = M for every g and
// ∂E[F]/∂P_g = G_g, from the backward recursion.) rtpSe = √(baseRtpSe² + featureRtpSe²),
// treating the base and feature samples as independent. NOT propagated: sampling error in the
// base scatter distribution P(K = k) when the base is mc (its n is not an input; the base's own
// baseRtpSe carries the base's error).

import { award, multiplierAt, type FreeSpinsConfig } from './config';
import type { SpinDist } from './distribution';

// --------------------------------------------------------------------------- public types

export interface FeatureValue {
  /** Spins the feature starts with (after the maxSpins cap). */
  initialSpins: number;
  expectedSpins: number;
  /** E[F] in coins (uncapped by the max win). */
  expectedWinCoins: number;
  /** E[F²] in coins². */
  secondMomentCoins: number;
  /** P(F = 0) (see convention 5). */
  pZero: number;
}

export interface FeatureProfile {
  initialSpins: number;
  /** survival[j] = P(N ≥ j) for j = 0..maxSpins (survival[0] = 1). */
  survival: number[];
  /** multSurvival[j] = E[m_j · 1{N ≥ j}] for j = 1..maxSpins (index 0 unused, 0). */
  multSurvival: number[];
  /** spinsPmf[n] = P(N = n), n = 0..maxSpins. */
  spinsPmf: number[];
  /** Σ_j E[m_j 1{N ≥ j}]: E[F] = this × E[W]. */
  expectedMultiplierSum: number;
}

export interface FreeSpinsAnalytics {
  tier: 'exact' | 'mc';
  /** SE of totalRtp (tier mc only, when it can be propagated: see the header). */
  rtpSe?: number;
  /** SE of featureRtp from the feature SpinDist's sample (feature SpinDist mc with n only). */
  featureRtpSe?: number;
  baseRtp: number;
  /** P(K ≥ scatterMin) on the base. */
  triggerP: number;
  /** One row per base scatter count k ≥ scatterMin; `spins` = the initial award (capped). */
  byK: { k: number; pK: number; spins: number; value: FeatureValue }[];
  expectedSpinsGivenTrigger: number;
  /** E[F | triggered] in base coins. */
  expectedWinGivenTriggerCoins: number;
  /** SD of F given a trigger, in base coins. */
  sdWinGivenTriggerCoins: number;
  /** P(F = 0 | triggered). */
  pZeroGivenTrigger: number;
  /** E[F | triggered] / bet. */
  averageFeatureWinStakes: number;
  /** Σ_k P(K = k) E[F | k] / bet. */
  featureRtp: number;
  totalRtp: number;
  /** featureRtp / totalRtp (0 when totalRtp = 0). */
  featureShare: number;
  /** N in "1 in N base spins": 1 / triggerP (Infinity when it can't trigger). */
  featureFrequency: number;
  /** The feature-buy price in stakes: E[F | triggered] / (bet · targetRtp). */
  buyPriceStakes(targetRtp: number): number;
  /** Expected coins per base spin of the whole round, base + feature: totalRtp × bet. */
  perSpinEvCoins: number;
  /** E[W] of one feature spin, in base coins. */
  featureSpinEvCoins: number;
}

export interface FreeSpinsArgs {
  baseRtp: number;
  baseTier: 'exact' | 'exact_mixture' | 'mc';
  baseRtpSe?: number;
  /** The base spec's bet.coins (the stake). */
  betCoins: number;
  /** The feature spec's bet.coins, when it differs from the base's (default betCoins). */
  featureBetCoins?: number;
  /** P(K = k) on the base, k = 0.. */
  scatterDist: number[];
  scatterMin: number;
  featureDist: SpinDist;
  cfg: FreeSpinsConfig;
}

// --------------------------------------------------------------------------- reduction

interface AwardGroup {
  /** award(retrigger, K) for this group. */
  a: number;
  p: number;
  mu: number;
  nu: number;
  z: number;
}

interface Reduced {
  groups: AwardGroup[];
  /** E[W], E[W²] (scaled). */
  ew: number;
  ew2: number;
}

function checkDist(d: SpinDist): void {
  const n = d.p.length;
  if (d.coins.length !== n || d.k.length !== n) throw new Error('SpinDist: coins, k and p differ in length');
  let s = 0;
  for (let i = 0; i < n; i++) {
    const p = d.p[i];
    if (!(p >= 0)) throw new Error(`SpinDist: p[${i}] = ${p} is not a probability`);
    s += p;
  }
  if (Math.abs(s - 1) > 1e-6) throw new Error(`SpinDist: probabilities sum to ${s}, not 1`);
}

/** Group a SpinDist by retrigger award a(K) (see "Reduction" above). `scale` multiplies coins. */
function reduce(d: SpinDist, cfg: FreeSpinsConfig, scale = 1): Reduced {
  checkDist(d);
  const aOfK = new Map<number, number>();
  const byA = new Map<number, AwardGroup>();
  let ew = 0;
  let ew2 = 0;
  for (let i = 0; i < d.p.length; i++) {
    const p = d.p[i];
    if (p === 0) continue;
    const k = d.k[i];
    let a = aOfK.get(k);
    if (a === undefined) {
      a = award(cfg.retrigger, k);
      aOfK.set(k, a);
    }
    let g = byA.get(a);
    if (!g) {
      g = { a, p: 0, mu: 0, nu: 0, z: 0 };
      byA.set(a, g);
    }
    const w = d.coins[i] * scale;
    g.p += p;
    g.mu += p * w;
    g.nu += p * w * w;
    if (w === 0) g.z += p;
    ew += p * w;
    ew2 += p * w * w;
  }
  const groups = [...byA.values()].sort((x, y) => x.a - y.a);
  return { groups, ew, ew2 };
}

// --------------------------------------------------------------------------- the DP

// Layer j holds the states (A, j, R) for A = j..max and R = 0..rW(j)−1, at index (A − j)·rW + R,
// with rW(j) = j + 1 for per_retrigger (R ≤ j) and 1 otherwise.

interface Shape {
  max: number;
  perRet: boolean;
}

function shapeOf(cfg: FreeSpinsConfig): Shape {
  const max = cfg.maxSpins;
  if (!Number.isInteger(max) || max < 0) throw new Error(`maxSpins ${max} is not a non-negative integer`);
  return { max, perRet: cfg.multiplier.kind === 'per_retrigger' };
}

const rW = (sh: Shape, j: number) => (sh.perRet ? j + 1 : 1);
const layerSize = (sh: Shape, j: number) => (sh.max - j + 1) * rW(sh, j);

interface Backward {
  /** Layer 0 (R = 0), indexed by A = 0..max. */
  v1: Float64Array;
  v2: Float64Array;
  spins: Float64Array;
  z: Float64Array;
  /** E[F' | s] for every layer (only when asked for: the SE gradient needs it). */
  v1Layers?: Float64Array[];
}

function backward(red: Reduced, cfg: FreeSpinsConfig, sh: Shape, keepV1: boolean): Backward {
  const { max, perRet } = sh;
  const gs = red.groups;
  const nG = gs.length;
  const ga = gs.map((g) => g.a);
  const v1Layers: Float64Array[] | undefined = keepV1 ? new Array<Float64Array>(max + 1) : undefined;

  // terminal layer j = max: the single A = max, every R terminal
  let n1 = new Float64Array(layerSize(sh, max));
  let n2 = new Float64Array(n1.length);
  let nS = new Float64Array(n1.length);
  let nZ = new Float64Array(n1.length).fill(1);
  if (v1Layers) v1Layers[max] = n1;

  for (let j = max - 1; j >= 0; j--) {
    const w = rW(sh, j);
    const wn = rW(sh, j + 1);
    const size = layerSize(sh, j);
    const c1 = new Float64Array(size);
    const c2 = new Float64Array(size);
    const cS = new Float64Array(size);
    const cZ = new Float64Array(size);
    // A = j: terminal
    for (let R = 0; R < w; R++) cZ[R] = 1;
    for (let A = j + 1; A <= max; A++) {
      for (let R = 0; R < w; R++) {
        const m = multiplierAt(cfg.multiplier, j + 1, R);
        let a1 = 0;
        let a2 = 0;
        let aS = 1;
        let aZ = 0;
        for (let gi = 0; gi < nG; gi++) {
          const g = gs[gi];
          const a = ga[gi];
          const A2 = A + a < max ? A + a : max;
          const R2 = perRet && a > 0 ? R + 1 : R;
          const ni = (A2 - j - 1) * wn + (perRet ? R2 : 0);
          const f1 = n1[ni];
          a1 += m * g.mu + g.p * f1;
          a2 += m * m * g.nu + 2 * m * g.mu * f1 + g.p * n2[ni];
          aS += g.p * nS[ni];
          aZ += (m === 0 ? g.p : g.z) * nZ[ni];
        }
        const idx = (A - j) * w + R;
        c1[idx] = a1;
        c2[idx] = a2;
        cS[idx] = aS;
        cZ[idx] = aZ;
      }
    }
    n1 = c1;
    n2 = c2;
    nS = cS;
    nZ = cZ;
    if (v1Layers) v1Layers[j] = c1;
  }
  // layer 0 has rW = 1 and index A − 0 = A
  return { v1: n1, v2: n2, spins: nS, z: nZ, v1Layers };
}

interface Forward {
  survival: Float64Array;
  multSurvival: Float64Array;
  spinsPmf: Float64Array;
  /** Σ_s π(s) m(s). */
  M: number;
  /** G_g = Σ_s π(s) E[F' | s'_g(s)] (when v1Layers were given). */
  G: Float64Array;
}

/** Forward DP over the visit probabilities π(s), from initial mass `init` (A → weight). */
function forward(red: Reduced, cfg: FreeSpinsConfig, sh: Shape, init: Map<number, number>, v1Layers?: Float64Array[]): Forward {
  const { max, perRet } = sh;
  const gs = red.groups;
  const nG = gs.length;
  const survival = new Float64Array(max + 1);
  const multSurvival = new Float64Array(max + 1);
  const spinsPmf = new Float64Array(max + 1);
  const G = new Float64Array(nG);
  let M = 0;
  let cur = new Float64Array(layerSize(sh, 0));
  for (const [A, wt] of init) cur[A] += wt;
  for (let j = 0; j <= max; j++) {
    const w = rW(sh, j);
    let mass = 0;
    for (let i = 0; i < cur.length; i++) mass += cur[i];
    survival[j] = mass; // P(N ≥ j): the mass that has played j spins, ended (A = j) or not
    if (j === max) {
      spinsPmf[max] += mass;
      break;
    }
    const wn = rW(sh, j + 1);
    const nxt = new Float64Array(layerSize(sh, j + 1));
    const nv1 = v1Layers ? v1Layers[j + 1] : undefined;
    for (let R = 0; R < w; R++) spinsPmf[j] += cur[R]; // A = j: ends with j spins
    for (let A = j + 1; A <= max; A++) {
      for (let R = 0; R < w; R++) {
        const p = cur[(A - j) * w + R];
        if (p === 0) continue;
        const m = multiplierAt(cfg.multiplier, j + 1, R);
        multSurvival[j + 1] += p * m;
        M += p * m;
        for (let gi = 0; gi < nG; gi++) {
          const g = gs[gi];
          const A2 = A + g.a < max ? A + g.a : max;
          const R2 = perRet && g.a > 0 ? R + 1 : R;
          const ni = (A2 - j - 1) * wn + (perRet ? R2 : 0);
          nxt[ni] += p * g.p;
          if (nv1) G[gi] += p * nv1[ni];
        }
      }
    }
    cur = nxt;
  }
  return { survival, multSurvival, spinsPmf, M, G };
}

function capInit(initialSpins: number, sh: Shape): number {
  if (!Number.isInteger(initialSpins) || initialSpins < 0) throw new Error(`initialSpins ${initialSpins} is not a non-negative integer`);
  return Math.min(initialSpins, sh.max);
}

function valueAt(b: Backward, A: number): FeatureValue {
  return { initialSpins: A, expectedSpins: b.spins[A], expectedWinCoins: b.v1[A], secondMomentCoins: b.v2[A], pZero: b.z[A] };
}

// --------------------------------------------------------------------------- public API

/** Exact E[spins], E[F], E[F²] and P(F = 0) of a feature that starts with `initialSpins` spins. */
export function featureValue(featureDist: SpinDist, cfg: FreeSpinsConfig, initialSpins: number): FeatureValue {
  return featureValues(featureDist, cfg, [initialSpins])[0];
}

/** featureValue for several initial awards from one DP pass. */
export function featureValues(featureDist: SpinDist, cfg: FreeSpinsConfig, initialSpins: number[]): FeatureValue[] {
  const sh = shapeOf(cfg);
  const b = backward(reduce(featureDist, cfg), cfg, sh, false);
  return initialSpins.map((n) => valueAt(b, capInit(n, sh)));
}

/** The spin-count law of a feature: P(N ≥ j), E[m_j 1{N ≥ j}], P(N = n) (forward DP). */
export function featureProfile(featureDist: SpinDist, cfg: FreeSpinsConfig, initialSpins: number): FeatureProfile {
  const sh = shapeOf(cfg);
  const red = reduce(featureDist, cfg);
  const A = capInit(initialSpins, sh);
  const f = forward(red, cfg, sh, new Map([[A, 1]]));
  return {
    initialSpins: A,
    survival: [...f.survival],
    multSurvival: [...f.multSurvival],
    spinsPmf: [...f.spinsPmf],
    expectedMultiplierSum: f.M,
  };
}

/** The feature priced against its base: RTP split, frequency, average win, buy price. */
export function freeSpinsAnalytics(args: FreeSpinsArgs): FreeSpinsAnalytics {
  const { baseRtp, baseTier, baseRtpSe, betCoins, scatterDist, scatterMin, featureDist, cfg } = args;
  if (!(betCoins > 0)) throw new Error(`betCoins ${betCoins} must be positive`);
  const featureBet = args.featureBetCoins ?? betCoins;
  const scale = betCoins / featureBet;
  const sh = shapeOf(cfg);
  const red = reduce(featureDist, cfg, scale);
  const featureMc = featureDist.tier !== 'exact';
  const wantSe = featureMc && featureDist.n !== undefined && featureDist.n > 0;
  const b = backward(red, cfg, sh, wantSe);

  const byK: FreeSpinsAnalytics['byK'] = [];
  let triggerP = 0;
  let sumF = 0;
  let sumF2 = 0;
  let sumS = 0;
  let sumZ = 0;
  const init = new Map<number, number>();
  for (let k = Math.max(0, scatterMin); k < scatterDist.length; k++) {
    const pK = scatterDist[k];
    const spins = capInit(award(cfg.awards, k), sh);
    const value = valueAt(b, spins);
    byK.push({ k, pK, spins, value });
    triggerP += pK;
    sumF += pK * value.expectedWinCoins;
    sumF2 += pK * value.secondMomentCoins;
    sumS += pK * value.expectedSpins;
    sumZ += pK * value.pZero;
    if (pK > 0) init.set(spins, (init.get(spins) ?? 0) + pK / betCoins);
  }
  const featureRtp = sumF / betCoins;
  const totalRtp = baseRtp + featureRtp;
  const eF = triggerP > 0 ? sumF / triggerP : NaN;
  const eF2 = triggerP > 0 ? sumF2 / triggerP : NaN;

  let featureRtpSe: number | undefined;
  if (wantSe && b.v1Layers) {
    // delta method (header): Var[M·W + G_{a(K)}] over the feature SpinDist, weights P(K=k)/bet
    const f = forward(red, cfg, sh, init, b.v1Layers);
    let mean = f.M * red.ew;
    let second = f.M * f.M * red.ew2;
    red.groups.forEach((g, gi) => {
      mean += g.p * f.G[gi];
      second += 2 * f.M * g.mu * f.G[gi] + g.p * f.G[gi] * f.G[gi];
    });
    featureRtpSe = Math.sqrt(Math.max(0, second - mean * mean) / (featureDist.n as number));
  }
  const tier: 'exact' | 'mc' = baseTier === 'mc' || featureMc ? 'mc' : 'exact';
  let rtpSe: number | undefined;
  if (tier === 'mc') {
    const baseOk = baseTier !== 'mc' || baseRtpSe !== undefined;
    const featOk = !featureMc || featureRtpSe !== undefined;
    if (baseOk && featOk) rtpSe = Math.sqrt((baseTier === 'mc' ? (baseRtpSe as number) ** 2 : 0) + (featureRtpSe ?? 0) ** 2);
  }

  return {
    tier,
    rtpSe,
    featureRtpSe,
    baseRtp,
    triggerP,
    byK,
    expectedSpinsGivenTrigger: triggerP > 0 ? sumS / triggerP : NaN,
    expectedWinGivenTriggerCoins: eF,
    sdWinGivenTriggerCoins: triggerP > 0 ? Math.sqrt(Math.max(0, eF2 - eF * eF)) : NaN,
    pZeroGivenTrigger: triggerP > 0 ? sumZ / triggerP : NaN,
    averageFeatureWinStakes: eF / betCoins,
    featureRtp,
    totalRtp,
    featureShare: totalRtp !== 0 ? featureRtp / totalRtp : 0,
    featureFrequency: triggerP > 0 ? 1 / triggerP : Infinity,
    buyPriceStakes: (targetRtp: number) => eF / (betCoins * targetRtp),
    perSpinEvCoins: totalRtp * betCoins,
    featureSpinEvCoins: red.ew,
  };
}

// --------------------------------------------------------------------------- the simulator

const cumCache = new WeakMap<SpinDist, Float64Array>();

function cumOf(d: SpinDist): Float64Array {
  let c = cumCache.get(d);
  if (!c) {
    checkDist(d);
    c = new Float64Array(d.p.length);
    let s = 0;
    for (let i = 0; i < d.p.length; i++) c[i] = s += d.p[i];
    cumCache.set(d, c);
  }
  return c;
}

/** One draw from a SpinDist: the entry index (cumulative probabilities + binary search). */
export function sampleSpinIndex(d: SpinDist, rng: () => number): number {
  const c = cumOf(d);
  const x = rng() * c[c.length - 1];
  let lo = 0;
  let hi = c.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (x < c[mid]) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/**
 * One feature played spin by spin under the same conventions as the algebra (header):
 * `coins` = Σ_j m_j·W_j in the feature spec's coins (no max-win cap), `retriggers` = R after the
 * last spin (every spin with award(retrigger, K) > 0, clipped or not).
 */
export function simulateFeature(
  featureDist: SpinDist,
  cfg: FreeSpinsConfig,
  initialSpins: number,
  rng: () => number,
): { spins: number; coins: number; retriggers: number } {
  const max = cfg.maxSpins;
  let awarded = Math.min(initialSpins, max);
  let j = 0;
  let R = 0;
  let coins = 0;
  while (j < awarded) {
    j++;
    const i = sampleSpinIndex(featureDist, rng);
    const m = multiplierAt(cfg.multiplier, j, R);
    const w = featureDist.coins[i];
    if (m !== 0 && w !== 0) coins += m * w;
    const a = award(cfg.retrigger, featureDist.k[i]);
    if (a > 0) {
      R++;
      awarded += Math.min(a, max - awarded);
    }
  }
  return { spins: j, coins, retriggers: R };
}
