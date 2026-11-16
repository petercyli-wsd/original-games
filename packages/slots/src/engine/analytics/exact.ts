// Exact base-round RTP: the pack's closed forms, ported (docs/SLOTS.md §2.4).
//
// Reels are independent uniform stops on circular strips (§2.1), so every quantity is a sum
// over the product-form components (one per weighted reel set) of per-reel window statistics:
//
//   payline      Every strip is stationary (each window row shows the strip's composition
//                marginal), so one line's EV is a single enumeration over the per-reel
//                composition marginals and the line EV is that × the number of lines
//                (`reelengine.analytics.payline`, `composed.payline_ev`). The direction /
//                anchor variants use the same enumeration with the variant's line value.
//   ways         For symbol s and reel c: m_c = E[count_c], q_c = P(count_c = 0) with
//                count_c = n_s + w·n_wild. Anchor left: EV(s) = Σ_k pay[s][k] Π_{c<k} m_c ·
//                (q_k if k < cols). Anchor any: Σ over reel subsets A, |A| = k, of
//                pay[s][k] Π_{c∈A} m_c Π_{c∉A} q_c (`composed.ways_ev`).
//   scatter pays EV(s) = Σ_n P(N_s = n) pay[s][n], N_s = visible s + wilds, by convolving
//                the per-reel count pmfs (`analytics.scatter_pays`).
//   scatter      The total visible scatter count by the same convolution: the scatter pay
//                EV and the trigger probability P(K ≥ scatter_min).
//
// Equality with `enginepack.base.analytics` to 1e-9 is tested on every no-mechanic pack example
// in these contexts (exact.test.ts, fixtures/pack-analytics.json).

import type { SlotSpec } from '../types';
import { asModel, buildModel, lineValue, NoClosedForm, type Component, type SlotModel } from './model';

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

/** Per-reel composition marginal [(sym, p)] string-sorted (the kernel's enumeration order). */
function composition(strip: number[]): [number, number][] {
  const cnt = new Map<number, number>();
  for (const s of strip) cnt.set(s, (cnt.get(s) ?? 0) + 1);
  return [...cnt.entries()]
    .sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : String(a[0]) > String(b[0]) ? 1 : 0))
    .map(([s, c]) => [s, c / strip.length]);
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

function paylineEv(m: SlotModel, comp: Component): number {
  const law = m.law;
  if (law.kind !== 'payline') throw new Error('unreachable');
  // physical strips are stationary: every line reads the composition marginal per reel
  const pmfs = comp.strips.map(composition);
  let states = 1;
  for (const p of pmfs) states *= p.length;
  if (states > 5_000_000) throw new NoClosedForm(`line state space ${states} exceeds the guard`);
  return enumerateLine(pmfs, (syms) => lineValue(m, syms)) * law.rowsIdx.length;
}

function waysEv(m: SlotModel, comp: Component): number {
  const law = m.law;
  if (law.kind !== 'ways') throw new Error('unreachable');
  const cols = m.cols;
  let total = 0;
  for (const s of m.paying) {
    const tbl = m.paytable[String(s)];
    const mq = comp.windows.map((wins) => {
      let mm = 0;
      let q = 0;
      for (const { win, p } of wins) {
        let cnt = 0;
        for (const v of win) if (v === s) cnt++;
        else if (m.wilds.has(v)) cnt += law.wildMultiplier;
        mm += p * cnt;
        if (cnt === 0) q += p;
      }
      return [mm, q] as const;
    });
    if (law.anchor === 'left') {
      let prod = 1;
      for (let k = 1; k <= cols; k++) {
        prod *= mq[k - 1][0];
        const pay = tbl[String(k)] ?? 0;
        if (pay) total += pay * prod * (k < cols ? mq[k][1] : 1);
      }
    } else {
      for (let mask = 1; mask < 1 << cols; mask++) {
        let k = 0;
        let v = 1;
        for (let c = 0; c < cols; c++) {
          if (mask & (1 << c)) {
            k++;
            v *= mq[c][0];
          } else v *= mq[c][1];
        }
        const pay = tbl[String(k)] ?? 0;
        if (pay) total += pay * v;
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

function scatterPaysEv(m: SlotModel, comp: Component): number {
  const law = m.law;
  if (law.kind !== 'scatter_pays') throw new Error('unreachable');
  let total = 0;
  for (const s of m.paying) {
    const tbl = m.paytable[String(s)];
    const syms = new Set<number>([s, ...m.wilds]);
    const dist = convolve(comp.windows.map((w) => reelCountPmf(w, syms)));
    for (let n = law.minCount; n < dist.length; n++) if (dist[n]) total += dist[n] * (tbl[String(n)] ?? 0);
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
    main += comp.weight * ev;
    if (m.scatter !== null) {
      const d = componentScatterDist(m, comp);
      d.forEach((p, k) => {
        scatterEv += comp.weight * p * (m.scatterPay[String(k)] ?? 0);
        if (m.triggerMin !== null && k >= m.triggerMin) triggerP += comp.weight * p;
      });
    }
  }
  const reasons = [
    `board_law global_mixture (${m.components.length} reel set${m.components.length > 1 ? 's' : ''}): product-form components`,
    m.law.kind === 'payline'
      ? `payline: single-line enumeration over strip compositions × ${m.law.rowsIdx.length} lines (direction=${m.law.direction}, anchor=${m.law.anchor})`
      : m.law.kind === 'ways'
        ? `ways: per-reel (m, q) factorisation (anchor=${m.law.anchor}, wild_multiplier=${m.law.wildMultiplier})`
        : `scatter_pays: per-symbol count convolution (min_count=${m.law.minCount})`,
    'scatter: count convolution',
  ];
  return {
    rtp: (main + scatterEv) / m.betCoins,
    tier: 'exact',
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
