// Fairness audit: no strategy beats the RTP.
//
// Diamonds has no decision inside a round: the risk table and stake are fixed
// before the bet, all five gems are drawn the moment the bet is accepted, and
// the round ends when they land. So the tester's rule (a), take-any-profit (b)
// and play-to-the-end (c) are all the same strategy: one drop. The value
// before the drop is RTP, and the drop's exact expectation is checked by
// driving the real playRound through all 7⁵ colour sequences. The only lever
// a player has is the risk table between rounds; (d) picks it adaptively.
import { createRng, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { COLOURS, GEMS, HANDS, HAND_COUNTS, OUTCOMES, RISKS, RTP, playRound, type Hand, type Risk } from './math';

describe('Diamonds fairness', () => {
  it('each colour gets an equal cell of [0, 1), and all 7⁵ drops average to exactly RTP', () => {
    // floor(u·7) maps [c/7, (c+1)/7) to colour c, with the clamp only for u = 1.
    for (let c = 0; c < COLOURS; c++) {
      const lo = c / COLOURS + 1e-12;
      const hi = (c + 1) / COLOURS - 1e-12;
      expect(playRound(() => lo, 'low').gems[0]).toBe(c);
      expect(playRound(() => hi, 'low').gems[0]).toBe(c);
    }
    for (const risk of RISKS) {
      const count = Object.fromEntries(HANDS.map((h) => [h, 0])) as Record<Hand, number>;
      let pay = 0;
      let bad = 0;
      for (let s = 0; s < OUTCOMES; s++) {
        const digits = Array.from({ length: GEMS }, (_, i) => Math.floor(s / COLOURS ** i) % COLOURS);
        let k = 0;
        const r = playRound(() => (digits[k++] + 0.5) / COLOURS, risk);
        if (k !== GEMS || r.gems.some((g, i) => g !== digits[i])) bad++;
        count[r.hand]++;
        pay += r.multiplier;
      }
      expect(bad).toBe(0);
      for (const h of HANDS) expect(count[h]).toBe(HAND_COUNTS[h]);
      expect(pay / OUTCOMES).toBeCloseTo(RTP, 12);
    }
  });

  it('every eval config, and adaptive risk pickers, are within 4 SE of RTP (50k drops each; 5M in the scratch run)', () => {
    // (d): after a loss go to High (chase the 222.98×), after a win drop to Low;
    // and a "hot colour" picker that re-rolls the table at random unless the
    // last drop paid ≥ 2×.
    const chase = (rng: ReturnType<typeof createRng>) => {
      let risk: Risk = 'classic';
      return () => {
        const r = playRound(rng.next, risk);
        risk = r.multiplier === 0 ? 'high' : r.multiplier > 1 ? 'low' : risk;
        return r.multiplier;
      };
    };
    const hot = (rng: ReturnType<typeof createRng>) => {
      let risk: Risk = 'high';
      return () => {
        const r = playRound(rng.next, risk);
        if (r.multiplier < 2) risk = RISKS[rng.int(RISKS.length)];
        return r.multiplier;
      };
    };
    const runs: [string, () => number, number][] = [
      ...evalSpec.configs.map((c, i): [string, () => number, number] => {
        const rng = createRng(seededSource(700 + i));
        return [c.label, () => evalSpec.playRound(c.params, rng).multiplier, c.rtp ?? RTP];
      }),
      ['chase (high after a loss, low after a win)', chase(createRng(seededSource(800))), RTP],
      ['hot table', hot(createRng(seededSource(801))), RTP],
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
