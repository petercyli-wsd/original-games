// Baccarat (punto banco, the RNG table at Stake, BC.Game and others).
//
// THE DEAL. Every round is dealt from a freshly shuffled 8-deck shoe (416
// cards, 8 copies of each of the 52 cards), so rounds are independent and no
// counting strategy exists. Cards go Player, Banker, Player, Banker; A = 1,
// 2–9 face value, 10 / J / Q / K = 0, and a hand's total is its sum mod 10.
// Third cards follow the standard tableau:
//
//   - a natural (8 or 9 on either first two cards): both hands stand;
//   - Player draws on 0–5 and stands on 6–7;
//   - if Player stood, Banker draws on 0–5 and stands on 6–7;
//   - if Player drew a third card worth x, Banker draws on
//       0–2 always · 3 unless x = 8 · 4 if x ∈ 2–7 · 5 if x ∈ 4–7 · 6 if x ∈ 6–7 · never on 7.
//
// EXACT PROBABILITIES. The outcome depends only on card values (ten classes:
// 128 zero-value cards, 32 of each of 1–9). We enumerate every ordered deal
// exactly: the first four cards by rank (13⁴ sequences, weights from the
// falling rank counts 32, 31, … over 416 · 415 · 414 · 413) and every third
// card by value with the counts left after the first four. Suits only matter
// for the Perfect Pair, and given the ranks they are a uniform draw from the
// 8 copies per suit of that rank: a pair is suited with chance 7/31, and two
// pairs of the same rank are both suited with chance (7/31)·(33/145).
// The result is a joint table (winner, Banker-wins-on-6, Player pair, Banker
// pair, number of suited pairs: 32 cells occur) whose probabilities sum to 1.
//
// For 8 decks this gives (to 9 places)
//   Banker wins 0.458597423 · Player wins 0.446246609 · Tie 0.095155968,
// and the closed forms for the pair bets (ordered draws without replacement):
//   P(Player pair) = P(Banker pair) = 31/415          (second card matches rank: 31 of 415)
//   P(suited pair in one hand)      = 7/415           (same card: 7 of 415)
//   P(both hands pair)    = 52·[32·31·30·29/52 …]     see pairBothClosed()
//   P(both hands suited)  = see perfectBothClosed().
//
// THE TABLE (payouts "to one"; a win also returns the chip):
//
//   bet            wins when                              pays        RTP (8 decks)
//   Player         Player total higher (tie: push)        1:1         98.7643%
//   Banker         Banker total higher (tie: push)        0.95:1      98.9421%   (Classic, 5% commission)
//                  No commission: 1:1, but 0.5:1 when Banker wins with a 6           98.5418%
//   Tie            equal totals                           8:1         85.6404%
//   Player Pair    Player's first two cards share a rank  11:1        12·31/415 = 89.6386%
//   Banker Pair    Banker's first two cards share a rank  11:1        89.6386%
//   Either Pair    either of the above                    5:1         86.2901%
//   Perfect Pair   a suited pair (same rank and suit)     25:1 one hand, 200:1 both  91.9530%
//
// (The exact figures are computed from the joint table and printed by the
// tests; the comments above round them.)
//
// A layout is a sum of independent bets on the same deal, so by linearity of
// expectation its RTP is the stake-weighted average of its bets' RTPs. The
// main bet (manifest.rtp) is Banker under the Classic 5% commission.
//
// Max payout: per unit of total stake a layout returns a stake-weighted
// average of its bets' returns, never more than the largest single return, a
// Perfect Pair in both hands at 201×. MAX_MULTIPLIER = 201.

export const DECKS = 8;
export const SHOE = DECKS * 52; // 416

export interface Card {
  /** 1 = A … 13 = K. */
  rank: number;
  /** 0 ♠, 1 ♥, 2 ♣, 3 ♦. */
  suit: number;
}

export const RANK_LABEL = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const SUIT_LABEL = ['♠', '♥', '♣', '♦'];
export const SUIT_NAME = ['spades', 'hearts', 'clubs', 'diamonds'];
export const isRed = (c: Card) => c.suit === 1 || c.suit === 3;
export const cardLabel = (c: Card) => `${RANK_LABEL[c.rank]}${SUIT_LABEL[c.suit]}`;

/** Baccarat value of a rank: A = 1, 2–9 face value, tens and pictures 0. */
export const valueOf = (rank: number) => (rank >= 10 ? 0 : rank);
export const totalOf = (cards: Card[]) => cards.reduce((t, c) => t + valueOf(c.rank), 0) % 10;

/** Cards of each value in the shoe: 0 (10, J, Q, K) has 4 ranks, the rest 1 rank each. */
export const VALUE_COUNT = [16 * DECKS, ...Array.from({ length: 9 }, () => 4 * DECKS)];

// ---------- The tableau ----------

/** Player draws a third card on 0–5 (when nobody has a natural). */
export const playerDraws = (pTotal: number) => pTotal <= 5;

/**
 * Whether Banker draws, given Banker's two-card total and Player's third card
 * value (null when Player stood). Only called when nobody has a natural.
 */
export function bankerDraws(bTotal: number, p3: number | null): boolean {
  if (p3 === null) return bTotal <= 5;
  switch (bTotal) {
    case 0:
    case 1:
    case 2:
      return true;
    case 3:
      return p3 !== 8;
    case 4:
      return p3 >= 2 && p3 <= 7;
    case 5:
      return p3 >= 4 && p3 <= 7;
    case 6:
      return p3 === 6 || p3 === 7;
    default:
      return false;
  }
}

export const isNatural = (twoCardTotal: number) => twoCardTotal >= 8;

// ---------- Dealing ----------

export type Winner = 'player' | 'banker' | 'tie';

export interface Deal {
  player: Card[];
  banker: Card[];
  /** Order the cards came out of the shoe: 'P' or 'B' for each. */
  order: ('P' | 'B')[];
  pTotal: number;
  bTotal: number;
  winner: Winner;
  natural: boolean;
}

/** A fresh 8-deck shoe as counts per card kind (index (rank − 1)·4 + suit). */
export function freshShoe(): number[] {
  return Array.from({ length: 52 }, () => DECKS);
}

/** Draws one card from the shoe counts using one uniform u ∈ [0, 1). */
export function drawCard(shoe: number[], u: number): Card {
  const left = shoe.reduce((a, b) => a + b, 0);
  let i = Math.min(left - 1, Math.floor(u * left));
  for (let k = 0; k < 52; k++) {
    if (i < shoe[k]) {
      shoe[k]--;
      return { rank: Math.floor(k / 4) + 1, suit: k % 4 };
    }
    i -= shoe[k];
  }
  throw new Error('empty shoe');
}

/** Plays one round from a fresh shoe; `next` supplies one uniform per card (4 to 6 cards). */
export function deal(next: () => number): Deal {
  const shoe = freshShoe();
  const draw = () => drawCard(shoe, next());
  const player = [draw()];
  const banker = [draw()];
  player.push(draw());
  banker.push(draw());
  const order: ('P' | 'B')[] = ['P', 'B', 'P', 'B'];
  let pTotal = totalOf(player);
  let bTotal = totalOf(banker);
  const natural = isNatural(pTotal) || isNatural(bTotal);
  if (!natural) {
    let p3: number | null = null;
    if (playerDraws(pTotal)) {
      const c = draw();
      player.push(c);
      order.push('P');
      p3 = valueOf(c.rank);
      pTotal = totalOf(player);
    }
    if (bankerDraws(bTotal, p3)) {
      banker.push(draw());
      order.push('B');
      bTotal = totalOf(banker);
    }
  }
  const winner: Winner = pTotal > bTotal ? 'player' : bTotal > pTotal ? 'banker' : 'tie';
  return { player, banker, order, pTotal, bTotal, winner, natural };
}

// ---------- Bets ----------

export type BetId = 'player' | 'banker' | 'tie' | 'playerPair' | 'bankerPair' | 'eitherPair' | 'perfectPair';
export type Variant = 'classic' | 'nocomm';
export type Layout = Partial<Record<BetId, number>>;

export const BET_IDS: BetId[] = ['player', 'banker', 'tie', 'playerPair', 'bankerPair', 'eitherPair', 'perfectPair'];

export const PAYS = {
  player: 1,
  banker: 0.95,
  bankerNoComm: 1,
  bankerNoCommSix: 0.5,
  tie: 8,
  pair: 11,
  eitherPair: 5,
  perfectOne: 25,
  perfectBoth: 200,
} as const;

export const BET_NAME: Record<BetId, string> = {
  player: 'Player',
  banker: 'Banker',
  tie: 'Tie',
  playerPair: 'Player Pair',
  bankerPair: 'Banker Pair',
  eitherPair: 'Either Pair',
  perfectPair: 'Perfect Pair',
};

export const VARIANT_NAME: Record<Variant, string> = { classic: 'Classic', nocomm: 'No commission' };

/** The payout of a bet "to one", as text, for the felt. */
export function paysLabel(id: BetId, variant: Variant): string {
  switch (id) {
    case 'player':
      return '1:1';
    case 'banker':
      return variant === 'classic' ? '0.95:1' : '1:1 · 6 pays ½';
    case 'tie':
      return '8:1';
    case 'playerPair':
    case 'bankerPair':
      return '11:1';
    case 'eitherPair':
      return '5:1';
    case 'perfectPair':
      return '25:1 · both 200:1';
  }
}

/** What the deal looks like to the bets: the cells of the joint table. */
export interface Result {
  win: 'P' | 'B' | 'T';
  /** Banker won with a total of 6 (the No-commission half pay). */
  b6: boolean;
  /** Player's / Banker's first two cards share a rank. */
  pp: boolean;
  bp: boolean;
  /** Hands whose first two cards are the very same card (rank and suit): 0, 1 or 2. */
  sp: 0 | 1 | 2;
}

export function resultOf(d: Deal): Result {
  const same = (a: Card, b: Card) => a.rank === b.rank && a.suit === b.suit;
  const sp = ((same(d.player[0], d.player[1]) ? 1 : 0) + (same(d.banker[0], d.banker[1]) ? 1 : 0)) as 0 | 1 | 2;
  return {
    win: d.winner === 'player' ? 'P' : d.winner === 'banker' ? 'B' : 'T',
    b6: d.winner === 'banker' && d.bTotal === 6,
    pp: d.player[0].rank === d.player[1].rank,
    bp: d.banker[0].rank === d.banker[1].rank,
    sp,
  };
}

/** What one unit staked on `id` returns (stake included): 0 lost, 1 push, >1 win. */
export function returnOf(id: BetId, r: Result, variant: Variant): number {
  switch (id) {
    case 'player':
      return r.win === 'P' ? 1 + PAYS.player : r.win === 'T' ? 1 : 0;
    case 'banker':
      if (r.win === 'T') return 1;
      if (r.win !== 'B') return 0;
      if (variant === 'classic') return 1 + PAYS.banker;
      return 1 + (r.b6 ? PAYS.bankerNoCommSix : PAYS.bankerNoComm);
    case 'tie':
      return r.win === 'T' ? 1 + PAYS.tie : 0;
    case 'playerPair':
      return r.pp ? 1 + PAYS.pair : 0;
    case 'bankerPair':
      return r.bp ? 1 + PAYS.pair : 0;
    case 'eitherPair':
      return r.pp || r.bp ? 1 + PAYS.eitherPair : 0;
    case 'perfectPair':
      return r.sp === 2 ? 1 + PAYS.perfectBoth : r.sp === 1 ? 1 + PAYS.perfectOne : 0;
  }
}

export const MAX_MULTIPLIER = 1 + PAYS.perfectBoth; // 201

const cents = (x: number) => Math.round(x * 100) / 100;

export const betsOf = (l: Layout) => BET_IDS.filter((id) => (l[id] ?? 0) > 0);
export const stakeOf = (l: Layout) => cents(betsOf(l).reduce((a, id) => a + (l[id] ?? 0), 0));

export interface Settlement {
  /** Total returned (stakes included). */
  returned: number;
  /** returned / total stake. */
  multiplier: number;
  won: BetId[];
  pushed: BetId[];
  lost: BetId[];
}

export function settle(layout: Layout, r: Result, variant: Variant): Settlement {
  let returned = 0;
  const won: BetId[] = [];
  const pushed: BetId[] = [];
  const lost: BetId[] = [];
  for (const id of betsOf(layout)) {
    const f = returnOf(id, r, variant);
    returned += (layout[id] ?? 0) * f;
    (f > 1 ? won : f === 1 ? pushed : lost).push(id);
  }
  const total = stakeOf(layout);
  return { returned, multiplier: total > 0 ? returned / total : 0, won, pushed, lost };
}

// ---------- The exact joint table ----------

export interface Cell extends Result {
  p: number;
}

type Win4 = { P: number; B: number; B6: number; T: number };

/** Outcome probabilities given the first four card values (Player p1, p2; Banker b1, b2). */
function afterFirstFour(p1: number, p2: number, b1: number, b2: number): Win4 {
  const c = VALUE_COUNT.slice();
  c[p1]--;
  c[p2]--;
  c[b1]--;
  c[b2]--;
  let left = SHOE - 4;
  const out: Win4 = { P: 0, B: 0, B6: 0, T: 0 };
  const add = (pt: number, bt: number, w: number) => {
    if (pt > bt) out.P += w;
    else if (bt > pt) {
      if (bt === 6) out.B6 += w;
      else out.B += w;
    } else out.T += w;
  };
  const pt = (p1 + p2) % 10;
  const bt = (b1 + b2) % 10;
  if (isNatural(pt) || isNatural(bt)) {
    add(pt, bt, 1);
    return out;
  }
  if (playerDraws(pt)) {
    for (let x = 0; x < 10; x++) {
      if (!c[x]) continue;
      const px = c[x] / left;
      c[x]--;
      left--;
      const pt3 = (pt + x) % 10;
      if (bankerDraws(bt, x)) {
        for (let y = 0; y < 10; y++) if (c[y]) add(pt3, (bt + y) % 10, (px * c[y]) / left);
      } else add(pt3, bt, px);
      c[x]++;
      left++;
    }
  } else if (bankerDraws(bt, null)) {
    for (let y = 0; y < 10; y++) if (c[y]) add(pt, (bt + y) % 10, c[y] / left);
  } else add(pt, bt, 1);
  return out;
}

let jointCache: Cell[] | null = null;

/** The exact joint distribution of a round's result: 32 cells summing to 1. */
export function joint(): Cell[] {
  if (jointCache) return jointCache;
  const valueCache = new Map<number, Win4>();
  const acc = new Map<string, Cell>();
  const put = (win: 'P' | 'B' | 'T', b6: boolean, pp: boolean, bp: boolean, sp: 0 | 1 | 2, p: number) => {
    if (p <= 0) return;
    const key = `${win}${b6 ? 6 : ''}|${+pp}${+bp}${sp}`;
    const cell = acc.get(key);
    if (cell) cell.p += p;
    else acc.set(key, { win, b6, pp, bp, sp, p });
  };
  const perRank = 4 * DECKS; // 32
  const used = new Array(14).fill(0);
  const sameSuit = 7 / 31; // second of a rank-pair matches the first's suit
  const bothSameSuit = (7 / 31) * (33 / 145); // four of one rank: both pairs suited

  for (let r1 = 1; r1 <= 13; r1++) {
    const w1 = (perRank - used[r1]) / SHOE;
    used[r1]++;
    for (let r2 = 1; r2 <= 13; r2++) {
      const w2 = (w1 * (perRank - used[r2])) / (SHOE - 1);
      used[r2]++;
      for (let r3 = 1; r3 <= 13; r3++) {
        const w3 = (w2 * (perRank - used[r3])) / (SHOE - 2);
        used[r3]++;
        for (let r4 = 1; r4 <= 13; r4++) {
          const w = (w3 * (perRank - used[r4])) / (SHOE - 3);
          // Player holds r1, r3; Banker holds r2, r4 in dealing order (P, B, P, B).
          const pv1 = valueOf(r1);
          const pv2 = valueOf(r3);
          const bv1 = valueOf(r2);
          const bv2 = valueOf(r4);
          const key = pv1 * 1000 + pv2 * 100 + bv1 * 10 + bv2;
          let o = valueCache.get(key);
          if (!o) {
            o = afterFirstFour(pv1, pv2, bv1, bv2);
            valueCache.set(key, o);
          }
          const pp = r1 === r3;
          const bp = r2 === r4;
          // Suited-pair split given the ranks.
          let s0 = 1;
          let s1 = 0;
          let s2 = 0;
          if (pp && bp) {
            const both = r1 === r2 ? bothSameSuit : sameSuit * sameSuit;
            s2 = both;
            s1 = 2 * (sameSuit - both);
            s0 = 1 - s1 - s2;
          } else if (pp || bp) {
            s1 = sameSuit;
            s0 = 1 - sameSuit;
          }
          for (const [sp, f] of [
            [0, s0],
            [1, s1],
            [2, s2],
          ] as const) {
            if (f <= 0) continue;
            put('P', false, pp, bp, sp, w * f * o.P);
            put('B', false, pp, bp, sp, w * f * o.B);
            put('B', true, pp, bp, sp, w * f * o.B6);
            put('T', false, pp, bp, sp, w * f * o.T);
          }
        }
        used[r3]--;
      }
      used[r2]--;
    }
    used[r1]--;
  }
  jointCache = [...acc.values()];
  return jointCache;
}

/** P(event) under the exact joint table. */
export const probOf = (pred: (c: Result) => boolean) => joint().reduce((a, c) => a + (pred(c) ? c.p : 0), 0);

/** Exact RTP of one unit on a bet. */
export function betRtp(id: BetId, variant: Variant): number {
  return joint().reduce((a, c) => a + c.p * returnOf(id, c, variant), 0);
}

/** Exact chance that a bet wins (pushes excluded). */
export function betWinChance(id: BetId, variant: Variant): number {
  return joint().reduce((a, c) => a + (returnOf(id, c, variant) > 1 ? c.p : 0), 0);
}

export function layoutRtp(l: Layout, variant: Variant): number {
  const total = stakeOf(l);
  if (!(total > 0)) return 0;
  return betsOf(l).reduce((a, id) => a + (l[id] ?? 0) * betRtp(id, variant), 0) / total;
}

export interface LayoutStats {
  rtp: number;
  /** Chance the round returns more than the total stake. */
  pProfit: number;
  /** Chance at least the stake comes back (profit or full push). */
  pBack: number;
  sd: number;
  /** Largest multiplier of the total stake this layout can pay. */
  maxMult: number;
}

export function layoutStats(l: Layout, variant: Variant): LayoutStats {
  const total = stakeOf(l);
  if (!(total > 0)) return { rtp: 0, pProfit: 0, pBack: 0, sd: 0, maxMult: 0 };
  let m1 = 0;
  let m2 = 0;
  let pProfit = 0;
  let pBack = 0;
  let maxMult = 0;
  for (const c of joint()) {
    const m = settle(l, c, variant).multiplier;
    m1 += c.p * m;
    m2 += c.p * m * m;
    if (m > 1 + 1e-9) pProfit += c.p;
    if (m >= 1 - 1e-9) pBack += c.p;
    maxMult = Math.max(maxMult, m);
  }
  return { rtp: m1, pProfit, pBack, sd: Math.sqrt(Math.max(0, m2 - m1 * m1)), maxMult };
}

export const RTP = betRtp('banker', 'classic');

// ---------- Closed forms (checked against the joint table by the tests) ----------

const D4 = SHOE * (SHOE - 1) * (SHOE - 2) * (SHOE - 3);

/** P(Player pair) = P(Banker pair): the second card of the hand matches the first's rank. */
export const pairClosed = 31 / 415;
/** P(a given hand is a suited pair): the second card is the same card as the first. */
export const suitedClosed = 7 / 415;
/** P(both hands pair), by ordered draws of the four cards. */
export function pairBothClosed(): number {
  const sameRank = 13 * 32 * 31 * 30 * 29;
  const twoRanks = 13 * 12 * 32 * 31 * 32 * 31;
  return (sameRank + twoRanks) / D4;
}
/** P(both hands are suited pairs). */
export function perfectBothClosed(): number {
  const sameKind = 52 * 8 * 7 * 6 * 5;
  const twoKinds = 52 * 51 * 8 * 7 * 8 * 7;
  return (sameKind + twoKinds) / D4;
}

// ---------- Layout helpers ----------

export function addTo(l: Layout, id: BetId, amount: number): Layout {
  return { ...l, [id]: cents((l[id] ?? 0) + amount) };
}

export function takeFrom(l: Layout, id: BetId, amount: number): Layout {
  const v = cents((l[id] ?? 0) - amount);
  const out = { ...l };
  if (v > 0.004) out[id] = v;
  else delete out[id];
  return out;
}

/** Scales a layout to a target total, keeping proportions, to the cent. */
export function scaleLayout(base: Layout, target: number): Layout {
  const ids = betsOf(base);
  const total = stakeOf(base);
  if (!(total > 0) || !(target > 0)) return { ...base };
  const f = target / total;
  const out: Layout = {};
  for (const id of ids) out[id] = Math.max(0.01, cents((base[id] ?? 0) * f));
  const diff = cents(cents(target) - stakeOf(out));
  if (diff !== 0) {
    const big = ids.reduce((a, b) => ((out[b] ?? 0) > (out[a] ?? 0) ? b : a));
    out[big] = Math.max(0.01, cents((out[big] ?? 0) + diff));
  }
  return out;
}

export type Volatility = 'low' | 'medium' | 'high' | 'extreme';

export function volatilityOf(sd: number): Volatility {
  if (sd < 1.2) return 'low';
  if (sd < 2.4) return 'medium';
  if (sd < 4.5) return 'high';
  return 'extreme';
}
