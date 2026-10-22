// Blackjack (Stake, Roobet, BC.Game, Shuffle): the standard table game,
// dealt from an infinite deck, so every card is an independent uniform draw
// from the 52 (each of the 13 ranks has probability 1/13; ten-valued cards
// together 4/13).
//
// Rules: blackjack pays 3:2; the dealer stands on soft 17 and peeks for
// blackjack under an ace or a ten (so you only ever lose your original bet to
// a dealer blackjack); double on any first two cards, also after a split;
// split any two cards of the same value once (split aces get one card each,
// and an ace-ten after a split is 21, not blackjack); insurance against an
// ace pays 2:1; no surrender. Any 21 stands automatically.
//
// Exact RTP. With an infinite deck the dealer's final total depends only on
// the up card, so a short recursion gives the exact distribution of
// {17, 18, 19, 20, 21, bust} for each up card (conditioned on "no blackjack"
// when the dealer has peeked). The value of standing on t is then
// P(win) − P(lose). Hitting, doubling and splitting are expectations over
// the next card, so dynamic programming over (hard total, holds an ace,
// two-card hand, pair) gives the exact value of every decision. Playing the
// best decision everywhere is basic strategy (for an infinite deck the
// best play depends on nothing else), and averaging over the 13³ deals gives
//
//   main bet RTP = 1 + E[net] / bet = 99.42961…% per original bet (edge 0.570%)
//
// (the usual way a blackjack edge is quoted; `basicValue().rtp`). Because doubles
// and splits add stakes, the return per unit actually wagered is slightly
// higher (`basicValue().rtpPerWagered` = 99.4939…%; 1.1269 units are wagered per round). The same recursion evaluates
// any other strategy exactly (`evaluatePolicy`), which the eval uses to price
// its sampled players.
//
// Side bets, settled on the deal, priced exactly over the 52-card draws:
//   Pairs (your first two cards): perfect pair 25:1, coloured 12:1, mixed 5:1.
//     P = 1/52, 1/52, 2/52, so RTP = (26 + 13 + 2·6) / 52 = 51/52 = 98.077%.
//   21+3 (your two cards + the dealer's up card as a 3-card poker hand):
//     suited trips 100:1, straight flush 40:1, trips 30:1, straight 10:1,
//     flush 5:1. Counts out of 52³ = 140,608: 52, 288, 780, 4,320, 8,448,
//     so RTP = 139,448 / 140,608 = 99.175%.
// Insurance costs half the bet and returns 3× it when the dealer has
// blackjack (P = 4/13), so it returns 12/13 = 92.31%; basic strategy never
// takes it.

export const ACCENT = '#10b981';

// ---------------------------------------------------------------- cards

export interface Card {
  /** 1 = ace, 11–13 = J, Q, K. */
  rank: number;
  /** 0 ♠, 1 ♥, 2 ♦, 3 ♣. */
  suit: number;
}

export const cardOf = (i: number): Card => ({ rank: (i % 13) + 1, suit: Math.floor(i / 13) % 4 });
export const valueOf = (c: Card) => Math.min(c.rank, 10);
export const isRed = (suit: number) => suit === 1 || suit === 2;
export const RANK_LABEL = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const SUIT_LABEL = ['♠', '♥', '♦', '♣'];

/** Probability of each card value 1..10 (index 0 unused). */
export const P_VALUE = [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 4].map((n, i) => (i === 0 ? 0 : n / 13));

export interface Total {
  /** Best total (an ace counts 11 when that doesn't bust). */
  total: number;
  /** Total with every ace counted as 1. */
  hard: number;
  /** An ace is currently counted as 11. */
  soft: boolean;
  ace: boolean;
}

export const best = (hard: number, ace: boolean) => (ace && hard + 10 <= 21 ? hard + 10 : hard);

export function handTotal(cards: readonly Card[]): Total {
  let hard = 0;
  let ace = false;
  for (const c of cards) {
    hard += valueOf(c);
    if (c.rank === 1) ace = true;
  }
  const total = best(hard, ace);
  return { total, hard, soft: total !== hard, ace };
}

/** "7/17" for soft totals, as players expect. */
export function totalLabel(cards: readonly Card[]): string {
  const t = handTotal(cards);
  if (cards.length === 2 && t.total === 21) return '21';
  return t.soft && t.total < 21 ? `${t.hard}/${t.total}` : String(t.total);
}

// ---------------------------------------------------------------- the table

export interface Hand {
  cards: Card[];
  doubled: boolean;
  /** Came from a split (so a two-card 21 is not blackjack). */
  split: boolean;
  done: boolean;
}

export interface Table {
  /** [up card, hole card, ...dealer draws]. */
  dealer: Card[];
  hands: Hand[];
  /** Index of the hand being played (= hands.length once the player is done). */
  active: number;
}

export type Draw = () => Card;
export type Action = 'hit' | 'stand' | 'double' | 'split';

export const isBlackjack = (h: Hand) => !h.split && h.cards.length === 2 && handTotal(h.cards).total === 21;
export const dealerUp = (t: Table) => t.dealer[0];
export const dealerBlackjack = (t: Table) => handTotal(t.dealer.slice(0, 2)).total === 21;
/** The dealer peeks under an ace or a ten. */
export const dealerPeeks = (t: Table) => valueOf(t.dealer[0]) === 1 || valueOf(t.dealer[0]) === 10;
export const offersInsurance = (t: Table) => t.dealer[0].rank === 1;

/** Deals in casino order: player, dealer up, player, dealer hole. */
export function deal(draw: Draw): Table {
  const p1 = draw();
  const up = draw();
  const p2 = draw();
  const hole = draw();
  return { dealer: [up, hole], hands: [{ cards: [p1, p2], doubled: false, split: false, done: false }], active: 0 };
}

export interface Legal {
  hit: boolean;
  stand: boolean;
  double: boolean;
  split: boolean;
}

export function legal(t: Table): Legal {
  const h = t.hands[t.active];
  if (!h || h.done) return { hit: false, stand: false, double: false, split: false };
  const two = h.cards.length === 2;
  return {
    hit: true,
    stand: true,
    double: two,
    split: two && t.hands.length === 1 && valueOf(h.cards[0]) === valueOf(h.cards[1]),
  };
}

const bust = (h: Hand) => handTotal(h.cards).hard > 21;

/** Marks a hand done if it busted, reached 21 or is a split ace. */
function settleHandState(h: Hand, splitAces: boolean): Hand {
  const { total, hard } = handTotal(h.cards);
  const done = h.done || hard > 21 || total === 21 || (splitAces && h.cards.length >= 2);
  return { ...h, done };
}

/** Moves on past finished hands, dealing a split hand its second card when it comes up. */
function advance(t: Table, draw: Draw): Table {
  const hands = t.hands.slice();
  let active = t.active;
  while (active < hands.length && hands[active].done) {
    active++;
    const next = hands[active];
    if (next && next.cards.length === 1) {
      hands[active] = settleHandState({ ...next, cards: [...next.cards, draw()] }, next.cards[0].rank === 1);
    }
  }
  return { ...t, hands, active };
}

/** Starts the player's turn (call after any peek): 21 stands at once. */
export function begin(t: Table, draw: Draw): Table {
  const hands = t.hands.map((h) => settleHandState(h, false));
  return advance({ ...t, hands }, draw);
}

export function act(t: Table, a: Action, draw: Draw): Table {
  const L = legal(t);
  if (!L[a]) throw new Error(`Illegal action ${a}`);
  const hands = t.hands.slice();
  const h = hands[t.active];
  if (a === 'stand') hands[t.active] = { ...h, done: true };
  else if (a === 'hit') hands[t.active] = settleHandState({ ...h, cards: [...h.cards, draw()] }, false);
  else if (a === 'double') hands[t.active] = { ...h, cards: [...h.cards, draw()], doubled: true, done: true };
  else {
    const [c1, c2] = h.cards;
    const aces = c1.rank === 1;
    const first = settleHandState({ cards: [c1, draw()], doubled: false, split: true, done: false }, aces);
    let second: Hand = { cards: [c2], doubled: false, split: true, done: false };
    // Split aces get their one card each straight away.
    if (aces) second = settleHandState({ ...second, cards: [c2, draw()] }, true);
    hands.splice(t.active, 1, first, second);
  }
  return advance({ ...t, hands }, draw);
}

export const playerDone = (t: Table) => t.active >= t.hands.length;

/** The dealer draws to 17 (standing on soft 17), unless every hand has busted. */
export function dealerPlay(t: Table, draw: Draw): Table {
  if (t.hands.every(bust)) return t;
  const dealer = t.dealer.slice();
  for (;;) {
    const { total } = handTotal(dealer);
    if (total >= 17) break;
    dealer.push(draw());
  }
  return { ...t, dealer };
}

export type HandResult = 'blackjack' | 'win' | 'push' | 'lose' | 'bust';

/** A finished hand's result and its return per unit of that hand's stake. */
export function handResult(h: Hand, dealer: readonly Card[]): { result: HandResult; mult: number } {
  const p = handTotal(h.cards);
  const dealerBJ = dealer.length >= 2 && handTotal(dealer.slice(0, 2)).total === 21;
  if (p.hard > 21) return { result: 'bust', mult: 0 };
  if (isBlackjack(h)) return dealerBJ ? { result: 'push', mult: 1 } : { result: 'blackjack', mult: 2.5 };
  if (dealerBJ) return { result: 'lose', mult: 0 };
  const d = handTotal(dealer).total;
  if (d > 21 || p.total > d) return { result: 'win', mult: 2 };
  if (p.total === d) return { result: 'push', mult: 1 };
  return { result: 'lose', mult: 0 };
}

/** Stake units on a hand. */
export const handUnits = (h: Hand) => (h.doubled ? 2 : 1);

// ---------------------------------------------------------------- side bets

export type PairsKind = 'perfect' | 'coloured' | 'mixed';
export const PAIRS_PAYS: Record<PairsKind, number> = { perfect: 25, coloured: 12, mixed: 5 };
export const PAIRS_NAME: Record<PairsKind, string> = { perfect: 'Perfect pair', coloured: 'Coloured pair', mixed: 'Mixed pair' };

export function pairsKind(a: Card, b: Card): PairsKind | null {
  if (a.rank !== b.rank) return null;
  if (a.suit === b.suit) return 'perfect';
  return isRed(a.suit) === isRed(b.suit) ? 'coloured' : 'mixed';
}
/** Return per unit staked on Pairs (0 on a loss). */
export const pairsMult = (a: Card, b: Card) => {
  const k = pairsKind(a, b);
  return k ? PAIRS_PAYS[k] + 1 : 0;
};
export const PAIRS_RTP = 51 / 52;

export type TripsKind = 'suited-trips' | 'straight-flush' | 'trips' | 'straight' | 'flush';
export const TRIPS_PAYS: Record<TripsKind, number> = { 'suited-trips': 100, 'straight-flush': 40, trips: 30, straight: 10, flush: 5 };
export const TRIPS_NAME: Record<TripsKind, string> = {
  'suited-trips': 'Suited trips',
  'straight-flush': 'Straight flush',
  trips: 'Three of a kind',
  straight: 'Straight',
  flush: 'Flush',
};
export const TRIPS_ORDER: TripsKind[] = ['suited-trips', 'straight-flush', 'trips', 'straight', 'flush'];

export function tripsKind(a: Card, b: Card, c: Card): TripsKind | null {
  const flush = a.suit === b.suit && b.suit === c.suit;
  const trips = a.rank === b.rank && b.rank === c.rank;
  const r = [a.rank, b.rank, c.rank].sort((x, y) => x - y);
  const straight = (r[0] + 1 === r[1] && r[1] + 1 === r[2]) || (r[0] === 1 && r[1] === 12 && r[2] === 13);
  if (trips && flush) return 'suited-trips';
  if (straight && flush) return 'straight-flush';
  if (trips) return 'trips';
  if (straight) return 'straight';
  if (flush) return 'flush';
  return null;
}
export const tripsMult = (a: Card, b: Card, c: Card) => {
  const k = tripsKind(a, b, c);
  return k ? TRIPS_PAYS[k] + 1 : 0;
};
/** Ways out of 52³ ordered draws for each 21+3 hand (checked by enumeration in the tests). */
export const TRIPS_WAYS: Record<TripsKind, number> = { 'suited-trips': 52, 'straight-flush': 288, trips: 780, straight: 4320, flush: 8448 };
export const TRIPS_RTP = 139_448 / 140_608;

export const INSURANCE_RTP = 12 / 13;

/** Side-bet sizes as a fraction of the main bet. */
export const SIDE_SIZES = [0, 0.25, 0.5, 1] as const;
export type SideSize = (typeof SIDE_SIZES)[number];

/**
 * Honest bound on everything returned in a round, per unit of main bet:
 * split, double both hands and win both (8) plus a suited trips that is
 * also a perfect pair (26 + 101) with both side bets at 1× the main bet.
 */
export const MAX_MULTIPLIER = 8 + (PAIRS_PAYS.perfect + 1) + (TRIPS_PAYS['suited-trips'] + 1);

// ---------------------------------------------------------------- exact dealer odds

/** Dealer final totals: index 0..4 = 17..21, 5 = bust. */
export type DealerDist = number[];

const dealerMemo = new Map<number, DealerDist>();
function dealerFrom(hard: number, ace: boolean): DealerDist {
  const key = hard * 2 + (ace ? 1 : 0);
  const hit = dealerMemo.get(key);
  if (hit) return hit;
  const out = [0, 0, 0, 0, 0, 0];
  if (hard > 21) out[5] = 1;
  else {
    const t = best(hard, ace);
    if (t >= 17) out[t - 17] = 1;
    else
      for (let v = 1; v <= 10; v++) {
        const d = dealerFrom(hard + v, ace || v === 1);
        for (let i = 0; i < 6; i++) out[i] += P_VALUE[v] * d[i];
      }
  }
  dealerMemo.set(key, out);
  return out;
}

/** Chance the dealer has blackjack, given the up card's value. */
export const dealerBJChance = (up: number) => (up === 1 ? P_VALUE[10] : up === 10 ? P_VALUE[1] : 0);

const distMemo = new Map<string, DealerDist>();
/** The dealer's final total for an up card, after the peek has shown no blackjack (when `peeked`). */
export function dealerDist(up: number, peeked = true): DealerDist {
  const key = `${up}:${peeked}`;
  const hit = distMemo.get(key);
  if (hit) return hit;
  const out = [0, 0, 0, 0, 0, 0];
  let mass = 0;
  for (let v = 1; v <= 10; v++) {
    const isBJ = (up === 1 && v === 10) || (up === 10 && v === 1);
    if (peeked && isBJ) continue;
    mass += P_VALUE[v];
    // A blackjack counts as a 21 here; callers that need it separately use dealerBJChance.
    const d = dealerFrom(up + v, up === 1 || v === 1);
    for (let i = 0; i < 6; i++) out[i] += P_VALUE[v] * d[i];
  }
  for (let i = 0; i < 6; i++) out[i] /= mass;
  distMemo.set(key, out);
  return out;
}

/** P(win), P(push), P(lose) for standing on `total` against a dealer distribution. */
export function standOdds(total: number, d: DealerDist) {
  if (total > 21) return { win: 0, push: 0, lose: 1 };
  let win = d[5];
  let push = 0;
  let lose = 0;
  for (let i = 0; i < 5; i++) {
    const dt = 17 + i;
    if (total > dt) win += d[i];
    else if (total === dt) push += d[i];
    else lose += d[i];
  }
  return { win, push, lose };
}

export const standEV = (total: number, d: DealerDist) => {
  const o = standOdds(total, d);
  return o.win - o.lose;
};

// ---------------------------------------------------------------- exact strategy values

export interface Ctx {
  /** Dealer up card value, 1 (ace) to 10. */
  up: number;
  hard: number;
  ace: boolean;
  total: number;
  soft: boolean;
  /** Cards in the hand. */
  n: number;
  /** The value of a splittable pair, else null. */
  pair: number | null;
  canDouble: boolean;
  canSplit: boolean;
  /** This hand came from a split. */
  split: boolean;
}

export interface Values {
  stand: number;
  hit: number;
  double: number | null;
  split: number | null;
}

interface UpTables {
  /** Optimal value of a hand that can only hit or stand. */
  hs: Float64Array;
  /** Optimal value of a two-card hand that may double (not split). */
  two: Float64Array;
  d: DealerDist;
}

const key2 = (hard: number, ace: boolean) => hard * 2 + (ace ? 1 : 0);
const upMemo = new Map<number, UpTables>();

function tablesFor(up: number): UpTables {
  const hit = upMemo.get(up);
  if (hit) return hit;
  const d = dealerDist(up, true);
  const hs = new Float64Array(64);
  const two = new Float64Array(64);
  // Hard totals from high to low, so every successor is already known.
  for (let hard = 31; hard >= 2; hard--) {
    for (const ace of [true, false]) {
      const k = key2(hard, ace);
      if (hard > 21) {
        hs[k] = two[k] = -1;
        continue;
      }
      const t = best(hard, ace);
      const s = standEV(t, d);
      if (t === 21) {
        hs[k] = two[k] = s;
        continue;
      }
      let h = 0;
      let dbl = 0;
      for (let v = 1; v <= 10; v++) {
        const nh = hard + v;
        const na = ace || v === 1;
        h += P_VALUE[v] * (nh > 21 ? -1 : hs[key2(nh, na)]);
        dbl += P_VALUE[v] * 2 * (nh > 21 ? -1 : standEV(best(nh, na), d));
      }
      hs[k] = Math.max(s, h);
      two[k] = Math.max(s, h, dbl);
    }
  }
  const out = { hs, two, d };
  upMemo.set(up, out);
  return out;
}

/** Value of a split hand that starts with one card of value v (per hand). */
function splitHandValue(v: number, up: number): number {
  const { two, d } = tablesFor(up);
  let ev = 0;
  for (let c = 1; c <= 10; c++) {
    const hard = v + c;
    const ace = v === 1 || c === 1;
    ev += P_VALUE[c] * (v === 1 ? standEV(best(hard, ace), d) : two[key2(hard, ace)]);
  }
  return ev;
}

/** Exact expected net (per unit of this hand's stake) of each action, after the peek. */
export function actionValues(ctx: Ctx): Values {
  const { hs, d } = tablesFor(ctx.up);
  const stand = standEV(ctx.total, d);
  let hit = 0;
  let dbl = 0;
  for (let v = 1; v <= 10; v++) {
    const nh = ctx.hard + v;
    const na = ctx.ace || v === 1;
    hit += P_VALUE[v] * (nh > 21 ? -1 : hs[key2(nh, na)]);
    dbl += P_VALUE[v] * 2 * (nh > 21 ? -1 : standEV(best(nh, na), d));
  }
  return {
    stand,
    hit,
    double: ctx.canDouble ? dbl : null,
    split: ctx.canSplit && ctx.pair !== null ? 2 * splitHandValue(ctx.pair, ctx.up) : null,
  };
}

/** Basic strategy: the action with the highest exact value (ties go to the simpler play). */
export function bestAction(ctx: Ctx): Action {
  if (ctx.total >= 21) return 'stand';
  const v = actionValues(ctx);
  let a: Action = 'stand';
  let ev = v.stand;
  if (v.hit > ev + 1e-12) [a, ev] = ['hit', v.hit];
  if (v.double !== null && v.double > ev + 1e-12) [a, ev] = ['double', v.double];
  if (v.split !== null && v.split > ev + 1e-12) a = 'split';
  return a;
}

export function ctxOf(t: Table): Ctx | null {
  const h = t.hands[t.active];
  if (!h || h.done) return null;
  const tt = handTotal(h.cards);
  const L = legal(t);
  return {
    up: valueOf(t.dealer[0]),
    hard: tt.hard,
    ace: tt.ace,
    total: tt.total,
    soft: tt.soft,
    n: h.cards.length,
    pair: L.split ? valueOf(h.cards[0]) : null,
    canDouble: L.double,
    canSplit: L.split,
    split: h.split,
  };
}

// ---------------------------------------------------------------- policies, evaluated exactly

export interface Policy {
  name: string;
  play(ctx: Ctx): Action;
  /** Whether to take insurance against an ace (given the player's first two cards). */
  insure(ctx: Ctx): boolean;
}

export const BASIC_POLICY: Policy = { name: 'basic strategy', play: bestAction, insure: () => false };
export const INSURE_POLICY: Policy = { name: 'basic + insurance', play: bestAction, insure: () => true };
/** Hits to 17 like the dealer: never doubles or splits. */
export const MIMIC_POLICY: Policy = { name: 'mimic the dealer', play: (c) => (c.total < 17 ? 'hit' : 'stand'), insure: () => false };
/** Never risks a bust; doubles 10 and 11 against weak cards and splits aces and eights. */
export const CAUTIOUS_POLICY: Policy = {
  name: 'never bust',
  play: (c) => {
    if (c.canSplit && (c.pair === 1 || c.pair === 8)) return 'split';
    if (c.canDouble && !c.soft && (c.total === 10 || c.total === 11) && c.up >= 2 && c.up <= 9) return 'double';
    if (c.soft) return c.total < 18 ? 'hit' : 'stand';
    return c.total < 12 ? 'hit' : 'stand';
  },
  insure: () => false,
};

export interface PolicyValue {
  /** Exact RTP per original bet: 1 + E[net]. */
  rtp: number;
  /** Expected units wagered per round (1 + doubles, splits, insurance). */
  wagered: number;
  /** Return per unit actually wagered. */
  rtpPerWagered: number;
}

interface EvRes {
  ev: number;
  w: number;
}

/** Exact value of a policy, by the same recursion over every deal and draw. */
export function evaluatePolicy(policy: Policy): PolicyValue {
  let net = 0;
  let wagered = 0;
  for (let up = 1; up <= 10; up++) {
    const d = dealerDist(up, true);
    const memo = new Map<string, EvRes>();
    const hand = (hard: number, ace: boolean, n: number, pair: number | null, split: boolean, splitAces: boolean): EvRes => {
      if (hard > 21) return { ev: -1, w: 1 };
      const total = best(hard, ace);
      if (total === 21 || (splitAces && n >= 2)) return { ev: standEV(total, d), w: 1 };
      const key = `${hard},${ace},${n},${pair},${split}`;
      const m = memo.get(key);
      if (m) return m;
      const ctx: Ctx = { up, hard, ace, total, soft: total !== hard, n, pair, canDouble: n === 2, canSplit: pair !== null, split };
      const a = policy.play(ctx);
      let r: EvRes;
      if (a === 'stand') r = { ev: standEV(total, d), w: 1 };
      else if (a === 'double' && ctx.canDouble) {
        let ev = 0;
        for (let v = 1; v <= 10; v++) ev += P_VALUE[v] * (hard + v > 21 ? -2 : 2 * standEV(best(hard + v, ace || v === 1), d));
        r = { ev, w: 2 };
      } else if (a === 'split' && pair !== null) {
        let ev = 0;
        let w = 0;
        for (let v = 1; v <= 10; v++) {
          const sub = hand(pair + v, pair === 1 || v === 1, 2, null, true, pair === 1);
          ev += P_VALUE[v] * sub.ev;
          w += P_VALUE[v] * sub.w;
        }
        r = { ev: 2 * ev, w: 2 * w };
      } else {
        // Hit (also the fallback for an illegal choice).
        let ev = 0;
        let w = 0;
        for (let v = 1; v <= 10; v++) {
          const sub = hand(hard + v, ace || v === 1, n + 1, null, split, false);
          ev += P_VALUE[v] * sub.ev;
          w += P_VALUE[v] * sub.w;
        }
        r = { ev, w };
      }
      memo.set(key, r);
      return r;
    };

    const pBJ = dealerBJChance(up);
    for (let c1 = 1; c1 <= 10; c1++) {
      for (let c2 = 1; c2 <= 10; c2++) {
        const p = P_VALUE[up] * P_VALUE[c1] * P_VALUE[c2];
        const hard = c1 + c2;
        const ace = c1 === 1 || c2 === 1;
        const total = best(hard, ace);
        const playerBJ = total === 21;
        let roundNet: number;
        let roundW: number;
        if (playerBJ) {
          roundNet = (1 - pBJ) * 1.5;
          roundW = 1;
        } else {
          const r = hand(hard, ace, 2, c1 === c2 ? c1 : null, false, false);
          roundNet = pBJ * -1 + (1 - pBJ) * r.ev;
          roundW = pBJ + (1 - pBJ) * r.w;
        }
        if (up === 1) {
          const ctx: Ctx = { up, hard, ace, total, soft: total !== hard, n: 2, pair: c1 === c2 ? c1 : null, canDouble: true, canSplit: c1 === c2, split: false };
          if (policy.insure(ctx)) {
            roundNet += pBJ * 1 - (1 - pBJ) * 0.5;
            roundW += 0.5;
          }
        }
        net += p * roundNet;
        wagered += p * roundW;
      }
    }
  }
  return { rtp: 1 + net, wagered, rtpPerWagered: (wagered + net) / wagered };
}

let basicCache: PolicyValue | null = null;
/** Exact values of basic strategy (lazy, a few ms). */
export const basicValue = () => (basicCache ??= evaluatePolicy(BASIC_POLICY));

/** Basic strategy's exact RTP per original bet. */
export const RTP = basicValue().rtp;

// ---------------------------------------------------------------- odds shown on screen

/** Chance the dealer busts from an up card (after the peek, when it applies). */
export const dealerBustChance = (up: number, peeked = true) => dealerDist(up, peeked)[5];

/** Dealer bust chance averaged over every up card (before the deal). */
export const DEALER_BUST_ANY = (() => {
  let p = 0;
  for (let up = 1; up <= 10; up++) {
    // Unconditioned: a dealer blackjack is not a bust.
    p += P_VALUE[up] * dealerDist(up, false)[5];
  }
  return p;
})();

/**
 * Expected return (per unit of each hand's stake, summed over hands, with the
 * hand's units) of the hands still in play, if the player stops making new
 * wagers and plays hit/stand basic strategy. Used to settle a round fairly if
 * the player leaves mid-hand. `peeked` is false only while insurance is open.
 */
export function expectedHandReturn(t: Table, peeked: boolean): number {
  const up = valueOf(t.dealer[0]);
  const { hs, d } = tablesFor(up);
  const handNet = (h: Hand): number => {
    const tt = handTotal(h.cards);
    if (tt.hard > 21) return -handUnits(h);
    if (h.cards.length === 1) {
      // A split hand still waiting for its second card.
      const v = valueOf(h.cards[0]);
      let ev = 0;
      for (let c = 1; c <= 10; c++) {
        const nh = v + c;
        const na = v === 1 || c === 1;
        ev += P_VALUE[c] * (v === 1 ? standEV(best(nh, na), d) : hs[key2(nh, na)]);
      }
      return ev;
    }
    if (h.done) return handUnits(h) * standEV(tt.total, d);
    return hs[key2(tt.hard, tt.ace)];
  };
  if (!peeked) {
    const h = t.hands[0];
    const pBJ = dealerBJChance(up);
    if (isBlackjack(h)) return pBJ * 1 + (1 - pBJ) * 2.5;
    return (1 - pBJ) * (1 + handNet(h));
  }
  let ret = 0;
  for (const h of t.hands) {
    if (isBlackjack(h)) ret += 2.5;
    else ret += handUnits(h) + handNet(h);
  }
  return ret;
}

// ---------------------------------------------------------------- strategy chart

export type ChartCell = 'H' | 'S' | 'D' | 'Ds' | 'P';
export const CHART_UPS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 1];

function chartCell(ctx: Omit<Ctx, 'up'>, up: number): ChartCell {
  const a = bestAction({ ...ctx, up });
  if (a === 'split') return 'P';
  if (a === 'double') {
    // When doubling isn't allowed (3+ cards), what would you do instead?
    const v = actionValues({ ...ctx, up });
    return v.stand >= v.hit ? 'Ds' : 'D';
  }
  return a === 'hit' ? 'H' : 'S';
}

/** The exact basic-strategy chart for these rules: hard 5–17, soft 13–20, pairs. */
export function strategyChart() {
  const two = (hard: number, ace: boolean, pair: number | null) => {
    const total = best(hard, ace);
    return { hard, ace, total, soft: total !== hard, n: 2, pair, canDouble: true, canSplit: pair !== null, split: false };
  };
  const hard = [];
  for (let t = 5; t <= 17; t++) hard.push({ label: String(t), cells: CHART_UPS.map((up) => chartCell(two(t, false, null), up)) });
  const soft = [];
  for (let o = 2; o <= 9; o++) soft.push({ label: `A,${o}`, cells: CHART_UPS.map((up) => chartCell(two(1 + o, true, null), up)) });
  const pairs = [];
  for (const v of [1, 10, 9, 8, 7, 6, 5, 4, 3, 2]) {
    const lbl = v === 1 ? 'A,A' : v === 10 ? '10,10' : `${v},${v}`;
    pairs.push({ label: lbl, cells: CHART_UPS.map((up) => chartCell(two(2 * v, v === 1, v), up)) });
  }
  return { hard, soft, pairs };
}

// ---------------------------------------------------------------- one full round, headless

export interface Sides {
  /** Pairs stake as a fraction of the main bet. */
  pairs: number;
  /** 21+3 stake as a fraction of the main bet. */
  trips: number;
}

export interface RoundOutcome {
  table: Table;
  /** Units wagered (main bet = 1) and returned, side bets and insurance included. */
  wagered: number;
  returned: number;
  insured: boolean;
  decisions: number;
}

/**
 * Plays one round with the same engine the table uses, a policy making the
 * player's choices. The eval and the tests run this; the UI runs the same
 * steps one at a time with animation.
 */
export function playOut(policy: Policy, sides: Sides, draw: Draw): RoundOutcome {
  let t = deal(draw);
  const [p1, p2] = t.hands[0].cards;
  const up = t.dealer[0];
  let wagered = 1 + sides.pairs + sides.trips;
  let returned = sides.pairs * pairsMult(p1, p2) + sides.trips * tripsMult(p1, p2, up);
  let decisions = 0;
  let insured = false;
  if (offersInsurance(t)) {
    decisions++;
    const tt = handTotal(t.hands[0].cards);
    const ctx: Ctx = { up: 1, hard: tt.hard, ace: tt.ace, total: tt.total, soft: tt.soft, n: 2, pair: legal(t).split ? valueOf(p1) : null, canDouble: true, canSplit: legal(t).split, split: false };
    insured = policy.insure(ctx);
    if (insured) {
      wagered += 0.5;
      if (dealerBlackjack(t)) returned += 1.5;
    }
  }
  if (dealerPeeks(t) && dealerBlackjack(t)) {
    returned += handResult(t.hands[0], t.dealer).mult;
    return { table: t, wagered, returned, insured, decisions };
  }
  if (isBlackjack(t.hands[0])) return { table: t, wagered, returned: returned + 2.5, insured, decisions };
  t = begin(t, draw);
  while (!playerDone(t)) {
    const ctx = ctxOf(t)!;
    let a = policy.play(ctx);
    if (!legal(t)[a]) a = 'hit';
    if (a === 'double' || a === 'split') wagered += 1;
    t = act(t, a, draw);
    decisions++;
  }
  t = dealerPlay(t, draw);
  for (const h of t.hands) returned += handUnits(h) * handResult(h, t.dealer).mult;
  return { table: t, wagered, returned, insured, decisions };
}
