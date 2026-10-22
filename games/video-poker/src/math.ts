// Video Poker (Stake, BC.Game): five-card draw against a fixed paytable, one
// 52-card deck reshuffled every hand. You are dealt five cards, choose any
// subset to hold (32 choices), and the others are replaced from the 47 unseen
// cards. The final hand is paid from the paytable, as a total return per unit
// staged ("9 for 1"), so a Jacks-or-better pair returns the stake.
//
// EXACT HOLD VALUES. For a dealt hand h and a hold H ⊆ h, every draw is
// equally likely: the C(47, 5 − |H|) five-card hands that contain H and none
// of the discarded cards D = h \ H. Let S(X) be the histogram of final-hand
// categories over all C(52 − |X|, 5 − |X|) hands that contain the set X.
// Inclusion–exclusion over the discards gives the draw histogram
//
//     N(H) = Σ_{T ⊆ D} (−1)^{|T|} S(H ∪ T),
//
// i.e. the superset Möbius transform of S over the 32 subsets of the hand,
// computed in 5 × 16 vector subtractions. S depends on X only up to a
// relabelling of suits, so it is cached by a canonical key (the four per-suit
// rank masks, sorted): |X| = 2 (169 classes, 19,600 completions each),
// |X| = 3 (1,755 classes, 1,176 each), |X| = 1 by rank, |X| = 0 derived as
// S(∅) = ⅘ Σ_rank S(rank) (each hand is counted once per card, 4 suits per
// rank). |X| = 4 and 5 are summed directly (48 and 1 hands). No sampling:
// every hold's draw distribution is exact integer counts.
//
// EXACT RTP. With optimal holds (maximum expected return; ties do not change
// the value) the game's RTP is the average over all C(52,5) = 2,598,960 deals
// of the best hold's value. The deals fall into 134,459 classes under suit
// relabelling; `enumerateOptimal` solves each once. Results (checked in
// math.test.ts by re-running the enumeration):
//
//   Classic 9/6 (Jacks or Better)          RTP 0.995439044  (99.54%)
//   Bonus 8/5 (quads by rank)              RTP 0.991659732  (99.17%)
//   Double Bonus 9/7/5                     RTP 0.991064719  (99.11%)
//   Kicker 9/6 (quads with kickers)        RTP 0.989807835  (98.98%)
//
// Every variant is played with its own optimal strategy. Auto and the
// optimal-hold hint use the same solver, so the eval plays exactly the
// strategy the RTP is computed for. A player who holds differently can only
// lower their own return; the panel shows each hold's exact value.

import type { Rng, Volatility } from '@originals/game-sdk';

// ---------------------------------------------------------------- cards

/** Cards are 0..51: rank = c >> 2 (0 = deuce … 12 = ace), suit = c & 3. */
export type Card = number;

export const RANK_LABEL = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
export const SUIT_GLYPH = ['♠', '♥', '♦', '♣'];
export const SUIT_NAME = ['spades', 'hearts', 'diamonds', 'clubs'];
export const RANK_NAME = ['two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'jack', 'queen', 'king', 'ace'];
export const rankOf = (c: Card) => c >> 2;
export const suitOf = (c: Card) => c & 3;
export const isRed = (c: Card) => (c & 3) === 1 || (c & 3) === 2;
export const cardName = (c: Card) => `${RANK_NAME[rankOf(c)]} of ${SUIT_NAME[suitOf(c)]}`;
export const cardLabel = (c: Card) => RANK_LABEL[rankOf(c)] + SUIT_GLYPH[suitOf(c)];
export const card = (rank: number, suit: number): Card => rank * 4 + suit;

/** Parses "As Kh 10d 4c 2s" (ranks 2–10, J, Q, K, A; suits s h d c). For tests and debugging. */
export function parseHand(text: string): Card[] {
  return text
    .trim()
    .split(/\s+/)
    .map((t) => {
      const r = RANK_LABEL.indexOf(t.slice(0, -1).toUpperCase());
      const s = 'shdc'.indexOf(t.slice(-1).toLowerCase());
      if (r < 0 || s < 0) throw new Error(`bad card ${t}`);
      return card(r, s);
    });
}

// ----------------------------------------------------------- categories

export const NOTHING = 0;
export const JACKS = 1;
export const TWO_PAIR = 2;
export const TRIPS = 3;
export const STRAIGHT = 4;
export const FLUSH = 5;
export const FULL_HOUSE = 6;
/** Four 5s through four kings. */
export const QUADS = 7;
/** Four 2s, 3s or 4s, kicker 5–K. */
export const QUADS_LOW = 8;
/** Four 2s, 3s or 4s with an A, 2, 3 or 4 kicker. */
export const QUADS_LOW_KICKER = 9;
/** Four aces, kicker 5–K. */
export const QUADS_ACES = 10;
/** Four aces with a 2, 3 or 4 kicker. */
export const QUADS_ACES_KICKER = 11;
export const STRAIGHT_FLUSH = 12;
export const ROYAL = 13;
export const NCAT = 14;

export const CATEGORY_NAME = [
  'No win',
  'Jacks or better',
  'Two pair',
  'Three of a kind',
  'Straight',
  'Flush',
  'Full house',
  'Four of a kind',
  'Four 2s–4s',
  'Four 2s–4s + A–4',
  'Four aces',
  'Four aces + 2–4',
  'Straight flush',
  'Royal flush',
];

const POP = new Uint8Array(8192);
for (let i = 1; i < 8192; i++) POP[i] = POP[i >> 1] + (i & 1);
const IS_STRAIGHT = new Uint8Array(8192);
for (let lo = 0; lo <= 8; lo++) IS_STRAIGHT[0x1f << lo] = 1;
IS_STRAIGHT[0x100f] = 1; // A-2-3-4-5
const ROYAL_MASK = 0x1f00; // 10 J Q K A
const JACK_BIT = 1 << 9;
const ACE_BIT = 1 << 12;
const LOW_BITS = 0b111; // 2, 3, 4

/** The final-hand category of five distinct cards. Branch-light: rank bit masks only. */
export function category5(a: Card, b: Card, c: Card, d: Card, e: Card): number {
  const ba = 1 << (a >> 2);
  const bb = 1 << (b >> 2);
  const bc = 1 << (c >> 2);
  const bd = 1 << (d >> 2);
  const be = 1 << (e >> 2);
  const m = ba | bb | bc | bd | be;
  const n = POP[m];
  if (n === 5) {
    const flush = (((a ^ b) | (a ^ c) | (a ^ d) | (a ^ e)) & 3) === 0;
    if (IS_STRAIGHT[m]) return flush ? (m === ROYAL_MASK ? ROYAL : STRAIGHT_FLUSH) : STRAIGHT;
    return flush ? FLUSH : NOTHING;
  }
  // Ranks seen an odd number of times.
  const odd = ba ^ bb ^ bc ^ bd ^ be;
  if (n === 4) return (m ^ odd) >= JACK_BIT ? JACKS : NOTHING;
  if (n === 3) return POP[odd] === 1 ? TWO_PAIR : TRIPS;
  // Two ranks: full house (3 + 2) or quads (4 + 1).
  const k = 1 + (ba === bb ? 1 : 0) + (ba === bc ? 1 : 0) + (ba === bd ? 1 : 0) + (ba === be ? 1 : 0);
  if (k === 2 || k === 3) return FULL_HOUSE;
  const quad = m ^ odd;
  if (quad === ACE_BIT) return odd & LOW_BITS ? QUADS_ACES_KICKER : QUADS_ACES;
  if (quad & LOW_BITS) return odd & (LOW_BITS | ACE_BIT) ? QUADS_LOW_KICKER : QUADS_LOW;
  return QUADS;
}

export const categoryOf = (h: readonly Card[]) => category5(h[0], h[1], h[2], h[3], h[4]);

/** Which of the five cards make the paying hand (bit i = card i), for highlighting. */
export function scoringMask(h: readonly Card[], cat: number): number {
  if (cat === NOTHING) return 0;
  if (cat === STRAIGHT || cat === FLUSH || cat === FULL_HOUSE || cat === STRAIGHT_FLUSH || cat === ROYAL) return 31;
  if (cat === QUADS_LOW_KICKER || cat === QUADS_ACES_KICKER) return 31;
  const count = new Array(13).fill(0);
  for (const c of h) count[rankOf(c)]++;
  let mask = 0;
  h.forEach((c, i) => {
    if (count[rankOf(c)] >= 2) mask |= 1 << i;
  });
  return mask;
}

// ------------------------------------------------------------ paytables

export type PaytableId = 'classic' | 'bonus' | 'double' | 'kicker';

export interface PayRow {
  label: string;
  /** A shorter label for narrow frames. */
  short?: string;
  /** The categories this row pays (they share one payout). */
  cats: number[];
}

export interface Paytable {
  id: PaytableId;
  name: string;
  /** The industry name of the pay schedule, for the info sheet. */
  schedule: string;
  volatility: Volatility;
  /** Total return per unit staked, by category. */
  pays: readonly number[];
  rows: PayRow[];
  /** Exact RTP with optimal holds (see header; re-derived in the tests). */
  rtp: number;
  /** Exact final-hand distribution under the solver's optimal holds, by category. */
  dist: readonly number[];
}

const QUADS_ALL = [QUADS, QUADS_LOW, QUADS_LOW_KICKER, QUADS_ACES, QUADS_ACES_KICKER];
const LOWER_ROWS: PayRow[] = [
  { label: 'Full house', cats: [FULL_HOUSE] },
  { label: 'Flush', cats: [FLUSH] },
  { label: 'Straight', cats: [STRAIGHT] },
  { label: 'Three of a kind', cats: [TRIPS] },
  { label: 'Two pair', cats: [TWO_PAIR] },
  { label: 'Jacks or better', cats: [JACKS] },
];
const TOP_ROWS: PayRow[] = [
  { label: 'Royal flush', cats: [ROYAL] },
  { label: 'Straight flush', cats: [STRAIGHT_FLUSH] },
];
const BONUS_QUAD_ROWS: PayRow[] = [
  { label: 'Four aces', cats: [QUADS_ACES, QUADS_ACES_KICKER] },
  { label: 'Four 2s–4s', cats: [QUADS_LOW, QUADS_LOW_KICKER] },
  { label: 'Four 5s–Ks', cats: [QUADS] },
];

//                              0  J  2P 3K St Fl FH Q  Ql QlK QA QAK SF  RF
const PAYS_CLASSIC = /*      */ [0, 1, 2, 3, 4, 6, 9, 25, 25, 25, 25, 25, 50, 800];
const PAYS_BONUS = /*        */ [0, 1, 2, 3, 4, 5, 8, 25, 40, 40, 80, 80, 50, 800];
const PAYS_DOUBLE = /*       */ [0, 1, 1, 3, 5, 7, 9, 50, 80, 80, 160, 160, 50, 800];
const PAYS_KICKER = /*       */ [0, 1, 1, 3, 4, 6, 9, 50, 80, 160, 160, 400, 50, 800];

// Exact optimal-play results, from enumerateOptimal over all 2,598,960 deals
// (deterministic tie-break: the first best hold by mask). Verified in tests.
const RTP_CLASSIC = 0.9954390436950997;
const RTP_BONUS = 0.9916597318723152;
const RTP_DOUBLE = 0.991064718540315;
const RTP_KICKER = 0.9898078348692366;
const DIST_CLASSIC = [0.5454346692331142, 0.214585031125541, 0.12927890248005106, 0.07444869857112586, 0.011229367241343935, 0.011014510968032833, 0.011512207336269295, 0.001639644051665204, 0.0003953989636149557, 0.00013183676523142085, 0.00014853407396485464, 0.00004713183140029849, 0.00010930909037148623, 0.000024758268037594096];
const DIST_BONUS = [0.5448545238597885, 0.21525918629895438, 0.129307871171478, 0.07446816844740475, 0.011221277941826703, 0.010880004864885679, 0.011514283634336693, 0.0016398956159059206, 0.0003954142366034335, 0.00013183930210069342, 0.00014869216233880315, 0.00004715044373710354, 0.00010683688537904977, 0.000024855135025528222];
const DIST_DOUBLE = [0.5681065530306758, 0.1967445472522994, 0.11892507874329923, 0.07287107119532915, 0.015020624574105626, 0.015222235932408667, 0.01062908893934213, 0.0016038106696461183, 0.00039276060452129893, 0.0001312921558671597, 0.00016491509217050855, 0.00005404921350155835, 0.00011315442191139693, 0.000020818174738004004];
const DIST_KICKER = [0.5528369339242178, 0.2113224825553347, 0.12306359506578907, 0.07526512890268788, 0.012766256895509375, 0.011358532523098996, 0.010860004343445178, 0.001630171407688235, 0.00038440553875027355, 0.00014319656061457975, 0.000173580048503138, 0.00006159019226414052, 0.00010961183026079168, 0.000024510211707951396];

export const PAYTABLES: Record<PaytableId, Paytable> = {
  classic: {
    id: 'classic',
    name: 'Classic',
    schedule: '9/6 Jacks or Better',
    volatility: 'low',
    pays: PAYS_CLASSIC,
    rows: [...TOP_ROWS, { label: 'Four of a kind', cats: QUADS_ALL }, ...LOWER_ROWS],
    rtp: RTP_CLASSIC,
    dist: DIST_CLASSIC,
  },
  bonus: {
    id: 'bonus',
    name: 'Bonus',
    schedule: '8/5 Bonus',
    volatility: 'medium',
    pays: PAYS_BONUS,
    rows: [...TOP_ROWS, ...BONUS_QUAD_ROWS, ...LOWER_ROWS],
    rtp: RTP_BONUS,
    dist: DIST_BONUS,
  },
  double: {
    id: 'double',
    name: 'Double Bonus',
    schedule: '9/7/5 Double Bonus',
    volatility: 'high',
    pays: PAYS_DOUBLE,
    rows: [...TOP_ROWS, ...BONUS_QUAD_ROWS, ...LOWER_ROWS],
    rtp: RTP_DOUBLE,
    dist: DIST_DOUBLE,
  },
  kicker: {
    id: 'kicker',
    name: 'Kicker Bonus',
    schedule: '9/6 Double Double Bonus',
    volatility: 'extreme',
    pays: PAYS_KICKER,
    rows: [
      ...TOP_ROWS,
      { label: 'Four aces + 2–4', short: '4 aces + 2–4', cats: [QUADS_ACES_KICKER] },
      { label: 'Four 2s–4s + A–4', short: '4 2s–4s + A–4', cats: [QUADS_LOW_KICKER] },
      { label: 'Four aces', cats: [QUADS_ACES] },
      { label: 'Four 2s–4s', cats: [QUADS_LOW] },
      { label: 'Four 5s–Ks', cats: [QUADS] },
      ...LOWER_ROWS,
    ],
    rtp: RTP_KICKER,
    dist: DIST_KICKER,
  },
};

export const PAYTABLE_IDS = Object.keys(PAYTABLES) as PaytableId[];

/** The main bet: the classic 9/6 table. */
export const RTP = RTP_CLASSIC;
/** The royal flush pays 800× on every table, and nothing pays more. */
export const MAX_MULTIPLIER = 800;

/** Row index in a paytable for a category. */
export const rowOf = (pt: Paytable, cat: number) => pt.rows.findIndex((r) => r.cats.includes(cat));

/** Display name of a category on a given table (its row label), or "No win". */
export const handName = (pt: Paytable, cat: number) => (cat === NOTHING ? 'No win' : pt.rows[rowOf(pt, cat)]?.label ?? CATEGORY_NAME[cat]);

// ------------------------------------------------- subset histograms S(X)

type Hist = Float64Array;

/** Canonical key of a card set under suit relabelling: the per-suit rank masks, sorted. */
function canonKey(cards: readonly Card[], n: number): number {
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let s3 = 0;
  for (let i = 0; i < n; i++) {
    const c = cards[i];
    const bit = 1 << (c >> 2);
    switch (c & 3) {
      case 0:
        s0 |= bit;
        break;
      case 1:
        s1 |= bit;
        break;
      case 2:
        s2 |= bit;
        break;
      default:
        s3 |= bit;
    }
  }
  let t: number;
  if (s0 < s1) (t = s0), (s0 = s1), (s1 = t);
  if (s2 < s3) (t = s2), (s2 = s3), (s3 = t);
  if (s0 < s2) (t = s0), (s0 = s2), (s2 = t);
  if (s1 < s3) (t = s1), (s1 = s3), (s3 = t);
  if (s1 < s2) (t = s1), (s1 = s2), (s2 = t);
  return ((s0 * 8192 + s1) * 8192 + s2) * 8192 + s3;
}

/** Adds the categories of every 5-card hand containing x[0..k) (distinct cards) to h. */
function enumerateSupersets(x: readonly Card[], k: number, h: Hist) {
  const rest: Card[] = [];
  outer: for (let c = 0; c < 52; c++) {
    for (let i = 0; i < k; i++) if (x[i] === c) continue outer;
    rest.push(c);
  }
  const n = rest.length;
  if (k === 4) {
    const [a, b, c, d] = x;
    for (let i = 0; i < n; i++) h[category5(a, b, c, d, rest[i])]++;
  } else if (k === 3) {
    const [a, b, c] = x;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) h[category5(a, b, c, rest[i], rest[j])]++;
  } else if (k === 2) {
    const [a, b] = x;
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const ri = rest[i];
        const rj = rest[j];
        for (let l = j + 1; l < n; l++) h[category5(a, b, ri, rj, rest[l])]++;
      }
  } else if (k === 1) {
    const a = x[0];
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++)
        for (let l = j + 1; l < n; l++) {
          const ri = rest[i];
          const rj = rest[j];
          const rl = rest[l];
          for (let m = l + 1; m < n; m++) h[category5(a, ri, rj, rl, rest[m])]++;
        }
  } else {
    throw new Error('enumerateSupersets: k must be 1–4');
  }
}

const cacheBySet = new Map<number, Hist>();
const cacheByRank: (Hist | undefined)[] = new Array(13);
let cacheEmpty: Hist | null = null;

function supersetsOfRank(r: number): Hist {
  let h = cacheByRank[r];
  if (!h) {
    h = new Float64Array(NCAT);
    enumerateSupersets([card(r, 0)], 1, h);
    cacheByRank[r] = h;
  }
  return h;
}

function supersetsOfEmpty(): Hist {
  if (!cacheEmpty) {
    const h = new Float64Array(NCAT);
    for (let r = 0; r < 13; r++) {
      const s = supersetsOfRank(r);
      for (let k = 0; k < NCAT; k++) h[k] += s[k];
    }
    // Σ over 52 cards of S({card}) counts each hand 5 times; 4 suits per rank.
    for (let k = 0; k < NCAT; k++) h[k] = (h[k] * 4) / 5;
    cacheEmpty = h;
  }
  return cacheEmpty;
}

/** Writes S(X), the category histogram of all 5-card hands containing x[0..k), into out[at..at + NCAT). */
function supersets(x: readonly Card[], k: number, out: Hist, at: number) {
  let src: Hist;
  if (k === 5) {
    out[at + category5(x[0], x[1], x[2], x[3], x[4])] = 1;
    return;
  } else if (k === 4) {
    const a = x[0];
    const b = x[1];
    const c = x[2];
    const d = x[3];
    for (let e = 0; e < 52; e++) if (e !== a && e !== b && e !== c && e !== d) out[at + category5(a, b, c, d, e)]++;
    return;
  } else if (k === 0) {
    src = supersetsOfEmpty();
  } else if (k === 1) {
    src = supersetsOfRank(x[0] >> 2);
  } else {
    const key = canonKey(x, k);
    let h = cacheBySet.get(key);
    if (!h) {
      h = new Float64Array(NCAT);
      enumerateSupersets(x, k, h);
      cacheBySet.set(key, h);
    }
    src = h;
  }
  out.set(src, at);
}

/** Fills the caches every hand needs (S(∅) and S(rank)): ~3.3M evaluations, done once. */
export function warmUp() {
  supersetsOfEmpty();
}

// ------------------------------------------------------------- solver

/** C(47, 5 − held): the number of equally likely draws for a hold of `held` cards. */
export const DRAWS = [1533939, 178365, 16215, 1081, 47, 1];
export const popcount5 = (mask: number) => POP[mask];

export interface Analysis {
  hand: readonly Card[];
  /**
   * counts[mask · NCAT + cat]: how many of the C(47, 5 − |mask|) equally likely
   * draws end in each category when holding `mask` (bit i = card i).
   */
  counts: Float64Array;
}

/** Exact draw distribution of every one of the 32 holds (bit i = hold card i). */
export function analyse(hand: readonly Card[]): Analysis {
  const f = new Float64Array(32 * NCAT);
  const sub: Card[] = [0, 0, 0, 0, 0];
  for (let mask = 0; mask < 32; mask++) {
    let k = 0;
    for (let i = 0; i < 5; i++) if (mask & (1 << i)) sub[k++] = hand[i];
    supersets(sub, k, f, mask * NCAT);
  }
  // Superset Möbius transform: f[H] ← Σ_{T ⊇ H} (−1)^{|T  H|} S(T).
  for (let i = 0; i < 5; i++) {
    const bit = 1 << i;
    for (let mask = 0; mask < 32; mask++) {
      if (mask & bit) continue;
      const lo = mask * NCAT;
      const hi = (mask | bit) * NCAT;
      for (let c = 0; c < NCAT; c++) f[lo + c] -= f[hi + c];
    }
  }
  return { hand, counts: f };
}

/** The draw counts of one hold, by category. */
export const holdCounts = (a: Analysis, mask: number) => a.counts.subarray(mask * NCAT, mask * NCAT + NCAT);

/** Expected return (× stake) of holding `mask` on a paytable. */
export function holdValue(a: Analysis, mask: number, pays: readonly number[]): number {
  const h = a.counts;
  const at = mask * NCAT;
  let s = 0;
  for (let c = 1; c < NCAT; c++) s += h[at + c] * pays[c];
  return s / DRAWS[POP[mask]];
}

/** Exact chance of each category after the draw, holding `mask`. */
export function holdDist(a: Analysis, mask: number): number[] {
  const d = DRAWS[POP[mask]];
  return Array.from(holdCounts(a, mask), (n) => n / d);
}

/** Exact chance the final hand pays anything (≥ 1×), holding `mask`. */
export function payingChance(a: Analysis, mask: number, pays: readonly number[]): number {
  const h = a.counts;
  const at = mask * NCAT;
  let s = 0;
  for (let c = 0; c < NCAT; c++) if (pays[c] > 0) s += h[at + c];
  return s / DRAWS[POP[mask]];
}

/** Holds whose value is within this of the best are optimal ties (values are rationals with denominators ≤ 1,533,939). */
export const TIE_EPS = 1e-9;

export interface Solution {
  values: number[];
  best: number;
  bestValue: number;
  /** Every optimal hold (ties), lowest mask first. */
  ties: number[];
}

export function solve(a: Analysis, pays: readonly number[]): Solution {
  const values = new Array<number>(32);
  let bestValue = -1;
  for (let m = 0; m < 32; m++) {
    values[m] = holdValue(a, m, pays);
    if (values[m] > bestValue) bestValue = values[m];
  }
  const ties: number[] = [];
  for (let m = 0; m < 32; m++) if (values[m] >= bestValue - TIE_EPS) ties.push(m);
  return { values, best: ties[0], bestValue, ties };
}

// ------------------------------------------------------- dealing & play

/** Five distinct cards, uniformly from a fresh deck (partial Fisher–Yates). */
export function deal(rng: Rng): Card[] {
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = 0; i < 5; i++) {
    const j = i + rng.int(52 - i);
    const t = deck[i];
    deck[i] = deck[j];
    deck[j] = t;
  }
  return deck.slice(0, 5);
}

/** Replaces the cards not in `hold` with fresh cards from the 47 unseen ones, in order. */
export function draw(hand: readonly Card[], hold: number, rng: Rng): Card[] {
  const unseen: Card[] = [];
  for (let c = 0; c < 52; c++) if (!hand.includes(c)) unseen.push(c);
  const out = hand.slice();
  let n = unseen.length;
  for (let i = 0; i < 5; i++) {
    if (hold & (1 << i)) continue;
    const j = rng.int(n);
    out[i] = unseen[j];
    unseen[j] = unseen[--n];
  }
  return out;
}

export interface PlayedHand {
  dealt: Card[];
  hold: number;
  final: Card[];
  cat: number;
  multiplier: number;
  /** The best hold's exact value at the moment of the hold. */
  holdValue: number;
}

/**
 * One whole hand with optimal holds: the Auto player and the eval. When several
 * holds tie, `tieBreak` picks among them (they are worth exactly the same).
 */
export function playOptimal(pt: Paytable, rng: Rng, tieBreak: 'first' | 'random' = 'first'): PlayedHand {
  const dealt = deal(rng);
  const sol = solve(analyse(dealt), pt.pays);
  const hold = tieBreak === 'random' && sol.ties.length > 1 ? sol.ties[rng.int(sol.ties.length)] : sol.best;
  const final = draw(dealt, hold, rng);
  const cat = categoryOf(final);
  return { dealt, hold, final, cat, multiplier: pt.pays[cat], holdValue: sol.bestValue };
}

// ----------------------------------------------------- full enumeration

/**
 * Exact optimal-play RTP and final-hand distribution for each paytable, by
 * solving one representative of every suit-relabelling class of the
 * 2,598,960 deals, weighted by class size. Takes a few seconds; tests only.
 */
export function enumerateOptimal(tables: readonly (readonly number[])[]): { rtp: number; dist: number[] }[] {
  const classes = new Map<number, { w: number; rep: Card[] }>();
  const h: Card[] = [0, 0, 0, 0, 0];
  for (h[0] = 0; h[0] < 52; h[0]++)
    for (h[1] = h[0] + 1; h[1] < 52; h[1]++)
      for (h[2] = h[1] + 1; h[2] < 52; h[2]++)
        for (h[3] = h[2] + 1; h[3] < 52; h[3]++)
          for (h[4] = h[3] + 1; h[4] < 52; h[4]++) {
            const key = canonKey(h, 5);
            const c = classes.get(key);
            if (c) c.w++;
            else classes.set(key, { w: 1, rep: h.slice() });
          }
  const out = tables.map(() => ({ rtp: 0, dist: new Array<number>(NCAT).fill(0) }));
  for (const { w, rep } of classes.values()) {
    const a = analyse(rep);
    tables.forEach((pays, t) => {
      const { best, bestValue } = solve(a, pays);
      out[t].rtp += w * bestValue;
      const d = DRAWS[POP[best]];
      for (let c = 0; c < NCAT; c++) out[t].dist[c] += (w * a.counts[best * NCAT + c]) / d;
    });
  }
  const total = 2598960;
  for (const o of out) {
    o.rtp /= total;
    for (let c = 0; c < NCAT; c++) o.dist[c] /= total;
  }
  return out;
}

/** Number of suit-relabelling classes of 5-card deals (for the tests). */
export function countClasses(): number {
  const keys = new Set<number>();
  const h: Card[] = [0, 0, 0, 0, 0];
  for (h[0] = 0; h[0] < 52; h[0]++)
    for (h[1] = h[0] + 1; h[1] < 52; h[1]++)
      for (h[2] = h[1] + 1; h[2] < 52; h[2]++)
        for (h[3] = h[2] + 1; h[3] < 52; h[3]++) for (h[4] = h[3] + 1; h[4] < 52; h[4]++) keys.add(canonKey(h, 5));
  return keys.size;
}
