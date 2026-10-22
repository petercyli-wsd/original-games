// Penney: a fair coin is flipped until either your pattern (A) or the house
// pattern (B) shows up as a run of consecutive flips. If yours lands first you
// win the prize; if the house's does, you lose.
//
// The theorem. Penney's game is non-transitive: every pattern of length ≥ 3
// has another that beats it more often than not, even though each run of the
// same length is equally likely at any given place. Conway's leading numbers
// give the exact odds. Write X:Y = Σ 2^(k−1) over every k for which the last k
// coins of X equal the first k coins of Y. Then the odds that B comes first are
//
//     (A:A − A:B) : (B:B − B:A),
//
// valid whenever neither pattern contains the other (the only pairs offered).
//
// Live odds. What matters about the flips so far is the longest tail that is
// still the start of A or of B: a node of the Aho–Corasick automaton of {A, B}.
// There are at most 1 + 4 + 4 nodes, so P(A first | node) is the exact
// solution of a tiny linear system, the absorbing Markov chain
//
//     P(s) = ½·P(s + H) + ½·P(s + T),  P(A landed) = 1,  P(B landed) = 0,
//
// solved by Gaussian elimination and checked against Conway's formula for all
// 2,900 valid pairs. Nodes from which one pattern can no longer land first are
// found by graph reachability, so "decided" is exact, not a float threshold.
//
// Pricing (fixed prize). A win pays prize = RTP / P(A first), and the cash-out
// at node s is prize × P(s). P is harmonic for the coin, as the equation above
// says, so the cash-out is a martingale that starts at RTP: every stopping rule
// returns exactly RTP. When a flip decides the race early (P becomes 0 or 1),
// the round ends at once at that exact value, which is just another stopping
// rule. Choosing the patterns changes the prize and the swings, never the EV.
//
// Max win. If the first |A| flips spell A, then A lands first: B can only
// appear inside those flips if it is a substring of A, which is not allowed.
// So P(A first) ≥ 2^−|A| ≥ 1/32, and no payout can exceed RTP × 32.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

export type Coin = 'H' | 'T';
export const COINS: readonly Coin[] = ['H', 'T'];

export const MIN_LEN = 2;
export const MAX_LEN = 5;

/** Terminal nodes: your pattern landed, or the house's did. */
export const YOURS = '#A';
export const HOUSE = '#B';

/** Honest bound on any payout: P(A first) ≥ 2^−|A| ≥ 2^−MAX_LEN. */
export const MAX_MULTIPLIER = RTP * 2 ** MAX_LEN;

/** Quick picks for the matchup, one per volatility level. */
export const PRESETS = [
  { id: 'favourite', label: 'Favourite', you: 'HTT', house: 'HHHH' },
  { id: 'classic', label: 'Classic', you: 'HTH', house: 'HHT' },
  { id: 'underdog', label: 'Underdog', you: 'HHHH', house: 'HTH' },
  { id: 'longshot', label: 'Long shot', you: 'HHHHH', house: 'TT' },
] as const;
export type PresetId = (typeof PRESETS)[number]['id'];

export const VOLATILITY: Record<Volatility, { you: string; house: string }> = {
  low: PRESETS[0],
  medium: PRESETS[1],
  high: PRESETS[2],
  extreme: PRESETS[3],
};

/** Volatility bands by the starting win chance (a binary bet's std is RTP·√((1−p)/p)). */
export function volatilityOf(p: number): Volatility {
  return p >= 0.6 ? 'low' : p >= 0.3 ? 'medium' : p >= 0.1 ? 'high' : 'extreme';
}

const isPattern = (s: string) => s.length >= MIN_LEN && s.length <= MAX_LEN && /^[HT]+$/.test(s);

/** Why a pair can't be raced, or null if it can. */
export function pairProblem(you: string, house: string): string | null {
  if (!isPattern(you) || !isPattern(house)) return `Patterns need ${MIN_LEN} to ${MAX_LEN} coins.`;
  if (you === house) return 'The two patterns are the same. Change one coin.';
  if (house.includes(you)) return 'Your pattern sits inside the house pattern. Pick patterns where neither contains the other.';
  if (you.includes(house)) return 'The house pattern sits inside yours. Pick patterns where neither contains the other.';
  return null;
}

/** Conway's leading number X:Y = Σ 2^(k−1) over k where X's last k coins equal Y's first k. */
export function leading(x: string, y: string): number {
  let v = 0;
  for (let k = 1; k <= Math.min(x.length, y.length); k++) if (x.endsWith(y.slice(0, k))) v += 2 ** (k - 1);
  return v;
}

/** Conway: P(A before B) = (B:B − B:A) / ((A:A − A:B) + (B:B − B:A)). */
export function conwayChance(you: string, house: string): number {
  const forYou = leading(house, house) - leading(house, you);
  const forHouse = leading(you, you) - leading(you, house);
  return forYou / (forYou + forHouse);
}

/**
 * How many coins of `pattern` the end of `flips` already matches: the longest k
 * such that the flips end with the pattern's first k coins.
 */
export function progress(flips: string, pattern: string): number {
  for (let k = Math.min(pattern.length, flips.length); k > 0; k--) if (flips.endsWith(pattern.slice(0, k))) return k;
  return 0;
}

export interface Race {
  you: string;
  house: string;
  /** Transient nodes: the proper prefixes of either pattern, '' first. */
  nodes: string[];
  /** The node after one more coin (YOURS or HOUSE if a pattern lands). */
  next(node: string, coin: Coin): string;
  /** Exact P(your pattern lands first | node): 1 on YOURS, 0 on HOUSE. */
  chance(node: string): number;
  /** True once one side can no longer land first (P is exactly 0 or 1). */
  decided(node: string): boolean;
  /** Expected flips from node until the race lands or is decided. */
  flipsLeft(node: string): number;
  /** P(your pattern first) before any flip. */
  p0: number;
  /** What a win pays: RTP / p0. */
  prize: number;
}

/** Solves M x = rhs (n ≤ 9) by Gauss–Jordan elimination with partial pivoting. */
function solve(M: number[][], rhs: number[]): number[] {
  const n = rhs.length;
  const A = M.map((row, i) => [...row, rhs[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < n; r++) {
      if (r === c || A[r][c] === 0) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k];
    }
  }
  return A.map((row, i) => row[n] / row[i]);
}

function buildRace(you: string, house: string): Race {
  const problem = pairProblem(you, house);
  if (problem) throw new Error(`${you} vs ${house}: ${problem}`);

  const set = new Set<string>(['']);
  for (const p of [you, house]) for (let k = 1; k < p.length; k++) set.add(p.slice(0, k));
  const nodes = [...set];

  // The automaton: append the coin, check for a landing, else keep the longest
  // tail that is still a prefix of either pattern.
  const step = (node: string, coin: Coin) => {
    const t = node + coin;
    if (t.endsWith(you)) return YOURS;
    if (t.endsWith(house)) return HOUSE;
    for (let k = Math.min(t.length, MAX_LEN - 1); k > 0; k--) {
      const tail = t.slice(t.length - k);
      if (set.has(tail)) return tail;
    }
    return '';
  };
  const edges = new Map(nodes.map((s) => [s, [step(s, 'H'), step(s, 'T')] as const]));

  // Exact reachability: can each terminal still be reached from a node?
  const reaches = (goal: string) => {
    const ok = new Set<string>([goal]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const s of nodes) if (!ok.has(s) && edges.get(s)!.some((t) => ok.has(t))) ok.add(s), (grew = true);
    }
    return ok;
  };
  const canWin = reaches(YOURS);
  const canLose = reaches(HOUSE);
  const isDecided = (s: string) => !canWin.has(s) || !canLose.has(s);
  const fixed = (s: string) => (canWin.has(s) ? 1 : 0); // value of a decided or terminal node

  // Live nodes: solve P(s) − ½ΣP(live next) = ½Σ value(decided next), and the
  // same system for the expected flips until the race lands or is decided.
  const live = nodes.filter((s) => !isDecided(s));
  const index = new Map(live.map((s, i) => [s, i]));
  const M = live.map(() => new Array<number>(live.length).fill(0));
  const pRhs = live.map(() => 0);
  const eRhs = live.map(() => 1);
  live.forEach((s, i) => {
    M[i][i] += 1;
    for (const t of edges.get(s)!) {
      const j = index.get(t);
      if (j === undefined) pRhs[i] += 0.5 * fixed(t);
      else M[i][j] -= 0.5;
    }
  });
  const pLive = live.length ? solve(M, pRhs) : [];
  const eLive = live.length ? solve(M, eRhs) : [];

  const chance = (s: string) => {
    if (s === YOURS) return 1;
    if (s === HOUSE) return 0;
    const i = index.get(s);
    if (i === undefined) {
      if (!set.has(s)) throw new Error(`Unknown node "${s}"`);
      return fixed(s);
    }
    // Clamp float dust; live nodes are strictly inside (0, 1).
    return Math.min(1, Math.max(0, pLive[i]));
  };
  const p0 = chance('');

  return {
    you,
    house,
    nodes,
    next: (s, coin) => {
      const e = edges.get(s);
      if (!e) throw new Error(`No moves from node "${s}"`);
      return e[coin === 'H' ? 0 : 1];
    },
    chance,
    decided: (s) => s === YOURS || s === HOUSE || isDecided(s),
    flipsLeft: (s) => {
      const i = index.get(s);
      return i === undefined ? 0 : eLive[i];
    },
    p0,
    prize: RTP / p0,
  };
}

const cache = new Map<string, Race>();

/** The race between two valid patterns (cached by pair). */
export function race(you: string, house: string): Race {
  const key = `${you}|${house}`;
  let r = cache.get(key);
  if (!r) cache.set(key, (r = buildRace(you, house)));
  return r;
}

/** Cash-out at a node: prize × P(your pattern first | node). */
export const cashAt = (r: Race, node: string) => r.prize * r.chance(node);

/** Whether either side needs just one more coin (a natural place to pause). */
export function onePointAway(r: Race, node: string): boolean {
  return progress(node, r.you) === r.you.length - 1 || progress(node, r.house) === r.house.length - 1;
}

/** Runs a node forward through a string of flips. */
export function walk(r: Race, flips: string, from = ''): string {
  let s = from;
  for (const c of flips) {
    if (s === YOURS || s === HOUSE) break;
    s = r.next(s, c as Coin);
  }
  return s;
}

/** Every valid pair, for the eval and the tests. */
export function allPairs(): { you: string; house: string }[] {
  const pats: string[] = [];
  for (let len = MIN_LEN; len <= MAX_LEN; len++)
    for (let m = 0; m < 1 << len; m++) {
      let s = '';
      for (let i = len - 1; i >= 0; i--) s += (m >> i) & 1 ? 'T' : 'H';
      pats.push(s);
    }
  const out: { you: string; house: string }[] = [];
  for (const you of pats) for (const house of pats) if (!pairProblem(you, house)) out.push({ you, house });
  return out;
}
