// The win laws over a materialised board (pack: src/reelengine/evaluators/*, which import the frozen
// kernels slotlab/kernel/{generic,ways,cluster}.py and scatter_analytics/evaluator.py).
//
// Iteration order is part of the output (win order): every spec map (paytable rows) is iterated
// in sorted-key order, which is the pack's order once the spec is normalised with sort_keys
// (scripts/slots/oracle.py does that before building).

import { cmpStr } from './canonical';
import type { SpinWin } from './types';

export type Board = number[][];
export type Paytable = Record<string, Record<string, number>>;
/** A per-line law: cells = [col, row, sym] per reel -> [coins, length, head | null]. */
export type LineFn = (cells: [number, number, number][]) => [number, number, number | null];
/** The default per-line law over the line's symbols (an eval_variant's `inner`). */
export type SymsLineFn = (syms: number[]) => [number, number, number | null];
/** Cell multiplicity (ways / scatter pays only): "c,r" -> count. */
export type Multiplicity = Map<string, number>;

export function sortedKeys(o: Record<string, unknown>): string[] {
  return Object.keys(o).sort(cmpStr);
}

function intOrRaw(k: string): number | string {
  const n = Number(k);
  return k.trim() !== '' && Number.isInteger(n) && String(n) === k ? n : k;
}

export function makeWin(label: string, coins: number, cells: [number, number][], ways: number | null = null, lineIdx: number | null = null): SpinWin {
  return { label, coins, cells, ways, lineIdx };
}

export interface Evaluator {
  readonly kind: 'payline' | 'ways' | 'cluster' | 'scatter_pays';
  readonly MULTIPLICITY: boolean;
  readonly isDefaultVariant: boolean;
  readonly variantLabel: string;
  wins(board: Board, lineFn?: LineFn | null): SpinWin[];
  winsWithMultiplicity?(board: Board, mult: Multiplicity, lineFn?: LineFn | null): SpinWin[];
  totalForBoard(board: Board): number;
}

interface EvalCommon {
  cols: number;
  paytable: Paytable;
  wilds: Set<number>;
  scatter: number | null;
  names: Record<string, string>;
}

function nameOf(names: Record<string, string>, sym: number | string): string {
  return names[String(sym)] ?? String(sym);
}

/** First element of a Python set of small ints (CPython iterates small-int sets in ascending order). */
export function firstOfSet(s: Set<number>): number {
  return Math.min(...s);
}

// ---------------------------------------------------------------- payline

/** slotlab.kernel.generic.eval_line: (coins, length, head | null); head null => wild own pay. */
export function evalLine(syms: number[], paytable: Paytable, wilds: Set<number>, wildOwn: Record<string, number>): [number, number, number | null] {
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

export class PaylineEvaluator implements Evaluator {
  readonly kind = 'payline' as const;
  readonly MULTIPLICITY = false;
  readonly rowsIdx: number[][];
  readonly isDefaultVariant: boolean;
  readonly variantLabel: string;
  constructor(
    readonly c: EvalCommon & { paylines: number[][]; positions: boolean; wildOwn: Record<string, number> },
    readonly direction: 'left' | 'both_max' | 'both_additive' = 'left',
    readonly anchor: 'left' | 'any' = 'left',
  ) {
    this.rowsIdx = c.paylines.map((pat) => pat.map((p) => (c.positions ? Math.floor(p / c.cols) : p)));
    if (!['left', 'both_max', 'both_additive'].includes(direction)) throw new Error(`payline: direction '${direction}' not supported`);
    if (!['left', 'any'].includes(anchor)) throw new Error(`payline: anchor '${anchor}' not supported`);
    if (anchor === 'any' && direction !== 'left') throw new Error("payline: anchor 'any' already pays any contiguous run; direction must be 'left'");
    this.isDefaultVariant = direction === 'left' && anchor === 'left';
    this.variantLabel = `direction=${direction}, anchor=${anchor}`;
  }

  defaultLineEval(syms: number[]): [number, number, number | null] {
    return evalLine(syms, this.c.paytable, this.c.wilds, this.c.wildOwn);
  }

  /** The variant's wins on one line: [coins, length, head, startCol, step]. */
  runs(syms: number[]): [number, number, number | null, number, number][] {
    const n = syms.length;
    if (this.anchor === 'any') {
      let best: [number, number, number | null, number, number] | null = null;
      for (let s = 0; s < n; s++) {
        const [coins, ln, head] = this.defaultLineEval(syms.slice(s));
        if (coins && (best === null || coins > best[0])) best = [coins, ln, head, s, 1];
      }
      return best ? [best] : [];
    }
    const [cl, ll, hl] = this.defaultLineEval(syms);
    if (this.direction === 'left') return cl ? [[cl, ll, hl, 0, 1]] : [];
    const [cr, lr, hr] = this.defaultLineEval([...syms].reverse());
    const left: [number, number, number | null, number, number] = [cl, ll, hl, 0, 1];
    const right: [number, number, number | null, number, number] = [cr, lr, hr, n - 1, -1];
    if (this.direction === 'both_max') {
      if (cr > cl) return [right];
      return cl ? [left] : [];
    }
    if (cl && ll === n) return [left];
    const out: [number, number, number | null, number, number][] = [];
    if (cl) out.push(left);
    if (cr) out.push(right);
    return out;
  }

  lineValue(syms: number[]): number {
    if (this.isDefaultVariant) return this.defaultLineEval(syms)[0];
    return this.runs(syms).reduce((a, r) => a + r[0], 0);
  }

  label(head: number | null, ln: number, start: number, step: number): string {
    let label = head !== null ? `${nameOf(this.c.names, head)} x${ln}` : `${nameOf(this.c.names, firstOfSet(this.c.wilds))} x${ln} (wild own pay)`;
    if (step < 0) label += ' (right)';
    else if (start > 0) label += ` (from reel ${start})`;
    return label;
  }

  wins(board: Board, lineFn?: LineFn | null): SpinWin[] {
    const wins: SpinWin[] = [];
    const cols = this.c.cols;
    this.rowsIdx.forEach((rowsIdx, li) => {
      if (lineFn) {
        const cells: [number, number, number][] = [];
        for (let c = 0; c < cols; c++) cells.push([c, rowsIdx[c], board[c][rowsIdx[c]]]);
        const [coins, ln, head] = lineFn(cells);
        if (coins) {
          const wc: [number, number][] = [];
          for (let c = 0; c < ln; c++) wc.push([c, rowsIdx[c]]);
          wins.push(makeWin(this.label(head, ln, 0, 1), coins, wc, null, li));
        }
        return;
      }
      const syms = rowsIdx.map((r, c) => board[c][r]);
      if (this.isDefaultVariant) {
        const [coins, ln, head] = evalLine(syms, this.c.paytable, this.c.wilds, this.c.wildOwn);
        if (coins) {
          const wc: [number, number][] = [];
          for (let c = 0; c < ln; c++) wc.push([c, rowsIdx[c]]);
          wins.push(makeWin(this.label(head, ln, 0, 1), coins, wc, null, li));
        }
        return;
      }
      for (const [coins, ln, head, start, step] of this.runs(syms)) {
        const wc: [number, number][] = [];
        for (let i = 0; i < ln; i++) {
          const c = start + step * i;
          wc.push([c, rowsIdx[c]]);
        }
        wins.push(makeWin(this.label(head, ln, start, step), coins, wc, null, li));
      }
    });
    return wins;
  }

  totalForBoard(board: Board): number {
    let total = 0;
    for (const rowsIdx of this.rowsIdx) total += this.lineValue(rowsIdx.map((r, c) => board[c][r]));
    return total;
  }
}

// ---------------------------------------------------------------- multiplicity

export function cellKey(c: number, r: number): string {
  return `${c},${r}`;
}

/** evaluators.multiplicity.expand_board: every cell repeated m(c, r) times in its column. */
export function expandBoard(board: Board, mult: Multiplicity): Board {
  for (const [key, m] of mult) {
    const [c, r] = key.split(',').map(Number);
    if (!(c >= 0 && c < board.length && r >= 0 && r < board[c].length)) throw new Error(`multiplicity cell ${key} is off the board`);
    if (!Number.isInteger(m) || m < 1) throw new Error(`multiplicity[${key}] must be a positive int, got ${m}`);
  }
  return board.map((col, c) => {
    const out: number[] = [];
    col.forEach((v, r) => {
      const m = mult.get(cellKey(c, r)) ?? 1;
      for (let i = 0; i < m; i++) out.push(v);
    });
    return out;
  });
}

// ---------------------------------------------------------------- ways

/** slotlab.kernel.ways.ways_wins: [sym, run, coins, product] per paying symbol. */
export function waysWins(board: Board, paytable: Paytable, wilds: Set<number>, scatter: number | null, cols: number): [number, number, number, number][] {
  const perReel: [Map<number, number>, number][] = [];
  for (let c = 0; c < cols; c++) {
    let wc = 0;
    const sc = new Map<number, number>();
    for (const v of board[c]) {
      if (wilds.has(v)) wc++;
      else sc.set(v, (sc.get(v) ?? 0) + 1);
    }
    perReel.push([sc, wc]);
  }
  const results: [number, number, number, number][] = [];
  for (const symKey of sortedKeys(paytable)) {
    const s = intOrRaw(symKey) as number;
    if (wilds.has(s) || s === scatter) continue;
    let run = 0;
    let prod = 1;
    for (let c = 0; c < cols; c++) {
      const [sc, wc] = perReel[c];
      const cnt = (sc.get(s) ?? 0) + wc;
      if (cnt === 0) break;
      run++;
      prod *= cnt;
    }
    if (run === 0) continue;
    const coins = paytable[symKey][String(run)] ?? 0;
    if (coins) results.push([s, run, coins * prod, prod]);
  }
  return results;
}

export class WaysEvaluator implements Evaluator {
  readonly kind = 'ways' as const;
  readonly MULTIPLICITY = true;
  readonly paying: [string, number][] = [];
  readonly isDefaultVariant: boolean;
  readonly variantLabel: string;
  readonly wildRows: Map<number, Record<string, number>> = new Map();
  constructor(
    readonly c: EvalCommon,
    readonly anchor: 'left' | 'any' = 'left',
    readonly wildMultiplier = 1,
    readonly adjacency: 'none' | 'king' = 'none',
  ) {
    for (const symKey of sortedKeys(c.paytable)) {
      const s = intOrRaw(symKey) as number;
      if (c.wilds.has(s) || s === c.scatter) continue;
      this.paying.push([symKey, s]);
    }
    if (!['left', 'any'].includes(anchor)) throw new Error(`ways: anchor '${anchor}' not supported`);
    if (!Number.isInteger(wildMultiplier) || wildMultiplier < 1) throw new Error(`ways: wild_multiplier must be an int >= 1`);
    if (!['none', 'king'].includes(adjacency)) throw new Error(`ways: adjacency '${adjacency}' not supported`);
    if (adjacency === 'king' && anchor !== 'left') throw new Error("ways: adjacency 'king' needs anchor 'left'");
    this.isDefaultVariant = anchor === 'left' && wildMultiplier === 1 && adjacency === 'none';
    this.variantLabel = `anchor=${anchor}, wild_multiplier=${wildMultiplier}` + (adjacency !== 'none' ? `, adjacency=${adjacency}` : '');
    // {w: paytable.get(str(w)) for w in wilds if paytable.get(str(w))}: Python set order (ascending small ints)
    for (const w of [...c.wilds].sort((a, b) => a - b)) {
      const row = c.paytable[String(w)];
      if (row && Object.keys(row).length) this.wildRows.set(w, row);
    }
  }

  private name(s: number | string): string {
    return nameOf(this.c.names, s);
  }

  variantWins(board: Board): [number, number, number, number, number[]][] {
    const perReel: [Map<number, number>, number][] = [];
    for (let c = 0; c < this.c.cols; c++) {
      let wc = 0;
      const sc = new Map<number, number>();
      for (const v of board[c]) {
        if (this.c.wilds.has(v)) wc++;
        else sc.set(v, (sc.get(v) ?? 0) + 1);
      }
      perReel.push([sc, wc]);
    }
    const out: [number, number, number, number, number[]][] = [];
    for (const [symKey, s] of this.paying) {
      const counts = perReel.map(([sc, wc]) => (sc.get(s) ?? 0) + this.wildMultiplier * wc);
      let reels: number[] = [];
      if (this.anchor === 'left') {
        for (let c = 0; c < counts.length; c++) {
          if (counts[c] === 0) break;
          reels.push(c);
        }
      } else reels = counts.map((cnt, c) => (cnt > 0 ? c : -1)).filter((c) => c >= 0);
      const k = reels.length;
      if (!k) continue;
      const coins = this.c.paytable[symKey][String(k)] ?? 0;
      if (!coins) continue;
      let prod = 1;
      for (const c of reels) prod *= counts[c];
      out.push([s, k, coins * prod, prod, reels]);
    }
    return out;
  }

  /** The connected-adjacency law (adjacency 'king'). */
  connectedWins(board: Board, multiplicity?: Multiplicity): [number, number, number, number, [number, number][]][] {
    const cols = this.c.cols;
    const wilds = this.c.wilds;
    const mult = multiplicity ?? new Map<string, number>();
    const mOf = (c: number, r: number, isW: boolean) => (mult.get(cellKey(c, r)) ?? 1) * (isW ? this.wildMultiplier : 1);
    const matching = (c: number, s: number | null): [number, boolean][] => {
      const out: [number, boolean][] = [];
      for (let r = 0; r < board[c].length; r++) {
        const v = board[c][r];
        if ((s === null && wilds.has(v)) || (s !== null && (v === s || wilds.has(v)))) out.push([r, wilds.has(v)]);
      }
      return out;
    };
    type Layer = Map<number, [number, number]>;
    const pathsFor = (s: number | null): Layer[] => {
      const layers: Layer[] = [];
      let prev: Layer | null = null;
      for (let c = 0; c < cols; c++) {
        const cur: Layer = new Map();
        for (const [r, isW] of matching(c, s)) {
          const m = mOf(c, r, isW);
          if (prev === null) {
            cur.set(r, [m, isW ? m : 0]);
            continue;
          }
          let a = 0;
          let w = 0;
          for (const [pr, v] of prev) {
            if (Math.abs(pr - r) <= 1) {
              a += v[0];
              w += v[1];
            }
          }
          if (!a) continue;
          cur.set(r, [m * a, isW ? m * w : 0]);
        }
        if (!cur.size) break;
        layers.push(cur);
        prev = cur;
      }
      return layers;
    };
    const maximalRows = (layers: Layer[], c: number): number[] => {
      const nxt = c + 1 < layers.length ? [...layers[c + 1].keys()] : [];
      return [...layers[c].keys()].filter((r) => !nxt.some((nr) => Math.abs(nr - r) <= 1));
    };
    const cellsOnPaths = (layers: Layer[], ends: number[], L: number, s: number | null): [number, number][] => {
      const real = (c: number, r: number) => s !== null && board[c][r] === s;
      const fwdReal: Map<number, boolean>[] = [];
      for (let c = 0; c < L; c++) {
        const cur = new Map<number, boolean>();
        for (const r of layers[c].keys()) {
          let v = real(c, r);
          if (!v && c > 0) {
            for (const pr of layers[c - 1].keys()) if (Math.abs(pr - r) <= 1 && fwdReal[c - 1].get(pr)) v = true;
          }
          cur.set(r, v);
        }
        fwdReal.push(cur);
      }
      const bwdAny: Map<number, boolean>[] = Array.from({ length: L }, () => new Map());
      const bwdReal: Map<number, boolean>[] = Array.from({ length: L }, () => new Map());
      for (const r of ends) {
        bwdAny[L - 1].set(r, true);
        bwdReal[L - 1].set(r, false);
      }
      for (let c = L - 2; c >= 0; c--) {
        for (const r of layers[c].keys()) {
          const nxt = [...bwdAny[c + 1].keys()].filter((nr) => Math.abs(nr - r) <= 1);
          if (nxt.length) {
            bwdAny[c].set(r, true);
            bwdReal[c].set(r, nxt.some((nr) => real(c + 1, nr) || !!bwdReal[c + 1].get(nr)));
          }
        }
      }
      const cells: [number, number][] = [];
      for (let c = 0; c < L; c++) {
        for (const r of bwdAny[c].keys()) {
          if (s === null || fwdReal[c].get(r) || bwdReal[c].get(r)) cells.push([c, r]);
        }
      }
      return cells.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    };
    const out: [number, number, number, number, [number, number][]][] = [];
    for (const [symKey, s] of this.paying) {
      const layers = pathsFor(s);
      for (let c = 0; c < layers.length; c++) {
        const ends = maximalRows(layers, c);
        let weight = 0;
        for (const r of ends) weight += layers[c].get(r)![0] - layers[c].get(r)![1];
        if (!weight) continue;
        const coins = this.c.paytable[symKey][String(c + 1)] ?? 0;
        if (!coins) continue;
        const realEnds = ends.filter((r) => layers[c].get(r)![0] - layers[c].get(r)![1] > 0);
        out.push([s, c + 1, coins * weight, weight, cellsOnPaths(layers, realEnds, c + 1, s)]);
      }
    }
    for (const [w, row] of this.wildRows) {
      const layers = pathsFor(null);
      for (let c = 0; c < layers.length; c++) {
        const ends = maximalRows(layers, c);
        let weight = 0;
        for (const r of ends) weight += layers[c].get(r)![1];
        const coins = row[String(c + 1)] ?? 0;
        if (!weight || !coins) continue;
        out.push([w, c + 1, coins * weight, weight, cellsOnPaths(layers, ends, c + 1, null)]);
      }
      break;
    }
    return out;
  }

  private connectedWinObjects(board: Board, multiplicity?: Multiplicity): SpinWin[] {
    return this.connectedWins(board, multiplicity).map(([s, L, coins, weight, cells]) => makeWin(`${this.name(s)} x${L} (${weight} paths, connected)`, coins, cells, weight));
  }

  private cellsOf(board: Board, s: number, reels: Iterable<number>): [number, number][] {
    const cells: [number, number][] = [];
    for (const c of reels) for (let r = 0; r < board[c].length; r++) if (board[c][r] === s || this.c.wilds.has(board[c][r])) cells.push([c, r]);
    return cells;
  }

  private lawWins(view: Board, board: Board): SpinWin[] {
    const wins: SpinWin[] = [];
    if (this.isDefaultVariant) {
      for (const [s, run, coins, prod] of waysWins(view, this.c.paytable, this.c.wilds, this.c.scatter, this.c.cols)) {
        wins.push(makeWin(`${this.name(s)} x${run} (${prod} ways)`, coins, this.cellsOf(board, s, Array.from({ length: run }, (_, i) => i)), prod));
      }
      return wins;
    }
    const suffix = this.anchor === 'any' ? ' anywhere' : '';
    for (const [s, k, coins, prod, reels] of this.variantWins(view)) {
      wins.push(makeWin(`${this.name(s)} x${k} (${prod} ways${suffix})`, coins, this.cellsOf(board, s, reels), prod));
    }
    return wins;
  }

  wins(board: Board): SpinWin[] {
    if (this.adjacency === 'king') return this.connectedWinObjects(board);
    return this.lawWins(board, board);
  }

  winsWithMultiplicity(board: Board, mult: Multiplicity): SpinWin[] {
    if (this.adjacency === 'king') return this.connectedWinObjects(board, mult);
    return this.lawWins(expandBoard(board, mult), board);
  }

  totalForBoard(board: Board): number {
    if (this.adjacency === 'king') return this.connectedWins(board).reduce((a, w) => a + w[2], 0);
    if (this.isDefaultVariant) return waysWins(board, this.c.paytable, this.c.wilds, this.c.scatter, this.c.cols).reduce((a, w) => a + w[2], 0);
    return this.variantWins(board).reduce((a, w) => a + w[2], 0);
  }
}

// ---------------------------------------------------------------- scatter pays

/** scatter_analytics.evaluator.evaluate_board: [total, Map(sym -> [count, coins])] in paytable order. */
export function evaluateCountBoard(cells: number[], paytable: Paytable, wilds: Set<number>, scatter: number | null, minCount: number): [number, Map<number | string, [number, number]>] {
  const cnt = new Map<number, number>();
  for (const v of cells) cnt.set(v, (cnt.get(v) ?? 0) + 1);
  let nWild = 0;
  for (const w of wilds) nWild += cnt.get(w) ?? 0;
  let total = 0;
  const wins = new Map<number | string, [number, number]>();
  for (const symKey of sortedKeys(paytable)) {
    const sym = intOrRaw(symKey);
    if (sym === scatter || (typeof sym === 'number' && wilds.has(sym))) continue;
    const n = (cnt.get(sym as number) ?? 0) + nWild;
    if (n < minCount) continue;
    const coins = paytable[symKey][String(n)] ?? 0;
    if (coins) {
      total += coins;
      wins.set(sym, [n, coins]);
    }
  }
  return [total, wins];
}

export class ScatterPaysEvaluator implements Evaluator {
  readonly kind = 'scatter_pays' as const;
  readonly MULTIPLICITY = true;
  readonly isDefaultVariant = true;
  readonly variantLabel = 'default';
  constructor(
    readonly c: EvalCommon,
    readonly minCount: number,
  ) {}

  private lawWins(view: Board, board: Board): SpinWin[] {
    const [, raw] = evaluateCountBoard(view.flat(), this.c.paytable, this.c.wilds, this.c.scatter, this.minCount);
    const syms = [...raw.keys()].sort((a, b) => cmpStr(String(a), String(b)));
    return syms.map((sym) => {
      const [n, coins] = raw.get(sym)!;
      const cells: [number, number][] = [];
      board.forEach((col, c) => col.forEach((v, r) => (v === sym || this.c.wilds.has(v) ? cells.push([c, r]) : 0)));
      return makeWin(`${nameOf(this.c.names, sym)} x${n} (count)`, coins, cells);
    });
  }

  wins(board: Board): SpinWin[] {
    return this.lawWins(board, board);
  }

  winsWithMultiplicity(board: Board, mult: Multiplicity): SpinWin[] {
    return this.lawWins(expandBoard(board, mult), board);
  }

  totalForBoard(board: Board): number {
    return evaluateCountBoard(board.flat(), this.c.paytable, this.c.wilds, this.c.scatter, this.minCount)[0];
  }
}

// ---------------------------------------------------------------- cluster

export function neighbours(cols: number, rows: number): number[][] {
  const nei: number[][] = [];
  for (let i = 0; i < cols * rows; i++) {
    const c = Math.floor(i / rows);
    const r = i % rows;
    const n: number[] = [];
    if (r > 0) n.push(i - 1);
    if (r < rows - 1) n.push(i + 1);
    if (c > 0) n.push(i - rows);
    if (c < cols - 1) n.push(i + rows);
    nei.push(n);
  }
  return nei;
}

/** slotlab.kernel.cluster.find_clusters: 4-connected components with wild substitution. */
export function findClusters(cells: number[], cols: number, rows: number, nei: number[][], wilds: Set<number>, scatter: number | null): [number, number[]][] {
  const n = cols * rows;
  const visited = new Uint8Array(n);
  const out: [number, number[]][] = [];
  for (let i = 0; i < n; i++) {
    if (visited[i]) continue;
    const s = cells[i];
    if (s === scatter || wilds.has(s)) {
      visited[i] = 1;
      continue;
    }
    visited[i] = 1;
    const comp = [i];
    const wildIn = new Set<number>();
    const stack = [i];
    while (stack.length) {
      const j = stack.pop()!;
      for (const k of nei[j]) {
        const vk = cells[k];
        if (vk === s) {
          if (!visited[k]) {
            visited[k] = 1;
            comp.push(k);
            stack.push(k);
          }
        } else if (wilds.has(vk)) {
          if (!wildIn.has(k)) {
            wildIn.add(k);
            comp.push(k);
            stack.push(k);
          }
        }
      }
    }
    comp.sort((a, b) => a - b);
    out.push([s, comp]);
  }
  return out;
}

export function evaluateClusterCells(cells: number[], cols: number, rows: number, nei: number[][], paytable: Paytable, wilds: Set<number>, scatter: number | null, minSize: number): [number, [number, number[], number][]] {
  const wins: [number, number[], number][] = [];
  let total = 0;
  for (const [sym, comp] of findClusters(cells, cols, rows, nei, wilds, scatter)) {
    if (comp.length < minSize) continue;
    const tbl = paytable[String(sym)];
    if (!tbl || !Object.keys(tbl).length) continue;
    const coins = tbl[String(comp.length)] ?? 0;
    if (coins) {
      wins.push([sym, comp, coins]);
      total += coins;
    }
  }
  return [total, wins];
}

export class ClusterEvaluator implements Evaluator {
  readonly kind = 'cluster' as const;
  readonly MULTIPLICITY = false;
  readonly isDefaultVariant = true;
  readonly variantLabel = 'default';
  readonly nei: number[][];
  constructor(
    readonly c: EvalCommon,
    readonly rows: number,
    readonly minSize: number,
  ) {
    this.nei = neighbours(c.cols, rows);
  }

  flat(board: Board): number[] {
    const cells = new Array<number>(this.c.cols * this.rows).fill(0);
    for (let c = 0; c < this.c.cols; c++) for (let r = 0; r < this.rows; r++) cells[c * this.rows + r] = board[c][r];
    return cells;
  }

  wins(board: Board): SpinWin[] {
    const [, raw] = evaluateClusterCells(this.flat(board), this.c.cols, this.rows, this.nei, this.c.paytable, this.c.wilds, this.c.scatter, this.minSize);
    return raw.map(([sym, comp, coins]) =>
      makeWin(
        `cluster ${nameOf(this.c.names, sym)} x${comp.length}`,
        coins,
        comp.map((idx) => [Math.floor(idx / this.rows), idx % this.rows] as [number, number]),
      ),
    );
  }

  totalForBoard(board: Board): number {
    return evaluateClusterCells(this.flat(board), this.c.cols, this.rows, this.nei, this.c.paytable, this.c.wilds, this.c.scatter, this.minSize)[0];
  }
}
