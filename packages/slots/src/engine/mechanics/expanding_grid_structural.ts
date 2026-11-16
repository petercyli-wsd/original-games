// expanding_grid_structural (pack: src/reelengine/mechanics/expanding_grid_structural.py).
// Law: at S1 the locked units (`locked` rows from the top / bottom, or reels from the right / left)
// are added to ctx.masked, their materialised window symbols are stored and the board shows
// `blank_symbol` there (an id on no strip, not a wild / the scatter / a paying symbol). The cascade
// never removes, moves or refills a masked cell. In afterRefill(k) (k = refills so far) the schedule
// (`unlock_schedule` XOR `unlock_per_step`) unlocks the next unit, nearest the open area first, and
// reveals the stored window symbols (`reveal` "window") or the lowest declared wild ("wild").
// Zero draws; no cross-spin state. Needs a tumble-family continuation and uniform reel heights.
// Decor: masked (cellList; the cells masked at S1), unlockedAt (intList; the step of every unlock).

import { cellKey, type Board } from '../evaluators';
import { emitDecor, type SpinCtx } from '../pipeline';
import { CatalogReel, StripReel } from '../reelsystem';
import type { SlotEngine } from '../engine';
import { MechanicPlugin, type Stage } from './protocol';
import { isContinuationId, REGISTRY, register, resolve } from './registry';
import { Tumble } from './tumble';

const ID = 'expanding_grid_structural';
const ALLOWED = new Set(['unlock', 'locked', 'unlock_schedule', 'unlock_per_step', 'blank_symbol', 'reveal']);
const UNLOCKS = ['rows_top', 'rows_bottom', 'columns_right', 'columns_left'];
const REVEALS = ['window', 'wild'];
const TUMBLE_IDS = ['tumble', 'tape_continuation_refill', 'draw_based_refill', 'iid_per_column_refill'];

const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);

/** engine.reelsystem_alphabet(): every symbol on any strip / catalog window. */
function alphabet(engine: SlotEngine): Set<unknown> {
  const out = new Set<unknown>();
  for (const reel of engine.reelsystem.allReels()) {
    if (reel instanceof StripReel) for (const s of reel.cells) out.add(s);
    else if (reel instanceof CatalogReel) for (const e of reel.entries) for (const s of e.window) out.add(s);
    else throw new Error(`${ID}: unknown reel kind for the alphabet check`);
  }
  return out;
}

interface St {
  materialised: Map<string, number>;
  next: number;
}

class ExpandingGridStructural extends MechanicPlugin {
  override ID = ID;
  override STAGE: Stage = 'board_transform';
  override DECOR_SCHEMA = { masked: 'cellList', unlockedAt: 'intList' } as const;
  override APPLIES_TO = null;
  override TUMBLE_HOOK = true;
  unlock = 'rows_top';
  locked = 1;
  blank = 0;
  reveal = 'window';
  wild: number | null = null;
  thresholds: number[] = [];
  units: [number, number][][] = [];

  override init(): void {
    const p = this.params;
    const eng = this.engine;
    const unknown = Object.keys(p).filter((k) => !ALLOWED.has(k)).sort();
    if (unknown.length) throw new Error(`${ID}: unknown params [${unknown.join(', ')}] (allowed: ${[...ALLOWED].sort().join(', ')})`);
    if (eng.rowsUniform === null) throw new Error(`${ID}: needs uniform reel heights (row units span every reel)`);
    const conts = eng.rec.mechanics.map((e) => e.id).filter(isContinuationId);
    const isTumble = (id: string) => {
      const cls = REGISTRY.get(resolve(id));
      return !!cls && (cls === (Tumble as unknown) || cls.prototype instanceof Tumble);
    };
    if (!conts.length || !conts.every(isTumble)) {
      throw new Error(`${ID}: needs a tumble-family continuation (${TUMBLE_IDS.join(' | ')}); found ${conts.length ? conts.join(', ') : 'none'}`);
    }
    for (const req of ['unlock', 'locked', 'blank_symbol']) if (!(req in p)) throw new Error(`${ID}: ${req} is required`);
    const unlock = p.unlock;
    if (typeof unlock !== 'string' || !UNLOCKS.includes(unlock)) throw new Error(`${ID}: unlock ${JSON.stringify(unlock)} not in ${UNLOCKS.join(', ')}`);
    const rows = eng.rowsUniform;
    const cols = eng.cols;
    const locked = p.locked;
    const limit = unlock.startsWith('rows') ? rows : cols;
    if (!isInt(locked) || locked < 1 || locked >= limit) {
      throw new Error(`${ID}: locked must be an int in 1..${limit - 1} for ${unlock} (something must stay visible)`);
    }
    const sched = p.unlock_schedule;
    const per = p.unlock_per_step;
    if ((sched === undefined || sched === null) === (per === undefined || per === null)) throw new Error(`${ID}: give exactly one of unlock_schedule or unlock_per_step`);
    if (sched !== undefined && sched !== null) {
      if (!(Array.isArray(sched) && sched.length && sched.every((x) => isInt(x) && x >= 1) && sched.every((x, i) => i === 0 || sched[i - 1] < x))) {
        throw new Error(`${ID}: unlock_schedule must be a non-empty strictly ascending list of ints >= 1`);
      }
      this.thresholds = (sched as number[]).slice(0, locked);
    } else {
      if (!isInt(per) || per < 1) throw new Error(`${ID}: unlock_per_step must be an int >= 1`);
      this.thresholds = Array.from({ length: locked }, (_, i) => per * (i + 1));
    }
    const blank = p.blank_symbol;
    if (!isInt(blank)) throw new Error(`${ID}: blank_symbol must be an int symbol id`);
    if (eng.wilds.has(blank) || blank === eng.scatter || String(blank) in eng.paytable) {
      throw new Error(`${ID}: blank_symbol ${blank} must not be a wild, the scatter or a paying symbol (it is the mask's display symbol)`);
    }
    if (alphabet(eng).has(blank)) throw new Error(`${ID}: blank_symbol ${blank} is on a strip (the mask must be distinguishable from every landed symbol)`);
    const reveal = p.reveal === undefined ? 'window' : p.reveal;
    if (typeof reveal !== 'string' || !REVEALS.includes(reveal)) throw new Error(`${ID}: reveal ${JSON.stringify(reveal)} not in ${REVEALS.join(', ')}`);
    if (reveal === 'wild') {
      if (!eng.wilds.size) throw new Error(`${ID}: reveal 'wild' needs a declared wild`);
      this.wild = [...eng.wilds].sort((a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0))[0];
    } else {
      this.wild = null;
    }
    this.unlock = unlock;
    this.locked = locked;
    this.blank = blank;
    this.reveal = reveal;
    let order: number[];
    if (unlock === 'rows_top') order = Array.from({ length: locked }, (_, i) => locked - 1 - i);
    else if (unlock === 'rows_bottom') order = Array.from({ length: locked }, (_, i) => rows - locked + i);
    else if (unlock === 'columns_right') order = Array.from({ length: locked }, (_, i) => cols - locked + i);
    else order = Array.from({ length: locked }, (_, i) => locked - 1 - i);
    this.units = unlock.startsWith('rows')
      ? order.map((r) => Array.from({ length: cols }, (_, c) => [c, r] as [number, number]))
      : order.map((c) => Array.from({ length: rows }, (_, r) => [c, r] as [number, number]));
  }

  // ---- S1: mask ----
  override apply(ctx: SpinCtx): void {
    const cols = ctx.board.map((col) => [...col]);
    const materialised = new Map<string, number>();
    const masked: [number, number][] = [];
    for (const unit of this.units) {
      for (const [c, r] of unit) {
        materialised.set(cellKey(c, r), cols[c][r]);
        cols[c][r] = this.blank;
        masked.push([c, r]);
      }
    }
    for (const [c, r] of masked) ctx.masked.add(cellKey(c, r));
    ctx.board = cols;
    ctx.state.set(this.instance, { materialised, next: 0 } satisfies St);
    emitDecor(ctx, this, 'masked', masked.sort((a, b) => a[0] - b[0] || a[1] - b[1]));
    emitDecor(ctx, this, 'unlockedAt', []);
  }

  // ---- cascade hook: unlock ----
  override afterRefill(ctx: SpinCtx, k: number, board: Board): Board {
    const st = ctx.state.get(this.instance) as St | undefined;
    if (st === undefined) return board;
    const n = this.thresholds.length;
    if (st.next >= n || k < this.thresholds[st.next]) return board;
    const cols = board.map((col) => [...col]);
    while (st.next < n && k >= this.thresholds[st.next]) {
      const unit = this.units[st.next];
      st.next += 1;
      for (const [c, r] of unit) {
        const key = cellKey(c, r);
        ctx.masked.delete(key);
        cols[c][r] = this.reveal === 'window' ? (st.materialised.get(key) as number) : (this.wild as number);
      }
      (ctx.decor.get(this.decorKey('unlockedAt')) as number[]).push(k);
    }
    return cols;
  }
}

register(ID, 'board_transform', ExpandingGridStructural);
