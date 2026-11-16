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
//
// ------------------------------------------------------------------------------ noise (band verdicts)
// A Monte-Carlo stat never fails a band on noise. For a row of tier mc with SE se: inside the band
// → PASS; outside by at most 3·se → PASS with `withinNoise: true` ("PASS (within noise)"); further
// → FAIL. The dry-streak p95 is a step function of the hit rate: it is recomputed at hit rate ± 3 SE
// and when the verdict differs across that interval a miss is "within noise". `withinNoise` lists
// the keys, so slots:eval can run more rounds to resolve the gate rows.
//
// ------------------------------------------------------------------------------ the modifier split
// `input.split` (conditional.ts): the base round of a modifier-feature spec is
//   the exact (B0, K) law of the mechanic-free spec  +  per paired conditional sample j (count c_j
//   of n): +P(T)·c_j/n at (X_j, K_j) and −P(T)·c_j/n at (B0_j, K0_j).
// The entries are SIGNED; every statistic above that is linear in the base law (RTP, hit rate,
// the moments of the SD, the exact parts of the tails, the cap loss, the scatter law) reads them
// as they are, which is exactly E[g(B0)] + P(T)·E[g(X) − g(B0) | T]. Its SE is the paired one,
// P(T)·sd(g(X) − g(B0) | T)/√n (`seOf`). What must SAMPLE the base (the session, the free-spins
// tails) samples a clamped copy (negative net masses set to 0, renormalised): an approximation,
// used only for informational rows. With `input.modifier` the modifier feature is reported:
// frequency 1/P(T) (exact under the split; else 1/p̂ from the detect tally), average win
// E[X − B0 | T] / bet and share P(T)·E[X − B0 | T] / rtpUncapped. Without a free-spins feature it
// takes the free-spins bands (1 in 80–300, 25–55%, 15–150×) in the feature rows; next to one it is
// a smaller feature (1 in 40–120; share and average win informational) in its own rows.
//
// ------------------------------------------------------------------------------ anchors
// `input.baseRtp` overrides the base RTP (eval.ts: the pack's exact RTP when the TS model has no
// closed form, or the pack's mc when its SE is smaller than ours). `input.featureAnchor` overrides
// the feature RTP, trigger probability and average win (eval.ts: the pack's exact feature-spin RTP
// and trigger law when the award tables are flat), so the feature rows and the RTP can be exact
// while the distributions (hit rate, SD, tails) still come from the Monte Carlo.

import type { RtpReport, SlotSpec } from '../types';
import { award, multiplierAt, VOLATILITY_BANDS, type FreeSpinsConfig, type SlotConfig, type Volatility } from './config';
import { distScatter, spinDistribution, type SpinDist } from './distribution';
import { exactRtp, scatterCountDist } from './exact';
import { featureProfile, featureValues, freeSpinsAnalytics, sampleSpinIndex, simulateFeature, type FreeSpinsAnalytics } from './features';
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
  /** null = informational (no band applies). A miss within 3 SE of an mc row passes (withinNoise). */
  pass: boolean | null;
  /** Outside the band but within 3 SE (mc only): counts as a pass. */
  withinNoise?: boolean;
  /** Part of the §5 gate (RTP, hit rate, dry streak, max-win reachability). */
  gate: boolean;
  method: string;
}

/** The modifier feature (config.modifierFeature), reported by the split or by the detect tally. */
export interface ModifierSummary {
  name: string;
  mechanic: string;
  /** 'conditional': trigger-conditional split (exact P(T)); 'detect': plain Monte Carlo of the detect signal. */
  method: 'conditional' | 'detect';
  /** P(the feature runs) per round. */
  pTrigger: number;
  /** N of "1 in N". */
  frequency: number;
  frequencySe?: number;
  frequencyTier: Tier;
  /** E[X − B0 | feature] / bet. */
  averageWinStakes: number;
  averageWinSe?: number;
  /** P(T)·E[X − B0 | T] / rtpUncapped. */
  share: number;
  shareSe?: number;
  /** Tier of the average win and the share. */
  tier: Tier;
  /** P(T)·E[X − B0 | T] / bet: the modifier's part of the RTP. */
  rtpContribution: number;
  rtpContributionSe?: number;
  /** Samples behind the mc values (conditional samples, or spins for 'detect'). */
  n: number;
  /** 'free_spins': no free-spins feature, the free-spins bands apply; 'smaller': next to free spins. */
  role: 'free_spins' | 'smaller';
}

/** Trigger-conditional split of a modifier feature (header, conditional.ts). */
export interface SplitInput {
  /** The exact (B0, K) distribution of the mechanic-free spec. */
  exactDist: SpinDist;
  /** P(T), exact. */
  pT: number;
  /** The paired conditional sample: (X, B0, K of the spin, K0 of the mechanic-free board) → count. */
  cond: { n: number; x: number[]; b0: number[]; k: number[]; k0?: number[]; count: number[] };
  method: string;
  /**
   * The importance-sampled max-win tail over triggering boards (conditional.ts tailChunk): p =
   * P(X ≥ cap | T), loss = E[(X − cap)+ | T] in coins, with SEs; hits = unweighted spins at the cap.
   */
  tail?: { n: number; hits: number; p: number; pSe: number; loss: number; lossSe: number; method: string };
}

/** Plain Monte-Carlo tally of a modifier feature's detect signal over n base spins. */
export interface ModifierDetectTally {
  n: number;
  detected: number;
  /** Σ (X − B0) over the detected spins, coins, and Σ of its square. */
  sumD: number;
  sumD2: number;
}

/** An exact (or pack) feature value that overrides the algebra over sampled distributions (header, anchors). */
export interface FeatureAnchor {
  featureRtp: number;
  triggerP: number;
  /** E[F | trigger] / bet. */
  averageWinStakes: number;
  tier: Tier;
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
  /** The parts of rtpUncappedSe: the base sample (with the trigger law it carries) and the feature sample. */
  rtpSeParts: { base: number; feature: number };
  capLoss: CapLoss;
  baseRtp: number;
  baseRtpTier: Tier;
  baseRtpSe?: number;
  /** With the modifier split: E[B0] (exact) and the modifier's P(T)·E[X − B0 | T], in RTP units. */
  baseSplit: { mechanicFree: number; modifier: number; modifierSe: number } | null;
  featureRtp: number;
  featureRtpTier: Tier;
  feature: FeatureSummary | null;
  modifier: ModifierSummary | null;
  hitRate: number;
  winOverStake: McEstimate;
  sdStakes: number;
  pWin100: McEstimate;
  /**
   * best: the best evidence for P(X ≥ cap) per round, null when no hit was seen and nothing bounds it
   * away from 0 (then `interval` = [0, upper]); interval: the reported [lower, upper].
   */
  reach: { lowerBound: number; upperBound: number; boundTier: Tier; mc: McEstimate | null; best: number | null; interval: [number, number]; method: string };
  dryStreakP95: number;
  session: SessionStats;
  distributions: { base: { tier: 'exact' | 'mc'; n?: number; entries: number; method: string }; feature: { tier: 'exact' | 'mc'; n?: number; entries: number; method: string } | null };
  mc: { rounds: number; sessions: number; seed: number };
  bandsPassed: string[];
  bandsFailed: string[];
  gateFailed: string[];
  /** Rows that pass only within noise (mc, outside the band by ≤ 3 SE). */
  withinNoise: string[];
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
  /** Where an overriding baseRtp comes from (the RTP row's method). */
  baseRtpMethod?: string;
  /** Modifier-feature split (replaces baseDist / baseRtp; header). */
  split?: SplitInput;
  /** Report this modifier feature (the split, or a detect tally from the base Monte Carlo). */
  modifier?: { name: string; mechanic: string; detect?: ModifierDetectTally };
  /** Overrides the free-spins feature's RTP, trigger probability and average win (header, anchors). */
  featureAnchor?: FeatureAnchor;
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

// --------------------------------------------------------------------------- flat award tables (anchors)

/**
 * Are the award tables flat (header, anchors)? award(k) the same for every k ≥ scatter_min, the
 * retrigger award the same for every k ≥ its smallest key, and (when the feature spin's retrigger
 * probability is to come from its own trigger law) the feature spec's scatter_min = that key.
 */
export function flatTables(spec: SlotSpec, featureSpec: SlotSpec, cfg: FreeSpinsConfig): { flat: boolean; why: string[]; rmin: number | null; smin: number } {
  const why: string[] = [];
  const smin = Number(spec.trigger?.scatter_min);
  const maxK = spec.geometry.rows.reduce((a, b) => a + b, 0);
  const aw = Array.from({ length: Math.max(1, maxK - smin + 1) }, (_, i) => award(cfg.awards, smin + i));
  if (!aw.every((v) => v === aw[0])) why.push('awards differ by K');
  const rKeys = cfg.retrigger ? Object.entries(cfg.retrigger).filter(([, v]) => v > 0).map(([k]) => Number(k)) : [];
  const rmin = rKeys.length ? Math.min(...rKeys) : null;
  if (rmin !== null) {
    const fMaxK = featureSpec.geometry.rows.reduce((a, b) => a + b, 0);
    const ra = Array.from({ length: Math.max(1, fMaxK - rmin + 1) }, (_, i) => award(cfg.retrigger, rmin + i));
    if (!ra.every((v) => v === ra[0])) why.push('retrigger awards differ by K');
  }
  return { flat: why.length === 0, why, rmin, smin };
}

/**
 * The exact free-spins value under flat tables: every trigger starts n0 = min(award, maxSpins)
 * spins, each spin retriggers with probability pRetrigger (K ≥ rmin), independent of the spin's
 * own index, so E[F] = Σ_j E[m_j 1{N ≥ j}]·E[W] (features.ts, first moment) and
 * featureRtp = P(trigger)·E[F] / bet. `ewCoins` = E[W] of one feature spin in base coins.
 */
export function flatFeatureAnchor(cfg: FreeSpinsConfig, smin: number, rmin: number | null, pTrigger: number, ewCoins: number, pRetrigger: number, bet: number, method: string): FeatureAnchor {
  const n0 = Math.min(award(cfg.awards, smin), cfg.maxSpins);
  const law: SpinDist =
    rmin === null
      ? { coins: [0], k: [0], p: [1], tier: 'exact', method: 'no retrigger' }
      : { coins: [0, 0], k: [0, rmin], p: [1 - pRetrigger, pRetrigger], tier: 'exact', method: 'retrigger law' };
  const M = featureProfile(law, cfg, n0).expectedMultiplierSum;
  const eF = M * ewCoins;
  return {
    featureRtp: (pTrigger * eF) / bet,
    triggerP: pTrigger,
    averageWinStakes: eF / bet,
    tier: 'exact',
    method: `${method}; Σ_j E[m_j 1{N ≥ j}] = ${M.toFixed(6)} (${n0} spins, retrigger p ${pRetrigger.toPrecision(6)})`,
  };
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
  const split = input.split ?? null;
  if (split && split.exactDist.tier !== 'exact') throw new Error('split.exactDist must be the exact distribution of the mechanic-free spec');
  if (split && !(split.cond.n > 0)) throw new Error('split.cond needs a sample (n > 0)');
  const closed = model.closedFormRefusal === null && !split;
  const baseDist = split ? split.exactDist : input.baseDist ?? spinDistribution(spec);
  const baseMc = !split && baseDist.tier === 'mc';
  const nBase = baseDist.n ?? 0;
  if (baseMc && !(nBase > 0)) throw new Error('a sampled base SpinDist needs its sample size n');
  /** The base law carries sampling noise (a sampled SpinDist, or the split's conditional sample). */
  const sampled = baseMc || !!split;
  const nSample = split ? split.cond.n : nBase;
  // the split's pairs keep K0 (the mechanic-free board's scatter count) next to the spin's K
  const k0Of = (j: number) => (split!.cond.k0 ? split!.cond.k0[j] : split!.cond.k[j]);
  const splitKSame = !!split && split.cond.k.every((k, j) => k === k0Of(j));

  // the scatter law: exact from the closed forms whenever the spec has one (even when the joint
  // distribution had to be sampled), exact under the split when the mechanic never moves K, else
  // from the (signed) sampled law
  let scatterDist: number[];
  if (closed) scatterDist = scatterCountDist(spec);
  else if (split) {
    scatterDist = distScatter(split.exactDist);
    if (!splitKSame) {
      const w = split.pT / split.cond.n;
      split.cond.count.forEach((c, j) => {
        const k = split.cond.k[j];
        const k0 = k0Of(j);
        while (scatterDist.length <= Math.max(k, k0)) scatterDist.push(0);
        scatterDist[k] += w * c;
        scatterDist[k0] -= w * c;
      });
    }
  } else scatterDist = distScatter(baseDist);
  const scatterExact = closed || splitKSame;

  // ---- the feature
  const cfg = config.feature ?? null;
  const anchor = cfg ? input.featureAnchor ?? null : null;
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
    // the feature's own analytics only (the base RTP and its tier are combined below)
    fa = freeSpinsAnalytics({
      baseRtp: 0,
      baseTier: 'exact',
      betCoins: bet,
      featureBetCoins: fBet,
      scatterDist,
      scatterMin: smin,
      featureDist,
      cfg,
    });
  }
  const featureMc = featureDist?.tier === 'mc';

  // per-entry feature moments (base coins), by initial award
  const spinsOf = (k: number) => (cfg && k >= smin ? Math.min(award(cfg.awards, k), cfg.maxSpins) : 0);
  const awardsNeeded = new Set<number>();
  for (let i = 0; i < baseDist.p.length; i++) awardsNeeded.add(spinsOf(baseDist.k[i]));
  if (split) for (let j = 0; j < split.cond.k.length; j++) awardsNeeded.add(spinsOf(split.cond.k[j])).add(spinsOf(k0Of(j)));
  const fvBySpins = new Map<number, { ef: number; ef2: number; pz: number }>();
  if (cfg && featureDist) {
    const list = [...awardsNeeded].filter((s) => s > 0);
    const vals = featureValues(featureDist, cfg, list);
    list.forEach((s, j) => fvBySpins.set(s, { ef: vals[j].expectedWinCoins * scale, ef2: vals[j].secondMomentCoins * scale * scale, pz: vals[j].pZero }));
  }
  const mkEntry = (B: number, K: number, p: number): Entry => {
    const spins = spinsOf(K);
    const fv = spins > 0 ? fvBySpins.get(spins)! : { ef: 0, ef2: 0, pz: 1 };
    return { B, K, p, spins, ef: fv.ef, ef2: fv.ef2, pz: fv.pz };
  };
  // es: the base law's entries, SIGNED under the split (header); pairs: the split's paired sample
  const es: Entry[] = [];
  for (let i = 0; i < baseDist.p.length; i++) es.push(mkEntry(baseDist.coins[i], baseDist.k[i], baseDist.p[i]));
  const pairs: { x: Entry; b: Entry; c: number }[] = [];
  if (split) {
    const w = split.pT / split.cond.n;
    split.cond.count.forEach((c, j) => {
      const x = mkEntry(split.cond.x[j], split.cond.k[j], w * c);
      const b = mkEntry(split.cond.b0[j], k0Of(j), -w * c);
      es.push(x, b);
      pairs.push({ x, b, c });
    });
  }
  // what must SAMPLE the base law samples a non-negative copy (header: clamped under the split)
  let sampEs = es;
  let sampDist = baseDist;
  if (split) {
    const net = new Map<string, Entry>();
    for (const e of es) {
      const key = `${e.B},${e.K}`;
      const cur = net.get(key);
      if (cur) cur.p += e.p;
      else net.set(key, { ...e });
    }
    sampEs = [...net.values()].filter((e) => e.p > 0);
    const tot = sampEs.reduce((a, e) => a + e.p, 0);
    sampEs = sampEs.map((e) => ({ ...e, p: e.p / tot }));
    sampDist = { coins: sampEs.map((e) => e.B), k: sampEs.map((e) => e.K), p: sampEs.map((e) => e.p), tier: 'mc', n: nSample, method: 'the split base law, clamped at 0 (sampling only)' };
  }
  const trig = (e: Entry) => e.spins > 0;
  /** SE of Σ p·g over the base law: the sampled base's, or the split's paired one; 0 when exact. */
  const seOf = (g: (e: Entry) => number): number => {
    if (baseMc) return Math.sqrt(wVar(es, g).v / nBase);
    if (split) {
      let s1 = 0;
      let s2 = 0;
      for (const q of pairs) {
        const d = g(q.x) - g(q.b);
        s1 += q.c * d;
        s2 += q.c * d * d;
      }
      const n = split.cond.n;
      const mu = s1 / n;
      return split.pT * Math.sqrt((Math.max(0, s2 / n - mu * mu) * (n / Math.max(1, n - 1))) / n);
    }
    return 0;
  };

  // ---- base RTP: the split's exact part + conditional mean; an override; exact; else the sample
  let baseRtp: RtpReport;
  let baseFromSample = false;
  let baseSplit: SlotStats['baseSplit'] = null;
  if (split) {
    const mean = es.reduce((a, e) => a + e.p * e.B, 0);
    const se = seOf((e) => e.B) / bet;
    const free = split.exactDist.coins.reduce((a, c, i) => a + c * split.exactDist.p[i], 0) / bet;
    baseSplit = { mechanicFree: free, modifier: mean / bet - free, modifierSe: se };
    if (input.baseRtp) baseRtp = input.baseRtp;
    else {
      baseRtp = { rtp: mean / bet, tier: 'mc', se, n: split.cond.n };
      baseFromSample = true;
    }
  } else if (input.baseRtp) baseRtp = input.baseRtp;
  else if (closed) {
    const ex = exactRtp(spec);
    baseRtp = { rtp: ex.rtp, tier: ex.tier };
  } else {
    baseRtp = distRtpReport(baseDist, bet);
    baseFromSample = true;
  }
  const exactTier: Tier = baseRtp.tier === 'exact_mixture' ? 'exact_mixture' : 'exact';
  /** Tier of a quantity read off the joint distributions with no simulation. */
  const jointTier: Tier = sampled || featureMc ? 'mc' : exactTier;

  // ---- RTP (uncapped)
  const featureRtp = anchor ? anchor.featureRtp : fa ? fa.featureRtp : 0;
  const featureRtpTier: Tier = !cfg ? exactTier : anchor ? anchor.tier : scatterExact && !featureMc ? exactTier : 'mc';
  const rtpUncapped = baseRtp.rtp + featureRtp;
  let rtpUncappedTier: Tier = baseRtp.tier === 'mc' || featureRtpTier === 'mc' ? 'mc' : exactTier;
  let rtpUncappedSe: number | undefined;
  // the base part: the base sample carries the base RTP (when read off it) and the trigger law
  // (when the feature value isn't anchored); an overriding mc base RTP brings its own SE
  const kLawSampled = !!cfg && !anchor && !scatterExact;
  let seBase: number;
  if (baseFromSample) seBase = seOf((e) => (e.B + (trig(e) && !anchor ? e.ef : 0)) / bet);
  else seBase = Math.sqrt((baseRtp.tier === 'mc' ? baseRtp.se ?? 0 : 0) ** 2 + (kLawSampled ? seOf((e) => (trig(e) ? e.ef / bet : 0)) : 0) ** 2);
  const seFeature = !anchor && featureMc ? fa?.featureRtpSe ?? 0 : 0;
  if (rtpUncappedTier === 'mc') rtpUncappedSe = Math.sqrt(seBase ** 2 + seFeature ** 2);
  if (!Number.isFinite(rtpUncapped)) rtpUncappedTier = 'mc';

  // ---- hit rate (2)
  const hitG = (e: Entry) => (e.B > 0 ? 1 : trig(e) ? 1 - e.pz : 0);
  const hitW = wVar(es, hitG);
  const hitRate = hitW.mean;
  const hitTier = jointTier;
  const hitSe = sampled ? seOf(hitG) : undefined;

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
  if (sampled && sdCoins > 0) sdSe = seOf((e) => (h2(e) - 2 * m1 * h1(e)) / (2 * sdCoins)) / bet;

  // ---- the conditional Monte Carlo of the triggered entries
  let streams = 0;
  const conditional = (
    pop: (e: Entry) => boolean,
    fns: ((x: number) => number)[],
  ): { mass: number; n: number; mean: number[]; sd: number[] } | null => {
    const idx: number[] = [];
    let mass = 0;
    sampEs.forEach((e, i) => {
      if (trig(e) && pop(e)) {
        idx.push(i);
        mass += e.p;
      }
    });
    // under the split the mass is the signed law's (the clamped copy only picks the entries)
    if (split) mass = es.reduce((a, e) => a + (trig(e) && pop(e) ? e.p : 0), 0);
    const stream = streams++;
    if (!idx.length || !(mass > 0) || !cfg || !featureDist) return null;
    const d = sub(sampDist, idx);
    const rng = mulberry32(streamSeed(seed, stream));
    const s1 = new Float64Array(fns.length);
    const s2 = new Float64Array(fns.length);
    for (let r = 0; r < mcRounds; r++) {
      const e = sampEs[idx[sampleSpinIndex(d, rng)]];
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
    const exactG = (e: Entry) => (pred(e.B) ? 1 : 0);
    const exact = wVar(es, exactG);
    const sim = conditional((e) => !pred(e.B), [(x) => (pred(x) ? 1 : 0)]);
    if (!sim) {
      return {
        value: exact.mean,
        tier: jointTier,
        se: sampled ? seOf(exactG) : undefined,
        n: sampled ? nSample : undefined,
        exactPart: exact.mean,
        mcMass: 0,
        method: `exact over the base distribution: every round that can reach ${label} does so on the base spin (F ≥ 0)`,
      };
    }
    const value = exact.mean + sim.mass * sim.mean[0];
    const seInner = (sim.mass * sim.sd[0]) / Math.sqrt(sim.n);
    const se = Math.sqrt(seInner ** 2 + seOf((e) => (pred(e.B) ? 1 : trig(e) ? sim.mean[0] : 0)) ** 2);
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
  let reachInterval: [number, number] = [0, 0];
  {
    // exact part: untriggered (B − cap)+, triggered with B ≥ cap: B − cap + E[F|k]
    const lossG = (e: Entry) => (e.B >= capCoins ? e.B - capCoins + (trig(e) ? e.ef : 0) : 0);
    const exactLoss = wVar(es, lossG);
    const exactReach = wVar(es, (e) => (e.B >= capCoins ? 1 : 0));
    const sim = conditional((e) => e.B < capCoins, [(x) => Math.max(0, x - capCoins), (x) => (x >= capCoins ? 1 : 0), (x) => (x > capCoins ? 1 : 0)]);
    const tail = split?.tail ?? null;
    if (!sim && split && tail) {
      // the split's tail (header, max-win reach): the exact and B0 parts of the signed law + P(T) × the
      // importance-sampled P(X ≥ cap | T) and E[(X − cap)+ | T]
      const xs = new Set(pairs.map((q) => q.x));
      const nonX = (g: (e: Entry) => number) => es.reduce((acc, e) => acc + (xs.has(e) ? 0 : e.p * g(e)), 0);
      const reachFixed = nonX((e) => (e.B >= capCoins ? 1 : 0));
      const lossFixed = nonX(lossG);
      const reachVal = reachFixed + split.pT * tail.p;
      capLoss = {
        value: (lossFixed + split.pT * tail.loss) / bet,
        tier: 'mc',
        se: (split.pT * tail.lossSe) / bet,
        n: tail.n,
        hits: tail.hits,
        exactPart: lossFixed / bet,
        method: `E[(X − cap)+] / bet: the exact and B0 parts of the split + P(T) × E[(X − cap)+ | T] by importance sampling (${tail.method})`,
      };
      // the "bounds" are the part with no tail sampling; the estimate is reachMc (best evidence)
      lowerBound = reachFixed;
      upperBound = reachFixed;
      lowerBoundTier = 'mc';
      reachMc = {
        value: reachVal,
        tier: 'mc',
        se: split.pT * tail.pSe,
        n: tail.n,
        hits: tail.hits,
        exactPart: reachFixed,
        mcMass: split.pT,
        method: `P(T) exact × P(X ≥ cap | T) by importance sampling: ${tail.method}`,
      };
      reachMethod = `the split: P(B0 ≥ cap) parts (exact + paired sample) + P(T) (exact) × P(X ≥ cap | T)`;
    } else if (!sim) {
      const anyAbove = es.some((e) => e.B > capCoins && e.p > 0);
      const splitHits = split ? split.cond.count.reduce((a, c, j) => a + (split.cond.x[j] > capCoins ? c : 0), 0) : 0;
      capLoss = {
        value: exactLoss.mean / bet,
        tier: jointTier,
        se: sampled ? seOf(lossG) / bet : undefined,
        n: sampled ? nSample : undefined,
        hits: baseMc ? Math.round(nBase * es.reduce((a, e) => a + (e.B > capCoins ? e.p : 0), 0)) : split ? splitHits : undefined,
        exactPart: exactLoss.mean / bet,
        method: cfg
          ? 'exact over the base distribution (no triggered round below the cap)'
          : `exact over the base distribution: E[(B − cap)+] / bet${anyAbove ? '' : ' (no base spin exceeds the cap)'}`,
      };
      lowerBound = exactReach.mean;
      upperBound = exactReach.mean;
      reachMethod = cfg ? 'exact: P(B ≥ cap) over the base distribution' : 'exact: P(B ≥ cap) over the base distribution (no feature)';
      if (sampled) lowerBoundTier = 'mc';
    } else {
      const hitsAbove = Math.round(sim.mean[2] * sim.n);
      const lossMean = exactLoss.mean + sim.mass * sim.mean[0];
      const seInner = (sim.mass * sim.sd[0]) / Math.sqrt(sim.n);
      const se = Math.sqrt(seInner ** 2 + seOf((e) => (e.B >= capCoins ? lossG(e) : trig(e) ? sim.mean[0] : 0)) ** 2) / bet;
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
  const rtpN = rtpTier === 'mc' ? (baseRtp.tier === 'mc' ? baseRtp.n ?? nSample : sampled ? nSample : featureMc ? featureDist!.n : capLoss.n) : undefined;

  // ---- dry streak (8), and its range over hit rate ± 3 SE (header, noise)
  const dry = dryStreakQuantile(hitRate);
  const dryRange: [number, number] | null =
    hitTier === 'mc' && hitSe !== undefined && hitSe > 0
      ? [dryStreakQuantile(Math.min(1, hitRate + 3 * hitSe)), dryStreakQuantile(Math.max(0, hitRate - 3 * hitSe))]
      : null;

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
        const e = sampEs[sampleSpinIndex(sampDist, rng)];
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
        `${n.toLocaleString('en-US')} sessions of ${sessionRounds} rounds at 1 stake from ${startStakes} stakes, rounds sampled from the ${split ? 'split (clamped)' : baseDist.tier} base ` +
        `${featureDist ? `and ${featureDist.tier} feature ` : ''}distributions, capped per round; a player whose balance is below 1 stake stops (bust); ` +
        'median with a distribution-free order-statistic 95% CI',
    } satisfies SessionStats;
  })();

  // ---- the feature summary (6)
  let feature: FeatureSummary | null = null;
  if (fa && cfg) {
    const triggerP = anchor ? anchor.triggerP : fa.triggerP;
    feature = {
      kind: 'free_spins',
      tier: featureRtpTier,
      triggerP,
      frequency: triggerP > 0 ? 1 / triggerP : Infinity,
      featureRtp,
      featureRtpSe: anchor ? undefined : featureRtpTier === 'mc' ? Math.sqrt((kLawSampled ? seOf((e) => (trig(e) ? e.ef / bet : 0)) : 0) ** 2 + seFeature ** 2) : undefined,
      share: rtpUncapped !== 0 ? featureRtp / rtpUncapped : 0,
      expectedSpins: fa.expectedSpinsGivenTrigger,
      averageWinStakes: anchor ? anchor.averageWinStakes : fa.averageFeatureWinStakes,
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

  // ---- the modifier feature (header, the modifier split)
  let modifier: ModifierSummary | null = null;
  if (input.modifier) {
    const mi = input.modifier;
    const role: ModifierSummary['role'] = feature ? 'smaller' : 'free_spins';
    const rtpCoins = rtpUncapped * bet;
    if (split) {
      let s1 = 0;
      let s2 = 0;
      split.cond.count.forEach((c, j) => {
        const d = split.cond.x[j] - split.cond.b0[j];
        s1 += c * d;
        s2 += c * d * d;
      });
      const n = split.cond.n;
      const mean = s1 / n;
      const seMean = Math.sqrt((Math.max(0, s2 / n - mean * mean) * (n / Math.max(1, n - 1))) / n);
      modifier = {
        name: mi.name,
        mechanic: mi.mechanic,
        method: 'conditional',
        pTrigger: split.pT,
        frequency: split.pT > 0 ? 1 / split.pT : Infinity,
        frequencyTier: 'exact',
        averageWinStakes: mean / bet,
        averageWinSe: seMean / bet,
        share: rtpCoins !== 0 ? (split.pT * mean) / rtpCoins : 0,
        shareSe: rtpCoins !== 0 ? (split.pT * seMean) / rtpCoins : undefined,
        tier: 'mc',
        rtpContribution: (split.pT * mean) / bet,
        rtpContributionSe: (split.pT * seMean) / bet,
        n,
        role,
      };
    } else if (mi.detect && mi.detect.n > 0) {
      const t = mi.detect;
      const p = t.detected / t.n;
      const seP = Math.sqrt((p * (1 - p)) / t.n);
      const meanDet = t.detected > 0 ? t.sumD / t.detected : 0;
      const varDet = t.detected > 1 ? Math.max(0, t.sumD2 / t.detected - meanDet * meanDet) : 0;
      const perSpin = t.sumD / t.n;
      const varSpin = Math.max(0, t.sumD2 / t.n - perSpin * perSpin);
      modifier = {
        name: mi.name,
        mechanic: mi.mechanic,
        method: 'detect',
        pTrigger: p,
        frequency: p > 0 ? 1 / p : Infinity,
        frequencySe: p > 0 ? seP / (p * p) : undefined,
        frequencyTier: 'mc',
        averageWinStakes: meanDet / bet,
        averageWinSe: t.detected > 0 ? Math.sqrt(varDet / t.detected) / bet : undefined,
        share: rtpCoins !== 0 ? perSpin / rtpCoins : 0,
        shareSe: rtpCoins !== 0 ? Math.sqrt(varSpin / t.n) / rtpCoins : undefined,
        tier: 'mc',
        rtpContribution: perSpin / bet,
        rtpContributionSe: Math.sqrt(varSpin / t.n) / bet,
        n: t.n,
        role,
      };
    }
  }

  // ---- the rows
  const rows: StatRow[] = [];
  const declared = config.volatility;
  const measured = volatilityOf(sdStakes);
  const inBand = (x: number, b: Band) => x >= b.lo - 1e-12 && x <= b.hi + 1e-12;

  {
    const band: Band = { lo: 0.955, hi: 0.965, text: '95.5–96.5%' };
    const splitTxt = `base ${pct(baseRtp.rtp, 3)} + feature ${pct(featureRtp, 3)} − cap ${pct(capLoss.value, 4)}`;
    const baseTxt = split
      ? `trigger-conditional split: E[B0] ${pct(baseSplit!.mechanicFree, 4)} exact (the spec without the modifier mechanic) + P(T)·E[X − B0 | T] ${pct(baseSplit!.modifier, 4)} ± ${pct(baseSplit!.modifierSe, 4)} (P(T) exact, n ${split.cond.n.toLocaleString('en-US')} triggering boards)`
      : input.baseRtpMethod
        ? input.baseRtpMethod
        : baseRtp.tier === 'mc'
          ? `Monte Carlo (n ${baseRtp.n})`
          : `${baseRtp.tier} closed form (exact.ts)`;
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
        `uncapped ${pct(rtpUncapped, 4)} (${rtpUncappedTier}${rtpUncappedSe !== undefined ? ` ± ${pct(rtpUncappedSe, 4)}` : ''}) = ${splitTxt}. ` +
        `Base: ${baseTxt}; ` +
        (cfg
          ? anchor
            ? `feature: ${anchor.method}. `
            : `feature: exact free-spins algebra (features.ts) over the ${featureDist?.tier ?? '—'} feature distribution and the ${scatterExact ? 'exact' : 'sampled'} trigger law. `
          : '') +
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
      display: `${pct(hitRate, 2)}${tierTag(hitTier, hitSe, sampled ? nSample : undefined)}`,
      tier: hitTier,
      se: hitSe,
      n: sampled ? nSample : undefined,
      band,
      pass: inBand(hitRate, band),
      gate: true,
      method:
        'P(B > 0) + Σ_k P(B = 0, K = k)·(1 − P(F = 0 | k)) over the base distribution, P(F = 0) from the feature DP' +
        (split ? '; the base law is the trigger-conditional split (exact outside the trigger, paired conditional sample inside)' : ''),
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
      display: `${sdStakes.toFixed(2)} (${measured})${tierTag(jointTier, sdSe, sampled ? nSample : undefined, (x) => x.toFixed(3))}`,
      tier: jointTier,
      se: sdSe,
      n: sampled ? nSample : undefined,
      band,
      pass: inBand(sdStakes, band),
      gate: false,
      method: 'UNCAPPED: √(E[X²] − E[X]²), E[X²] = E[B²] + 2Σ_k E[B·1{K=k}]·E[F|k] + Σ_k P(K=k)·E[F²|k] (B ⟂ F given K), exact moments from the feature DP; the cap only lowers it',
    });
  }
  // the modifier feature's three rows (header): in the feature rows without free spins, else its own
  const modifierRows = (keys: [string, string, string], fBand: Band, judged: boolean): void => {
    const m = modifier!;
    const lbl = (what: string) => `${what} (${m.name})`;
    rows.push({
      key: keys[0],
      label: lbl(judged ? 'Feature frequency' : 'Smaller-feature frequency'),
      value: m.frequency,
      display: `1 in ${fmtNum(m.frequency)}${tierTag(m.frequencyTier, m.frequencySe, m.frequencyTier === 'mc' ? m.n : undefined, fmtNum)}`,
      tier: m.frequencyTier,
      se: m.frequencySe,
      n: m.frequencyTier === 'mc' ? m.n : undefined,
      band: fBand,
      pass: inBand(m.frequency, fBand),
      gate: false,
      method:
        m.method === 'conditional'
          ? `1 / P(T), P(T) = P(≥ ${config.modifierFeature?.trigger?.minCount} of symbols ${JSON.stringify(config.modifierFeature?.trigger?.symbols)} on the initial board): exact count convolution over the reel windows`
          : `1 / p̂, p̂ = spins on which ${m.mechanic} ran (detect signal) in ${m.n.toLocaleString('en-US')} engine spins`,
    });
    const sb: Band | null = judged ? { lo: 0.25, hi: 0.55, text: '25–55%' } : { lo: 0, hi: 1, text: 'informational (smaller feature)' };
    rows.push({
      key: keys[1],
      label: lbl(judged ? 'Feature share of RTP' : 'Smaller-feature share of RTP'),
      value: m.share,
      display: `${pct(m.share, 1)}${tierTag(m.tier, m.shareSe, m.n, (x) => pct(x, 2))}`,
      tier: m.tier,
      se: m.shareSe,
      n: m.n,
      band: sb,
      pass: judged ? inBand(m.share, sb) : null,
      gate: false,
      method: `P(T)·E[X − B0 | T] / rtpUncapped: X the spin's coins, B0 the same initial board's pay without ${m.mechanic}${m.method === 'conditional' ? ' (trigger-conditional Monte Carlo)' : ' (plain Monte Carlo)'}`,
    });
    const ab: Band = judged ? { lo: 15, hi: 150, text: '15–150×' } : { lo: 0, hi: Infinity, text: 'informational (smaller feature)' };
    rows.push({
      key: keys[2],
      label: lbl(judged ? 'Average feature win' : 'Smaller-feature average win'),
      value: m.averageWinStakes,
      display: `${fmtNum(m.averageWinStakes)}×${tierTag(m.tier, m.averageWinSe, m.method === 'conditional' ? m.n : undefined, (x) => x.toFixed(2))}`,
      tier: m.tier,
      se: m.averageWinSe,
      n: m.n,
      band: ab,
      pass: judged ? inBand(m.averageWinStakes, ab) : null,
      gate: false,
      method: `E[X − B0 | the feature ran] / bet`,
    });
  };
  if (feature) {
    const fb: Band = { lo: 80, hi: 300, text: '1 in 80–300 (free spins)' };
    const fExact = scatterExact || (!!anchor && anchor.tier !== 'mc');
    const fTier: Tier = fExact ? exactTier : 'mc';
    const pSe = fExact ? undefined : Math.sqrt((feature.triggerP * (1 - feature.triggerP)) / nSample);
    rows.push({
      key: 'featureFrequency',
      label: 'Feature frequency',
      value: feature.frequency,
      display: `1 in ${fmtNum(feature.frequency)}${tierTag(fTier, pSe !== undefined ? pSe / feature.triggerP ** 2 : undefined, fExact ? undefined : nSample, fmtNum)}`,
      tier: fTier,
      se: pSe !== undefined ? pSe / feature.triggerP ** 2 : undefined,
      n: fExact ? undefined : nSample,
      band: fb,
      pass: inBand(feature.frequency, fb),
      gate: false,
      method: `1 / P(K ≥ ${smin}), P from ${scatterExact ? 'the exact scatter-count convolution' : anchor && anchor.tier !== 'mc' ? `the pack (${anchor.method})` : 'the sampled base distribution'}`,
    });
    const sb: Band = { lo: 0.25, hi: 0.55, text: '25–55%' };
    const shareSe = feature.featureRtpSe !== undefined && rtpUncapped ? feature.featureRtpSe / rtpUncapped : undefined;
    rows.push({
      key: 'featureShare',
      label: 'Feature share of RTP',
      value: feature.share,
      display: `${pct(feature.share, 1)}${tierTag(feature.tier, shareSe, feature.tier === 'mc' ? nSample : undefined, (x) => pct(x, 2))}`,
      tier: feature.tier,
      se: shareSe,
      band: sb,
      pass: inBand(feature.share, sb),
      gate: false,
      method: `featureRtp / rtpUncapped (${anchor ? anchor.method : 'exact free-spins algebra'})`,
    });
    const ab: Band = { lo: 15, hi: 150, text: '15–150×' };
    const avgSe = feature.featureRtpSe !== undefined && feature.triggerP > 0 ? feature.featureRtpSe / feature.triggerP : undefined;
    rows.push({
      key: 'averageFeatureWin',
      label: 'Average feature win',
      value: feature.averageWinStakes,
      display: `${fmtNum(feature.averageWinStakes)}×${tierTag(feature.tier, avgSe, feature.tier === 'mc' ? nSample : undefined, (x) => x.toFixed(2))}`,
      tier: feature.tier,
      se: avgSe,
      band: ab,
      pass: inBand(feature.averageWinStakes, ab),
      gate: false,
      method: `E[F | trigger] / bet, uncapped (${anchor ? anchor.method : 'exact free-spins algebra'})`,
    });
    if (modifier) modifierRows(['modifierFrequency', 'modifierShare', 'modifierAverageWin'], { lo: 40, hi: 120, text: '1 in 40–120 (smaller feature)' }, false);
  } else if (modifier) {
    modifierRows(['featureFrequency', 'featureShare', 'averageFeatureWin'], { lo: 80, hi: 300, text: '1 in 80–300 (free-spins bands)' }, true);
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
    const isBound = upperBound > lowerBound;
    const mcHit = !!reachMc && (reachMc.hits ?? 0) > 0;
    // with bounds, the best evidence is the MC estimate clamped into them (else the lower bound)
    const best = mcHit ? (isBound ? Math.min(upperBound, Math.max(lowerBound, reachMc!.value)) : Math.max(lowerBound, reachMc!.value)) : lowerBound;
    const reachFromMc = mcHit && !isBound && reachMc!.value > lowerBound;
    const reachTier: Tier = reachFromMc ? 'mc' : lowerBoundTier;
    const mcTxt = reachMc ? `; MC ${reachMc.hits ? oneInSci(reachMc.value) : '0'} (${reachMc.hits} hits / ${reachMc.n?.toLocaleString('en-US')})` : '';
    const reachBand: Band = { lo: 1e-9, hi: 1, text: '> 1 in 10⁹' };
    // RULE (header, max-win reach): no evidence is never reported as P = 0. With no hit and a zero lower
    // bound the evidence is an interval [0, upper]: the exact upper bound when there is one, else the
    // rule of three on the sample (3/n of the sampled mass). Upper ≤ 1e-9 fails; else it is unresolved
    // (within noise, counts as a pass) and slots:eval keeps sampling.
    const exactZero = best === 0 && reachTier !== 'mc' && !isBound && !reachMc;
    if (best > 0 || exactZero) {
      const reachSe = reachTier !== 'mc' || isBound ? undefined : reachFromMc ? reachMc!.se : split ? seOf((e) => (e.B >= capCoins ? 1 : 0)) : Math.sqrt((best * (1 - best)) / nSample);
      rows.push({
        key: 'maxWinReach',
        label: 'P(reaching the max win) per round',
        value: best,
        display:
          (isBound
            ? `1 in ${(1 / upperBound).toExponential(2)} to ${lowerBound > 0 ? (1 / lowerBound).toExponential(2) : '∞'} (${lowerBoundTier} bounds)`
            : `${oneInSci(best)} ${reachTier}${reachSe !== undefined ? ` (p ${best.toExponential(2)} ± ${reachSe.toExponential(1)})` : ''}`) + (isBound ? mcTxt : reachMc ? ` (${reachMc.hits} hits / ${reachMc.n?.toLocaleString('en-US')})` : ''),
        tier: reachTier,
        se: reachSe,
        n: reachTier !== 'mc' ? undefined : reachFromMc ? reachMc!.n : nSample,
        band: reachBand,
        pass: best > 1e-9,
        gate: true,
        method: reachMethod + (reachMc ? `; ${reachMc.method}` : '') + (exactZero ? '; exactly 0: the cap is unreachable' : ''),
      });
      // exact bounds when there are; else the estimate's 95% interval
      reachInterval = isBound ? [lowerBound, upperBound] : reachSe !== undefined ? [Math.max(0, best - 1.96 * reachSe), best + 1.96 * reachSe] : [best, best];
    } else {
      // rule of three: the sampled mass that could reach the cap, × 3 / its sample size
      const r3: number[] = [];
      if (reachMc && reachMc.n) r3.push(reachMc.exactPart + reachMc.mcMass * (3 / reachMc.n));
      if (split && !reachMc) r3.push(split.pT * (3 / split.cond.n));
      if (baseMc && !reachMc) r3.push(3 / nBase);
      const upper = Math.min(isBound ? upperBound : Infinity, ...(r3.length ? r3 : [isBound ? upperBound : 1]));
      const nSeen = reachMc?.n ?? nSample;
      const unresolved = upper > 1e-9;
      reachInterval = [0, upper];
      rows.push({
        key: 'maxWinReach',
        label: 'P(reaching the max win) per round',
        value: null,
        display: `no hit in ${nSeen.toLocaleString('en-US')} sampled ${split ? 'triggering boards' : reachMc ? 'triggered rounds' : 'rounds'}: ≤ 1 in ${(1 / upper).toExponential(2)} (${isBound && upper === upperBound ? 'exact upper bound' : 'rule of three'})${unresolved ? ', unresolved' : ''}`,
        tier: 'mc',
        n: nSeen,
        band: reachBand,
        pass: unresolved ? true : false,
        ...(unresolved ? { withinNoise: true } : {}),
        gate: true,
        method:
          reachMethod +
          (reachMc ? `; ${reachMc.method}` : '') +
          `; no hit seen, so P is reported as the interval [0, ${upper.toExponential(3)}], not as 0: ${unresolved ? 'the upper bound is above 1 in 10⁹, unresolved (counts as a pass; sample more)' : 'even the upper bound is below 1 in 10⁹'}`,
      });
    }
  }
  {
    const max = DRY_STREAK_MAX[declared];
    rows.push({
      key: 'dryStreakP95',
      label: 'Dry streak p95 (longest miss run in 100)',
      value: dry,
      display: `${dry} rounds${tierTag(hitTier)}${dryRange && dryRange[0] !== dryRange[1] ? ` (${dryRange[0]}–${dryRange[1]} at hit rate ± 3 SE)` : ''}`,
      tier: hitTier,
      se: undefined,
      n: hitTier === 'mc' ? nSample : undefined,
      band: { lo: 0, hi: max, text: `≤ ${max} (${declared})` },
      pass: dry <= max,
      gate: true,
      method:
        `exact DP over the current miss run, rounds iid with P(miss) = 1 − hit rate = ${(1 - hitRate).toFixed(6)}; p95 = smallest L with P(longest ≤ L) ≥ 0.95` +
        (dryRange ? `; at hit rate ± 3 SE it is ${dryRange[0]}–${dryRange[1]}` : ''),
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

  // ---- noise (header): an mc miss within 3 SE passes, within noise
  for (const r of rows) {
    if (r.pass !== false || r.tier !== 'mc' || !r.band || r.value === null) continue;
    if (r.key === 'dryStreakP95') {
      // a step function of the hit rate: within noise when the verdict differs across hit rate ± 3 SE
      if (dryRange && Math.min(dryRange[0], dryRange[1]) <= r.band.hi) {
        r.pass = true;
        r.withinNoise = true;
      }
      continue;
    }
    const se = r.se;
    if (!(se !== undefined && se > 0)) continue;
    const miss = r.value < r.band.lo ? r.band.lo - r.value : r.value > r.band.hi ? r.value - r.band.hi : 0;
    if (miss <= 3 * se) {
      r.pass = true;
      r.withinNoise = true;
      r.method += `; outside the band by ${(miss / se).toFixed(2)} SE (≤ 3): within noise`;
    }
  }

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
    rtpSeParts: { base: seBase, feature: seFeature },
    capLoss,
    baseRtp: baseRtp.rtp,
    baseRtpTier: baseRtp.tier,
    baseRtpSe: baseRtp.se,
    baseSplit,
    featureRtp,
    featureRtpTier,
    feature,
    modifier,
    hitRate,
    winOverStake,
    sdStakes,
    pWin100,
    reach: {
      lowerBound,
      upperBound,
      boundTier: lowerBoundTier,
      mc: reachMc,
      best: rows.find((r) => r.key === 'maxWinReach')!.value,
      interval: reachInterval,
      method: reachMethod,
    },
    dryStreakP95: dry,
    session,
    distributions: {
      base: split ? { tier: 'mc', n: split.cond.n, entries: baseDist.p.length + pairs.length, method: split.method } : summary(baseDist),
      feature: featureDist ? summary(featureDist) : null,
    },
    mc: { rounds: mcRounds, sessions: nSessions, seed },
    bandsPassed,
    bandsFailed,
    gateFailed,
    withinNoise: rows.filter((r) => r.withinNoise).map((r) => r.key),
  };
}
