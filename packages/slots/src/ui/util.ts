// Pure helpers behind the slot UI: timing rules, anticipation, tiers, decor parsing,
// facts parsing and paytable rows. No React, no DOM, so they are unit-tested directly.

import type { SlotSpec, SpecSymbol, SpinResult, SpinWin } from '../engine/types';
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

/**
 * A win's engine label, whatever evaluator made it: "P2 x3" (payline; also "(right)", "(from reel 2)", "(wild own pay)"),
 * "L1 x4 (2 ways)" and "L1 x3 (4 paths, connected)" (ways), "cluster L1 x10" (cluster), "P1 x8 (count)" (scatter pays).
 * Returns the symbol label and the count, or null if it reads none of those.
 */
export function parseWinLabel(label: string): { symbol: string; count: number } | null {
  const m = /^(?:cluster\s+)?(\S+)\s+x(\d+)/.exec(label);
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
export function decorOverlays(decor: Record<string, unknown> | undefined, labels: SlotCopy['decorLabels'] = {}, bet?: number): Map<string, string> {
  const out = new Map<string, string>();
  if (!decor) return out;
  for (const [key, val] of Object.entries(decor)) {
    if (!val || typeof val !== 'object' || Array.isArray(val)) continue;
    const fmt =
      labels[key] ??
      ((v: number) => {
        if (/wildmults?$/i.test(key)) return `+${v}`; // additive multipliers add up: shown as +N
        if (/orb|mult|badge/i.test(key)) return `×${v}`;
        if (bet && /(held|coin|cash)vals?$/i.test(key)) return fmtX(v / bet); // coin values are coins: shown in bets
        return String(v);
      });
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

/** The multiplier law in a short line (under 9 words): "Every win ×2", "Multiplier starts ×1, +1 per spin". */
export function multiplierNote(f: FeatureConfig): string {
  const m = f.multiplier;
  if (m.kind === 'constant') return m.value === 1 ? '' : `Every win ×${m.value}`;
  if (m.kind === 'per_spin') return `Multiplier starts ×${m.start}, +${m.step} per spin`;
  return `Multiplier starts ×${m.start}, +${m.step} per retrigger`;
}

const sortedKeys = (t: Record<string, number> | null | undefined) => Object.keys(t ?? {}).map(Number).sort((a, b) => a - b);

/** Words in a line, counted the way the blind sandbox counts (space-separated tokens; it hides 9 or more). */
export const wordCount = (line: string) => line.trim().split(/\s+/).filter(Boolean).length;

/**
 * The feature's rules as short lines (each under 9 words, so a blind player can read them), generated from the
 * law the engine runs: "3 scatters: 8 free spins", "Every win ×2", "Retrigger: 3 scatters, +4 spins".
 */
export function featureRules(f: FeatureConfig, name = 'free spins', scatterName = 'scatters', spinsNoun?: string, scatterSingular?: string): string[] {
  const out: string[] = [];
  const spins = spinsNounFor(name, spinsNoun);
  const sc = (n: number) => countNoun(n, scatterName, scatterSingular);
  const keys = sortedKeys(f.awards);
  keys.forEach((k, i) => {
    const n = f.awards[String(k)];
    out.push(`${k}${i === keys.length - 1 && keys.length > 1 ? '+' : ''} ${sc(k)}: ${n} ${countNoun(n, spins)}`);
  });
  const note = multiplierNote(f);
  if (note) out.push(note);
  const rk = sortedKeys(f.retrigger);
  rk.forEach((k) => {
    const n = f.retrigger![String(k)];
    out.push(`Retrigger: ${k} ${sc(k)}, +${n} ${countNoun(n, 'spins')}`);
  });
  // Say what the config says: retriggers yes or no, and the cap only where it can bind.
  if (!rk.length) {
    out.push('No retriggers');
    const top = Math.max(0, ...keys.map((k) => f.awards[String(k)]));
    if (f.maxSpins < top) out.push(`At most ${f.maxSpins} spins`);
  } else out.push(`At most ${f.maxSpins} spins in total`);
  return out;
}

/** The noun for a feature's spins: the name if it already ends in "spins" ("Tide spins"), else `copy.featureSpins`, else "free spins". */
export function spinsNounFor(featureName: string, featureSpins?: string): string {
  return /spins?$/i.test(featureName.trim()) ? featureName.trim().toLowerCase() : (featureSpins ?? 'free spins').toLowerCase();
}

/** "1 order ticket", "3 order tickets": the singular for one, the plural otherwise (a plural noun with its trailing "s" dropped, unless a singular is given). */
export function countNoun(n: number, plural: string, singular?: string): string {
  if (n !== 1) return plural;
  if (singular) return singular.toLowerCase();
  return /ies$/.test(plural) ? plural.slice(0, -3) + 'y' : /(ch|sh|x|z|s)es$/.test(plural) ? plural.slice(0, -2) : plural.replace(/s$/, '');
}

/** The "how to win" lines, short. */
export function howToWinLines(spec: SlotSpec, copy?: SlotCopy): string[] {
  const out = [ruleSentence(spec, copy)];
  const kind = spec.evaluation.kind;
  const lines = paylinesOf(spec).length;
  if (kind === 'payline' && lines) out.push(`${lines} paylines, paid left to right`, 'Line wins add up');
  if (kind === 'ways') out.push('Ways to match multiply together');
  out.push('Pays are multiples of your bet');
  return out;
}

/** Default wild text (a game's `copy.wildText` replaces it). */
export const wildLines = (copy?: SlotCopy) => [copy?.wildText ?? 'Wild replaces paying symbols'];

/** Default scatter text (a game's `copy.scatterText` replaces it). */
export function scatterLines(min: number, featureName: string | null, copy?: SlotCopy, scatterName = 'scatters'): string[] {
  if (copy?.scatterText) return [copy.scatterText];
  return featureName ? ['Pays anywhere', `${min}+ ${scatterName} start ${featureName.toLowerCase()}`] : ['Pays anywhere'];
}

/** Feature intro card lines. */
export const introLines = (scatters: number, note: string, scatterName = 'scatters', scatterSingular?: string) => [`${scatters} ${countNoun(scatters, scatterName, scatterSingular)}`, ...(note ? [note] : [])];

/** Feature outro card lines. */
export const outroLines = (spins: number, stakes: number, capped: boolean, spinsNoun = 'free spins') => [`${spins} ${countNoun(spins, spinsNoun)}`, `${fmtX(stakes)} your bet`, ...(capped ? ['Max win reached'] : [])];

/** Free spins given at the start: derived from the spins played unless the cap cut the feature short, then from the awards table. */
export function initialSpins(f: FeatureConfig, spinsPlayed: number, retriggered: number, capped: boolean, scatters: number): number {
  const fromLaw = Math.min(award(f.awards, scatters), f.maxSpins);
  return capped || spinsPlayed - retriggered <= 0 ? Math.max(fromLaw, 1) : spinsPlayed - retriggered;
}

export { multiplierAt };

// ---------------------------------------------------------------- paytable

/** Stakes display for pays: "0.5×", "12×", "5,000×". Tiny pays keep their digits ("0.0045×"), never "0×". */
export function fmtX(x: number): string {
  if (x >= 100) return Math.round(x).toLocaleString('en-US') + '×';
  if (x > 0 && x < 0.01) {
    const t = (x >= 0.0001 ? x.toFixed(4) : x.toPrecision(2)).replace(/0+$/, '');
    return t + '×';
  }
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
      return 'Match symbols on adjacent reels from the left.';
    case 'cluster':
      return `Touch ${min ?? 5}+ matching symbols to win.`;
    case 'scatter_pays':
      return `Land ${min ?? 8}+ matching symbols to win.`;
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

// ---------------------------------------------------------------- extras labels

const RAW_ENGINE_LABEL = /^[A-Z]{2,}(?:[ &][A-Z]{2,})*/;

/**
 * What to show for an engine extras label. Raw engine text ("HOLD & SPIN: 9 coins", "ORB SUM x35") is never shown:
 * `copy.extrasLabels` maps it; the neutral default is "Scatter pay", "Bonus ×35" or "Bonus total". A label already in
 * the game's own words (not engine capitals) passes through unchanged.
 */
export function extraLabel(raw: string, map?: SlotCopy['extrasLabels']): string {
  if (typeof map === 'function') return map(raw);
  if (map) {
    if (raw in map) return map[raw];
    const hit = Object.keys(map).find((k) => raw.startsWith(k));
    if (hit) return map[hit];
  }
  if (!RAW_ENGINE_LABEL.test(raw)) return raw;
  if (/scatter pay/i.test(raw)) return 'Scatter pay';
  const m = /\bx(\d+)/i.exec(raw);
  return m ? `Bonus ×${m[1]}` : 'Bonus total';
}

// ---------------------------------------------------------------- multipliers from the spin

export interface RoundMultiplier {
  total: number;
  /** The additive parts ("+1" per rocket), when the engine reports them. */
  parts?: number[];
  kind: 'additive' | 'reel' | 'orbs';
}

const isMoneyMap = (v: unknown): v is Record<string, number> => isObj(v) && Object.values(v).every((x) => typeof x === 'number');

/**
 * The multiplier the engine applied to this spin, from its decor: `global_additive` (1 + the rockets' +N),
 * a `global_iid` multiplier reel, or the sum of `orb_sum_terminal` orbs. Null if none, or if it is ×1.
 */
export function roundMultiplier(decor: Record<string, unknown> | undefined): RoundMultiplier | null {
  if (!decor) return null;
  const gwm = decor['global_additive.gwm'];
  if (typeof gwm === 'number' && gwm > 1) {
    const w = decor['global_additive.wildMults'];
    return { total: gwm, parts: isMoneyMap(w) ? Object.values(w) : undefined, kind: 'additive' };
  }
  for (const [k, v] of Object.entries(decor)) if (/(^|\.)mult$/.test(k) && typeof v === 'number' && v > 1) return { total: v, kind: 'reel' };
  const orbs = decor['orb_sum_terminal.orbVals'];
  if (isMoneyMap(orbs)) {
    const t = Object.values(orbs).reduce((a, b) => a + b, 0);
    if (t > 1) return { total: t, kind: 'orbs' };
  }
  return null;
}

/** "Multiplier ×6 (1 + 5)" for the chip; under 9 words. Orbs show through their own extras line. */
export function multiplierChip(m: RoundMultiplier): string | null {
  if (m.kind === 'orbs') return null;
  const sum = m.parts?.reduce((a, b) => a + b, 0);
  return m.kind === 'additive' && sum !== undefined && sum + 1 === m.total ? `Multiplier ×${m.total} (1 + ${sum})` : `Multiplier ×${m.total}`;
}

// ---------------------------------------------------------------- modifier-driven features

export interface ModifierInfo {
  /** Respins in the chain (steps without a win that are followed by another board). */
  respins: number;
}

/**
 * A modifier-driven feature (hold and spin, sticky or expanding-wild respins) shows in the spin itself: a chain of
 * boards with no win between them, or a `*.respins` decor. `custom` is a game's own test (the optional
 * `modifierFeature.detect` of slot.config.json) and wins if it returns true.
 */
export function modifierOf(res: SpinResult, custom?: (res: SpinResult) => boolean): ModifierInfo | null {
  let respins = 0;
  res.steps.forEach((st, i) => {
    if (i + 1 < res.steps.length && st.wins.length === 0) respins++;
  });
  for (const [k, v] of Object.entries(res.decor ?? {})) if (/(^|\.)respins$/.test(k) && typeof v === 'number' && v > respins) respins = v;
  if (respins > 0) return { respins };
  return custom?.(res) ? { respins: 0 } : null;
}

/** Cells whose coin value has landed by each step: the cell holds its final symbol from that step on. */
export function landedByStep(res: SpinResult, bet: number, labels: SlotCopy['decorLabels']): Map<string, string>[] {
  const key = Object.keys(res.decor ?? {}).find((k) => /(held|coin|cash)vals?$/i.test(k) && isMoneyMap(res.decor[k]));
  const fin = res.finalBoard;
  if (!key) return res.steps.map(() => new Map());
  const labelled = decorOverlays({ [key]: res.decor[key] }, labels, bet);
  return res.steps.map((_, j) => {
    const out = new Map<string, string>();
    for (const [cell, text] of labelled) {
      const [c, r] = cell.split(',').map(Number);
      let stays = true;
      for (let k = j; k < res.steps.length && stays; k++) stays = res.steps[k].board[c]?.[r] === fin[c]?.[r];
      if (stays) out.set(cell, text);
    }
    return out;
  });
}

/** Sum of the landed coin values, in coins. */
export function landedCoins(res: SpinResult): number[] {
  const key = Object.keys(res.decor ?? {}).find((k) => /(held|coin|cash)vals?$/i.test(k) && isMoneyMap(res.decor[k]));
  const vals = key ? (res.decor[key] as Record<string, number>) : {};
  const fin = res.finalBoard;
  return res.steps.map((_, j) => {
    let t = 0;
    for (const [cell, v] of Object.entries(vals)) {
      const [c, r] = cell.split(',').map(Number);
      let stays = true;
      for (let k = j; k < res.steps.length && stays; k++) stays = res.steps[k].board[c]?.[r] === fin[c]?.[r];
      if (stays) t += v;
    }
    return t;
  });
}

// ---------------------------------------------------------------- value symbols and mechanic text (paytable)

export interface ValueDist {
  kind: 'mult' | 'coins';
  values: { v: number; p: number }[];
}

/** The value distribution of a coin / orb / collector symbol, from the mechanic that names it (`coin_symbol`, `orb_symbol`...). */
export function valueDistribution(spec: SlotSpec, symbolId: number): ValueDist | null {
  for (const m of spec.mechanics) {
    const p = m.params as Record<string, unknown> | undefined;
    if (!p || !isObj(p.value_pmf)) continue;
    const linked = Object.entries(p).some(([k, v]) => /_symbol$/.test(k) && Number(v) === symbolId);
    if (!linked) continue;
    const pmf = p.value_pmf as Record<string, number>;
    const total = Object.values(pmf).reduce((a, b) => a + b, 0) || 1;
    const values = Object.entries(pmf).map(([v, w]) => ({ v: Number(v), p: w / total })).sort((a, b) => a.v - b.v);
    return { kind: /orb|mult/i.test(m.id) ? 'mult' : 'coins', values };
  }
  return null;
}

/** "Value ×1 to ×500", "Most often ×1": short lines for a value symbol. */
export function valueLines(d: ValueDist, bet: number): string[] {
  const f = (v: number) => (d.kind === 'mult' ? `×${v}` : `×${+(v / bet).toPrecision(3)}`);
  const lo = d.values[0].v;
  const hi = d.values[d.values.length - 1].v;
  const mode = d.values.reduce((a, b) => (b.p > a.p ? b : a));
  return [lo === hi ? `Value ${f(lo)}` : `Value ${f(lo)} to ${f(hi)}`, `Most often ${f(mode.v)}`];
}

/** The values a `global_iid` multiplier reel can show, from the spec. */
export function multiplierValues(spec: SlotSpec): number[] {
  const m = spec.mechanics.find((x) => x.id === 'global_iid');
  const pmf = m?.params?.value_pmf;
  return isObj(pmf) ? Object.keys(pmf).map(Number).sort((a, b) => a - b) : [];
}

/** Paytable lines for a respin-style modifier feature, from the mechanic's params (each under 9 words). */
export function modifierRuleLines(spec: SlotSpec, symbolName: (id: number) => string, copy?: SlotCopy): string[] {
  if (copy?.modifierRules) return copy.modifierRules;
  const m = spec.mechanics.find((x) => /respin|hold_and_spin/.test(x.id));
  if (!m) return [];
  const p = (m.params ?? {}) as Record<string, unknown>;
  const out: string[] = [];
  const coin = typeof p.coin_symbol === 'number' ? symbolName(p.coin_symbol).toLowerCase() : null;
  if (typeof p.entry_min === 'number') out.push(coin ? `${p.entry_min}+ ${coin}s start the bonus` : `${p.entry_min}+ symbols start the bonus`);
  if (typeof p.respins === 'number') out.push(`${p.respins} respins`);
  if (/hold_and_spin/.test(m.id)) out.push('Each new coin resets the respins', 'Coins lock and pay their value');
  else out.push('Locked symbols stay while it respins');
  if (typeof p.full_grid_bonus === 'number') out.push('Fill the grid for a bonus');
  return out;
}

// ---------------------------------------------------------------- mystery reveal

export interface PreReveal {
  /** The board as the reels stop: mystery symbols visible. */
  board: number[][];
  /** The cells that flip. */
  cells: [number, number][];
}

/**
 * `mystery_reveal` shows only the final board, with the mystery squares already replaced. Rebuild the board before
 * the reveal from the stops and the strips (the mystery symbol sits at those positions) and list the cells to flip
 * into `decor['mystery_reveal.mysteryReveal']`. Null if the spin has no reveal or the strips don't reproduce it.
 */
export function preReveal(spec: SlotSpec, res: SpinResult): PreReveal | null {
  const mech = spec.mechanics.find((m) => m.id === 'mystery_reveal');
  const revealed = res.decor?.['mystery_reveal.mysteryReveal'];
  const mystery = Number((mech?.params as Record<string, unknown> | undefined)?.mystery_symbol);
  const rs = spec.board_law.reel_sets?.[res.set];
  const board0 = res.steps[0]?.board;
  if (!mech || typeof revealed !== 'number' || !Number.isFinite(mystery) || !rs || !board0 || rs.strips.length !== board0.length || res.stops?.length !== board0.length) return null;
  const cells: [number, number][] = [];
  const board = board0.map((col, c) => {
    const strip = rs.strips[c];
    return col.map((sym, r) => {
      const pre = strip[(res.stops[c] + r) % strip.length];
      if (pre === sym) return sym;
      if (pre === mystery && sym === revealed) {
        cells.push([c, r]);
        return pre;
      }
      return NaN; // a different transform: don't guess
    });
  });
  if (!cells.length || board.some((col) => col.some((v) => Number.isNaN(v)))) return null;
  return { board, cells };
}

// ---------------------------------------------------------------- pending win in a respin chain

export interface Pending {
  /** What the board pays as it stands, in coins. */
  coins: number;
  /** The cells that would pay. */
  cells: [number, number][];
}

/**
 * What each board of a respin chain would pay, derived honestly: the step's own `stepCoins` and wins when the engine
 * reports them, otherwise the engine's own evaluator run over that board (`SlotEngine.evalBoardLines`). Nothing is
 * attributed to cells by guesswork.
 */
export function pendingByStep(res: SpinResult, evalBoard: (board: number[][]) => [SpinWin[], number]): Pending[] {
  return res.steps.map((st) => {
    if (st.wins.length) return { coins: st.stepCoins, cells: cellsUnion(st.wins) };
    const [wins, coins] = evalBoard(st.board);
    return { coins, cells: cellsUnion(wins) };
  });
}

// ---------------------------------------------------------------- colour

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const rgb = (h: string) => {
  const x = h.length === 4 ? [...h.slice(1)].map((c) => c + c).join('') : h.slice(1);
  return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16));
};

/** A flat mix of two hex colours (t = 0 is `a`, 1 is `b`); a non-hex colour is returned as it is. Used for the chain tint. */
export function mixHex(a: string, b: string, t: number): string {
  if (!HEX.test(a) || !HEX.test(b)) return a;
  const [x, y] = [rgb(a), rgb(b)];
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------- what a chain announces (never its length)

/** The respins a modifier chain starts with, from the mechanic's params: "3 respins", or "Up to 4 respins". Null if it names none. */
export function modifierStartTitle(spec: SlotSpec): { title: string; initial: number | null; max?: number } | null {
  const m = spec.mechanics.find((x) => /respin|hold_and_spin/.test(x.id));
  const p = (m?.params ?? {}) as Record<string, unknown>;
  if (typeof p.respins === 'number') return { title: `${p.respins} respins`, initial: p.respins };
  if (typeof p.max_respins === 'number') return { title: `Up to ${p.max_respins} respins`, initial: null, max: p.max_respins };
  return null;
}

/** Respins left after step `j`, for a chain whose respins reset when a coin lands (hold and spin): known from the past only. */
export function respinsLeft(landed: number[], j: number, initial: number): number {
  let since = 0;
  for (let k = 1; k <= j; k++) since = landed[k] > landed[k - 1] ? 0 : since + 1;
  return Math.max(0, initial - since);
}

// ---------------------------------------------------------------- cascade ladder and ways

/** The rungs of a `cascade_step_ladder` mechanic ("×1 ×2 ×3 ×5 ×8"), from the spec's params; empty if there is none. */
export function ladderOf(spec: SlotSpec): number[] {
  const l = spec.mechanics.find((m) => m.id === 'cascade_step_ladder')?.params?.ladder;
  return Array.isArray(l) ? l.filter((x): x is number => typeof x === 'number') : [];
}

/**
 * The factor applied to each paying step, in order (decor `cascade_step_ladder.stepMults`, base board first), so the
 * k-th paying step's wins carry `stepMults[k]`. Empty when the spin has none.
 */
export function stepMults(decor: Record<string, unknown> | undefined): number[] {
  const v = decor?.['cascade_step_ladder.stepMults'];
  return Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : [];
}

/** Ways of a variable-height board as the reels stop: the product of the rows of the reels that have stopped (null = still spinning). */
export function waysOf(heights: (number | null)[]): number | null {
  const done = heights.filter((h): h is number => h !== null);
  return done.length ? done.reduce((a, b) => a * b, 1) : null;
}

// ---------------------------------------------------------------- held cells in a respin chain

/**
 * The cells held at each step of a respin chain: coins that have landed (hold and spin) and the cells in the spin's
 * `*.locked` decor (sticky respins), once they hold their final symbol from that step on. Those are the cells that do
 * not spin on the way to the next board.
 */
export function heldByStep(res: SpinResult): Set<string>[] {
  const fin = res.finalBoard;
  const cand = new Set<string>();
  for (const [k, v] of Object.entries(res.decor ?? {})) {
    if (/(held|coin|cash)vals?$/i.test(k) && isMoneyMap(v)) Object.keys(v).forEach((c) => cand.add(c));
    if (/(^|\.)locked$/.test(k) && Array.isArray(v)) for (const c of v) if (Array.isArray(c) && c.length === 2) cand.add(`${c[0]},${c[1]}`);
  }
  return res.steps.map((_, j) => {
    const out = new Set<string>();
    for (const cell of cand) {
      const [c, r] = cell.split(',').map(Number);
      let stays = fin[c]?.[r] !== undefined;
      for (let k = j; k < res.steps.length && stays; k++) stays = res.steps[k].board[c]?.[r] === fin[c][r];
      if (stays) out.add(cell);
    }
    return out;
  });
}

/** The cells of the grid in this spin (for a "Filled 9/25" counter). */
export const gridCells = (res: SpinResult) => res.finalBoard.reduce((a, col) => a + col.length, 0);

// ---------------------------------------------------------------- copy check

/**
 * Game-provided copy lines of 9 or more words (they are hidden from blind reviewers). Returns each offender with its
 * field and word count; call it in a game's test: `expect(checkCopy(copy)).toEqual([])`.
 */
export function checkCopy(copy: SlotCopy | undefined): { field: string; text: string; words: number }[] {
  if (!copy) return [];
  const out: { field: string; text: string; words: number }[] = [];
  const add = (field: string, text: unknown) => {
    if (typeof text === 'string' && wordCount(text) >= 9) out.push({ field, text, words: wordCount(text) });
  };
  for (const k of ['featureName', 'introNote', 'rule', 'wildText', 'scatterText', 'modifierName', 'modifierIntro', 'respinLabel', 'respinsLeftLabel', 'fillLabel', 'pendingLabel', 'featureRule', 'chainRule'] as const) add(k, copy[k]);
  Object.entries(copy.symbolText ?? {}).forEach(([id, t]) => add(`symbolText.${id}`, t));
  copy.modifierRules?.forEach((t, i) => add(`modifierRules[${i}]`, t));
  copy.featureNotes?.forEach((t, i) => add(`featureNotes[${i}]`, t));
  if (copy.extrasLabels && typeof copy.extrasLabels === 'object') Object.entries(copy.extrasLabels).forEach(([k, v]) => add(`extrasLabels.${k}`, v));
  if (typeof copy.ladder === 'object') add('ladder.label', copy.ladder.label);
  add('multiplierReel.label', copy.multiplierReel?.label);
  return out;
}

/** "Sun" → "suns", "Treasure chest" → "treasure chests": the scatter's name as the rules say it. Falls back to "scatters". */
export function pluralOf(name: string | undefined, count?: number): string {
  const n = name?.trim().toLowerCase();
  if (!n) return count === 1 ? 'scatter' : 'scatters';
  if (count === 1) return n;
  return /(s|x|z|ch|sh)$/.test(n) ? n + (/s$/.test(n) ? '' : 'es') : /[^aeiou]y$/.test(n) ? n.slice(0, -1) + 'ies' : n + 's';
}

/** The mystery symbol's id, from the spec's `mystery_reveal` mechanic params. */
export function mysterySymbol(spec: SlotSpec): number | null {
  const v = Number((spec.mechanics.find((m) => m.id === 'mystery_reveal')?.params as Record<string, unknown> | undefined)?.mystery_symbol);
  return Number.isFinite(v) ? v : null;
}

// ---------------------------------------------------------------- money

/**
 * An amount with 2 decimals, except that a paying amount is never shown as zero: under 0.01 it keeps two significant
 * digits ("0.0045"). Zero is "0.00".
 */
export function fmtMoney(x: number): string {
  if (x > 0 && x < 0.01) return (x >= 1e-6 ? x.toPrecision(2) : '<0.000001').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return x.toFixed(2);
}

/** A history chip: a round's multiple of the bet, tiny ones keep their digits ("0.0045×"), a loss is "0.00×". */
export const fmtHist = (m: number) => (m > 0 && m < 0.01 ? fmtX(m) : m.toFixed(2) + '×');

// ---------------------------------------------------------------- values on landing (orbs, coins)

/**
 * Where each cell of each step ends up on the terminal board, following the tumbles (survivors fall in order, new
 * symbols fill from the top). Null if any step is not a plain tumble, so nothing is ever guessed.
 */
export function terminalMaps(res: SpinResult): Map<string, string>[] | null {
  const n = res.steps.length;
  const maps: Map<string, string>[] = new Array(n);
  maps[n - 1] = new Map(res.steps[n - 1].board.flatMap((col, c) => col.map((_, r) => [`${c},${r}`, `${c},${r}`] as [string, string])));
  for (let j = n - 2; j >= 0; j--) {
    const st = res.steps[j];
    const next = res.steps[j + 1];
    const gone = new Set(cellsUnion(st.wins).map(([c, r]) => `${c},${r}`));
    const step = new Map<string, string>();
    for (let c = 0; c < st.board.length; c++) {
      const col = st.board[c];
      if (!next.board[c] || next.board[c].length !== col.length) return null;
      const keep = col.map((_, r) => r).filter((r) => !gone.has(`${c},${r}`));
      const nNew = col.length - keep.length;
      // A survivor that stays in place may show a new symbol (a locked row opening): a new symbol, not tracked back.
      for (let i = 0; i < keep.length; i++) if (col[keep[i]] !== next.board[c][nNew + i] && keep[i] !== nNew + i) return null;
      keep.forEach((r, i) => {
        if (col[r] === next.board[c][nNew + i]) step.set(`${c},${r}`, maps[j + 1].get(`${c},${nNew + i}`)!);
      });
    }
    maps[j] = step;
  }
  return maps;
}

/**
 * The value badges of each step: a value-carrying symbol (an orb, a coin) shows its value from the moment it lands.
 * The engine decides the values at the terminal board; tracking each cell to its terminal place says which cell is which.
 * Null if the spin has no such values (e.g. a spin that pays nothing draws none).
 */
export function valueBadgesByStep(res: SpinResult, labels: SlotCopy['decorLabels'], bet: number): Map<string, string>[] | null {
  const key = Object.keys(res.decor ?? {}).find((k) => /orbVals$/i.test(k) && isMoneyMap(res.decor[k]));
  if (!key) return null;
  const vals = res.decor[key] as Record<string, number>;
  const maps = terminalMaps(res);
  const labelOf = (cell: string) => decorOverlays({ [key]: { [cell]: vals[cell] } }, labels, bet).get(cell);
  if (!maps) {
    const last = new Map<string, string>(Object.keys(vals).map((c) => [c, labelOf(c)!]));
    return res.steps.map((_, j) => (j === res.steps.length - 1 ? last : new Map()));
  }
  return res.steps.map((st, j) => {
    const out = new Map<string, string>();
    st.board.forEach((col, c) =>
      col.forEach((_, r) => {
        const t = maps[j].get(`${c},${r}`);
        if (t && t in vals) out.set(`${c},${r}`, labelOf(t)!);
      }),
    );
    return out;
  });
}

// ---------------------------------------------------------------- ladder lines

/** "Base: ×1 ×2 ×3" lines, each under 9 words: long ladders continue on the next line. */
export function ladderLines(label: string, values: number[]): string[] {
  const head = `${label}:`;
  const room = Math.max(1, 8 - head.split(/\s+/).length);
  const out: string[] = [];
  for (let i = 0; i < values.length; i += room) out.push((i === 0 ? head + ' ' : '') + values.slice(i, i + room).map((v) => `×${v}`).join(' '));
  return out;
}

/**
 * The chip for a spin multiplier that combines with the feature's own: "Spin ×9 · Rockets ×9 = ×81". `labels` come from the
 * game's copy. Under 9 words; if the labels make it longer it falls back to "Multiplier ×81".
 */
export function combinedMultiplierChip(rm: RoundMultiplier, spin: number, labels: { spin?: string; additive?: string; reel?: string; orbs?: string } = {}): string | null {
  if (spin === 1) return multiplierChip(rm);
  const part = rm.kind === 'additive' ? (labels.additive ?? 'Bonus') : rm.kind === 'reel' ? (labels.reel ?? 'Reel') : (labels.orbs ?? 'Orbs');
  const text = `${labels.spin ?? 'Spin'} ×${spin} · ${part} ×${rm.total} = ×${spin * rm.total}`;
  return wordCount(text) >= 9 ? `Multiplier ×${spin * rm.total}` : text;
}

/**
 * The running sum of the orbs on show at each step (`orb_sum_terminal`): each step's orbs are tracked to the terminal
 * board, where the engine decided their values, so the sum grows as tumbles reveal more orbs and reaches the spin's total
 * only on the last step. Null if the spin has no orb values. Never shows the outcome before the board that produces it.
 */
export function orbSumsByStep(res: SpinResult): number[] | null {
  const key = Object.keys(res.decor ?? {}).find((k) => /orbVals$/i.test(k) && isMoneyMap(res.decor[k]));
  if (!key) return null;
  const vals = res.decor[key] as Record<string, number>;
  const total = Object.values(vals).reduce((a, b) => a + b, 0);
  const maps = terminalMaps(res);
  const n = res.steps.length;
  if (!maps) return res.steps.map((_, j) => (j === n - 1 ? total : 0));
  return res.steps.map((st, j) => {
    let sum = 0;
    st.board.forEach((col, c) =>
      col.forEach((_, r) => {
        const t = maps[j].get(`${c},${r}`);
        if (t && t in vals) sum += vals[t];
      }),
    );
    return j === n - 1 ? total : sum;
  });
}

// ---------------------------------------------------------------- the paytable's compact columns

/**
 * The counts to show as columns in the compact pay rows, each an exact count from the spec's own tables: 3, 4, 5 of a kind
 * for line and ways games; for cluster and pay-anywhere games the smallest count and every 5 above it (5, 10, 15, 20),
 * as far as the tables go. The full per-count table sits behind each symbol's "All pays".
 */
export function tierCounts(spec: SlotSpec, symbolIds: number[]): number[] {
  const all = new Set<number>();
  for (const id of symbolIds) for (const k of Object.keys(spec.pays.paytable[String(id)] ?? {})) if (Number.isFinite(Number(k))) all.add(Number(k));
  const counts = [...all].sort((a, b) => a - b);
  if (counts.length <= 4) return counts;
  const kind = spec.evaluation.kind;
  if (kind === 'payline' || kind === 'ways') return counts.slice(-4);
  const picked = [0, 5, 10, 15].map((d) => counts[0] + d).filter((n) => all.has(n));
  if (picked.length >= 3) return picked;
  return [0, 1, 2, 3].map((i) => counts[Math.round((i * (counts.length - 1)) / 3)]);
}

/** A symbol's pay for exactly `count` of it, in stakes (null if the table has none). */
export function payAt(pays: Record<string, number> | undefined, count: number, bet: number): number | null {
  const v = pays?.[String(count)];
  return typeof v === 'number' ? v / bet : null;
}
