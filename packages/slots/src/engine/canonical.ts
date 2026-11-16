// Canonical spin JSON (slotlab.protocol.canonical_spin_json), so a TypeScript spin and a pack spin
// compare object for object and byte for byte: sorted keys, compact separators, ASCII only,
// integer-only, decor encoded per the engine's decor schema.

import type { SpinResult, SpinStep, SpinWin } from './types';

export type Cell = [number, number];
export type DecorEncoder = 'cellList' | 'cellSet' | 'moneyMap' | 'int' | 'intList' | 'str';
export type DecorSchema = Record<string, DecorEncoder>;

/** A money map's raw form: entries keyed by a cell [c, r] or a plain key. */
export type MoneyMapRaw = Map<string, number> | Array<[Cell | string | number, number]> | Record<string, number>;

function requireInt(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v)) throw new Error(`${what}: floats/non-ints forbidden, got ${String(v)}`);
  return v;
}

function cmpCell(a: Cell, b: Cell): number {
  return a[0] - b[0] || a[1] - b[1];
}

/** Python's default str ordering (code points; ASCII here). */
export function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function asCells(v: unknown): Cell[] {
  const out: Cell[] = [];
  for (const x of v as Iterable<unknown>) {
    if (typeof x === 'string') {
      const [c, r] = x.split(',').map(Number);
      out.push([c, r]);
    } else {
      const t = x as number[];
      out.push([requireInt(t[0], 'cell'), requireInt(t[1], 'cell')]);
    }
  }
  return out;
}

export const DECOR_ENCODERS: Record<DecorEncoder, (v: unknown) => unknown> = {
  cellList: (v) => asCells(v).sort(cmpCell),
  cellSet: (v) => asCells(v).map(([c, r]) => `${c},${r}`).sort(cmpStr),
  moneyMap: (v) => {
    const entries: Array<[string, number]> = [];
    const keyOf = (k: unknown): string => (Array.isArray(k) ? `${requireInt(k[0], 'key')},${requireInt(k[1], 'key')}` : String(k));
    if (v instanceof Map) for (const [k, c] of v) entries.push([keyOf(k), requireInt(c, 'moneyMap value')]);
    else if (Array.isArray(v)) for (const [k, c] of v as Array<[unknown, number]>) entries.push([keyOf(k), requireInt(c, 'moneyMap value')]);
    else for (const [k, c] of Object.entries(v as Record<string, number>)) entries.push([k, requireInt(c, 'moneyMap value')]);
    // dict(sorted(...)): a later duplicate key overwrites, the order is the sorted key order
    const m = new Map<string, number>();
    for (const [k, c] of entries.sort((a, b) => cmpStr(a[0], b[0]))) m.set(k, c);
    const out: Record<string, number> = {};
    for (const [k, c] of m) out[k] = c;
    return out;
  },
  int: (v) => requireInt(v, 'decor int'),
  intList: (v) => Array.from(v as Iterable<number>, (x) => requireInt(x, 'decor intList item')),
  str: (v) => {
    if (typeof v !== 'string') throw new Error(`decor str: got ${typeof v}`);
    return v;
  },
};

/** The engine's internal spin result before decor encoding (decor holds raw values). */
export interface RawSpin {
  set: number;
  stops: number[];
  steps: SpinStep[];
  finalBoard: number[][];
  extras: { label: string; coins: number }[];
  totalCoins: number;
  trigger: { fired: boolean; text: string } | null;
  flags: string[];
  decor: Map<string, unknown>;
}

function cloneWin(w: SpinWin): SpinWin {
  return {
    cells: w.cells.map(([c, r]) => [c, r] as [number, number]),
    coins: w.coins,
    label: w.label,
    lineIdx: w.lineIdx,
    ways: w.ways,
  };
}

/** The canonical SpinResult object (what `JSON.parse(spin_json)` gives on the pack side). */
export function canonicalResult(raw: RawSpin, schema: DecorSchema): SpinResult {
  const decor: Record<string, unknown> = {};
  for (const [key, value] of raw.decor) {
    const enc = schema[key];
    if (!enc) throw new Error(`undeclared decor field '${key}' (declare it in the decor schema)`);
    const fn = DECOR_ENCODERS[enc];
    if (!fn) throw new Error(`unknown decor encoder '${enc}' for field '${key}'`);
    decor[key] = fn(value);
  }
  return {
    decor,
    extras: raw.extras.map((e) => ({ coins: requireInt(e.coins, 'extra'), label: e.label })),
    finalBoard: raw.finalBoard.map((col) => [...col]),
    flags: [...raw.flags],
    set: raw.set,
    steps: raw.steps.map((s) => ({
      board: s.board.map((col) => [...col]),
      stepCoins: requireInt(s.stepCoins, 'stepCoins'),
      wins: s.wins.map(cloneWin),
    })),
    stops: [...raw.stops],
    totalCoins: requireInt(raw.totalCoins, 'totalCoins'),
    trigger: raw.trigger === null ? null : { fired: raw.trigger.fired, text: raw.trigger.text },
  };
}

function escapeString(s: string): string {
  // Python json.dumps(ensure_ascii=True)
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    const c = s[i];
    if (c === '"') out += '\\"';
    else if (c === '\\') out += '\\\\';
    else if (c === '\n') out += '\\n';
    else if (c === '\r') out += '\\r';
    else if (c === '\t') out += '\\t';
    else if (c === '\b') out += '\\b';
    else if (c === '\f') out += '\\f';
    else if (ch < 0x20 || ch > 0x7e) out += '\\u' + ch.toString(16).padStart(4, '0');
    else out += c;
  }
  return out + '"';
}

/** json.dumps(doc, sort_keys=True, separators=(",", ":"), ensure_ascii=True) for integer-only docs. */
export function canonicalJson(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') {
    if (!Number.isInteger(v)) throw new Error(`float ${v}: canonical JSON is integer-only`);
    return String(v);
  }
  if (typeof v === 'string') return escapeString(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort(cmpStr);
  return '{' + keys.map((k) => escapeString(k) + ':' + canonicalJson(obj[k])).join(',') + '}';
}
