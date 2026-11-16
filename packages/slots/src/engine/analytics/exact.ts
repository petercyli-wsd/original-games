// Exact base-round RTP: the pack's closed forms, ported (docs/SLOTS.md §2.4).
//
// Reels are independent uniform stops on circular strips (§2.1), so every quantity is a sum
// over the product-form components (one per weighted reel set × mechanic mixture outcome,
// model.ts / mechanics.ts) of per-reel WINDOW statistics (never the strips, so a transformed or
// hand-built model works):
//
//   payline      When every reel is stationary (each window row shows the same marginal, true
//                for a physical strip) one line's EV is a single enumeration over the per-reel
//                row marginals and the line EV is that × the number of lines; otherwise (an
//                expanded or walked reel) line by line over each line's row marginals
//                (`composed.payline_ev` / `_stationary`). The direction / anchor variants use
//                the same enumeration with the variant's line value.
//   ways         For symbol s and reel c: m_c = E[count_c], q_c = P(count_c = 0) with
//                count_c = n_s + w·n_wild. Anchor left: EV(s) = Σ_k pay[s][k] Π_{c<k} m_c ·
//                (q_k if k < cols). Anchor any: Σ over reel subsets A, |A| = k, of
//                pay[s][k] Π_{c∈A} m_c Π_{c∉A} q_c (`composed.ways_ev`).
//   scatter pays EV(s) = Σ_n P(N_s = n) pay[s][n], N_s = visible s + wilds, by convolving
//                the per-reel count pmfs (`analytics.scatter_pays`).
//   scatter      The total visible scatter count by the same convolution: the scatter pay
//                EV and the trigger probability P(K ≥ scatter_min).
//   multipliers  global_iid: × E[M] (ConstFactor). global_additive: × (base + E[V]·N), N the
//                visible wilds, exact by conditioning (payline: E[N | line cells] reel by reel;
//                ways: E[cnt·N] reel by reel; scatter pays: the joint count convolution). Never
//                on the scatter pay.
//
// Equality with `enginepack.base.analytics` to 1e-9 is tested on every no-mechanic pack example
// in these contexts (exact.test.ts, fixtures/pack-analytics.json) and on every pack example and
// batch game with the five exact mechanic families (mechanics.test.ts, fixtures/pack-mechanics.json).

import type { SlotSpec } from '../types';
import { asModel, buildModel, lineValue, NoClosedForm, type Component, type ReelWindow, type SlotModel } from './model';

export interface ExactRtp {
  rtp: number;
  tier: 'exact' | 'exact_mixture';
  /** Expected evaluator coins (lines / ways / count pays) per spin. */
  mainEvCoins: number;
  /** Expected scatter-pay coins per spin. */
  scatterEvCoins: number;
  /** P(K ≥ scatter_min); 0 without a trigger. */
  triggerP: number;
  reasons: string[];
}

/** Per-reel row marginal [(sym, p)] of window row r, string-sorted (the kernel's enumeration order). */
export function rowMarginal(windows: ReelWindow[], r: number): [number, number][] {
  const acc = new Map<number, number>();
  for (const { win, p } of windows) acc.set(win[r], (acc.get(win[r]) ?? 0) + p);
  return [...acc.entries()].sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : String(a[0]) > String(b[0]) ? 1 : 0));
}

/** Every row of the reel shows the same marginal (`composed._stationary`; true for physical strips). */
function stationary(windows: ReelWindow[], height: number, tol = 1e-12): boolean {
  const first = rowMarginal(windows, 0);
  for (let r = 1; r < height; r++) {
    const other = rowMarginal(windows, r);
    if (other.length !== first.length) return false;
    for (let i = 0; i < first.length; i++) if (other[i][0] !== first[i][0] || Math.abs(other[i][1] - first[i][1]) > tol) return false;
  }
  return true;
}

/** sym → E[count of target in the window | window[r] = sym] (`ReelCatalog.cond_count_mean`). */
function condCountMean(windows: ReelWindow[], r: number, target: Set<number>): Map<number, number> {
  const num = new Map<number, number>();
  const den = new Map<number, number>();
  for (const { win, p } of windows) {
    let n = 0;
    for (const v of win) if (target.has(v)) n++;
    num.set(win[r], (num.get(win[r]) ?? 0) + p * n);
    den.set(win[r], (den.get(win[r]) ?? 0) + p);
  }
  const out = new Map<number, number>();
  for (const [s, d] of den) out.set(s, d ? num.get(s)! / d : 0);
  return out;
}

/** Σ over the cartesian product of the per-reel marginals of p · value(syms). */
function enumerateLine(pmfs: [number, number][][], value: (syms: number[]) => number): number {
  const cols = pmfs.length;
  const syms = new Array<number>(cols);
  let ev = 0;
  const rec = (c: number, p: number) => {
    if (c === cols) {
      const v = value(syms);
      if (v) ev += p * v;
      return;
    }
    for (const [s, pr] of pmfs[c]) {
      syms[c] = s;
      rec(c + 1, p * pr);
    }
  };
  rec(0, 1);
  return ev;
}

const MAX_LINE_STATES = 5_000_000;

function guardLine(pmfs: [number, number][][]): void {
  let states = 1;
  for (const p of pmfs) states *= Math.max(p.length, 1);
  if (states > MAX_LINE_STATES) throw new NoClosedForm(`line state space ${states} exceeds the guard`);
}

/**
 * Payline EV of one component over its (transformed) windows (`composed.payline_ev`): when every
 * reel is stationary and there is no count factor, one enumeration over the row marginals × the
 * number of lines; otherwise line by line over each line's per-reel row marginals, with the
 * affine factor's E[N | cells] = Σ_c E[count_c | window_c[row_c] = cell_c].
 */
function paylineEv(m: SlotModel, comp: Component): number {
  const law = m.law;
  if (law.kind !== 'payline') throw new Error('unreachable');
  const affine = m.post.affine;
  const value = (syms: number[]) => lineValue(m, syms);
  if (!affine && comp.windows.every((w, c) => stationary(w, m.rows[c]))) {
    const pmfs = comp.windows.map((w) => rowMarginal(w, 0));
    guardLine(pmfs);
    return enumerateLine(pmfs, value) * law.rowsIdx.length;
  }
  let total = 0;
  for (const ri of law.rowsIdx) {
    const pmfs = comp.windows.map((w, c) => rowMarginal(w, ri[c]));
    guardLine(pmfs);
    if (!affine) {
      total += enumerateLine(pmfs, value);
      continue;
    }
    const cond = comp.windows.map((w, c) => condCountMean(w, ri[c], affine.target));
    total += enumerateLine(pmfs, (syms) => {
      const v = value(syms);
      if (!v) return 0;
      let n = 0;
      for (let c = 0; c < syms.length; c++) n += cond[c].get(syms[c]) ?? 0;
      return v * (affine.base + affine.slope * n);
    });
  }
  return total;
}

/**
 * Ways EV (`composed.ways_ev`): per symbol and reel m = E[cnt], q = P(cnt = 0), and with an
 * affine count factor n = E[N], mn = E[cnt·N], zn = E[N·1(cnt = 0)]; reels are independent, so
 * every shape's expectation factorises reel by reel.
 */
function waysEv(m: SlotModel, comp: Component): number {
  const law = m.law;
  if (law.kind !== 'ways') throw new Error('unreachable');
  const cols = m.cols;
  const affine = m.post.affine;
  const target = affine?.target;
  const shapes: { active: boolean[]; zero: boolean[]; k: number }[] = [];
  if (law.anchor === 'left') {
    for (let k = 1; k <= cols; k++)
      shapes.push({ active: Array.from({ length: cols }, (_, c) => c < k), zero: Array.from({ length: cols }, (_, c) => c === k), k });
  } else {
    for (let mask = 1; mask < 1 << cols; mask++) {
      const active = Array.from({ length: cols }, (_, c) => !!(mask & (1 << c)));
      shapes.push({ active, zero: active.map((a) => !a), k: active.filter(Boolean).length });
    }
  }
  let total = 0;
  for (const s of m.paying) {
    const tbl = m.paytable[String(s)];
    const st = comp.windows.map((wins) => {
      let mm = 0, q = 0, n = 0, mn = 0, zn = 0;
      for (const { win, p } of wins) {
        let cnt = 0;
        let nt = 0;
        for (const v of win) {
          if (v === s) cnt++;
          else if (m.wilds.has(v)) cnt += law.wildMultiplier;
          if (target && target.has(v)) nt++;
        }
        mm += p * cnt;
        n += p * nt;
        mn += p * cnt * nt;
        if (cnt === 0) {
          q += p;
          zn += p * nt;
        }
      }
      return [mm, q, n, mn, zn] as const;
    });
    const expect = (active: boolean[], zero: boolean[], j: number) => {
      let v = 1;
      for (let c = 0; c < cols; c++) {
        const [mm, q, n, mn, zn] = st[c];
        if (active[c]) v *= c === j ? mn : mm;
        else if (zero[c]) v *= c === j ? zn : q;
        else if (c === j) v *= n;
      }
      return v;
    };
    for (const { active, zero, k } of shapes) {
      const pay = tbl[String(k)] ?? 0;
      if (!pay) continue;
      const base = expect(active, zero, -1);
      if (!affine) total += pay * base;
      else {
        let nsum = 0;
        for (let j = 0; j < cols; j++) nsum += expect(active, zero, j);
        total += pay * (affine.base * base + affine.slope * nsum);
      }
    }
  }
  return total;
}

/** Sum of independent integer counts: per-reel pmfs (index = count) → pmf of the total. */
export function convolve(pmfs: number[][]): number[] {
  let dist = [1];
  for (const pmf of pmfs) {
    const next = new Array<number>(dist.length + pmf.length - 1).fill(0);
    for (let a = 0; a < dist.length; a++) {
      if (!dist[a]) continue;
      for (let b = 0; b < pmf.length; b++) if (pmf[b]) next[a + b] += dist[a] * pmf[b];
    }
    dist = next;
  }
  return dist;
}

/** Per-reel pmf of the number of visible cells in `syms`. */
export function reelCountPmf(windows: { win: number[]; p: number }[], syms: Set<number>): number[] {
  const out: number[] = [];
  for (const { win, p } of windows) {
    let k = 0;
    for (const v of win) if (syms.has(v)) k++;
    while (out.length <= k) out.push(0);
    out[k] += p;
  }
  return out;
}

/** Per-reel joint pmf [a][b] of (cells in symsA, cells in symsB). */
function reelJointPmf(windows: ReelWindow[], a: Set<number>, b: Set<number>): number[][] {
  const out: number[][] = [];
  for (const { win, p } of windows) {
    let x = 0;
    let y = 0;
    for (const v of win) {
      if (a.has(v)) x++;
      if (b.has(v)) y++;
    }
    while (out.length <= x) out.push([]);
    while (out[x].length <= y) out[x].push(0);
    out[x][y] += p;
  }
  return out;
}

function convolveJoint(pmfs: number[][][]): number[][] {
  let dist: number[][] = [[1]];
  for (const pmf of pmfs) {
    const next: number[][] = [];
    for (let a = 0; a < dist.length; a++)
      for (let b = 0; b < dist[a].length; b++) {
        const pd = dist[a][b];
        if (!pd) continue;
        for (let x = 0; x < pmf.length; x++)
          for (let y = 0; y < pmf[x].length; y++) {
            const q = pmf[x][y];
            if (!q) continue;
            while (next.length <= a + x) next.push([]);
            const row = next[a + x];
            while (row.length <= b + y) row.push(0);
            row[b + y] += pd * q;
          }
      }
    dist = next;
  }
  return dist;
}

/** Scatter-pays EV (`composed.scatter_pays_ev`): count convolution, joint with the affine target count. */
function scatterPaysEv(m: SlotModel, comp: Component): number {
  const law = m.law;
  if (law.kind !== 'scatter_pays') throw new Error('unreachable');
  const affine = m.post.affine;
  let total = 0;
  for (const s of m.paying) {
    const tbl = m.paytable[String(s)];
    const syms = new Set<number>([s, ...m.wilds]);
    if (!affine) {
      const dist = convolve(comp.windows.map((w) => reelCountPmf(w, syms)));
      for (let n = law.minCount; n < dist.length; n++) if (dist[n]) total += dist[n] * (tbl[String(n)] ?? 0);
      continue;
    }
    const joint = convolveJoint(comp.windows.map((w) => reelJointPmf(w, syms, affine.target)));
    for (let a = law.minCount; a < joint.length; a++) {
      const pay = tbl[String(a)] ?? 0;
      if (!pay) continue;
      for (let b = 0; b < joint[a].length; b++) if (joint[a][b]) total += joint[a][b] * pay * (affine.base + affine.slope * b);
    }
  }
  return total;
}

/** P(K = k) of the total visible scatter count on one component. */
export function componentScatterDist(m: SlotModel, comp: Component): number[] {
  if (m.scatter === null) return [1];
  const sc = new Set([m.scatter]);
  return convolve(comp.windows.map((w) => reelCountPmf(w, sc)));
}

/** Exact P(K = k), the visible scatter count, mixed over the reel sets. Index = k. */
export function scatterCountDist(specOrModel: SlotSpec | SlotModel): number[] {
  const m = asModel(specOrModel);
  if (!m.components.length) throw new NoClosedForm(m.closedFormRefusal ?? 'no reel sets');
  const out: number[] = [];
  for (const comp of m.components) {
    const d = componentScatterDist(m, comp);
    d.forEach((p, k) => {
      while (out.length <= k) out.push(0);
      out[k] += comp.weight * p;
    });
  }
  return out;
}

/** Exact P(base spin triggers) = P(K ≥ scatter_min). Matches the pack's `trigger_p`. */
export function triggerProbability(specOrModel: SlotSpec | SlotModel): number {
  const m = asModel(specOrModel);
  if (m.triggerMin === null) return 0;
  const d = scatterCountDist(m);
  let p = 0;
  for (let k = m.triggerMin; k < d.length; k++) p += d[k];
  return p;
}

/** The exact base-round RTP (throws NoClosedForm, with the reason, outside the ported scope). */
export function exactRtp(specOrModel: SlotSpec | SlotModel): ExactRtp {
  const m = asModel(specOrModel);
  if (m.closedFormRefusal) throw new NoClosedForm(m.closedFormRefusal);
  let main = 0;
  let scatterEv = 0;
  let triggerP = 0;
  for (const comp of m.components) {
    const ev = m.law.kind === 'payline' ? paylineEv(m, comp) : m.law.kind === 'ways' ? waysEv(m, comp) : scatterPaysEv(m, comp);
    main += comp.weight * ev * m.post.constFactor;
    if (m.scatter !== null) {
      const d = componentScatterDist(m, comp);
      d.forEach((p, k) => {
        scatterEv += comp.weight * p * (m.scatterPay[String(k)] ?? 0);
        if (m.triggerMin !== null && k >= m.triggerMin) triggerP += comp.weight * p;
      });
    }
  }
  const reasons = [
    `board_law global_mixture (${m.components.length} component${m.components.length > 1 ? 's' : ''}): product-form components over per-reel window catalogs`,
    m.law.kind === 'payline'
      ? `payline: enumeration over the windows' row marginals (one line × ${m.law.rowsIdx.length} when every reel is stationary, else line by line; direction=${m.law.direction}, anchor=${m.law.anchor})`
      : m.law.kind === 'ways'
        ? `ways: per-reel (m, q) factorisation (anchor=${m.law.anchor}, wild_multiplier=${m.law.wildMultiplier})`
        : `scatter_pays: per-symbol count convolution (min_count=${m.law.minCount})`,
    'scatter: count convolution',
    ...m.mechanicLabels,
  ];
  return {
    rtp: (main + scatterEv) / m.betCoins,
    tier: m.tier,
    mainEvCoins: main,
    scatterEvCoins: scatterEv,
    triggerP,
    reasons,
  };
}

/** True when `exactRtp` has a closed form for this spec. */
export function hasClosedForm(spec: SlotSpec): boolean {
  return buildModel(spec).closedFormRefusal === null;
}
