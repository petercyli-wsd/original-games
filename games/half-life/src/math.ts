// Half-Life: k unstable atoms (k = 3..7) race to decay. Atom i has half-life
// 60/i lab minutes, so its decay rate is λᵢ = i·ln2/60: atom 1 is the slow,
// heavy one, atom k the jittery one. You back one atom to decay LAST.
//
// Exponential races. Each atom's lifetime is exponential. Among the survivors
// A, the next decay is atom i with chance λᵢ/λ_A (λ_A = Σ_{a∈A} λₐ), and that
// choice is independent of how long the wait takes. Memorylessness: after any
// wait, the survivors are as good as new, so the odds can only move when an
// atom actually decays. Hence P(j last | A) obeys a recursion over subsets,
//   P(j | {j}) = 1,   P(j | A) = Σ_{i∈A, i≠j} (λᵢ/λ_A) · P(j | A∖i),
// which has the closed form (inclusion–exclusion on the other lifetimes)
//   P(j last | A) = Σ_{S ⊆ A∖j} (−1)^|S| · λⱼ / (λⱼ + λ_S).
// Only ratios of rates matter, so the code works with the integer rates 1..k.
// With all seven atoms the 60-min atom is last 52.4% of the time and the
// 8.6-min atom 1.65%: a 32:1 spread, 58.3% to 1.65% (35:1) across all settings.
//
// Pricing (fixed prize). At the bet, prize = RTP / P(j last | all atoms).
// At every checkpoint (after each decay) cash-out = prize × P(j last | A).
// The recursion above says exactly E[cash-out after the next decay] =
// cash-out now (your own atom decaying pays 0), so the cash-out is a
// martingale starting at RTP. By optional stopping, every cash-out rule is
// worth exactly RTP.
//
// Switching (a value-preserving choice). At a checkpoint you may back another
// survivor m instead. The prize re-locks at cash-out / P(m last | A), so the
// cash-out is unchanged at the moment of choosing: switching moves volatility,
// never EV, and the martingale argument still holds for any switching rule.
//
// Max payout. A round pays at most V·∏(factors); maxPayoutFactor() takes the
// best path over every decay order and every switching rule by a DP over
// subsets. It equals 1 / min_j P(j last | all), i.e. switching never beats
// backing the fastest atom from the start: 0.99 × 60.59 ≈ 59.98×.

import type { Rng, Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

/** How many atoms are in the chamber. */
export const COUNTS = [3, 4, 5, 6, 7] as const;
export type Count = (typeof COUNTS)[number];
export const MAX_ATOMS = 7;

/** Atom i (1-based) has half-life 60/i lab minutes: 60, 30, 20, 15, 12, 10, 8.6. */
export const HALF_LIFE_BASE = 60;
export const halfLife = (atom: number) => HALF_LIFE_BASE / atom;
export const halfLifeLabel = (atom: number) => {
  const t = halfLife(atom);
  return Number.isInteger(t) ? String(t) : t.toFixed(1);
};
/** Decay rate per lab minute: ln 2 / half-life. */
export const ratePerMinute = (atom: number) => Math.LN2 / halfLife(atom);

/** Survivors are a bitmask: bit (i − 1) set = atom i still undecayed. */
export const fullMask = (k: number) => (1 << k) - 1;
export const has = (mask: number, atom: number) => ((mask >> (atom - 1)) & 1) === 1;
export const without = (mask: number, atom: number) => mask & ~(1 << (atom - 1));
export function atomsIn(mask: number): number[] {
  const out: number[] = [];
  for (let i = 1; i <= MAX_ATOMS; i++) if (has(mask, i)) out.push(i);
  return out;
}
/** Total decay rate of the survivors, in units of the slowest atom's rate. */
export function totalRate(mask: number): number {
  let s = 0;
  for (let i = 1; i <= MAX_ATOMS; i++) if (has(mask, i)) s += i;
  return s;
}

/** Chance that `atom` is the very next survivor to decay: its share of the total rate. */
export const nextChance = (mask: number, atom: number) => (has(mask, atom) ? atom / totalRate(mask) : 0);

const lastCache = new Map<number, Float64Array>();

/** P(atom i decays last | survivors = mask), indexed by atom (1-based). Exact DP, cached per mask. */
export function lastChances(mask: number): Float64Array {
  let out = lastCache.get(mask);
  if (out) return out;
  out = new Float64Array(MAX_ATOMS + 1);
  const atoms = atomsIn(mask);
  if (atoms.length === 1) out[atoms[0]] = 1;
  else if (atoms.length > 1) {
    const total = totalRate(mask);
    for (const i of atoms) {
      const sub = lastChances(without(mask, i));
      for (const j of atoms) if (j !== i) out[j] += (i / total) * sub[j];
    }
  }
  lastCache.set(mask, out);
  return out;
}

export const lastChance = (mask: number, atom: number) => lastChances(mask)[atom] ?? 0;

/** The same probability by inclusion–exclusion: Σ_{S ⊆ others} (−1)^|S| λⱼ/(λⱼ + λ_S). */
export function lastChanceClosedForm(mask: number, atom: number): number {
  if (!has(mask, atom)) return 0;
  const others = atomsIn(without(mask, atom));
  let p = 0;
  for (let s = 0; s < 1 << others.length; s++) {
    let rate = 0;
    let size = 0;
    others.forEach((o, b) => {
      if ((s >> b) & 1) {
        rate += o;
        size++;
      }
    });
    p += (size % 2 ? -1 : 1) * (atom / (atom + rate));
  }
  return p;
}

/** Headline chance: the backed atom outlives all k − 1 others. */
export const headline = (k: number, atom: number) => lastChance(fullMask(k), atom);
export const prizeFor = (k: number, atom: number) => RTP / headline(k, atom);

export interface Decay {
  /** Which atom decays next. */
  atom: number;
  /** Lab minutes until it does: exponential with the survivors' total rate. */
  dt: number;
}

/**
 * The next decay among the survivors: atom i with chance i / Σ (tie rule: the
 * first atom whose cumulative rate exceeds u·Σ), after an Exp(λ_A) wait.
 */
export function sampleDecay(mask: number, rng: Rng): Decay {
  const atoms = atomsIn(mask);
  const total = totalRate(mask);
  const u = rng.next() * total;
  let acc = 0;
  let atom = atoms[atoms.length - 1];
  for (const i of atoms) {
    acc += i;
    if (u < acc) {
      atom = i;
      break;
    }
  }
  const lambda = (total * Math.LN2) / HALF_LIFE_BASE;
  const dt = -Math.log(1 - rng.next()) / lambda;
  return { atom, dt };
}

export type Settle = 'decayed' | 'last' | null;

export interface AfterDecay {
  mask: number;
  /** The fair cash-out after the decay (the prize on a win, 0 on a bust). */
  cash: number;
  /** 'decayed' = your atom went, 'last' = it is the only one left, null = checkpoint. */
  outcome: Settle;
}

/** Applies a decay to a round backing `backed` with a locked `prize`. */
export function afterDecay(prize: number, mask: number, backed: number, decayed: number): AfterDecay {
  const next = without(mask, decayed);
  if (decayed === backed) return { mask: next, cash: 0, outcome: 'decayed' };
  if (next === 1 << (backed - 1)) return { mask: next, cash: prize, outcome: 'last' };
  return { mask: next, cash: prize * lastChance(next, backed), outcome: null };
}

/** The prize after switching to `atom` at a checkpoint: the cash-out is kept. */
export const switchPrize = (cash: number, mask: number, atom: number) => cash / lastChance(mask, atom);

export function volatilityOf(k: number, atom: number): Volatility {
  const p = headline(k, atom);
  return p > 0.3 ? 'low' : p > 0.1 ? 'medium' : p > 0.03 ? 'high' : 'extreme';
}

/** One setting per volatility level (atoms in the chamber, which one you back). */
export const VOLATILITY: Record<Volatility, { k: Count; atom: number }> = {
  low: { k: 3, atom: 1 },
  medium: { k: 5, atom: 2 },
  high: { k: 6, atom: 4 },
  extreme: { k: 7, atom: 7 },
};

const factorCache = new Map<number, number>();

/**
 * The largest payout per unit of cash-out reachable from a checkpoint with
 * survivors `mask`, over every decay order and every switching rule:
 * G({j}) = 1, G(A) = max over backed j and decaying i ≠ j of
 * P(j | A∖i) / P(j | A) × G(A∖i).
 */
export function maxPayoutFactor(mask: number): number {
  const hit = factorCache.get(mask);
  if (hit !== undefined) return hit;
  const atoms = atomsIn(mask);
  let best = 1;
  if (atoms.length > 1) {
    best = 0;
    const p = lastChances(mask);
    for (const j of atoms) {
      for (const i of atoms) {
        if (i === j) continue;
        const sub = without(mask, i);
        best = Math.max(best, (lastChance(sub, j) / p[j]) * maxPayoutFactor(sub));
      }
    }
  }
  factorCache.set(mask, best);
  return best;
}

/** An honest bound on any payout: RTP × the best factor over every chamber size. */
export const MAX_MULTIPLIER = RTP * Math.max(...COUNTS.map((k) => maxPayoutFactor(fullMask(k))));
