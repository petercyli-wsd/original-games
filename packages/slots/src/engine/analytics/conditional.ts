// Trigger-conditional Monte Carlo for a modifier feature (config.ts `modifierFeature`): a spec
// mechanic that runs inside one paid spin (hold-and-spin, sticky respins …) when the INITIAL board
// shows at least `trigger.minCount` cells of `trigger.symbols`.
//
// ------------------------------------------------------------------------------ the split
// Let X be the spin's total coins, B0 what the same initial board pays with the mechanic switched
// off (the TS model evaluator of the mechanic-free spec, `boardCoins`), T the trigger event and
// D = X − B0. When X = B0 outside T (checked, below):
//     E[X] = E[B0] + P(T)·E[D | T]
// E[B0] is the mechanic-free spec's exact RTP, P(T) is exact (a count convolution of the trigger
// symbols over the reel set's windows), and only E[D | T] is simulated, over triggering boards
// alone. Every other linear statistic g of the spin splits the same way:
//     E[g(X)] = E[g(B0)] + P(T)·E[g(X) − g(B0) | T]
// (stats.ts: the exact (B0, K) distribution of the mechanic-free spec plus, per conditional
// sample, +P(T)/n at (X, K) and −P(T)/n at (B0, K); its SE is P(T)·sd(g(X) − g(B0) | T)/√n over the
// PAIRED sample). Variance reduction over plain Monte Carlo: the 1 − P(T) of spins that never run
// the mechanic contribute no noise, and the sample is spent where the variance is.
//
// ------------------------------------------------------------------------------ the sampler
// Exact sampling of the initial board given T (fixed-height global_mixture specs only; anything
// else is refused by name). Per reel set s (weight w_s) and reel c, the stops are grouped by how
// many trigger cells their window shows: pmf_c(k) = |stops with k| / L_c. With the suffix tails
// tail_c(t) = P(Σ_{c' ≥ c} k_c' ≥ t):
//   - the set:            P(s | T) = w_s·P_s(T) / P(T), P_s(T) = tail_0(minCount)
//   - reel c's count k:   ∝ pmf_c(k)·tail_{c+1}(need − k), need = minCount − Σ_{c' < c} k_c'
//   - reel c's stop:      uniform among that reel's stops with exactly k trigger cells
// which is the law of (set, stops) under the spin's own draw, conditioned on T.
//
// The engine then plays the spin from those stops: `ForcedStopsRng` answers the engine's first
// draws (the set pick when there is more than one set, then one randrange(len) per reel in reel
// order, the pack's draw order in reelsystem.ts) with the forced set and stops, and every later
// draw (the mechanic's own: coin values, respins) from a seeded Mulberry32. A draw out of that
// order throws, so a spec whose engine draws differently can't be silently mis-sampled.
//
// ------------------------------------------------------------------------------ validity
// `validateSplit` runs the unconditional engine on n seeded spins and checks, on every spin:
//   - T (from the initial board) ⇔ the detect signal (the mechanic ran);
//   - outside T: X = B0 and the engine's scatter count = the model's (the free-spins K).
// Any violation means the split is not valid for this spec: the caller falls back to plain MC.
//
// Pure (no Node APIs). The engine is injected (`EngineLike`), so this file doesn't import it.

import type { SlotSpec } from '../types';
import { Mulberry32, type SpinRng } from '../rng';
import type { ModifierFeatureConfig } from './config';
import { convolve } from './exact';
import { hasPost } from './mechanics';
import { boardAt, boardCoins, buildModel, type SlotModel } from './model';

// --------------------------------------------------------------------------- shared shapes

/** The fields of an engine spin (RawSpin or SpinResult) the analytics read. */
export interface RawSpinLike {
  set: number;
  stops: number[];
  steps: { board: number[][] }[];
  finalBoard: number[][];
  extras: { label: string; coins: number }[];
  totalCoins: number;
  trigger: { fired: boolean; text: string } | null;
  flags: string[];
  decor: Map<string, unknown> | Record<string, unknown>;
}

/** The engine as the analytics use it (SlotEngine satisfies it). */
export interface EngineLike {
  spinRaw(rng: SpinRng): RawSpinLike;
}

// --------------------------------------------------------------------------- the mechanic-free spec

/** The spec with every instance of `mechanic` removed (throws when it has none). */
export function specWithoutMechanic(spec: SlotSpec, mechanic: string): SlotSpec {
  const mechs = (spec.mechanics ?? []) as unknown as { id: string }[];
  const kept = mechs.filter((m) => m.id !== mechanic);
  if (kept.length === mechs.length) throw new Error(`modifierFeature.mechanic '${mechanic}' is not in the spec's mechanics (${mechs.map((m) => m.id).join(', ') || 'none'})`);
  return { ...spec, mechanics: kept as unknown as SlotSpec['mechanics'] };
}

// --------------------------------------------------------------------------- detection

function decorKeys(decor: RawSpinLike['decor']): string[] {
  return decor instanceof Map ? [...decor.keys()] : Object.keys(decor ?? {});
}

/** Did the modifier feature run on this spin? (config.ts `detect`; default: a `${mechanic}.` decor key.) */
export function modifierDetected(spin: RawSpinLike, mf: Pick<ModifierFeatureConfig, 'mechanic' | 'detect'>): boolean {
  const d = mf.detect;
  if (!d) return decorKeys(spin.decor).some((k) => k.startsWith(`${mf.mechanic}.`));
  if (d.decor !== undefined && decorKeys(spin.decor).includes(d.decor)) return true;
  if (d.extraPrefix !== undefined && spin.extras.some((e) => e.label.startsWith(d.extraPrefix!))) return true;
  if (d.flagPrefix !== undefined && spin.flags.some((f) => f.startsWith(d.flagPrefix!))) return true;
  if (d.minSteps !== undefined && spin.steps.length >= d.minSteps) return true;
  return false;
}

// --------------------------------------------------------------------------- the trigger law

interface SetLaw {
  /** Set weight ÷ total weight. */
  weight: number;
  /** P(T | this set). */
  pT: number;
  /** [reel][count] → the stops whose window shows that many trigger cells. */
  stopsByCount: number[][][];
  /** [reel][count] → probability. */
  pmf: number[][];
  /** [reel][t] = P(Σ_{c' ≥ reel} k ≥ t), t = 0..minCount; row cols is the empty suffix. */
  tail: number[][];
}

export interface TriggerLaw {
  symbols: number[];
  minCount: number;
  cols: number;
  nSets: number;
  /** Strip lengths per set (the forced randrange draws must match them). */
  lengths: number[][];
  /** P(T), exact. */
  pT: number;
  sets: SetLaw[];
  /** Cumulative P(set | T). */
  setCum: number[];
}

/** Why the trigger-conditional sampler can't run on this spec, or null. */
export function samplerRefusal(spec: SlotSpec): string | null {
  const bl = spec.board_law as { kind: string; reel_sets?: unknown[] };
  if (bl.kind !== 'reel_set_mixture' && bl.kind !== 'strips_uniform') return `board_law ${bl.kind}: the sampler needs a global reel-set mixture`;
  if (!bl.reel_sets?.length) return 'board_law has no reel sets';
  const hl = (spec as { height_law?: { kind?: string } }).height_law;
  if (hl && hl.kind && hl.kind !== 'fixed') return `height_law ${hl.kind}: the sampler needs fixed reel heights`;
  if ((spec.geometry as { top_reel?: unknown }).top_reel != null) return 'geometry.top_reel: the sampler needs a plain reel window';
  return null;
}

/** The exact trigger law of a fixed-height global_mixture spec (throws with the refusal otherwise). */
export function triggerLaw(spec: SlotSpec, trigger: { symbols: number[]; minCount: number }): TriggerLaw {
  const why = samplerRefusal(spec);
  if (why) throw new Error(`trigger-conditional sampler: ${why}`);
  const syms = new Set(trigger.symbols);
  const m = trigger.minCount;
  const cols = spec.geometry.cols;
  const rows = spec.geometry.rows;
  const reelSets = spec.board_law.reel_sets!;
  const tot = reelSets.reduce((a, s) => a + Number(s.weight), 0);
  const sets: SetLaw[] = reelSets.map((rs) => {
    if (rs.strips.length !== cols) throw new Error(`reel set ${rs.id}: ${rs.strips.length} strips for ${cols} reels`);
    const stopsByCount: number[][][] = [];
    const pmf: number[][] = [];
    rs.strips.forEach((strip, c) => {
      const L = strip.length;
      const by: number[][] = [];
      for (let s = 0; s < L; s++) {
        let k = 0;
        for (let i = 0; i < rows[c]; i++) if (syms.has(strip[(s + i) % L])) k++;
        while (by.length <= k) by.push([]);
        by[k].push(s);
      }
      stopsByCount.push(by);
      pmf.push(by.map((l) => l.length / L));
    });
    // suffix tails
    const tail: number[][] = new Array(cols + 1);
    tail[cols] = Array.from({ length: m + 1 }, (_, t) => (t <= 0 ? 1 : 0));
    for (let c = cols - 1; c >= 0; c--) {
      const suffix = convolve(pmf.slice(c));
      const row = new Array<number>(m + 1).fill(0);
      for (let t = 0; t <= m; t++) {
        let s = 0;
        for (let x = t; x < suffix.length; x++) s += suffix[x];
        row[t] = t <= 0 ? 1 : s;
      }
      tail[c] = row;
    }
    return { weight: Number(rs.weight) / tot, pT: tail[0][m], stopsByCount, pmf, tail };
  });
  const pT = sets.reduce((a, s) => a + s.weight * s.pT, 0);
  const setCum: number[] = [];
  let acc = 0;
  for (const s of sets) setCum.push((acc += pT > 0 ? (s.weight * s.pT) / pT : 0));
  return {
    symbols: [...trigger.symbols],
    minCount: m,
    cols,
    nSets: sets.length,
    lengths: reelSets.map((rs) => rs.strips.map((s) => s.length)),
    pT,
    sets,
    setCum,
  };
}

/** One initial board drawn exactly from the spin's law conditioned on T (header). */
export function sampleTriggerBoard(law: TriggerLaw, u: () => number): { setIdx: number; stops: number[] } {
  if (!(law.pT > 0)) throw new Error('sampleTriggerBoard: P(T) = 0');
  let setIdx = 0;
  if (law.nSets > 1) {
    const x = u();
    while (setIdx < law.nSets - 1 && x >= law.setCum[setIdx]) setIdx++;
  }
  const s = law.sets[setIdx];
  const stops: number[] = new Array(law.cols);
  let need = law.minCount;
  for (let c = 0; c < law.cols; c++) {
    const pmf = s.pmf[c];
    const next = s.tail[c + 1];
    const tailAt = (t: number) => (t <= 0 ? 1 : next[t]);
    let norm = 0;
    for (let k = 0; k < pmf.length; k++) norm += pmf[k] * tailAt(need - k);
    let x = u() * norm;
    let k = 0;
    for (; k < pmf.length - 1; k++) {
      const w = pmf[k] * tailAt(need - k);
      if (x < w) break;
      x -= w;
    }
    // guard against rounding landing on a zero-weight count
    while (pmf[k] * tailAt(need - k) === 0 && k > 0) k--;
    const list = s.stopsByCount[c][k];
    stops[c] = list[Math.min(list.length - 1, Math.floor(u() * list.length))];
    need -= k;
  }
  return { setIdx, stops };
}

// --------------------------------------------------------------------------- the forced draw

/**
 * A SpinRng that answers the engine's first draws with a forced set and stops (the set pick only
 * when there is more than one set, then one randrange(len) per reel) and every later draw from
 * `inner`. Throws on a draw out of that order.
 */
export class ForcedStopsRng implements SpinRng {
  private phase = 0;
  private readonly forced: number;
  constructor(
    private readonly setIdx: number,
    private readonly stops: number[],
    private readonly nSets: number,
    private readonly lengths: number[],
    private readonly inner: SpinRng,
  ) {
    this.forced = (nSets > 1 ? 1 : 0) + stops.length;
  }
  private get pending(): boolean {
    return this.phase < this.forced;
  }
  u32(): number {
    if (this.pending) throw new Error('ForcedStopsRng: a raw u32 draw before the forced set and stops');
    return this.inner.u32();
  }
  randrange(n: number): number {
    if (!this.pending) return this.inner.randrange(n);
    const c = this.phase - (this.nSets > 1 ? 1 : 0);
    if (c < 0) throw new Error('ForcedStopsRng: randrange before the set pick');
    if (n !== this.lengths[c]) throw new Error(`ForcedStopsRng: reel ${c} drew randrange(${n}), its strip has ${this.lengths[c]} stops`);
    this.phase++;
    return this.stops[c];
  }
  pickWeighted(cum: readonly number[]): number {
    if (!this.pending) return this.inner.pickWeighted(cum);
    if (this.phase !== 0 || this.nSets <= 1) throw new Error('ForcedStopsRng: an unexpected weighted pick among the forced draws');
    if (cum.length !== this.nSets) throw new Error(`ForcedStopsRng: set pick over ${cum.length} entries, ${this.nSets} reel sets`);
    this.phase++;
    return this.setIdx;
  }
  /** All forced draws consumed? */
  get done(): boolean {
    return !this.pending;
  }
}

// --------------------------------------------------------------------------- the split's pieces

export interface SplitModel {
  /** The mechanic-free spec. */
  spec0: SlotSpec;
  model0: SlotModel;
  law: TriggerLaw;
}

/** Why the trigger-conditional split can't be used (by name), or null. */
export function splitRefusal(spec: SlotSpec, mf: ModifierFeatureConfig): string | null {
  if (!mf.trigger) return 'modifierFeature has no trigger';
  const why = samplerRefusal(spec);
  if (why) return why;
  let spec0: SlotSpec;
  try {
    spec0 = specWithoutMechanic(spec, mf.mechanic);
  } catch (e) {
    return (e as Error).message;
  }
  const m0 = buildModel(spec0);
  if (m0.closedFormRefusal) return `the spec without ${mf.mechanic} has no closed form (${m0.closedFormRefusal})`;
  if (m0.components.length !== (spec.board_law.reel_sets?.length ?? 0) || m0.components.some((c) => c.colMap) || hasPost(m0.post))
    return `the spec without ${mf.mechanic} keeps mechanics that change the board or the pay (${m0.mechanicLabels.join('; ')}): B0 is not a function of the initial board`;
  return null;
}

export function buildSplit(spec: SlotSpec, mf: ModifierFeatureConfig): SplitModel {
  const why = splitRefusal(spec, mf);
  if (why) throw new Error(`trigger-conditional split: ${why}`);
  const spec0 = specWithoutMechanic(spec, mf.mechanic);
  return { spec0, model0: buildModel(spec0), law: triggerLaw(spec, mf.trigger!) };
}

/** Trigger cells on a board. */
export function triggerCount(board: number[][], symbols: number[]): number {
  const s = new Set(symbols);
  let n = 0;
  for (const col of board) for (const v of col) if (s.has(v)) n++;
  return n;
}

/** B0 and the model's scatter count of the initial board (set + stops). */
export function initialBoardValue(split: SplitModel, setIdx: number, stops: number[]): { b0: number; k0: number; board: number[][] } {
  const board = boardAt(split.model0, split.model0.components[setIdx], stops);
  const { coins, k } = boardCoins(split.model0, board);
  return { b0: coins, k0: k, board };
}

/** Joint counts of a conditional sample: (X, B0, K of the spin, K0 of the mechanic-free board) → count. */
export interface CondCounts {
  n: number;
  x: number[];
  b0: number[];
  k: number[];
  k0: number[];
  count: number[];
  /** Conditional samples on which the detect signal did NOT fire (should be 0). */
  undetected: number;
}

/**
 * n trigger-conditional spins (header): board from `sampleTriggerBoard`, played by the engine on
 * ForcedStopsRng with the post-stop draws on Mulberry32(the sample's seed). All randomness comes
 * from Mulberry32(seed): the sampler's uniforms and each sample's post-stop seed.
 */
export function conditionalChunk(
  engine: EngineLike,
  split: SplitModel,
  mf: ModifierFeatureConfig,
  kOf: (r: RawSpinLike) => number,
  n: number,
  seed: number,
): CondCounts {
  const g = new Mulberry32(seed >>> 0);
  const u = () => g.u32() / 4294967296;
  const acc = new Map<string, number>();
  let undetected = 0;
  const law = split.law;
  for (let i = 0; i < n; i++) {
    const { setIdx, stops } = sampleTriggerBoard(law, u);
    const post = g.u32();
    const rng = new ForcedStopsRng(setIdx, stops, law.nSets, law.lengths[setIdx], new Mulberry32(post));
    const r = engine.spinRaw(rng);
    if (!rng.done || r.set !== setIdx || r.stops.some((s, c) => s !== stops[c])) throw new Error('conditionalChunk: the engine did not play the forced set and stops');
    if (!modifierDetected(r, mf)) undetected++;
    const { b0, k0 } = initialBoardValue(split, setIdx, stops);
    const key = `${r.totalCoins},${b0},${kOf(r)},${k0}`;
    acc.set(key, (acc.get(key) ?? 0) + 1);
  }
  const out: CondCounts = { n, x: [], b0: [], k: [], k0: [], count: [], undetected };
  for (const [key, c] of acc) {
    const [x, b, k, k0] = key.split(',').map(Number);
    out.x.push(x);
    out.b0.push(b);
    out.k.push(k);
    out.k0.push(k0);
    out.count.push(c);
  }
  return out;
}

/** Merge conditional chunks (order-independent: integer counts). */
export function mergeCond(parts: CondCounts[]): CondCounts {
  const acc = new Map<string, number>();
  let n = 0;
  let undetected = 0;
  for (const p of parts) {
    n += p.n;
    undetected += p.undetected;
    for (let i = 0; i < p.x.length; i++) {
      const key = `${p.x[i]},${p.b0[i]},${p.k[i]},${p.k0[i]}`;
      acc.set(key, (acc.get(key) ?? 0) + p.count[i]);
    }
  }
  return condFromMap(acc, n, undetected);
}

/** A running merge: add a chunk's counts to a map keyed "x,b0,k,k0". */
export function addCond(into: Map<string, number>, p: CondCounts): void {
  for (let i = 0; i < p.x.length; i++) {
    const key = `${p.x[i]},${p.b0[i]},${p.k[i]},${p.k0[i]}`;
    into.set(key, (into.get(key) ?? 0) + p.count[i]);
  }
}

/** CondCounts of a merged map, entries sorted (deterministic order). */
export function condFromMap(acc: Map<string, number>, n: number, undetected: number): CondCounts {
  const keys = [...acc.keys()].map((s) => s.split(',').map(Number));
  keys.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3]);
  const out: CondCounts = { n, x: [], b0: [], k: [], k0: [], count: [], undetected };
  for (const [x, b, k, k0] of keys) {
    out.x.push(x);
    out.b0.push(b);
    out.k.push(k);
    out.k0.push(k0);
    out.count.push(acc.get(`${x},${b},${k},${k0}`)!);
  }
  return out;
}

export interface SplitValidation {
  ok: boolean;
  n: number;
  triggered: number;
  violations: string[];
}

/**
 * The validity check (header) on n unconditional engine spins, seeds from Mulberry32(seed).
 * Stops at the first 5 violations.
 */
export function validateSplit(
  engine: EngineLike,
  split: SplitModel,
  mf: ModifierFeatureConfig,
  kOf: (r: RawSpinLike) => number,
  n: number,
  seed: number,
): SplitValidation {
  const g = new Mulberry32(seed >>> 0);
  const violations: string[] = [];
  let triggered = 0;
  for (let i = 0; i < n && violations.length < 5; i++) {
    const s = g.u32();
    const r = engine.spinRaw(new Mulberry32(s));
    const { b0, k0, board } = initialBoardValue(split, r.set, r.stops);
    const t = triggerCount(board, split.law.symbols) >= split.law.minCount;
    const det = modifierDetected(r, mf);
    if (t) triggered++;
    if (t !== det) violations.push(`seed ${s}: trigger ${t ? 'shown' : 'not shown'} on the initial board but the feature ${det ? 'ran' : 'did not run'}`);
    if (!t && r.totalCoins !== b0) violations.push(`seed ${s}: no trigger, but the spin paid ${r.totalCoins} coins and the mechanic-free board pays ${b0}`);
    if (!t && kOf(r) !== k0) violations.push(`seed ${s}: no trigger, but the engine's scatter count ${kOf(r)} ≠ the model's ${k0}`);
  }
  return { ok: violations.length === 0, n, triggered, violations };
}

// --------------------------------------------------------------------------- the max-win tail (importance sampling)
//
// P(X ≥ cap) of a modifier-feature spin is P(T)·P(X ≥ cap | T) (B0 alone never reaches a cap in
// practice; its part is read off the paired sample). A cap far in the tail (honeycomb: about 1 in
// 60M rounds) shows a handful of hits in a million triggering boards, so `tailChunk` samples the same
// triggering boards with the mechanic's VALUE draws tilted toward large values and weights each spin
// by its likelihood ratio:
//   the engine's weighted pick over the mechanic's value_pmf (recognised by its cumulative weights)
//   draws from q = (1 − ε)·p + ε·p̃, p̃_i ∝ p_i·v_i (the size-biased pmf), and the spin's weight is
//   W = Π over its value draws of p_i / q_i.
// Every other draw (the board, the respin stops) keeps its law, and which draws happen depends only
// on draws whose law is unchanged, so E_q[W·1{X ≥ cap}] = P(X ≥ cap | T) (unbiased), with the SE of
// the weighted mean. q ≥ (1 − ε)·p bounds each factor by 1/(1 − ε).

/** The value_pmf draw of a mechanic as the engine picks it: candidate cumulative weights and the values behind them. */
export interface ValueLaw {
  cums: { cum: number[]; values: number[] }[];
  p: number[];
}

/** The value_pmf of `mechanic` in the spec (null when it has none). */
export function mechanicValueLaw(spec: SlotSpec, mechanic: string): { values: number[]; weights: number[] } | null {
  const m = ((spec.mechanics ?? []) as unknown as { id: string; params?: Record<string, unknown> }[]).find((x) => x.id === mechanic);
  const pmf = m?.params?.value_pmf as Record<string, number> | undefined;
  if (!pmf || typeof pmf !== 'object') return null;
  const items = Object.entries(pmf).map(([k, w]) => [Number(k), Number(w)] as [number, number]);
  if (!items.length || items.some(([v, w]) => !Number.isFinite(v) || !(w > 0))) return null;
  return { values: items.map(([v]) => v), weights: items.map(([, w]) => w) };
}

/** A SpinRng that tilts the weighted picks over one value law (header) and keeps the likelihood ratio. */
export class TiltedValueRng implements SpinRng {
  weight = 1;
  draws = 0;
  private readonly orders: { cum: number[]; q: number[]; qCum: number[]; ratio: number[] }[];
  constructor(
    private readonly inner: SpinRng,
    law: { values: number[]; weights: number[] },
    eps: number,
    /** Optional tilt: q_i from (values, p) in the given order; default the size-biased mixture. */
    tilt?: (values: number[], p: number[]) => number[],
  ) {
    const idx = law.values.map((_, i) => i);
    const numeric = [...idx].sort((a, b) => law.values[a] - law.values[b] || law.weights[a] - law.weights[b]);
    const str = [...idx].sort((a, b) => (String(law.values[a]) < String(law.values[b]) ? -1 : String(law.values[a]) > String(law.values[b]) ? 1 : 0));
    const tot = law.weights.reduce((a, b) => a + b, 0);
    const mean = idx.reduce((a, i) => a + (law.weights[i] / tot) * Math.max(0, law.values[i]), 0);
    this.orders = [numeric, str].map((ord) => {
      let run = 0;
      const cum = ord.map((i) => (run += law.weights[i]));
      const p = ord.map((i) => law.weights[i] / tot);
      const q = tilt
        ? tilt(ord.map((i) => law.values[i]), p)
        : ord.map((i, j) => (1 - eps) * p[j] + (mean > 0 ? (eps * p[j] * Math.max(0, law.values[i])) / mean : eps * p[j]));
      let qr = 0;
      const qCum = q.map((x) => (qr += x));
      return { cum, q, qCum, ratio: p.map((x, j) => x / q[j]) };
    });
  }
  u32(): number {
    return this.inner.u32();
  }
  randrange(n: number): number {
    return this.inner.randrange(n);
  }
  pickWeighted(cum: readonly number[]): number {
    const o = this.orders.find((x) => x.cum.length === cum.length && x.cum.every((c, i) => c === cum[i]));
    if (!o) return this.inner.pickWeighted(cum);
    const u = (this.inner.u32() / 4294967296) * o.qCum[o.qCum.length - 1];
    let j = 0;
    while (j < o.qCum.length - 1 && u >= o.qCum[j]) j++;
    this.weight *= o.ratio[j];
    this.draws++;
    return j;
  }
}

/** Weighted tail sums of a chunk of tilted triggering boards (header). */
export interface TailCounts {
  n: number;
  /** Unweighted spins with X ≥ cap. */
  hits: number;
  /** Σ W·1{X ≥ cap}, Σ (W·1{X ≥ cap})². */
  sumW: number;
  sumW2: number;
  /** Σ W·(X − cap)+ and its square (coins). */
  sumLoss: number;
  sumLoss2: number;
  /** Σ W over all spins (≈ n: a check of the weights). */
  sumAll: number;
}

/** n tilted trigger-conditional spins (header): the board as in conditionalChunk, the value draws tilted. */
export function tailChunk(
  engine: EngineLike,
  split: SplitModel,
  law: { values: number[]; weights: number[] },
  capCoins: number,
  n: number,
  seed: number,
  eps = 0.1,
  tilt?: (values: number[], p: number[]) => number[],
): TailCounts {
  const g = new Mulberry32(seed >>> 0);
  const u = () => g.u32() / 4294967296;
  const out: TailCounts = { n, hits: 0, sumW: 0, sumW2: 0, sumLoss: 0, sumLoss2: 0, sumAll: 0 };
  const tl = split.law;
  for (let i = 0; i < n; i++) {
    const { setIdx, stops } = sampleTriggerBoard(tl, u);
    const tr = new TiltedValueRng(new Mulberry32(g.u32()), law, eps, tilt);
    const rng = new ForcedStopsRng(setIdx, stops, tl.nSets, tl.lengths[setIdx], tr);
    const r = engine.spinRaw(rng);
    const w = tr.weight;
    out.sumAll += w;
    if (r.totalCoins >= capCoins) {
      out.hits++;
      out.sumW += w;
      out.sumW2 += w * w;
      const l = w * (r.totalCoins - capCoins);
      out.sumLoss += l;
      out.sumLoss2 += l * l;
    }
  }
  return out;
}

export function mergeTail(into: TailCounts, p: TailCounts): void {
  into.n += p.n;
  into.hits += p.hits;
  into.sumW += p.sumW;
  into.sumW2 += p.sumW2;
  into.sumLoss += p.sumLoss;
  into.sumLoss2 += p.sumLoss2;
  into.sumAll += p.sumAll;
}
