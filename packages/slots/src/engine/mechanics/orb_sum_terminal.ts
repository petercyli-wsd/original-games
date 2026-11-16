// orb_sum_terminal (pack: src/reelengine/mechanics/orb_sum_terminal.py).
// Law: terminal settle only. S = sum of iid values (one value_pmf draw per orb cell on the TERMINAL
// board, column-major); the round pays an extra tmb_total × (S-1) ("ORB SUM xS"), only when the
// round's tumble total > 0 (require_win). multiply_extras adds existing extras to the base.
// Optional injection: per live board (base board when it wins, every refilled board) a hazard draw,
// a count draw, then sequential uniform picks over pay cells not showing a winning symbol, rewritten
// to the orb. Orbs never pay as a symbol.
// Decor: orbVals (moneyMap "c,r" -> value), injected (int; orbs injected this round).

import { boardWins, emitDecor, type SpinCtx } from '../pipeline';
import type { Board } from '../evaluators';
import type { SpinWin } from '../types';
import { intPmf, MechanicPlugin } from './protocol';
import { register } from './registry';

const ALLOWED = new Set(['orb_symbol', 'value_pmf', 'require_win', 'multiply_extras', 'injection']);
const INJECTION_KEYS = new Set(['hazard_pmf', 'count_pmf']);

interface St { injected: number; collapses: number }

class OrbSumTerminal extends MechanicPlugin {
  ID = 'orb_sum_terminal';
  STAGE = 'terminal_award' as const;
  ALSO_STAGES: ('board_transform')[] = ['board_transform'];
  DECOR_SCHEMA = { orbVals: 'moneyMap', injected: 'int' } as const;
  APPLIES_TO = null;
  TUMBLE_HOOK = true;
  HAS_TERMINAL = true;
  orb = 0;
  values: number[] = [];
  cum: number[] = [];
  requireWin = true;
  multiplyExtras = false;
  injection: [number[], number[], number[]] | null = null;

  override init(): void {
    const p = this.params;
    const eng = this.engine;
    const unknown = Object.keys(p).filter((k) => !ALLOWED.has(k)).sort();
    if (unknown.length) throw new Error(`orb_sum_terminal: unknown params [${unknown.join(', ')}]`);
    for (const req of ['orb_symbol', 'value_pmf']) if (!(req in p)) throw new Error(`orb_sum_terminal: ${req} is required`);
    this.orb = p.orb_symbol as number;
    if (eng.wilds.has(this.orb) || this.orb === eng.scatter || String(this.orb) in eng.paytable) {
      throw new Error('orb_sum_terminal: the orb must not be a wild, the scatter or a paying symbol (orbs never pay as a symbol)');
    }
    const pmf = p.value_pmf;
    if (!pmf || typeof pmf !== 'object' || Array.isArray(pmf) || !Object.keys(pmf).length) {
      throw new Error('orb_sum_terminal: value_pmf must be a non-empty {value: weight} map');
    }
    for (const [v, w] of Object.entries(pmf as Record<string, unknown>)) {
      const iv = Number(v);
      if (!Number.isInteger(iv) || iv < 1 || typeof w !== 'number' || !Number.isInteger(w) || w <= 0) {
        throw new Error(`orb_sum_terminal: value_pmf entry '${v}': ${String(w)} invalid`);
      }
    }
    [this.values, this.cum] = intPmf('orb_sum_terminal: value_pmf', pmf, 1);
    this.requireWin = p.require_win === undefined ? true : !!p.require_win;
    const mx = p.multiply_extras === undefined ? false : p.multiply_extras;
    if (!(typeof mx === 'boolean' || (typeof mx === 'number' && (mx === 0 || mx === 1)))) throw new Error('orb_sum_terminal: multiply_extras must be 0/1');
    this.multiplyExtras = !!mx;
    const inj = p.injection;
    this.injection = null;
    if (inj !== undefined && inj !== null) {
      if (typeof inj !== 'object' || Array.isArray(inj)) throw new Error('orb_sum_terminal: injection must be a dict');
      const iu = Object.keys(inj).filter((k) => !INJECTION_KEYS.has(k)).sort();
      if (iu.length) throw new Error(`orb_sum_terminal: injection: unknown keys [${iu.join(', ')}]`);
      const ij = inj as Record<string, unknown>;
      const [hv, hcum] = intPmf('orb_sum_terminal: injection.hazard_pmf', ij.hazard_pmf, 0);
      if (hv.length !== 2 || hv[0] !== 0 || hv[1] !== 1) throw new Error('orb_sum_terminal: injection.hazard_pmf must carry exactly the keys 0 and 1');
      const [counts, ccum] = intPmf('orb_sum_terminal: injection.count_pmf', ij.count_pmf, 1);
      this.injection = [hcum, counts, ccum];
    }
    if (!(String(this.orb) in eng.names)) throw new Error(`orb_sum_terminal: orb_symbol ${this.orb} is not a declared symbol`);
    if (this.injection === null) {
      const alphabet = new Set<number>();
      for (const r of eng.reelsystem.allReels()) {
        if ('cells' in r) for (const v of (r as { cells: readonly number[] }).cells) alphabet.add(v);
        else for (const e of (r as unknown as { entries: { window: number[] }[] }).entries) for (const v of e.window) alphabet.add(v);
      }
      if (alphabet.size && !alphabet.has(this.orb)) throw new Error(`orb_sum_terminal: orb_symbol ${this.orb} not on any strip`);
    }
  }

  private st(ctx: SpinCtx): St {
    let st = ctx.state.get(this.instance) as St | undefined;
    if (st === undefined) {
      st = { injected: 0, collapses: 0 };
      ctx.state.set(this.instance, st);
    }
    return st;
  }

  private inject(ctx: SpinCtx, board: Board, wins: SpinWin[]): Board {
    const [hcum, counts, ccum] = this.injection!;
    const rng = ctx.rng;
    if (rng.pickWeighted(hcum) === 0) return board;
    let k = counts[rng.pickWeighted(ccum)];
    const eng = this.engine;
    const winSyms = new Set<number>();
    for (const w of wins) {
      for (const [c, r] of w.cells) {
        const v = board[c][r];
        if (!eng.wilds.has(v) && v !== eng.scatter) winSyms.add(v);
      }
    }
    const remaining: [number, number][] = [];
    board.forEach((col, c) => col.forEach((v, r) => {
      if (!eng.wilds.has(v) && v !== eng.scatter && !winSyms.has(v)) {
        const pt = eng.paytable[String(v)];
        if (pt && Object.keys(pt).length) remaining.push([c, r]);
      }
    }));
    k = Math.min(k, remaining.length);
    if (k === 0) return board;
    const grid = board.map((col) => [...col]);
    for (let i = 0; i < k; i++) {
      const [c, r] = remaining.splice(rng.randrange(remaining.length), 1)[0];
      grid[c][r] = this.orb;
    }
    this.st(ctx).injected += k;
    return grid;
  }

  override apply(ctx: SpinCtx): void {
    if (this.injection === null) return;
    const wins = boardWins(ctx, ctx.board, 0);
    if (wins.length) ctx.board = this.inject(ctx, ctx.board, wins);
  }

  override afterRefill(ctx: SpinCtx, k: number, board: Board): Board {
    if (this.injection === null) return board;
    const st = this.st(ctx);
    if (ctx.collapses === st.collapses) return board;
    st.collapses = ctx.collapses;
    return this.inject(ctx, board, boardWins(ctx, board, k));
  }

  override terminal(ctx: SpinCtx): void {
    let tmb = ctx.lineTotal + ctx.steps.reduce((a, s) => a + s.stepCoins, 0);
    if (this.multiplyExtras) tmb += ctx.extras.reduce((a, e) => a + e.coins, 0);
    if (this.injection !== null && this.st(ctx).injected) emitDecor(ctx, this, 'injected', this.st(ctx).injected);
    if (this.requireWin && tmb <= 0) return;
    const orbs: [number, number][] = [];
    ctx.board.forEach((col, c) => col.forEach((v, r) => { if (v === this.orb) orbs.push([c, r]); }));
    if (!orbs.length) return;
    const vals: Record<string, number> = {};
    let s = 0;
    for (const [c, r] of orbs) {
      const v = this.values[ctx.rng.pickWeighted(this.cum)];
      vals[`${c},${r}`] = v;
      s += v;
    }
    emitDecor(ctx, this, 'orbVals', vals);
    const extra = tmb * (s - 1);
    if (extra > 0) ctx.extras.push({ label: `ORB SUM x${s}`, coins: extra });
  }
}

register('orb_sum_terminal', 'terminal_award', OrbSumTerminal);
