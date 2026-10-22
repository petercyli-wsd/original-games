import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  CARD_MEAN,
  DECKS,
  MAX_MULTIPLIER,
  RISKS,
  RTP,
  cardMean,
  chanceAtLeast,
  distribution,
  drawIndex,
  playRound,
  productOf,
  profitChance,
  returnChance,
  rtpOf,
  stdDevOf,
  topPrize,
} from './math';

describe('Tarot maths', () => {
  it('every deck is a proper distribution with ascending faces', () => {
    for (const r of RISKS) {
      const deck = DECKS[r];
      const total = deck.reduce((a, c) => a + c.p, 0);
      expect(total).toBeCloseTo(1, 14);
      for (const c of deck) expect(c.p).toBeGreaterThan(0);
      for (let i = 1; i < deck.length; i++) expect(deck[i].value).toBeGreaterThan(deck[i - 1].value);
    }
  });

  it('the mean card is exactly the cube root of the RTP, so E[product] = 0.99', () => {
    for (const r of RISKS) {
      expect(Math.abs(cardMean(r) - CARD_MEAN)).toBeLessThan(1e-15);
      expect(Math.abs(cardMean(r) ** 3 - RTP)).toBeLessThan(1e-14);
    }
  });

  it('enumerating every ordered triple gives exactly 99% on every deck', () => {
    for (const r of RISKS) {
      // Independent brute force, separate from distribution().
      const deck = DECKS[r];
      let ev = 0;
      let mass = 0;
      for (const a of deck)
        for (const b of deck)
          for (const c of deck) {
            ev += a.p * b.p * c.p * a.value * b.value * c.value;
            mass += a.p * b.p * c.p;
          }
      expect(mass).toBeCloseTo(1, 13);
      expect(Math.abs(ev - RTP)).toBeLessThan(1e-13);
      expect(Math.abs(rtpOf(r) - RTP)).toBeLessThan(1e-12);
      expect(distribution(r).reduce((a, o) => a + o.p, 0)).toBeCloseTo(1, 13);
    }
  });

  it('the inverse-CDF draw honours each card probability (simulation, 4 SE)', () => {
    const rng = createRng(seededSource(11));
    const n = 200_000;
    for (const r of RISKS) {
      const deck = DECKS[r];
      const counts = new Array(deck.length).fill(0);
      for (let i = 0; i < n; i++) counts[drawIndex(r, rng.next())]++;
      deck.forEach((c, i) => {
        const se = Math.sqrt((c.p * (1 - c.p)) / n);
        expect(Math.abs(counts[i] / n - c.p)).toBeLessThan(4 * se);
      });
    }
  });

  it('the simulated product matches the exact profit chance and return (4 SE)', () => {
    const rng = createRng(seededSource(23));
    const n = 200_000;
    for (const r of RISKS) {
      let sum = 0;
      let wins = 0;
      for (let i = 0; i < n; i++) {
        const m = playRound(rng.next, r).multiplier;
        sum += m;
        if (m > 1) wins++;
      }
      const p = profitChance(r);
      expect(Math.abs(wins / n - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / n));
      expect(Math.abs(sum / n - RTP)).toBeLessThan(4 * (stdDevOf(r) / Math.sqrt(n)));
    }
  });

  it('a round uses exactly three uniforms and pays the product of its faces', () => {
    const rng = createRng(seededSource(5));
    let calls = 0;
    const next = () => {
      calls++;
      return rng.next();
    };
    for (let k = 0; k < 1000; k++) {
      const before = calls;
      const res = playRound(next, 'high');
      expect(calls - before).toBe(3);
      expect(res.multiplier).toBe(productOf(res.values));
    }
    expect(productOf([1.25, 1.5, 0.7])).toBe(1.3125);
    expect(productOf([0.3, 0.6, 10])).toBe(1.8);
  });

  it('the boundaries of the draw land on the right cards', () => {
    for (const r of RISKS) {
      const deck = DECKS[r];
      expect(drawIndex(r, 0)).toBe(0);
      expect(drawIndex(r, 1 - 1e-12)).toBe(deck.length - 1);
      let acc = 0;
      for (let i = 0; i < deck.length - 1; i++) {
        acc += deck[i].p;
        expect(drawIndex(r, acc - 1e-12)).toBe(i);
        expect(drawIndex(r, acc + 1e-12)).toBe(i + 1);
      }
    }
  });

  it('risk raises volatility and lowers the hit rate, never the return', () => {
    const sds = RISKS.map(stdDevOf);
    const wins = RISKS.map(profitChance);
    const pays = RISKS.map(returnChance);
    for (let i = 1; i < RISKS.length; i++) {
      expect(sds[i]).toBeGreaterThan(sds[i - 1]);
      expect(wins[i]).toBeLessThan(wins[i - 1]);
      expect(pays[i]).toBeLessThanOrEqual(pays[i - 1]);
      expect(topPrize(RISKS[i])).toBeGreaterThan(topPrize(RISKS[i - 1]));
    }
    expect(sds[3] / sds[0]).toBeGreaterThan(5);
    expect(returnChance('low')).toBeCloseTo(1, 14); // no Tower in the Low deck
  });

  it('the top prize is honest: the cube of the top card, reachable with the stated chance', () => {
    for (const r of RISKS) {
      const deck = DECKS[r];
      const top = deck[deck.length - 1];
      const d = distribution(r);
      expect(d[d.length - 1].multiplier).toBe(topPrize(r));
      expect(chanceAtLeast(r, topPrize(r))).toBeCloseTo(top.p ** 3, 15);
    }
    expect(MAX_MULTIPLIER).toBe(27_000);
    expect(manifest.maxMultiplier).toBe(MAX_MULTIPLIER);
  });

  it('simulated RTP matches the manifest on every config', () => {
    for (const r of runEval(evalSpec, { rounds: 60_000 })) {
      expect(Math.abs(r.rtp - (r.targetRtp ?? manifest.rtp))).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
