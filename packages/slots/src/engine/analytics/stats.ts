// Player-experience statistics of a slot (docs/SLOTS.md §3): one row per measure, each with its
// value, its honesty tier (exact | exact_mixture | mc, mc always with se and n), its band, pass
// and the method that produced it. Pure (no Node APIs): `slots:eval` does the file IO.
//
// ------------------------------------------------------------------------------ the round
// A paid round is one base spin (coins B, visible scatters K) plus, when K ≥ trigger.scatter_min
// and the config has a feature, a free-spins feature F (config.ts law, priced by features.ts).
// The round pays X = min(B + F, cap), cap = ⌊maxWinStakes · bet⌋ coins (createSlot's rule: a base
// spin at or above the cap pays the cap and plays no feature, which is min(B + F, cap) again
// because F ≥ 0). "Spins" in §3 are paid rounds. Given K, the feature's F is independent of B
// (its spins are fresh draws), so every round statistic is a sum over the base SpinDist entries
// (B_i, K_i, p_i) of a function of B_i and the law of F given the award for K_i.
//
// ------------------------------------------------------------------------------ the methods
// 1 RTP. Uncapped: base exact RTP (exact.ts) + featureRtp (features.ts). Cap loss
//   E[(B + F − cap)+] / bet: exact over the base SpinDist without a feature; with one, the
//   entries that can't reach the cap through the feature are exact (B ≥ cap pays B − cap + E[F|k],
//   untriggered entries pay (B − cap)+) and only the triggered entries with B < cap are simulated
//   (the conditional Monte Carlo below). rtp = rtpUncapped − capLoss.
//   RULE (stated here, applied in `capLossAndReach`): when that Monte Carlo sees no round above
//   the cap (0 hits in n), its estimate is 0 with no observed effect; we then keep rtp at the
//   uncapped value and rtpTier at the uncapped tier, and record capLoss {value, tier 'mc', n,
//   hits: 0} so the reader sees that the cap's effect was looked for and not observed.
// 2 Hit rate P(X > 0) = P(B > 0) + Σ_k P(B = 0, K = k)·(1 − P(F = 0 | k)): exact.
// 3 Win > stake P(X > bet), 5 P(X ≥ 100·bet), 7 P(X ≥ cap): entries whose B already satisfies the
//   event are exact (F ≥ 0 only adds); the triggered entries that don't are simulated; tier mc
//   with the SE of the whole when any part is simulated.
// 4 SD per round in stakes, UNCAPPED: E[X²] = E[B²] + 2Σ_k E[B·1{K=k}]·E[F|k] + Σ_k P(K=k)·E[F²|k]
//   (B ⟂ F given K), exact second moments from features.ts. The cap only lowers it.
// 6 Feature frequency 1/P(trigger), feature share featureRtp / rtpUncapped, average feature win
//   E[F | trigger] / bet: exact from features.ts (uncapped).
// 7 Max win: the declared cap, and its reachability P(X ≥ cap): exact without a feature; with
//   one, an exact LOWER bound (below) plus the Monte-Carlo estimate when it sees hits.
// 8 Dry streak p95: rounds are iid with P(miss) = 1 − hit rate, so the law of the longest run of
//   non-paying rounds in 100 is an exact DP over the current run length; p95 = the smallest L
//   with P(longest ≤ L) ≥ 0.95. Tier = the hit rate's.
// 9 Session: rounds sampled from the distributions (below); median balance after 200 rounds at 1
//   stake from 100 stakes, with an order-statistic 95% CI, and P(bust). A player who can't cover
//   the next stake (balance < 1 stake) stops there: bust.
//
// Monte Carlo (3, 5, 7, 9, cap loss) samples rounds from the distributions themselves: the base
// entry by `sampleSpinIndex` on the base SpinDist (exact or sampled), the feature by
// `simulateFeature` on the feature SpinDist, the cap per round. That is a valid Monte Carlo of the
// round. Variance reduction (free): for 3, 5, 7 and the cap loss we simulate ONLY the triggered
// entries that the event still depends on (conditional sampling), and weight the conditional mean
// by their exact probability mass q: estimate = exact part + q · mean, SE = q · sd / √n.
// When the base SpinDist is itself sampled (tier mc, n_base), the base sampling error is added in
// quadrature: sd_p(g)/√n_base over the per-entry contributions g (the simulated entries take the
// pooled conditional mean, an approximation). Sampling error in a sampled FEATURE SpinDist is
// propagated for the RTP only (features.ts's delta method), not for the other rows.
//
// The max-win lower bound (7, with a feature). For a triggered entry with B < cap and initial
// award n0 = min(award(K), maxSpins), the first n0 free spins are always played, their W_j are
// iid draws of the feature SpinDist, every W ≥ 0, and spin j's multiplier is at least
// m_j⁰ = multiplierAt(j, 0) (per_spin and constant are deterministic; per_retrigger only grows
// with R because step ≥ 0). So F ≥ S = Σ_{j ≤ n0} m_j⁰·W_j, and S ≥ S_g = Σ_j g·⌊m_j⁰·W_j / g⌋ for a
// grid step g = ⌈cap / G⌉. S_g's law is an exact convolution on the grid 0..G (mass at or above
// G·g ≥ cap lumped in the top bin). Hence P(B + F ≥ cap) ≥ P(S_g ≥ cap − B) = P(S_g/g ≥ ⌈(cap−B)/g⌉),
// and P(X ≥ cap) ≥ P(B ≥ cap) + Σ_{triggered, B<cap} p_i · P(S_g ≥ cap − B_i). Retriggered spins are
// ignored, which only lowers the bound.

import type { RtpReport, SlotSpec } from '../types';
import { award, multiplierAt, VOLATILITY_BANDS, type FreeSpinsConfig, type SlotConfig, type Volatility } from './config';
import { distScatter, spinDistribution, type SpinDist } from './distribution';
import { exactRtp, scatterCountDist } from './exact';
import { featureValues, freeSpinsAnalytics, sampleSpinIndex, simulateFeature, type FreeSpinsAnalytics } from './features';
import { distRtpReport } from './mc';
import { buildModel } from './model';
import { mulberry32 } from './rng';

export type Tier = 'exact' | 'exact_mixture' | 'mc';

/** §3: the dry-streak p95 limit (longest losing run in 100 rounds) by declared volatility. */
export const DRY_STREAK_MAX: Record<Volatility, number> = { low: 12, medium: 20, high: 26, extreme: 32 };

export interface Band {
  lo: number;
  hi: number;
  text: string;
}

export interface StatRow {
  key: string;
  label: string;
  /** The measured value (fraction, stakes, N of 1-in-N, rounds), null when it doesn't apply. */
  value: number | null;
  display: string;
  tier: Tier | null;
  se?: number;
  n?: number;
  band: Band | null;
  /** null = informational (no band applies). */
  pass: boolean | null;
  /** Part of the §5 gate (RTP, hit rate, dry streak, max-win reachability). */
  gate: boolean;
  method: string;
}

export interface CapLoss {
  /** In RTP units (fraction of the stake). */
  value: number;
  tier: Tier;
  se?: number;
  n?: number;
  /** Simulated rounds above the cap (mc only). */
  hits?: number;
  /** The part computed exactly (entries that need no simulation). */
  exactPart: number;
  /** An exact upper bound on the cap loss (with a feature; see the reach bounds). */
  upperBound?: number;
  method: string;
}

export interface McEstimate {
  value: number;
  tier: Tier;
  se?: number;
  n?: number;
  hits?: number;
  /** The exactly known part of the value. */
  exactPart: number;
  /** Probability mass of the simulated (conditional) part. */
  mcMass: number;
  method: string;
}

export interface FeatureSummary {
  kind: 'free_spins';
  tier: Tier;
  triggerP: number;
  /** N of "1 in N" rounds. */
  frequency: number;
  featureRtp: number;
  featureRtpSe?: number;
  /** featureRtp / rtpUncapped. */
  share: number;
  expectedSpins: number;
  averageWinStakes: number;
  sdWinStakes: number;
  pZero: number;
  /** E[F | trigger] / (bet · targetRtp) when config.feature.buy, else null. */
  buyPriceStakes: number | null;
  byK: { k: number; pK: number; spins: number; expectedSpins: number; averageWinStakes: number; pZero: number }[];
}

export interface SessionStats {
  rounds: number;
  startStakes: number;
  sessions: number;
  medianStakes: number;
  ci95: [number, number];
  /** SE of the median read off the CI (width / 3.92). */
  seMedian: number;
  pBust: number;
  seBust: number;
  meanStakes: number;
  method: string;
}

export interface SlotStats {
  rows: StatRow[];
  betCoins: number;
  capCoins: number;
  maxWinStakes: number;
  volatilityDeclared: Volatility;
  /** The band word the measured SD falls in. */
  volatilityMeasured: Volatility;
  rtp: number;
  rtpTier: Tier;
  rtpSe?: number;
  rtpN?: number;
  rtpUncapped: number;
  rtpUncappedTier: Tier;
  rtpUncappedSe?: number;
  capLoss: CapLoss;
  baseRtp: number;
  baseRtpTier: Tier;
  baseRtpSe?: number;
  featureRtp: number;
  feature: FeatureSummary | null;
  hitRate: number;
  winOverStake: McEstimate;
  sdStakes: number;
  pWin100: McEstimate;
  reach: { lowerBound: number; upperBound: number; boundTier: Tier; mc: McEstimate | null; best: number; method: string };
  dryStreakP95: number;
  session: SessionStats;
  distributions: { base: { tier: 'exact' | 'mc'; n?: number; entries: number; method: string }; feature: { tier: 'exact' | 'mc'; n?: number; entries: number; method: string } | null };
  mc: { rounds: number; sessions: number; seed: number };
  bandsPassed: string[];
  bandsFailed: string[];
  gateFailed: string[];
}

export interface SlotStatsInput {
  spec: SlotSpec;
  featureSpec?: SlotSpec | null;
  config: SlotConfig;
  /** Base (coins, K) distribution. Default: spinDistribution(spec) (exact, else stop-sampled). */
  baseDist?: SpinDist;
  featureDist?: SpinDist;
  /** Base RTP. Default: exactRtp(spec) when the spec has a closed form, else the base SpinDist's mean (mc). */
  baseRtp?: RtpReport;
  mc?: { rounds?: number; sessions?: number; sessionRounds?: number; startStakes?: number; seed?: number };
}

// --------------------------------------------------------------------------- formatting

const pct = (x: number, d = 2) => `${(x * 100).toFixed(d)}%`;
const fmtNum = (x: number) => (Math.abs(x) >= 100 ? Math.round(x).toLocaleString('en-US') : x.toFixed(2).replace(/\.?0+$/, ''));
const oneIn = (p: number) => (p > 0 ? `1 in ${fmtNum(1 / p)}` : 'never');
const oneInSci = (p: number) => (p > 0 ? `1 in ${(1 / p).toExponential(2)}` : 'never');
const pctSe = (x: number) => `${Number((x * 100).toPrecision(2))}%`;
const tierTag = (t: Tier | null, se?: number, n?: number, fmt: (x: number) => string = pctSe) =>
  t === null ? '' : t === 'mc' ? ` mc${se !== undefined ? ` ± ${fmt(se)}` : ''}${n !== undefined ? `, n ${n.toLocaleString('en-US')}` : ''}` : ` ${t}`;

function hitRateBand(spec: SlotSpec): Band {
  const ev = spec.evaluation.kind;
  if (ev === 'cluster' || ev === 'scatter_pays') return { lo: 0.25, hi: 0.45, text: '25–45% (cluster/scatter pays)' };
  if (spec.geometry.cols === 3 && spec.geometry.rows.every((r) => r === 3)) return { lo: 0.1, hi: 0.3, text: '10–30% (classic 3×3)' };
  return { lo: 0.2, hi: 0.45, text: '20–45%' };
}

/** The volatility word the SD falls in (below the low band still reads 'low'). */
export function volatilityOf(sd: number): Volatility {
  if (sd >= VOLATILITY_BANDS.extreme[0]) return 'extreme';
  if (sd >= VOLATILITY_BANDS.high[0]) return 'high';
  if (sd >= VOLATILITY_BANDS.medium[0]) return 'medium';
  return 'low';
}

// --------------------------------------------------------------------------- dry streak

/** P(longest run of misses in `rounds` iid rounds ≤ L), P(miss) = q. */
export function longestRunCdf(q: number, rounds: number, L: number): number {
  let cur = new Float64Array(L + 1);
  cur[0] = 1;
  for (let t = 0; t < rounds; t++) {
    const nxt = new Float64Array(L + 1);
    let s = 0;
    for (let r = 0; r <= L; r++) s += cur[r];
    nxt[0] = s * (1 - q);
    for (let r = 0; r < L; r++) nxt[r + 1] = cur[r] * q;
    cur = nxt;
  }
  let s = 0;
  for (let r = 0; r <= L; r++) s += cur[r];
  return s;
}

/** The smallest L with P(longest run of misses in `rounds` ≤ L) ≥ level. */
export function dryStreakQuantile(hitRate: number, rounds = 100, level = 0.95): number {
  const q = 1 - hitRate;
  for (let L = 0; L <= rounds; L++) if (longestRunCdf(q, rounds, L) >= level - 1e-15) return L;
  return rounds;
}

// --------------------------------------------------------------------------- helpers

interface Entry {
  B: number;
  K: number;
  p: number;
  /** Initial free spins (0 = no feature). */
  spins: number;
  ef: number;
  ef2: number;
  pz: number;
}

function sub(d: SpinDist, idx: number[]): SpinDist {
  const tot = idx.reduce((a, i) => a + d.p[i], 0);
  return { coins: idx.map((i) => d.coins[i]), k: idx.map((i) => d.k[i]), p: idx.map((i) => d.p[i] / tot), tier: d.tier, method: 'conditional' };
}

/** Weighted mean and variance of g over the entries (for the base-sampling SE). */
function wVar(es: Entry[], g: (e: Entry, i: number) => number): { mean: number; v: number } {
  let m1 = 0;
  let m2 = 0;
  es.forEach((e, i) => {
    const x = g(e, i);
    m1 += e.p * x;
    m2 += e.p * x * x;
  });
  return { mean: m1, v: Math.max(0, m2 - m1 * m1) };
}

/** A seed for the j-th independent Monte-Carlo stream. */
const streamSeed = (seed: number, j: number) => (Math.imul(seed >>> 0, 2654435761) + Math.imul(j + 1, 1013904223)) >>> 0;

// --------------------------------------------------------------------------- the reach bounds

export interface TailBounds {
  /** Grid step in base coins and the top bin (= "≥ cap"). */
  g: number;
  top: number;
  /** Exact bounds on P(F ≥ t) for a feature that starts with n0 spins, threshold t in base coins (0 < t ≤ cap). */
  lower: (n0: number, t: number) => number;
  upper: (n0: number, t: number) => number;
}

/**
 * Exact lower and upper bounds on the feature's tail P(F ≥ t) for every start n0 and threshold t
 * (header, "max-win bounds"): the free-spins DP over (spins awarded A, spins played j) carrying
 * the remaining distance to the threshold on a grid of step g, with each spin's m_j·W rounded
 * DOWN (lower bound) or UP (upper bound) to the grid. Backward in j:
 *   V_j(A, r) = Σ_{(a, v)} P(a, v) · V_{j+1}(min(A + a, max), max(0, r − v)),  V(·, 0) = 1,
 *   V_A(A, r > 0) = 0 (ended),
 * with (a, v) = (award(retrigger, K), the rounded m_j·W / g) grouped over the feature SpinDist, so
 * V_0(n0, ⌈t/g⌉) bounds P(F ≥ t). per_retrigger multipliers use their extremes over R ∈ [0, j−1].
 */
export function featureTailBounds(featureDist: SpinDist, cfg: FreeSpinsConfig, scale: number, capCoins: number, G = 500): TailBounds {
  const g = Math.max(1, Math.ceil(capCoins / G));
  const top = Math.ceil(capCoins / g);
  const max = cfg.maxSpins;
  const perRet = cfg.multiplier.kind === 'per_retrigger';
  const aOf = featureDist.k.map((k) => award(cfg.retrigger, k));
  const run = (up: boolean): Float64Array => {
    const W = top + 1;
    // layer j holds A = j..max, row (A − j)
    let next = new Float64Array((max - max + 1) * W); // j = max: A = max, ended
    next[0] = 1;
    for (let j = max - 1; j >= 0; j--) {
      const m = multiplierAt(cfg.multiplier, j + 1, perRet && up ? j : 0);
      const groups = new Map<number, number>(); // key a * (top + 1) + v
      for (let i = 0; i < featureDist.p.length; i++) {
        const x = (m * featureDist.coins[i] * scale) / g;
        const v = Math.min(top, up ? Math.ceil(x) : Math.floor(x));
        const key = aOf[i] * W + v;
        groups.set(key, (groups.get(key) ?? 0) + featureDist.p[i]);
      }
      const gs = [...groups.entries()].map(([key, p]) => ({ a: Math.floor(key / W), v: key % W, p }));
      const cur = new Float64Array((max - j + 1) * W);
      // A = j: ended
      cur[0] = 1;
      for (let A = j + 1; A <= max; A++) {
        const row = (A - j) * W;
        cur[row] = 1;
        for (const { a, v, p } of gs) {
          const A2 = A + a < max ? A + a : max;
          const nrow = (A2 - j - 1) * W;
          const hi = v < top ? v : top;
          for (let r = 1; r <= hi; r++) cur[row + r] += p;
          for (let r = hi + 1; r <= top; r++) cur[row + r] += p * next[nrow + r - v];
        }
      }
      next = cur;
    }
    return next; // layer 0: row A
  };
  const lo = run(false);
  const hi = run(true);
  const W = top + 1;
  const at = (arr: Float64Array, n0: number, t: number) => {
    const A = Math.min(Math.max(0, n0), max);
    const u = Math.min(top, Math.max(0, Math.ceil(t / g)));
    return Math.min(1, arr[A * W + u]);
  };
  return { g, top, lower: (n0, t) => at(lo, n0, t), upper: (n0, t) => at(hi, n0, t) };
}

// --------------------------------------------------------------------------- main

export function computeSlotStats(input: SlotStatsInput): SlotStats {
  const { spec, config } = input;
  const bet = spec.bet.coins;
  const capCoins = Math.floor(config.maxWinStakes * bet);
  const mcRounds = input.mc?.rounds ?? 200_000;
  const nSessions = input.mc?.sessions ?? 20_000;
  const sessionRounds = input.mc?.sessionRounds ?? 200;
  const startStakes = input.mc?.startStakes ?? 100;
  const seed = (input.mc?.seed ?? 20261116) >>> 0;

  const model = buildModel(spec);
  const closed = model.closedFormRefusal === null;
  const baseDist = input.baseDist ?? spinDistribution(spec);
  const baseMc = baseDist.tier === 'mc';
  const nBase = baseDist.n ?? 0;
  if (baseMc && !(nBase > 0)) throw new Error('a sampled base SpinDist needs its sample size n');

  // base RTP and the scatter law: exact from the closed forms whenever the spec has one (even
  // when the joint distribution had to be sampled), else from the sampled distribution
  let baseRtp: RtpReport;
  if (input.baseRtp) baseRtp = input.baseRtp;
  else if (closed) {
    const ex = exactRtp(spec);
    baseRtp = { rtp: ex.rtp, tier: ex.tier };
  } else baseRtp = distRtpReport(baseDist, bet);
  const exactTier: Tier = baseRtp.tier === 'exact_mixture' ? 'exact_mixture' : 'exact';
  const scatterDist = closed ? scatterCountDist(spec) : distScatter(baseDist);
  const scatterExact = closed;

  // ---- the feature
  const cfg = config.feature ?? null;
  let fa: FreeSpinsAnalytics | null = null;
  let featureDist: SpinDist | null = null;
  let scale = 1;
  let smin = Infinity;
  if (cfg) {
    if (!input.featureSpec && !input.featureDist) throw new Error('config.feature is set: pass featureSpec (or featureDist)');
    featureDist = input.featureDist ?? spinDistribution(input.featureSpec as SlotSpec);
    if (featureDist.tier === 'mc' && !(featureDist.n! > 0)) throw new Error('a sampled feature SpinDist needs its sample size n');
    const fBet = input.featureSpec?.bet.coins ?? bet;
    scale = bet / fBet;
    if (spec.trigger?.scatter_min == null) throw new Error('config.feature is set but the base spec has no trigger.scatter_min');
    smin = Number(spec.trigger.scatter_min);
    fa = freeSpinsAnalytics({
      baseRtp: baseRtp.rtp,
      baseTier: baseRtp.tier,
      baseRtpSe: baseRtp.se,
      betCoins: bet,
      featureBetCoins: fBet,
      scatterDist,
      scatterMin: smin,
      featureDist,
      cfg,
    });
  }
  const featureMc = featureDist?.tier === 'mc';
  /** Tier of a quantity read off the joint distributions with no simulation. */
  const jointTier: Tier = baseMc || featureMc ? 'mc' : exactTier;

  // per-entry feature moments (base coins), by initial award
  const spinsOf = (k: number) => (cfg && k >= smin ? Math.min(award(cfg.awards, k), cfg.maxSpins) : 0);
  const awardsNeeded = new Set<number>();
  for (let i = 0; i < baseDist.p.length; i++) awardsNeeded.add(spinsOf(baseDist.k[i]));
  const fvBySpins = new Map<number, { ef: number; ef2: number; pz: number }>();
  if (cfg && featureDist) {
    const list = [...awardsNeeded].filter((s) => s > 0);
    const vals = featureValues(featureDist, cfg, list);
    list.forEach((s, j) => fvBySpins.set(s, { ef: vals[j].expectedWinCoins * scale, ef2: vals[j].secondMomentCoins * scale * scale, pz: vals[j].pZero }));
  }
  const es: Entry[] = [];
  for (let i = 0; i < baseDist.p.length; i++) {
    const spins = spinsOf(baseDist.k[i]);
    const fv = spins > 0 ? fvBySpins.get(spins)! : { ef: 0, ef2: 0, pz: 1 };
    es.push({ B: baseDist.coins[i], K: baseDist.k[i], p: baseDist.p[i], spins, ef: fv.ef, ef2: fv.ef2, pz: fv.pz });
  }
  const trig = (e: Entry) => e.spins > 0;
  const baseSe = (v: number) => (baseMc ? Math.sqrt(v / nBase) : 0);

  // ---- RTP (uncapped)
  const featureRtp = fa ? fa.featureRtp : 0;
  const rtpUncapped = baseRtp.rtp + featureRtp;
  let rtpUncappedTier: Tier = baseRtp.tier === 'mc' || featureMc ? 'mc' : exactTier;
  let rtpUncappedSe: number | undefined;
  if (rtpUncappedTier === 'mc') {
    let seBase2 = 0;
    if (baseRtp.tier === 'mc') {
      // base RTP and the trigger law both come from the base sample: the SE of the round mean over it
      const h = wVar(es, (e) => (e.B + (trig(e) ? e.ef : 0)) / bet);
      seBase2 = h.v / (baseRtp.n ?? nBase);
    }
    rtpUncappedSe = Math.sqrt(seBase2 + (fa?.featureRtpSe ?? 0) ** 2);
  }
  if (!Number.isFinite(rtpUncapped)) rtpUncappedTier = 'mc';

  // ---- hit rate (2)
  const hitG = (e: Entry) => (e.B > 0 ? 1 : trig(e) ? 1 - e.pz : 0);
  const hitW = wVar(es, hitG);
  const hitRate = hitW.mean;
  const hitTier = jointTier;
  const hitSe = baseMc ? baseSe(hitW.v) : undefined;

  // ---- SD (4), uncapped
  const h1 = (e: Entry) => e.B + (trig(e) ? e.ef : 0);
  const h2 = (e: Entry) => e.B * e.B + (trig(e) ? 2 * e.B * e.ef + e.ef2 : 0);
  let m1 = 0;
  let m2 = 0;
  for (const e of es) {
    m1 += e.p * h1(e);
    m2 += e.p * h2(e);
  }
  const sdCoins = Math.sqrt(Math.max(0, m2 - m1 * m1));
  const sdStakes = sdCoins / bet;
  let sdSe: number | undefined;
  if (baseMc && sdCoins > 0) sdSe = baseSe(wVar(es, (e) => (h2(e) - 2 * m1 * h1(e)) / (2 * sdCoins)).v) / bet;

  // ---- the conditional Monte Carlo of the triggered entries
  let streams = 0;
  const conditional = (
    pop: (e: Entry) => boolean,
    fns: ((x: number) => number)[],
  ): { mass: number; n: number; mean: number[]; sd: number[] } | null => {
    const idx: number[] = [];
    let mass = 0;
    es.forEach((e, i) => {
      if (trig(e) && pop(e)) {
        idx.push(i);
        mass += e.p;
      }
    });
    const stream = streams++;
    if (!idx.length || mass === 0 || !cfg || !featureDist) return null;
    const d = sub(baseDist, idx);
    const rng = mulberry32(streamSeed(seed, stream));
    const s1 = new Float64Array(fns.length);
    const s2 = new Float64Array(fns.length);
    for (let r = 0; r < mcRounds; r++) {
      const e = es[idx[sampleSpinIndex(d, rng)]];
      const F = simulateFeature(featureDist, cfg, e.spins, rng).coins * scale;
      const x = e.B + F;
      for (let f = 0; f < fns.length; f++) {
        const y = fns[f](x);
        s1[f] += y;
        s2[f] += y * y;
      }
    }
    const n = mcRounds;
    const mean = [...s1].map((s) => s / n);
    const sd = mean.map((mu, f) => Math.sqrt(Math.max(0, (s2[f] / n - mu * mu) * (n / Math.max(1, n - 1)))));
    return { mass, n, mean, sd };
  };

  /** P(B + F ⋈ θ) with ⋈ = '>' (strict) or '≥', the round capped at the cap. */
  const tail = (theta: number, strict: boolean, label: string): McEstimate => {
    const pred = (x: number) => (strict ? x > theta : x >= theta);
    if (!pred(capCoins)) {
      streams++;
      return { value: 0, tier: exactTier, exactPart: 0, mcMass: 0, method: `the cap (${fmtNum(config.maxWinStakes)}×) is below ${label}: impossible` };
    }
    const exact = wVar(es, (e) => (pred(e.B) ? 1 : 0));
    const sim = conditional((e) => !pred(e.B), [(x) => (pred(x) ? 1 : 0)]);
    if (!sim) {
      return {
        value: exact.mean,
        tier: jointTier,
        se: baseMc ? baseSe(exact.v) : undefined,
        n: baseMc ? nBase : undefined,
        exactPart: exact.mean,
        mcMass: 0,
        method: `exact over the base distribution: every round that can reach ${label} does so on the base spin (F ≥ 0)`,
      };
    }
    const value = exact.mean + sim.mass * sim.mean[0];
    const seInner = (sim.mass * sim.sd[0]) / Math.sqrt(sim.n);
    const g = wVar(es, (e) => (pred(e.B) ? 1 : trig(e) ? sim.mean[0] : 0));
    const se = Math.sqrt(seInner ** 2 + baseSe(g.v) ** 2);
    const hits = Math.round(sim.mean[0] * sim.n);
    return {
      value,
      tier: 'mc',
      se,
      n: sim.n,
      hits,
      exactPart: exact.mean,
      mcMass: sim.mass,
      method:
        `exact part ${exact.mean.toExponential(4)} (base spin already ${strict ? '>' : '≥'} ${label}) + Monte Carlo of the ` +
        `${sim.mass.toExponential(3)} mass of triggered rounds that still depend on the feature: ${sim.n.toLocaleString('en-US')} rounds ` +
        `sampled from the ${baseDist.tier} base and ${featureDist!.tier} feature distributions (features simulated spin by spin), weighted by that exact mass`,
    };
  };

  // ---- win > stake (3), P(≥ 100×) (5)
  const winOverStake = tail(bet, true, 'the stake');
  const pWin100 = tail(100 * bet, false, '100×');

  // ---- cap loss (1) and reachability (7)
  let capLoss: CapLoss;
  let reachMc: McEstimate | null = null;
  let lowerBound: number;
  let upperBound: number;
  let lowerBoundTier: Tier = jointTier;
  let reachMethod: string;
  {
    // exact part: untriggered (B − cap)+, triggered with B ≥ cap: B − cap + E[F|k]
    const lossG = (e: Entry) => (e.B >= capCoins ? e.B - capCoins + (trig(e) ? e.ef : 0) : 0);
    const exactLoss = wVar(es, lossG);
    const exactReach = wVar(es, (e) => (e.B >= capCoins ? 1 : 0));
    const sim = conditional((e) => e.B < capCoins, [(x) => Math.max(0, x - capCoins), (x) => (x >= capCoins ? 1 : 0), (x) => (x > capCoins ? 1 : 0)]);
    if (!sim) {
      const anyAbove = es.some((e) => e.B > capCoins && e.p > 0);
      capLoss = {
        value: exactLoss.mean / bet,
        tier: jointTier,
        se: baseMc ? baseSe(exactLoss.v) / bet : undefined,
        n: baseMc ? nBase : undefined,
        hits: baseMc ? Math.round(nBase * es.reduce((a, e) => a + (e.B > capCoins ? e.p : 0), 0)) : undefined,
        exactPart: exactLoss.mean / bet,
        method: cfg
          ? 'exact over the base distribution (no triggered round below the cap)'
          : `exact over the base distribution: E[(B − cap)+] / bet${anyAbove ? '' : ' (no base spin exceeds the cap)'}`,
      };
      lowerBound = exactReach.mean;
      upperBound = exactReach.mean;
      reachMethod = cfg ? 'exact: P(B ≥ cap) over the base distribution' : 'exact: P(B ≥ cap) over the base distribution (no feature)';
      if (baseMc) lowerBoundTier = 'mc';
    } else {
      const hitsAbove = Math.round(sim.mean[2] * sim.n);
      const lossMean = exactLoss.mean + sim.mass * sim.mean[0];
      const seInner = (sim.mass * sim.sd[0]) / Math.sqrt(sim.n);
      const g = wVar(es, (e) => (e.B >= capCoins ? lossG(e) : trig(e) ? sim.mean[0] : 0));
      const se = Math.sqrt(seInner ** 2 + baseSe(g.v) ** 2) / bet;
      capLoss = {
        value: lossMean / bet,
        tier: 'mc',
        se,
        n: sim.n,
        hits: hitsAbove,
        exactPart: exactLoss.mean / bet,
        method:
          `E[(B + F − cap)+] / bet: exact over entries that need no simulation + Monte Carlo of the triggered rounds with B < cap ` +
          `(mass ${sim.mass.toExponential(3)}, ${sim.n.toLocaleString('en-US')} rounds sampled from the exact distributions, ${hitsAbove} above the cap)`,
      };
      // reachability: exact bounds from the feature tail DP, plus the MC when it sees hits
      const pop = es.filter((e) => trig(e) && e.B < capCoins);
      const boundsAt = (G: number) => {
        const tb = featureTailBounds(featureDist!, cfg!, scale, capCoins, G);
        let lo = 0;
        let up = 0;
        let lossUp = 0;
        for (const e of pop) {
          const t = capCoins - e.B;
          lo += e.p * tb.lower(e.spins, t);
          const u = tb.upper(e.spins, t);
          up += e.p * u;
          // E[(B + F − cap)+] ≤ E[(B + F)·1{B + F ≥ cap}] ≤ √(E[(B + F)²] · P(B + F ≥ cap))  (Cauchy–Schwarz)
          lossUp += e.p * Math.sqrt((e.B * e.B + 2 * e.B * e.ef + e.ef2) * u);
        }
        return { tb, lo, up, lossUp, G };
      };
      let bd = boundsAt(500);
      if (exactReach.mean + bd.lo <= 1e-9 && exactReach.mean + bd.up > 1e-9) bd = boundsAt(2000); // inconclusive: refine the grid
      lowerBound = exactReach.mean + bd.lo;
      upperBound = exactReach.mean + bd.up;
      capLoss.upperBound = (exactLoss.mean + bd.lossUp) / bet;
      capLoss.method += `; exact upper bound ${pct(capLoss.upperBound, 5)} (Cauchy–Schwarz with the exact second moments and the reach upper bound)`;
      lowerBoundTier = jointTier;
      const reachHits = Math.round(sim.mean[1] * sim.n);
      const reachVal = exactReach.mean + sim.mass * sim.mean[1];
      reachMc = {
        value: reachVal,
        tier: 'mc',
        se: (sim.mass * sim.sd[1]) / Math.sqrt(sim.n),
        n: sim.n,
        hits: reachHits,
        exactPart: exactReach.mean,
        mcMass: sim.mass,
        method: `P(B ≥ cap) exact + Monte Carlo of the triggered rounds with B < cap (${reachHits} of ${sim.n.toLocaleString('en-US')} reached the cap)`,
      };
      reachMethod =
        `exact bounds: P(B ≥ cap) + Σ over triggered entries with B < cap of P(F ≥ cap − B), bounded below and above by the free-spins DP ` +
        `(retriggers and multipliers included) with each spin's m·W rounded down / up to a ${fmtNum(bd.tb.g / bet)}-stake grid (${bd.G} bins up to the cap)`;
    }
  }
  // RULE (header, method 1): 0 simulated rounds above the cap → no observed effect: rtp = uncapped, tier kept
  const capObserved = !(capLoss.tier === 'mc' && capLoss.hits === 0);
  const rtp = capObserved ? rtpUncapped - capLoss.value : rtpUncapped - capLoss.exactPart;
  let rtpTier: Tier = rtpUncappedTier;
  if (capObserved && capLoss.tier === 'mc') rtpTier = 'mc';
  let rtpSe: number | undefined;
  if (rtpTier === 'mc') rtpSe = Math.sqrt((rtpUncappedSe ?? 0) ** 2 + (capObserved ? capLoss.se ?? 0 : 0) ** 2);
  const rtpN = rtpTier === 'mc' ? (baseRtp.tier === 'mc' ? baseRtp.n ?? nBase : featureMc ? featureDist!.n : capLoss.n) : undefined;

  // ---- dry streak (8)
  const dry = dryStreakQuantile(hitRate);

  // ---- session (9)
  const session = (() => {
    const rng = mulberry32(streamSeed(seed, 1000));
    const finals = new Float64Array(nSessions);
    let bust = 0;
    let sum = 0;
    for (let s = 0; s < nSessions; s++) {
      let bal = startStakes * bet;
      let r = 0;
      for (; r < sessionRounds; r++) {
        if (bal < bet) break;
        bal -= bet;
        const e = es[sampleSpinIndex(baseDist, rng)];
        let x = e.B;
        if (x < capCoins && trig(e)) x += simulateFeature(featureDist!, cfg!, e.spins, rng).coins * scale;
        bal += Math.min(x, capCoins);
      }
      if (r < sessionRounds) bust++;
      finals[s] = bal / bet;
      sum += bal / bet;
    }
    const sorted = [...finals].sort((a, b) => a - b);
    const n = nSessions;
    const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
    // distribution-free 95% CI of the median: order statistics j..k with j, k = n/2 ∓ 1.96·√n/2 (1-based)
    const half = 0.98 * Math.sqrt(n);
    const j = Math.max(1, Math.floor(n / 2 - half));
    const k = Math.min(n, Math.ceil(n / 2 + half + 1));
    const ci: [number, number] = [sorted[j - 1], sorted[k - 1]];
    const pBust = bust / n;
    return {
      rounds: sessionRounds,
      startStakes,
      sessions: n,
      medianStakes: median,
      ci95: ci,
      seMedian: (ci[1] - ci[0]) / 3.92,
      pBust,
      seBust: Math.sqrt((pBust * (1 - pBust)) / n),
      meanStakes: sum / n,
      method:
        `${n.toLocaleString('en-US')} sessions of ${sessionRounds} rounds at 1 stake from ${startStakes} stakes, rounds sampled from the ${baseDist.tier} base ` +
        `${featureDist ? `and ${featureDist.tier} feature ` : ''}distributions, capped per round; a player whose balance is below 1 stake stops (bust); ` +
        'median with a distribution-free order-statistic 95% CI',
    } satisfies SessionStats;
  })();

  // ---- the feature summary (6)
  let feature: FeatureSummary | null = null;
  if (fa && cfg) {
    const fTier: Tier = fa.tier === 'mc' ? 'mc' : exactTier;
    feature = {
      kind: 'free_spins',
      tier: fTier,
      triggerP: fa.triggerP,
      frequency: fa.featureFrequency,
      featureRtp: fa.featureRtp,
      featureRtpSe: fa.featureRtpSe,
      share: rtpUncapped !== 0 ? fa.featureRtp / rtpUncapped : 0,
      expectedSpins: fa.expectedSpinsGivenTrigger,
      averageWinStakes: fa.averageFeatureWinStakes,
      sdWinStakes: fa.sdWinGivenTriggerCoins / bet,
      pZero: fa.pZeroGivenTrigger,
      buyPriceStakes: cfg.buy ? fa.buyPriceStakes(config.targetRtp) : null,
      byK: fa.byK.map((r) => ({
        k: r.k,
        pK: r.pK,
        spins: r.spins,
        expectedSpins: r.value.expectedSpins,
        averageWinStakes: r.value.expectedWinCoins / bet,
        pZero: r.value.pZero,
      })),
    };
  }

  // ---- the rows
  const rows: StatRow[] = [];
  const declared = config.volatility;
  const measured = volatilityOf(sdStakes);
  const inBand = (x: number, b: Band) => x >= b.lo - 1e-12 && x <= b.hi + 1e-12;

  {
    const band: Band = { lo: 0.955, hi: 0.965, text: '95.5–96.5%' };
    const split = `base ${pct(baseRtp.rtp, 3)} + feature ${pct(featureRtp, 3)} − cap ${pct(capLoss.value, 4)}`;
    rows.push({
      key: 'rtp',
      label: 'RTP',
      value: rtp,
      display: `${pct(rtp, 3)}${tierTag(rtpTier, rtpSe, rtpN)}`,
      tier: rtpTier,
      se: rtpSe,
      n: rtpN,
      band,
      pass: inBand(rtp, band),
      gate: true,
      method:
        `uncapped ${pct(rtpUncapped, 4)} (${rtpUncappedTier}${rtpUncappedSe !== undefined ? ` ± ${pct(rtpUncappedSe, 4)}` : ''}) = ${split}. ` +
        `Base: ${baseRtp.tier === 'mc' ? `Monte Carlo (n ${baseRtp.n})` : `${baseRtp.tier} closed form (exact.ts)`}; ` +
        `feature: exact free-spins algebra (features.ts) over the ${featureDist?.tier ?? '—'} feature distribution. ` +
        `Cap loss: ${capLoss.method}.` +
        (capObserved ? '' : ' No simulated round exceeded the cap, so the cap loss is reported as not observed and the RTP keeps the uncapped value and tier.'),
    });
  }
  {
    const band = hitRateBand(spec);
    rows.push({
      key: 'hitRate',
      label: 'Hit rate',
      value: hitRate,
      display: `${pct(hitRate, 2)}${tierTag(hitTier, hitSe, baseMc ? nBase : undefined)}`,
      tier: hitTier,
      se: hitSe,
      n: baseMc ? nBase : undefined,
      band,
      pass: inBand(hitRate, band),
      gate: true,
      method: 'P(B > 0) + Σ_k P(B = 0, K = k)·(1 − P(F = 0 | k)) over the base distribution, P(F = 0) from the feature DP',
    });
  }
  {
    const band: Band = { lo: 0.08, hi: 0.25, text: '8–25%' };
    rows.push({
      key: 'winOverStake',
      label: 'Win > stake rate',
      value: winOverStake.value,
      display: `${pct(winOverStake.value, 2)}${tierTag(winOverStake.tier, winOverStake.se, winOverStake.n)}`,
      tier: winOverStake.tier,
      se: winOverStake.se,
      n: winOverStake.n,
      band,
      pass: inBand(winOverStake.value, band),
      gate: false,
      method: `P(X > stake): ${winOverStake.method}`,
    });
  }
  {
    const [lo, hi] = VOLATILITY_BANDS[declared];
    const band: Band = { lo, hi, text: `${lo}–${Number.isFinite(hi) ? hi : '∞'} (declared ${declared})` };
    rows.push({
      key: 'volatility',
      label: 'Volatility (SD per round, stakes)',
      value: sdStakes,
      display: `${sdStakes.toFixed(2)} (${measured})${tierTag(jointTier, sdSe, baseMc ? nBase : undefined, (x) => x.toFixed(3))}`,
      tier: jointTier,
      se: sdSe,
      n: baseMc ? nBase : undefined,
      band,
      pass: inBand(sdStakes, band),
      gate: false,
      method: 'UNCAPPED: √(E[X²] − E[X]²), E[X²] = E[B²] + 2Σ_k E[B·1{K=k}]·E[F|k] + Σ_k P(K=k)·E[F²|k] (B ⟂ F given K), exact moments from the feature DP; the cap only lowers it',
    });
  }
  if (feature) {
    const fb: Band = { lo: 80, hi: 300, text: '1 in 80–300 (free spins)' };
    const fTier: Tier = scatterExact ? exactTier : 'mc';
    const pSe = scatterExact ? undefined : Math.sqrt((feature.triggerP * (1 - feature.triggerP)) / nBase);
    rows.push({
      key: 'featureFrequency',
      label: 'Feature frequency',
      value: feature.frequency,
      display: `1 in ${fmtNum(feature.frequency)}${tierTag(fTier, pSe !== undefined ? pSe / feature.triggerP ** 2 : undefined, scatterExact ? undefined : nBase, fmtNum)}`,
      tier: fTier,
      se: pSe !== undefined ? pSe / feature.triggerP ** 2 : undefined,
      n: scatterExact ? undefined : nBase,
      band: fb,
      pass: inBand(feature.frequency, fb),
      gate: false,
      method: `1 / P(K ≥ ${smin}), P from ${scatterExact ? 'the exact scatter-count convolution' : 'the sampled base distribution'}`,
    });
    const sb: Band = { lo: 0.25, hi: 0.55, text: '25–55%' };
    rows.push({
      key: 'featureShare',
      label: 'Feature share of RTP',
      value: feature.share,
      display: `${pct(feature.share, 1)}${tierTag(feature.tier)}`,
      tier: feature.tier,
      band: sb,
      pass: inBand(feature.share, sb),
      gate: false,
      method: 'featureRtp / rtpUncapped (exact free-spins algebra)',
    });
    const ab: Band = { lo: 15, hi: 150, text: '15–150×' };
    rows.push({
      key: 'averageFeatureWin',
      label: 'Average feature win',
      value: feature.averageWinStakes,
      display: `${fmtNum(feature.averageWinStakes)}×${tierTag(feature.tier)}`,
      tier: feature.tier,
      band: ab,
      pass: inBand(feature.averageWinStakes, ab),
      gate: false,
      method: 'E[F | trigger] / bet, uncapped (exact free-spins algebra)',
    });
  } else {
    rows.push({ key: 'featureFrequency', label: 'Feature frequency', value: null, display: '— (no feature)', tier: null, band: null, pass: null, gate: false, method: 'pure base game' });
    rows.push({
      key: 'featureShare',
      label: 'Feature share of RTP',
      value: 0,
      display: `0% ${exactTier}`,
      tier: exactTier,
      band: { lo: 0, hi: 0, text: '0% (pure base game)' },
      pass: true,
      gate: false,
      method: 'pure base game',
    });
    rows.push({ key: 'averageFeatureWin', label: 'Average feature win', value: null, display: '— (no feature)', tier: null, band: null, pass: null, gate: false, method: 'pure base game' });
  }
  {
    let band: Band | null = null;
    let pass: boolean | null = null;
    if (declared === 'low') {
      band = { lo: 0, hi: 1 / 5000, text: '1 in 5,000 or rarer (low)' };
      pass = pWin100.value <= band.hi + 1e-15;
    } else if (declared === 'high' || declared === 'extreme') {
      band = { lo: 1 / 1500, hi: 1, text: `1 in 1,500 or more often (${declared})` };
      pass = pWin100.value >= band.lo - 1e-15;
    }
    rows.push({
      key: 'pWin100',
      label: 'P(win ≥ 100×) per round',
      value: pWin100.value,
      display:
        pWin100.value === 0 && pWin100.tier === 'mc'
          ? `none in ${pWin100.n?.toLocaleString('en-US')} sampled (mc)`
          : pWin100.value === 0
            ? `never ${pWin100.tier}`
            : `${oneIn(pWin100.value)} (p ${pWin100.value.toExponential(3)}${tierTag(pWin100.tier, pWin100.se, pWin100.n, (x) => x.toExponential(1))})`,
      tier: pWin100.tier,
      se: pWin100.se,
      n: pWin100.n,
      band: band ?? { lo: 0, hi: 1, text: 'medium: informational' },
      pass,
      gate: false,
      method: `P(X ≥ 100·stake): ${pWin100.method}`,
    });
  }
  {
    const band: Band = { lo: 1000, hi: 25000, text: '1,000–25,000×' };
    rows.push({
      key: 'maxWin',
      label: 'Max win (declared cap)',
      value: config.maxWinStakes,
      display: `${fmtNum(config.maxWinStakes)}×`,
      tier: 'exact',
      band,
      pass: inBand(config.maxWinStakes, band),
      gate: false,
      method: 'slot.config.json maxWinStakes; a round that reaches it ends and pays it',
    });
    const best = reachMc && (reachMc.hits ?? 0) > 0 ? Math.max(lowerBound, reachMc.value) : lowerBound;
    const reachFromMc = !!reachMc && (reachMc.hits ?? 0) > 0 && reachMc.value > lowerBound;
    const reachTier: Tier = reachFromMc ? 'mc' : lowerBoundTier;
    const isBound = upperBound > lowerBound;
    rows.push({
      key: 'maxWinReach',
      label: 'P(reaching the max win) per round',
      value: best,
      display:
        (isBound
          ? `1 in ${(1 / upperBound).toExponential(2)} to ${lowerBound > 0 ? (1 / lowerBound).toExponential(2) : '∞'} (${lowerBoundTier} bounds)`
          : lowerBound === 0 && lowerBoundTier === 'mc'
            ? `none in ${nBase.toLocaleString('en-US')} sampled base spins (mc; no evidence the cap is reachable)`
            : `${oneInSci(lowerBound)} ${lowerBoundTier}`) +
        (reachMc ? `; MC ${reachMc.hits ? oneInSci(reachMc.value) : '0'} (${reachMc.hits} hits / ${reachMc.n?.toLocaleString('en-US')})` : ''),
      tier: reachTier,
      se: reachTier !== 'mc' ? undefined : reachFromMc ? reachMc!.se : Math.sqrt((best * (1 - best)) / nBase),
      n: reachTier !== 'mc' ? undefined : reachFromMc ? reachMc!.n : nBase,
      band: { lo: 1e-9, hi: 1, text: '> 1 in 10⁹' },
      // pass on the best evidence: the exact lower bound, or the MC estimate when it saw hits
      pass: best > 1e-9,
      gate: true,
      method: reachMethod + (reachMc ? `; ${reachMc.method}` : ''),
    });
  }
  {
    const max = DRY_STREAK_MAX[declared];
    rows.push({
      key: 'dryStreakP95',
      label: 'Dry streak p95 (longest miss run in 100)',
      value: dry,
      display: `${dry} rounds${tierTag(hitTier)}`,
      tier: hitTier,
      se: undefined,
      n: hitTier === 'mc' ? nBase : undefined,
      band: { lo: 0, hi: max, text: `≤ ${max} (${declared})` },
      pass: dry <= max,
      gate: true,
      method: `exact DP over the current miss run, rounds iid with P(miss) = 1 − hit rate = ${(1 - hitRate).toFixed(6)}; p95 = smallest L with P(longest ≤ L) ≥ 0.95`,
    });
  }
  rows.push({
    key: 'session',
    label: `Session (median balance after ${sessionRounds} rounds from ${startStakes})`,
    value: session.medianStakes,
    display: `${session.medianStakes.toFixed(1)} (95% CI ${session.ci95[0].toFixed(1)}–${session.ci95[1].toFixed(1)}), bust ${pct(session.pBust, 1)}, mc n ${session.sessions.toLocaleString('en-US')}`,
    tier: 'mc',
    se: session.seMedian,
    n: session.sessions,
    band: null,
    pass: null,
    gate: false,
    method: session.method,
  });

  const bandsPassed = rows.filter((r) => r.pass === true).map((r) => r.key);
  const bandsFailed = rows.filter((r) => r.pass === false).map((r) => r.key);
  const gateFailed = rows.filter((r) => r.gate && r.pass === false).map((r) => r.key);

  const summary = (d: SpinDist) => ({ tier: d.tier, n: d.n, entries: d.p.length, method: d.method });
  return {
    rows,
    betCoins: bet,
    capCoins,
    maxWinStakes: config.maxWinStakes,
    volatilityDeclared: declared,
    volatilityMeasured: measured,
    rtp,
    rtpTier,
    rtpSe,
    rtpN,
    rtpUncapped,
    rtpUncappedTier,
    rtpUncappedSe,
    capLoss,
    baseRtp: baseRtp.rtp,
    baseRtpTier: baseRtp.tier,
    baseRtpSe: baseRtp.se,
    featureRtp,
    feature,
    hitRate,
    winOverStake,
    sdStakes,
    pWin100,
    reach: {
      lowerBound,
      upperBound,
      boundTier: lowerBoundTier,
      mc: reachMc,
      best: rows.find((r) => r.key === 'maxWinReach')!.value as number,
      method: reachMethod,
    },
    dryStreakP95: dry,
    session,
    distributions: { base: summary(baseDist), feature: featureDist ? summary(featureDist) : null },
    mc: { rounds: mcRounds, sessions: nSessions, seed },
    bandsPassed,
    bandsFailed,
    gateFailed,
  };
}
