// Patience: cards 1..10 are shuffled and dealt one at a time by patience
// sorting. Each card goes onto the first pile whose top card is higher; if no
// top is higher it starts a new pile on the right. The player wins if the
// whole deck fits in at most k piles: the round is lost the moment pile k+1
// opens. k is the only setting.
//
// The pile tops always rise from left to right, so "no top is higher" means
// "higher than the top of the last pile" (the shelf). The number of piles at
// the end equals the longest increasing subsequence of the shuffle
// (Hammersley, Aldous–Diaconis). By Robinson–Schensted, the number of
// shuffles whose longest increasing subsequence is ℓ is Σ f_λ² over the
// shapes λ ⊢ n with first row ℓ (f_λ from the hook length formula); "at most
// 2 piles" is Catalan(n)/n!.
//
// Live odds, exactly. The future only depends on how the pile tops and the
// cards still in the deck interleave in value order: a word over {t, r} read
// from the lowest value up. A remaining card at an r lands on the first t to
// its right (that top is covered and drops out of the word, the card becomes a
// t); with no t to its right it starts a new pile. Tops below every remaining
// card can never be covered or matter again, so they are stripped. A memoised
// recursion over these words counts, for every j, how many of the m! orders of
// the remaining cards open exactly j more piles. The counts are integers below
// 10! < 2^53, so they are exact in doubles and P(win | state) = wins / m! is
// an exact rational. There is no simulation anywhere.
//
// What is drawn. The tops rise left to right, so they cut the values 1..n into
// catch bands: pile j catches every value between the previous pile's top and
// its own top (the values it "fits under"), and everything above the last top
// (the shelf) is the red new-pile band. Every card falls in exactly one band
// and lands on that band's pile. A card left in the deck opens a new pile iff
// it is in the red band, so those cards are marked in the deck and counted:
// their count over the cards left is the chance the next card opens a pile.
// A card that lands on the last pile lowers the shelf, so the red band grows
// by every value between the card and the old top: that is why a safe card can
// cut the chance. The shelf only drops until a new pile opens, so if any card
// left is above it another pile is certain.
//
// Pricing (fixed prize). The full prize is RTP / P(win at the start) and the
// cash-out in any state is prize × P(win | state). P(win | state) is a
// martingale (the average over the next card), so the cash-out is a
// martingale starting at RTP, and by optional stopping every cash-out rule,
// including "deal all", returns exactly RTP. When the result is certain
// (P = 0 or 1, read from the integer counts, so there is no tie rule to
// argue about) the round is settled at 0 or the prize and the rest is dealt
// for show. The cash-out never exceeds the prize, so maxMultiplier is the
// largest prize on offer (k = 2).

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

/** Cards in the deck (fixed). */
export const N = 10;

/** The pile limits on offer: win if the deal ends with at most k piles. */
export const K_OPTIONS = [2, 3, 4, 5] as const;

export interface Deal {
  n: number;
  /** piles[j] lists pile j's cards in the order they were placed; the last is its top. */
  piles: number[][];
  /** Cards still in the deck, ascending. */
  remaining: number[];
}

export const newDeal = (n: number = N): Deal => ({
  n,
  piles: [],
  remaining: Array.from({ length: n }, (_, i) => i + 1),
});

export const topsOf = (d: Deal): number[] => d.piles.map((p) => p[p.length - 1]);

/** The top of the last pile (0 before the first card): any card above it opens a new pile. */
export const shelfOf = (d: Deal): number => (d.piles.length ? d.piles[d.piles.length - 1][d.piles[d.piles.length - 1].length - 1] : 0);

/** The pile a card goes on: the first whose top is higher, else a new one (index = pile count). */
export function landing(tops: readonly number[], card: number): number {
  for (let j = 0; j < tops.length; j++) if (tops[j] > card) return j;
  return tops.length;
}

/** Deals one card from the deck by the patience rule. */
export function place(d: Deal, card: number): Deal {
  const j = landing(topsOf(d), card);
  const piles = d.piles.map((p, i) => (i === j ? [...p, card] : p));
  if (j === d.piles.length) piles.push([card]);
  return { n: d.n, piles, remaining: d.remaining.filter((c) => c !== card) };
}

/** The values pile `pile` catches: lo..hi inclusive (empty when lo > hi). pile = piles.length is the new-pile band. */
export interface Band {
  pile: number;
  lo: number;
  hi: number;
}

/** The catch bands, bottom to top: one per pile (values under its top, above the previous top), then the new-pile band. */
export function catchBands(d: Deal): Band[] {
  const tops = topsOf(d);
  const bands = tops.map((t, j) => ({ pile: j, lo: (j ? tops[j - 1] : 0) + 1, hi: t - 1 }));
  bands.push({ pile: tops.length, lo: shelfOf(d) + 1, hi: d.n });
  return bands;
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

/** Exact win count (at most k piles at the end) over the m! equally likely orders of the remaining cards. */
export function winCount(k: number, d: Deal): { win: number; total: number } {
  const counts = finalCounts(d);
  let win = 0;
  let total = 0;
  counts.forEach((c, f) => {
    total += c;
    if (f <= k) win += c;
  });
  return { win, total };
}

export function winChance(k: number, d: Deal): number {
  const { win, total } = winCount(k, d);
  return win / total;
}

/** 'won' / 'lost' once no order of the remaining cards can change the result. */
export function decided(k: number, d: Deal): 'won' | 'lost' | null {
  const { win, total } = winCount(k, d);
  return win === 0 ? 'lost' : win === total ? 'won' : null;
}

/** The round's natural end: pile k+1 opened, or the deck ran out. */
export const ended = (k: number, d: Deal): boolean => d.remaining.length === 0 || d.piles.length > k;

const startCache = new Map<number, number>();
/** Chance to win before the first card. */
export function startChance(k: number): number {
  let p = startCache.get(k);
  if (p === undefined) startCache.set(k, (p = winChance(k, newDeal())));
  return p;
}

export const prizeFor = (k: number) => RTP / startChance(k);

/** Cash-out multiplier: prize × P(win | state). */
export const cashValue = (k: number, d: Deal) => prizeFor(k) * winChance(k, d);

// ---------- Settings ----------

export const DEFAULT_K = 3;

export const VOLATILITY: Record<Volatility, number> = { low: 5, medium: 4, high: 3, extreme: 2 };

export const volatilityOf = (k: number): Volatility => (k >= 5 ? 'low' : k === 4 ? 'medium' : k === 3 ? 'high' : 'extreme');

/** The largest prize on offer; no cash-out can exceed its round's prize. */
export const MAX_MULTIPLIER = Math.max(...K_OPTIONS.map(prizeFor));
