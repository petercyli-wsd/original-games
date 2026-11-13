// Fairness audit: can any way of playing Tarot beat the RTP?
//
// A round is one Bet: three cards are drawn the moment the ticket is accepted
// (core, left, right), then turned core first. There is no cash-out and no
// choice once the bet is placed; leaving mid-reveal settles the drawn payout
// from a ref. So the only decisions are the difficulty and when to stop, both
// between rounds. "Act only when next step is 80% safe", "cash out above the
// stake" and "play to the end" have no in-round action, so they collapse to
// play to the end.
//
// The staged value is still an exact martingale: after k cards are face up the
// round is worth (product shown) x 0.70^(3-k) (0.98 before any card). The check
// enumerates the next card exactly at 30+ states on every difficulty.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { DIFFICULTIES, MAX_MULTIPLIER, RTP, TABLES, drawIndex, playRound, rtpOf, stagedValue, type Difficulty } from './math';

/** Rounds per strategy run; the audit's heavy run sets FAIRNESS_ROUNDS=200000. */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 20_000);

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
  it('martingale (exact): at every core x left state, E[value after the next card] = value now', () => {
    let states = 0;
    for (const d of DIFFICULTIES) {
      const { core, side } = TABLES[d];
      // Before any card: the core's mean times its staged value factor.
      expect(core.reduce((a, c) => a + c.p * stagedValue([c.value], 1), 0)).toBeCloseTo(stagedValue([], 0), 12);
      expect(stagedValue([], 0)).toBeCloseTo(RTP, 12);
      states++;
      for (const c of core) {
        // After the core: E over the left card.
        expect(side.reduce((a, l) => a + l.p * stagedValue([c.value, l.value], 2), 0)).toBeCloseTo(stagedValue([c.value], 1), 12);
        states++;
        for (const l of side) {
          // After the left: E over the right card equals the staged value (0 if the left was 0x).
          const v = stagedValue([c.value, l.value], 2);
          expect(side.reduce((a, r) => a + r.p * stagedValue([c.value, l.value, r.value], 3), 0)).toBeCloseTo(v, 12);
          states++;
        }
      }
    }
    expect(states).toBeGreaterThanOrEqual(30);
  });

  it('the draw honours the shown chance of every card exactly (inverse-CDF interval lengths)', () => {
    for (const d of DIFFICULTIES)
      for (const t of [TABLES[d].core, TABLES[d].side]) {
        let acc = 0;
        for (let i = 0; i < t.length; i++) {
          const lo = acc;
          const hi = i === t.length - 1 ? 1 : acc + t[i].p;
          expect(Math.abs(hi - lo - t[i].p)).toBeLessThan(1e-15);
          expect(drawIndex(t, lo)).toBe(i);
          expect(drawIndex(t, hi - 1e-12)).toBe(i);
          acc = hi;
        }
        expect(drawIndex(t, 1 - 2 ** -53)).toBe(t.length - 1);
      }
  });

  it('settlements are never rounded in the player favour, and each difficulty enumerates to exactly 98%', () => {
    const rng = createRng(seededSource(7));
    for (const d of DIFFICULTIES) {
      expect(Math.abs(rtpOf(d) - RTP)).toBeLessThan(1e-12);
      for (let n = 0; n < 2000; n++) {
        const r = playRound(rng.next, d);
        const raw = r.values.reduce((a, v) => a * v, 1);
        expect(r.multiplier).toBeLessThanOrEqual(raw + 1e-9);
        expect(r.multiplier).toBeGreaterThan(raw - 1e-5);
        expect(r.multiplier).toBeLessThanOrEqual(MAX_MULTIPLIER);
      }
    }
  });

  it('strategies: every eval config and the highest-variance rules return 98% within 4 SE', () => {
    const rows: string[] = [];
    const run = (label: string, play: (rng: Rng) => number, seed: number) => {
      const rng = createRng(seededSource(seed));
      const { mean, se, max } = meanSe(Array.from({ length: ROUNDS }, () => play(rng)));
      rows.push(`${label.padEnd(44)} ${(mean * 100).toFixed(2)}% +- ${(se * 100).toFixed(2)}%  z=${((mean - RTP) / se).toFixed(2)}  max=${max}`);
      expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-12);
      expect(max).toBeLessThanOrEqual(MAX_MULTIPLIER);
    };
    evalSpec.configs.forEach((c, i) => run(`play to the end: ${c.label}`, (rng) => evalSpec.playRound(c.params, rng).multiplier, 100 + i));
    run('always Expert', (rng) => playRound(rng.next, 'expert').multiplier, 200);
    let d: Difficulty = 'easy';
    run('Expert after a loss, Easy after a win', (rng) => {
      const m = playRound(rng.next, d).multiplier;
      d = m >= 1 ? 'easy' : 'expert';
      return m;
    }, 201);
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
