import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import { DECKS, MAX_MULTIPLIER, RTP, afterTurn, bestCallChance, cashOut, dealsRed, deckBar, prizeFor, settled, share } from './math';

const rng = createRng(seededSource(11));

/** A shuffled physical deck (true = red), Fisher–Yates from the seeded rng. */
function shuffled(red: number, black: number): boolean[] {
  const cards = [...Array<boolean>(red).fill(true), ...Array<boolean>(black).fill(false)];
  for (let i = cards.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

const se = (p: number, n: number) => Math.sqrt((p * (1 - p)) / n);

describe('Call It maths', () => {
  it('Winkler: no calling strategy, best or worst, changes the win chance r / n', () => {
    for (const { red, black } of DECKS) {
      expect(bestCallChance(red, black, 'max')).toBeCloseTo(red / (red + black), 12);
      expect(bestCallChance(red, black, 'min')).toBeCloseTo(red / (red + black), 12);
    }
    for (let r = 1; r <= 12; r++) for (let b = 1; b <= 12; b++) expect(bestCallChance(r, b)).toBeCloseTo(r / (r + b), 12);
  });

  it('timing strategies on a real shuffled deck win r / n of the time (4 SE)', () => {
    const rounds = 20_000;
    for (const { red, black } of DECKS) {
      const p = red / (red + black);
      const n = red + black;
      // Three rules: call the last card, call at a fixed position, call once reds lead the remainder.
      const wins = [0, 0, 0];
      for (let k = 0; k < rounds; k++) {
        const cards = shuffled(red, black);
        wins[0] += cards[n - 1] ? 1 : 0;
        wins[1] += cards[Math.floor(n / 3)] ? 1 : 0;
        let r = red;
        let i = 0;
        while (i < n - 1 && r / (n - i) <= p) r -= cards[i++] ? 1 : 0;
        wins[2] += cards[i] ? 1 : 0;
      }
      for (const w of wins) expect(Math.abs(w / rounds - p)).toBeLessThan(4 * se(p, rounds) + 1e-9);
    }
  });

  it('turning a card is a fair bet: E[cash-out after] = cash-out now, at every state', () => {
    for (const deck of DECKS) {
      const prize = prizeFor(deck);
      for (let r = 1; r <= deck.red; r++) {
        for (let b = 1; b <= deck.black; b++) {
          const p = share(r, b);
          const value = (d: { red: number; black: number }) => {
            const s = settled(d.red, d.black);
            return s === 'won' ? prize : s === 'lost' ? 0 : cashOut(prize, d.red, d.black);
          };
          const after = p * value(afterTurn(r, b, true)) + (1 - p) * value(afterTurn(r, b, false));
          expect(after).toBeCloseTo(cashOut(prize, r, b), 9);
          // Calling now is worth the same as cashing out.
          expect(p * prize).toBeCloseTo(cashOut(prize, r, b), 12);
        }
      }
      // The full deck is worth exactly RTP.
      expect(cashOut(prize, deck.red, deck.black)).toBeCloseTo(RTP, 12);
    }
  });

  it('the deck bar shows the true chance: red length / bar length = P(next red)', () => {
    for (let r = 0; r <= 13; r++) {
      for (let b = 0; b <= 49; b += 7) {
        if (r + b === 0) continue;
        const bar = deckBar(r, b, 360);
        expect(bar.redWidth / 360).toBeCloseTo(share(r, b), 12);
        expect(bar.cells.filter((c) => c.red).length).toBe(r);
        expect(bar.cells.length).toBe(r + b);
      }
    }
    // And the dealer really deals red that often, at random reachable states.
    for (let t = 0; t < 12; t++) {
      const r = 1 + rng.int(8);
      const b = 1 + rng.int(30);
      const N = 20_000;
      let reds = 0;
      for (let k = 0; k < N; k++) reds += dealsRed(r, b, rng.next()) ? 1 : 0;
      const p = share(r, b);
      expect(Math.abs(reds / N - p)).toBeLessThan(4 * se(p, N) + 1e-9);
    }
    // Tie rule: the boundary value u = r / n deals black.
    expect(dealsRed(1, 3, 0.25)).toBe(false);
    expect(dealsRed(1, 3, 0.2499999)).toBe(true);
  });

  it('the max multiplier is the largest locked prize', () => {
    expect(MAX_MULTIPLIER).toBeCloseTo(RTP * 50, 9);
    expect(manifest.maxMultiplier).toBe(MAX_MULTIPLIER);
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
