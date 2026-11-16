// tape_continuation_refill (= the pack's `tumble`) and the two categorical refill laws that share its
// cascade (iid_per_column_refill, draw_based_refill). Pack: src/reelengine/mechanics/tumble.py and
// reelsystem.TopReel.tumble_row.
//
// Winning cells are removed, survivors fall to the bottom keeping their order, the m freed top
// cells refill from the strip at stops[c] - consumed[c] - m + i (the tape continues upward),
// consumed[c] += m; the loop ends on a zero-win step. Scatters settle on the TERMINAL board.

import { cellKey, type Board } from '../evaluators';
import { boardWins, type SpinCtx } from '../pipeline';
import { StripReel, type TopReel } from '../reelsystem';
import type { SpinWin } from '../types';
import { MechanicPlugin, strPmf, type Params, type Stage } from './protocol';
import { register } from './registry';
import type { SlotEngine } from '../engine';

const MAX_REVIVES = 1000;

/** reelsystem.TopReel.tumble_row: the top reel's own gravity along the listed columns. */
function topTumbleRow(top: TopReel, ctx: SpinCtx, grid: number[][], removed: Set<string>, newTags: Map<string, unknown>, newMult: Map<string, number>): void {
  const idx = top.index;
  while (ctx.tapeConsumed.length <= idx) ctx.tapeConsumed.push(0);
  const mult = ctx.multiplicity;
  const cols = top.columns;
  const slots: number[] = [];
  cols.forEach((c, j) => {
    if (!ctx.masked.has(cellKey(c, 0))) slots.push(j);
  });
  const kept: [number, unknown, number | undefined][] = [];
  for (const j of slots) {
    const key = cellKey(cols[j], 0);
    if (!removed.has(key)) kept.push([grid[cols[j]][0], ctx.tags.get(key), mult.get(key)]);
  }
  const m = slots.length - kept.length;
  if (!m) {
    for (const j of slots) {
      const key = cellKey(cols[j], 0);
      const tag = ctx.tags.get(key);
      if (tag !== undefined && tag !== null) newTags.set(key, tag);
      const mu = mult.get(key);
      if (mu !== undefined) newMult.set(key, mu);
    }
    return;
  }
  const reel = ctx.reels[idx];
  const start = ctx.stops[idx] - ctx.tapeConsumed[idx] - m;
  for (let i = 0; i < m; i++) {
    grid[cols[slots[i]]][0] = reel.cell(start + i);
    ctx.refilled.add(cellKey(cols[slots[i]], 0));
  }
  kept.forEach(([v, tag, mu], j) => {
    const c = cols[slots[m + j]];
    grid[c][0] = v;
    const key = cellKey(c, 0);
    if (tag !== undefined && tag !== null) newTags.set(key, tag);
    if (mu !== undefined) newMult.set(key, mu);
  });
  ctx.tapeConsumed[idx] += m;
}

export class Tumble extends MechanicPlugin {
  static readonly STAGE: Stage = 'continuation';
  override ID = 'tumble';
  override STAGE: Stage = 'continuation';
  override APPLIES_TO = ['cluster', 'scatter_pays', 'payline', 'ways'];
  override SETTLES_SCATTER = 'terminal' as const;
  override REQUIRES_TAPE = true;
  REFILL: 'tape' | 'column_pool' = 'tape';
  maxSteps = 10_000;

  constructor(engine: SlotEngine, params: Params, instance: string) {
    super(engine, params, instance);
  }

  override init(): void {
    this.parse(this.params);
    if (this.REFILL !== 'tape' && this.engine.rowsUniform === null) throw new Error(`${this.ID}: the per-column refill pools need uniform reel heights`);
    if (this.REFILL === 'tape') {
      for (const reel of this.engine.reelsystem.allReels()) {
        if (!(reel instanceof StripReel)) throw new Error(`${this.ID}: every reel must be a physical strip (a window catalog has no tape beyond its window)`);
      }
    }
  }

  parse(params: Params): void {
    const keys = Object.keys(params);
    if (keys.length) throw new Error(`tumble: unknown params ${JSON.stringify(keys.sort())}`);
  }

  /** The symbol for the i-th (top-down) refilled cell of column c when m cells refill. */
  refillCell(ctx: SpinCtx, c: number, i: number, m: number): number {
    const start = ctx.stops[c] - ctx.tapeConsumed[c] - m;
    return ctx.reels[c].cell(start + i);
  }

  /** P10 seam: draws a refill bank's source before any refill draw (tape law: nothing). */
  beginRefill(_ctx: SpinCtx): void {}

  /** The column law applied to `removed` (the one copy; hooks that collapse call it too). */
  collapse(ctx: SpinCtx, board: Board, removed: Set<string>): Board {
    this.beginRefill(ctx);
    const eng = this.engine;
    const grid = board.map((col) => [...col]);
    const refilled = new Set<string>();
    ctx.refilled = refilled;
    ctx.collapses += 1;
    const newTags = new Map<string, unknown>();
    const newMult = new Map<string, number>();
    const top = eng.reelsystem.top;
    for (let c = 0; c < eng.cols; c++) {
      const col = grid[c];
      const first = top !== null && top.columns.includes(c) ? 1 : 0;
      const slots: number[] = [];
      for (let r = first; r < col.length; r++) if (!ctx.masked.has(cellKey(c, r))) slots.push(r);
      const kept: [number, unknown, number | undefined][] = [];
      for (const r of slots) {
        const key = cellKey(c, r);
        if (!removed.has(key)) kept.push([col[r], ctx.tags.get(key), ctx.multiplicity.get(key)]);
      }
      const m = slots.length - kept.length;
      if (!m) {
        for (const r of slots) {
          const key = cellKey(c, r);
          const tag = ctx.tags.get(key);
          if (tag !== undefined && tag !== null) newTags.set(key, tag);
          const mu = ctx.multiplicity.get(key);
          if (mu !== undefined) newMult.set(key, mu);
        }
        continue;
      }
      for (let i = 0; i < m; i++) {
        col[slots[i]] = this.refillCell(ctx, c, i, m);
        refilled.add(cellKey(c, slots[i]));
      }
      kept.forEach(([v, tag, mu], j) => {
        const r = slots[m + j];
        col[r] = v;
        const key = cellKey(c, r);
        if (tag !== undefined && tag !== null) newTags.set(key, tag);
        if (mu !== undefined) newMult.set(key, mu);
      });
      ctx.tapeConsumed[c] += m;
    }
    if (top !== null) topTumbleRow(top, ctx, grid, removed, newTags, newMult);
    for (const key of ctx.masked) {
      const tag = ctx.tags.get(key);
      if (tag !== undefined && tag !== null) newTags.set(key, tag);
      const mu = ctx.multiplicity.get(key);
      if (mu !== undefined) newMult.set(key, mu);
    }
    ctx.tags = newTags;
    ctx.multiplicity = newMult;
    return grid;
  }

  private hooks(): MechanicPlugin[] {
    return this.engine.mechInstances.filter((p) => p.TUMBLE_HOOK);
  }

  private payStep(ctx: SpinCtx, k: number, step: number, board: Board, hooks: MechanicPlugin[]): [SpinWin[], number] {
    let wins = boardWins(ctx, board, step);
    ctx.stepSuppressed = false;
    for (const p of hooks) wins = p.overrideStepWins(ctx, step, board, wins);
    if (wins.length && !ctx.stepSuppressed) {
      k += 1;
      ctx.payingSteps = k;
      for (const p of this.engine.stage('post_multiplier')) wins = p.stepWins(ctx, k, wins);
      ctx.payingScreens += 1;
    }
    return [wins, k];
  }

  override run(ctx: SpinCtx): void {
    const hooks = this.hooks();
    let board = ctx.board;
    let wins = ctx.wins;
    let k = 0;
    ctx.payingScreens = wins.length && !ctx.baseSuppressed ? 1 : 0;
    let step = 0;
    let revives = 0;
    for (const p of hooks) p.onStep(ctx, 0, board, wins);
    if (wins.length && hooks.some((p) => p.cascadeRests(ctx, 0, board, wins))) return;
    if (!wins.length) {
      let revived: Board | null = null;
      for (const p of hooks) {
        revived = p.revive(ctx, 0, board);
        if (revived !== null) break;
      }
      if (revived === null) return;
      revives += 1;
      board = revived;
      ctx.board = board;
      [wins, k] = this.payStep(ctx, k, 1, board, hooks);
      step += 1;
      ctx.steps.push({ board, wins: [...wins], stepCoins: wins.reduce((a, w) => a + w.coins, 0) });
      ctx.board = board;
      for (const p of hooks) p.onStep(ctx, step, board, wins);
      if (wins.length && hooks.some((p) => p.cascadeRests(ctx, step, board, wins))) return;
    }
    for (let it = 0; it < this.maxSteps; it++) {
      if (!wins.length) {
        let revived: Board | null = null;
        if (revives < MAX_REVIVES) {
          for (const p of hooks) {
            revived = p.revive(ctx, step, board);
            if (revived !== null) break;
          }
        }
        if (revived === null) return;
        revives += 1;
        board = revived;
      } else {
        let removed = new Set<string>();
        for (const w of wins) for (const [c, r] of w.cells) removed.add(cellKey(c, r));
        for (const p of hooks) for (const key of p.retainCells(ctx, board, wins)) removed.delete(key);
        for (const p of hooks) for (const key of p.extraRemovals(ctx, board)) removed.add(key);
        removed = new Set([...removed].filter((key) => !ctx.masked.has(key)));
        board = this.collapse(ctx, board, removed);
      }
      step += 1;
      for (const p of hooks) board = p.afterRefill(ctx, step, board);
      ctx.board = board;
      [wins, k] = this.payStep(ctx, k, step, board, hooks);
      ctx.steps.push({ board, wins: [...wins], stepCoins: wins.reduce((a, w) => a + w.coins, 0) });
      ctx.board = board;
      for (const p of hooks) p.onStep(ctx, step, board, wins);
      if (wins.length && hooks.some((p) => p.cascadeRests(ctx, step, board, wins))) return;
    }
    throw new Error(`${this.ID}: cascade did not terminate`);
  }
}

function columnPool(name: string, pool: unknown): [number[] | string[], number[]] {
  const [values, cum] = strPmf(name, pool);
  const syms = values.map((v) => {
    const n = Number(v);
    return v.trim() !== '' && Number.isInteger(n) ? n : v;
  });
  return [syms as number[], cum];
}

export class IidPerColumnRefill extends Tumble {
  override ID = 'iid_per_column_refill';
  override REQUIRES_TAPE = false;
  override REFILL = 'column_pool' as const;
  pools: [number[], number[]][] = [];

  override parse(params: Params): void {
    const unknown = Object.keys(params).filter((k) => k !== 'column_pools' && k !== 'pool');
    if (unknown.length) throw new Error(`iid_per_column_refill: unknown params ${JSON.stringify(unknown.sort())}`);
    let pools = params.column_pools as unknown[] | undefined;
    const shared = params.pool;
    if ((pools === undefined) === (shared === undefined)) throw new Error('iid_per_column_refill: give exactly one of column_pools or pool');
    if (shared !== undefined) pools = Array.from({ length: this.engine.cols }, () => shared);
    if (!Array.isArray(pools) || pools.length !== this.engine.cols) throw new Error(`iid_per_column_refill: column_pools must list ${this.engine.cols} maps`);
    this.pools = pools.map((p, c) => columnPool(`iid_per_column_refill: column_pools[${c}]`, p) as [number[], number[]]);
  }

  override refillCell(ctx: SpinCtx, c: number): number {
    const [syms, cum] = this.pools[c];
    return syms[ctx.rng.pickWeighted(cum)];
  }
}

export class DrawBasedRefill extends Tumble {
  override ID = 'draw_based_refill';
  override REQUIRES_TAPE = false;
  override REFILL = 'column_pool' as const;
  poolsBySet = new Map<string, [number[], number[]][]>();
  setIds: string[] = [];

  override parse(params: Params): void {
    const unknown = Object.keys(params).filter((k) => k !== 'set_pools');
    if (unknown.length) throw new Error(`draw_based_refill: unknown params ${JSON.stringify(unknown.sort())}`);
    const sp = params.set_pools as Record<string, unknown[]> | undefined;
    if (!sp || typeof sp !== 'object' || !Object.keys(sp).length) throw new Error('draw_based_refill: set_pools must be a non-empty {set_id: [pool per column]} map');
    const law = this.engine.reelsystem.law;
    const setIds = law.kind === 'global_mixture' ? law.sets.map((s) => s.id) : [];
    for (const [sid, pools] of Object.entries(sp)) {
      if (!Array.isArray(pools) || pools.length !== this.engine.cols) throw new Error(`draw_based_refill: set_pools['${sid}'] must list ${this.engine.cols} maps`);
      if (sid !== 'default' && !setIds.includes(sid)) throw new Error(`draw_based_refill: set_pools names set '${sid}', not a global-mixture set id`);
      this.poolsBySet.set(
        sid,
        pools.map((p, c) => columnPool(`draw_based_refill: set_pools[${sid}][${c}]`, p) as [number[], number[]]),
      );
    }
    const missing = setIds.filter((s) => !this.poolsBySet.has(s));
    if (missing.length && !this.poolsBySet.has('default')) throw new Error(`draw_based_refill: sets ${missing.join(', ')} have no refill pools and no "default" entry`);
    if (!setIds.length && !this.poolsBySet.has('default')) throw new Error('draw_based_refill: a per_reel_pools board law needs the "default" set_pools entry');
    this.setIds = setIds;
  }

  private poolsFor(ctx: SpinCtx): [number[], number[]][] {
    if (this.setIds.length) {
      const sid = this.setIds[ctx.setIdx];
      const p = this.poolsBySet.get(sid);
      if (p) return p;
    }
    return this.poolsBySet.get('default')!;
  }

  override refillCell(ctx: SpinCtx, c: number): number {
    const [syms, cum] = this.poolsFor(ctx)[c];
    return syms[ctx.rng.pickWeighted(cum)];
  }
}

register('tumble', 'continuation', Tumble);
register('iid_per_column_refill', 'continuation', IidPerColumnRefill);
register('draw_based_refill', 'continuation', DrawBasedRefill);
