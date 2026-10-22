// Patience: cards 1..n are shuffled and dealt one at a time by patience
// sorting. Each card goes onto the leftmost pile whose top card is higher;
// if no top is higher it starts a new pile on the right. The pile tops always
// rise from left to right, and the number of piles at the end equals the
// longest increasing subsequence of the shuffle (Hammersley, Aldous–Diaconis).
// By Robinson–Schensted, the number of shuffles whose longest increasing run is
// ℓ is Σ f_λ² over the shapes λ ⊢ n with first row ℓ (f_λ from the hook length
// formula); "at most 2 piles" is Catalan(n)/n!.
//
// The player bets on the final pile count: at most k ("fit") or at least k
// ("reach"). Piles never close, so "at most k" is lost the moment pile k+1
// opens and "at least k" is won the moment pile k opens.
//
// Live odds, exactly. The future only depends on how the pile tops and the
// cards still in the deck interleave in value order: a word over {t, r} read
// from the lowest value up. A remaining card at an r lands on the first t to
// its right (that top is covered and drops out of the word, the card becomes a
// t); with no t to its right it starts a new pile. Tops below every remaining
// card can never be covered or matter again, so they are stripped. A memoised
// recursion over these words counts, for every j, how many of the m! orders of
// the remaining cards open exactly j more piles. The counts are integers below
// 12! < 2^53, so they are exact in doubles and P(win | state) = wins / m! is
// an exact rational. There is no simulation anywhere.
//
// What is drawn. A remaining card opens a new pile iff it is above the top of
// the rightmost pile (the "top shelf"), so those cards are lit in the deck and
// their count over the cards left is the next card's new-pile chance. Every
// remaining card is also drawn where it would land, as a ring whose green share
// is P(win | that card comes next). The next card is uniform, so the mean of
// the rings is P(win) now (the recursion itself, and a test).
//
// Pricing (fixed prize). The full prize is RTP / P(win at the start) and the
// cash-out in any state is prize × P(win | state). P(win | state) is a
// martingale (the average over the next card), so the cash-out is a
// martingale starting at RTP, and by optional stopping every cash-out rule,
// including "deal all", returns exactly RTP. When the result is certain
// (P = 0 or 1, read from the integer counts, so there is no tie rule to
// argue about) the round is settled at 0 or the prize and the rest is dealt
// for show. The cash-out never exceeds the prize, so maxMultiplier is the
// largest prize on offer.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

/** Deck sizes. More cards, longer rounds. */
export const DECKS = [8, 10, 12] as const;
export type Deck = (typeof DECKS)[number];

/** fit: finish with at most k piles. reach: open at least k piles. */
export type Mode = 'fit' | 'reach';
export const MODES: readonly Mode[] = ['fit', 'reach'];

export interface Bet {
  n: Deck;
  mode: Mode;
  k: number;
}

/** Bets are offered when their win chance lies in this band. */
export const MIN_CHANCE = 1 / 2500;
export const MAX_CHANCE = 0.93;

export interface Deal {
  n: number;
  /** piles[j] lists pile j's cards in the order they were placed; the last is its top. */
  piles: number[][];
  /** Cards still in the deck, ascending. */
  remaining: number[];
  /** links[c] = the top of the pile to the left when c was placed (0 for pile 1): a lower, earlier card. */
  links: number[];
}

export const newDeal = (n: number): Deal => ({
  n,
  piles: [],
  remaining: Array.from({ length: n }, (_, i) => i + 1),
  links: new Array<number>(n + 1).fill(0),
});

export const topsOf = (d: Deal): number[] => d.piles.map((p) => p[p.length - 1]);

/** The top of the rightmost pile (0 before the first card): any card above it opens a new pile. */
export const shelfOf = (d: Deal): number => (d.piles.length ? d.piles[d.piles.length - 1][d.piles[d.piles.length - 1].length - 1] : 0);

/** The pile a card goes on: the leftmost whose top is higher, else a new one (index = pile count). */
export function landing(tops: readonly number[], card: number): number {
  for (let j = 0; j < tops.length; j++) if (tops[j] > card) return j;
  return tops.length;
}

/** Deals one card from the deck by the patience rule. */
export function place(d: Deal, card: number): Deal {
  const tops = topsOf(d);
  const j = landing(tops, card);
  const piles = d.piles.map((p, i) => (i === j ? [...p, card] : p));
  if (j === d.piles.length) piles.push([card]);
  const links = d.links.slice();
  links[card] = j > 0 ? tops[j - 1] : 0;
  return {
    n: d.n,
    piles,
    remaining: d.remaining.filter((c) => c !== card),
    links,
  };
}

/**
 * A longest increasing run of the cards dealt so far, one card per pile: start
 * from the top of the last pile and follow the links back (each link is lower
 * and was dealt earlier). Its length is the pile count.
 */
export function risingRun(d: Deal): number[] {
  const run: number[] = [];
  for (let c = shelfOf(d); c > 0; c = d.links[c]) run.unshift(c);
  return run;
}

/** Cards still in the deck that would open a new pile if dealt next. */
export const newPileCards = (d: Deal): number[] => {
  const s = shelfOf(d);
  return d.remaining.filter((c) => c > s);
};

// ---------- Exact counting ----------

const memo = new Map<string, number[]>();

/** counts[j] = number of orders of the r's that open exactly j new piles. */
function countWord(word: string): number[] {
  let s = 0;
  while (s < word.length && word[s] === 't') s++;
  const w = s ? word.slice(s) : word;
  const hit = memo.get(w);
  if (hit) return hit;
  const out: number[] = [];
  let any = false;
  for (let i = 0; i < w.length; i++) {
    if (w[i] !== 'r') continue;
    any = true;
    const k = w.indexOf('t', i + 1);
    const next = k < 0 ? w.slice(0, i) + 't' + w.slice(i + 1) : w.slice(0, i) + 't' + w.slice(i + 1, k) + w.slice(k + 1);
    const add = k < 0 ? 1 : 0;
    const sub = countWord(next);
    for (let j = 0; j < sub.length; j++) out[j + add] = (out[j + add] ?? 0) + sub[j];
  }
  const res = any ? Array.from(out, (x) => x ?? 0) : [1];
  memo.set(w, res);
  return res;
}

/** The interleaving of pile tops (t) and deck cards (r), lowest value first. */
export function wordOf(d: Deal): string {
  const tops = new Set(topsOf(d));
  const rem = new Set(d.remaining);
  let w = '';
  for (let v = 1; v <= d.n; v++) w += tops.has(v) ? 't' : rem.has(v) ? 'r' : '';
  return w;
}

/** finalCounts[f] = number of orders of the remaining cards that end with exactly f piles. */
export function finalCounts(d: Deal): number[] {
  const future = countWord(wordOf(d));
  const out = new Array<number>(d.piles.length + future.length).fill(0);
  future.forEach((c, j) => (out[d.piles.length + j] = c));
  return out;
}

export const factorial = (m: number) => {
  let f = 1;
  for (let i = 2; i <= m; i++) f *= i;
  return f;
};

/** Whether a final pile count wins the bet. */
export const winsAt = (bet: Bet, piles: number) => (bet.mode === 'fit' ? piles <= bet.k : piles >= bet.k);

/** Exact win count over the m! equally likely orders of the remaining cards. */
export function winCount(bet: Bet, d: Deal): { win: number; total: number } {
  const counts = finalCounts(d);
  let win = 0;
  let total = 0;
  counts.forEach((c, f) => {
    total += c;
    if (winsAt(bet, f)) win += c;
  });
  return { win, total };
}

export function winChance(bet: Bet, d: Deal): number {
  const { win, total } = winCount(bet, d);
  return win / total;
}

/** 'won' / 'lost' once no order of the remaining cards can change the result. */
export function decided(bet: Bet, d: Deal): 'won' | 'lost' | null {
  const { win, total } = winCount(bet, d);
  return win === 0 ? 'lost' : win === total ? 'won' : null;
}

/** The round's natural end: the deciding pile opened, or the deck ran out. */
export function ended(bet: Bet, d: Deal): boolean {
  if (d.remaining.length === 0) return true;
  return bet.mode === 'fit' ? d.piles.length > bet.k : d.piles.length >= bet.k;
}

const startCache = new Map<string, number>();
/** Chance to win before the first card. */
export function startChance(bet: Bet): number {
  const key = `${bet.n}/${bet.mode}/${bet.k}`;
  let p = startCache.get(key);
  if (p === undefined) startCache.set(key, (p = winChance(bet, newDeal(bet.n))));
  return p;
}

export const prizeFor = (bet: Bet) => RTP / startChance(bet);

/** Cash-out multiplier: prize × P(win | state). */
export const cashValue = (bet: Bet, d: Deal) => prizeFor(bet) * winChance(bet, d);

/** Pile limits offered for a deck and mode (win chance inside [MIN_CHANCE, MAX_CHANCE]). */
export function kOptions(n: Deck, mode: Mode): number[] {
  const out: number[] = [];
  for (let k = 2; k <= n; k++) {
    const p = startChance({ n, mode, k });
    if (p >= MIN_CHANCE && p <= MAX_CHANCE) out.push(k);
  }
  return out;
}

/** The nearest offered limit to k. */
export function clampK(n: Deck, mode: Mode, k: number): number {
  const opts = kOptions(n, mode);
  return opts.reduce((best, x) => (Math.abs(x - k) < Math.abs(best - k) ? x : best), opts[0]);
}

export function volatilityOf(bet: Bet): Volatility {
  const p = startChance(bet);
  return p >= 0.5 ? 'low' : p >= 0.15 ? 'medium' : p >= 0.02 ? 'high' : 'extreme';
}

/** Board columns: k allowed piles plus the red overflow pile, or k piles with the goal last. */
export const columnsFor = (bet: Bet) => (bet.mode === 'fit' ? bet.k + 1 : bet.k);

/**
 * Chance the deal ends with each column as its last pile (index = column).
 * The last column collects everything from there up: "k+1 or more" for fit,
 * "k or more" for reach. The win columns sum to the win chance.
 */
export function forecast(bet: Bet, d: Deal): number[] {
  const counts = finalCounts(d);
  const total = counts.reduce((a, b) => a + b, 0);
  const cols = columnsFor(bet);
  const out = new Array<number>(cols).fill(0);
  counts.forEach((c, f) => {
    if (f >= 1) out[Math.min(f, cols) - 1] += c / total;
  });
  return out;
}

export interface Ghost {
  card: number;
  /** The pile it would go on if dealt next. */
  pile: number;
  /** It would open a new pile. */
  opens: boolean;
  /** P(win) if this card comes next. */
  chance: number;
}

/** Every card left, where it would land, and the win chance if it comes next. */
export function ghosts(bet: Bet, d: Deal): Ghost[] {
  const tops = topsOf(d);
  return d.remaining.map((card) => {
    const pile = landing(tops, card);
    return {
      card,
      pile,
      opens: pile === tops.length,
      chance: winChance(bet, place(d, card)),
    };
  });
}

// ---------- Settings ----------

export const DEFAULT_BET: Bet = { n: 10, mode: 'fit', k: 4 };

export const VOLATILITY: Record<Volatility, Bet> = {
  low: { n: 10, mode: 'fit', k: 5 },
  medium: { n: 12, mode: 'reach', k: 6 },
  high: { n: 12, mode: 'fit', k: 3 },
  extreme: { n: 10, mode: 'reach', k: 7 },
};

/** Every bet the panel offers. */
export const ALL_BETS: Bet[] = DECKS.flatMap((n) => MODES.flatMap((mode) => kOptions(n, mode).map((k) => ({ n, mode, k }))));

/** The largest prize on offer; no cash-out can exceed its round's prize. */
export const MAX_MULTIPLIER = Math.max(...ALL_BETS.map(prizeFor));
