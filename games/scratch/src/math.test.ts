import { runEval } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  MAX_CARDS,
  MODE_NAMES,
  PRESETS,
  RTP,
  buyPrice,
  buyPriceMultiplier,
  canBuyAt,
  clampSetup,
  gridColumns,
  prizeMultiplier,
  sellMultiplier,
  type Setup,
} from './math';
import {
  buy,
  canBuy,
  canSell,
  cardsLeft,
  decline,
  hiddenCards,
  isLive,
  isOut,
  scratch,
  sell,
  startRound,
  totalSpent,
  type Round,
} from './round';

// Small boards plus every preset and a few large custom ones.
const BOARDS: Setup[] = MODE_NAMES.map((m) => PRESETS[m]);
for (let cards = 2; cards <= 10; cards++) for (let goes = 1; goes < cards; goes++) BOARDS.push({ cards, goes });
BOARDS.push({ cards: 100, goes: 1 }, { cards: 100, goes: 99 }, { cards: 37, goes: 5 });

/** Deterministic pseudo-random number in [0, 1) from a few integers. */
function hash(...xs: number[]) {
  let h = 2166136261;
  for (const x of xs) h = Math.imul(h ^ (x + 0x9e3779b9), 16777619) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 2 ** 32;
}

describe('Scratch maths', () => {
  it('prize, sell value and buy price follow the closed forms', () => {
    const s = { cards: 15, goes: 3 };
    expect(prizeMultiplier(s)).toBeCloseTo(4.95, 12);
    expect(sellMultiplier(s, 2, 13)).toBeCloseTo((4.95 * 2) / 13, 12);
    expect(buyPriceMultiplier(s, 12)).toBeCloseTo(prizeMultiplier(s) / 12 / RTP, 12);
    expect(buyPrice(s, 1, 13)).toBeLessThanOrEqual(buyPriceMultiplier(s, 13));
    // Fewer cards left: each extra go costs more (and is more likely to win).
    expect(buyPriceMultiplier(s, 13)).toBeLessThan(buyPriceMultiplier(s, 12));
  });

  it('selling after any number of misses returns exactly the RTP', () => {
    for (const s of BOARDS) {
      const M = prizeMultiplier(s);
      for (let k = 0; k < s.goes; k++) {
        // Each of the first k scratches hits with probability 1/cards.
        const ev = (k / s.cards) * M + ((s.cards - k) / s.cards) * sellMultiplier(s, s.goes - k, s.cards - k);
        expect(ev).toBeCloseTo(RTP, 12);
      }
      expect((s.goes / s.cards) * M).toBeCloseTo(RTP, 12);
    }
  });

  it('caps the multiplier at 99x (1 go of 100 cards) and the manifest covers it', () => {
    let max = 0;
    for (let cards = 2; cards <= MAX_CARDS; cards++)
      for (let goes = 1; goes < cards; goes++) max = Math.max(max, prizeMultiplier({ cards, goes }));
    expect(max).toBeCloseTo(99, 12);
    expect(manifest.maxMultiplier).toBeGreaterThanOrEqual(max);
  });

  it('clamps custom boards to 2..100 cards and 1..cards-1 goes', () => {
    expect(clampSetup(1, 5)).toEqual({ cards: 2, goes: 1 });
    expect(clampSetup(500, 0)).toEqual({ cards: 100, goes: 1 });
    expect(clampSetup(10, 10)).toEqual({ cards: 10, goes: 9 });
    expect(clampSetup(NaN, NaN)).toEqual({ cards: 2, goes: 1 });
  });

  it('lays out boards as tidy grids', () => {
    expect(gridColumns(8, 1.6)).toBe(4);
    expect(gridColumns(15, 1.6)).toBe(5);
    expect(gridColumns(50, 1.6)).toBe(10);
    for (let n = 2; n <= 100; n++) expect(gridColumns(n, 1.6)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Exact enumeration with buys. A strategy maps a state (cards left r, goes g)
// to weights over the legal actions; E[payout] and E[extra stake] per unit of
// main bet come from a DP over (r, g). Fairness: E[pay] = RTP x (1 + E[stake]).

type Action = 'scratch' | 'sell' | 'buy' | 'decline';
type Mix = Partial<Record<Action, number>>;
type Strategy = (r: number, g: number, s: Setup) => Mix;

function evaluate(s: Setup, strategy: Strategy) {
  const M = prizeMultiplier(s);
  const memo = new Map<number, { pay: number; stake: number }>();
  const E = (r: number, g: number): { pay: number; stake: number } => {
    const key = r * 1000 + g;
    const seen = memo.get(key);
    if (seen) return seen;
    const atStart = r === s.cards; // no checkpoint before the first miss
    const legal: Action[] = g > 0 ? ['scratch'] : ['decline'];
    if (g > 0 && !atStart) legal.push('sell');
    if (!atStart && canBuyAt(g, r)) legal.push('buy');
    const mix = strategy(r, g, s);
    let w = legal.map((a) => mix[a] ?? 0);
    let total = w.reduce((a, b) => a + b, 0);
    if (total === 0) {
      w = legal.map((_, i) => (i === 0 ? 1 : 0));
      total = 1;
    }
    let pay = 0;
    let stake = 0;
    legal.forEach((a, i) => {
      const p = w[i] / total;
      if (p === 0) return;
      if (a === 'sell') pay += p * sellMultiplier(s, g, r);
      if (a === 'scratch') {
        pay += (p * M) / r;
        if (r > 1) {
          const next = E(r - 1, g - 1);
          pay += (p * (r - 1) * next.pay) / r;
          stake += (p * (r - 1) * next.stake) / r;
        }
      }
      if (a === 'buy') {
        const next = E(r, g + 1);
        pay += p * next.pay;
        stake += p * (buyPriceMultiplier(s, r) + next.stake);
      }
    });
    const out = { pay, stake };
    memo.set(key, out);
    return out;
  };
  return E(s.cards, s.goes);
}

const STRATEGIES: Record<string, Strategy> = {
  'play every go, never buy': () => ({ scratch: 1, decline: 1 }),
  'chase: always buy when out until found': (_r, g) => (g > 0 ? { scratch: 1 } : { buy: 1 }),
  'buy at every checkpoint while allowed': () => ({ buy: 1, scratch: 1e-4 }),
  'buy only when few cards are left': (r) => (r <= 4 ? { buy: 1, scratch: 0.1 } : { scratch: 1, decline: 1 }),
  'sell once odds halve, else chase': (r, g, s) =>
    g / r < s.goes / s.cards / 2 ? { sell: 1, decline: 1 } : { scratch: 1, buy: 1 },
  'random mix A': (r, g) => ({ scratch: hash(r, g, 1), sell: hash(r, g, 2), buy: hash(r, g, 3), decline: hash(r, g, 4) }),
  'random mix B': (r, g) => ({
    scratch: hash(r, g, 5) ** 3,
    sell: hash(r, g, 6),
    buy: 3 * hash(r, g, 7),
    decline: hash(r, g, 8) ** 2,
  }),
};

describe('buy-a-scratch variant (exact DP over states)', () => {
  for (const [name, strategy] of Object.entries(STRATEGIES)) {
    it(`${name}: E[payout] = RTP x E[total staked]`, () => {
      for (const s of BOARDS) {
        const { pay, stake } = evaluate(s, strategy);
        expect(pay).toBeCloseTo(RTP * (1 + stake), 10);
      }
    });
  }

  it('the chase strategy keeps paying in, and wins far more often than playing once', () => {
    // The chaser is only stopped by the one-card rule (no buy with r = 1).
    const s = { cards: 8, goes: 2 };
    const { pay, stake } = evaluate(s, STRATEGIES['chase: always buy when out until found']);
    expect(stake).toBeGreaterThan(1);
    expect(pay / prizeMultiplier(s)).toBeGreaterThan(0.85); // P(find the winner)
    expect(pay).toBeCloseTo(RTP * (1 + stake), 10);
  });
});

// ---------------------------------------------------------------------------
// The same property through the real reducer, enumerating every winner
// position, with strategies that may look at the whole history of the round.

type Decide = (r: Round) => Action;

function enumerate(s: Setup, decide: Decide, pick: (r: Round) => number) {
  let pay = 0;
  let stake = 0;
  for (let w = 0; w < s.cards; w++) {
    let r = startRound(s, 1, w, true);
    for (let guard = 0; isLive(r); guard++) {
      if (guard > 1000) throw new Error('round never ended');
      const a = decide(r);
      const before = r;
      if (a === 'scratch') r = scratch(r, pick(r));
      else if (a === 'sell') r = sell(r);
      else if (a === 'buy') r = buy(r, buyPriceMultiplier(r, cardsLeft(r)));
      else r = decline(r);
      if (r === before) throw new Error(`illegal action ${a}`);
    }
    pay += r.bet * r.mult;
    stake += totalSpent(r);
  }
  return { pay: pay / s.cards, stake: stake / s.cards };
}

const legal =
  (prefer: Decide): Decide =>
  (r) => {
    const a = prefer(r);
    if (a === 'buy' && canBuy(r)) return a;
    if (a === 'sell' && canSell(r)) return a;
    if (r.goesLeft > 0) return 'scratch';
    return 'decline';
  };

const DECIDERS: Record<string, Decide> = {
  'buy at most twice, then give up': legal((r) => (isOut(r) && r.buys.length < 2 ? 'buy' : 'scratch')),
  'sell once spent exceeds half the prize': legal((r) =>
    totalSpent(r) > (r.bet * r.prize) / 2 ? 'sell' : isOut(r) ? 'buy' : 'scratch',
  ),
  'history-hash mix': legal((r) => {
    const u = hash(r.misses, r.goesLeft, r.buys.length, r.last ?? -1);
    return u < 0.5 ? 'scratch' : u < 0.7 ? 'buy' : u < 0.85 ? 'sell' : 'decline';
  }),
};

describe('buy-a-scratch variant (reducer, every winner position)', () => {
  const picks: Record<string, (r: Round) => number> = {
    'left to right': (r) => hiddenCards(r)[0],
    'scattered order': (r) => {
      const h = hiddenCards(r);
      return h[Math.floor(hash(r.misses, r.buys.length, r.cards) * h.length)];
    },
  };
  for (const [name, decide] of Object.entries(DECIDERS)) {
    for (const [order, pick] of Object.entries(picks)) {
      it(`${name}, ${order}: E[payout] = RTP x E[total staked]`, () => {
        for (const s of BOARDS.filter((b) => b.cards <= 25)) {
          const { pay, stake } = enumerate(s, decide, pick);
          expect(pay).toBeCloseTo(RTP * stake, 10);
        }
      });
    }
  }
});

describe('round rules', () => {
  it('needs a miss before selling or buying', () => {
    const r = startRound({ cards: 8, goes: 4 }, 1, 7, true);
    expect(canSell(r)).toBe(false);
    expect(canBuy(r)).toBe(false);
    const m = scratch(r, 0);
    expect(canSell(m)).toBe(true);
    expect(canBuy(m)).toBe(true);
  });

  it('a hit pays the prize; a sale pays prize x goes / cards left', () => {
    const r = startRound({ cards: 15, goes: 3 }, 2, 4, true);
    const won = scratch(scratch(r, 0), 4);
    expect(won.outcome).toBe('win');
    expect(won.mult).toBeCloseTo(4.95, 12);
    const sold = sell(scratch(r, 0));
    expect(sold.outcome).toBe('sold');
    expect(sold.mult).toBeCloseTo((4.95 * 2) / 14, 12);
  });

  it('out of goes waits for a buy or decline with the variant on, and loses at once with it off', () => {
    const on = scratch(startRound({ cards: 50, goes: 1 }, 1, 49, true), 0);
    expect(isOut(on)).toBe(true);
    expect(canBuy(on)).toBe(true);
    expect(canSell(on)).toBe(false);
    expect(decline(on).outcome).toBe('lost');
    const off = scratch(startRound({ cards: 50, goes: 1 }, 1, 49, false), 0);
    expect(off.outcome).toBe('lost');
  });

  it('refuses buys with one card left or when goes cover every card', () => {
    // 1 of 2: after the miss only the winner is left, so nothing can be bought.
    const r = scratch(startRound({ cards: 2, goes: 1 }, 1, 1, true), 0);
    expect(r.outcome).toBe('lost');
    let s = scratch(startRound({ cards: 4, goes: 1 }, 1, 3, true), 0); // 0 goes, 3 cards
    s = buy(buy(buy(s, 1), 1), 1); // 3 goes, 3 cards: every card covered
    expect(s.goesLeft).toBe(3);
    expect(canBuy(s)).toBe(false);
    expect(buy(s, 1)).toBe(s);
    expect(totalSpent(s)).toBe(4);
  });
});

describe('eval', () => {
  it('simulated RTP matches the manifest', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
