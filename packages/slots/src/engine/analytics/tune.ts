// The RTP tuner's pure logic (docs/SLOTS.md §6; CLI: scripts/slots/tune.ts). No Node APIs.
//
// ------------------------------------------------------------------------------ the model
// Without the max-win cap the total RTP of a free-spins slot is
//
//   total(pays) = baseRtp(base pays) + C · featureSpinRtp(feature pays)
//
// where featureSpinRtp = exactRtp(feature spec).rtp (one feature spin, in feature stakes) and
//   C = Σ_{k ≥ scatter_min} P_base(K = k) · E[Σ_j m_j 1{N ≥ j} | award(k)]
// is the expected multiplier-weighted number of free spins per base spin. C depends on the scatter
// counts only (awards, retriggers, multiplier schedule, the two specs' scatter distributions),
// never on pays, so it is computed once (`featureProfile` on a K-only SpinDist). The tests check
// total(pays) = freeSpinsAnalytics(...).totalRtp to 1e-9. The max-win cap is NOT counted here
// (slots:eval reports its loss).
//
// Every pay is an integer coin amount, and the total is linear in each pay for 'left'-direction
// lines, ways and scatter pays (it is only piecewise linear where a wild's own pay competes with a
// symbol pay, or for both_max lines), so the tuner never assumes linearity it has not checked:
//   1. scale: s = target / total, multiply all pays, round to integers (≥ 1 where ≥ 1), repair
//      the order constraints, and repeat on the continuous values until the integers stop moving;
//   2. fine-tune: greedy ±k-coin steps, k = round(|err| / gradient) clipped to what the constraints
//      allow; the step whose predicted error is smallest is applied, then the exact total is
//      recomputed (a step that does not actually improve is undone and banned for that round).
// Constraints: pay[s][n] < pay[s][n+1] (strictly increasing with the count, per symbol, for
// paytable / scatter_pay / wild_own_pay); the symbol order at each count (a > b before ⇒ a ≥ b
// after; ties are not constrained).
// Pays that are 0 stay 0. If the feature spec's pays equal the base spec's, both are tuned in
// lockstep (one entry writes both). Otherwise both scale by the same factor and only the base
// pays are fine-tuned.
//
// Strip lever (--hit-rate): move stops between paying symbols on a reel (never a wild or scatter
// stop, never a new wild), steered by a single-line proxy, then measured exactly (see tuneHitRate).
// Pay-shape lever (--volatility): pay' = pay · (pay / ref)^γ for all entries, bisect γ for the exact
// SD of the round (sd below), re-solve the scale each time.

import type { SlotSpec } from '../types';
import { award, VOLATILITY_BANDS, type FreeSpinsConfig, type Volatility } from './config';
import { distProb, spinDistribution, type SpinDist } from './distribution';
import { exactRtp, scatterCountDist } from './exact';
import { featureProfile, freeSpinsAnalytics } from './features';
import { buildModel, NoClosedForm } from './model';

// --------------------------------------------------------------------------- public types

export interface TuneMetrics {
  totalRtp: number;
  /** Tier of the RTP figures ('exact' unless the feature distribution is Monte Carlo). */
  tier: 'exact' | 'mc';
  baseRtp: number;
  featureRtp: number;
  featureShare: number;
  /** P(the round pays anything): P(B>0) + P(B=0, triggered) · P(feature pays | trigger). */
  hitRate: number;
  /** P(the base spin alone pays anything). */
  baseHitRate: number;
  /** SD of one round (base spin + its feature) in stakes, max win not applied. */
  sdStakes: number;
  /** 1 in N base spins trigger the feature (Infinity: none). */
  featureFrequency: number;
  /** E[feature win | trigger] in stakes (NaN: no feature). */
  averageFeatureWin: number;
  /** 'exact' when the spin distributions were enumerated, else 'mc'. */
  momentsTier: 'exact' | 'mc';
}

export interface PayChange {
  /** "P1 x5", "scatter x3", "wild x2" (+ "(feature)" when only the feature spec changes). */
  label: string;
  before: number;
  after: number;
}

export interface TuneOptions {
  /** Target hit rate (fraction), via strip edits. */
  hitRate?: number;
  /** Move the SD per spin into this band. */
  volatility?: Volatility;
  /** Absolute RTP tolerance (default 0.0005). */
  tolerance?: number;
  /** Progress lines. */
  log?: (line: string) => void;
}

export interface TuneResult {
  base: SlotSpec;
  feature: SlotSpec | null;
  before: TuneMetrics;
  after: TuneMetrics;
  targetRtp: number;
  /** |total − target| after tuning (the cap not counted). */
  error: number;
  withinTolerance: boolean;
  lockstep: boolean;
  payChanges: PayChange[];
  stripEdits: number;
  notes: string[];
}

// --------------------------------------------------------------------------- helpers

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

type Kind = 'paytable' | 'scatter' | 'wild';

function table(spec: SlotSpec, kind: Kind, sym: string): Record<string, number> | undefined {
  if (kind === 'paytable') return spec.pays.paytable[sym];
  if (kind === 'scatter') return spec.pays.scatter_pay;
  return (spec.evaluation as { wild_own_pay?: Record<string, number> }).wild_own_pay;
}

function roleOf(spec: SlotSpec, id: number): string {
  return spec.symbols.find((s) => s.id === id)?.role ?? '';
}

function labelOf(spec: SlotSpec, id: number): string {
  return spec.symbols.find((s) => s.id === id)?.label ?? String(id);
}

/** Same maths (pays, strips, evaluation, geometry, symbols, bet): the two specs describe one board. */
function sameMath(a: SlotSpec, b: SlotSpec): boolean {
  const key = (s: SlotSpec) => JSON.stringify([s.bet, s.board_law, s.evaluation, s.geometry, s.symbols, s.pays, s.mechanics, s.trigger]);
  return key(a) === key(b);
}

function samePays(a: SlotSpec, b: SlotSpec): boolean {
  const key = (s: SlotSpec) => JSON.stringify([s.pays.paytable, s.pays.scatter_pay ?? {}, (s.evaluation as { wild_own_pay?: unknown }).wild_own_pay ?? {}]);
  return key(a) === key(b);
}

function sameStrips(a: SlotSpec, b: SlotSpec): boolean {
  return JSON.stringify(a.board_law) === JSON.stringify(b.board_law);
}

function refuse(spec: SlotSpec, what: string): void {
  const r = buildModel(spec).closedFormRefusal;
  if (r) throw new NoClosedForm(`${what}: ${r}`);
}

// --------------------------------------------------------------------------- total RTP

export interface TotalContext {
  cfg: FreeSpinsConfig | null;
  scatterMin: number | null;
  /** The multiplier-weighted free spins per base spin (header). 0 without a feature. */
  C: number;
}

/** C = Σ_k P_base(K=k) · E[Σ_j m_j 1{N ≥ j} | award(k)], from the two specs' scatter distributions. */
export function featureMultiplierWeight(base: SlotSpec, feature: SlotSpec, cfg: FreeSpinsConfig): number {
  const bm = buildModel(base);
  if (bm.triggerMin === null) return 0;
  const baseK = scatterCountDist(bm);
  const featK = scatterCountDist(feature);
  const kd: SpinDist = { coins: featK.map(() => 0), k: featK.map((_, i) => i), p: featK, tier: 'exact', method: 'scatter counts only' };
  const memo = new Map<number, number>();
  let C = 0;
  for (let k = bm.triggerMin; k < baseK.length; k++) {
    if (!baseK[k]) continue;
    const spins = award(cfg.awards, k);
    if (!spins) continue;
    let M = memo.get(spins);
    if (M === undefined) memo.set(spins, (M = featureProfile(kd, cfg, spins).expectedMultiplierSum));
    C += baseK[k] * M;
  }
  return C;
}

export function makeTotalContext(base: SlotSpec, feature: SlotSpec | null, cfg: FreeSpinsConfig | null): TotalContext {
  const scatterMin = buildModel(base).triggerMin;
  if (!cfg || !feature || scatterMin === null) return { cfg: null, scatterMin, C: 0 };
  return { cfg, scatterMin, C: featureMultiplierWeight(base, feature, cfg) };
}

/** Exact total RTP (uncapped) of the pays currently in the two specs. */
export function totalRtp(ctx: TotalContext, base: SlotSpec, feature: SlotSpec | null): number {
  const b = exactRtp(base).rtp;
  if (!ctx.cfg || !feature || ctx.C === 0) return b;
  return b + ctx.C * exactRtp(feature).rtp;
}

// --------------------------------------------------------------------------- measuring

/** All the numbers the tuner prints, from the exact spin distributions and the feature algebra. */
export function measure(base: SlotSpec, feature: SlotSpec | null, cfg: FreeSpinsConfig | null): TuneMetrics {
  const bm = buildModel(base);
  if (bm.closedFormRefusal) throw new NoClosedForm(bm.closedFormRefusal);
  const bex = exactRtp(bm);
  const bd = spinDistribution(bm);
  const bet = base.bet.coins;
  const baseHit = distProb(bd, (c) => c > 0);
  let eB = 0;
  let eB2 = 0;
  const eBk = new Map<number, number>();
  for (let i = 0; i < bd.p.length; i++) {
    eB += bd.p[i] * bd.coins[i];
    eB2 += bd.p[i] * bd.coins[i] ** 2;
    eBk.set(bd.k[i], (eBk.get(bd.k[i]) ?? 0) + bd.p[i] * bd.coins[i]);
  }
  const momentsTier = bd.tier;
  if (!cfg || !feature || bm.triggerMin === null) {
    return {
      totalRtp: bex.rtp,
      tier: 'exact',
      baseRtp: bex.rtp,
      featureRtp: 0,
      featureShare: 0,
      hitRate: baseHit,
      baseHitRate: baseHit,
      sdStakes: Math.sqrt(Math.max(0, eB2 - eB * eB)) / bet,
      featureFrequency: Infinity,
      averageFeatureWin: NaN,
      momentsTier,
    };
  }
  const fd = sameMath(base, feature) ? bd : spinDistribution(feature);
  const scatterDist = scatterCountDist(bm);
  const a = freeSpinsAnalytics({
    baseRtp: bex.rtp,
    baseTier: bex.tier,
    betCoins: bet,
    featureBetCoins: feature.bet.coins,
    scatterDist,
    scatterMin: bm.triggerMin,
    featureDist: fd,
    cfg,
  });
  // E[X²] = E[B²] + 2 Σ_k E[B·1{K=k}]·E[F|k] + Σ_k P(K=k)·E[F²|k]  (F independent of B given K)
  let eX2 = eB2;
  let eX = eB;
  let hit = baseHit;
  for (const row of a.byK) {
    const ebk = eBk.get(row.k) ?? 0;
    eX += row.pK * row.value.expectedWinCoins;
    eX2 += 2 * ebk * row.value.expectedWinCoins + row.pK * row.value.secondMomentCoins;
    const pB0 = distProb(bd, (c, k) => c === 0 && k === row.k);
    hit += pB0 * (1 - row.value.pZero);
  }
  return {
    totalRtp: a.totalRtp,
    tier: a.tier,
    baseRtp: a.baseRtp,
    featureRtp: a.featureRtp,
    featureShare: a.featureShare,
    hitRate: hit,
    baseHitRate: baseHit,
    sdStakes: Math.sqrt(Math.max(0, eX2 - eX * eX)) / bet,
    featureFrequency: a.featureFrequency,
    averageFeatureWin: a.averageFeatureWinStakes,
    momentsTier: bd.tier === 'exact' && fd.tier === 'exact' ? 'exact' : 'mc',
  };
}

// --------------------------------------------------------------------------- pay entries

interface Ref {
  spec: 'base' | 'feature';
  kind: Kind;
  sym: string;
  count: string;
}

interface Entry {
  id: number;
  owner: 'both' | 'base' | 'feature';
  kind: Kind;
  sym: string;
  count: number;
  refs: Ref[];
  orig: number;
  /** Continuous value the scale multiplies. */
  x: number;
  /** Current integer coins. */
  v: number;
  fine: boolean;
  label: string;
}

interface Constraint {
  lo: number;
  hi: number;
  gap: number;
}

interface Work {
  base: SlotSpec;
  feature: SlotSpec | null;
  ctx: TotalContext;
  entries: Entry[];
  constraints: Constraint[];
  byEntry: Constraint[][];
  evals: number;
}

function collectEntries(base: SlotSpec, feature: SlotSpec | null, lockstep: boolean): Entry[] {
  const out: Entry[] = [];
  const add = (spec: SlotSpec, owner: 'both' | 'base' | 'feature', kind: Kind, sym: string, isBaseSide: boolean) => {
    const t = table(spec, kind, sym);
    if (!t) return;
    for (const [count, val] of Object.entries(t)) {
      const v = Number(val);
      if (!(v > 0)) continue;
      const refs: Ref[] = [{ spec: isBaseSide ? 'base' : 'feature', kind, sym, count }];
      if (owner === 'both') refs.push({ spec: 'feature', kind, sym, count });
      const id = kind === 'paytable' ? Number(sym) : -1;
      const name = kind === 'paytable' ? labelOf(spec, id) : kind === 'scatter' ? 'scatter' : 'wild';
      out.push({
        id: out.length,
        owner,
        kind,
        sym,
        count: Number(count),
        refs,
        orig: v,
        x: v,
        v,
        fine: owner !== 'feature',
        label: `${name} x${count}${owner === 'feature' ? ' (feature)' : ''}`,
      });
    }
  };
  const pass = (spec: SlotSpec, owner: 'both' | 'base' | 'feature', isBase: boolean) => {
    for (const sym of Object.keys(spec.pays.paytable)) add(spec, owner, 'paytable', sym, isBase);
    add(spec, owner, 'scatter', '', isBase);
    add(spec, owner, 'wild', '', isBase);
  };
  pass(base, lockstep ? 'both' : 'base', true);
  if (feature && !lockstep) pass(feature, 'feature', false);
  return out;
}

function buildConstraints(entries: Entry[]): Constraint[] {
  const out: Constraint[] = [];
  const groups = new Map<string, Entry[]>();
  for (const e of entries) {
    const g = `${e.owner}|${e.kind}|${e.sym}`;
    (groups.get(g) ?? groups.set(g, []).get(g)!).push(e);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a.count - b.count);
    for (let i = 1; i < list.length; i++) out.push({ lo: list[i - 1].id, hi: list[i].id, gap: 1 });
  }
  // symbol order at each count
  const byCount = new Map<string, Entry[]>();
  for (const e of entries) if (e.kind === 'paytable') (byCount.get(`${e.owner}|${e.count}`) ?? byCount.set(`${e.owner}|${e.count}`, []).get(`${e.owner}|${e.count}`)!).push(e);
  for (const list of byCount.values())
    for (const a of list) for (const b of list) if (a.orig > b.orig) out.push({ lo: b.id, hi: a.id, gap: 0 });
  return out;
}

function setupWork(base: SlotSpec, feature: SlotSpec | null, ctx: TotalContext): { work: Work; lockstep: boolean } {
  const lockstep = !!feature && samePays(base, feature);
  const entries = collectEntries(base, feature, lockstep);
  const constraints = buildConstraints(entries);
  const byEntry: Constraint[][] = entries.map(() => []);
  for (const c of constraints) {
    byEntry[c.lo].push(c);
    byEntry[c.hi].push(c);
  }
  return { work: { base, feature, ctx, entries, constraints, byEntry, evals: 0 }, lockstep };
}

function writeValues(w: Work): void {
  for (const e of w.entries)
    for (const r of e.refs) {
      const spec = r.spec === 'base' ? w.base : (w.feature as SlotSpec);
      const t = table(spec, r.kind, r.sym);
      if (t) t[r.count] = e.v;
    }
}

function totalNow(w: Work): number {
  writeValues(w);
  w.evals++;
  return totalRtp(w.ctx, w.base, w.feature);
}

/** Raise values until every constraint holds (order-preserving; only ever increases). */
function repair(w: Work): void {
  for (let pass = 0; pass < 200; pass++) {
    let changed = false;
    for (const c of w.constraints) {
      const lo = w.entries[c.lo];
      const hi = w.entries[c.hi];
      if (hi.v < lo.v + c.gap) {
        hi.v = lo.v + c.gap;
        changed = true;
      }
    }
    if (!changed) return;
  }
}

function feasible(w: Work, e: Entry, nv: number): boolean {
  if (nv < 1) return false;
  for (const c of w.byEntry[e.id]) {
    const lo = c.lo === e.id ? nv : w.entries[c.lo].v;
    const hi = c.hi === e.id ? nv : w.entries[c.hi].v;
    if (hi < lo + c.gap) return false;
  }
  return true;
}

/** Scale all pays so the total hits the target, round to integers, repeat on the continuous values. */
function solveScale(w: Work, target: number): number {
  let S = 1;
  let bestErr = Infinity;
  let bestV: number[] = w.entries.map((e) => e.v);
  let prev: string | null = null;
  for (let pass = 0; pass < 8; pass++) {
    for (const e of w.entries) e.v = Math.max(1, Math.round(e.x * S));
    repair(w);
    const key = w.entries.map((e) => e.v).join(',');
    const t = totalNow(w);
    const err = Math.abs(t - target);
    if (err < bestErr) {
      bestErr = err;
      bestV = w.entries.map((e) => e.v);
    }
    if (key === prev || t <= 0) break;
    prev = key;
    S *= target / t;
  }
  w.entries.forEach((e, i) => (e.v = bestV[i]));
  return totalNow(w);
}

/** Greedy ±k-coin steps on the fine entries until no step improves |total − target|. */
function fineTune(w: Work, target: number, log: (s: string) => void): number {
  let cur = totalNow(w);
  const fine = w.entries.filter((e) => e.fine);
  let grad: number[] | null = null;
  const banned = new Set<string>();
  const gradients = (): number[] => {
    const g = new Array<number>(w.entries.length).fill(0);
    for (const e of fine) {
      e.v += 1;
      g[e.id] = totalNow(w) - cur;
      e.v -= 1;
    }
    totalNow(w);
    return g;
  };
  for (let iter = 0; iter < 600; iter++) {
    const err = cur - target;
    if (err === 0) break;
    grad ??= gradients();
    let best: { e: Entry; nv: number; pred: number } | null = null;
    for (const e of fine) {
      const g = grad[e.id];
      if (!(Math.abs(g) > 0)) continue;
      const dir = err > 0 ? (g > 0 ? -1 : 1) : g > 0 ? 1 : -1; // direction that moves the total towards the target
      if (banned.has(`${e.id}|${dir}`)) continue;
      let k = Math.max(1, Math.round(Math.abs(err / g)));
      while (k > 0 && !feasible(w, e, e.v + dir * k)) k = k > 3 ? Math.floor(k / 2) : k - 1;
      if (k === 0) continue;
      const pred = Math.abs(err + dir * k * g);
      if (pred < Math.abs(err) - 1e-15 && (!best || pred < best.pred)) best = { e, nv: e.v + dir * k, pred };
    }
    if (!best) {
      if (banned.size) {
        // every improving move was refused: retry once with freshly measured gradients
        banned.clear();
        grad = null;
        if (iter > 300) break;
        continue;
      }
      break;
    }
    const old = best.e.v;
    best.e.v = best.nv;
    const t = totalNow(w);
    if (Math.abs(t - target) < Math.abs(cur - target) - 1e-15) {
      banned.clear();
      const predicted = Math.abs(err) - best.pred;
      const actual = Math.abs(err) - Math.abs(t - target);
      if (Math.abs(predicted - actual) > 1e-10) grad = null; // nonlinear region: re-measure the gradients
      cur = t;
    } else {
      best.e.v = old;
      banned.add(`${best.e.id}|${best.nv > old ? 1 : -1}`);
      cur = totalNow(w);
      grad = null;
    }
  }
  log(`fine-tune: ${w.evals} exact evaluations, |error| ${Math.abs(cur - target).toExponential(2)}`);
  return cur;
}

function tunePays(w: Work, target: number, log: (s: string) => void): number {
  solveScale(w, target);
  return fineTune(w, target, log);
}

// --------------------------------------------------------------------------- strips (--hit-rate)

/** Strips violating "circular gap between scatters ≥ rows" (reel set / reel). */
export function scatterGapViolations(spec: SlotSpec): string[] {
  const out: string[] = [];
  const sc = spec.symbols.filter((s) => s.role === 'scatter').map((s) => s.id);
  for (const rs of spec.board_law.reel_sets ?? [])
    rs.strips.forEach((strip, c) => {
      const pos: number[] = [];
      strip.forEach((s, i) => sc.includes(s) && pos.push(i));
      const rows = spec.geometry.rows[c];
      for (let i = 0; i < pos.length; i++) {
        const gap = i + 1 < pos.length ? pos[i + 1] - pos[i] : pos[0] + strip.length - pos[i];
        if (pos.length > 1 && gap < rows) out.push(`${rs.id} reel ${c + 1}: scatters ${gap} apart (< ${rows} rows)`);
      }
    });
  return out;
}

/** Reel sets with a wild on reel 1 (index 0). */
export function reel0Wilds(spec: SlotSpec): string[] {
  const wilds = spec.symbols.filter((s) => s.role === 'wild').map((s) => s.id);
  return (spec.board_law.reel_sets ?? []).filter((rs) => rs.strips[0]?.some((s) => wilds.includes(s))).map((rs) => rs.id);
}

/** Single-line proxy for the hit rate: Σ_s Π_{c < m_s} (n_s + n_wild)/L over reels, m_s = shortest paying run. */
function hitProxy(spec: SlotSpec): number {
  const wilds = new Set(spec.symbols.filter((s) => s.role === 'wild').map((s) => s.id));
  const sets = spec.board_law.reel_sets ?? [];
  const tot = sets.reduce((a, s) => a + Number(s.weight), 0);
  let proxy = 0;
  for (const rs of sets) {
    let ev = 0;
    for (const [sym, tbl] of Object.entries(spec.pays.paytable)) {
      const id = Number(sym);
      if (wilds.has(id) || roleOf(spec, id) === 'scatter') continue;
      const lens = Object.entries(tbl).filter(([, v]) => Number(v) > 0).map(([n]) => Number(n));
      if (!lens.length) continue;
      const m = Math.min(...lens);
      let p = 1;
      for (let c = 0; c < Math.min(m, rs.strips.length); c++) {
        const strip = rs.strips[c];
        let n = 0;
        for (const s of strip) if (s === id || wilds.has(s)) n++;
        p *= n / strip.length;
      }
      ev += p;
    }
    proxy += (Number(rs.weight) / tot) * ev;
  }
  return proxy;
}

/** The symbols whose stops may be moved: paying, not wild, not scatter. */
function movable(spec: SlotSpec): number[] {
  return Object.keys(spec.pays.paytable)
    .map(Number)
    .filter((id) => {
      const role = roleOf(spec, id);
      return role !== 'wild' && role !== 'scatter';
    });
}

/** One greedy pass of single-stop replacements towards a proxy goal; returns the number of edits. */
function moveStops(spec: SlotSpec, goal: number, maxEdits: number): number {
  const syms = movable(spec);
  let edits = 0;
  for (; edits < maxEdits; edits++) {
    const cur = hitProxy(spec);
    let best: { rs: number; c: number; a: number; b: number; d: number } | null = null;
    spec.board_law.reel_sets!.forEach((rs, ri) =>
      rs.strips.forEach((strip, c) => {
        const count = new Map<number, number>();
        for (const s of strip) count.set(s, (count.get(s) ?? 0) + 1);
        for (const a of syms)
          for (const b of syms) {
            if (a === b || (count.get(a) ?? 0) < 2) continue; // keep every symbol on every reel
            const i = strip.indexOf(a);
            strip[i] = b;
            const d = Math.abs(hitProxy(spec) - goal);
            strip[i] = a;
            if (!best || d < best.d) best = { rs: ri, c, a, b, d };
          }
      }),
    );
    if (!best || (best as { d: number }).d >= Math.abs(cur - goal) - 1e-15) break;
    const m = best as { rs: number; c: number; a: number; b: number };
    const strip = spec.board_law.reel_sets![m.rs].strips[m.c];
    // replace the stop of `a` with the fewest neighbours equal to `b` (avoids building stacks of b)
    let pos = -1;
    let bestN = Infinity;
    strip.forEach((s, i) => {
      if (s !== m.a) return;
      const n = (strip[(i + 1) % strip.length] === m.b ? 1 : 0) + (strip[(i - 1 + strip.length) % strip.length] === m.b ? 1 : 0);
      if (n < bestN) {
        bestN = n;
        pos = i;
      }
    });
    strip[pos] = m.b;
  }
  return edits;
}

/** Move the base hit rate towards `target` by strip edits; returns the edit count. Re-run the pay tune after. */
function tuneHitRate(base: SlotSpec, feature: SlotSpec | null, target: number, log: (s: string) => void): { edits: number; mirrored: boolean } {
  const mirror = !!feature && sameStrips(base, feature);
  const gaps0 = scatterGapViolations(base).length;
  const wild0 = reel0Wilds(base).length;
  const flat = (s: SlotSpec) => JSON.stringify(s.board_law.reel_sets!.map((r) => r.strips.map((st) => st.map((x) => (movable(s).includes(x) ? 0 : x)))));
  const frozen = flat(base);
  let edits = 0;
  for (let round = 0; round < 6; round++) {
    const h = distProb(spinDistribution(base), (c) => c > 0);
    if (Math.abs(h - target) <= 0.002) break;
    const goal = (hitProxy(base) * target) / h;
    const n = moveStops(base, goal, 400);
    log(`hit rate round ${round + 1}: exact ${(h * 100).toFixed(2)}% -> target ${(target * 100).toFixed(2)}%, ${n} stop edits (proxy goal ${goal.toFixed(5)})`);
    edits += n;
    if (!n) break;
  }
  if (flat(base) !== frozen) throw new Error('strip edit touched a wild or scatter stop');
  if (scatterGapViolations(base).length > gaps0) throw new Error('strip edit broke the scatter minimum-gap rule');
  if (reel0Wilds(base).length > wild0) throw new Error('strip edit put a wild on reel 1');
  if (mirror && feature) feature.board_law = clone(base.board_law);
  return { edits, mirrored: mirror };
}

// --------------------------------------------------------------------------- volatility (--volatility)

function volatilityTarget(sd: number, band: Volatility): number | null {
  const [lo, hi] = VOLATILITY_BANDS[band];
  const w = Number.isFinite(hi) ? hi - lo : 10;
  if (sd < lo) return lo + 0.15 * w;
  if (sd > hi) return hi - 0.15 * w;
  return null;
}

function shapePays(w: Work, gamma: number): void {
  const vals = w.entries.filter((e) => e.kind === 'paytable').map((e) => e.orig).sort((a, b) => a - b);
  const ref = vals.length ? vals[Math.floor(vals.length / 2)] : 1;
  for (const e of w.entries) e.x = e.orig * Math.pow(e.orig / ref, gamma);
}

function tuneVolatility(w: Work, target: number, band: Volatility, log: (s: string) => void, notes: string[]): void {
  const cfg = w.ctx.cfg;
  const sdAt = (gamma: number): number => {
    shapePays(w, gamma);
    solveScale(w, target);
    return measure(w.base, w.feature, cfg).sdStakes;
  };
  const sd0 = sdAt(0);
  const goal = volatilityTarget(sd0, band);
  if (goal === null) {
    notes.push(`SD per spin ${sd0.toFixed(2)} is already inside the ${band} band (${VOLATILITY_BANDS[band][0]}-${VOLATILITY_BANDS[band][1]}); pay shape unchanged`);
    shapePays(w, 0);
    return;
  }
  const up = sd0 < goal;
  let lo = 0;
  let hi = up ? 0.5 : -0.25;
  const lim = up ? 4 : -0.85;
  let sdHi = sdAt(hi);
  while (up ? sdHi < goal && hi < lim : sdHi > goal && hi > lim) {
    lo = hi;
    hi = up ? hi + 0.75 : Math.max(lim, hi - 0.25);
    sdHi = sdAt(hi);
  }
  let gamma = hi;
  if (up ? sdHi < goal : sdHi > goal) {
    notes.push(`pay shape alone cannot reach SD ${goal.toFixed(2)}: γ = ${hi.toFixed(2)} gives ${sdHi.toFixed(2)} (strip levers are not automated)`);
  } else {
    for (let i = 0; i < 12; i++) {
      gamma = (lo + hi) / 2;
      const sd = sdAt(gamma);
      if (Math.abs(sd - goal) < 0.02 * goal) break;
      if (up ? sd < goal : sd > goal) lo = gamma;
      else hi = gamma;
    }
  }
  log(`volatility: pay shape γ = ${gamma.toFixed(3)} (pay' = pay · (pay/median)^γ)`);
  shapePays(w, gamma);
}

// --------------------------------------------------------------------------- the tuner

export function tuneGame(baseIn: SlotSpec, featureIn: SlotSpec | null, cfg: FreeSpinsConfig | null, targetRtp: number, opts: TuneOptions = {}): TuneResult {
  const log = opts.log ?? (() => undefined);
  const tol = opts.tolerance ?? 0.0005;
  refuse(baseIn, 'base spec');
  if (cfg && !featureIn) throw new Error('slot.config.json names a feature but its spec was not provided');
  if (featureIn && cfg) refuse(featureIn, 'feature spec');
  const base = clone(baseIn);
  const feature = cfg && featureIn ? clone(featureIn) : null;
  const useCfg = feature ? cfg : null;
  const notes: string[] = [];
  const before = measure(base, feature, useCfg);

  let stripEdits = 0;
  if (opts.hitRate !== undefined) {
    const r = tuneHitRate(base, feature, opts.hitRate, log);
    stripEdits = r.edits;
    if (r.mirrored) notes.push('feature spec strips kept equal to the base strips');
  }

  const ctx = makeTotalContext(base, feature, useCfg);
  const { work, lockstep } = setupWork(base, feature, ctx);
  if (feature) notes.push(lockstep ? 'feature pays equal the base pays: tuned in lockstep' : 'feature pays differ from the base pays: scaled together, base pays fine-tuned only');
  if (opts.volatility) tuneVolatility(work, targetRtp, opts.volatility, log, notes);
  tunePays(work, targetRtp, log);
  const after = measure(base, feature, useCfg);
  if (opts.volatility) {
    const [lo, hi] = VOLATILITY_BANDS[opts.volatility];
    if (after.sdStakes < lo || after.sdStakes > hi) notes.push(`SD per spin ${after.sdStakes.toFixed(2)} is outside the ${opts.volatility} band ${lo}-${hi}`);
  }
  const error = Math.abs(after.totalRtp - targetRtp);
  const payChanges: PayChange[] = work.entries
    .filter((e) => e.orig !== e.v)
    .map((e) => ({ label: `${e.label}`, before: e.orig, after: e.v }));
  return { base, feature, before, after, targetRtp, error, withinTolerance: error <= tol, lockstep, payChanges, stripEdits, notes };
}

/** Every pay as a labelled row (for the before/after table), in spec order, zero pays dropped. */
export function listPays(base: SlotSpec): { label: string; sym: string; count: number; value: number }[] {
  const e = collectEntries(base, null, false);
  return e.map((x) => ({ label: x.label, sym: x.kind === 'paytable' ? labelOf(base, Number(x.sym)) : x.kind, count: x.count, value: x.orig }));
}
