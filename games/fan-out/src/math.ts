// Fan Out: the card game Sevens (Fan Tan), cut down. Four suits of ranks 1-7
// are a 4 x 7 grid; the four 4s start laid, and the other 24 cards are the
// deck, turned in a uniformly random order. A turned card is LAID when its
// rank is next to an end of its suit's laid row; any other card BURNS a fuse.
// Three fuses: win by laying k cards before the third burns.
//
// A burned card is out of the deck for good, so its suit's row can never grow
// past it: every empty slot beyond it is dead (grey) and will burn a fuse
// whenever it is turned.
//
// State. Each suit has two sides (below and above the 4), 8 in all, each three
// cards long. A side is described by (l, d):
//   l = live cards in the deck: the run next to the laid end, up to the first
//       burned card. The first of them is the glowing slot (it can be laid now);
//   d = dead cards in the deck: those beyond a burned card.
// The deck holds m = sum of (l + d) cards, each equally likely to be turned next.
// The next card is laid with chance (sides with l >= 1) / m: glowing slots over
// empty slots, a literal count on the board. Turning
//   - a glowing card lays it:           (l, d) -> (l - 1, d);
//   - the i-th live card, i >= 2:       burns, the cards beyond it die:
//                                        (l, d) -> (i - 1, d + l - i);
//   - a dead card:                      burns, (l, d) -> (l, d - 1).
// With t cards still to lay and f fuses left, the exact win chance is
//   P(0, f, S) = 1;  P(t, 0, S) = 0;
//   P(t, f, S) = (1/m) * [ sum over sides with l >= 1 of P(t-1, f, lay)
//                        + sum over every other card of P(t, f-1, burn) ].
// It is memoised on the sorted multiset of sides (at most 10^8/8! states, in
// practice a few thousand reachable ones).
//
// Pricing (fixed prize): prize = RTP / P0(k); cash-out(S) = prize * P(S). The
// recursion says E[P after the next card | now] = P now, so the cash-out is a
// martingale starting at RTP; by optional stopping every cash-out rule returns
// exactly RTP. Checked in math.test.ts: every laid card raises the chance and
// every burned card lowers it, and no live state is certain or dead, so no round
// ends on a computed state: only on the k-th laid card or the third fuse.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;
export const FUSES = 3;
export const SUITS = 4;
export const RANKS = 7;
export const MID = 4; // the rank that starts laid in every suit
export const CARDS = SUITS * RANKS;
export const DECK = CARDS - SUITS;

/** Cards to lay. */
export const TARGETS = [1, 2, 3, 5, 8] as const;
export type Target = (typeof TARGETS)[number];

export const VOLATILITY: Record<Volatility, Target> = { low: 1, medium: 3, high: 5, extreme: 8 };

export const SUIT_NAMES = ['Hearts', 'Spades', 'Diamonds', 'Clubs'] as const;
export const cardId = (suit: number, rank: number) => suit * RANKS + (rank - 1);
export const suitOf = (c: number) => Math.floor(c / RANKS);
export const rankOf = (c: number) => (c % RANKS) + 1;
export const cardName = (c: number) => `${SUIT_NAMES[suitOf(c)]} ${rankOf(c)}`;
export const bit = (c: number) => 2 ** c; // 28 bits: safe as a number
export const has = (mask: number, c: number) => Math.floor(mask / 2 ** c) % 2 === 1;
export const popcount = (mask: number) => {
  let n = 0;
  for (let c = 0; c < CARDS; c++) if (has(mask, c)) n++;
  return n;
};

/** The four 4s: laid before the first turn. */
export const START_LAID = [0, 1, 2, 3].reduce((m, s) => m + bit(cardId(s, MID)), 0);

/** The state of a round: cards laid (the 4s included) and cards burned. */
export interface State {
  laid: number;
  burned: number;
}
export const startState = (): State => ({ laid: START_LAID, burned: 0 });

export const inDeck = (s: State, c: number) => !has(s.laid, c) && !has(s.burned, c);
export const deckOf = (s: State): number[] => Array.from({ length: CARDS }, (_, c) => c).filter((c) => inDeck(s, c));
export const laidCount = (s: State) => popcount(s.laid) - SUITS;
export const burnCount = (s: State) => popcount(s.burned);

export interface Side {
  suit: number;
  dir: -1 | 1;
  /** Live cards in the deck, nearest the laid end first; the first one glows. */
  live: number[];
  /** Cards in the deck beyond a burned card: they can never be laid. */
  dead: number[];
}

/** The 8 sides of the grid for a state. */
export function sidesOf(s: State): Side[] {
  const out: Side[] = [];
  for (let suit = 0; suit < SUITS; suit++) {
    for (const dir of [-1, 1] as const) {
      const live: number[] = [];
      const dead: number[] = [];
      let alive = true; // no burned card met yet on the way out
      let laying = true; // still inside the laid run
      for (let p = 1; p <= 3; p++) {
        const c = cardId(suit, MID + dir * p);
        if (laying && has(s.laid, c)) continue;
        laying = false;
        if (has(s.burned, c)) {
          alive = false;
          continue;
        }
        (alive ? live : dead).push(c);
      }
      out.push({ suit, dir, live, dead });
    }
  }
  return out;
}

type LD = readonly [number, number];
const keyOf = (t: number, f: number, sides: readonly LD[]) =>
  `${t}|${f}|${sides
    .map(([l, d]) => l * 4 + d)
    .sort((a, b) => a - b)
    .join(',')}`;
const MEMO = new Map<string, number>();

function solve(t: number, f: number, sides: readonly LD[]): number {
  if (t <= 0) return 1;
  if (f <= 0) return 0;
  let m = 0;
  for (const [l, d] of sides) m += l + d;
  if (m === 0) return 0;
  const key = keyOf(t, f, sides);
  const hit = MEMO.get(key);
  if (hit !== undefined) return hit;
  let sum = 0;
  const next = sides.slice();
  for (let i = 0; i < sides.length; i++) {
    const [l, d] = sides[i];
    if (l >= 1) {
      next[i] = [l - 1, d];
      sum += solve(t - 1, f, next);
      for (let j = 2; j <= l; j++) {
        next[i] = [j - 1, d + l - j];
        sum += solve(t, f - 1, next);
      }
    }
    if (d >= 1) {
      next[i] = [l, d - 1];
      sum += d * solve(t, f - 1, next);
    }
    next[i] = [l, d];
  }
  const p = sum / m;
  MEMO.set(key, p);
  return p;
}

const toLD = (s: State): LD[] => sidesOf(s).map((x) => [x.live.length, x.dead.length] as const);

/** Exact P(lay k cards before the third fuse | state). */
export function winChance(k: number, s: State): number {
  return solve(k - laidCount(s), FUSES - burnCount(s), toLD(s));
}

export const startChance = (k: number) => winChance(k, startState());
export const prizeFor = (k: number) => RTP / startChance(k);
export const cashOutFor = (k: number, s: State) => prizeFor(k) * winChance(k, s);
export const MAX_MULTIPLIER = prizeFor(Math.max(...TARGETS));

export interface Glow {
  /** Slots that would be laid now: the first live card of each side. */
  lay: number[];
  /** Empty slots that can never be laid. */
  dead: number[];
  /** Empty slots in the deck (all of them). */
  left: number;
}

export function glowOf(s: State): Glow {
  const sides = sidesOf(s);
  return {
    lay: sides.filter((x) => x.live.length > 0).map((x) => x.live[0]),
    dead: sides.flatMap((x) => x.dead),
    left: deckOf(s).length,
  };
}

/** What turning card c does: lays it (a glowing slot) or burns a fuse. */
export const lays = (s: State, c: number) => glowOf(s).lay.includes(c);

export function apply(s: State, c: number): { state: State; laid: boolean } {
  return lays(s, c) ? { state: { ...s, laid: s.laid + bit(c) }, laid: true } : { state: { ...s, burned: s.burned + bit(c) }, laid: false };
}

/** Slots that turn grey because of burning card c (they were live before, dead after). */
export function newlyDead(before: State, c: number): number[] {
  const was = new Set(glowOf(before).dead);
  const after = apply(before, c).state;
  return glowOf(after).dead.filter((x) => !was.has(x));
}

/** Turns the next card from a uniform u in [0, 1): the floor(u*m)-th card left in grid order. */
export function drawCard(u: number, s: State): number {
  const left = deckOf(s);
  return left[Math.min(left.length - 1, Math.floor(u * left.length))];
}

export function volatilityOf(k: number): Volatility {
  const p = startChance(k);
  return p > 0.5 ? 'low' : p > 0.15 ? 'medium' : p > 0.03 ? 'high' : 'extreme';
}

/** Outcome of the round after the state changed, or null while it is undecided. */
export function verdict(k: number, s: State): 'won' | 'lost' | null {
  if (laidCount(s) >= k) return 'won';
  if (burnCount(s) >= FUSES) return 'lost';
  return null;
}
