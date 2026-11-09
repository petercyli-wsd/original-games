// Fairness audit: no strategy can beat the RTP.
//
// Cases has no mid-round decision: the difficulty and case count are chosen
// before the bet, the bet is placed, and only then is u drawn (Game.tsx
// playOnce: ticket.place → playRound(rng.next)). There is no cash-out, switch
// or hold while the reel spins (Skip only shortens the animation; the ticket
// already holds the drawn result). So the cash-out "martingale" is a single
// step from RTP to the payout, and the tester's rule (a), take-any-profit (b)
// and play-to-the-end (c) all collapse to "open the case". The only freedom
// is between bets (difficulty, count, stake progression), checked as (d).
//
// Every check uses the game's own playRound / itemIndex with a scripted or
// seeded uniform source, never a re-implementation of the paytable.

import { createRng, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { CASES, CASE_COUNTS, DIFFICULTIES, MAX_MULTIPLIER, RTP, WEIGHT_TOTAL, itemIndex, playRound, stdDev, type Difficulty } from './math';

/** FAIRNESS_FULL=1 runs Monte Carlo long enough for a 0.3% standard error on every config. */
const FULL = !!import.meta.env.FAIRNESS_FULL;
const log = (line: string) => FULL && console.log(line);

/** A uniform u inside item i's cumulative-weight interval (its first cell's centre). */
function uFor(d: Difficulty, i: number): number {
  let acc = 0;
  for (let j = 0; j < i; j++) acc += CASES[d][j].weight;
  return (acc + 0.5) / WEIGHT_TOTAL;
}

describe('Cases fairness', () => {
  it('martingale: from every (difficulty, count) state, E[payout] over the exact item tuples = RTP', () => {
    for (const d of DIFFICULTIES) {
      const items = CASES[d];
      for (const n of CASE_COUNTS) {
        // Enumerate every n-tuple of items and feed it through the real playRound.
        let ev = 0;
        let mass = 0;
        let max = 0;
        const total = items.length ** n;
        for (let code = 0; code < total; code++) {
          const pick: number[] = [];
          let c = code;
          for (let r = 0; r < n; r++) pick.push(c % items.length), (c = Math.floor(c / items.length));
          let k = 0;
          const res = playRound(() => uFor(d, pick[k++]), d, n);
          expect(res.openings.map((o) => o.index)).toEqual(pick);
          const p = pick.reduce((s, i) => s * items[i].p, 1);
          ev += p * res.multiplier;
          mass += p;
          max = Math.max(max, res.multiplier);
        }
        expect(mass).toBeCloseTo(1, 12);
        expect(Math.abs(ev - RTP)).toBeLessThan(1e-12);
        expect(max).toBeLessThanOrEqual(MAX_MULTIPLIER);
      }
    }
  });

  it('the draw matches the table: each item owns exactly weight/100,000 of [0, 1), also on the 32-bit RNG grid', () => {
    for (const d of DIFFICULTIES) {
      const items = CASES[d];
      // Every k-cell of width 1/W maps to the item whose cumulative interval holds k.
      const count = Array<number>(items.length).fill(0);
      for (let k = 0; k < WEIGHT_TOTAL; k++) count[itemIndex((k + 0.5) / WEIGHT_TOTAL, d)]++;
      expect(count).toEqual(items.map((it) => it.weight));
      expect(itemIndex(0, d)).toBe(0);
      expect(itemIndex(1 - 2 ** -32, d)).toBe(items.length - 1);
      // The host RNG returns m / 2^32. On that grid item i is hit by
      // ceil(A_{i+1}·2^32/W) − ceil(A_i·2^32/W) values (u·W is exact in doubles),
      // so the true RTP sits a hair under 99%: never in the player's favour.
      let acc = 0;
      let rtpGrid = 0;
      for (const it of items) {
        const lo = Math.ceil((acc * 2 ** 32) / WEIGHT_TOTAL);
        acc += it.weight;
        const hi = Math.ceil((acc * 2 ** 32) / WEIGHT_TOTAL);
        // Spot-check the counting formula against the real itemIndex at the grid edges.
        if (lo > 0) expect(itemIndex((lo - 1) / 2 ** 32, d)).not.toBe(items.indexOf(it));
        expect(itemIndex(lo / 2 ** 32, d)).toBe(items.indexOf(it));
        expect(itemIndex((hi - 1) / 2 ** 32, d)).toBe(items.indexOf(it));
        rtpGrid += ((hi - lo) / 2 ** 32) * it.mult;
      }
      // Measured: −1.5e-9 (Easy) to −1.5e-7 (Expert), i.e. the grid rounding favours the house.
      expect(rtpGrid).toBeLessThanOrEqual(RTP);
      expect(RTP - rtpGrid).toBeLessThan(1e-6);
      log(`32-bit grid RTP ${d}: ${(rtpGrid * 100).toFixed(10)}% (bias ${((rtpGrid - RTP) * 100).toExponential(2)} pp)`);
    }
  });

  // (a) tester's rule, (b) take any profit and (c) play to the end are all the
  // same action here: the round is one draw with no checkpoint, so they are
  // one Monte Carlo per eval config with the real RNG.
  it('every eval config returns RTP with the real RNG (strategies a = b = c), within 4 SE', () => {
    for (const cfg of evalSpec.configs) {
      const { difficulty, count } = cfg.params;
      const sd = difficulty === 'mixed' || count === 'mixed' ? 6 : stdDev(difficulty, count);
      const rounds = FULL ? Math.max(200_000, Math.min(20_000_000, Math.ceil((sd / 0.003) ** 2))) : 200_000;
      const rng = createRng(seededSource(31 + rounds));
      let sum = 0;
      let sq = 0;
      for (let r = 0; r < rounds; r++) {
        const x = evalSpec.playRound(cfg.params, rng).multiplier;
        sum += x;
        sq += x * x;
      }
      const mean = sum / rounds;
      const se = Math.sqrt((sq / rounds - mean * mean) / rounds);
      log(`MC ${cfg.label} | a=b=c open the case | ${rounds} rounds | RTP ${(mean * 100).toFixed(3)}% ± ${(se * 100).toFixed(3)}%`);
      expect(Math.abs(mean - RTP), `${cfg.label}: ${mean} ± ${se}`).toBeLessThan(4 * se);
    }
  });

  // (d) The only freedom is between bets: pick the case and count from what
  // just happened, and scale the stake. Payout per unit staked must still be RTP.
  it('(d) adaptive case choice and stake progression between bets still returns RTP (4 SE)', () => {
    const rng = createRng(seededSource(77));
    const rounds = FULL ? 20_000_000 : 200_000;
    let staked = 0;
    let paid = 0;
    let sq = 0; // Σ (stake·(mult − RTP))², for the ratio estimator's SE
    let d: Difficulty = 'expert';
    let n = 1;
    let stake = 1;
    for (let r = 0; r < rounds; r++) {
      const res = playRound(() => rng.next(), d, n);
      staked += stake;
      paid += stake * res.multiplier;
      sq += (stake * (res.multiplier - RTP)) ** 2;
      // Chase losses on Expert with a doubling stake (capped), bank wins on Easy ×4.
      if (res.multiplier < 1) {
        d = 'expert';
        n = 1;
        stake = Math.min(stake * 2, 8);
      } else {
        d = 'easy';
        n = 4;
        stake = 1;
      }
    }
    const rtp = paid / staked;
    // Ratio estimator: SE ≈ sd(stake·(mult − RTP)) / (√N · mean stake).
    const meanStake = staked / rounds;
    const se = Math.sqrt(sq / rounds / rounds) / meanStake;
    log(`MC (d) loss-chasing Expert / win-banking Easy×4 | ${rounds} rounds | RTP ${(rtp * 100).toFixed(3)}% ± ${(se * 100).toFixed(3)}%`);
    expect(Math.abs(rtp - RTP)).toBeLessThan(4 * se);
  });
});
