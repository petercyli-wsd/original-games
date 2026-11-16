// Exact laws of the mechanic families the TypeScript closed forms cover, ported from the engine
// pack's analytics terms (`reelengine.analytics.terms`; each plugin's `term(engine)` in
// `reelengine/mechanics/`). Every law keeps the product form of the reels (docs/SLOTS.md §2.1):
//
//   walking_wild     Mixture over the placement columns: outcome j (prob w_j / Σw) maps reel j's
//                    window to all wild_symbol (default: the lowest wild id). The walker eats
//                    scatters (S1 runs before the scatter count). Tier exact_mixture.
//   expanding_wild   Local: on an eligible reel (expand_reels, default all) a window showing any
//                    wild becomes all first-wild (the lowest wild id). Tier exact.
//   mystery_reveal   Mixture over reveal_pmf targets t: every mystery cell becomes t. Tier
//                    exact_mixture.
//   global_iid       ConstFactor E[M]: one board-independent draw M ~ value_pmf multiplies the
//                    evaluator wins (lines / ways / count pays), never the scatter pay. 'per_spin'
//                    draws at S3 on every spin; 'terminal_total' draws at the terminal only when
//                    the round paid (min_steps = 1), coins × M either way. min_steps > 1 is
//                    refused (the pack labels it Opaque). Distribution: coins ⊗ pmf(M).
//   global_additive  AffineCountFactor: the evaluator wins × (base + Σ_{visible wilds} V_i), V_i iid
//                    ~ value_pmf, counted on the transformed board; E = base + E[V]·N by
//                    conditioning on the board (exact.ts). Distribution: per board with N wilds,
//                    coins ⊗ pmf(base + V_1 + … + V_N).
//
// Transforms compose in record order (the pack's `composed.outcomes`): the model's components are
// the reel sets × the cartesian product of the mixtures' outcomes, each component's per-reel window
// catalog transformed by its outcome's maps (identical windows merged). Anything else (cluster,
// cascades / tumbles, respins, hold-and-spin, height laws, the other families) is refused by name.

import { firstOfSet } from '../evaluators';
import type { SlotSpec } from '../types';
import type { Component, ReelWindow } from './model';

/** A per-reel window map (the pack's `Local`). */
export interface WindowMap {
  label: string;
  fn: (c: number, win: number[]) => number[];
}

export type Transform =
  | { kind: 'local'; label: string; map: WindowMap }
  | { kind: 'mixture'; label: string; outcomes: { p: number; map: WindowMap | null }[] };

/** A finite pmf on integers (values ascending). */
export interface Pmf {
  values: number[];
  probs: number[];
}

/** A board-independent iid multiplier of the evaluator wins (global_iid). */
export interface IidFactor {
  label: string;
  pmf: Pmf;
  mean: number;
}

/** base + Σ over the visible `target` cells of iid draws from `pmf` (global_additive). */
export interface AffineFactor {
  label: string;
  target: Set<number>;
  base: number;
  pmf: Pmf;
  /** E[draw]: the slope of the expected factor in the target count. */
  slope: number;
}

/** What multiplies the evaluator coins after evaluation (never the scatter pay). */
export interface PostLaw {
  iid: IidFactor[];
  affine: AffineFactor | null;
  /** Π E[M] over the iid factors. */
  constFactor: number;
}

export interface MechanicLaws {
  transforms: Transform[];
  post: PostLaw;
  /** One line per mechanic: its law (the pack's tier_reasons). */
  labels: string[];
  refusals: string[];
}

export const EXACT_FAMILIES = ['walking_wild', 'expanding_wild', 'mystery_reveal', 'global_iid', 'global_additive'] as const;

/** Largest number of (reel set × mixture outcome) components the model expands. */
export const MAX_COMPONENTS = 4096;

/** Python int(x) for the str / int inputs a spec can carry; null when not int-castable. */
function pyInt(x: unknown): number | null {
  if (typeof x === 'number') return Number.isFinite(x) ? Math.trunc(x) : null;
  if (typeof x === 'string' && /^\s*[+-]?\d+\s*$/.test(x)) return Number(x.trim());
  return null;
}

/** {value: weight} → pmf sorted by value (int keys, positive int weights). */
function intPmf(name: string, raw: unknown, minValue: number): Pmf {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Object.keys(raw).length) throw new Error(`${name} must be a non-empty {value: weight} map`);
  const items: [number, number][] = [];
  for (const [k, w] of Object.entries(raw as Record<string, unknown>)) {
    const v = pyInt(k);
    if (v === null || v < minValue) throw new Error(`${name}: value '${k}' must be an int >= ${minValue}`);
    if (typeof w !== 'number' || !Number.isInteger(w) || w <= 0) throw new Error(`${name}: weight for '${k}' must be a positive int`);
    items.push([v, w]);
  }
  items.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const tot = items.reduce((a, [, w]) => a + w, 0);
  return { values: items.map(([v]) => v), probs: items.map(([, w]) => w / tot) };
}

function pmfMean(p: Pmf): number {
  return p.values.reduce((a, v, i) => a + v * p.probs[i], 0);
}

/**
 * The exact laws of a spec's mechanics. `wilds` are the declared wild ids; never throws for an
 * out-of-scope or malformed mechanic: it lists the refusal by name.
 */
export function mechanicLaws(spec: SlotSpec, cols: number, wilds: Set<number>, scatter: number | null): MechanicLaws {
  const transforms: Transform[] = [];
  const iid: IidFactor[] = [];
  let affine: AffineFactor | null = null;
  const labels: string[] = [];
  const refusals: string[] = [];
  const mechs = (spec.mechanics ?? []) as unknown as { id?: string; family?: string; params?: Record<string, unknown> }[];
  const ids = mechs.map((m) => String(m.id ?? m.family));
  const outside = ids.filter((id) => !(EXACT_FAMILIES as readonly string[]).includes(id));
  if (outside.length) {
    refusals.push(
      `mechanics ${JSON.stringify(outside)}: no closed form in the TypeScript analytics (exact families: ${EXACT_FAMILIES.join(', ')}; cascades, respins, hold-and-spin and the rest go to Monte Carlo)`,
    );
    return { transforms, post: { iid, affine, constFactor: 1 }, labels, refusals };
  }
  const firstWild = wilds.size ? firstOfSet(wilds) : null;
  mechs.forEach((m, i) => {
    const id = ids[i];
    const p = m.params ?? {};
    try {
      if (id === 'walking_wild') {
        const placement = intPmf('walking_wild: placement_pmf', p.placement_pmf, 0);
        for (const c of placement.values) if (c >= cols) throw new Error(`walking_wild: column ${c} outside 0..${cols - 1}`);
        let wild = p.wild_symbol as number | null | undefined;
        if (wild === undefined || wild === null) {
          if (firstWild === null) throw new Error('walking_wild: no wilds declared and no wild_symbol given');
          wild = firstWild;
        } else if (!wilds.has(wild)) throw new Error(`walking_wild: wild_symbol ${wild} is not a declared wild`);
        const w = wild;
        const outcomes = placement.values.map((j, k) => ({
          p: placement.probs[k],
          map: { label: `walker on reel ${j}`, fn: (c: number, win: number[]) => (c === j ? win.map(() => w) : win) },
        }));
        transforms.push({ kind: 'mixture', label: `walking_wild: mixture over ${outcomes.length} walker columns`, outcomes });
        labels.push(`walking_wild: mixture over ${outcomes.length} walker columns (the column becomes wild ${w} before evaluation and the scatter count)`);
      } else if (id === 'expanding_wild') {
        if (p.expand_law !== 'full_column_on_visible_wild') throw new Error(`expanding_wild: unsupported expand_law ${JSON.stringify(p.expand_law)}`);
        if ('badge_pmf' in p) throw new Error('expanding_wild: badge_pmf not executable');
        if (firstWild === null) throw new Error('expanding_wild: no wilds declared');
        if (scatter !== null && wilds.has(scatter)) throw new Error('expanding_wild: scatter id equals a wild id');
        const reels = p.expand_reels as number[] | undefined | null;
        const eligible = new Set<number>(reels == null ? Array.from({ length: cols }, (_, c) => c) : reels);
        const wid = firstWild;
        const fn = (c: number, win: number[]) => (eligible.has(c) && win.some((v) => wilds.has(v)) ? win.map(() => wid) : win);
        transforms.push({ kind: 'local', label: 'expanding_wild', map: { label: 'expanding_wild', fn } });
        labels.push(`expanding_wild: per-reel window map (a visible wild fills its eligible reel ${JSON.stringify([...eligible].sort((a, b) => a - b))})`);
      } else if (id === 'mystery_reveal') {
        const mid = pyInt(p.mystery_symbol);
        if (mid === null) throw new Error(`mystery_reveal: mystery_symbol ${JSON.stringify(p.mystery_symbol)} must be int-castable`);
        const reveal = intPmf('mystery_reveal: reveal_pmf', p.reveal_pmf, Number.MIN_SAFE_INTEGER);
        const outcomes = reveal.values.map((t, k) => ({
          p: reveal.probs[k],
          map: { label: `mystery -> ${t}`, fn: (_c: number, win: number[]) => (win.includes(mid) ? win.map((v) => (v === mid ? t : v)) : win) },
        }));
        transforms.push({ kind: 'mixture', label: `mystery_reveal: mixture over ${outcomes.length} reveal targets`, outcomes });
        labels.push(`mystery_reveal: mixture over ${outcomes.length} reveal targets (every ${mid} becomes the drawn symbol)`);
      } else if (id === 'global_iid') {
        const pmf = intPmf('global_iid: value_pmf', p.value_pmf, 1);
        const mode = p.apply === undefined ? 'per_spin' : p.apply;
        if (mode !== 'per_spin' && mode !== 'terminal_total') throw new Error(`global_iid: apply ${JSON.stringify(mode)} not in per_spin, terminal_total`);
        const ms = p.min_steps === undefined ? 1 : Number(p.min_steps);
        if (mode === 'terminal_total' && ms > 1)
          throw new Error(`global_iid: terminal gate min_steps=${ms} without a continuation never fires beyond one step (the pack labels it Opaque)`);
        const mean = pmfMean(pmf);
        iid.push({ label: `global_iid: iid multiplier, E[M] = ${+mean.toPrecision(6)}`, pmf, mean });
        labels.push(`global_iid (${mode}): evaluator wins × M, M ~ value_pmf independent of the board, E[M] = ${+mean.toPrecision(6)}; scatter pay never multiplied`);
      } else if (id === 'global_additive') {
        const pmf = intPmf('global_additive: value_pmf', p.value_pmf, 0);
        const base = p.base;
        if (typeof base !== 'number' || !Number.isInteger(base) || base < 0) throw new Error(`global_additive: base must be an int >= 0, got ${JSON.stringify(base)}`);
        if (!wilds.size) throw new Error('global_additive: no wilds declared');
        if (affine !== null) throw new Error('two count factors compose to a product that is quadratic in the counts: no closed form');
        const slope = pmfMean(pmf);
        affine = { label: 'global_additive: base + E[value] * (visible wilds) affine count factor', target: new Set(wilds), base, pmf, slope };
        labels.push(`global_additive: evaluator wins × (${base} + Σ_{visible wilds} V), E[V] = ${+slope.toPrecision(6)}; scatter pay never multiplied`);
      }
    } catch (e) {
      refusals.push((e as Error).message);
    }
  });
  const constFactor = iid.reduce((a, f) => a * f.mean, 1);
  return { transforms, post: { iid, affine, constFactor }, labels, refusals };
}

// --------------------------------------------------------------------------- the components

/** Apply a window map to one reel's catalog: equal images merge, string-sorted (the pack's ReelCatalog). */
export function transformWindows(windows: ReelWindow[], c: number, fn: (c: number, win: number[]) => number[]): ReelWindow[] {
  const acc = new Map<string, ReelWindow>();
  for (const { win, p } of windows) {
    const out = fn(c, win);
    const key = out.join(',');
    const e = acc.get(key);
    if (e) e.p += p;
    else acc.set(key, { win: [...out], p });
  }
  return [...acc.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map((e) => e[1]);
}

/** Number of (reel set × outcome) components the transforms expand to. */
export function expansionSize(nSets: number, transforms: Transform[]): number {
  return transforms.reduce((n, t) => n * (t.kind === 'mixture' ? t.outcomes.length : 1), nSets);
}

/**
 * The reel sets × the cartesian product of the mixtures' outcomes, in record order: each
 * component's windows are transformed by its outcome's maps; `colMap` applies the same maps to a
 * sampled board column (for stop sampling); `weight` = set weight × outcome probability.
 */
export function expandComponents(base: Component[], transforms: Transform[]): Component[] {
  if (!transforms.length) return base;
  let comps = base.map((c) => ({ ...c, maps: [] as WindowMap[], labels: [] as string[] }));
  for (const t of transforms) {
    const next: typeof comps = [];
    const outs = t.kind === 'local' ? [{ p: 1, map: t.map as WindowMap | null }] : t.outcomes;
    for (const comp of comps)
      for (const o of outs) {
        if (!o.p) continue;
        next.push({
          ...comp,
          weight: comp.weight * o.p,
          windows: o.map ? comp.windows.map((w, c) => transformWindows(w, c, o.map!.fn)) : comp.windows,
          maps: o.map ? [...comp.maps, o.map] : comp.maps,
          labels: o.map ? [...comp.labels, o.map.label] : comp.labels,
        });
      }
    comps = next;
  }
  return comps.map(({ maps, labels, ...comp }) => ({
    ...comp,
    label: labels.join(' + '),
    colMap: maps.length
      ? (c: number, col: number[]) => {
          let w = col;
          for (const mp of maps) w = mp.fn(c, w);
          return w;
        }
      : undefined,
  }));
}

// --------------------------------------------------------------------------- the multiplier law

export function hasPost(post: PostLaw): boolean {
  return post.iid.length > 0 || post.affine !== null;
}

function convolvePmf(a: Map<number, number>, b: Pmf, op: (x: number, y: number) => number): Map<number, number> {
  const out = new Map<number, number>();
  for (const [x, px] of a)
    for (let i = 0; i < b.values.length; i++) {
      const v = op(x, b.values[i]);
      out.set(v, (out.get(v) ?? 0) + px * b.probs[i]);
    }
  return out;
}

/**
 * The pmf of the evaluator-coin multiplier on a board with `n` visible affine targets:
 * (base + V_1 + … + V_n) × Π_iid M_j (1 without factors). Memoised per law.
 */
export function multiplierPmf(post: PostLaw, n: number, memo?: Map<number, Map<number, number>>): Map<number, number> {
  const key = post.affine ? n : 0;
  const hit = memo?.get(key);
  if (hit) return hit;
  let d = new Map<number, number>([[post.affine ? post.affine.base : 1, 1]]);
  if (post.affine) for (let i = 0; i < n; i++) d = convolvePmf(d, post.affine.pmf, (x, y) => x + y);
  for (const f of post.iid) d = convolvePmf(d, f.pmf, (x, y) => x * y);
  memo?.set(key, d);
  return d;
}

/** One sampled multiplier (stop-sampling Monte Carlo): u() uniform on [0, 1). */
export function sampleMultiplier(post: PostLaw, n: number, u: () => number): number {
  const draw = (p: Pmf) => {
    let x = u();
    for (let i = 0; i < p.values.length - 1; i++) {
      if (x < p.probs[i]) return p.values[i];
      x -= p.probs[i];
    }
    return p.values[p.values.length - 1];
  };
  let g = post.affine ? post.affine.base : 1;
  if (post.affine) for (let i = 0; i < n; i++) g += draw(post.affine.pmf);
  for (const f of post.iid) g *= draw(f.pmf);
  return g;
}
