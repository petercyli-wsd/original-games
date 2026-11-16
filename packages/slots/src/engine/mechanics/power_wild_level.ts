// power_wild_level (pack: src/reelengine/mechanics/power_wild_level.py).
// Law (TUMBLE_HOOK): every power_wild_symbol cell draws a LEVEL when it lands, one level_pmf draw:
//  - the base board's power wilds at S1 (board_transform), column-major;
//  - refilled power wilds in afterRefill, column-major over the cells with no tag (a kept wild
//    carries its tag under gravity, so a missing tag means a fresh landing).
// The level lives in ctx.tags["c,r"], which the cascade moves with the cell.
// retainCells: a power wild inside a winning combination whose level is > 1 STAYS and drops one
// level; at level 1 it leaves with the win. A cell in several wins is counted once.
// Needs a cascade continuation (tumble / tape_continuation_refill / draw_based_refill /
// iid_per_column_refill) in the record. Decor: levels (moneyMap, the base-board landing levels).

import { cellKey, type Board } from '../evaluators';
import { emitDecor, type SpinCtx } from '../pipeline';
import { CatalogReel, StripReel } from '../reelsystem';
import type { SpinWin } from '../types';
import { MechanicPlugin, intPmf, type Params } from './protocol';
import { REGISTRY, register, resolve } from './registry';
import { Tumble } from './tumble';

const ID = 'power_wild_level';
const ALLOWED = new Set(['power_wild_symbol', 'level_pmf']);

function symId(name: string, v: unknown): unknown {
  if (typeof v === 'boolean') throw new Error(`${ID}: ${name} must be a symbol id, got ${String(v)}`);
  if (typeof v === 'string' && /^-?\d+$/.test(v)) return Number(v);
  return v;
}

export class PowerWildLevel extends MechanicPlugin {
  override ID = ID;
  override STAGE = 'board_transform' as const;
  override DECOR_SCHEMA = { levels: 'moneyMap' } as const;
  override APPLIES_TO = null;
  override TUMBLE_HOOK = true;
  power = 0;
  levels: number[] = [];
  levelCum: number[] = [];

  override init(): void {
    const p: Params = this.params;
    const unknown = Object.keys(p).filter((k) => !ALLOWED.has(k)).sort();
    if (unknown.length) throw new Error(`${ID}: unknown params [${unknown.join(', ')}]`);
    const cascade = this.engine.rec.mechanics.some((e) => {
      const cls = REGISTRY.get(resolve(e.id));
      return !!cls && (cls === (Tumble as unknown) || cls.prototype instanceof Tumble);
    });
    if (!cascade) {
      throw new Error(`${ID}: needs a cascade continuation in the record (tumble / tape_continuation_refill / draw_based_refill / iid_per_column_refill): a level only decrements through a cascade`);
    }
    for (const req of ['power_wild_symbol', 'level_pmf']) if (!(req in p)) throw new Error(`${ID}: ${req} is required`);
    const power = symId('power_wild_symbol', p.power_wild_symbol);
    if (typeof power !== 'number' || !this.engine.wilds.has(power)) throw new Error(`${ID}: power_wild_symbol ${String(power)} must be a declared wild`);
    const alphabet = new Set<unknown>();
    for (const reel of this.engine.reelsystem.allReels()) {
      if (reel instanceof StripReel) for (const s of reel.cells) alphabet.add(s);
      else if (reel instanceof CatalogReel) for (const e of reel.entries) for (const s of e.window) alphabet.add(s);
    }
    if (alphabet.size && !alphabet.has(power)) throw new Error(`${ID}: power_wild_symbol ${power} not on any strip (no power wild could ever land)`);
    this.power = power;
    [this.levels, this.levelCum] = intPmf(`${ID}: level_pmf`, p.level_pmf, 1);
    if (Math.max(...this.levels) < 2) throw new Error(`${ID}: level_pmf must give some mass to a level >= 2 (a level-1-only wild never persists: inert)`);
  }

  private drawLevel(ctx: SpinCtx): number {
    return this.levels[ctx.rng.pickWeighted(this.levelCum)];
  }

  // S1: the base board's landings, column-major.
  override apply(ctx: SpinCtx): void {
    const rows = this.engine.rows;
    const levels: [string, number][] = [];
    for (let c = 0; c < this.engine.cols; c++) {
      for (let r = 0; r < rows[c]; r++) {
        if (ctx.board[c][r] === this.power) {
          const lv = this.drawLevel(ctx);
          ctx.tags.set(cellKey(c, r), lv);
          levels.push([cellKey(c, r), lv]);
        }
      }
    }
    if (levels.length) emitDecor(ctx, this, 'levels', Object.fromEntries(levels));
  }

  override afterRefill(ctx: SpinCtx, _k: number, board: Board): Board {
    const rows = this.engine.rows;
    for (let c = 0; c < this.engine.cols; c++) {
      for (let r = 0; r < rows[c]; r++) {
        const key = cellKey(c, r);
        if (board[c][r] === this.power && !ctx.tags.has(key)) ctx.tags.set(key, this.drawLevel(ctx));
      }
    }
    return board;
  }

  override retainCells(ctx: SpinCtx, board: Board, wins: SpinWin[]): Set<string> {
    const retained = new Set<string>();
    for (const w of wins) {
      for (const [c, r] of w.cells) {
        const key = cellKey(c, r);
        if (retained.has(key) || board[c][r] !== this.power) continue;
        const level = (ctx.tags.get(key) as number | undefined) ?? 1;
        if (level > 1) {
          ctx.tags.set(key, level - 1);
          retained.add(key);
        }
      }
    }
    return retained;
  }
}

register(ID, 'board_transform', PowerWildLevel);
