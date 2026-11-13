// Fairness audit: can any way of playing Booster beat the RTP?
//
// Decisions: after each open card, Sell the rest, Open next or Open all. The
// sell value after k cards with sum S is V = S + (5 - k) * 0.196 (valueOf),
// the exact expectation of the final pack, so V is a martingale from 0.98.
//
// Martingale check (exact, in integers): for 40+ states (k = 1..4, varied S,
// including all rare cards) E[V after one more card] equals V, computed by
// summing over the table with the game's own functions.
// Strategies on the same drawCard()/valueOf() as Game.tsx, each within 4 SE of
// 0.98: open all, sell at S >= 1, sell when the next card is >= 80% likely
// below 0.05x (a constant here), sell right after a Rare+ card, and
// "chase": keep opening until the sum is at least 3x.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import { CARDS, RTP, TABLE, drawCard, valueOf } from './math';

const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 200_000);

type Sell = (cents: number, open: number, last: number) => boolean;

const STRATEGIES: { name: string; sell: Sell }[] = [
  { name: 'open all', sell: () => false },
  { name: 'sell at 1x', sell: (c) => c >= 100 },
  { name: 'sell when next card likely tiny', sell: () => TABLE.filter((c) => c.cents < 5).reduce((s, c) => s + c.p, 0) >= 0.8 },
  { name: 'sell after a Rare+', sell: (_c, _o, last) => last >= 100 },
  { name: 'chase 3x', sell: (c) => c >= 300 },
];

function play(sell: Sell, rng: Rng): number {
  let cents = 0;
  for (let open = 1; open <= CARDS; open++) {
    const card = drawCard(rng);
    cents += card.cents;
    if (open === CARDS) return cents / 100;
    if (sell(cents, open, card.cents)) return valueOf(cents, open);
  }
  return 0;
}

describe('Booster fairness', () => {
  it('martingale (exact): E[value after the next card] = value now at 40+ states', () => {
    const rng = createRng(seededSource(5));
    const states: { cents: number; open: number }[] = [];
    for (let open = 1; open <= 4; open++) {
      for (const c of TABLE) states.push({ cents: c.cents * open, open });
      for (let i = 0; i < 12; i++) states.push({ cents: rng.int(5000), open });
    }
    expect(states.length).toBeGreaterThanOrEqual(40);
    for (const { cents, open } of states) {
      const expected = TABLE.reduce((s, c) => s + c.p * valueOf(cents + c.cents, open + 1), 0);
      expect(expected).toBeCloseTo(valueOf(cents, open), 9);
    }
    // At the start, the first card's expectation is the starting price.
    expect(TABLE.reduce((s, c) => s + c.p * valueOf(c.cents, 1), 0)).toBeCloseTo(RTP, 12);
  });

  for (const [i, { name, sell }] of STRATEGIES.entries()) {
    it(`strategy "${name}" returns the RTP within 4 SE`, () => {
      const rng = createRng(seededSource(100 + i));
      let s = 0;
      let s2 = 0;
      for (let r = 0; r < ROUNDS; r++) {
        const x = play(sell, rng);
        s += x;
        s2 += x * x;
      }
      const mean = s / ROUNDS;
      const se = Math.sqrt(Math.max(0, s2 / ROUNDS - mean * mean) / ROUNDS);
      expect(Math.abs(mean - RTP)).toBeLessThan(4 * se);
    });
  }
});
