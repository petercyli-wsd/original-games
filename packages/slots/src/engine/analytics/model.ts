// The analytic model of a game_spec_v2: reel-set components with per-reel window catalogs,
// and an independent board evaluator for the pack's three closed-form evaluation laws.
//
// This mirrors the pack's adapter (`reelengine.adapter.to_reel_engine_record`), its strip reels
// (`reelengine.reelsystem.StripReel`: one uniform stop per reel on a circular strip, the
// window is `rows[c]` consecutive cells) and its evaluators:
//   payline      `slotlab.kernel.generic.eval_line` + the direction / anchor variants
//                (`reelengine.evaluators.payline.PaylineEvaluator.runs`)
//   ways         `slotlab.kernel.ways.ways_wins` + the anchor / wild_multiplier variants
//   scatter_pays `scatter_analytics.evaluator.evaluate_board` (count anywhere, no tumble)
// plus the scatter pay on the total visible scatter count (`scatter_pay[str(n)]`, 0 when absent).
//
// The mechanic families with an exact law (walking_wild, expanding_wild, mystery_reveal,
// global_iid, global_additive; ./mechanics.ts) are folded in: their window maps / mixtures expand
// `components` (reel set × mixture outcome, windows transformed), and their multipliers of the
// evaluator coins are `post`. The closed forms and the enumeration read the WINDOWS, never the
// strips (the strips stay for stop sampling, with `colMap`).
//
// Anything outside that (other mechanics, cluster, connected ways, height laws, a top reel,
// per-reel pools, window catalogs) has no closed form here: `closedFormRefusal` names the reason
// and the caller falls back to Monte Carlo (analytics/mc.ts).

import type { SlotSpec } from '../types';
import { expandComponents, expansionSize, MAX_COMPONENTS, mechanicLaws, type PostLaw } from './mechanics';

export type PaylineDirection = 'left' | 'both_max' | 'both_additive';
export type Anchor = 'left' | 'any';

export type EvalLaw =
  | {
      kind: 'payline';
      /** Row read on each reel, per line (positions already converted). */
      rowsIdx: number[][];
      direction: PaylineDirection;
      anchor: Anchor;
      wildOwn: Record<string, number>;
    }
  | { kind: 'ways'; anchor: Anchor; wildMultiplier: number }
  | { kind: 'scatter_pays'; minCount: number };

/** One distinct window a reel can show and its probability (identical windows merged). */
export interface ReelWindow {
  win: number[];
  p: number;
}

/** A product-form component: one weighted reel set (× one mixture outcome of the mechanics). */
export interface Component {
  /** Set weight ÷ total weight (× the outcome's probability). */
  weight: number;
  /** The reel set's physical strips (stop sampling only: the closed forms read `windows`). */
  strips: number[][];
  /** Per reel, its distinct windows (after the mechanics' window maps). */
  windows: ReelWindow[][];
  /** The mechanics' window maps for a sampled column (absent = identity). */
  colMap?: (c: number, col: number[]) => number[];
  /** The mixture outcome, when the mechanics expanded the set. */
  label?: string;
}

export interface SlotModel {
  spec: SlotSpec;
  cols: number;
  rows: number[];
  betCoins: number;
  wilds: Set<number>;
  scatter: number | null;
  law: EvalLaw;
  /** symbol id (string) → count (string) → coins */
  paytable: Record<string, Record<string, number>>;
  /** Paying symbols for ways / scatter pays (paytable keys that are not wild or scatter). */
  paying: number[];
  scatterPay: Record<string, number>;
  triggerMin: number | null;
  components: Component[];
  /** What multiplies the evaluator coins (global_iid / global_additive); never the scatter pay. */
  post: PostLaw;
  /** 'exact_mixture' when a mixture term (walking_wild, mystery_reveal) is involved. */
  tier: 'exact' | 'exact_mixture';
  /** One line per mechanic law. */
  mechanicLabels: string[];
  /** Non-null when this spec has no closed form here (the reason, by name). */
  closedFormRefusal: string | null;
}

export class NoClosedForm extends Error {
  constructor(reason: string) {
    super(`no closed form: ${reason}`);
    this.name = 'NoClosedForm';
  }
}

function windowsOf(strip: number[], height: number): ReelWindow[] {
  const L = strip.length;
  const acc = new Map<string, ReelWindow>();
  for (let s = 0; s < L; s++) {
    const win: number[] = [];
    for (let i = 0; i < height; i++) win.push(strip[(s + i) % L]);
    const key = win.join(',');
    const e = acc.get(key);
    if (e) e.p += 1 / L;
    else acc.set(key, { win, p: 1 / L });
  }
  // deterministic order (string-sorted, as the pack's ReelCatalog)
  return [...acc.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map((e) => e[1]);
}

/** Build the analytic model of a spec. Never throws for an unsupported spec: it sets `closedFormRefusal`. */
export function buildModel(spec: SlotSpec): SlotModel {
  const cols = spec.geometry.cols;
  const rows = [...spec.geometry.rows];
  const wilds = new Set<number>(spec.symbols.filter((s) => s.role === 'wild').map((s) => s.id));
  const scatters = spec.symbols.filter((s) => s.role === 'scatter').map((s) => s.id).sort((a, b) => (String(a) < String(b) ? -1 : 1));
  const scatter = scatters.length ? scatters[0] : null;
  const refusals: string[] = [];

  const ev = spec.evaluation as Record<string, unknown>;
  let law: EvalLaw;
  if (ev.kind === 'payline') {
    const positions = !!ev.paylines_are_positions;
    const lines = (ev.paylines as number[][] | undefined) ?? [];
    const rowsIdx = lines.map((pat) => pat.map((p) => (positions ? Math.floor(p / cols) : p)));
    const direction = (ev.direction as PaylineDirection | undefined) ?? 'left';
    const anchor = (ev.anchor as Anchor | undefined) ?? 'left';
    const wildOwn: Record<string, number> = {};
    for (const [k, v] of Object.entries((ev.wild_own_pay as Record<string, number> | undefined) ?? {})) wildOwn[String(k)] = Number(v);
    if (!['left', 'both_max', 'both_additive'].includes(direction)) refusals.push(`payline direction ${direction}`);
    if (!['left', 'any'].includes(anchor)) refusals.push(`payline anchor ${anchor}`);
    law = { kind: 'payline', rowsIdx, direction, anchor, wildOwn };
  } else if (ev.kind === 'ways') {
    const anchor = (ev.anchor as Anchor | undefined) ?? 'left';
    let wm = 1;
    if (ev.x2_per_wild) wm = 2;
    if (ev.wild_multiplier !== undefined) wm = Number(ev.wild_multiplier);
    if (ev.adjacency !== undefined && ev.adjacency !== 'none')
      refusals.push(`ways adjacency ${String(ev.adjacency)}: connected paths couple the rows across reels (the pack labels it mc)`);
    law = { kind: 'ways', anchor, wildMultiplier: wm };
  } else if (ev.kind === 'scatter_pays') {
    law = { kind: 'scatter_pays', minCount: Number(ev.min_count) };
  } else {
    refusals.push(`evaluation ${String(ev.kind)}: a cascade (the pack labels it mc)`);
    law = { kind: 'scatter_pays', minCount: Number.POSITIVE_INFINITY };
  }

  const laws = mechanicLaws(spec, cols, wilds, scatter);
  refusals.push(...laws.refusals);
  const hl = (spec as Record<string, unknown>).height_law as { kind?: string } | undefined;
  if (hl && hl.kind && hl.kind !== 'fixed') refusals.push(`height_law ${hl.kind}`);
  if ((spec.geometry as Record<string, unknown>).top_reel != null) refusals.push('geometry.top_reel');

  const bl = spec.board_law;
  const components: Component[] = [];
  if ((bl.kind === 'reel_set_mixture' || bl.kind === 'strips_uniform') && bl.reel_sets?.length) {
    const tot = bl.reel_sets.reduce((a, s) => a + Number(s.weight), 0);
    for (const rs of bl.reel_sets) {
      if (rs.strips.length !== cols) refusals.push(`reel set ${rs.id}: ${rs.strips.length} strips for ${cols} reels`);
      components.push({
        weight: Number(rs.weight) / tot,
        strips: rs.strips.map((s) => [...s]),
        windows: rs.strips.map((s, c) => windowsOf(s, rows[c])),
      });
    }
  } else {
    refusals.push(`board_law ${bl.kind}: only global reel-set mixtures are ported`);
  }
  const nComp = expansionSize(components.length, laws.transforms);
  let expanded = components;
  if (nComp > MAX_COMPONENTS) refusals.push(`mechanics mixture of ${nComp} components exceeds ${MAX_COMPONENTS}`);
  else if (!laws.refusals.length) expanded = expandComponents(components, laws.transforms);

  const paytable: Record<string, Record<string, number>> = {};
  for (const [k, tbl] of Object.entries(spec.pays.paytable)) {
    paytable[String(k)] = {};
    for (const [n, c] of Object.entries(tbl)) paytable[String(k)][String(n)] = Number(c);
  }
  const paying = Object.keys(paytable)
    .map((k) => Number(k))
    .filter((s) => !wilds.has(s) && s !== scatter);
  const scatterPay: Record<string, number> = {};
  if (scatter !== null) for (const [k, v] of Object.entries(spec.pays.scatter_pay ?? {})) scatterPay[String(k)] = Number(v);
  const triggerMin = spec.trigger && scatter !== null && spec.trigger.scatter_min != null ? Number(spec.trigger.scatter_min) : null;

  return {
    spec,
    cols,
    rows,
    betCoins: spec.bet.coins,
    wilds,
    scatter,
    law,
    paytable,
    paying,
    scatterPay,
    triggerMin,
    components: expanded,
    post: laws.post,
    tier: laws.transforms.some((t) => t.kind === 'mixture') ? 'exact_mixture' : 'exact',
    mechanicLabels: laws.labels,
    closedFormRefusal: refusals.length ? refusals.join('; ') : null,
  };
}

/** A built model passes through; a spec is built. */
export function asModel(x: SlotSpec | SlotModel): SlotModel {
  return (x as SlotSpec).schema === 'game_spec_v2' ? buildModel(x as SlotSpec) : (x as SlotModel);
}

// --------------------------------------------------------------------------- the board laws

/** `eval_line`: (coins, length, head|null). Head null = the wild own pay. */
export function evalLine(
  syms: number[],
  paytable: Record<string, Record<string, number>>,
  wilds: Set<number>,
  wildOwn: Record<string, number>,
): [number, number, number | null] {
  const n = syms.length;
  let k = 0;
  while (k < n && wilds.has(syms[k])) k++;
  let best = 0;
  let blen = 0;
  let bhead: number | null = null;
  if (k < n) {
    const head = syms[k];
    const tbl = paytable[String(head)];
    if (tbl && Object.keys(tbl).length) {
      let ln = 0;
      for (const s of syms) {
        if (s === head || wilds.has(s)) ln++;
        else break;
      }
      const amt = tbl[String(ln)] ?? 0;
      if (amt) {
        best = amt;
        blen = ln;
        bhead = head;
      }
    }
  }
  if (k > 0) {
    const wo = wildOwn[String(k)] ?? 0;
    if (wo > best) {
      best = wo;
      blen = k;
      bhead = null;
    }
  }
  return [best, blen, bhead];
}

/** Total coins one payline pays under the law's variant (the pack's `PaylineEvaluator.line_value`). */
export function lineValue(m: SlotModel, syms: number[]): number {
  const law = m.law;
  if (law.kind !== 'payline') throw new Error('lineValue: not a payline law');
  const ev = (s: number[]) => evalLine(s, m.paytable, m.wilds, law.wildOwn);
  const n = syms.length;
  if (law.anchor === 'any') {
    let best = 0;
    for (let s = 0; s < n; s++) {
      const [coins] = ev(syms.slice(s));
      if (coins > best) best = coins;
    }
    return best;
  }
  const [cl, ll] = ev(syms);
  if (law.direction === 'left') return cl;
  const [cr] = ev([...syms].reverse());
  if (law.direction === 'both_max') return cr > cl ? cr : cl;
  if (cl && ll === n) return cl; // both_additive: a full line is one combination
  return cl + cr;
}

/** Evaluator coins of a board (lines / ways / count pays), without the scatter pay. */
export function evaluatorCoins(m: SlotModel, board: number[][]): number {
  const law = m.law;
  if (law.kind === 'payline') {
    let total = 0;
    for (const ri of law.rowsIdx) {
      const syms = ri.map((r, c) => board[c][r]);
      total += lineValue(m, syms);
    }
    return total;
  }
  if (law.kind === 'ways') {
    let total = 0;
    for (const s of m.paying) {
      const tbl = m.paytable[String(s)];
      const counts = board.map((col) => {
        let n = 0;
        for (const v of col) if (v === s) n++;
        else if (m.wilds.has(v)) n += law.wildMultiplier;
        return n;
      });
      let reels: number[];
      if (law.anchor === 'left') {
        reels = [];
        for (let c = 0; c < counts.length; c++) {
          if (counts[c] === 0) break;
          reels.push(c);
        }
      } else reels = counts.map((n, c) => (n > 0 ? c : -1)).filter((c) => c >= 0);
      const k = reels.length;
      if (!k) continue;
      const coins = tbl[String(k)] ?? 0;
      if (!coins) continue;
      let prod = 1;
      for (const c of reels) prod *= counts[c];
      total += coins * prod;
    }
    return total;
  }
  // scatter pays: count anywhere
  const cnt = new Map<number, number>();
  let nWild = 0;
  for (const col of board)
    for (const v of col) {
      if (m.wilds.has(v)) nWild++;
      cnt.set(v, (cnt.get(v) ?? 0) + 1);
    }
  let total = 0;
  for (const s of m.paying) {
    const n = (cnt.get(s) ?? 0) + nWild;
    if (n < law.minCount) continue;
    total += m.paytable[String(s)][String(n)] ?? 0;
  }
  return total;
}

export function scatterCount(m: SlotModel, board: number[][]): number {
  if (m.scatter === null) return 0;
  let n = 0;
  for (const col of board) for (const v of col) if (v === m.scatter) n++;
  return n;
}

/** Full base-spin coins of a board: evaluator coins + scatter pay. */
export function boardCoins(m: SlotModel, board: number[][]): { coins: number; k: number } {
  const k = scatterCount(m, board);
  const sp = m.scatter !== null ? m.scatterPay[String(k)] ?? 0 : 0;
  return { coins: evaluatorCoins(m, board) + sp, k };
}

/** The board shown by stops on a component's strips (after the component's window maps, if any). */
export function boardAt(m: SlotModel, comp: Component, stops: number[]): number[][] {
  return comp.strips.map((strip, c) => {
    const L = strip.length;
    const col: number[] = [];
    for (let i = 0; i < m.rows[c]; i++) col.push(strip[(stops[c] + i) % L]);
    return comp.colMap ? comp.colMap(c, col) : col;
  });
}

/** Visible cells of `target` on a board. */
export function targetCount(board: number[][], target: Set<number>): number {
  let n = 0;
  for (const col of board) for (const v of col) if (target.has(v)) n++;
  return n;
}
