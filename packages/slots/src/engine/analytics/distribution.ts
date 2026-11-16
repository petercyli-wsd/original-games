// The distribution of one spin's (total coins, visible scatter count).
//
// Exact where the base is closed form and the board space is small enough to enumerate:
// reels are independent (§2.1), so the spin's law is the product of the per-reel window laws
// (identical windows merged), mixed over the weighted reel sets. We walk that product reel by
// reel and stop early as soon as the evaluator total is decided:
//
//   payline (direction left, anchor left)  a line is decided once a non-matching symbol
//       follows its head (eval_line); when every line is decided, the remaining reels only
//       move the scatter count, which we finish with the exact suffix convolution of the
//       per-reel scatter-count pmfs;
//   ways (anchor left)  a symbol's run is decided at the first reel without it or a wild;
//   the variants (both-ways, anchor any) and scatter pays  full enumeration of every window
//       combination, within the board budget.
//
// The scatter pay is added at the leaves from the total count. The result is exact (each
// probability is a product of window frequencies). Its mean equals exactRtp × bet, which the
// tests check on every pack example.
//
// Otherwise (a spec too large to enumerate, e.g. 6×5 scatter pays on 86-stop strips), the
// honest fallback is Monte Carlo over uniform stops with the same board evaluator: tier 'mc'
// with n. Specs with no closed form at all (mechanics, cascades) go through the engine's
// canonicalSpin in mc.ts.

import type { SlotSpec } from '../types';
import { convolve, reelCountPmf } from './exact';
import { asModel, boardAt, boardCoins, NoClosedForm, type Component, type SlotModel } from './model';
import { mulberry32 } from './rng';

/** Distribution of one spin's (total coins, visible scatter count). Entries are distinct (coins, k) pairs. */
export interface SpinDist {
  /** Integer coins (evaluator + scatter pay), per entry. */
  coins: number[];
  /** Visible scatter count, per entry. */
  k: number[];
  /** Probability per entry; sums to 1. */
  p: number[];
  tier: 'exact' | 'mc';
  /** Sample size when tier = 'mc' (an empirical distribution). */
  n?: number;
  method: string;
}

export interface DistributionOptions {
  /** Largest number of window combinations enumerated with early stopping (default 5e8). */
  maxBoards?: number;
  /** Largest number of window combinations enumerated in full, without early stopping (default 6e7). */
  maxFullBoards?: number;
  /** Spins for the Monte-Carlo fallback (default 2,000,000). */
  mcSpins?: number;
  /** Seed of the Monte-Carlo fallback (default 20261116). */
  seed?: number;
  /** Force the Monte-Carlo path (tests). */
  forceMc?: boolean;
}

const KMUL = 256; // key = lineCoins * KMUL + k (k ≤ 255 visible scatters)

type Acc = Map<number, number>;

function add(acc: Acc, coins: number, k: number, p: number): void {
  const key = coins * KMUL + k;
  acc.set(key, (acc.get(key) ?? 0) + p);
}

/** Per-reel scatter-count pmfs and their suffix convolutions (suffix[c] = reels c..cols-1). */
function scatterSuffix(m: SlotModel, comp: Component): number[][] {
  const sc = new Set<number>(m.scatter !== null ? [m.scatter] : []);
  const per = comp.windows.map((w) => reelCountPmf(w, sc));
  const suffix: number[][] = new Array(m.cols + 1);
  suffix[m.cols] = [1];
  for (let c = m.cols - 1; c >= 0; c--) suffix[c] = convolve([per[c], suffix[c + 1]]);
  return suffix;
}

function windowScatters(m: SlotModel, win: number[]): number {
  if (m.scatter === null) return 0;
  let n = 0;
  for (const v of win) if (v === m.scatter) n++;
  return n;
}

// --------------------------------------------------------------------------- payline (left/left)

function enumeratePayline(m: SlotModel, comp: Component, weight: number, acc: Acc): void {
  const law = m.law;
  if (law.kind !== 'payline') throw new Error('unreachable');
  const cols = m.cols;
  const nl = law.rowsIdx.length;
  const suffix = scatterSuffix(m, comp);
  const wildOwn = (k: number) => (k > 0 ? law.wildOwn[String(k)] ?? 0 : 0);
  // paytable lookup by symbol → by run length (0 when absent); null = no row (eval_line's `if tbl`)
  const rowOf = new Map<number, number[] | null>();
  const tableRow = (s: number): number[] | null => {
    let r = rowOf.get(s);
    if (r === undefined) {
      const tbl = m.paytable[String(s)];
      if (tbl && Object.keys(tbl).length) {
        r = [];
        for (let ln = 0; ln <= cols; ln++) r.push(tbl[String(ln)] ?? 0);
      } else r = null;
      rowOf.set(s, r);
    }
    return r;
  };
  // per reel, per window: the symbol each line reads, and the scatter count
  const lineSym = comp.windows.map((wins, c) => wins.map(({ win }) => law.rowsIdx.map((ri) => win[ri[c]])));
  const winScat = comp.windows.map((wins) => wins.map(({ win }) => windowScatters(m, win)));
  // per-depth line state: head (-1 = all wild so far), run length; alive list
  const NONE = -1;
  const head: Int32Array[] = [];
  const ln: Int32Array[] = [];
  const alive: Int32Array[] = []; // list of alive line indices, length in aliveN[d]
  const aliveN = new Int32Array(cols + 1);
  for (let d = 0; d <= cols; d++) {
    head.push(new Int32Array(nl));
    ln.push(new Int32Array(nl));
    alive.push(new Int32Array(nl));
  }
  for (let l = 0; l < nl; l++) {
    head[0][l] = NONE;
    ln[0][l] = 0;
    alive[0][l] = l;
  }
  aliveN[0] = nl;
  // value of a decided line with head h (≠ NONE), run ln, leading wilds k
  const decided = (h: number, run: number, k: number): number => {
    const row = tableRow(h);
    const best = row ? row[run] : 0;
    const wo = wildOwn(k);
    return wo > best ? wo : best;
  };
  // leading wilds of a line with a head: the head's first column; we track it as k = firstHeadCol
  const lead: Int32Array[] = [];
  for (let d = 0; d <= cols; d++) lead.push(new Int32Array(nl));

  const dfs = (c: number, p: number, coins: number, scat: number): void => {
    if (aliveN[c] === 0) {
      const suf = suffix[c];
      for (let r = 0; r < suf.length; r++) if (suf[r]) add(acc, coins, scat + r, weight * p * suf[r]);
      return;
    }
    if (c === cols) {
      let total = coins;
      for (let i = 0; i < aliveN[c]; i++) {
        const l = alive[c][i];
        total += head[c][l] === NONE ? wildOwn(cols) : decided(head[c][l], ln[c][l], lead[c][l]);
      }
      add(acc, total, scat, weight * p);
      return;
    }
    const wins = comp.windows[c];
    const hc = head[c], lc = ln[c], kc = lead[c], ac = alive[c], an = aliveN[c];
    const hn = head[c + 1], lnn = ln[c + 1], kn = lead[c + 1], anext = alive[c + 1];
    for (let w = 0; w < wins.length; w++) {
      const syms = lineSym[c][w];
      let add2 = 0;
      let na = 0;
      for (let i = 0; i < an; i++) {
        const l = ac[i];
        const s = syms[l];
        const h = hc[l];
        const isWild = m.wilds.has(s);
        if (h === NONE) {
          if (isWild) {
            hn[l] = NONE;
            lnn[l] = c + 1;
            kn[l] = c + 1;
            anext[na++] = l;
          } else {
            // the head is s; leading wilds k = c, run so far c + 1
            if (tableRow(s) === null) {
              add2 += wildOwn(c);
            } else {
              hn[l] = s;
              lnn[l] = c + 1;
              kn[l] = c;
              anext[na++] = l;
            }
          }
        } else if (s === h || isWild) {
          hn[l] = h;
          lnn[l] = lc[l] + 1;
          kn[l] = kc[l];
          anext[na++] = l;
        } else {
          add2 += decided(h, lc[l], kc[l]);
        }
      }
      aliveN[c + 1] = na;
      dfs(c + 1, p * wins[w].p, coins + add2, scat + winScat[c][w]);
    }
  };
  dfs(0, 1, 0, 0);
}

// --------------------------------------------------------------------------- ways (anchor left)

function enumerateWaysLeft(m: SlotModel, comp: Component, weight: number, acc: Acc): void {
  const law = m.law;
  if (law.kind !== 'ways') throw new Error('unreachable');
  const cols = m.cols;
  const ns = m.paying.length;
  const suffix = scatterSuffix(m, comp);
  const pay = m.paying.map((s) => {
    const row: number[] = [];
    for (let k = 0; k <= cols; k++) row.push(m.paytable[String(s)][String(k)] ?? 0);
    return row;
  });
  // per reel, per window: count of each paying symbol (+ wm × wilds)
  const cnt = comp.windows.map((wins) =>
    wins.map(({ win }) =>
      m.paying.map((s) => {
        let n = 0;
        for (const v of win) if (v === s) n++;
        else if (m.wilds.has(v)) n += law.wildMultiplier;
        return n;
      }),
    ),
  );
  const winScat = comp.windows.map((wins) => wins.map(({ win }) => windowScatters(m, win)));
  const prod: Float64Array[] = [];
  const alive: Int32Array[] = [];
  const aliveN = new Int32Array(cols + 1);
  for (let d = 0; d <= cols; d++) {
    prod.push(new Float64Array(ns));
    alive.push(new Int32Array(ns));
  }
  for (let i = 0; i < ns; i++) {
    prod[0][i] = 1;
    alive[0][i] = i;
  }
  aliveN[0] = ns;
  const dfs = (c: number, p: number, coins: number, scat: number): void => {
    if (aliveN[c] === 0) {
      const suf = suffix[c];
      for (let r = 0; r < suf.length; r++) if (suf[r]) add(acc, coins, scat + r, weight * p * suf[r]);
      return;
    }
    if (c === cols) {
      let total = coins;
      for (let i = 0; i < aliveN[c]; i++) {
        const j = alive[c][i];
        total += pay[j][cols] * prod[c][j];
      }
      add(acc, total, scat, weight * p);
      return;
    }
    const wins = comp.windows[c];
    for (let w = 0; w < wins.length; w++) {
      const counts = cnt[c][w];
      let add2 = 0;
      let na = 0;
      for (let i = 0; i < aliveN[c]; i++) {
        const j = alive[c][i];
        const n = counts[j];
        if (n > 0) {
          prod[c + 1][j] = prod[c][j] * n;
          alive[c + 1][na++] = j;
        } else if (c > 0) add2 += pay[j][c] * prod[c][j];
      }
      aliveN[c + 1] = na;
      dfs(c + 1, p * wins[w].p, coins + add2, scat + winScat[c][w]);
    }
  };
  dfs(0, 1, 0, 0);
}

// --------------------------------------------------------------------------- full enumeration

function enumerateFull(m: SlotModel, comp: Component, weight: number, acc: Acc): void {
  const cols = m.cols;
  const board: number[][] = new Array(cols);
  const rec = (c: number, p: number): void => {
    if (c === cols) {
      const { coins, k } = boardCoins(m, board);
      const sp = m.scatter !== null ? m.scatterPay[String(k)] ?? 0 : 0;
      add(acc, coins - sp, k, weight * p);
      return;
    }
    for (const { win, p: q } of comp.windows[c]) {
      board[c] = win;
      rec(c + 1, p * q);
    }
  };
  rec(0, 1);
}

// --------------------------------------------------------------------------- assembly

function toDist(m: SlotModel, acc: Acc, tier: 'exact' | 'mc', method: string, n?: number): SpinDist {
  const merged = new Map<number, number>();
  for (const [key, p] of acc) {
    const k = key % KMUL;
    const line = (key - k) / KMUL;
    const coins = line + (m.scatter !== null ? m.scatterPay[String(k)] ?? 0 : 0);
    const nk = coins * KMUL + k;
    merged.set(nk, (merged.get(nk) ?? 0) + p);
  }
  const keys = [...merged.keys()].sort((a, b) => a - b);
  const out: SpinDist = { coins: [], k: [], p: [], tier, method };
  for (const key of keys) {
    const k = key % KMUL;
    out.coins.push((key - k) / KMUL);
    out.k.push(k);
    out.p.push(merged.get(key)!);
  }
  if (n !== undefined) out.n = n;
  return out;
}

function windowProduct(comp: Component): number {
  return comp.windows.reduce((a, w) => a * w.length, 1);
}

/** Can the exact distribution be enumerated within the budget? (reason when not) */
export function enumerationPlan(specOrModel: SlotSpec | SlotModel, opts: DistributionOptions = {}): { exact: boolean; method: string } {
  const m = asModel(specOrModel);
  if (m.closedFormRefusal) return { exact: false, method: `no closed form (${m.closedFormRefusal})` };
  const maxBoards = opts.maxBoards ?? 5e8;
  const maxFull = opts.maxFullBoards ?? 6e7;
  const boards = m.components.reduce((a, c) => a + windowProduct(c), 0);
  const law = m.law;
  const pruned =
    (law.kind === 'payline' && law.direction === 'left' && law.anchor === 'left') || (law.kind === 'ways' && law.anchor === 'left');
  if (pruned && boards <= maxBoards)
    return { exact: true, method: `exact enumeration of ${boards.toExponential(2)} window combinations, stopped early once the ${law.kind} total is decided` };
  if (!pruned && boards <= maxFull) return { exact: true, method: `exact enumeration of all ${boards.toExponential(2)} window combinations` };
  return {
    exact: false,
    method: `${boards.toExponential(2)} window combinations exceed the enumeration budget (${(pruned ? maxBoards : maxFull).toExponential(0)})`,
  };
}

/** The exact distribution (throws NoClosedForm when it can't be enumerated within the budget). */
export function exactSpinDistribution(specOrModel: SlotSpec | SlotModel, opts: DistributionOptions = {}): SpinDist {
  const m = asModel(specOrModel);
  const plan = enumerationPlan(m, opts);
  if (!plan.exact) throw new NoClosedForm(plan.method);
  const acc: Acc = new Map();
  const law = m.law;
  for (const comp of m.components) {
    if (law.kind === 'payline' && law.direction === 'left' && law.anchor === 'left') enumeratePayline(m, comp, comp.weight, acc);
    else if (law.kind === 'ways' && law.anchor === 'left') enumerateWaysLeft(m, comp, comp.weight, acc);
    else enumerateFull(m, comp, comp.weight, acc);
  }
  return toDist(m, acc, 'exact', plan.method);
}

/** Monte Carlo over uniform stops with the closed-form board evaluator (tier 'mc'). */
export function sampledSpinDistribution(specOrModel: SlotSpec | SlotModel, n = 2_000_000, seed = 20261116): SpinDist {
  const m = asModel(specOrModel);
  if (m.closedFormRefusal) throw new NoClosedForm(m.closedFormRefusal);
  const rng = mulberry32(seed);
  const cum: number[] = [];
  let t = 0;
  for (const c of m.components) cum.push((t += c.weight));
  const acc: Acc = new Map();
  const stops = new Array<number>(m.cols);
  for (let i = 0; i < n; i++) {
    const u = rng();
    let ci = 0;
    while (ci < cum.length - 1 && u >= cum[ci]) ci++;
    const comp = m.components[ci];
    for (let c = 0; c < m.cols; c++) stops[c] = Math.floor(rng() * comp.strips[c].length);
    const board = boardAt(m, comp, stops);
    const { coins, k } = boardCoins(m, board);
    const sp = m.scatter !== null ? m.scatterPay[String(k)] ?? 0 : 0;
    add(acc, coins - sp, k, 1 / n);
  }
  return toDist(m, acc, 'mc', `Monte Carlo over ${n.toLocaleString('en-US')} uniform-stop spins (seed ${seed}), closed-form board evaluator`, n);
}

/** Exact when enumerable, else the stop-sampling Monte Carlo (throws NoClosedForm for specs with no closed-form evaluator). */
export function spinDistribution(specOrModel: SlotSpec | SlotModel, opts: DistributionOptions = {}): SpinDist {
  const m = asModel(specOrModel);
  if (m.closedFormRefusal) throw new NoClosedForm(m.closedFormRefusal);
  if (!opts.forceMc && enumerationPlan(m, opts).exact) return exactSpinDistribution(m, opts);
  return sampledSpinDistribution(m, opts.mcSpins ?? 2_000_000, opts.seed ?? 20261116);
}

// --------------------------------------------------------------------------- summaries

export function distMean(d: SpinDist): number {
  let s = 0;
  for (let i = 0; i < d.p.length; i++) s += d.p[i] * d.coins[i];
  return s;
}

export function distSecondMoment(d: SpinDist): number {
  let s = 0;
  for (let i = 0; i < d.p.length; i++) s += d.p[i] * d.coins[i] * d.coins[i];
  return s;
}

/** P(coins satisfies pred). */
export function distProb(d: SpinDist, pred: (coins: number, k: number) => boolean): number {
  let s = 0;
  for (let i = 0; i < d.p.length; i++) if (pred(d.coins[i], d.k[i])) s += d.p[i];
  return s;
}

/** P(K = k) from a spin distribution. */
export function distScatter(d: SpinDist): number[] {
  const out: number[] = [];
  for (let i = 0; i < d.p.length; i++) {
    while (out.length <= d.k[i]) out.push(0);
    out[d.k[i]] += d.p[i];
  }
  return out;
}

/** An empirical SpinDist from sampled (coins, k) pairs (tier 'mc'). */
export function empiricalDist(samples: { coins: number; k: number }[], method: string): SpinDist {
  const acc = new Map<number, number>();
  const n = samples.length;
  for (const s of samples) {
    const key = s.coins * KMUL + s.k;
    acc.set(key, (acc.get(key) ?? 0) + 1 / n);
  }
  const keys = [...acc.keys()].sort((a, b) => a - b);
  const out: SpinDist = { coins: [], k: [], p: [], tier: 'mc', n, method };
  for (const key of keys) {
    const k = key % KMUL;
    out.coins.push((key - k) / KMUL);
    out.k.push(k);
    out.p.push(acc.get(key)!);
  }
  return out;
}
