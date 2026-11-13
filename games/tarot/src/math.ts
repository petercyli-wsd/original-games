// Tarot (a three-card spread, rebuilt to match the classic): the middle "core"
// card is drawn from a table that is never below 1x, then the left and right
// "side" cards are drawn from a second, shared table that can show 0x. The
// payout is core x left x right.
//
// Exact RTP. The three cards are independent, so
//
//     E[core x left x right] = E[core] x E[side] x E[side].
//
// Every difficulty's core table has mean exactly 2.00 and its side table mean
// exactly 0.70, so RTP = 2 x 0.70^2 = 0.98 exactly. The published tables are
// used value for value; the tests enumerate all 125 triples per difficulty.
//
// Staged value. After each reveal the round is worth (product shown so far) x
// 0.70^(side cards still hidden): 0.98 before any card, core x 0.49 after the
// core, core x left x 0.70 after the left, the payout after the right. Each
// step multiplies by a card with mean 0.70 (or the core with mean 2.00 from
// 0.98 = 2 x 0.49), so it is an exact martingale. The game has no cash-out, but
// leaving mid-reveal settles the drawn result, so nothing can be dodged.
//
// Reveal order is core, left, right; a 0x left card ends the round at once and
// the right card stays face-down (it is still drawn: a round always takes three
// uniforms, in the order core, left, right).

export const RTP = 0.98;
export const SIDE_MEAN = 0.7;
export const CORE_MEAN = 2;

export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';
export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard', 'expert'];
export const DIFFICULTY_NAMES: Record<Difficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert' };
/** The kit's volatility word for each difficulty. */
export const DIFFICULTY_VOL = { easy: 'low', medium: 'medium', hard: 'high', expert: 'extreme' } as const;

export interface Face {
  value: number;
  /** Exact probability of drawing this face. */
  p: number;
}

export interface Tables {
  core: Face[];
  side: Face[];
}

const f = (pairs: [number, number][]): Face[] => pairs.map(([value, p]) => ({ value, p }));

/** Published tables (value, chance), copied as listed. */
export const TABLES: Record<Difficulty, Tables> = {
  easy: {
    core: f([[1, 0.51], [2, 0.22], [3, 0.1], [4, 0.1], [5, 0.07]]),
    side: f([[0, 0.1], [0.4, 0.6], [1.1, 0.1], [1.5, 0.1], [2, 0.1]]),
  },
  medium: {
    core: f([[1, 0.55], [2, 0.23], [3, 0.13], [5, 0.06], [10, 0.03]]),
    side: f([[0, 0.19], [0.3, 0.5], [0.6, 0.15], [2, 0.09], [4, 0.07]]),
  },
  hard: {
    core: f([[1, 0.6], [2, 0.26], [4, 0.1], [8, 0.03], [24, 0.01]]),
    side: f([[0, 0.26], [0.15, 0.4], [0.55, 0.2], [2, 0.09], [7, 0.05]]),
  },
  expert: {
    core: f([[1, 0.6], [2, 0.3], [5, 0.08], [10, 0.015], [50, 0.005]]),
    side: f([[0, 0.47], [0.15, 0.2], [0.35, 0.2], [3, 0.1], [10, 0.03]]),
  },
};

export const mean = (t: Face[]) => t.reduce((a, c) => a + c.p * c.value, 0);

/** Top prize: top core x top side x top side. */
export const topPrize = (d: Difficulty) => {
  const { core, side } = TABLES[d];
  return core[core.length - 1].value * side[side.length - 1].value ** 2;
};
export const MAX_MULTIPLIER = Math.max(...DIFFICULTIES.map(topPrize));

/** Product of faces rounded down to 6 decimals (every face has at most 2, so this is the exact product). */
export const productOf = (values: number[]) => Math.floor(values.reduce((a, v) => a * v, 1) * 1e6 + 1e-6) / 1e6;

/** Inverse-CDF draw of one face index from a uniform u in [0, 1). */
export function drawIndex(table: Face[], u: number): number {
  let acc = 0;
  for (let i = 0; i < table.length - 1; i++) {
    acc += table[i].p;
    if (u < acc) return i;
  }
  return table.length - 1;
}

export interface Reading {
  /** Face indices: core, left, right. */
  core: number;
  left: number;
  right: number;
  /** Face values in reveal order: core, left, right. */
  values: [number, number, number];
  multiplier: number;
}

/** One round: exactly three uniforms, in the order core, left, right. */
export function playRound(next: () => number, d: Difficulty): Reading {
  const { core, side } = TABLES[d];
  const c = drawIndex(core, next());
  const l = drawIndex(side, next());
  const r = drawIndex(side, next());
  const values: [number, number, number] = [core[c].value, side[l].value, side[r].value];
  return { core: c, left: l, right: r, values, multiplier: productOf(values) };
}

/** Fair value after k cards are face up (reveal order core, left, right): product shown x 0.70^(side cards hidden). */
export function stagedValue(values: readonly number[], k: number): number {
  if (k === 0) return RTP;
  let v = 1;
  for (let i = 0; i < k; i++) v *= values[i];
  return v * SIDE_MEAN ** (3 - k);
}

export interface Outcome {
  multiplier: number;
  p: number;
}

const distCache = new Map<Difficulty, Outcome[]>();

/** The exact payout distribution, by enumerating every triple. */
export function distribution(d: Difficulty): Outcome[] {
  const hit = distCache.get(d);
  if (hit) return hit;
  const { core, side } = TABLES[d];
  const map = new Map<number, number>();
  for (const c of core)
    for (const l of side)
      for (const r of side) {
        const m = productOf([c.value, l.value, r.value]);
        map.set(m, (map.get(m) ?? 0) + c.p * l.p * r.p);
      }
  const out = [...map.entries()].map(([multiplier, p]) => ({ multiplier, p })).sort((x, y) => x.multiplier - y.multiplier);
  distCache.set(d, out);
  return out;
}

export const rtpOf = (d: Difficulty) => distribution(d).reduce((a, o) => a + o.p * o.multiplier, 0);
export const chanceAbove = (d: Difficulty, x: number) => distribution(d).reduce((a, o) => a + (o.multiplier > x + 1e-12 ? o.p : 0), 0);
export const profitChance = (d: Difficulty) => chanceAbove(d, 1);
/** Chance the round returns anything (no 0x side card). */
export const returnChance = (d: Difficulty) => chanceAbove(d, 0);
/** Chance the round pays something, but not more than the stake. */
export const partChance = (d: Difficulty) => returnChance(d) - profitChance(d);

/** Exact chances over what is still hidden, given the cards already turned (a prefix of core, left, right). */
export function chancesGiven(d: Difficulty, revealed: readonly number[]): { profit: number; zero: number } {
  const { core, side } = TABLES[d];
  const lists = [core, side, side];
  const go = (i: number, prod: number): { profit: number; zero: number } => {
    if (i === 3) return { profit: prod > 1 + 1e-9 ? 1 : 0, zero: prod === 0 ? 1 : 0 };
    let profit = 0;
    let zero = 0;
    for (const c of lists[i]) {
      const r = go(i + 1, prod * c.value);
      profit += c.p * r.profit;
      zero += c.p * r.zero;
    }
    return { profit, zero };
  };
  return go(revealed.length, revealed.reduce((a, v) => a * v, 1));
}

/** Exact standard deviation of the payout. */
export function stdDevOf(d: Difficulty) {
  const { core, side } = TABLES[d];
  const m2 = (t: Face[]) => t.reduce((a, c) => a + c.p * c.value * c.value, 0);
  return Math.sqrt(m2(core) * m2(side) ** 2 - RTP ** 2);
}
