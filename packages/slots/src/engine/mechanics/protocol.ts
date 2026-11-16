// The stage protocol every mechanic plugin implements (pack: src/reelengine/mechanics/_protocol.py).
//
// Stages, fixed order: board_transform (S1) -> eval_variant (S2, one per spin) -> extra_eval (S2b)
// -> post_multiplier (S3) -> post_eval (S3b, at most one) -> post_award (S4) -> continuation (S5,
// at most one) -> terminal_award (S5b, every plugin with HAS_TERMINAL, record order).
//
// Porting rules (byte parity with the pack):
//  - draw from ctx.rng in exactly the pack's order (u32 / randrange / pickWeighted);
//  - never mutate a board in place: build a new number[][] (steps keep references to old boards);
//  - iterate spec maps in sorted-key order (sortedKeys) unless the pack sorts them itself;
//  - Python sets of cells are Set<string> of "c,r" keys here (cellKey / parseCell).
//  - a family that cannot be made byte-faithful is not registered (no approximations).

import type { DecorSchema } from '../canonical';
import { cumThresholds } from '../rng';
import type { SpinWin } from '../types';
import type { Board, SymsLineFn } from '../evaluators';
import type { SlotEngine } from '../engine';
import type { SpinCtx } from '../pipeline';

export const STAGES = ['board_transform', 'eval_variant', 'extra_eval', 'post_multiplier', 'post_eval', 'post_award', 'continuation', 'terminal_award'] as const;
export type Stage = (typeof STAGES)[number];
export const SINGLETON_STAGES: readonly Stage[] = ['eval_variant', 'post_eval', 'continuation'];

export type Params = Record<string, unknown>;

export class MechanicPlugin {
  ID = '';
  STAGE: Stage = 'board_transform';
  ALSO_STAGES: Stage[] = [];
  DECOR_SCHEMA: DecorSchema = {};
  APPLIES_TO: string[] | null = null;
  SETTLES_SCATTER: 'base' | 'terminal' = 'base';
  HAS_TERMINAL = false;
  REQUIRES_TAPE = false;
  DEFAULT_VARIANT_ONLY = false;
  TUMBLE_HOOK = false;
  RAGGED_OK = true;
  PRODUCES_MULTIPLICITY = false;

  readonly params: Params;

  constructor(
    readonly engine: SlotEngine,
    params: Params | null | undefined,
    readonly instance: string,
  ) {
    this.params = { ...(params ?? {}) };
  }

  /** Called by the registry once the subclass fields exist: parse params fail-loud here. */
  init(): void {}

  // --- stage methods ---
  apply(_ctx: SpinCtx): void {
    throw new Error(`${this.ID}: apply not implemented`);
  }
  preDraws(_ctx: SpinCtx): unknown {
    return {};
  }
  lineEval(_cells: [number, number, number][], _draws: unknown, _inner: SymsLineFn | null): [number, number, number | null] {
    throw new Error(`${this.ID}: lineEval not implemented`);
  }
  extraWins(_ctx: SpinCtx, _board: Board, _k: number): SpinWin[] {
    return [];
  }
  postTotal(_ctx: SpinCtx): void {
    throw new Error(`${this.ID}: postTotal not implemented`);
  }
  react(_ctx: SpinCtx): boolean {
    return false;
  }
  award(_ctx: SpinCtx): void {
    throw new Error(`${this.ID}: award not implemented`);
  }
  run(_ctx: SpinCtx): void {
    throw new Error(`${this.ID}: run not implemented`);
  }
  terminal(_ctx: SpinCtx): void {
    throw new Error(`${this.ID}: terminal not implemented`);
  }

  // --- continuation hooks: per-step win rewrites ---
  stepFactor(_ctx: SpinCtx, _k: number): number {
    return 1;
  }
  stepWins(ctx: SpinCtx, k: number, wins: SpinWin[]): SpinWin[] {
    return scaleWins(wins, this.stepFactor(ctx, k));
  }

  // --- cascade hooks (TUMBLE_HOOK plugins) ---
  retainCells(_ctx: SpinCtx, _board: Board, _wins: SpinWin[]): Set<string> {
    return new Set();
  }
  extraRemovals(_ctx: SpinCtx, _board: Board): Set<string> {
    return new Set();
  }
  afterRefill(_ctx: SpinCtx, _k: number, board: Board): Board {
    return board;
  }
  overrideStepWins(_ctx: SpinCtx, _k: number, _board: Board, wins: SpinWin[]): SpinWin[] {
    return wins;
  }
  onStep(_ctx: SpinCtx, _k: number, _board: Board, _wins: SpinWin[]): void {}
  revive(_ctx: SpinCtx, _k: number, _board: Board): Board | null {
    return null;
  }
  cascadeRests(_ctx: SpinCtx, _k: number, _board: Board, _wins: SpinWin[]): boolean {
    return false;
  }

  decorKey(key: string): string {
    return `${this.instance}.${key}`;
  }
}

export function scaleWins(wins: SpinWin[], f: number): SpinWin[] {
  if (f === 1) return [...wins];
  return wins.map((w) => ({ label: w.label, coins: w.coins * f, cells: w.cells, ways: w.ways, lineIdx: w.lineIdx }));
}

/** True when any cell of the win shows a symbol in syms on board. */
export function winTouches(board: Board, win: SpinWin, syms: Set<number>): boolean {
  return win.cells.some(([c, r]) => syms.has(board[c][r]));
}

/** _protocol.int_pmf: {value: weight} -> [values sorted, cum]. */
export function intPmf(name: string, pmf: unknown, minValue: number | null = null): [number[], number[]] {
  if (!pmf || typeof pmf !== 'object' || Array.isArray(pmf) || !Object.keys(pmf).length) throw new Error(`${name} must be a non-empty {value: weight} map`);
  const items: [number, number][] = [];
  for (const [k, w] of Object.entries(pmf as Record<string, unknown>)) {
    const key = Number(k);
    if (!Number.isInteger(key)) throw new Error(`${name}: key '${k}' is not an int`);
    if (minValue !== null && key < minValue) throw new Error(`${name}: value '${k}' below the minimum ${minValue}`);
    if (typeof w !== 'number' || !Number.isInteger(w) || w <= 0) throw new Error(`${name}: weight for '${k}' must be a positive int`);
    items.push([key, w]);
  }
  items.sort((a, b) => a[0] - b[0]);
  return [items.map(([k]) => k), cumThresholds(items.map(([, w]) => w))];
}

/** _protocol.int_pmf(..., allow_str_keys=True): keys kept as strings, sorted as strings. */
export function strPmf(name: string, pmf: unknown): [string[], number[]] {
  if (!pmf || typeof pmf !== 'object' || Array.isArray(pmf) || !Object.keys(pmf).length) throw new Error(`${name} must be a non-empty {value: weight} map`);
  const items: [string, number][] = [];
  for (const [k, w] of Object.entries(pmf as Record<string, unknown>)) {
    if (typeof w !== 'number' || !Number.isInteger(w) || w <= 0) throw new Error(`${name}: weight for '${k}' must be a positive int`);
    items.push([String(k), w]);
  }
  items.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return [items.map(([k]) => k), cumThresholds(items.map(([, w]) => w))];
}

/** _protocol.bernoulli_cum: {"0": w_no, "1": w_yes} -> cum; pickWeighted(cum) === 1 is yes. */
export function bernoulliCum(name: string, pmf: unknown): number[] {
  const [values, cum] = intPmf(name, pmf, 0);
  if (values.length !== 2 || values[0] !== 0 || values[1] !== 1) throw new Error(`${name} must be a {"0": w, "1": w} map (both outcomes weighted)`);
  return cum;
}

export function parseCell(key: string): [number, number] {
  const i = key.indexOf(',');
  return [Number(key.slice(0, i)), Number(key.slice(i + 1))];
}
