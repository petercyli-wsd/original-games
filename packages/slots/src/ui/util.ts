// Pure helpers behind the slot UI: timing rules, anticipation, tiers, decor parsing,
// facts parsing and paytable rows. No React, no DOM, so they are unit-tested directly.

import type { SlotSpec, SpecSymbol } from '../engine/types';
import { award, multiplierAt, type FeatureConfig } from '../engine';
import type { SlotCopy, SlotFacts } from './types';

// ---------------------------------------------------------------- timing

/** Reel timings in ms (docs/SLOT-STYLE.md §5). Manual: first reel stops at 900, the last by 1600. Turbo: all done in ~300. */
export function reelTimings(cols: number, turbo: boolean): { base: number; stagger: number; suspense: number } {
  const gaps = Math.max(1, cols - 1);
  return turbo
    ? { base: 200, stagger: Math.min(25, 100 / gaps), suspense: 0 }
    : { base: 900, stagger: Math.min(180, 700 / gaps), suspense: 700 };
}

/** Stop time of reel `c` when nothing anticipates: base + c × stagger. */
export const reelStopMs = (c: number, cols: number, turbo: boolean) => {
  const t = reelTimings(cols, turbo);
  return t.base + c * t.stagger;
};

/** Win counter: time proportional to the win (in stakes), capped at 3 s; a quarter of it in Turbo. */
export function rollMs(winStakes: number, turbo: boolean): number {
  const ms = Math.min(3000, 350 + 45 * Math.max(0, winStakes));
  return turbo ? Math.max(120, Math.round(ms * 0.25)) : Math.round(ms);
}

/** 0 = a normal win, 1 = Big win (≥ 20× the stake), 2 = Huge win (≥ 100×). */
export const bigWinTier = (winStakes: number): 0 | 1 | 2 => (winStakes >= 100 ? 2 : winStakes >= 20 ? 1 : 0);
export const TIER_LABEL = ['', 'Big win', 'Huge win'] as const;

// ---------------------------------------------------------------- symbols

export interface SymbolMeta {
  id: number;
  label: string;
  role: string;
}

export function symbolMetas(spec: SlotSpec): SymbolMeta[] {
  return spec.symbols.map((s: SpecSymbol) => ({ id: s.id, label: s.label, role: s.role }));
}

export const idsWithRole = (spec: SlotSpec, role: string) => spec.symbols.filter((s) => s.role === role).map((s) => s.id);

/** The widest the window can be: the largest row count the spec allows (megaways) and any board seen. */
export const maxRowsOf = (spec: SlotSpec, ...boards: number[][][]) =>
  Math.max(1, ...spec.geometry.rows, ...boards.flatMap((b) => b.map((col) => col.length)));

// ---------------------------------------------------------------- anticipation

/**
 * Which reels slow down for suspense. Only when it is real (docs/SLOTS.md §2.8): the scatters already
 * landed on the reels to the left are one short of the trigger, and a scatter on this reel (or a later one)
 * would still complete it. `canHost(c)` says whether reel c can show a scatter at all.
 */
export function anticipationPlan(board: number[][], scatterIds: number[], scatterMin: number, canHost: (col: number) => boolean = () => true): boolean[] {
  const cols = board.length;
  const out = new Array<boolean>(cols).fill(false);
  if (!scatterIds.length) return out;
  let seen = 0;
  for (let c = 0; c < cols; c++) {
    if (seen >= scatterMin - 1 && seen < scatterMin && canHost(c)) {
      let reachable = 0;
      for (let r = c; r < cols; r++) if (canHost(r)) reachable++;
      out[c] = seen + reachable >= scatterMin;
    }
    seen += board[c].filter((s) => scatterIds.includes(s)).length;
  }
  return out;
}

// ---------------------------------------------------------------- win labels

/** "P2 x3", "L1 x4 (1 ways)", "P1 x8 (count)" → label and count. Null if it doesn't read that way. */
export function parseWinLabel(label: string): { symbol: string; count: number } | null {
  const m = /^(\S+)\s+x(\d+)/.exec(label);
  return m ? { symbol: m[1], count: Number(m[2]) } : null;
}

// ---------------------------------------------------------------- decor

/** Union of the winning cells of a step's wins, as "col,row" keys → [col,row]. */
export function cellsUnion(wins: { cells: [number, number][] }[]): [number, number][] {
  const seen = new Set<string>();
  const out: [number, number][] = [];
  for (const w of wins) {
    for (const [c, r] of w.cells) {
      const k = `${c},${r}`;
      if (!seen.has(k)) {
        seen.add(k);
        out.push([c, r]);
      }
    }
  }
  return out;
}

/**
 * Cell badges from a spin's `decor`. The pack's `moneyMap` encoding is `{"col,row": int}` (for example
 * `orb_sum_terminal.orbVals`); keys with "orb", "mult" or "badge" read as multipliers (`×2`), the rest as plain numbers.
 * Other encodings (cell lists, ints) carry no per-cell value and are ignored here.
 */
export function decorOverlays(decor: Record<string, unknown> | undefined, labels: SlotCopy['decorLabels'] = {}): Map<string, string> {
  const out = new Map<string, string>();
  if (!decor) return out;
  for (const [key, val] of Object.entries(decor)) {
    if (!val || typeof val !== 'object' || Array.isArray(val)) continue;
    const fmt = labels[key] ?? ((v: number) => (/orb|mult|badge/i.test(key) ? `×${v}` : String(v)));
    for (const [cell, v] of Object.entries(val as Record<string, unknown>)) {
      if (/^\d+,\d+$/.test(cell) && typeof v === 'number' && Number.isFinite(v)) out.set(cell, fmt(v));
    }
  }
  return out;
}

// ---------------------------------------------------------------- facts

const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '');
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (isObj(v)) for (const k of ['value', 'mean', 'estimate', 'p']) if (typeof v[k] === 'number' && Number.isFinite(v[k] as number)) return v[k] as number;
  return undefined;
};

/** The first value under any alias (spelling-insensitive): the top level first, then nested objects. */
function find(raw: Record<string, unknown>, aliases: string[]): unknown {
  const want = aliases.map(norm);
  let level = [raw];
  for (let depth = 0; depth < 4 && level.length; depth++) {
    for (const a of want) for (const o of level) for (const [k, v] of Object.entries(o)) if (norm(k) === a && v != null) return v;
    level = level.flatMap((o) => Object.entries(o).filter(([k, v]) => isObj(v) && !/^(spins|samples|histogram|raw)$/i.test(k)).map(([, v]) => v as Record<string, unknown>));
  }
  return undefined;
}

/**
 * Reads `slot-facts.json` tolerantly (snake or camel case, a percentage or a fraction, `rtp` as a number or
 * `{value, tier, se, n}`, the feature as "one in N" or as a probability) into SlotFacts. Throws if the RTP, its
 * tier, the hit rate or the max win is missing: the paytable must never show a made-up number.
 */
export function parseSlotFacts(raw: unknown): SlotFacts {
  if (!isObj(raw)) throw new Error('slot facts: not an object');
  const n = (...aliases: string[]) => num(find(raw, aliases));
  const frac = (v: number | undefined) => (v === undefined ? undefined : v > 1.5 ? v / 100 : v);
  const rawRtp = n('rtp', 'rtpTotal', 'totalRtp');
  const rtp = frac(rawRtp);
  const tier = find(raw, ['rtpTier', 'tier']);
  const hit = frac(n('hitRate', 'hit_rate', 'winFreq', 'hitFrequency'));
  const max = n('maxWinStakes', 'maxWin', 'maxMultiplier', 'maxWinCap');
  if (rtp === undefined || hit === undefined || max === undefined) throw new Error('slot facts: rtp, hit rate and max win are required');
  if (tier !== 'exact' && tier !== 'exact_mixture' && tier !== 'mc') throw new Error('slot facts: rtp tier must be exact, exact_mixture or mc');
  const seRaw = n('rtpSe', 'se');
  let oneIn = n('featureOneIn', 'featureFreq', 'featureFrequency', 'featureEvery');
  if (oneIn === undefined || oneIn <= 0) {
    const p = n('featureP', 'pFeature', 'featureProbability', 'triggerP');
    oneIn = p !== undefined && p > 0 ? (p <= 1 ? 1 / p : p) : undefined;
  } else if (oneIn < 1) oneIn = 1 / oneIn;
  const vol = find(raw, ['volatilityBand', 'measuredVolatility', 'volatility', 'vol']);
  return {
    rtp,
    rtpTier: tier,
    rtpSe: seRaw === undefined ? undefined : rawRtp !== undefined && rawRtp > 1.5 ? seRaw / 100 : seRaw,
    rtpN: n('rtpN', 'nMc', 'n'),
    hitRate: hit,
    maxWinStakes: max,
    featureOneIn: oneIn,
    volatility: typeof vol === 'string' ? vol : undefined,
  };
}

// ---------------------------------------------------------------- the feature, in words

/** The multiplier law in a short phrase: "Every win pays ×2", "The multiplier starts at ×1 and adds 1 each spin". */
export function multiplierNote(f: FeatureConfig): string {
  const m = f.multiplier;
  if (m.kind === 'constant') return m.value === 1 ? '' : `Every win pays ×${m.value}`;
  if (m.kind === 'per_spin') return `The multiplier starts at ×${m.start} and adds ${m.step} each spin`;
  return `The multiplier starts at ×${m.start} and adds ${m.step} for each retrigger`;
}

const sortedKeys = (t: Record<string, number> | null | undefined) => Object.keys(t ?? {}).map(Number).sort((a, b) => a - b);

/** The feature's rules as sentences, generated from the law the engine runs (so the text can't disagree). */
export function featureRules(f: FeatureConfig, name = 'free spins'): string[] {
  const out: string[] = [];
  const keys = sortedKeys(f.awards);
  const awards = keys.map((k) => `${k}${k === keys[keys.length - 1] && keys.length > 1 ? ' or more' : ''} scatters award ${f.awards[String(k)]}`);
  out.push(`${awards.join(', ')} ${name.toLowerCase()}.`.replace(/^(\w)/, (c) => c.toUpperCase()));
  const note = multiplierNote(f);
  if (note) out.push(`${note}.`);
  const rk = sortedKeys(f.retrigger);
  if (rk.length) out.push(`${rk.map((k) => `${k} scatters add ${f.retrigger![String(k)]}`).join(', ')} more spins during the feature.`);
  out.push(`A feature has at most ${f.maxSpins} spins.`);
  return out;
}

/** Free spins given at the start: derived from the spins played unless the cap cut the feature short, then from the awards table. */
export function initialSpins(f: FeatureConfig, spinsPlayed: number, retriggered: number, capped: boolean, scatters: number): number {
  const fromLaw = Math.min(award(f.awards, scatters), f.maxSpins);
  return capped || spinsPlayed - retriggered <= 0 ? Math.max(fromLaw, 1) : spinsPlayed - retriggered;
}

export { multiplierAt };

// ---------------------------------------------------------------- paytable

/** Stakes display for pays: "0.5×", "12×", "5,000×". */
export function fmtX(x: number): string {
  if (x >= 100) return Math.round(x).toLocaleString('en-US') + '×';
  const t = x >= 10 ? x.toFixed(1) : x.toFixed(2);
  return t.replace(/\.?0+$/, '') + '×';
}

export interface PayRow {
  /** Counts the pay applies to: 5 or 8–9. */
  from: number;
  to: number;
  /** In stakes. */
  stakes: number;
}

/** Merges consecutive counts that pay the same into ranges, highest count first. */
export function payRows(byCount: Record<string, number>, bet: number): PayRow[] {
  const entries = Object.entries(byCount)
    .map(([c, coins]) => ({ count: Number(c), stakes: coins / bet }))
    .filter((e) => Number.isFinite(e.count) && e.stakes > 0)
    .sort((a, b) => a.count - b.count);
  const rows: PayRow[] = [];
  for (const e of entries) {
    const last = rows[rows.length - 1];
    if (last && last.to === e.count - 1 && Math.abs(last.stakes - e.stakes) < 1e-9) last.to = e.count;
    else rows.push({ from: e.count, to: e.count, stakes: e.stakes });
  }
  return rows.reverse();
}

export const fmtCount = (r: PayRow) => (r.from === r.to ? String(r.from) : `${r.from}–${r.to}`);

/** The best pay of a symbol in stakes, for ordering. */
export const topPay = (byCount: Record<string, number> | undefined, bet: number) => Math.max(0, ...Object.values(byCount ?? {}).map((c) => c / bet));

/** The generated one-sentence rule under the board. */
export function ruleSentence(spec: SlotSpec, copy?: SlotCopy): string {
  if (copy?.rule) return copy.rule;
  const min = (spec.evaluation as { min_count?: number }).min_count;
  switch (spec.evaluation.kind) {
    case 'payline':
      return 'Match symbols from the left along a payline.';
    case 'ways':
      return 'Match symbols on neighbouring reels, starting from the left.';
    case 'cluster':
      return `Win with ${min ?? 5} or more matching symbols that touch.`;
    case 'scatter_pays':
      return `Win with ${min ?? 8} or more matching symbols anywhere.`;
    default:
      return 'Match symbols to win.';
  }
}

/** The payline rows (one row index per reel) for the mini line pictures in the paytable. */
export const paylinesOf = (spec: SlotSpec): number[][] => (spec.evaluation.kind === 'payline' ? (spec.evaluation.paylines ?? []) : []);

/** Cosmetic passing symbols for a spinning reel: a fixed cycle through the spec's symbols, no randomness. */
export function fillerSymbol(ids: number[], col: number, i: number): number {
  return ids[(col * 7 + i * 3 + ((i >> 2) % 5)) % ids.length];
}

/** A board to show before the first spin: the first reel set's strips from a fixed offset, else a fixed cycle of symbols. */
export function idleBoard(spec: SlotSpec): number[][] {
  const ids = spec.symbols.map((s) => s.id);
  const rowsList = spec.geometry.rows.length ? spec.geometry.rows : [3];
  const strips = spec.board_law.reel_sets?.[0]?.strips;
  return Array.from({ length: spec.geometry.cols }, (_, c) => {
    const n = rowsList[c % rowsList.length];
    const strip = strips?.[c];
    return Array.from({ length: n }, (_, r) => (strip && strip.length ? strip[(c * 3 + 1 + r) % strip.length] : fillerSymbol(ids, c, r)));
  });
}
