// Fairness audit: can any way of playing Tarot beat the RTP?
//
// A round is one Bet: three cards are drawn the moment the ticket is accepted
// (playRound, three host uniforms), then turned left to right. There is no
// cash-out, no hold and no choice once the bet is placed: the deck (risk) is
// disabled while the reading runs, Auto replays the same playOnce, and the
// settled value is the product of the three faces. So the only decisions a
// player has are which deck to bet on and when to stop playing, both between
// rounds. Strategies (a) "act only when the next card is ≥ 80% safe, else
// cash out" and (b) "cash out the moment the value exceeds the bet" have no
// in-round action to take, so they collapse to (c) "play to the end".
//
// The value process is still a martingale: after k cards turned, the round is
// worth V(k) = (product so far) · ∛0.99^(3−k), and the next card has mean
// ∛0.99, so E[V(k+1) | k cards] = V(k), V(0) = 0.99, V(3) = the settlement.
// The check enumerates every next card exactly at states taken from real
// rounds on every deck.
//
// Strategies run on every eval config (each deck, deck switched at random
// each round, risk raised after every loss) plus (d), the highest-variance
// rule a player could pick: always the Extreme deck, and "Martingale" deck
// chasing (Extreme after a loss, Low after a win). Every one is checked
// against the exact 99% within 4 SE.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { CARDS_PER_ROUND, CARD_MEAN, DECKS, MAX_MULTIPLIER, RISKS, RTP, drawIndex, playRound, rtpOf, type Risk } from './math';

/** Rounds per strategy run; the audit's heavy run sets FAIRNESS_ROUNDS=200000. */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 20_000);

/** V(k): the reading's fair value after its first k cards are face up. */
const valueAfter = (values: readonly number[], k: number) => values.slice(0, k).reduce((a, v) => a * v, 1) * CARD_MEAN ** (CARDS_PER_ROUND - k);

function meanSe(xs: number[]) {
  const n = xs.length;
  let s = 0;
  let s2 = 0;
  let max = 0;
  for (const x of xs) {
    s += x;
    s2 += x * x;
    max = Math.max(max, x);
  }
  const m = s / n;
  return { mean: m, se: Math.sqrt(Math.max(0, s2 / n - m * m) / n), max };
}

describe('Tarot fairness', () => {
  it('martingale (exact): at states from real rounds, E[V after the next card] = V now, every card enumerated', () => {
    const rng = createRng(seededSource(41));
    let states = 0;
    for (const risk of RISKS) {
      const deck = DECKS[risk];
      for (let n = 0; n < 12; n++) {
        const r = playRound(rng.next, risk);
        for (let k = 0; k < CARDS_PER_ROUND; k++) {
          const v = valueAfter(r.values, k);
          let after = 0;
          for (const c of deck) after += c.p * valueAfter([...r.values.slice(0, k), c.value], k + 1);
          expect(Math.abs(after - v)).toBeLessThan(1e-12 * Math.max(1, v));
          states++;
        }
        // The last card's value is the settlement, which is the exact product (snapping never rounds up past it).
        expect(valueAfter(r.values, CARDS_PER_ROUND)).toBeCloseTo(r.multiplier, 9);
      }
      expect(valueAfter([], 0)).toBeCloseTo(RTP, 12);
    }
    expect(states).toBeGreaterThanOrEqual(30);
  });

  it('the draw honours the shown chance of every card exactly (inverse-CDF interval lengths)', () => {
    for (const risk of RISKS) {
      const deck = DECKS[risk];
      let acc = 0;
      for (let i = 0; i < deck.length; i++) {
        expect(deck[i].p).toBeGreaterThan(0);
        const lo = acc;
        const hi = i === deck.length - 1 ? 1 : acc + deck[i].p;
        // The interval [lo, hi) maps to card i: its length is p_i, so u uniform in [0, 1) draws card i with chance p_i.
        expect(Math.abs(hi - lo - deck[i].p)).toBeLessThan(1e-15);
        expect(drawIndex(risk, lo)).toBe(i);
        if (hi - lo > 1e-9) {
          expect(drawIndex(risk, (lo + hi) / 2)).toBe(i);
          expect(drawIndex(risk, hi - 1e-12)).toBe(i);
        }
        acc = hi;
      }
      expect(drawIndex(risk, 1 - 2 ** -53)).toBe(deck.length - 1);
    }
  });

  it('settlements are never rounded in the player’s favour, and each deck enumerates to exactly 99%', () => {
    const rng = createRng(seededSource(7));
    for (const risk of RISKS) {
      expect(Math.abs(rtpOf(risk) - RTP)).toBeLessThan(1e-12);
      for (let n = 0; n < 2000; n++) {
        const r = playRound(rng.next, risk);
        const raw = r.values.reduce((a, v) => a * v, 1);
        expect(Math.abs(r.multiplier - raw)).toBeLessThan(1e-9);
        expect(r.multiplier).toBeLessThanOrEqual(MAX_MULTIPLIER);
      }
    }
  });

  it('strategies: every eval config and (d) the highest-variance deck rules return 99% within 4 SE', () => {
    const rows: string[] = [];
    const run = (label: string, rounds: number, play: (rng: Rng) => number, seed: number) => {
      const rng = createRng(seededSource(seed));
      const xs = Array.from({ length: rounds }, () => play(rng));
      const { mean, se, max } = meanSe(xs);
      rows.push(`${label.padEnd(44)} ${(mean * 100).toFixed(2)}% ± ${(se * 100).toFixed(2)}%  z=${((mean - RTP) / se).toFixed(2)}  max=${max}`);
      expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-12);
      expect(max).toBeLessThanOrEqual(MAX_MULTIPLIER);
    };
    evalSpec.configs.forEach((c, i) => {
      // (a), (b) and (c) are the same rule here: no in-round action exists.
      run(`(a)=(b)=(c) ${c.label}`, ROUNDS, (rng) => evalSpec.playRound(c.params, rng).multiplier, 100 + i);
    });
    // (d) Highest variance every round.
    run('(d) always Extreme', ROUNDS, (rng) => playRound(rng.next, 'extreme').multiplier, 200);
    // (d) Swing between decks on the last result: Extreme after a loss, Low after a win.
    let deck: Risk = 'low';
    run(
      '(d) Extreme after a loss, Low after a win',
      ROUNDS,
      (rng) => {
        const m = playRound(rng.next, deck).multiplier;
        deck = m >= 1 ? 'low' : 'extreme';
        return m;
      },
      201,
    );
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
