// Fairness audit: can any way of playing Call It beat the RTP?
//
// A round is a deck of r red and b black cards. At every checkpoint the
// player may turn a card (the cash-out moves to valueAfterTurn), call red
// (pays the locked prize with chance r / n), or cash out (prize × r / n; the
// button appears after the first card, and at the start it would be worth
// RTP anyway). The deck is never pre-shuffled: each card is drawn with
// dealsRed(r, b, rng.next()) when it is turned, so nothing is decided early.
//
// The martingale check is exact: every (r, b) state of every deck preset is
// enumerated, and for both actions with risk (turn, call) the two outcomes are
// weighted by their exact chances.
//
// Strategies, per eval config (deck):
//   (a) the tester's: call when the call wins with chance ≥ 0.8, else turn
//       when turning is ≥ 0.8 safe (it only loses when it shows the last red),
//       else cash out;
//   (b) take any profit: cash out the moment the cash-out exceeds the bet;
//   (c) play to the end: never call, let the deck decide;
//   (d) chase the drift: call as soon as the red share beats the starting
//       share, cash out once it falls below half of it, else turn;
//   (e) the best possible calling rule, by exact DP over (r, b)
//       (bestCallChance; Winkler's theorem says it equals r₀/n₀).
// Each is evaluated exactly (dynamic programming over (r, b), a policy depends
// only on the state) and by Monte Carlo on the real draw function.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { DECKS, RTP, VOLATILITY, afterTurn, bestCallChance, cashOut, dealsRed, prizeFor, settled, share, valueAfterTurn, type Deck } from './math';

/** Rounds per strategy run; the audit's 200k run sets FAIRNESS_ROUNDS=200000. */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 20_000);

type Act = 'turn' | 'call' | 'cash';
interface State {
  red: number;
  black: number;
  /** Cards turned so far (cash-out is offered only after the first). */
  turned: number;
  prize: number;
  p0: number;
}
type Policy = (s: State) => Act;

const value = (s: State) => cashOut(s.prize, s.red, s.black);
/** Chance turning a card does not end the round lost (it loses only on the last red). */
const turnSafe = (s: State) => (s.red === 1 ? 1 - share(s.red, s.black) : 1);
/** The game offers no Cash out before the first card: a policy that wants it turns instead. */
const legal = (s: State, a: Act): Act => (a === 'cash' && s.turned === 0 ? 'turn' : a);

const STRATEGIES: { name: string; policy: Policy }[] = [
  { name: '(a) act only when ≥ 80% safe', policy: (s) => (share(s.red, s.black) >= 0.8 ? 'call' : turnSafe(s) >= 0.8 ? 'turn' : 'cash') },
  { name: '(b) take any profit', policy: (s) => (value(s) > 1 ? 'cash' : 'turn') },
  { name: '(c) play to the end', policy: () => 'turn' },
  {
    name: '(d) call above the start share, cash below half of it',
    policy: (s) => {
      const p = share(s.red, s.black);
      return p > s.p0 ? 'call' : p < s.p0 / 2 ? 'cash' : 'turn';
    },
  },
];

/** Exact expected payout of a policy from the start of a deck, by DP over (r, b, turned > 0). */
function exactRtp(deck: Deck, policy: Policy): number {
  const prize = prizeFor(deck);
  const p0 = share(deck.red, deck.black);
  const memo = new Map<string, number>();
  const v = (red: number, black: number, turned: number): number => {
    const done = settled(red, black);
    if (done) return done === 'won' ? prize : 0;
    const key = `${red},${black},${turned > 0 ? 1 : 0}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const s: State = { red, black, turned, prize, p0 };
    const p = share(red, black);
    const a = legal(s, policy(s));
    const out = a === 'cash' ? value(s) : a === 'call' ? p * prize : p * v(red - 1, black, turned + 1) + (1 - p) * v(red, black - 1, turned + 1);
    memo.set(key, out);
    return out;
  };
  return v(deck.red, deck.black, 0);
}

/** One round exactly as Game.tsx plays it: dealsRed on a fresh uniform at every turn or call. */
function playRound(deck: Deck, policy: Policy, rng: Rng): number {
  const prize = prizeFor(deck);
  const p0 = share(deck.red, deck.black);
  let { red, black } = deck;
  let cash = RTP;
  for (let turned = 0; ; turned++) {
    const s: State = { red, black, turned, prize, p0 };
    const a = legal(s, policy(s));
    if (a === 'cash') return cash;
    const isRed = dealsRed(red, black, rng.next());
    if (a === 'call') return isRed ? prize : 0;
    cash = valueAfterTurn(prize, red, black, isRed);
    ({ red, black } = afterTurn(red, black, isRed));
    if (settled(red, black)) return cash;
  }
}

function mc(play: (rng: Rng) => number, rounds: number, seed: number) {
  const rng = createRng(seededSource(seed));
  let s = 0;
  let s2 = 0;
  let max = 0;
  for (let i = 0; i < rounds; i++) {
    const x = play(rng);
    s += x;
    s2 += x * x;
    if (x > max) max = x;
  }
  const mean = s / rounds;
  return { mean, se: Math.sqrt(Math.max(0, s2 / rounds - mean * mean) / rounds), max };
}

describe('Call It fairness', () => {
  it('martingale: at every (r, b) state of every deck, turning and calling are exactly fair bets', () => {
    let states = 0;
    for (const deck of DECKS) {
      const prize = prizeFor(deck);
      for (let red = 1; red <= deck.red; red++) {
        for (let black = 1; black <= deck.black; black++) {
          const V = cashOut(prize, red, black);
          const p = share(red, black);
          // Turn: two outcomes, exact chances.
          const afterTurnEV = p * valueAfterTurn(prize, red, black, true) + (1 - p) * valueAfterTurn(prize, red, black, false);
          expect(Math.abs(afterTurnEV - V)).toBeLessThan(1e-12 * Math.max(1, V));
          // Call: pays the prize with chance p.
          expect(Math.abs(p * prize - V)).toBeLessThan(1e-12 * Math.max(1, V));
          states++;
        }
      }
      // The start is worth exactly RTP.
      expect(cashOut(prize, deck.red, deck.black)).toBeCloseTo(RTP, 14);
    }
    expect(states).toBeGreaterThanOrEqual(30);
  });

  it('the draw matches the odds on screen: dealsRed(r, b, u) is red on exactly [0, r/n)', () => {
    for (const deck of DECKS) {
      const p = share(deck.red, deck.black);
      // The 32-bit grid the host RNG draws from, around the boundary and at the ends.
      const k = Math.ceil(p * 2 ** 32);
      expect(dealsRed(deck.red, deck.black, (k - 1) / 2 ** 32)).toBe(true);
      expect(dealsRed(deck.red, deck.black, k / 2 ** 32)).toBe(false);
      expect(dealsRed(deck.red, deck.black, 0)).toBe(true);
      expect(dealsRed(deck.red, deck.black, 1 - 2 ** -32)).toBe(false);
    }
    // And a direct frequency check on a mid deck.
    const rng = createRng(seededSource(5));
    let hits = 0;
    const N = 200_000;
    for (let i = 0; i < N; i++) if (dealsRed(5, 20, rng.next())) hits++;
    expect(Math.abs(hits / N - 0.2)).toBeLessThan(4 * Math.sqrt((0.2 * 0.8) / N));
  });

  it('no calling rule beats the starting share (exact DP, best and worst)', () => {
    for (const deck of DECKS) {
      const p0 = share(deck.red, deck.black);
      expect(bestCallChance(deck.red, deck.black, 'max')).toBeCloseTo(p0, 12);
      expect(bestCallChance(deck.red, deck.black, 'min')).toBeCloseTo(p0, 12);
    }
  });

  it('every strategy returns exactly RTP on every eval config (exact DP)', () => {
    for (const cfg of evalSpec.configs) {
      for (const { policy } of STRATEGIES) expect(exactRtp(cfg.params, policy)).toBeCloseTo(RTP, 10);
    }
  });

  it.each(STRATEGIES.map((s) => [s.name, s] as const))('strategy %s: Monte Carlo RTP within 4 SE on every eval config', (_, { name, policy }) => {
    Object.values(VOLATILITY).forEach((deck, i) => {
      const r = mc((rng) => playRound(deck, policy, rng), ROUNDS, 1000 + i * 17 + name.length);
      const z = (r.mean - RTP) / r.se;
      if (import.meta.env.FAIRNESS_ROUNDS)
        console.log(`${name} | ${deck.red}/${deck.black} | RTP ${(r.mean * 100).toFixed(3)}% ± ${(r.se * 100).toFixed(3)}% | z ${z.toFixed(2)} | max ${r.max.toFixed(2)}`);
      expect(Math.abs(z)).toBeLessThan(4);
      expect(r.max).toBeLessThanOrEqual(Math.max(...DECKS.map(prizeFor)) + 1e-9);
    });
  });
});
