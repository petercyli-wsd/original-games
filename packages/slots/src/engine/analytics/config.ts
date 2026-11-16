// The game-level slot config: `games/<id>/src/slot.config.json`.
//
// The spec (`slot.spec.json`, game_spec_v2) is the base round. This file declares what the
// spec can't: the feature (free spins on a second, pack-verified spec), the max-win cap, the
// volatility band the theme promises, and the target RTP. `slots:eval` and `slots:tune` read
// it; the runtime (`createSlot`) runs the feature by exactly these rules.
//
// Free-spins rules (the law the algebra in features.ts prices, docs/SLOTS.md §2.5):
// - A base spin whose visible scatter count K reaches `spec.trigger.scatter_min` awards
//   `award(awards, K)` free spins.
// - Each free spin is one ordinary spin of the feature spec (`feature.spec`). Its win is the
//   spin's `totalCoins` (line/ways/count pays + scatter pay) × the spin's multiplier.
// - The feature starts with min(award, maxSpins) spins.
// - Retrigger: a free spin with K scatters adds `award(retrigger, K)` spins (0 when the table
//   is absent or K is below its smallest key), never past `maxSpins` spins in total:
//   it adds min(award, maxSpins − spins awarded so far). It counts as a retrigger (R below)
//   whenever award(retrigger, K) > 0, even when the cap clips the spins it adds to 0.
// - The feature spec has the same `bet.coins` as the base spec (eval checks it).
// - `award(table, K)`: the entry for K, else the entry for the largest key ≤ K, else 0.
// - The multiplier of free spin j (1-based) depends only on j and on R_j, the number of
//   retriggers on spins 1..j−1:
//     constant      → value
//     per_spin      → start + step·(j−1)
//     per_retrigger → start + step·R_j
// - Max win: the round (base spin + its feature) pays at most `maxWinStakes` × stake. A round
//   that reaches the cap ends there and pays the cap.

export type Volatility = 'low' | 'medium' | 'high' | 'extreme';

export type MultiplierSchedule =
  | { kind: 'constant'; value: number }
  | { kind: 'per_spin'; start: number; step: number }
  | { kind: 'per_retrigger'; start: number; step: number };

export interface FreeSpinsConfig {
  kind: 'free_spins';
  /** The feature spin spec (game_spec_v2), relative to `games/<id>/src/`. */
  spec: string;
  /** Scatters on the triggering base spin → free spins awarded, e.g. {"3": 10, "4": 15, "5": 20}. */
  awards: Record<string, number>;
  /** Scatters on a free spin → extra spins. Absent or null: no retrigger. */
  retrigger?: Record<string, number> | null;
  /** Cap on the total number of free spins in one feature (awarded + retriggered). */
  maxSpins: number;
  multiplier: MultiplierSchedule;
  /**
   * Offer a feature buy, priced at E[feature win | natural trigger] ÷ targetRtp (docs/SLOTS.md
   * §2.9). The bought feature is distributed like a natural trigger (K drawn from
   * P(K | K ≥ scatter_min)); it pays the free spins only, not a base spin.
   */
  buy?: boolean;
}

export type FeatureConfig = FreeSpinsConfig;

/**
 * A feature that a spec MECHANIC runs inside one paid spin (hold-and-spin, sticky respins, an
 * expanding-wild respin …), as opposed to free spins on a second spec. Declaring it lets
 * slots:eval report its frequency, share of RTP and average win, and lets the kit name it.
 *
 * The feature's win on a spin is X − B0: the spin's total coins minus what the same initial
 * board pays with the mechanic switched off (the spec without `mechanic`).
 */
export interface ModifierFeatureConfig {
  /** Player-facing name, e.g. "Honey Harvest". */
  name: string;
  /** The spec mechanic id that runs it, e.g. "hold_and_spin_lock_respin". */
  mechanic: string;
  /**
   * How to see that it ran on a spin; any matching signal counts. Default (omitted): a decor key
   * starting with `${mechanic}.` is present on the spin.
   */
  detect?: {
    /** A decor key present on the spin, e.g. "hold_and_spin_lock_respin.respins". */
    decor?: string;
    /** An extras label starting with this text, e.g. "HOLD & SPIN". */
    extraPrefix?: string;
    /** A flag starting with this text. */
    flagPrefix?: string;
    /** At least this many steps (base board + respins / cascades). */
    minSteps?: number;
  };
  /**
   * Optional exact trigger: it runs exactly when the INITIAL board shows at least `minCount` cells
   * of `symbols`. Enables the exact P(trigger) and the trigger-conditional Monte Carlo
   * (RTP = E[B0] exact + P(trigger) exact × E[X − B0 | trigger] by MC over triggering boards only).
   */
  trigger?: { symbols: number[]; minCount: number };
}

export interface SlotConfig {
  feature?: FeatureConfig;
  modifierFeature?: ModifierFeatureConfig;
  /** The max-win cap, in stakes (docs/SLOTS.md §2.7: typically 5,000–25,000). */
  maxWinStakes: number;
  /** The band the theme promises (§3: SD per spin low 2–5, medium 5–10, high 10–20, extreme > 20). */
  volatility: Volatility;
  /** Target RTP as a fraction, e.g. 0.96. */
  targetRtp: number;
}

export const VOLATILITY_BANDS: Record<Volatility, [number, number]> = {
  low: [2, 5],
  medium: [5, 10],
  high: [10, 20],
  extreme: [20, Infinity],
};

/** The award for K scatters: the entry for K, else the largest key ≤ K, else 0. */
export function award(table: Record<string, number> | null | undefined, k: number): number {
  if (!table) return 0;
  let best = -1;
  let val = 0;
  for (const [key, v] of Object.entries(table)) {
    const n = Number(key);
    if (n <= k && n > best) {
      best = n;
      val = v;
    }
  }
  return val;
}

/** The multiplier of free spin `j` (1-based) after `retriggers` retriggers on earlier spins. */
export function multiplierAt(s: MultiplierSchedule, j: number, retriggers: number): number {
  switch (s.kind) {
    case 'constant':
      return s.value;
    case 'per_spin':
      return s.start + s.step * (j - 1);
    case 'per_retrigger':
      return s.start + s.step * retriggers;
  }
}

/** Validate a parsed slot.config.json; returns a list of named problems (empty = valid). */
export function validateSlotConfig(c: unknown): string[] {
  const errs: string[] = [];
  if (!c || typeof c !== 'object') return ['slot.config.json: not an object'];
  const o = c as Record<string, unknown>;
  if (typeof o.maxWinStakes !== 'number' || !(o.maxWinStakes > 0)) errs.push('maxWinStakes must be a positive number');
  if (!['low', 'medium', 'high', 'extreme'].includes(o.volatility as string))
    errs.push("volatility must be 'low' | 'medium' | 'high' | 'extreme'");
  if (typeof o.targetRtp !== 'number' || !(o.targetRtp > 0.5 && o.targetRtp < 1))
    errs.push('targetRtp must be a fraction in (0.5, 1)');
  if (o.modifierFeature !== undefined) {
    const mf = o.modifierFeature as Record<string, unknown>;
    if (!mf || typeof mf.name !== 'string' || !mf.name) errs.push('modifierFeature.name must be a non-empty string');
    if (!mf || typeof mf.mechanic !== 'string' || !mf.mechanic) errs.push('modifierFeature.mechanic must be the mechanic id');
    const t = mf?.trigger as Record<string, unknown> | undefined;
    if (t !== undefined && !(Array.isArray(t.symbols) && t.symbols.every((s) => Number.isInteger(s)) && Number.isInteger(t.minCount) && (t.minCount as number) >= 1))
      errs.push('modifierFeature.trigger must be { symbols: int[], minCount: int ≥ 1 }');
  }
  if (o.feature !== undefined) {
    const f = o.feature as Record<string, unknown>;
    if (!f || f.kind !== 'free_spins') errs.push("feature.kind must be 'free_spins'");
    else {
      if (typeof f.spec !== 'string') errs.push('feature.spec must be a path string');
      const tableOk = (t: unknown) =>
        !!t && typeof t === 'object' &&
        Object.entries(t as object).every(([k, v]) => Number.isInteger(Number(k)) && Number.isInteger(v) && (v as number) >= 0);
      if (!tableOk(f.awards)) errs.push('feature.awards must map scatter counts to integer spins');
      if (f.retrigger != null && !tableOk(f.retrigger)) errs.push('feature.retrigger must map scatter counts to integer spins');
      if (!Number.isInteger(f.maxSpins) || (f.maxSpins as number) < 1) errs.push('feature.maxSpins must be a positive integer');
      const m = f.multiplier as Record<string, unknown> | undefined;
      if (!m) errs.push('feature.multiplier is required');
      else if (m.kind === 'constant') {
        if (typeof m.value !== 'number' || m.value < 0) errs.push('feature.multiplier.value must be a number ≥ 0');
      } else if (m.kind === 'per_spin' || m.kind === 'per_retrigger') {
        if (typeof m.start !== 'number' || typeof m.step !== 'number' || m.start < 0 || m.step < 0)
          errs.push('feature.multiplier needs numeric start ≥ 0 and step ≥ 0');
      } else errs.push("feature.multiplier.kind must be 'constant' | 'per_spin' | 'per_retrigger'");
    }
  }
  return errs;
}
