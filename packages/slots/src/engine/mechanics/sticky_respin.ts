// sticky_respin (pack: src/reelengine/mechanics/sticky_respin.py, class StickyRespin).
//
// Law: a base win starts the chain. Lock rule (every event): every visible cell showing a winning
// symbol (wilds excluded from the "winning symbol" set), every wild and every scatter locks.
// Each respin re-deals every unlocked cell from cell_pool (one pickWeighted per open cell,
// column-major; pool symbols sorted by their string form). The chain continues while the new
// board locks at least one NEW cell and the grid is not full; it ends on the first respin that
// locks nothing (or fills the grid, or hits max_respins, flagged when it still locked something).
// One payment only: the FINAL board's evaluator wins (through the post_multiplier step hooks).
// The base step's wins are zeroed (flagged "base win superseded"). Steps: one per respin; the
// intermediate step boards are display only (no wins, 0 coins); the last step is the paying board.
// Scatters settle on the base board. Decor: locked (cellList, the terminal locked set), respins
// (int, respins played).

import type { Board } from '../evaluators';
import { emitDecor, type SpinCtx } from '../pipeline';
import { cumThresholds } from '../rng';
import type { SpinWin } from '../types';
import type { SlotEngine } from '../engine';
import { MechanicPlugin, type Params, type Stage } from './protocol';
import { register } from './registry';

const ID = 'sticky_respin';
const ALLOWED = new Set(['cell_pool', 'max_respins']);

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

/** Python `int(s)` on a dict key, or null where int() raises (the key stays a string). */
function tryPyInt(s: string): number | null {
  const t = s.trim();
  if (!/^[+-]?\d+(_\d+)*$/.test(t)) return null;
  return Number(t.replace(/_/g, ''));
}

export class StickyRespin extends MechanicPlugin {
  override ID = ID;
  override STAGE: Stage = 'continuation';
  override DECOR_SCHEMA = { locked: 'cellList', respins: 'int' } as const;
  override APPLIES_TO = null;
  override SETTLES_SCATTER = 'base' as const;

  poolSyms: (number | string)[] = [];
  poolCum: number[] = [];
  cap = 200;

  constructor(engine: SlotEngine, params: Params, instance: string) {
    super(engine, params, instance);
  }

  override init(): void {
    const p = this.params;
    const unknown = Object.keys(p).filter((k) => !ALLOWED.has(k)).sort();
    if (unknown.length) throw new Error(`${ID}: unknown params ${JSON.stringify(unknown)}`);
    const pool = p.cell_pool;
    if (!pool || typeof pool !== 'object' || Array.isArray(pool) || !Object.keys(pool).length) {
      throw new Error(`${ID}: cell_pool must be a non-empty {symbol: weight} map`);
    }
    const items: [number | string, number][] = [];
    for (const [s, w] of Object.entries(pool as Record<string, unknown>)) {
      const n = tryPyInt(s);
      const sym = n === null ? s : n;
      if (!isInt(w) || w <= 0) throw new Error(`${ID}: cell_pool weight for '${s}' must be a positive int`);
      items.push([sym, w]);
    }
    // items.sort(key=lambda kv: str(kv[0])) — stable
    items.sort((a, b) => {
      const x = String(a[0]);
      const y = String(b[0]);
      return x < y ? -1 : x > y ? 1 : 0;
    });
    this.poolSyms = items.map(([s]) => s);
    this.poolCum = cumThresholds(items.map(([, w]) => w));
    const cap = 'max_respins' in p ? p.max_respins : 200;
    if (!isInt(cap) || cap < 1) throw new Error(`${ID}: max_respins must be an int >= 1`);
    this.cap = cap;
  }

  private locks(board: Board, wins: SpinWin[]): Set<string> {
    const eng = this.engine;
    const winning = new Set<number>();
    for (const w of wins) {
      for (const [c, r] of w.cells) {
        const v = board[c][r];
        if (!eng.wilds.has(v)) winning.add(v);
      }
    }
    const out = new Set<string>();
    board.forEach((col, c) => col.forEach((v, r) => {
      if (winning.has(v) || eng.wilds.has(v) || v === eng.scatter) out.add(`${c},${r}`);
    }));
    return out;
  }

  override run(ctx: SpinCtx): void {
    if (!ctx.wins.length) return;
    const eng = this.engine;
    const rng = ctx.rng;
    const rows = eng.rows;
    const nCells = rows.reduce((a, b) => a + b, 0);
    let board = ctx.board;
    const locked = this.locks(board, ctx.wins);
    // single payment on the terminal board: the base win is superseded
    ctx.wins = [];
    ctx.lineTotal = 0;
    ctx.flags.push(`${this.instance}: base win superseded by the terminal board`);
    const multipliers = eng.stage('post_multiplier');
    let played = 0;
    for (;;) {
      played += 1;
      const cols: number[][] = board.map((col) => [...col]);
      for (let c = 0; c < eng.cols; c++) {
        for (let r = 0; r < rows[c]; r++) {
          if (locked.has(`${c},${r}`)) continue;
          if (r >= cols[c].length) throw new Error(`${ID}: IndexError (row ${r} beyond column ${c})`);
          cols[c][r] = this.poolSyms[rng.pickWeighted(this.poolCum)] as number;
        }
      }
      board = cols;
      ctx.board = board; // the step multipliers read the step board
      let wins = [...eng.evaluator.wins(board)];
      const newLocks = [...this.locks(board, wins)].filter((k) => !locked.has(k));
      const capped = played >= this.cap;
      if (newLocks.length && !capped && locked.size + newLocks.length < nCells) {
        for (const k of newLocks) locked.add(k);
        ctx.steps.push({ board, wins: [], stepCoins: 0 });
        ctx.board = board;
        continue;
      }
      for (const k of newLocks) locked.add(k);
      if (capped && newLocks.length) ctx.flags.push(`${this.instance}: respin cap ${this.cap} hit`);
      if (wins.length) for (const p of multipliers) wins = p.stepWins(ctx, played, wins);
      const coins = wins.reduce((a, w) => a + w.coins, 0);
      ctx.steps.push({ board, wins: [...wins], stepCoins: coins });
      ctx.board = board;
      break;
    }
    const cells = [...locked].map((k) => {
      const i = k.indexOf(',');
      return [Number(k.slice(0, i)), Number(k.slice(i + 1))] as [number, number];
    });
    cells.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    emitDecor(ctx, this, 'locked', cells);
    emitDecor(ctx, this, 'respins', played);
  }
}

register(ID, 'continuation', StickyRespin);
