import { createRng, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import { FULL, KS, MAX_MULTIPLIER, RTP, SEVEN_WAYS, TOTALS, advance, greenCells, headline, light, popcount, prizeFor, waysOf, winChance } from './math';
import evalSpec from './eval';
import manifest from './manifest';
import { runEval } from '@originals/game-sdk';

const rng = createRng(seededSource(7));

/** Direct recursion over raw dice outcomes, no table: chance to light k totals before a 7. */
function direct(k: number, mask: number): number {
  if (popcount(mask) >= k) return 1;
  const g = greenCells(mask);
  let s = 0;
  for (const t of TOTALS) if (!(mask & (1 << TOTALS.indexOf(t)))) s += (waysOf(t) / (g + SEVEN_WAYS)) * direct(k, light(mask, t));
  return s;
}

describe('Seven Out maths', () => {
  it('ways: 36 face pairs, 6 sevens, ten other totals', () => {
    expect(TOTALS.reduce((a, t) => a + waysOf(t), 0) + SEVEN_WAYS).toBe(36);
    expect(greenCells(0)).toBe(30);
  });

  it('the table equals the direct recursion, and the card values hold', () => {
    for (const k of KS) for (const mask of [0, 1, 0b100110, 0b1111111]) expect(winChance(k, mask)).toBeCloseTo(direct(k, mask), 12);
    const card = [53.64, 40.81, 29.5, 19.86, 12.04, 6.19, 2.4, 0.526];
    KS.forEach((k, i) => expect(headline(k) * 100).toBeCloseTo(card[i], 1));
    expect(MAX_MULTIPLIER).toBeCloseTo(0.99 / headline(10), 9);
  });

  it('one total left: the win chance is exactly green / (green + 6), the picture on the board', () => {
    for (let mask = 0; mask <= FULL; mask++) {
      if (popcount(mask) !== 9) continue;
      expect(winChance(10, mask)).toBeCloseTo(greenCells(mask) / (greenCells(mask) + SEVEN_WAYS), 14);
    }
    // k = 5 with 6, 8, 5, 9 made: 12 green, 12/18.
    const mask = [6, 8, 5, 9].reduce(light, 0);
    expect(greenCells(mask)).toBe(12);
    expect(winChance(5, mask)).toBeCloseTo(12 / 18, 14);
  });

  it('making a total never lowers the chance', () => {
    for (const k of KS) for (let mask = 0; mask <= FULL; mask++) if (popcount(mask) < k) for (const t of TOTALS) expect(winChance(k, light(mask, t))).toBeGreaterThanOrEqual(winChance(k, mask) - 1e-15);
  });

  it('playing to the end wins as often as the formula says (raw dice)', () => {
    for (const k of [3, 6, 10]) {
      const rounds = 60000;
      let wins = 0;
      for (let r = 0; r < rounds; r++) {
        const seen = new Set<number>();
        for (;;) {
          const t = rng.int(6) + 1 + rng.int(6) + 1;
          if (t === 7) break;
          seen.add(t);
          if (seen.size === k) {
            wins++;
            break;
          }
        }
      }
      const p = headline(k);
      expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-3);
    }
  });

  it('a step is a fair bet: E[cash after one step] = cash now, at every lit set', () => {
    for (const k of KS) {
      const prize = prizeFor(k);
      for (let mask = 0; mask <= FULL; mask++) {
        if (popcount(mask) >= k) continue;
        const g = greenCells(mask);
        let ev = 0;
        for (const t of TOTALS) if (!(mask & (1 << TOTALS.indexOf(t)))) ev += (waysOf(t) / (g + SEVEN_WAYS)) * prize * winChance(k, light(mask, t));
        expect(Math.abs(ev - prize * winChance(k, mask))).toBeLessThan(1e-12 * prize);
      }
    }
  });

  it('advance() ends on a new total or a 7, repeats only before', () => {
    for (let i = 0; i < 2000; i++) {
      const { rolls } = advance(rng.int(1 << 10) & ~0, rng);
      const last = rolls[rolls.length - 1];
      expect(last.kind === 'repeat').toBe(false);
      for (const r of rolls.slice(0, -1)) expect(r.kind).toBe('repeat');
    }
  });

  it('eval RTP within 4 SE of the manifest, max within maxMultiplier', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000, seed: 3 })) {
      expect(Math.abs(r.rtp - RTP)).toBeLessThan(4 * r.stdError + 1e-9);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier + 1e-9);
      expect(r.p99Steps).toBeLessThanOrEqual(30);
    }
  });
});
