// Fairness audit: no strategy can beat the RTP.
//
// Tile Pick has no mid-round decision and no cash-out: difficulty and picks are
// fixed before the bet, the bet is placed, and only then are the 30 tiles drawn
// (Game.tsx playOnce: ticket.place -> playRound(rng.next)). The "martingale" is
// one step from RTP to the payout, so "act when survival >= 0.8", "cash out
// above the stake" and "play to the end" all collapse to "bet". The freedom is
// between bets (difficulty, picks, positions, stake), checked below. Every
// check uses the game's own playRound / itemIndex.

import { createRng, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { DIFFICULTIES, PICK_COUNTS, RTP, TABLE, TILE_COUNT, WEIGHT_TOTAL, itemIndex, playRound, randomPicks, stdDev, type Difficulty } from './math';

const FULL = !!import.meta.env.FAIRNESS_FULL;

function uFor(d: Difficulty, i: number): number {
  let acc = 0;
  for (let j = 0; j < i; j++) acc += TABLE[d][j].weight;
  return (acc + 0.5) / WEIGHT_TOTAL;
}

describe('Tile Pick fairness', () => {
  it('martingale: from every (difficulty, picks) state, E[payout] over exact picked-item tuples = RTP (20 states)', () => {
    for (const d of DIFFICULTIES) {
      const items = TABLE[d];
      for (const n of PICK_COUNTS) {
        const picks = Array.from({ length: n }, (_, i) => i * 5 + 1); // any positions
        let ev = 0;
        let mass = 0;
        const total = items.length ** n;
        for (let code = 0; code < total; code++) {
          const tuple: number[] = [];
          let c = code;
          for (let r = 0; r < n; r++) tuple.push(c % items.length), (c = Math.floor(c / items.length));
          // Script the 30 draws: picked tiles get the tuple, the rest an arbitrary item.
          const draws = Array.from({ length: TILE_COUNT }, (_, t) => uFor(d, picks.includes(t) ? tuple[picks.indexOf(t)] : t % items.length));
          let k = 0;
          const res = playRound(() => draws[k++], d, picks);
          const p = tuple.reduce((s, i) => s * items[i].p, 1);
          ev += p * res.multiplier;
          mass += p;
        }
        expect(mass).toBeCloseTo(1, 12);
        expect(Math.abs(ev - RTP)).toBeLessThan(1e-12);
      }
    }
  });

  it('positional independence: the payout law does not depend on which tiles are picked', () => {
    for (const d of DIFFICULTIES) {
      const rng = createRng(seededSource(3));
      const rounds = 40_000;
      const sets = [[0], [29], [0, 1, 2, 3, 4], [5, 12, 17, 24, 29]];
      for (const picks of sets) {
        const n = picks.length;
        let sum = 0;
        for (let r = 0; r < rounds; r++) sum += playRound(() => rng.next(), d, picks).multiplier;
        expect(Math.abs(sum / rounds - RTP), `${d} ${picks}`).toBeLessThan(4 * (stdDev(d, n) / Math.sqrt(rounds)));
      }
    }
  });

  it('the draw covers exactly weight/1,000,000 of [0, 1), and the 32-bit RNG grid never favours the player', () => {
    for (const d of DIFFICULTIES) {
      const items = TABLE[d];
      let acc = 0;
      let rtpGrid = 0;
      for (const it of items) {
        const lo = Math.ceil((acc * 2 ** 32) / WEIGHT_TOTAL);
        acc += it.weight;
        const hi = Math.ceil((acc * 2 ** 32) / WEIGHT_TOTAL);
        expect(itemIndex(lo / 2 ** 32, d)).toBe(items.indexOf(it));
        expect(itemIndex((hi - 1) / 2 ** 32, d)).toBe(items.indexOf(it));
        rtpGrid += ((hi - lo) / 2 ** 32) * it.mult;
      }
      expect(rtpGrid).toBeLessThanOrEqual(RTP + 1e-12);
      expect(RTP - rtpGrid).toBeLessThan(1e-6);
    }
  });

  // Hostile strategies on every eval config, real RNG.
  it('every eval config returns RTP with the real RNG (bet = play to the end), within 4 SE', () => {
    for (const cfg of evalSpec.configs) {
      const { difficulty, picks } = cfg.params;
      const sd = difficulty === 'mixed' || picks === 'mixed' ? 6 : stdDev(difficulty, picks);
      const rounds = FULL ? Math.max(200_000, Math.min(5_000_000, Math.ceil((sd / 0.003) ** 2))) : 100_000;
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
      expect(Math.abs(mean - RTP), `${cfg.label}: ${mean} ± ${se}`).toBeLessThan(4 * se);
    }
  });

  it('hostile: always 1 tile on Expert; always 5 tiles on Easy; switching difficulty after losses (4 SE)', () => {
    const rounds = FULL ? 4_000_000 : 150_000;
    const rng = createRng(seededSource(91));
    const run = (choose: (lastLoss: boolean) => { d: Difficulty; n: number; stake: number }) => {
      let staked = 0;
      let paid = 0;
      let sq = 0;
      let lastLoss = false;
      for (let r = 0; r < rounds; r++) {
        const { d, n, stake } = choose(lastLoss);
        const m = playRound(() => rng.next(), d, randomPicks((k) => rng.int(k), n)).multiplier;
        staked += stake;
        paid += stake * m;
        sq += (stake * (m - RTP)) ** 2;
        lastLoss = m < 1;
      }
      const meanStake = staked / rounds;
      const se = Math.sqrt(sq / rounds / rounds) / meanStake;
      expect(Math.abs(paid / staked - RTP), `${paid / staked} ± ${se}`).toBeLessThan(4 * se);
    };
    run(() => ({ d: 'expert', n: 1, stake: 1 }));
    run(() => ({ d: 'easy', n: 5, stake: 1 }));
    // Chase losses on Expert with a doubled stake, bank wins on Easy with 5 picks.
    run((loss) => (loss ? { d: 'expert', n: 1, stake: 4 } : { d: 'easy', n: 5, stake: 1 }));
  });
});
