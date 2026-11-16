// Monte Carlo of one spin through the engine, for specs with no closed form (docs/SLOTS.md §2.6):
// mechanics, tumbles / cascades, cluster, height laws. The spin function is injected (the engine
// port's `canonicalSpin(spec, seed)`), so this file stays free of the engine and of Node APIs.
//
// Seeds: spin i runs on seed_i = the i-th u32 of Mulberry32(seed), so the draw is deterministic
// per (spec, n, seed) and the per-spin seeds are spread over the whole 32-bit range. With
// `consecutiveSeeds`, spin i runs on seed + i instead: the pack's own Monte Carlo
// (`reelengine.analytics.mc.mc_analytics`: Mulberry32(content_seed + i), i < n_mc), so with the
// pack's content seed (oracle.json `analytics.instrument.seed`) the port replays the pack's mc RTP
// spin for spin (mc.test.ts checks it to 1e-12 on the pack's three mc examples).
//
// The scatter count K of a spin (what the free-spins trigger and retrigger read) is the count
// the pack's `pipeline._scatter_settle` read (src/reelengine/pipeline.py; the port's pipeline.ts):
//   - it counts the scatters on the board after the board transforms (S1), BEFORE any post_eval
//     reaction, unless the spec's first continuation settles scatters on the TERMINAL board
//     (`SETTLES_SCATTER = 'terminal'`: tumble / tape_continuation_refill and its refill
//     variants), in which case it counts them on the final board after the cascade;
//   - that count is printed in the spin's own record whenever it matters to the pack: the
//     trigger text "<n> scatters -> feature trigger ..." (when n ≥ scatter_min) and the scatter
//     pay label "SCATTER PAY (<n> scatters)" (when scatter_pay[n] ≠ 0).
// So K is read from the trigger text, else from the scatter-pay label (both exact), else counted
// on a board: by `opts.scatters(result)` when given (eval passes the engine's `triggerScatters`,
// which picks the terminal or the base board by the same SETTLES_SCATTER rule), else on
// `finalBoard` when the spec settles on the terminal board (a continuation mechanic in
// TERMINAL_CONTINUATIONS, or a cluster evaluation, which the engine runs with an implicit tumble),
// else on steps[0].board. The board count can differ from the pack's only for a K that neither
// fires the trigger nor pays (K < scatter_min with no scatter pay) when a post_eval reaction
// rewrote the base board; such a K never triggers a feature.

import type { RtpReport, SlotSpec, SpinResult } from '../types';
import { empiricalDist, type SpinDist } from './distribution';
import { mulberry32 } from './rng';
import { Mulberry32 } from '../rng';

export type SpinFn = (spec: SlotSpec, seed: number) => SpinResult;

export interface McOptions {
  /** K of a spin when neither the trigger text nor the scatter-pay label carries it (see the header). */
  scatters?: (result: SpinResult) => number;
  /** Spin i on seed + i (the pack's mc_analytics convention) instead of the Mulberry32 seed stream. */
  consecutiveSeeds?: boolean;
}

/** Continuation mechanics (pack family ids and engine ids) that settle scatters on the terminal board. */
export const TERMINAL_CONTINUATIONS = new Set(['tumble', 'tape_continuation_refill', 'iid_per_column_refill', 'draw_based_refill']);

function scatterSymbol(spec: SlotSpec): number | null {
  const ids = spec.symbols.filter((s) => s.role === 'scatter').map((s) => s.id);
  if (!ids.length) return null;
  return ids.sort((a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0))[0];
}

function settlesTerminal(spec: SlotSpec): boolean {
  if (spec.evaluation.kind === 'cluster') return true;
  return (spec.mechanics ?? []).some((m) => TERMINAL_CONTINUATIONS.has(String(m.id ?? (m as Record<string, unknown>).family)));
}

const TRIGGER_RE = /^(\d+) scatters\b/;
const PAY_RE = /^SCATTER PAY \((\d+) scatters\)$/;

/** The scatter count K the pack's trigger read for this spin (header). */
export function spinScatterCount(spec: SlotSpec, result: SpinResult, opts: McOptions = {}): number {
  const t = result.trigger?.text ? TRIGGER_RE.exec(result.trigger.text) : null;
  if (t) return Number(t[1]);
  for (const e of result.extras) {
    const m = PAY_RE.exec(e.label);
    if (m) return Number(m[1]);
  }
  if (opts.scatters) return opts.scatters(result);
  const sc = scatterSymbol(spec);
  if (sc === null) return 0;
  const board = settlesTerminal(spec) ? result.finalBoard : result.steps[0].board;
  let n = 0;
  for (const col of board) for (const v of col) if (v === sc) n++;
  return n;
}

/** The n per-spin seeds drawn from Mulberry32(seed). */
export function spinSeeds(n: number, seed: number): number[] {
  const rng = mulberry32(seed >>> 0);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = Math.floor(rng() * 4294967296) >>> 0;
  return out;
}

/** The empirical (coins, K) distribution of n engine spins (tier 'mc', n). */
export function mcSpinDistribution(spec: SlotSpec, spin: SpinFn, n: number, seed: number, opts: McOptions = {}): SpinDist {
  if (!Number.isInteger(n) || n < 1) throw new Error(`mcSpinDistribution: n = ${n} must be a positive integer`);
  const samples: { coins: number; k: number }[] = new Array(n);
  const seeds = opts.consecutiveSeeds ? Array.from({ length: n }, (_, i) => (seed + i) >>> 0) : spinSeeds(n, seed);
  for (let i = 0; i < n; i++) {
    const r = spin(spec, seeds[i]);
    samples[i] = { coins: r.totalCoins, k: spinScatterCount(spec, r, opts) };
  }
  const seedText = opts.consecutiveSeeds ? `seeds ${seed}..${seed}+${n - 1}` : `seeds from Mulberry32(${seed})`;
  return empiricalDist(samples, `Monte Carlo over ${n.toLocaleString('en-US')} engine spins (canonicalSpin, ${seedText}); K = the scatter count the pack's trigger read`);
}

/** RTP of a SpinDist's mean with its SE when the distribution is sampled (tier mc, se = sd/√n). */
export function distRtpReport(d: SpinDist, betCoins: number): RtpReport {
  let m1 = 0;
  let m2 = 0;
  for (let i = 0; i < d.p.length; i++) {
    m1 += d.p[i] * d.coins[i];
    m2 += d.p[i] * d.coins[i] * d.coins[i];
  }
  if (d.tier === 'exact') return { rtp: m1 / betCoins, tier: 'exact' };
  const n = d.n ?? 0;
  // the sample variance with Bessel's correction (an empirical distribution's p are counts / n)
  const v = n > 1 ? ((m2 - m1 * m1) * n) / (n - 1) : NaN;
  return { rtp: m1 / betCoins, tier: 'mc', se: Math.sqrt(Math.max(0, v) / n) / betCoins, n };
}

/** Monte-Carlo RTP of n engine spins: {rtp, tier 'mc', se, n}. */
export function mcRtp(spec: SlotSpec, spin: SpinFn, n: number, seed: number, opts: McOptions = {}): RtpReport {
  return distRtpReport(mcSpinDistribution(spec, spin, n, seed, opts), spec.bet.coins);
}

// --------------------------------------------------------------------------- chunked Monte Carlo
//
// The parallel Monte Carlo (scripts/slots/eval.ts + eval-worker.ts) runs in chunks. Chunk i of a
// stream s runs on its own seed `chunkSeed(seed, s, i)`, and spin j of the chunk on the j-th u32
// of Mulberry32(that seed). A chunk's result is integer counts, so merging is order-independent:
// the same flags and the same number of completed chunks per stream reproduce the same numbers.

/** The seed of chunk i of stream s (a Mulberry32 hash of seed, s and i). */
export function chunkSeed(seed: number, stream: number, i: number): number {
  const g = new Mulberry32((Math.imul((seed >>> 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(stream + 1, 0xc2b2ae35) ^ Math.imul(i + 1, 0x27d4eb2f)) >>> 0);
  g.u32();
  return g.u32();
}

/** Counts key: coins · COUNT_KMUL + K (K < COUNT_KMUL). */
export const COUNT_KMUL = 256;

/** The (coins, K) counts of a chunk of spins. */
export interface SpinCounts {
  n: number;
  keys: number[];
  counts: number[];
}

/** The fields of an engine spin (SlotEngine.spinRaw's RawSpin, or a SpinResult) a chunk reads. */
export type SpinResultLike = Pick<SpinResult, 'totalCoins' | 'steps' | 'finalBoard' | 'extras' | 'trigger'>;

/**
 * n engine spins on seeds from Mulberry32(seed): their (coins, K) counts. `onSpin` sees every spin
 * with its seed (modifier tallies).
 */
export function spinChunk<R extends SpinResultLike>(
  spec: SlotSpec,
  spinRaw: (rng: Mulberry32) => R,
  n: number,
  seed: number,
  opts: McOptions = {},
  onSpin?: (r: R, spinSeed: number) => void,
): SpinCounts {
  const g = new Mulberry32(seed >>> 0);
  const acc = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const s = g.u32();
    const r = spinRaw(new Mulberry32(s));
    const k = spinScatterCount(spec, r as unknown as SpinResult, opts);
    if (k >= COUNT_KMUL) throw new Error(`spinChunk: scatter count ${k} ≥ ${COUNT_KMUL}`);
    const key = r.totalCoins * COUNT_KMUL + k;
    acc.set(key, (acc.get(key) ?? 0) + 1);
    if (onSpin) onSpin(r, s);
  }
  return { n, keys: [...acc.keys()], counts: [...acc.values()] };
}

/** Merge chunk counts into a running map; returns the added n. */
export function mergeCounts(into: Map<number, number>, part: SpinCounts): number {
  for (let i = 0; i < part.keys.length; i++) into.set(part.keys[i], (into.get(part.keys[i]) ?? 0) + part.counts[i]);
  return part.n;
}

/** The empirical SpinDist of merged counts (tier mc, n), entries sorted by (coins, K). */
export function countsToDist(counts: Map<number, number>, n: number, method: string): SpinDist {
  const keys = [...counts.keys()].sort((a, b) => a - b);
  const out: SpinDist = { coins: new Array(keys.length), k: new Array(keys.length), p: new Array(keys.length), tier: 'mc', n, method };
  keys.forEach((key, i) => {
    const k = key % COUNT_KMUL;
    out.coins[i] = (key - k) / COUNT_KMUL;
    out.k[i] = k;
    out.p[i] = counts.get(key)! / n;
  });
  return out;
}
