// The one spin loop (pack: src/reelengine/pipeline.py). Stages in fixed order, mechanics in record
// order within a stage:
//   S0 materialize, S1 board_transform*, S2 evaluate (+ extra_eval, scatter settle unless the
//   continuation settles on the terminal board), S3 post_multiplier*, S3b post_eval (one re-run),
//   S4 post_award*, S5 continuation, S5b terminal (HAS_TERMINAL, record order), S6 finalize.
// Invariants: total == sum(stepCoins) + sum(extras); finalBoard == last step's board.

import type { RawSpin } from './canonical';
import type { Board, LineFn, Multiplicity, SymsLineFn } from './evaluators';
import type { SlotEngine } from './engine';
import type { Reel } from './reelsystem';
import type { SpinRng } from './rng';
import type { SpinStep, SpinWin } from './types';

export class SpinCtx {
  setIdx = 0;
  stops: number[] = [];
  heights: number[] = [];
  board: Board = [];
  baseBoard: Board = [];
  reels: Reel[] = [];
  wins: SpinWin[] = [];
  lineTotal = 0;
  extras: { label: string; coins: number }[] = [];
  trigger: { fired: boolean; text: string } | null = null;
  steps: SpinStep[] = [];
  /** Raw decor values keyed "<instance>.<key>" (encoded at serialisation). */
  decor = new Map<string, unknown>();
  flags: string[] = [];
  /** Per-spin round state keyed by plugin instance. */
  state = new Map<string, unknown>();
  /** Per-cell tags ("c,r" -> tag) the cascade moves with the cells. */
  tags = new Map<string, unknown>();
  /** Cells ("c,r") a cascade never removes, moves or refills. */
  masked = new Set<string>();
  tapeConsumed: number[] = [];
  multiplicity: Multiplicity = new Map();
  refilled = new Set<string>();
  collapses = 0;
  stepSuppressed = false;
  baseSuppressed = false;
  payingScreens = 0;
  payingSteps = 0;

  constructor(
    readonly engine: SlotEngine,
    readonly rng: SpinRng,
  ) {}
}

function countScatters(board: Board, scatter: number): number {
  let n = 0;
  for (const col of board) for (const v of col) if (v === scatter) n++;
  return n;
}

/** The evaluator's wins on board (plain law when no multiplicity, else Σ multiplicity). */
export function winsOf(ctx: SpinCtx, board: Board, lineFn: LineFn | null = null): SpinWin[] {
  const ev = ctx.engine.evaluator;
  if (!ctx.multiplicity.size) return [...ev.wins(board, lineFn)];
  if (!ev.MULTIPLICITY || !ev.winsWithMultiplicity) {
    const producers = ctx.engine.mechInstances.filter((p) => p.PRODUCES_MULTIPLICITY).map((p) => p.instance);
    throw new Error(`cell multiplicity set by ${producers.join(', ') || '<no declared producer>'} reaches the ${ev.kind} evaluator, which has no multiplicity law (ways and scatter_pays only)`);
  }
  return [...ev.winsWithMultiplicity(board, ctx.multiplicity, lineFn)];
}

/** The wins of a continuation's step board: the evaluator law plus every extra_eval plugin. */
export function boardWins(ctx: SpinCtx, board: Board, k: number): SpinWin[] {
  const wins = winsOf(ctx, board);
  for (const p of ctx.engine.stage('extra_eval')) wins.push(...p.extraWins(ctx, board, k));
  return wins;
}

function evaluate(ctx: SpinCtx): void {
  const eng = ctx.engine;
  const variants = eng.stage('eval_variant');
  let lineFn: LineFn | null = null;
  if (variants.length) {
    const v = variants[0];
    const draws = v.preDraws(ctx);
    const ev = eng.evaluator as { defaultLineEval?: (syms: number[]) => [number, number, number | null] };
    const inner: SymsLineFn | null = ev.defaultLineEval ? (syms) => ev.defaultLineEval!(syms) : null;
    lineFn = (cells) => v.lineEval(cells, draws, inner);
  }
  ctx.wins = winsOf(ctx, ctx.board, lineFn);
  for (const p of eng.stage('extra_eval')) ctx.wins.push(...p.extraWins(ctx, ctx.board, 0));
  ctx.lineTotal = ctx.wins.reduce((a, w) => a + w.coins, 0);
}

function scatterSettle(ctx: SpinCtx, board: Board): void {
  const eng = ctx.engine;
  if (eng.scatter === null) return;
  const ns = countScatters(board, eng.scatter);
  const amt = eng.scatterPay[String(ns)] ?? 0;
  if (amt) ctx.extras.push({ label: `SCATTER PAY (${ns} scatters)`, coins: amt });
  if (eng.triggerMin !== null && ns >= eng.triggerMin) {
    ctx.trigger = { fired: true, text: `${ns} scatters -> feature trigger (out of scope)` };
  }
}

export function runSpin(engine: SlotEngine, rng: SpinRng): RawSpin {
  const ctx = new SpinCtx(engine, rng);
  // S0
  const m = engine.reelsystem.materialize(rng);
  ctx.setIdx = m.setIdx;
  ctx.stops = m.stops;
  ctx.heights = m.heights;
  ctx.board = m.board;
  ctx.reels = m.reels;
  ctx.tapeConsumed = new Array<number>(m.reels.length).fill(0);
  // S1
  for (const p of engine.stage('board_transform')) p.apply(ctx);
  ctx.baseBoard = ctx.board;
  // S2
  evaluate(ctx);
  const continuation = engine.stage('continuation');
  const settleTerminal = continuation.length > 0 && continuation[0].SETTLES_SCATTER === 'terminal';
  if (!settleTerminal) scatterSettle(ctx, ctx.board);
  // S3
  for (const p of engine.stage('post_multiplier')) p.postTotal(ctx);
  // S3b
  for (const p of engine.stage('post_eval')) {
    if (p.react(ctx)) {
      ctx.baseBoard = ctx.board;
      evaluate(ctx);
      for (const q of engine.stage('post_multiplier')) q.postTotal(ctx);
    }
  }
  // S4
  for (const p of engine.stage('post_award')) p.award(ctx);
  // S5
  for (const p of continuation) p.run(ctx);
  if (settleTerminal) scatterSettle(ctx, ctx.board);
  // S5b
  for (const p of engine.mechInstances) if (p.HAS_TERMINAL) p.terminal(ctx);
  // S6
  return finalize(ctx);
}

function finalize(ctx: SpinCtx): RawSpin {
  const baseStep: SpinStep = { board: ctx.baseBoard, wins: [...ctx.wins], stepCoins: ctx.lineTotal };
  const steps = [baseStep, ...ctx.steps];
  const total = steps.reduce((a, s) => a + s.stepCoins, 0) + ctx.extras.reduce((a, e) => a + e.coins, 0);
  const finalBoard = steps[steps.length - 1].board;
  return {
    set: ctx.setIdx,
    stops: [...ctx.stops],
    steps,
    finalBoard,
    extras: [...ctx.extras],
    totalCoins: total,
    trigger: ctx.trigger,
    flags: [...ctx.flags],
    decor: new Map(ctx.decor),
  };
}

/** decor.emit: write "<instance>.<key>", refusing a collision. */
export function emitDecor(ctx: SpinCtx, plugin: { decorKey(k: string): string }, key: string, value: unknown): void {
  const full = plugin.decorKey(key);
  if (ctx.decor.has(full)) throw new Error(`decor key collision '${full}': mechanics must use namespaced keys`);
  ctx.decor.set(full, value);
}
