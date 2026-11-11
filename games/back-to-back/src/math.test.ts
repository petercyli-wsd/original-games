import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import { DECK, MAX_MULTIPLIER, NO_TOP, RTP, drawColour, ifNext, startChances, startPrize, total, turn, valueAfter, winChances, without } from './math';

/** Reachable live states (no snap yet) from random plays. */
function reachable(want: number, seed: number) {
  const rng = createRng(seededSource(seed));
  const out: { counts: number[]; top: number }[] = [];
  while (out.length < want) {
    let counts = [...DECK];
    let top = NO_TOP;
    const keep = rng.int(10);
    for (let k = 0; ; k++) {
      const t = turn(counts, top, rng.next());
      if (t.snap) break;
      counts = t.counts;
      top = t.top;
      if (k === keep) {
        out.push({ counts, top });
        break;
      }
    }
  }
  return out;
}

describe('Back to Back maths', () => {
  it('title odds are the exact DP: 79.91 / 14.15 / 4.43 / 1.51 %, summing to 1', () => {
    const p = startChances();
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    [0.7991, 0.1415, 0.0443, 0.0151].forEach((v, i) => expect(p[i]).toBeCloseTo(v, 3));
    expect(p[0] / p[3]).toBeGreaterThan(25);
  });

  it('the DP matches a direct simulation of a shuffled deck (4 SE)', () => {
    const rng = createRng(seededSource(11));
    const n = 200_000;
    const wins = DECK.map(() => 0);
    for (let r = 0; r < n; r++) {
      const deck: number[] = [];
      DECK.forEach((c, j) => deck.push(...Array(c).fill(j)));
      for (let i = deck.length - 1; i > 0; i--) {
        const k = rng.int(i + 1);
        [deck[i], deck[k]] = [deck[k], deck[i]];
      }
      let w = -1;
      for (let i = 1; i < deck.length; i++) if (deck[i] === deck[i - 1]) { w = deck[i]; break; }
      expect(w).toBeGreaterThanOrEqual(0); // a snap is certain
      wins[w]++;
    }
    const p = startChances();
    p.forEach((q, j) => {
      const se = Math.sqrt((q * (1 - q)) / n);
      expect(Math.abs(wins[j] / n - q)).toBeLessThan(4 * se);
    });
  });

  it('every round ends within the 22 cards', () => {
    const rng = createRng(seededSource(5));
    for (let r = 0; r < 20_000; r++) {
      let counts = [...DECK];
      let top = NO_TOP;
      let cards = 0;
      for (;;) {
        const t = turn(counts, top, rng.next());
        cards++;
        if (t.snap) break;
        counts = t.counts;
        top = t.top;
        expect(total(counts)).toBeGreaterThan(0);
      }
      expect(cards).toBeLessThanOrEqual(22);
    }
  });

  it('martingale: the cash-out now equals the average over the next card, for every colour', () => {
    const states = reachable(40, 3);
    for (const { counts, top } of states) {
      const now = winChances(counts, top);
      const n = total(counts);
      for (let me = 0; me < DECK.length; me++) {
        let avg = 0;
        counts.forEach((c, j) => {
          if (c === 0) return;
          const t = turn(counts, top, (counts.slice(0, j).reduce((a, b) => a + b, 0) + 0.5) / n);
          expect(t.colour).toBe(j);
          avg += (c / n) * valueAfter(t, me, 1);
        });
        expect(Math.abs(avg - now[me])).toBeLessThan(1e-12);
      }
    }
  });

  it('odds on screen are the true risk: the deck bar is the next-card law and the ghosts average to the chance now', () => {
    for (const { counts, top } of reachable(40, 8)) {
      const n = total(counts);
      for (let me = 0; me < DECK.length; me++) {
        const ghosts = ifNext(counts, top, me);
        const avg = counts.reduce((a, c, j) => a + (c / n) * ghosts[j], 0);
        expect(Math.abs(avg - winChances(counts, top)[me])).toBeLessThan(1e-12);
      }
      // The outlined segment (top colour) is exactly the chance the next card snaps.
      if (top >= 0) {
        let snap = 0;
        const rng = createRng(seededSource(1));
        const m = 20_000;
        for (let i = 0; i < m; i++) if (drawColour(counts, rng.next()) === top) snap++;
        const q = counts[top] / n;
        expect(Math.abs(snap / m - q)).toBeLessThan(4 * Math.sqrt((q * (1 - q)) / m) + 1e-9);
      }
    }
    expect(without([2, 1], 0)).toEqual([1, 1]);
  });

  it('the longest-shot prize bounds every payout', () => {
    expect(MAX_MULTIPLIER).toBeCloseTo(startPrize(3), 1);
    expect(MAX_MULTIPLIER).toBeLessThanOrEqual(manifest.maxMultiplier);
  });

  it('runEval: RTP within 4 SE of the manifest on every config, max within bound, rounds short', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp), r.label).toBeLessThan(4 * r.stdError + 1e-9);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier + 1e-9);
      expect(r.p99Steps).toBeLessThanOrEqual(22);
    }
    expect(RTP).toBe(manifest.rtp);
  });
});
