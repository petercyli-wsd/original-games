// Fairness audit: can any way of playing Scratch beat the RTP?
//
// A round hides one winner among `cards` cards, placed with the host rng right
// after the bet is accepted (App.tsx: rng.int(cards)); the winner is never in
// the DOM until the round ends. The player's decisions are (1) which covered
// card to scratch, (2) sell the remaining goes (after the first miss), (3) buy
// another go (the variant switch; after the first miss, while goes < cards
// left), and (4) decline when out of goes. Setup, bet and the variant are fixed
// while live; Space, S and B run the same handlers as the buttons, and every
// handler is refused while a scratch animates (lockedRef) or a wallet call is
// pending (busyRef). Leaving mid-round settles the main ticket at liveValue of
// the latest round ref (post-result when a scratch is in flight) and every buy
// ticket at 0.
//
// Fairness with re-buys means E[total payout] = RTP · E[total staked] for every
// strategy. Per step that is:
//   scratch any covered card i:  E_w[liveValue(scratch(r_w, i))] = liveValue(r),
//     the winner w uniform over the covered cards (exact enumeration through
//     the real reducer: finitely many outcomes);
//   sell:  pays liveValue(r) itself;
//   buy:   bet · (liveValue after − before) ≤ RTP · (the price charged).
// The last line is where a hole was: buyPrice rounded the charged price DOWN
// to 8 dp, so each go was sold for slightly less than its value (a per-buy RTP
// a hair above 0.99). It now rounds up; the check runs over awkward bets.
//
// Strategies, per eval config (bet 1, prices as charged by buyPrice):
//   (a) the tester's: scratch while the next scratch can't end the round
//       (≥ 80% "safe"), else sell;
//   (b) take any profit: sell the moment the goes are worth more than the
//       total staked;
//   (c) play every go, decline when out;
//   (d) chase: buy a go every time you run out, until found or the buy rule
//       stops you;
//   (d') load up: buy at every checkpoint while allowed, then scratch.
// Each is valued EXACTLY by enumerating every winner position through the
// reducer (deterministic scratch order), and also by Monte Carlo with the real
// rng (winner and "scratch random").

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import { MODE_NAMES, PRESETS, RTP, buyPrice, buyPriceMultiplier, clampSetup, type Setup } from './math';
import {
  buy,
  canBuy,
  canSell,
  cardsLeft,
  decline,
  hiddenCards,
  isLive,
  isOut,
  liveValue,
  scratch,
  sell,
  startRound,
  totalSpent,
  type Round,
} from './round';

/** Rounds per strategy run; the heavy run sets FAIRNESS_ROUNDS (and FAIRNESS_TARGET_SE / FAIRNESS_MAX_ROUNDS). */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 6_000);
const TARGET_SE = Number(import.meta.env.FAIRNESS_TARGET_SE ?? 0);
const MAX_ROUNDS = Number(import.meta.env.FAIRNESS_MAX_ROUNDS ?? ROUNDS);

type Action = 'scratch' | 'sell' | 'buy' | 'decline';
type Decide = (r: Round) => Action;

/** Falls back to a legal action, like the disabled buttons do. */
const legal =
  (prefer: Decide): Decide =>
  (r) => {
    const a = prefer(r);
    if (a === 'buy' && canBuy(r)) return a;
    if (a === 'sell' && canSell(r)) return a;
    if (r.goesLeft > 0) return 'scratch';
    return 'decline';
  };

/** Chance the next scratch doesn't end the round at 0: certain while a go is spare, else a hit (1 / r). */
const nextSafe = (r: Round) => (r.goesLeft >= 2 ? 1 : 1 / cardsLeft(r));

const STRATEGIES: { name: string; decide: Decide }[] = [
  { name: '(a) scratch while ≥ 80% safe, else sell', decide: legal((r) => (isOut(r) ? 'decline' : nextSafe(r) >= 0.8 ? 'scratch' : 'sell')) },
  { name: '(b) take any profit', decide: legal((r) => (isOut(r) ? 'decline' : r.bet * liveValue(r) > totalSpent(r) ? 'sell' : 'scratch')) },
  { name: '(c) play every go', decide: legal((r) => (isOut(r) ? 'decline' : 'scratch')) },
  { name: '(d) chase: buy whenever out', decide: legal((r) => (isOut(r) ? 'buy' : 'scratch')) },
  { name: "(d') load up: buy at every checkpoint", decide: legal(() => 'buy') },
];

/** Applies one action as App.tsx does (bet 1; a buy is charged buyPrice). */
function act(r: Round, a: Action, card: () => number): Round {
  if (a === 'scratch') return scratch(r, card());
  if (a === 'sell') return sell(r);
  if (a === 'buy') return buy(r, buyPrice(r, r.bet, cardsLeft(r)));
  return decline(r);
}

function play(s: Setup, winner: number, decide: Decide, card: (r: Round) => number, buyOn = true) {
  let r = startRound(s, 1, winner, buyOn);
  for (let guard = 0; isLive(r); guard++) {
    if (guard > 10_000) throw new Error('round never ended');
    const before = r;
    r = act(r, decide(r), () => card(r));
    if (r === before) throw new Error('illegal action');
  }
  return { pay: r.bet * r.mult, stake: totalSpent(r) };
}

/** Exact E[payout] and E[staked]: every winner position, scratching left to right. */
function exact(s: Setup, decide: Decide) {
  let pay = 0;
  let stake = 0;
  for (let w = 0; w < s.cards; w++) {
    const x = play(s, w, decide, (r) => hiddenCards(r)[0]);
    pay += x.pay;
    stake += x.stake;
  }
  return { pay: pay / s.cards, stake: stake / s.cards };
}

/** Monte Carlo with the real rng. Tracks x = pay − RTP · stake (mean 0 iff fair) and the ratio. */
function mc(s: Setup, decide: Decide, seed: number) {
  const rng = createRng(seededSource(seed));
  const random = (r: Round) => {
    const h = hiddenCards(r);
    return h[rng.int(h.length)];
  };
  let n = 0;
  let pay = 0;
  let stake = 0;
  let sx = 0;
  let sx2 = 0;
  let max = 0;
  let se = Infinity;
  while (n < ROUNDS || (se / (stake / n) > TARGET_SE && n < MAX_ROUNDS)) {
    for (let i = 0; i < ROUNDS; i++) {
      const o = play(s, rng.int(s.cards), decide, random);
      const x = o.pay - RTP * o.stake;
      pay += o.pay;
      stake += o.stake;
      sx += x;
      sx2 += x * x;
      max = Math.max(max, o.pay);
    }
    n += ROUNDS;
    const m = sx / n;
    se = Math.sqrt(Math.max(0, sx2 / n - m * m) / n);
  }
  return { n, rtp: pay / stake, meanX: sx / n, seX: se, seRtp: se / (stake / n), max };
}

/** A live state reached by random legal play with buys (random pick order). */
function reached(s: Setup, rng: Rng): Round {
  let r = startRound(s, 1, rng.int(s.cards), true);
  const steps = rng.int(s.cards + 4);
  for (let i = 0; i < steps; i++) {
    const options: Action[] = [];
    if (r.goesLeft > 0) options.push('scratch');
    if (canBuy(r)) options.push('buy');
    const a = options[rng.int(options.length)];
    const next = act(r, a, () => {
      const h = hiddenCards(r).filter((c) => c !== r.winner); // stay live: miss
      return h.length ? h[rng.int(h.length)] : -1;
    });
    if (!isLive(next) || next === r) break;
    r = next;
  }
  return r;
}

describe('Scratch fairness', () => {
  it('martingale (exact): every scratch, buy and sell keeps E[value] = value at ≥ 30 reached states', () => {
    const rng = createRng(seededSource(901));
    const setups: Setup[] = [...MODE_NAMES.map((m) => PRESETS[m]), clampSetup(100, 1), clampSetup(100, 10), clampSetup(2, 1), clampSetup(5, 4)];
    let states = 0;
    for (const s of setups) {
      for (let t = 0; t < 6; t++) {
        const r = reached(s, rng);
        states++;
        const v = liveValue(r);
        const covered = hiddenCards(r);
        // Scratch: each covered card, every winner position among the covered cards.
        if (r.goesLeft > 0) {
          for (const i of covered) {
            let e = 0;
            for (const w of covered) e += liveValue(scratch({ ...r, winner: w }, i)) / covered.length;
            expect(Math.abs(e - v)).toBeLessThan(1e-12 * Math.max(1, v));
          }
        }
        // Sell pays the value itself.
        if (canSell(r)) expect(sell(r).mult).toBe(v);
        // Buy: the value added is RTP x the fair price, and never more than RTP x the charged price.
        if (canBuy(r)) {
          for (const bet of [1, 0.01, 0.03, 0.07, 1.23456789, 3.33, 250]) {
            const rb = { ...r, bet };
            const price = buyPrice(rb, bet, cardsLeft(rb));
            const added = bet * (liveValue(buy(rb, price)) - liveValue(rb));
            expect(Math.abs(added - RTP * bet * buyPriceMultiplier(rb, cardsLeft(rb)))).toBeLessThan(1e-12 * Math.max(1, added));
            expect(added).toBeLessThanOrEqual(RTP * price * (1 + 1e-12));
            expect(price - bet * buyPriceMultiplier(rb, cardsLeft(rb))).toBeLessThanOrEqual(1e-8);
          }
        }
        // Out of goes with nothing to buy is already lost: the reducer never leaves such a live state.
        if (isOut(r)) expect(canBuy(r)).toBe(true);
      }
    }
    expect(states).toBeGreaterThanOrEqual(30);
  });

  it('a buy is never charged below its fair price, over many awkward bets and states', () => {
    const rng = createRng(seededSource(902));
    for (let i = 0; i < 20_000; i++) {
      const s = clampSetup(2 + rng.int(99), 1 + rng.int(99));
      const r = 1 + rng.int(s.cards);
      const bet = Math.floor((0.01 + rng.next() * 100) * 1e8) / 1e8;
      const fair = bet * buyPriceMultiplier(s, r);
      const price = buyPrice(s, bet, r);
      expect(price).toBeGreaterThanOrEqual(fair - 1e-15 * Math.max(1, fair));
      expect(price - fair).toBeLessThanOrEqual(1e-8 + 1e-13 * Math.max(1, fair));
      // On the 8 dp grid (up to float noise).
      expect(Math.abs(Math.round(price * 1e8) - price * 1e8)).toBeLessThan(1e-14 * Math.max(1e8, price * 1e8));
    }
  });

  for (const cfg of evalSpec.configs) {
    describe(cfg.label, () => {
      STRATEGIES.forEach((st, si) => {
        it(`${st.name}: exact E[payout] ≤ RTP · E[staked] (equal up to price rounding), Monte Carlo within 4 SE`, () => {
          const s = cfg.params;
          const ex = exact(s, st.decide);
          // Each buy is charged at most 1e-8 above fair, and a round buys at most ~100 goes.
          expect(ex.pay).toBeLessThanOrEqual(RTP * ex.stake * (1 + 1e-12));
          expect(ex.pay).toBeGreaterThan(RTP * ex.stake - 1e-6);
          const r = mc(s, st.decide, 9_100 + si * 53 + s.cards + s.goes);
          if (import.meta.env.FAIRNESS_ROUNDS)
            console.log(
              `scratch | ${cfg.label} | ${st.name} | exact ${(ex.pay / ex.stake).toFixed(9)} (staked ${ex.stake.toFixed(3)}) | n ${r.n} | rtp ${r.rtp.toFixed(5)} ± ${r.seRtp.toFixed(5)} | max ${r.max.toFixed(2)}`,
            );
          expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
          expect(Math.abs(r.meanX)).toBeLessThan(4 * r.seX + 1e-12);
        });
      });
    });
  }
});
