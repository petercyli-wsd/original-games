// Fairness audit: no strategy beats the RTP.
//
// Darts has no decision inside a round and no cash-out: the difficulty and
// stake are fixed before the bet, the dart is thrown the moment the bet is
// accepted, and the round ends when it lands. The "martingale" is one step:
// the value before the throw (RTP) equals the exact expected payout, checked
// by enumerating every (s, cell) outcome with the real zoneAt. The only
// lever a player has is the difficulty between throws; hostile pickers
// choose it adaptively from the history.
import { createRng, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { CELLS, DIFFICULTIES, RTP, TOTAL_UNITS, payout, throwDart, zoneAt, type Difficulty } from './math';

describe('Darts fairness', () => {
  it('the exact expected payout of the throw is RTP on every difficulty', () => {
    for (const d of DIFFICULTIES) {
      let cents = 0;
      for (let s = 0; s < TOTAL_UNITS; s++) for (let c = 0; c < CELLS; c++) cents += Math.round(payout(d, zoneAt(d, s, c)) * 100);
      expect(cents).toBe(RTP * 100 * TOTAL_UNITS * CELLS);
    }
  });

  it('every eval config and hostile difficulty pickers are within 4 SE of RTP', () => {
    type R = ReturnType<typeof createRng>;
    const adaptive = (rng: R) => {
      let d: Difficulty = 'medium';
      return () => {
        const t = throwDart(rng.next, d);
        d = t.multiplier < 1 ? 'expert' : t.multiplier > 1 ? 'easy' : d;
        return t.multiplier;
      };
    };
    const hotHand = (rng: R) => {
      let d: Difficulty = 'hard';
      return () => {
        const t = throwDart(rng.next, d);
        if (t.multiplier < 2) d = DIFFICULTIES[rng.int(DIFFICULTIES.length)];
        return t.multiplier;
      };
    };
    const stopOnProfit = (rng: R) => {
      // Throws Expert until a profit, then switches to Easy for one throw, repeating.
      let onEasy = false;
      return () => {
        const t = throwDart(rng.next, onEasy ? 'easy' : 'expert');
        onEasy = !onEasy && t.multiplier > 1;
        return t.multiplier;
      };
    };
    const runs: [string, () => number, number][] = [
      ...evalSpec.configs.map((c, i): [string, () => number, number] => {
        const rng = createRng(seededSource(500 + i));
        return [c.label, () => evalSpec.playRound(c.params, rng).multiplier, c.rtp ?? RTP];
      }),
      ['adaptive', adaptive(createRng(seededSource(600))), RTP],
      ['hot hand', hotHand(createRng(seededSource(601))), RTP],
      ['expert until profit', stopOnProfit(createRng(seededSource(602))), RTP],
    ];
    for (const [label, play, target] of runs) {
      const rounds = 100_000;
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
