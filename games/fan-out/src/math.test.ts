import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import { DECK, FUSES, MAX_MULTIPLIER, RTP, TARGETS, apply, burnCount, cashOutFor, deckOf, drawCard, glowOf, laidCount, prizeFor, startChance, startState, verdict, winChance, type State } from './math';

const rng = createRng(seededSource(31));

function randomState(k: number): State | null {
  let s = startState();
  const stopAt = rng.int(6);
  for (let i = 0; i < stopAt; i++) {
    if (verdict(k, s)) return null;
    s = apply(s, drawCard(rng.next(), s)).state;
  }
  return verdict(k, s) ? null : s;
}

describe('Fan Out maths', () => {
  it('the card figures: 72.33%, 44.66%, 25.55%, 7.69%, 1.30% for 1, 2, 3, 5, 8 cards', () => {
    const want = [0.7233, 0.4466, 0.2555, 0.0769, 0.013];
    TARGETS.forEach((k, i) => expect(Math.abs(startChance(k) - want[i])).toBeLessThan(6e-5));
    expect(startChance(1) / startChance(8)).toBeGreaterThan(50);
    expect(deckOf(startState()).length).toBe(DECK);
    expect(glowOf(startState()).lay.length).toBe(8);
  });

  it('the exact win chance matches a direct simulation of a shuffled deck', () => {
    for (const k of TARGETS) {
      const rounds = 60_000;
      let wins = 0;
      for (let t = 0; t < rounds; t++) {
        let s = startState();
        while (!verdict(k, s)) s = apply(s, drawCard(rng.next(), s)).state;
        if (verdict(k, s) === 'won') wins++;
      }
      const p = startChance(k);
      expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-4);
    }
  });

  it('the glowing share on the board is the true chance the next card is laid', () => {
    for (const k of TARGETS) {
      for (let n = 0; n < 100; n++) {
        const s = randomState(k);
        if (!s) continue;
        const g = glowOf(s);
        const N = g.left * 40;
        let hits = 0;
        for (let i = 0; i < N; i++) if (g.lay.includes(drawCard((i + 0.5) / N, s))) hits++;
        expect(hits / N).toBeCloseTo(g.lay.length / g.left, 14);
      }
    }
  });

  it('martingale: averaged over the next card, the cash-out after equals the cash-out now', () => {
    for (const k of TARGETS) {
      for (let n = 0; n < 200; n++) {
        const s = randomState(k);
        if (!s) continue;
        const left = deckOf(s);
        const after = left.reduce((a, c) => {
          const next = apply(s, c).state;
          const v = verdict(k, next);
          return a + (v === 'won' ? prizeFor(k) : v === 'lost' ? 0 : cashOutFor(k, next));
        }, 0) / left.length;
        const now = cashOutFor(k, s);
        expect(Math.abs(after - now)).toBeLessThan(1e-12 * Math.max(1, now));
      }
    }
  });

  it('every laid card raises the chance, every burned card lowers it, and no live state is certain or dead', () => {
    for (const k of TARGETS) {
      for (let round = 0; round < 800; round++) {
        let s = startState();
        while (!verdict(k, s)) {
          const p = winChance(k, s);
          expect(p).toBeGreaterThan(0);
          expect(p).toBeLessThan(1);
          const { state, laid } = apply(s, drawCard(rng.next(), s));
          const q = winChance(k, state);
          if (verdict(k, state) === null) expect(laid ? q > p : q < p).toBe(true);
          s = state;
        }
        expect(laidCount(s) >= k || burnCount(s) === FUSES).toBe(true);
      }
    }
  });

  it('the cash-out starts at the RTP, a full win pays the prize, and the bound holds', () => {
    for (const k of TARGETS) {
      expect(cashOutFor(k, startState())).toBeCloseTo(RTP, 12);
      expect(prizeFor(k) * startChance(k)).toBeCloseTo(RTP, 14);
    }
    expect(MAX_MULTIPLIER).toBeCloseTo(prizeFor(8), 12);
    expect(manifest.maxMultiplier).toBeGreaterThanOrEqual(Math.max(...TARGETS.map(prizeFor)) - 1e-12);
  });

  it('simulated RTP matches the manifest under mixed strategies, with enough spread in volatility', () => {
    const reports = runEval(evalSpec, { rounds: 60_000 });
    for (const r of reports) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier + 1e-9);
    }
    expect(reports[reports.length - 1].stdDev).toBeGreaterThan(5 * reports[0].stdDev);
  });
});
