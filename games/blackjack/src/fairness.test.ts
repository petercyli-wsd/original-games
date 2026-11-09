// Fairness audit: can any way of playing Blackjack beat its stated RTP?
//
// Blackjack is a skill game: the target is that OPTIMAL play returns the
// stated RTP (basic strategy, 99.43%) and nothing does better. The round's
// value is V*(state) = the optimal expected net (per unit of the main bet,
// counting doubles and splits) given everything on screen. We check, with
// the real engine (deal, begin, act, dealerPlay, handResult):
//
//   - Bellman/martingale: at hundreds of reachable states, for every legal
//     action a, E[V*(next state) | a] (exact enumeration of the cards drawn)
//     equals the DP's value of a, and V*(state) = max over a. So V* is a
//     martingale under optimal play and a supermartingale under any other.
//   - The dealer's reveal (the last event) is priced right: E over the hole
//     card (conditioned on the peek) and every dealer draw of the settled net
//     equals V* of the finished hands.
//   - E[V* at the start] over every deal through deal()/begin() = RTP − 1.
//   - The only "cash-out" is leaving mid-hand, which settles open hands at
//     expectedHandReturn (hit/stand only). It is never worth more than V*,
//     so leaving can't beat playing on.
//
// Then realized play with the real engine, ≥ 200k rounds each:
//   (a) take basic strategy's action when a hit survives with chance ≥ 0.8,
//       else leave mid-hand (the leave value is the cash-out);
//   (b) leave the moment the leave value exceeds the money staked;
//   (c) every eval config (sampled players and side bets), and basic alone;
//   (d) the strongest ideas: basic + leave whenever leaving is worth at least
//       playing on, max-variance (double / split whenever allowed), always
//       insure.

import { createRng, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import {
  P_VALUE,
  RTP,
  act,
  actionValues,
  bestAction,
  begin,
  cardOf,
  ctxOf,
  deal,
  dealerBlackjack,
  dealerDist,
  dealerPeeks,
  dealerPlay,
  expectedHandReturn,
  handResult,
  handTotal,
  handUnits,
  isBlackjack,
  legal,
  offersInsurance,
  pairsMult,
  playerDone,
  standEV,
  tripsMult,
  valueOf,
  type Action,
  type Card,
  type Ctx,
  type Draw,
  type Table,
} from './math';

const C = (rank: number): Card => ({ rank, suit: 0 });
const ACTIONS: Action[] = ['hit', 'stand', 'double', 'split'];

/** Optimal value of a two-card hand that may hit, stand or double (no split): split hands, after their second card. */
function twoCardOpt(up: number, cards: Card[]): number {
  const t = handTotal(cards);
  const d = dealerDist(up, true);
  if (t.total === 21) return standEV(21, d);
  const v = actionValues({ up, hard: t.hard, ace: t.ace, total: t.total, soft: t.soft, n: 2, pair: null, canDouble: true, canSplit: false, split: true });
  return Math.max(v.stand, v.hit, v.double!);
}

/** V*(t): exact optimal expected net (units of the main bet) of the hands on the table, after the peek. */
function vStar(t: Table): number {
  const up = valueOf(t.dealer[0]);
  const d = dealerDist(up, true);
  let net = 0;
  t.hands.forEach((h, i) => {
    const tt = handTotal(h.cards);
    if (tt.hard > 21) net -= handUnits(h);
    else if (h.done) net += handUnits(h) * standEV(tt.total, d);
    else if (h.cards.length === 1) {
      // A split hand still waiting for its second card.
      let ev = 0;
      for (let r = 1; r <= 13; r++) {
        const cards = [h.cards[0], C(r)];
        ev += (1 / 13) * (h.cards[0].rank === 1 ? standEV(handTotal(cards).total, d) : twoCardOpt(up, cards));
      }
      net += ev;
    } else {
      if (i !== t.active) throw new Error('only the active hand can be open with two or more cards');
      net += qValues(t).best;
    }
  });
  return net;
}

/** The DP's value of every legal action at the active hand. */
function qValues(t: Table) {
  const ctx = ctxOf(t)!;
  const v = actionValues(ctx);
  const L = legal(t);
  const q: Partial<Record<Action, number>> = {};
  for (const a of ACTIONS) if (L[a]) q[a] = a === 'double' ? v.double! : a === 'split' ? v.split! : v[a];
  return { q, best: Math.max(...Object.values(q)) };
}

/** Every outcome of fn over the card draws it makes (13 ranks, 1/13 each), exactly. */
function enumerate<T>(fn: (draw: Draw) => T): { p: number; out: T }[] {
  const res: { p: number; out: T }[] = [];
  const NEED = {};
  const explore = (prefix: Card[], p: number) => {
    let i = 0;
    try {
      const out = fn(() => {
        if (i < prefix.length) return prefix[i++];
        throw NEED;
      });
      res.push({ p, out });
    } catch (e) {
      if (e !== NEED) throw e;
      for (let r = 1; r <= 13; r++) explore([...prefix, C(r)], p / 13);
    }
  };
  explore([], 1);
  return res;
}

const staked = (t: Table) => t.hands.reduce((a, h) => a + handUnits(h), 0);

/** Reachable mid-round states (after the peek, player to act), from random play. */
function reachableStates(seed: number, rounds: number): Table[] {
  const rng = createRng(seededSource(seed));
  const draw = () => cardOf(rng.int(52));
  const out: Table[] = [];
  for (let k = 0; k < rounds; k++) {
    let t = deal(draw);
    if ((dealerPeeks(t) && dealerBlackjack(t)) || isBlackjack(t.hands[0])) continue;
    t = begin(t, draw);
    while (!playerDone(t)) {
      out.push(t);
      const L = legal(t);
      // Lean towards splits and doubles so those states are well covered.
      const a: Action = L.split && rng.next() < 0.6 ? 'split' : L.double && rng.next() < 0.3 ? 'double' : rng.next() < 0.5 ? 'hit' : 'stand';
      t = act(t, a, draw);
    }
  }
  return out;
}

function meanSe(xs: Float64Array) {
  let s = 0;
  let s2 = 0;
  for (const x of xs) {
    s += x;
    s2 += x * x;
  }
  const m = s / xs.length;
  return { mean: m, se: Math.sqrt(Math.max(0, s2 / xs.length - m * m) / xs.length) };
}

// ---------------------------------------------------------------- strategies on the real engine

type Choice = Action | 'leave';
interface Strategy {
  insure?: boolean;
  choose(t: Table, ctx: Ctx): Choice;
}

/** One round in the order Game.tsx plays it. Returns 1 + net per unit of the main bet (the eval's multiplier). */
function playRound(s: Strategy, sides: { pairs: number; trips: number }, draw: Draw): number {
  let t = deal(draw);
  const [p1, p2] = t.hands[0].cards;
  let wagered = 1 + sides.pairs + sides.trips;
  let returned = sides.pairs * pairsMult(p1, p2) + sides.trips * tripsMult(p1, p2, t.dealer[0]);
  if (offersInsurance(t) && s.insure) {
    wagered += 0.5;
    if (dealerBlackjack(t)) returned += 1.5;
  }
  if (dealerPeeks(t) && dealerBlackjack(t)) return 1 + returned + handResult(t.hands[0], t.dealer).mult - wagered;
  if (isBlackjack(t.hands[0])) return 1 + returned + 2.5 - wagered;
  t = begin(t, draw);
  let extra = 0;
  while (!playerDone(t)) {
    const ctx = ctxOf(t)!;
    let a = s.choose(t, ctx);
    if (a === 'leave') return 1 + returned + expectedHandReturn(t, true) - wagered - extra;
    if (!legal(t)[a]) a = 'hit';
    if (a === 'double' || a === 'split') extra += 1;
    t = act(t, a, draw);
  }
  t = dealerPlay(t, draw);
  for (const h of t.hands) returned += handUnits(h) * handResult(h, t.dealer).mult;
  return 1 + returned - wagered - extra;
}

const hitSurvival = (ctx: Ctx) => {
  let p = 0;
  for (let v = 1; v <= 10; v++) if (ctx.hard + v <= 21) p += P_VALUE[v];
  return p;
};

const BASIC: Strategy = { choose: (_t, ctx) => bestAction(ctx) };
const TESTER: Strategy = { choose: (_t, ctx) => (hitSurvival(ctx) >= 0.8 ? bestAction(ctx) : 'leave') };
const TAKE_PROFIT: Strategy = { choose: (t, ctx) => (expectedHandReturn(t, true) > staked(t) ? 'leave' : bestAction(ctx)) };
const LEAVE_IF_BETTER: Strategy = {
  choose: (t, ctx) => (expectedHandReturn(t, true) - staked(t) >= vStar(t) - 1e-12 ? 'leave' : bestAction(ctx)),
};
const MAX_VARIANCE: Strategy = { choose: (_t, ctx) => (ctx.canSplit ? 'split' : ctx.canDouble ? 'double' : bestAction(ctx)) };
const ALWAYS_INSURE: Strategy = { insure: true, choose: (_t, ctx) => bestAction(ctx) };

describe('Blackjack fairness', () => {
  it('Bellman / martingale: at every reachable state, E[V*(next)] for each legal action equals its DP value, and V* is their max', () => {
    const states = reachableStates(41, 400);
    expect(states.length).toBeGreaterThan(300);
    expect(states.some((t) => t.hands.length === 2)).toBe(true);
    expect(states.some((t) => t.hands.some((h) => h.cards.length === 1))).toBe(true);
    for (const t of states) {
      const { q, best: bestQ } = qValues(t);
      const others = vStar(t) - bestQ; // finished hands and a pending split hand
      for (const a of ACTIONS) {
        if (q[a] === undefined) continue;
        let e = 0;
        for (const { p, out } of enumerate((draw) => act(t, a, draw))) e += p * vStar(out);
        expect(Math.abs(e - (others + q[a]!))).toBeLessThan(1e-12);
        expect(e).toBeLessThanOrEqual(vStar(t) + 1e-12);
      }
      // Leaving settles at expectedHandReturn (money back, per unit of the main bet): never more than playing on.
      expect(expectedHandReturn(t, true) - staked(t)).toBeLessThanOrEqual(vStar(t) + 1e-12);
    }
  });

  it("the dealer's reveal is priced right: E over the hole card (after the peek) and every dealer draw of the settled net = V*", () => {
    const rng = createRng(seededSource(43));
    const draw = () => cardOf(rng.int(52));
    let checked = 0;
    for (const t0 of reachableStates(47, 60)) {
      // Finish the hand with random stands so we get a mix of done tables.
      let t = t0;
      while (!playerDone(t)) t = act(t, legal(t).stand && rng.next() < 0.7 ? 'stand' : 'hit', draw);
      const up = t.dealer[0];
      const holes = Array.from({ length: 13 }, (_, i) => C(i + 1)).filter((h) => !(dealerPeeks(t) && handTotal([up, h]).total === 21));
      let e = 0;
      for (const hole of holes) {
        for (const { p, out } of enumerate((d) => dealerPlay({ ...t, dealer: [up, hole] }, d))) {
          let net = 0;
          for (const h of out.hands) net += handUnits(h) * (handResult(h, out.dealer).mult - 1);
          e += (p / holes.length) * net;
        }
      }
      expect(Math.abs(e - vStar(t))).toBeLessThan(1e-12);
      checked++;
    }
    expect(checked).toBeGreaterThan(30);
  });

  it('E[V* at the start] over every deal through deal()/begin() is RTP − 1, and insurance returns 12/13', () => {
    let net = 0;
    let insurance = 0;
    let aces = 0;
    for (let a = 1; a <= 13; a++)
      for (let u = 1; u <= 13; u++)
        for (let b = 1; b <= 13; b++)
          for (let h = 1; h <= 13; h++) {
            const seq = [C(a), C(u), C(b), C(h)];
            let i = 0;
            let t = deal(() => seq[i++]);
            const p = 1 / 13 ** 4;
            if (offersInsurance(t)) {
              aces += p;
              insurance += p * (dealerBlackjack(t) ? 3 : 0);
            }
            if (dealerPeeks(t) && dealerBlackjack(t)) net += p * (handResult(t.hands[0], t.dealer).mult - 1);
            else if (isBlackjack(t.hands[0])) net += p * 1.5;
            else {
              t = begin(t, () => {
                throw new Error('a two-card hand needs no card to begin');
              });
              net += p * vStar(t);
            }
          }
    expect(Math.abs(1 + net - RTP)).toBeLessThan(1e-12);
    expect(insurance / aces).toBeCloseTo(12 / 13, 12);
  });

  it('strategies on the real engine, 200k rounds each: none beats basic strategy', () => {
    const n = 200_000;
    const run = (s: Strategy, seed: number) => {
      const rng = createRng(seededSource(seed));
      const draw = () => cardOf(rng.int(52));
      const xs = new Float64Array(n);
      for (let k = 0; k < n; k++) xs[k] = playRound(s, { pairs: 0, trips: 0 }, draw);
      return meanSe(xs);
    };
    const basic = run(BASIC, 51);
    expect(Math.abs(basic.mean - RTP)).toBeLessThan(4 * basic.se);
    for (const [s, seed] of [
      [TESTER, 52],
      [TAKE_PROFIT, 53],
      [LEAVE_IF_BETTER, 54],
      [MAX_VARIANCE, 55],
      [ALWAYS_INSURE, 56],
    ] as const) {
      const r = run(s, seed);
      expect(r.mean).toBeLessThan(RTP + 4 * r.se);
    }
  }, 300_000);

  it('(c) every eval config hits its declared RTP over 200k rounds (4 SE)', () => {
    const rng = createRng(seededSource(61));
    for (const c of evalSpec.configs) {
      const xs = new Float64Array(200_000);
      for (let k = 0; k < xs.length; k++) xs[k] = evalSpec.playRound(c.params, rng).multiplier;
      const r = meanSe(xs);
      expect(Math.abs(r.mean - (c.rtp ?? RTP))).toBeLessThan(4 * r.se);
    }
  }, 300_000);
});
