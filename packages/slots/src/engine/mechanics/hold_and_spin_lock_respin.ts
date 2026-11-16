// hold_and_spin_lock_respin (pack: src/reelengine/mechanics/hold_and_spin.py, class HoldAndSpin).
//
// Law: when the base board shows at least entry_min coin_symbol cells, every coin cell is HELD
// with a value from value_pmf (one pickWeighted per coin, column-major). Then respins play with a
// counter that starts at `respins` and resets to `respins` whenever a new coin lands
// (reset_on_landing, default true). Each respin re-deals every non-held cell:
//   - "reel_redraw": every reel draws a fresh stop (randrange(len) in reel order); a coin landing on
//     a non-held cell is held with a value drawn right after that reel's stop, column-major;
//   - "cell_pool": each non-held cell draws blank/coin from cell_pool (column-major); a coin draws
//     its value at once; a blank cell shows blank_symbol.
// The episode ends when the counter hits 0, the grid is full, or at max_respins_total (flagged).
// One step per respin: its board is the whole grid after that respin (held cells show the coin);
// steps carry no wins and 0 coins. One terminal extra pays sum(held values) x coin_multiplier
// (+ full_grid_bonus x bet when every cell is held). The base step keeps its own wins; scatters
// settle on the base board. Decor: heldVals (moneyMap "c,r" -> value, the terminal held set),
// respins (int, respins played).

import type { Board } from '../evaluators';
import { emitDecor, type SpinCtx } from '../pipeline';
import { CatalogReel, StripReel } from '../reelsystem';
import { cumThresholds } from '../rng';
import type { SlotEngine } from '../engine';
import { MechanicPlugin, type Params, type Stage } from './protocol';
import { register } from './registry';

const ID = 'hold_and_spin_lock_respin';
const ALLOWED = new Set([
  'coin_symbol', 'value_pmf', 'entry_min', 'respins', 'reset_on_landing', 'respin_law', 'cell_pool',
  'blank_symbol', 'coin_multiplier', 'full_grid_bonus', 'max_respins_total', 'lock_symbol',
]);
const RESPIN_LAWS = ['reel_redraw', 'cell_pool'];

/** Python isinstance(v, int) and not bool, on a JSON value. */
function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

/** Python bool(v) for a JSON value. */
function pyBool(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v as object).length > 0;
  return true;
}

/** Python int(str) for a dict key (raises on anything int() refuses). */
function pyIntKey(k: string, what: string): number {
  const s = k.trim();
  if (!/^[+-]?\d+(_\d+)*$/.test(s)) throw new Error(`${ID}: ${what} key ${JSON.stringify(k)} is not an int`);
  return Number(s.replace(/_/g, ''));
}

function pmf(name: string, raw: unknown, minValue: number): [number[], number[]] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Object.keys(raw).length) {
    throw new Error(`${ID}: ${name} must be a non-empty {value: weight} map`);
  }
  const items: [number, number][] = [];
  for (const [v, w] of Object.entries(raw as Record<string, unknown>)) {
    const iv = pyIntKey(v, name);
    if (iv < minValue || !isInt(w) || w <= 0) throw new Error(`${ID}: ${name} entry '${v}': ${String(w)} invalid`);
    items.push([iv, w]);
  }
  items.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return [items.map(([v]) => v), cumThresholds(items.map(([, w]) => w))];
}

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

export class HoldAndSpin extends MechanicPlugin {
  override ID = ID;
  override STAGE: Stage = 'continuation';
  override DECOR_SCHEMA = { heldVals: 'moneyMap', respins: 'int' } as const;
  override APPLIES_TO = null;
  override SETTLES_SCATTER = 'base' as const;

  coin: unknown = null;
  values: number[] = [];
  valueCum: number[] = [];
  entryMin = 0;
  respins = 0;
  reset = true;
  law = 'reel_redraw';
  poolCum: number[] = [];
  blank: unknown = null;
  coinMult = 1;
  fullGridBonus: number | null = null;
  cap = 500;
  cells = 0;

  constructor(engine: SlotEngine, params: Params, instance: string) {
    super(engine, params, instance);
  }

  override init(): void {
    const eng = this.engine;
    const p: Params = { ...this.params };
    const unknown = Object.keys(p).filter((k) => !ALLOWED.has(k)).sort();
    if (unknown.length) throw new Error(`${ID}: unknown params ${JSON.stringify(unknown)}`);
    if ('lock_symbol' in p) {
      if ('coin_symbol' in p) throw new Error(`${ID}: give coin_symbol or lock_symbol, not both`);
      p.coin_symbol = p.lock_symbol;
      delete p.lock_symbol;
    }
    for (const req of ['coin_symbol', 'value_pmf', 'entry_min', 'respins']) {
      if (!(req in p)) throw new Error(`${ID}: ${req} is required`);
    }
    this.coin = p.coin_symbol;
    if (this.coin === eng.scatter || (typeof this.coin === 'number' && eng.wilds.has(this.coin))) {
      throw new Error(`${ID}: coin_symbol must not be the scatter or a wild`);
    }
    [this.values, this.valueCum] = pmf('value_pmf', p.value_pmf, 1);
    const em = p.entry_min;
    if (!isInt(em) || em < 1) throw new Error(`${ID}: entry_min must be an int >= 1`);
    this.entryMin = em;
    const rs = p.respins;
    if (!isInt(rs) || rs < 1) throw new Error(`${ID}: respins must be an int >= 1`);
    this.respins = rs;
    this.reset = pyBool('reset_on_landing' in p ? p.reset_on_landing : true);
    const law = 'respin_law' in p ? p.respin_law : 'reel_redraw';
    if (typeof law !== 'string' || !RESPIN_LAWS.includes(law)) throw new Error(`${ID}: respin_law ${JSON.stringify(law)} not in ${RESPIN_LAWS.join(', ')}`);
    this.law = law;
    if (law === 'cell_pool') {
      const pool = p.cell_pool as Record<string, unknown> | undefined;
      const keys = pool && typeof pool === 'object' && !Array.isArray(pool) ? Object.keys(pool).sort() : null;
      if (!keys || keys.length !== 2 || keys[0] !== 'blank' || keys[1] !== 'coin') throw new Error(`${ID}: cell_pool must be {blank: w, coin: w}`);
      for (const k of ['blank', 'coin']) {
        const w = pool![k];
        if (!isInt(w) || w <= 0) throw new Error(`${ID}: cell_pool[${k}] must be a positive int`);
      }
      this.poolCum = cumThresholds([pool!.blank as number, pool!.coin as number]); // 0 = blank, 1 = coin
      if (!('blank_symbol' in p)) throw new Error(`${ID}: cell_pool needs blank_symbol`);
      this.blank = p.blank_symbol;
      if (this.blank === this.coin) throw new Error(`${ID}: blank_symbol must differ from coin_symbol`);
    } else if ('cell_pool' in p || 'blank_symbol' in p) {
      throw new Error(`${ID}: cell_pool / blank_symbol belong to respin_law 'cell_pool'`);
    }
    const cm = 'coin_multiplier' in p ? p.coin_multiplier : 1;
    if (!isInt(cm) || cm < 1) throw new Error(`${ID}: coin_multiplier must be an int >= 1`);
    this.coinMult = cm;
    const fg = p.full_grid_bonus ?? null;
    if (fg !== null && (!isInt(fg) || fg < 0)) throw new Error(`${ID}: full_grid_bonus must be an int >= 0`);
    this.fullGridBonus = fg as number | null;
    const cap = 'max_respins_total' in p ? p.max_respins_total : 500;
    if (!isInt(cap) || cap < 1) throw new Error(`${ID}: max_respins_total must be an int >= 1`);
    this.cap = cap;
    this.cells = eng.rows.reduce((a, b) => a + b, 0);
    const alpha = alphabet(eng);
    if (alpha.size && !alpha.has(this.coin)) throw new Error(`${ID}: coin_symbol ${JSON.stringify(this.coin)} not on any strip`);
  }

  override run(ctx: SpinCtx): void {
    const eng = this.engine;
    const rng = ctx.rng;
    const rows = eng.rows;
    const coin = this.coin as number;
    const board = ctx.board;
    // held: "c,r" -> value (insertion order irrelevant; every read below sorts or sums)
    const held = new Map<string, number>();
    const scan: [number, number][] = [];
    board.forEach((col, c) => col.forEach((v, r) => {
      if (v === coin) scan.push([c, r]);
    }));
    if (scan.length < this.entryMin) return;
    // sorted(held): column-major == scan order
    for (const [c, r] of scan) held.set(`${c},${r}`, this.values[rng.pickWeighted(this.valueCum)]);
    let remaining = this.respins;
    let played = 0;
    const display: number[][] = board.map((col) => [...col]);
    const put = (c: number, r: number, v: number): void => {
      if (r >= display[c].length) throw new Error(`${ID}: IndexError (row ${r} beyond column ${c})`);
      display[c][r] = v;
    };
    while (remaining > 0 && held.size < this.cells) {
      if (played >= this.cap) {
        ctx.flags.push(`${this.instance}: respin cap ${this.cap} hit`);
        break;
      }
      played += 1;
      remaining -= 1;
      let landed = false;
      if (this.law === 'reel_redraw') {
        ctx.reels.forEach((reel, c) => {
          const stop = rng.randrange(reel.length);
          if (c >= rows.length) throw new Error(`${ID}: IndexError (reel ${c} has no row count)`);
          const window = reel.window(stop, rows[c]);
          for (let r = 0; r < rows[c]; r++) {
            const key = `${c},${r}`;
            if (held.has(key)) continue;
            put(c, r, window[r]);
            if (window[r] === coin) {
              held.set(key, this.values[rng.pickWeighted(this.valueCum)]);
              landed = true;
            }
          }
        });
      } else {
        for (let c = 0; c < eng.cols; c++) {
          for (let r = 0; r < rows[c]; r++) {
            const key = `${c},${r}`;
            if (held.has(key)) continue;
            if (rng.pickWeighted(this.poolCum) === 1) {
              held.set(key, this.values[rng.pickWeighted(this.valueCum)]);
              put(c, r, coin);
              landed = true;
            } else {
              put(c, r, this.blank as number);
            }
          }
        }
      }
      for (const key of held.keys()) {
        const i = key.indexOf(',');
        put(Number(key.slice(0, i)), Number(key.slice(i + 1)), coin);
      }
      const stepBoard: Board = display.map((col) => [...col]);
      ctx.steps.push({ board: stepBoard, wins: [], stepCoins: 0 });
      ctx.board = stepBoard;
      if (landed && this.reset) remaining = this.respins;
    }
    let total = 0;
    for (const v of held.values()) total += v;
    total *= this.coinMult;
    const full = held.size === this.cells;
    if (full && this.fullGridBonus) total += this.fullGridBonus * eng.betCoins;
    let label = `HOLD & SPIN: ${held.size} coins` + (this.coinMult !== 1 ? ` x${this.coinMult}` : '');
    if (full) label += ' (full grid)';
    ctx.extras.push({ label, coins: total });
    emitDecor(ctx, this, 'heldVals', new Map(held));
    emitDecor(ctx, this, 'respins', played);
  }
}

register(ID, 'continuation', HoldAndSpin);
