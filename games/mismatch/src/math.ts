// Mismatch: n coloured slots sit on a ring and n matching tokens sit in a bag.
// Tokens are drawn one at a time, uniformly from the bag, into empty slots. A
// token that lands in its own slot is a *match*. The player bets on the final
// number of matches (none, exactly one, two or more, …).
//
// The finished board is a uniformly random permutation and the matches are its
// fixed points. Derangements: the chance of no match at all is
//   D(n)/n! = Σ_{i=0..n} (−1)^i / i!  →  1/e ≈ 36.79%,
// and exactly k matches happen with chance C(n, k)·D(n−k)/n! → e^{−1}/k!
// (Poisson(1) in the limit, so the average number of matches is exactly 1).
//
// Live odds. Mid-round the state that matters is a tally (r, a, m):
//   r = empty slots = tokens still in the bag,
//   a = "open" empty slots whose own token is still in the bag,
//   m = matches so far.
// An empty slot whose token has already been placed elsewhere can never match.
// The rest of the deal is a uniform bijection from the r bag tokens to the r
// empty slots, and only the a open slots can match, so by inclusion–exclusion
// the number of completions with exactly j more matches is
//   N(r, a, j) = Σ_{s=j..a} (−1)^{s−j} C(s, j) C(a, s) (r−s)!,
// an exact integer (r ≤ 12, so every term is far below 2^53). The win chance
// is P(win | r, a, m) = Σ_{j : m+j wins} N(r, a, j) / r!. The round ends the
// moment that count is 0 or r! (an exact integer test, no float ties).
//
// The next draw into an open slot matches with chance 1/r: its own token is
// one of the r tokens in the bag (drawn as one of r equal sectors of the bag
// wheel). A slot whose token is gone matches with chance 0.
//
// Pricing (fixed prize). prize = RTP / P(win) is locked at the bet and
// cash-out = prize × P(win | r, a, m). P(win | state) is the conditional
// probability of one fixed event given everything revealed, and each draw is
// uniform over the bag whichever empty slot the player fills, so
// E[P after the draw] = P before for every slot choice (tested exactly via
// the one-step recursion below). The cash-out is therefore a martingale that
// starts at RTP: by optional stopping every cash-out rule and every slot
// order returns exactly RTP. Choosing a slot changes the risk of the next draw,
// never the value of the round. The cash-out never exceeds the prize, so the
// largest payout is the largest prize on offer (MAX_MULTIPLIER).

import type { Rng, Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

/** Slots on the ring (and tokens in the bag). */
export const SIZES = [5, 8, 12] as const;
export type Size = (typeof SIZES)[number];

export type BetId = 'none' | 'one' | 'atMost1' | 'some' | 'two' | 'three' | 'four' | 'five';

export interface BetDef {
  id: BetId;
  /** Chip label. */
  chip: string;
  /** Full name, e.g. "No matches". */
  name: string;
  /** Short phrase for captions: "finish with …". */
  phrase: string;
  /** Whether a final match count wins. */
  wins(k: number): boolean;
  /** The finish strip groups counts from here up as "tail+". */
  tail: number;
}

export const BETS: readonly BetDef[] = [
  { id: 'none', chip: '0', name: 'No matches', phrase: 'no matches', wins: (k) => k === 0, tail: 3 },
  { id: 'one', chip: '1', name: 'Exactly 1 match', phrase: 'exactly 1 match', wins: (k) => k === 1, tail: 3 },
  { id: 'atMost1', chip: '≤ 1', name: 'At most 1 match', phrase: 'at most 1 match', wins: (k) => k <= 1, tail: 3 },
  { id: 'some', chip: '1+', name: '1 or more matches', phrase: '1 or more matches', wins: (k) => k >= 1, tail: 3 },
  { id: 'two', chip: '2+', name: '2 or more matches', phrase: '2 or more matches', wins: (k) => k >= 2, tail: 3 },
  { id: 'three', chip: '3+', name: '3 or more matches', phrase: '3 or more matches', wins: (k) => k >= 3, tail: 3 },
  { id: 'four', chip: '4+', name: '4 or more matches', phrase: '4 or more matches', wins: (k) => k >= 4, tail: 4 },
  { id: 'five', chip: '5+', name: '5 or more matches', phrase: '5 or more matches', wins: (k) => k >= 5, tail: 5 },
];

export const betDef = (id: BetId) => BETS.find((b) => b.id === id)!;

export const VOLATILITY: Record<Volatility, { n: Size; bet: BetId }> = {
  low: { n: 8, bet: 'atMost1' },
  medium: { n: 8, bet: 'none' },
  high: { n: 12, bet: 'three' },
  extreme: { n: 12, bet: 'five' },
};

// ---------- Exact counting ----------

const FACT: number[] = [1];
for (let i = 1; i <= 12; i++) FACT[i] = FACT[i - 1] * i;

/** k! as an exact integer (k ≤ 12). */
export const factorial = (k: number) => FACT[k];

export function binom(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let c = 1;
  for (let i = 1; i <= k; i++) c = (c * (n - k + i)) / i;
  return Math.round(c);
}

const completionCache = new Map<number, number[]>();

/**
 * completions(r, a)[j] = number of ways to deal the r bag tokens into the r
 * empty slots with exactly j new matches, when a of those slots are open.
 * Exact integers; they sum to r!.
 */
export function completions(r: number, a: number): number[] {
  const key = r * 64 + a;
  const hit = completionCache.get(key);
  if (hit) return hit;
  const out: number[] = [];
  for (let j = 0; j <= a; j++) {
    let c = 0;
    for (let s = j; s <= a; s++) c += ((s - j) % 2 ? -1 : 1) * binom(s, j) * binom(a, s) * FACT[r - s];
    out.push(c);
  }
  completionCache.set(key, out);
  return out;
}

/** Derangements D(n): permutations with no fixed point. */
export const derangements = (n: number) => completions(n, n)[0];

/** Chance that a random permutation of n has exactly k fixed points: C(n, k)·D(n−k)/n!. */
export const exactlyChance = (n: number, k: number) => (k < 0 || k > n ? 0 : (binom(n, k) * derangements(n - k)) / FACT[n]);

// ---------- Board state ----------

/** placed[slot] = the token in that slot, or null while it is empty. Slot i's own token is token i. */
export type Placed = readonly (number | null)[];

export interface Tally {
  /** Empty slots (= tokens left in the bag). */
  r: number;
  /** Empty slots whose own token is still in the bag: the only ones that can still match. */
  a: number;
  /** Matches so far. */
  m: number;
}

export const emptyBoard = (n: number): Placed => Array.from({ length: n }, () => null);

export function tally(placed: Placed): Tally {
  const used = new Set<number>();
  for (const t of placed) if (t !== null) used.add(t);
  let r = 0;
  let a = 0;
  let m = 0;
  placed.forEach((t, i) => {
    if (t === null) {
      r++;
      if (!used.has(i)) a++;
    } else if (t === i) m++;
  });
  return { r, a, m };
}

/** Number of completions (out of r!) that finish inside the bet. */
export function winCount(bet: BetDef, { r, a, m }: Tally): number {
  const c = completions(r, a);
  let w = 0;
  for (let j = 0; j < c.length; j++) if (bet.wins(m + j)) w += c[j];
  return w;
}

/** Exact chance the bet wins from this tally. */
export const winChance = (bet: BetDef, t: Tally) => winCount(bet, t) / FACT[t.r];

/** 'won' / 'lost' once the outcome is certain (exact integer test), else null. */
export function decided(bet: BetDef, t: Tally): 'won' | 'lost' | null {
  const w = winCount(bet, t);
  return w === 0 ? 'lost' : w === FACT[t.r] ? 'won' : null;
}

export const headline = (n: number, bet: BetDef) => winChance(bet, { r: n, a: n, m: 0 });
export const prizeFor = (n: number, bet: BetDef) => RTP / headline(n, bet);

/** The tokens still in the bag, in colour-wheel order. */
export function bag(placed: Placed): number[] {
  const used = new Set<number>();
  for (const t of placed) if (t !== null) used.add(t);
  return placed.map((_, i) => i).filter((i) => !used.has(i));
}

/** Whether an empty slot's own token is still in the bag (so it can still match). */
export const isOpen = (placed: Placed, slot: number) => placed[slot] === null && !placed.includes(slot);

/** Chance the next draw into this slot is a match: 1 in r for an open slot, 0 otherwise. */
export function matchChance(placed: Placed, slot: number): number {
  if (placed[slot] !== null) return 0;
  return isOpen(placed, slot) ? 1 / tally(placed).r : 0;
}

export interface Step {
  /** The tally after the draw. */
  after: Tally;
  /** How many of the r bag tokens lead there. */
  tokens: number;
  kind: 'match' | 'defuse' | 'dud';
}

/**
 * Every way the next draw can go, by token count out of r. Into an open slot:
 * its own token (1, a match), another open slot's token (a − 1, which makes
 * that slot unable to match), or a token whose slot is already filled (r − a).
 * Into a slot that can't match: an open slot's token (a) or a used-up one (r − a).
 */
export function steps({ r, a, m }: Tally, open: boolean): Step[] {
  const out: Step[] = [];
  if (open) {
    out.push({ after: { r: r - 1, a: a - 1, m: m + 1 }, tokens: 1, kind: 'match' });
    if (a > 1) out.push({ after: { r: r - 1, a: a - 2, m }, tokens: a - 1, kind: 'defuse' });
    if (r > a) out.push({ after: { r: r - 1, a: a - 1, m }, tokens: r - a, kind: 'dud' });
  } else {
    if (a > 0) out.push({ after: { r: r - 1, a: a - 1, m }, tokens: a, kind: 'defuse' });
    if (r > a) out.push({ after: { r: r - 1, a, m }, tokens: r - a, kind: 'dud' });
  }
  return out;
}

/** The slot "Draw next" fills: the first empty one clockwise from the top. */
export const nextSlot = (placed: Placed) => placed.findIndex((t) => t === null);

export interface Draw {
  slot: number;
  token: number;
  /** The token's sector in the bag wheel (its index among the bag tokens). */
  sector: number;
  /** Bag size at the draw. */
  of: number;
}

/** Draws a uniformly random bag token into `slot`. */
export function drawInto(placed: Placed, slot: number, rng: Rng): Draw {
  const b = bag(placed);
  const sector = rng.int(b.length);
  return { slot, token: b[sector], sector, of: b.length };
}

export function place(placed: Placed, slot: number, token: number): Placed {
  const next = placed.slice();
  next[slot] = token;
  return next;
}

/** Plays draws in clockwise order until the outcome is certain ("Draw to the end"). */
export function drawToEnd(placed: Placed, bet: BetDef, rng: Rng): Draw[] {
  const out: Draw[] = [];
  let p = placed;
  while (!decided(bet, tally(p))) {
    const d = drawInto(p, nextSlot(p), rng);
    out.push(d);
    p = place(p, d.slot, d.token);
  }
  return out;
}

export interface FinishGroup {
  /** Lowest final count in the group. */
  from: number;
  /** "3+" style when it is the open-ended tail. */
  label: string;
  tail: boolean;
  p: number;
  win: boolean;
}

/**
 * The "where you finish" strip: the final match count if the board were
 * dealt out from here, grouped with the bet's tail. Impossible counts are
 * left out. The win groups' shares add up to winChance exactly.
 */
export function finishGroups(bet: BetDef, t: Tally): FinishGroup[] {
  const c = completions(t.r, t.a);
  const total = FACT[t.r];
  const tail = Math.max(bet.tail, t.m);
  const out: FinishGroup[] = [];
  for (let k = t.m; k < tail; k++) {
    const n = c[k - t.m] ?? 0;
    if (n > 0) out.push({ from: k, label: String(k), tail: false, p: n / total, win: bet.wins(k) });
  }
  let rest = 0;
  for (let j = Math.max(0, tail - t.m); j < c.length; j++) rest += c[j];
  // The tail is a single group only when every count in it agrees with the bet (true for every bet on offer).
  if (rest > 0) out.push({ from: tail, label: `${tail}+`, tail: true, p: rest / total, win: bet.wins(tail) });
  return out;
}

export function volatilityOf(n: number, bet: BetDef): Volatility {
  const p = headline(n, bet);
  return p > 0.5 ? 'low' : p > 0.2 ? 'medium' : p > 0.03 ? 'high' : 'extreme';
}

/** The largest prize on offer: no cash-out can exceed its round's prize. */
export const MAX_MULTIPLIER = Math.max(...SIZES.flatMap((n) => BETS.map((b) => prizeFor(n, b))));
