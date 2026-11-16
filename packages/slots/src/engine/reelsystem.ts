// The independent reel-symbol system (pack: src/reelengine/reelsystem.py), spin side only.
//
// Draw order (the seed namespace):
//  - global_mixture: pickWeighted(set_cum) only when there is more than one set, then per reel in
//    column order: height (height law only), stop = randrange(L);
//  - per_reel_pools: per reel in column order: pickWeighted(pool cum) only when the reel has more
//    than one pool, then height, then stop;
//  - a top reel (geometry.top_reel) draws its stop LAST, after every column reel;
//  - a height law draws one pickWeighted per reel before its stop (none for a single height).

import { cumThresholds, bisectRight, type SpinRng } from './rng';

export interface Reel {
  readonly kind: 'strip' | 'window_catalog';
  readonly length: number;
  window(stop: number, height: number): number[];
  /** Tape access beyond the window (cascade refills continue the tape). */
  cell(index: number): number;
}

/** Python's non-negative modulo. */
export function pmod(a: number, n: number): number {
  const r = a % n;
  return r < 0 ? r + n : r;
}

export class StripReel implements Reel {
  readonly kind = 'strip' as const;
  constructor(readonly cells: readonly number[]) {
    if (!cells.length) throw new Error('StripReel: empty strip');
  }
  get length(): number {
    return this.cells.length;
  }
  window(stop: number, height: number): number[] {
    const L = this.cells.length;
    const out: number[] = [];
    for (let i = 0; i < height; i++) out.push(this.cells[pmod(stop + i, L)]);
    return out;
  }
  cell(index: number): number {
    return this.cells[pmod(index, this.cells.length)];
  }
}

/** A virtual strip: integer-weighted windows; a stop in [0, total) selects by bisection. */
export class CatalogReel implements Reel {
  readonly kind = 'window_catalog' as const;
  readonly entries: { weight: number; window: number[] }[];
  readonly cum: number[];
  readonly total: number;
  readonly height: number;
  constructor(entries: { weight: number; window: number[] }[]) {
    if (!entries.length) throw new Error('CatalogReel: no windows');
    for (const e of entries) {
      if (!Number.isInteger(e.weight) || e.weight <= 0) throw new Error(`CatalogReel: weight ${e.weight} is not a positive int`);
    }
    const hs = new Set(entries.map((e) => e.window.length));
    if (hs.size !== 1) throw new Error(`CatalogReel: windows of mixed heights`);
    this.entries = entries.map((e) => ({ weight: e.weight, window: [...e.window] }));
    this.cum = cumThresholds(entries.map((e) => e.weight));
    this.total = this.cum[this.cum.length - 1];
    this.height = entries[0].window.length;
  }
  get length(): number {
    return this.total;
  }
  window(stop: number, height: number): number[] {
    if (height !== this.height) throw new Error(`CatalogReel: window height ${height} != catalog height ${this.height}`);
    return [...this.entries[bisectRight(this.cum, pmod(stop, this.total))].window];
  }
  cell(): number {
    throw new Error('CatalogReel has no tape beyond its window (no cascade refill)');
  }
}

interface PoolJson {
  kind?: string;
  id?: string | number;
  weight: number;
  strip?: number[];
  windows?: { weight: number; window: number[] }[];
}

function reelFromPool(pool: PoolJson): Reel {
  const kind = pool.kind ?? 'strip';
  if (kind === 'strip') return new StripReel(pool.strip ?? []);
  if (kind === 'window_catalog') return new CatalogReel((pool.windows ?? []).map((w) => ({ weight: w.weight, window: w.window })));
  throw new Error(`unknown pool kind '${kind}'`);
}

export interface SetDef {
  id: string;
  label: string;
  weight: number;
  reels: Reel[];
}

export class GlobalMixture {
  readonly kind = 'global_mixture' as const;
  readonly cum: number[];
  constructor(readonly sets: SetDef[]) {
    if (!sets.length) throw new Error('GlobalMixture: no sets');
    this.cum = cumThresholds(sets.map((s) => s.weight));
  }
}

export class PerReelPools {
  readonly kind = 'per_reel_pools' as const;
  readonly cums: number[][];
  readonly counts: number[];
  constructor(readonly reels: { id: string; weight: number; reel: Reel }[][]) {
    if (!reels.length || reels.some((r) => !r.length)) throw new Error('PerReelPools: every reel needs at least one pool');
    this.cums = reels.map((r) => cumThresholds(r.map((p) => p.weight)));
    this.counts = reels.map((r) => r.length);
  }
  encode(poolIdx: number[]): number {
    let idx = 0;
    let mult = 1;
    this.counts.forEach((k, c) => {
      idx += poolIdx[c] * mult;
      mult *= k;
    });
    return idx;
  }
}

export class HeightLaw {
  constructor(readonly reels: { values: number[]; cum: number[] }[]) {}
  maxHeight(c: number): number {
    const v = this.reels[c].values;
    return v[v.length - 1];
  }
  isFixed(c: number): boolean {
    return this.reels[c].values.length === 1;
  }
  draw(rng: SpinRng, c: number): number {
    const { values, cum } = this.reels[c];
    if (values.length === 1) return values[0];
    return values[rng.pickWeighted(cum)];
  }
}

export class TopReel {
  constructor(
    readonly columns: number[],
    readonly index: number,
  ) {}
  get n(): number {
    return this.columns.length;
  }
  slot(c: number): number | null {
    const i = this.columns.indexOf(c);
    return i < 0 ? null : i;
  }
  assemble(cells: number[], board: number[][]): number[][] {
    const out = board.map((col) => [...col]);
    this.columns.forEach((c, j) => {
      out[c] = [cells[j], ...out[c]];
    });
    return out;
  }
}

export interface Materialized {
  setIdx: number;
  stops: number[];
  heights: number[];
  board: number[][];
  reels: Reel[];
}

/** The board-law JSON the record carries (spec board_law after the adapter). */
export interface BoardLawRecord {
  kind: 'global_mixture' | 'per_reel_pools';
  sets?: { id: string; label: string; weight: number; strips: number[][] }[];
  reels?: { pools: PoolJson[] }[];
}

export class ReelSystem {
  readonly nReels: number;
  constructor(
    readonly cols: number,
    readonly rows: number[],
    readonly law: GlobalMixture | PerReelPools,
    readonly heightLaw: HeightLaw | null,
    readonly top: TopReel | null,
  ) {
    if (rows.length !== cols) throw new Error('rows must have one entry per reel');
    this.nReels = cols + (top ? 1 : 0);
    const reelLists = law instanceof GlobalMixture ? law.sets.map((s) => s.reels) : [law.reels];
    for (const reels of reelLists) {
      if (reels.length !== this.nReels) throw new Error(`every reel set needs ${this.nReels} reels, got ${reels.length}`);
    }
    if (top) {
      if (top.index !== cols || !top.columns.length) throw new Error('top reel: reel index must be cols and columns non-empty');
      for (const reel of this.reelsOf(cols)) {
        if (!(reel instanceof StripReel)) throw new Error('top reel: every top strip must be a physical strip');
        if (reel.length < top.n) throw new Error('top reel: strip shorter than its window');
      }
    }
    if (heightLaw) {
      for (let c = 0; c < cols; c++) {
        if (heightLaw.maxHeight(c) > rows[c]) throw new Error(`reel ${c}: height law maximum above rows[${c}]`);
        if (heightLaw.isFixed(c) && heightLaw.maxHeight(c) === rows[c]) continue;
        for (const reel of this.reelsOf(c)) {
          if (reel instanceof CatalogReel) throw new Error(`reel ${c}: a window catalog has one window height; a variable height needs a physical strip`);
        }
      }
    }
  }

  static fromRecord(rec: {
    geometry: { cols: number; rows: number[]; top_reel?: { columns: number[] } | null };
    board_law: BoardLawRecord;
    height_law?: { kind?: string; reels?: { pmf: Record<string, number> }[] } | null;
  }): ReelSystem {
    const { cols, rows } = rec.geometry;
    const topGeo = rec.geometry.top_reel;
    const top = topGeo ? new TopReel(topGeo.columns.map((c) => Math.trunc(c)), cols) : null;
    let heightLaw: HeightLaw | null = null;
    const hl = rec.height_law ?? { kind: 'fixed' };
    const hkind = hl.kind ?? 'fixed';
    if (hkind !== 'fixed') {
      if (hkind !== 'independent_categorical') throw new Error(`unknown height_law.kind '${hkind}'`);
      heightLaw = new HeightLaw(
        (hl.reels ?? []).map((entry, c) => {
          const items = Object.entries(entry.pmf)
            .map(([h, w]) => [Number(h), Number(w)] as [number, number])
            .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
          for (const [h, w] of items) {
            if (!(h >= 1 && h <= rows[c])) throw new Error(`height_law reel ${c}: height ${h} outside 1..${rows[c]}`);
            if (w <= 0) throw new Error(`height_law reel ${c}: weight ${w} for height ${h}`);
          }
          return { values: items.map(([h]) => h), cum: cumThresholds(items.map(([, w]) => w)) };
        }),
      );
    }
    const law = rec.board_law;
    if (law.kind === 'global_mixture') {
      const sets = (law.sets ?? []).map((s, i) => ({
        id: String(s.id ?? i),
        label: String(s.label ?? s.id ?? i),
        weight: Math.trunc(s.weight),
        reels: s.strips.map((st) => new StripReel(st) as Reel),
      }));
      return new ReelSystem(cols, rows, new GlobalMixture(sets), heightLaw, top);
    }
    if (law.kind === 'per_reel_pools') {
      const reels = (law.reels ?? []).map((rd, c) => {
        if (c >= cols && !top) throw new Error(`board_law.reels has more reels than columns and no geometry.top_reel`);
        const pools = rd.pools.map((p, i) => ({ id: String(p.id ?? i), weight: Math.trunc(p.weight), reel: reelFromPool(p) }));
        for (const p of pools) {
          if (p.reel instanceof CatalogReel && c < cols && p.reel.height !== rows[c]) {
            throw new Error(`reel ${c}: catalog height ${p.reel.height} != rows ${rows[c]}`);
          }
        }
        return pools;
      });
      return new ReelSystem(cols, rows, new PerReelPools(reels), heightLaw, top);
    }
    throw new Error(`unknown board_law.kind '${(law as { kind: string }).kind}'`);
  }

  reelsOf(c: number): Reel[] {
    return this.law instanceof GlobalMixture ? this.law.sets.map((s) => s.reels[c]) : this.law.reels[c].map((p) => p.reel);
  }

  allReels(): Reel[] {
    if (this.law instanceof GlobalMixture) return this.law.sets.flatMap((s) => s.reels);
    return this.law.reels.flatMap((pools) => pools.map((p) => p.reel));
  }

  get variableHeight(): boolean {
    return this.heightLaw !== null;
  }

  /** Every board-determining draw (no forcing: the runtime never forces). */
  materialize(rng: SpinRng): Materialized {
    const heights: number[] = [];
    const stops: number[] = [];
    const height = (c: number): number => (this.heightLaw ? this.heightLaw.draw(rng, c) : this.rows[c]);
    let setIdx: number;
    let reels: Reel[];
    if (this.law instanceof GlobalMixture) {
      setIdx = this.law.cum.length > 1 ? rng.pickWeighted(this.law.cum) : 0;
      reels = this.law.sets[setIdx].reels;
      reels.forEach((reel, c) => {
        if (c < this.cols) heights.push(height(c)); // height BEFORE the stop
        stops.push(rng.randrange(reel.length));
      });
    } else {
      const law = this.law;
      const poolIdx: number[] = [];
      reels = [];
      for (let c = 0; c < this.nReels; c++) {
        const p = law.counts[c] > 1 ? rng.pickWeighted(law.cums[c]) : 0;
        const reel = law.reels[c][p].reel;
        if (c < this.cols) heights.push(height(c)); // pool, then height, then stop
        stops.push(rng.randrange(reel.length));
        poolIdx.push(p);
        reels.push(reel);
      }
      setIdx = law.encode(poolIdx);
    }
    let board: number[][] = [];
    for (let c = 0; c < this.cols; c++) board.push(reels[c].window(stops[c], heights[c]));
    if (this.top) {
      const cells = reels[this.top.index].window(stops[this.top.index], this.top.n);
      board = this.top.assemble(cells, board);
    }
    return { setIdx, stops, heights, board, reels };
  }
}
