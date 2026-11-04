// Fairness audit: no strategy beats the RTP.
//
// Darts has no decision inside a round: the difficulty and stake are fixed
// before the bet, the dart is thrown the moment the bet is accepted, and the
// round ends when it lands. So the tester's rule (a), take-any-profit (b) and
// play-to-the-end (c) are all the same strategy: one throw. The cash-out
// "martingale" is a single step: the value before the throw (RTP) must equal
// the exact expected payout of the throw, checked by sweeping the real
// throwFrom over every 1/10,000 cell of u₁ (zones change only on whole
// squared radii, so each cell pays one zone). The only lever a player has is
// the difficulty between throws; (d) picks it adaptively from the history.
import { createRng, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { AREA_UNITS, DIFFICULTIES, INNER_R, OUTER_R, RTP, TOTAL_UNITS, ZONES, payout, throwDart, throwFrom, type Difficulty, type Zone } from './math';

describe('Darts fairness', () => {
  it('the drawn zone has exactly its area share, and the pin is drawn inside the zone that pays', () => {
    for (const d of DIFFICULTIES) {
      const count = Object.fromEntries(ZONES.map((z) => [z, 0])) as Record<Zone, number>;
      let pay = 0;
      let bad = 0;
      for (let i = 0; i < TOTAL_UNITS; i++) {
        const mid = throwFrom((i + 0.5) / TOTAL_UNITS, (i % 97) / 97, d);
        // The whole cell [i, i+1) of r² lands in one zone (tie rule: boundaries go outwards).
        if (throwFrom((i + 1e-6) / TOTAL_UNITS, 0, d).zone !== mid.zone) bad++;
        if (throwFrom((i + 1 - 1e-6) / TOTAL_UNITS, 0, d).zone !== mid.zone) bad++;
        // What the board draws (x, y) is the point that was scored, and it pays its zone.
        const r = Math.hypot(mid.x, mid.y);
        if (r < INNER_R[mid.zone] - 1e-9 || r >= OUTER_R[mid.zone] + 1e-9) bad++;
        if (mid.multiplier !== payout(d, mid.zone)) bad++;
        count[mid.zone]++;
        pay += mid.multiplier;
      }
      expect(bad).toBe(0);
      for (const z of ZONES) expect(count[z]).toBe(AREA_UNITS[z]);
      // The value before the throw is RTP; the throw's exact expectation is RTP.
      expect(pay / TOTAL_UNITS).toBeCloseTo(RTP, 12);
    }
  });

  it('every eval config, and an adaptive difficulty picker, is within 4 SE of RTP (50k throws each; 20M in the scratch run)', () => {
    // (d): after a loss jump to the highest-variance board, after a win drop to
    // Easy, after a refund stay; plus a "hot hand" picker that repeats the last
    // difficulty that paid ≥ 2×. Bet size does not enter the per-unit return.
    const adaptive = (rng: ReturnType<typeof createRng>) => {
      let d: Difficulty = 'medium';
      return () => {
        const t = throwDart(rng.next, d);
        d = t.multiplier === 0 ? 'expert' : t.multiplier > 1 ? 'easy' : d;
        return t.multiplier;
      };
    };
    const hotHand = (rng: ReturnType<typeof createRng>) => {
      let d: Difficulty = 'hard';
      return () => {
        const t = throwDart(rng.next, d);
        if (t.multiplier < 2) d = DIFFICULTIES[rng.int(DIFFICULTIES.length)];
        return t.multiplier;
      };
    };
    const runs: [string, () => number, number][] = [
      ...evalSpec.configs.map((c, i): [string, () => number, number] => {
        const rng = createRng(seededSource(500 + i));
        return [c.label, () => evalSpec.playRound(c.params, rng).multiplier, c.rtp ?? RTP];
      }),
      ['adaptive (expert after a loss, easy after a win)', adaptive(createRng(seededSource(600))), RTP],
      ['hot hand', hotHand(createRng(seededSource(601))), RTP],
    ];
    for (const [label, play, target] of runs) {
      const rounds = 50_000;
      let sum = 0;
      let sq = 0;
      for (let i = 0; i < rounds; i++) {
        const m = play();
        sum += m;
        sq += m * m;
      }
      const mean = sum / rounds;
      const se = Math.sqrt((sq / rounds - mean * mean) / rounds);
      expect(Math.abs(mean - target), `${label}: ${mean.toFixed(4)} ± ${se.toFixed(4)}`).toBeLessThan(4 * se);
    }
  });
});
