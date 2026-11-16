// Pure helpers behind the slot UI: timing rules, anticipation, tiers, decor parsing,
// facts parsing and paytable rows. No React, no DOM, so they are unit-tested directly.

import type { SlotSpec, SpecSymbol, SpinResult } from '../engine/types';
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
export function featureRules(f: FeatureConfig, name = 'free spins'): string[] {
  const out: string[] = [];
  const nm = name.toLowerCase();
  const keys = sortedKeys(f.awards);
  keys.forEach((k, i) => out.push(`${k}${i === keys.length - 1 && keys.length > 1 ? '+' : ''} scatters: ${f.awards[String(k)]} ${nm}`));
  const note = multiplierNote(f);
  if (note) out.push(note);
  sortedKeys(f.retrigger).forEach((k) => out.push(`Retrigger: ${k} scatters, +${f.retrigger![String(k)]} spins`));
  out.push(`At most ${f.maxSpins} spins in total`);
  return out;
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
export function scatterLines(min: number, featureName: string | null, copy?: SlotCopy): string[] {
  if (copy?.scatterText) return [copy.scatterText];
  return featureName ? ['Pays anywhere', `${min}+ scatters start ${featureName.toLowerCase()}`] : ['Pays anywhere'];
}

/** Feature intro card lines. */
export const introLines = (scatters: number, note: string) => [`${scatters} scatters`, ...(note ? [note] : [])];

/** Feature outro card lines. */
export const outroLines = (spins: number, stakes: number, capped: boolean) => [`${spins} free spins`, `${fmtX(stakes)} your bet`, ...(capped ? ['Max win reached'] : [])];

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
