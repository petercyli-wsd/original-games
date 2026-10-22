// Diamonds (the Stake format): five gems drop, each one of 7 colours drawn
// independently and uniformly. The colour pattern is read like a poker hand
// (no pair, pair, two pair, three of a kind, full house, four, five of a kind)
// and the hand pays a fixed multiplier from the chosen risk table.
//
// Exact odds. There are 7^5 = 16,807 equally likely colour sequences. Counting
// them by pattern (choose the colours, then the positions):
//
//   five of a kind   7                        =      7
//   four of a kind   7·6·C(5,4)               =    210
//   full house       7·6·C(5,3)               =    420
//   three of a kind  7·C(6,2)·5!/(3!1!1!)     =  2,100
//   two pair         C(7,2)·5·5!/(2!2!1!)     =  3,150
//   one pair         7·C(6,3)·5!/(2!1!1!1!)   =  8,400
//   no pair          7·6·5·4·3                =  2,520
//                                       total = 16,807
//
// RTP(table) = Σ count(hand)·pay(hand) / 16,807. Payouts are whole cents, so
// the RTP is a ratio of integers and is checked exactly: every risk table pays
// Σ count·cents = 1,647,086 = 98 · 16,807, i.e. RTP = 98% exactly.
//
// The familiar table (0, 0.10, 2, 3, 4, 5, 50) returns 16,520 / 16,807 =
// 98.29%. Every count except five-of-a-kind's is a multiple of 210, so a
// cent-priced table returns exactly 98% only if its five-of-a-kind prize is
// 8 cents mod 30 (50.00× itself is impossible). The Classic table keeps every
// familiar tier and sets five of a kind to 42.98×. Low and High are priced to the same 98%, so the risk knob changes
// the spread of results, never the expected return.

export const RTP = 0.98;
export const COLOURS = 7;
export const GEMS = 5;
export const OUTCOMES = COLOURS ** GEMS; // 16,807

export type Hand = 'none' | 'pair' | 'twoPair' | 'three' | 'fullHouse' | 'four' | 'five';
export const HANDS: Hand[] = ['none', 'pair', 'twoPair', 'three', 'fullHouse', 'four', 'five'];

export const HAND_NAMES: Record<Hand, string> = {
  none: 'No match',
  pair: 'Pair',
  twoPair: 'Two pair',
  three: 'Three of a kind',
  fullHouse: 'Full house',
  four: 'Four of a kind',
  five: 'Five of a kind',
};

/** The colour pattern of each hand, as group sizes (for the paytable icons). */
export const HAND_PATTERN: Record<Hand, number[]> = {
  none: [1, 1, 1, 1, 1],
  pair: [2, 1, 1, 1],
  twoPair: [2, 2, 1],
  three: [3, 1, 1],
  fullHouse: [3, 2],
  four: [4, 1],
  five: [5],
};

/** Exact number of the 16,807 colour sequences giving each hand (closed form). */
export const HAND_COUNTS: Record<Hand, number> = {
  none: 7 * 6 * 5 * 4 * 3,
  pair: 7 * 20 * 60,
  twoPair: 21 * 5 * 30,
  three: 7 * 15 * 20,
  fullHouse: 7 * 6 * 10,
  four: 7 * 6 * 5,
  five: 7,
};

export type Risk = 'low' | 'classic' | 'high';
export const RISKS: Risk[] = ['low', 'classic', 'high'];
export const RISK_NAMES: Record<Risk, string> = { low: 'Low', classic: 'Classic', high: 'High' };
export const RISK_VOL: Record<Risk, 'low' | 'medium' | 'high'> = { low: 'low', classic: 'medium', high: 'high' };

/** Payouts in whole cents of the stake, in HANDS order. */
export const PAYTABLE_CENTS: Record<Risk, number[]> = {
  //        none pair 2pair three  FH    four  five
  low: [0, 60, 150, 200, 300, 500, 2798],
  classic: [0, 10, 200, 300, 400, 500, 4298],
  high: [0, 0, 100, 200, 800, 2000, 22298],
};

export const payout = (risk: Risk, hand: Hand) => PAYTABLE_CENTS[risk][HANDS.indexOf(hand)] / 100;

/** P(hand) = count / 7^5, exactly. */
export const handChance = (hand: Hand) => HAND_COUNTS[hand] / OUTCOMES;

/** Σ count·cents for a table; RTP = this / (100 · 7^5). Integer, so exact. */
export const centsTotal = (risk: Risk) => HANDS.reduce((s, h, i) => s + HAND_COUNTS[h] * PAYTABLE_CENTS[risk][i], 0);

export const rtpOf = (risk: Risk) => centsTotal(risk) / (100 * OUTCOMES);

/** Chance the round pays more than the stake. */
export const winChance = (risk: Risk) => HANDS.reduce((s, h) => s + (payout(risk, h) > 1 ? handChance(h) : 0), 0);

/** Chance the round pays anything back. */
export const returnChance = (risk: Risk) => HANDS.reduce((s, h) => s + (payout(risk, h) > 0 ? handChance(h) : 0), 0);

export const topPrize = (risk: Risk) => payout(risk, 'five');

export const MAX_MULTIPLIER = Math.max(...RISKS.map(topPrize));

export interface Classified {
  hand: Hand;
  /** For each gem, the size of its colour group (1 = unmatched). */
  groupSize: number[];
}

/** Reads a row of colours (0..6) as a hand. */
export function classify(gems: number[]): Classified {
  const counts = new Array<number>(COLOURS).fill(0);
  for (const g of gems) counts[g]++;
  const sizes = counts.filter((c) => c > 0).sort((a, b) => b - a);
  const [a, b = 0] = sizes;
  const hand: Hand =
    a === 5 ? 'five' : a === 4 ? 'four' : a === 3 ? (b === 2 ? 'fullHouse' : 'three') : a === 2 ? (b === 2 ? 'twoPair' : 'pair') : 'none';
  return { hand, groupSize: gems.map((g) => counts[g]) };
}

export interface RoundResult extends Classified {
  gems: number[];
  multiplier: number;
}

/** One round: draws the five colours (exactly five rng calls) and prices the hand. */
export function playRound(next: () => number, risk: Risk): RoundResult {
  const gems = Array.from({ length: GEMS }, () => Math.min(COLOURS - 1, Math.floor(next() * COLOURS)));
  const c = classify(gems);
  return { gems, ...c, multiplier: payout(risk, c.hand) };
}
