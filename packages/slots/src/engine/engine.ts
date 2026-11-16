// A game_spec_v2 compiled to a spinnable engine (pack: src/reelengine/adapter.py + engine.py).
//
// The port covers the board laws global_mixture (reel_set_mixture / strips_uniform) and
// per_reel_pools (strips and window catalogs), the megaways height law and the top reel; the
// evaluators payline (direction / anchor variants), ways (anchor / wild multiplier / king
// adjacency), cluster and scatter_pays; and the mechanic families registered in ./mechanics.
// Anything else is refused by name. Scope (what the pack has verified) is the oracle's job:
// a spec reaches a game only after `npm run slots:oracle` built it through the pack.

import { canonicalResult, cmpStr, type DecorSchema, type RawSpin } from './canonical';
import {
  ClusterEvaluator,
  PaylineEvaluator,
  ScatterPaysEvaluator,
  WaysEvaluator,
  type Board,
  type Evaluator,
  type Paytable,
} from './evaluators';
import { DECOR_ENCODERS } from './canonical';
import type { MechanicPlugin, Params, Stage } from './mechanics/protocol';
import { instantiate, isContinuationId } from './mechanics/registry';
import './mechanics/all';
import { runSpin } from './pipeline';
import { ReelSystem, type BoardLawRecord } from './reelsystem';
import { Mulberry32, type SpinRng } from './rng';
import type { SlotSpec, SpinResult, SpinWin } from './types';

export interface EngineRecord {
  slug: string;
  geometry: { cols: number; rows: number[]; top_reel?: { columns: number[] } | null };
  bet: { coins: number };
  symbols: { names: Record<string, string>; wilds: number[]; scatter: number | null };
  board_law: BoardLawRecord;
  height_law: { kind?: string; reels?: { pmf: Record<string, number> }[] };
  evaluator: Record<string, unknown> & { kind: string };
  pays: { paytable: Paytable; scatter_pay: Record<string, number>; trigger_min_scatters: number | null };
  mechanics: { id: string; params: Params }[];
}

function toInt(v: unknown, what: string): number {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error(`${what}: not a number (${String(v)})`);
  return Math.trunc(n);
}

/** adapter.to_reel_engine_record, spin-relevant fields only. */
export function compileSpec(spec: SlotSpec): EngineRecord {
  if (spec.schema !== 'game_spec_v2') throw new Error(`expects schema 'game_spec_v2', got '${String(spec.schema)}'`);
  const cols = spec.geometry.cols;
  const rows = [...spec.geometry.rows];
  const roles = new Map<number, string>(spec.symbols.map((s) => [s.id, s.role]));
  const byStr = (a: number, b: number) => cmpStr(String(a), String(b));
  const wilds = [...roles].filter(([, r]) => r === 'wild').map(([k]) => k).sort(byStr);
  const scatters = [...roles].filter(([, r]) => r === 'scatter').map(([k]) => k).sort(byStr);
  const scatter = scatters.length ? scatters[0] : null;
  const bl = spec.board_law as Record<string, unknown> & { kind: string };
  let boardLaw: BoardLawRecord;
  if (bl.kind === 'strips_uniform' || bl.kind === 'reel_set_mixture') {
    const sets = (bl.reel_sets as { id: unknown; label?: unknown; weight: unknown; strips: number[][] }[]).map((rs) => ({
      id: String(rs.id),
      label: String(rs.label || rs.id),
      weight: toInt(rs.weight, 'reel_set weight'),
      strips: rs.strips.map((st) => [...st]),
    }));
    boardLaw = { kind: 'global_mixture', sets };
  } else if (bl.kind === 'per_reel_pools') {
    boardLaw = { kind: 'per_reel_pools', reels: structuredClone(bl.reels as BoardLawRecord['reels']) };
  } else {
    throw new Error(`board_law.kind '${bl.kind}' is not supported`);
  }
  const ev = spec.evaluation as Record<string, unknown> & { kind: string };
  const kind = ev.kind;
  let evaluator: Record<string, unknown> & { kind: string };
  if (kind === 'payline') {
    const wo = (ev.wild_own_pay ?? {}) as Record<string, unknown>;
    evaluator = {
      kind: 'payline',
      paylines: ((ev.paylines ?? []) as number[][]).map((p) => [...p]),
      paylines_are_positions: Boolean(ev.paylines_are_positions),
      wild_own_pay: Object.fromEntries(Object.entries(wo).map(([k, v]) => [String(k), toInt(v, 'wild_own_pay')])),
    };
    for (const opt of ['direction', 'anchor']) if (opt in ev) evaluator[opt] = ev[opt];
  } else if (kind === 'ways') {
    evaluator = { kind: 'ways' };
    if ('anchor' in ev) evaluator.anchor = ev.anchor;
    if (ev.x2_per_wild) evaluator.wild_multiplier = 2;
    if ('wild_multiplier' in ev) evaluator.wild_multiplier = ev.wild_multiplier;
    if ('adjacency' in ev) evaluator.adjacency = ev.adjacency;
  } else if (kind === 'cluster') {
    evaluator = { kind: 'cluster', min_size: toInt(ev.min_size, 'min_size'), adjacency: String(ev.adjacency ?? '4') };
  } else if (kind === 'scatter_pays') {
    evaluator = { kind: 'scatter_pays', min_count: toInt(ev.min_count, 'min_count') };
  } else {
    throw new Error(`evaluation.kind '${kind}' is not supported`);
  }
  const mechanics = ((spec.mechanics ?? []) as unknown as { id: string; params?: Params }[]).map((m) => ({
    id: m.id,
    params: structuredClone(m.params ?? {}),
  }));
  if (kind === 'cluster' && !mechanics.some((m) => isContinuationId(m.id))) mechanics.unshift({ id: 'tumble', params: {} });
  const pays = spec.pays;
  const paytable: Paytable = {};
  for (const [k, tbl] of Object.entries(pays.paytable)) {
    paytable[String(k)] = Object.fromEntries(Object.entries(tbl).map(([r, c]) => [String(r), toInt(c, 'pay')]));
  }
  const scatterPay = scatter !== null ? Object.fromEntries(Object.entries(pays.scatter_pay ?? {}).map(([k, v]) => [String(k), toInt(v, 'scatter_pay')])) : {};
  const trig = spec.trigger as Record<string, unknown> | undefined;
  const triggerMin = trig && Object.keys(trig).length && scatter !== null ? toInt(trig.scatter_min, 'trigger.scatter_min') : null;
  const geometry: EngineRecord['geometry'] = { cols, rows };
  const topReel = (spec.geometry as { top_reel?: { columns: number[] } | null }).top_reel;
  if (topReel !== undefined && topReel !== null) geometry.top_reel = structuredClone(topReel);
  return {
    slug: spec.slug,
    geometry,
    bet: { coins: toInt(spec.bet.coins, 'bet.coins') },
    symbols: { names: Object.fromEntries(spec.symbols.map((s) => [String(s.id), s.label])), wilds, scatter },
    board_law: boardLaw,
    height_law: structuredClone((spec as { height_law?: EngineRecord['height_law'] }).height_law || { kind: 'fixed' }),
    evaluator,
    pays: { paytable, scatter_pay: scatterPay, trigger_min_scatters: triggerMin },
    mechanics,
  };
}

export class SlotEngine {
  readonly rec: EngineRecord;
  readonly cols: number;
  readonly rows: number[];
  readonly reelsystem: ReelSystem;
  readonly heightVariable: boolean;
  readonly rowsUniform: number | null;
  readonly betCoins: number;
  readonly names: Record<string, string>;
  readonly wilds: Set<number>;
  readonly scatter: number | null;
  readonly paytable: Paytable;
  readonly scatterPay: Record<string, number>;
  readonly triggerMin: number | null;
  readonly evaluatorKind: string;
  readonly paylines: number[][];
  readonly positions: boolean;
  readonly wildOwn: Record<string, number>;
  readonly setLabels: string[];
  readonly evaluator: Evaluator;
  readonly mechInstances: MechanicPlugin[];
  readonly decorSchema: DecorSchema;
  private readonly byStage = new Map<Stage, MechanicPlugin[]>();

  constructor(specOrRecord: SlotSpec | EngineRecord) {
    const rec = 'schema' in specOrRecord ? compileSpec(specOrRecord as SlotSpec) : (specOrRecord as EngineRecord);
    this.rec = rec;
    this.cols = rec.geometry.cols;
    this.rows = [...rec.geometry.rows];
    this.reelsystem = ReelSystem.fromRecord(rec);
    this.heightVariable = this.reelsystem.variableHeight;
    this.rowsUniform = new Set(this.rows).size === 1 && !this.heightVariable && this.reelsystem.top === null ? this.rows[0] : null;
    this.betCoins = rec.bet.coins;
    this.names = { ...rec.symbols.names };
    this.wilds = new Set(rec.symbols.wilds);
    this.scatter = rec.symbols.scatter;
    this.paytable = rec.pays.paytable;
    this.scatterPay = rec.pays.scatter_pay;
    this.triggerMin = rec.pays.trigger_min_scatters;
    const ev = rec.evaluator;
    this.evaluatorKind = ev.kind;
    this.paylines = ((ev.paylines ?? []) as number[][]).map((p) => [...p]);
    this.positions = Boolean(ev.paylines_are_positions);
    this.wildOwn = (ev.wild_own_pay ?? {}) as Record<string, number>;
    const law = this.reelsystem.law;
    this.setLabels = law.kind === 'global_mixture' ? law.sets.map((s) => s.label) : [];
    const common = { cols: this.cols, paytable: this.paytable, wilds: this.wilds, scatter: this.scatter, names: this.names };
    if (ev.kind === 'payline') {
      this.evaluator = new PaylineEvaluator(
        { ...common, paylines: this.paylines, positions: this.positions, wildOwn: this.wildOwn },
        (ev.direction ?? 'left') as 'left',
        (ev.anchor ?? 'left') as 'left',
      );
    } else if (ev.kind === 'ways') {
      this.evaluator = new WaysEvaluator(common, (ev.anchor ?? 'left') as 'left', Number(ev.wild_multiplier ?? 1), (ev.adjacency ?? 'none') as 'none');
    } else if (ev.kind === 'cluster') {
      if (this.rowsUniform === null) throw new Error(`${rec.slug}: cluster evaluator needs uniform reel heights`);
      this.evaluator = new ClusterEvaluator(common, this.rowsUniform, Number(ev.min_size));
    } else if (ev.kind === 'scatter_pays') {
      this.evaluator = new ScatterPaysEvaluator(common, Number(ev.min_count));
    } else {
      throw new Error(`${rec.slug}: unknown evaluator kind '${ev.kind}'`);
    }
    this.mechInstances = instantiate(this, rec.mechanics);
    for (const p of this.mechInstances) {
      for (const st of [p.STAGE, ...p.ALSO_STAGES]) this.byStage.set(st, [...(this.byStage.get(st) ?? []), p]);
    }
    const schema: DecorSchema = {};
    for (const p of this.mechInstances) {
      for (const [key, enc] of Object.entries(p.DECOR_SCHEMA)) {
        if (!(enc in DECOR_ENCODERS)) throw new Error(`${p.ID}: unknown decor encoder '${enc}' for '${key}'`);
        const full = p.decorKey(key);
        if (full in schema) throw new Error(`decor schema collision on '${full}'`);
        schema[full] = enc;
      }
    }
    this.decorSchema = schema;
  }

  stage(name: Stage): MechanicPlugin[] {
    return this.byStage.get(name) ?? [];
  }

  name(sym: number | string): string {
    return this.names[String(sym)] ?? String(sym);
  }

  /** Plain evaluator law over an arbitrary board -> [wins, coins]. */
  evalBoardLines(board: Board): [SpinWin[], number] {
    const wins = this.evaluator.wins(board);
    return [wins, wins.reduce((a, w) => a + w.coins, 0)];
  }

  /** One spin on the given RNG (raw decor). */
  spinRaw(rng: SpinRng): RawSpin {
    return runSpin(this, rng);
  }

  /** One spin on Mulberry32(seed): the pack's canonical spin, object for object. */
  spin(seed: number): SpinResult {
    return canonicalResult(runSpin(this, new Mulberry32(seed >>> 0)), this.decorSchema);
  }
}
