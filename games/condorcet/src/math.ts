// Condorcet: three candidates A, B, C and n voters (n odd). Each voter holds
// a uniformly random ranking, one of the 3! = 6 orders, and the ballots are
// counted one at a time. Every ballot moves the three pairwise margins
//   AB = #(A over B) − #(B over A),  BC = …,  CA = …
// by ±1 each, as the vector v(ranking) in BALLOTS. A ranking is transitive,
// so v is never (+,+,+) or (−,−,−): the six vectors are exactly the other
// six sign patterns. With n odd no margin can end at zero, and the final
// signs give one of four results:
//   A wins (beats B and C), B wins, C wins, or a Cycle
//   (A>B>C>A or A<B<C<A: majority preference is not transitive).
// That is the Condorcet paradox. For 3 voters a cycle has chance 1/18; as n
// grows it rises to Guilbaud's limit 1/4 − (3/2π)·arcsin(1/3) ≈ 8.77%.
//
// Exact odds. With r ballots still to count, the remaining ballots add a
// sum S_r of r independent uniform picks from the six vectors. Its law is
// built exactly by convolution (S_r = S_{r−1} + v, each v with weight 1/6)
// and P(result | margins m, r left) = Σ_S P(S_r = S)·[result(m + S)]. No
// sampling anywhere. A result is certain only when every other result has
// exactly zero mass (a sum of no terms), which is the tie rule for floats.
//
// Pricing (fixed prize). You back one result for k elections in a row, all
// with n voters. Per election the result has chance p, so the round wins
// with P₀ = p^k and pays prize = RTP/P₀. In election w (w already won) with
// margins m and r ballots left,
//   P(win | S) = P(result | m, r) · p^(k − w − 1),   cash-out = prize·P(win | S).
// The next ballot is a uniform pick of the six, so P(result | m, r) is the
// plain average of P(result | m + v, r − 1): the cash-out is a martingale
// starting at RTP, and by optional stopping every strategy returns RTP.
// When the backed result becomes impossible the round ends; when it becomes
// certain the election stops counting (the rest cannot matter). Neither
// changes any value. Which result you back is a choice made at the bet, and
// every choice is priced at RTP/P₀, so the choice moves volatility only.

import type { Rng, Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

export type Cand = 'A' | 'B' | 'C';
export type Pick = Cand | 'cycle';
export const CANDS: readonly Cand[] = ['A', 'B', 'C'];
export const PICKS: readonly Pick[] = ['A', 'B', 'C', 'cycle'];
export const PICK_NAME: Record<Pick, string> = { A: 'A wins', B: 'B wins', C: 'C wins', cycle: 'Cycle' };

/** Voters per election. Always odd, so no pairwise margin ends tied. */
export const VOTERS = [5, 9, 15, 25] as const;
export type Voters = (typeof VOTERS)[number];

/** Elections in a row that must all go your way. */
export const ELECTIONS = [1, 2, 3] as const;
export type Elections = (typeof ELECTIONS)[number];

/** Pairwise margins [AB, BC, CA]; positive means the first candidate leads. */
export type Margins = readonly [number, number, number];
export const ZERO: Margins = [0, 0, 0];

/** The six rankings, best first. A ballot is an index into this list. */
export const RANKINGS: readonly (readonly [Cand, Cand, Cand])[] = [
  ['A', 'B', 'C'],
  ['A', 'C', 'B'],
  ['B', 'A', 'C'],
  ['B', 'C', 'A'],
  ['C', 'A', 'B'],
  ['C', 'B', 'A'],
];

/** The pairs behind the three margins, in order. */
export const PAIRS: readonly (readonly [Cand, Cand])[] = [
  ['A', 'B'],
  ['B', 'C'],
  ['C', 'A'],
];

const prefers = (rank: readonly Cand[], x: Cand, y: Cand) => (rank.indexOf(x) < rank.indexOf(y) ? 1 : -1);

/** How a ballot moves the margins. */
export const BALLOTS: readonly Margins[] = RANKINGS.map((rk) => PAIRS.map(([x, y]) => prefers(rk, x, y)) as unknown as Margins);

export const addBallot = (m: Margins, ballot: number): Margins => {
  const v = BALLOTS[ballot];
  return [m[0] + v[0], m[1] + v[1], m[2] + v[2]];
};

/** The result once every margin is non-zero; null while any pair is tied. */
export function resultOf(m: Margins): Pick | null {
  const [ab, bc, ca] = m;
  if (ab === 0 || bc === 0 || ca === 0) return null;
  if (ab > 0 && ca < 0) return 'A';
  if (ab < 0 && bc > 0) return 'B';
  if (bc < 0 && ca > 0) return 'C';
  return 'cycle';
}

/** Who currently leads (a Condorcet winner, a cycle, or null with a tie). */
export const leaderOf = resultOf;

// ---------------------------------------------------------------------------
// Exact law of the sum of r ballots.

interface Law {
  x: Int8Array;
  y: Int8Array;
  z: Int8Array;
  p: Float64Array;
}

const laws: Law[] = [{ x: Int8Array.of(0), y: Int8Array.of(0), z: Int8Array.of(0), p: Float64Array.of(1) }];

function lawOf(r: number): Law {
  for (let k = laws.length; k <= r; k++) {
    const prev = laws[k - 1];
    const acc = new Map<number, number>();
    for (let i = 0; i < prev.p.length; i++) {
      const w = prev.p[i] / 6;
      for (const v of BALLOTS) {
        const key = ((prev.x[i] + v[0] + 64) * 128 + (prev.y[i] + v[1] + 64)) * 128 + (prev.z[i] + v[2] + 64);
        acc.set(key, (acc.get(key) ?? 0) + w);
      }
    }
    const n = acc.size;
    const law: Law = { x: new Int8Array(n), y: new Int8Array(n), z: new Int8Array(n), p: new Float64Array(n) };
    let i = 0;
    for (const [key, p] of acc) {
      law.x[i] = Math.floor(key / 16384) - 64;
      law.y[i] = (Math.floor(key / 128) % 128) - 64;
      law.z[i] = (key % 128) - 64;
      law.p[i] = p;
      i++;
    }
    laws.push(law);
  }
  return laws[r];
}

export type Chances = Record<Pick, number>;

const chanceMemo = new Map<string, Chances>();

/**
 * Exact chance of each final result, from margins m with r ballots left.
 * The final margins must all be odd-sized, i.e. (count so far + r) odd.
 * A result is 1 exactly when every other result has zero mass.
 */
export function finalChances(m: Margins, r: number): Chances {
  const key = `${m[0]},${m[1]},${m[2]}|${r}`;
  const hit = chanceMemo.get(key);
  if (hit) return hit;
  const law = lawOf(r);
  const c: Chances = { A: 0, B: 0, C: 0, cycle: 0 };
  for (let i = 0; i < law.p.length; i++) {
    const res = resultOf([m[0] + law.x[i], m[1] + law.y[i], m[2] + law.z[i]]);
    if (res === null) throw new Error('a final margin is tied: the voter count must be odd');
    c[res] += law.p[i];
  }
  for (const pick of PICKS) if (c[pick] > 0 && PICKS.every((o) => o === pick || c[o] === 0)) c[pick] = 1;
  chanceMemo.set(key, c);
  return c;
}

/** Chance a fresh election of n voters ends with this result. */
export const perElection = (pick: Pick, n: number) => finalChances(ZERO, n)[pick];
export const startChance = (pick: Pick, n: number, k: number) => perElection(pick, n) ** k;
export const prizeFor = (pick: Pick, n: number, k: number) => RTP / startChance(pick, n, k);

export const MAX_MULTIPLIER = Math.max(...PICKS.flatMap((p) => VOTERS.flatMap((n) => ELECTIONS.map((k) => prizeFor(p, n, k)))));

export function volatilityOf(pick: Pick, n: number, k: number): Volatility {
  const p = startChance(pick, n, k);
  return p > 0.2 ? 'low' : p > 0.05 ? 'medium' : p > 0.01 ? 'high' : 'extreme';
}

export const VOLATILITY: Record<Volatility, { pick: Pick; voters: Voters; elections: Elections }> = {
  low: { pick: 'A', voters: 9, elections: 1 },
  medium: { pick: 'cycle', voters: 15, elections: 1 },
  high: { pick: 'B', voters: 9, elections: 3 },
  extreme: { pick: 'cycle', voters: 25, elections: 2 },
};

// ---------------------------------------------------------------------------
// A round: k elections in a row.

export interface Series {
  pick: Pick;
  voters: number;
  elections: number;
  /** Elections already won. */
  won: number;
  /** Ballots counted in the current election. */
  ballots: number[];
  margins: Margins;
  status: 'live' | 'won' | 'lost';
}

export const newSeries = (pick: Pick, voters: number, elections: number): Series => ({
  pick,
  voters,
  elections,
  won: 0,
  ballots: [],
  margins: ZERO,
  status: 'live',
});

/** Chance the current election ends with the backed result. */
export function electionChance(s: Series): number {
  if (s.status !== 'live') return s.status === 'won' ? 1 : 0;
  return finalChances(s.margins, s.voters - s.ballots.length)[s.pick];
}

/** Chance the whole round is won from here. */
export function winChance(s: Series): number {
  if (s.status !== 'live') return s.status === 'won' ? 1 : 0;
  return electionChance(s) * perElection(s.pick, s.voters) ** (s.elections - s.won - 1);
}

export const cashValue = (s: Series) => prizeFor(s.pick, s.voters, s.elections) * winChance(s);

export interface Count {
  ballot: number;
  /** The election as it stands after this ballot (before any reset). */
  ballots: number[];
  margins: Margins;
  /** The election is over: fully counted, decided early, or lost. */
  ended: boolean;
  /** Ballots left uncounted because the result was already certain. */
  skipped: number;
  next: Series;
}

/** Counts one ballot. A decided election stops; a won election starts the next. */
export function count(s: Series, ballot: number): Count {
  if (s.status !== 'live') throw new Error('round is over');
  const ballots = [...s.ballots, ballot];
  const margins = addBallot(s.margins, ballot);
  const left = s.voters - ballots.length;
  const p = finalChances(margins, left)[s.pick];
  if (p === 0) return { ballot, ballots, margins, ended: true, skipped: left, next: { ...s, ballots, margins, status: 'lost' } };
  if (p === 1) {
    const won = s.won + 1;
    const next: Series =
      won >= s.elections ? { ...s, won, ballots, margins, status: 'won' } : { ...s, won, ballots: [], margins: ZERO };
    return { ballot, ballots, margins, ended: true, skipped: left, next };
  }
  return { ballot, ballots, margins, ended: false, skipped: 0, next: { ...s, ballots, margins } };
}

/** 'one' counts a ballot; 'rest' counts until this election is over. */
export type Mode = 'one' | 'rest';

export function plan(s: Series, mode: Mode, rng: Rng): Count[] {
  const out: Count[] = [];
  let cur = s;
  do {
    const c = count(cur, rng.int(6));
    out.push(c);
    cur = c.next;
    if (c.ended) break;
  } while (mode === 'rest');
  return out;
}

/** The current election chance after each of the six possible next ballots (they average to it). */
export const nextChances = (s: Series) => BALLOTS.map((_, b) => finalChances(addBallot(s.margins, b), s.voters - s.ballots.length - 1)[s.pick]);

/** Chance the next ballot ends the round in a loss. */
export const nextLoss = (s: Series) => nextChances(s).filter((p) => p === 0).length / 6;

export interface Segment {
  pick: Pick;
  from: number;
  to: number;
}

/** The odds bar: the unit interval split A | B | C | Cycle in proportion to their chances. */
export function shareBar(c: Chances): Segment[] {
  let at = 0;
  return PICKS.map((pick) => {
    const from = at;
    at += c[pick];
    return { pick, from, to: at };
  });
}
