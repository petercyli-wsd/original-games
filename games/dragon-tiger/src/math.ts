// Dragon Tiger (the one-card baccarat cousin, offered as an RNG table at
// BC.Game, Stake and others). Each round deals two cards from a freshly
// shuffled 8-deck shoe (416 cards, 8 copies of each of the 52 cards): the
// first to Dragon, the second to Tiger. The higher rank wins, aces low
// (A = 1 … K = 13); equal ranks are a tie. The shoe is reshuffled every
// round, so rounds are independent and no counting strategy exists.
//
// Exact probabilities (ordered draws without replacement, 416 · 415 pairs):
//
//   same card (rank and suit)   8 · 7  · 52 pairs → 7 / 415   (suited tie)
//   same rank, other suit       8 · 8  · 52·3     → 24 / 415
//   tie (any equal rank)                            31 / 415
//   Dragon higher = Tiger higher (symmetry)         (415 − 31) / 2 / 415 = 192 / 415
//
// Each card on its own is uniform over the 52 kinds (the shoe holds the same
// number of each), so a side bet on one card has chance (#kinds that win)/52.
//
// Standard table (payouts "to one", a win also returns the chip):
//
//   bet                      wins when                         chance      pays          RTP
//   Dragon / Tiger           its card is higher                192/415     1:1           (2·192 + ½·31) / 415
//                            tie: half the chip comes back      31/415     ½ back        = 399.5/415 = 96.265%
//   Tie                      equal ranks                         31/415     8:1           9·31/415  = 279/415 = 67.229%
//   Suited tie               equal rank and suit                  7/415    50:1           51·7/415  = 357/415 = 86.024%
//   Big (8–K) / Small (A–6)  that side's card; a 7 loses          6/13      1:1           2·6/13    = 12/13   = 92.308%
//   Odd / Even               A 3 5 9 J K / 2 4 6 8 10 Q; 7 loses  6/13      1:1           12/13
//   Red / Black              suit colour; a 7 loses               6/13      1:1           12/13
//
// (Odd and Even each hold six ranks once the 7 is removed; Red and Black each
// hold 24 of the 52 kinds once the four 7s are removed.)
//
// A layout is a sum of independent bets on the same deal, so by linearity of
// expectation its RTP is the stake-weighted average of its bets' RTPs:
// RTP(layout) = Σ sᵢ·RTPᵢ / Σ sᵢ. The tests enumerate all 52 × 52 card kinds
// with their exact weights (8·7 for the same kind, 8·8 otherwise) for every
// bet and for random layouts, and check these fractions exactly.
//
// The main bet (manifest.rtp) is Dragon or Tiger: 399.5 / 415 = 799 / 830.
//
// Max payout: per unit of total stake, a layout pays a stake-weighted average
// of the returns of its bets, which never exceeds the largest single return,
// a suited tie at 51×. MAX_MULTIPLIER = 51.

export const DECKS = 8;
export const SHOE = DECKS * 52; // 416

export type Side = 'dragon' | 'tiger';

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

export type BetKind = 'main' | 'tie' | 'suited' | 'big' | 'small' | 'odd' | 'even' | 'red' | 'black';
export type SideKind = 'big' | 'small' | 'odd' | 'even' | 'red' | 'black';

export interface BetDef {
  id: string;
  kind: BetKind;
  side?: Side;
  name: string;
  /** Payout "to one" for a win. */
  pays: number;
}

export const MAIN_PAYS = 1;
export const TIE_PAYS = 8;
export const SUITED_PAYS = 50;
export const SIDE_PAYS = 1;
/** Share of a Dragon / Tiger chip returned on a tie. */
export const TIE_REFUND = 0.5;

export const MAX_MULTIPLIER = SUITED_PAYS + 1;

export const SIDE_KINDS: SideKind[] = ['big', 'small', 'odd', 'even', 'red', 'black'];
export const SIDE_NAME: Record<SideKind, string> = { big: 'Big', small: 'Small', odd: 'Odd', even: 'Even', red: 'Red', black: 'Black' };
export const SIDE_RULE: Record<SideKind, string> = { big: '8 – K', small: 'A – 6', odd: 'A 3 5 9 J K', even: '2 4 6 8 10 Q', red: '♥ ♦', black: '♠ ♣' };

const sideName = (s: Side) => (s === 'dragon' ? 'Dragon' : 'Tiger');

export const BETS: BetDef[] = [
  { id: 'dragon', kind: 'main', side: 'dragon', name: 'Dragon', pays: MAIN_PAYS },
  { id: 'tie', kind: 'tie', name: 'Tie', pays: TIE_PAYS },
  { id: 'suited', kind: 'suited', name: 'Suited tie', pays: SUITED_PAYS },
  { id: 'tiger', kind: 'main', side: 'tiger', name: 'Tiger', pays: MAIN_PAYS },
  ...(['dragon', 'tiger'] as Side[]).flatMap((side) =>
    SIDE_KINDS.map((k) => ({ id: `${side}-${k}`, kind: k, side, name: `${sideName(side)} ${SIDE_NAME[k]}`, pays: SIDE_PAYS }) as BetDef),
  ),
];
export const BET_BY_ID: Record<string, BetDef> = Object.fromEntries(BETS.map((b) => [b.id, b]));

/** Whether a side bet wins on one card (a 7 loses every side bet). */
export function sideWins(kind: SideKind, c: Card): boolean {
  if (c.rank === 7) return false;
  switch (kind) {
    case 'big':
      return c.rank >= 8;
    case 'small':
      return c.rank <= 6;
    case 'odd':
      return c.rank % 2 === 1;
    case 'even':
      return c.rank % 2 === 0;
    case 'red':
      return isRed(c);
    case 'black':
      return !isRed(c);
  }
}

export type Winner = Side | 'tie';
export const winnerOf = (d: Card, t: Card): Winner => (d.rank > t.rank ? 'dragon' : d.rank < t.rank ? 'tiger' : 'tie');
export const isSuitedTie = (d: Card, t: Card) => d.rank === t.rank && d.suit === t.suit;

/** Total return per unit staked on a bet (0 = lost, 2 = 1:1 win, 0.5 = half back). */
export function returnOf(bet: BetDef, d: Card, t: Card): number {
  const w = winnerOf(d, t);
  switch (bet.kind) {
    case 'main':
      return w === bet.side ? 1 + bet.pays : w === 'tie' ? TIE_REFUND : 0;
    case 'tie':
      return w === 'tie' ? 1 + bet.pays : 0;
    case 'suited':
      return isSuitedTie(d, t) ? 1 + bet.pays : 0;
    default:
      return sideWins(bet.kind, bet.side === 'dragon' ? d : t) ? 1 + bet.pays : 0;
  }
}

// ---------- Exact enumeration ----------

const kindCard = (k: number): Card => ({ rank: (k % 13) + 1, suit: Math.floor(k / 13) });
export const KINDS: Card[] = Array.from({ length: 52 }, (_, k) => kindCard(k));

/** Every ordered pair of card kinds with its exact weight out of 416 · 415. */
export const PAIRS: { d: Card; t: Card; w: number }[] = (() => {
  const out: { d: Card; t: Card; w: number }[] = [];
  for (let a = 0; a < 52; a++) for (let b = 0; b < 52; b++) out.push({ d: KINDS[a], t: KINDS[b], w: a === b ? DECKS * (DECKS - 1) : DECKS * DECKS });
  return out;
})();
export const PAIR_TOTAL = SHOE * (SHOE - 1); // 172,640

export interface BetStats {
  /** Probability the bet returns more than the chip. */
  chance: number;
  /** Probability of a push-like partial return (Dragon / Tiger on a tie). */
  partial: number;
  rtp: number;
  sd: number;
}

const statsCache = new Map<string, BetStats>();
export function betStats(id: string): BetStats {
  const hit = statsCache.get(id);
  if (hit) return hit;
  const b = BET_BY_ID[id];
  let win = 0;
  let part = 0;
  let m1 = 0;
  let m2 = 0;
  for (const { d, t, w } of PAIRS) {
    const r = returnOf(b, d, t);
    if (r > 1) win += w;
    else if (r > 0) part += w;
    m1 += w * r;
    m2 += w * r * r;
  }
  const rtp = m1 / PAIR_TOTAL;
  const s: BetStats = { chance: win / PAIR_TOTAL, partial: part / PAIR_TOTAL, rtp, sd: Math.sqrt(Math.max(0, m2 / PAIR_TOTAL - rtp * rtp)) };
  statsCache.set(id, s);
  return s;
}

/** Closed-form probabilities from the header. */
export const P_TIE = 31 / 415;
export const P_SUITED = 7 / 415;
export const P_SIDE_WIN = 192 / 415;
export const P_SIDE_BET = 6 / 13;

export const RTP = (2 * 192 + 0.5 * 31) / 415; // 0.962650…

// ---------- Layouts ----------

export type Layout = Record<string, number>;

const cents = (x: number) => Math.round(x * 100) / 100;

export const totalOf = (l: Layout) => cents(Object.values(l).reduce((a, b) => a + (b > 0 ? b : 0), 0));
export const placedIds = (l: Layout) => BETS.filter((b) => (l[b.id] ?? 0) > 0).map((b) => b.id);

/** Pays a layout on one deal: the amount returned, its multiplier of the total stake, and the bets that paid. */
export function settle(l: Layout, d: Card, t: Card) {
  const total = totalOf(l);
  let paid = 0;
  const winners: string[] = [];
  for (const id of placedIds(l)) {
    const r = returnOf(BET_BY_ID[id], d, t);
    if (r > 0) {
      paid += l[id] * r;
      winners.push(id);
    }
  }
  return { paid: cents(paid), multiplier: total > 0 ? paid / total : 0, winners };
}

export interface LayoutStats {
  /** Chance some chips come back. */
  pHit: number;
  /** Chance the layout returns more than it cost. */
  pProfit: number;
  rtp: number;
  sd: number;
  maxMult: number;
}

export function layoutStats(l: Layout): LayoutStats {
  const total = totalOf(l);
  const ids = placedIds(l);
  if (!(total > 0)) return { pHit: 0, pProfit: 0, rtp: 0, sd: 0, maxMult: 0 };
  let hit = 0;
  let profit = 0;
  let m1 = 0;
  let m2 = 0;
  let max = 0;
  for (const { d, t, w } of PAIRS) {
    let paid = 0;
    for (const id of ids) paid += l[id] * returnOf(BET_BY_ID[id], d, t);
    const m = paid / total;
    if (m > 0) hit += w;
    if (m > 1 + 1e-12) profit += w;
    m1 += w * m;
    m2 += w * m * m;
    if (m > max) max = m;
  }
  const mean = m1 / PAIR_TOTAL;
  return { pHit: hit / PAIR_TOTAL, pProfit: profit / PAIR_TOTAL, rtp: mean, sd: Math.sqrt(Math.max(0, m2 / PAIR_TOTAL - mean * mean)), maxMult: max };
}

/** Exact RTP of a layout: Σ sᵢ·RTPᵢ / Σ sᵢ. */
export function layoutRtp(l: Layout): number {
  const total = Object.values(l).reduce((a, b) => a + (b > 0 ? b : 0), 0);
  if (!(total > 0)) return 0;
  let s = 0;
  for (const id of placedIds(l)) s += l[id] * betStats(id).rtp;
  return s / total;
}

export type Vol = 'low' | 'medium' | 'high' | 'extreme';
/** Volatility label from the layout's standard deviation per unit staked (Dragon ≈ 0.97, Tie ≈ 2.37, Suited tie ≈ 6.6). */
export const volatilityOf = (sd: number): Vol => (sd < 1.3 ? 'low' : sd < 2 ? 'medium' : sd < 4.5 ? 'high' : 'extreme');

/**
 * Scales a layout so its total is `target` (to the cent), keeping its
 * proportions; rounding error goes on the largest bet so the total is exact.
 * Auto-bet uses it for its on-win / on-loss stake changes.
 */
export function scaleLayout(base: Layout, target: number): Layout {
  const total = totalOf(base);
  if (!(total > 0) || !(target > 0)) return { ...base };
  const f = target / total;
  const out: Layout = {};
  for (const id of placedIds(base)) out[id] = Math.max(0.01, cents(base[id] * f));
  const diff = cents(cents(target) - totalOf(out));
  if (diff !== 0) {
    const ids = placedIds(out);
    const big = ids.reduce((a, b) => (out[b] > out[a] ? b : a));
    out[big] = Math.max(0.01, cents(out[big] + diff));
  }
  return out;
}

// ---------- The deal ----------

/** The physical card at shoe position i (0 … 415): 8 copies of each of the 52 kinds. */
export const shoeCard = (i: number): Card => kindCard(i % 52);

/**
 * Deals Dragon then Tiger from a fresh shoe using two uniforms: Dragon takes
 * one of the 416 cards, Tiger one of the other 415 (exactly uniform over
 * ordered pairs of distinct physical cards).
 */
export function deal(u1: number, u2: number): { dragon: Card; tiger: Card } {
  const i = Math.min(SHOE - 1, Math.floor(u1 * SHOE));
  let j = Math.min(SHOE - 2, Math.floor(u2 * (SHOE - 1)));
  if (j >= i) j++;
  return { dragon: shoeCard(i), tiger: shoeCard(j) };
}

/** "1:1", "8:1", "50:1". */
export const paysLabel = (b: BetDef) => `${b.pays}:1`;
