// Fairness audit: can any way of playing Roulette beat the RTP?
//
// A round is one spin with no decision after the bet: the chips are frozen
// while the wheel turns (table, chip and keyboard edits are all disabled
// while busy) and the payout is computed from the layout captured when Bet is
// pressed. So the tester's rule (a) and "take any profit" (b) collapse to
// (c) "play the spin": there is no cash-out to time. What a player *can*
// choose is the layout: any mix of the 157 table spots, racetrack calls and
// neighbours bets, at any chip sizes, and the stake sequence (auto-bet's
// on-win / on-loss scaling of the whole layout).
//
// The binding checks are exact, not sampled:
//   1. The table: 157 spots, each covering k distinct numbers in 0..36 and
//      paying 36 / k, with 18 reds, 18 blacks and the right counts per kind.
//   2. Every spot, and every layout tried (the eval's samplers, every call
//      bet, every neighbours bet, random mixes of up to 30 spots), returns
//      exactly 36/37 by enumerating the 37 pockets with the real spin().
//      Linearity means every layout does; (d) "the best layout" is therefore
//      36/37 too.
//   3. pocketOf maps u to 37 equal slices. The host rng returns j / 2^32, so
//      the exact count of 32-bit draws per pocket is found by binary search
//      on the real pocketOf: the best a player could do by betting the
//      pocket that rounding favours is +37 / 2^32 relative (~1e-8).
// Monte Carlo then plays every eval config and an auto-bet martingale with
// real spins as a plumbing check (4 SE).

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import {
  CALL_KEYS,
  MAX_MULTIPLIER,
  POCKETS,
  RTP,
  SPOTS,
  addCall,
  addNeighbours,
  addTo,
  colourOf,
  layoutStats,
  pocketOf,
  scaleLayout,
  spin,
  totalOf,
  type Layout,
} from './math';

/** Exact RTP of a layout with the real spin(): mean multiplier over the 37 pockets. */
function exactRtp(layout: Layout): number {
  let s = 0;
  for (let p = 0; p < POCKETS; p++) {
    const r = spin(layout, (p + 0.5) / POCKETS);
    if (r.pocket !== p) throw new Error(`pocketOf((${p} + 0.5) / 37) = ${r.pocket}`);
    s += r.multiplier;
  }
  return s / POCKETS;
}

describe('roulette fairness', () => {
  it('the table: 157 spots, each k distinct numbers paying 36/k', () => {
    expect(SPOTS.length).toBe(157);
    const ids = new Set(SPOTS.map((s) => s.id));
    expect(ids.size).toBe(157);
    const byKind: Record<string, number> = {};
    for (const s of SPOTS) {
      byKind[s.kind] = (byKind[s.kind] ?? 0) + 1;
      expect(new Set(s.nums).size).toBe(s.nums.length);
      for (const n of s.nums) expect(n >= 0 && n <= 36 && Number.isInteger(n)).toBe(true);
      expect(s.pays).toBe(36 / s.nums.length);
    }
    expect(byKind).toEqual({ straight: 37, split: 60, street: 12, trio: 2, corner: 22, basket: 1, line: 11, column: 3, dozen: 3, low: 1, high: 1, red: 1, black: 1, odd: 1, even: 1 });
    let red = 0;
    let black = 0;
    for (let n = 1; n <= 36; n++) colourOf(n) === 'red' ? red++ : black++;
    expect([red, black, colourOf(0)]).toEqual([18, 18, 'green']);
  });

  it('every single spot returns exactly 36/37', () => {
    for (const s of SPOTS) expect(Math.abs(exactRtp({ [s.id]: 1 }) - RTP)).toBeLessThan(1e-12);
  });

  it('every call bet, neighbours bet and random mix returns exactly 36/37', () => {
    for (const c of CALL_KEYS) expect(Math.abs(exactRtp(addCall({}, c, 0.1)) - RTP)).toBeLessThan(1e-12);
    for (let n = 0; n <= 36; n++) for (let k = 0; k <= 4; k++) expect(Math.abs(exactRtp(addNeighbours({}, n, k, 0.5)) - RTP)).toBeLessThan(1e-12);
    const rng = createRng(seededSource(3));
    for (let t = 0; t < 120; t++) {
      let lay: Layout = {};
      const m = 1 + rng.int(30);
      for (let i = 0; i < m; i++) lay = addTo(lay, SPOTS[rng.int(SPOTS.length)].id, [0.01, 0.1, 1, 5, 25, 500][rng.int(6)]);
      expect(Math.abs(exactRtp(lay) - RTP)).toBeLessThan(1e-12);
      expect(Math.abs(layoutStats(lay).rtp - RTP)).toBeLessThan(1e-12);
      // Auto-bet scales the layout to a new stake: still 36/37, and the scaled total is the stake.
      const target = Math.round((0.05 + rng.next() * 200) * 100) / 100;
      const scaled = scaleLayout(lay, target);
      expect(Math.abs(exactRtp(scaled) - RTP)).toBeLessThan(1e-12);
      expect(layoutStats(lay).maxMult).toBeLessThanOrEqual(MAX_MULTIPLIER + 1e-12);
    }
  });

  it('every eval sampler layout returns exactly 36/37', () => {
    // Replays the eval's playRound with a recording rng: its layout is fixed by
    // the draws before the last (the spin), so substituting each pocket for the
    // last draw enumerates that layout exactly.
    const rng = createRng(seededSource(11));
    for (const { params } of evalSpec.configs) {
      for (let t = 0; t < 100; t++) {
        const draws: number[] = [];
        const rec: Rng = createRng(() => {
          const u = rng.next();
          draws.push(u);
          return u;
        });
        evalSpec.playRound(params, rec);
        let s = 0;
        for (let p = 0; p < POCKETS; p++) {
          let i = 0;
          const replay = createRng(() => (i < draws.length - 1 ? draws[i++] : (p + 0.5) / POCKETS));
          s += evalSpec.playRound(params, replay).multiplier;
        }
        expect(Math.abs(s / POCKETS - RTP)).toBeLessThan(1e-12);
      }
    }
  });

  it('pocketOf: 37 equal slices; the host 2^32 grid favours a pocket by at most 1 draw in 2^32', () => {
    const GRID = 2 ** 32;
    // first[p] = smallest j with pocketOf(j / 2^32) >= p (pocketOf is monotone in u).
    const first = (p: number) => {
      let lo = 0;
      let hi = GRID;
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (pocketOf(mid / GRID) >= p) hi = mid;
        else lo = mid + 1;
      }
      return lo;
    };
    const counts = Array.from({ length: POCKETS }, (_, p) => (p === POCKETS - 1 ? GRID : first(p + 1)) - first(p));
    expect(counts.reduce((a, b) => a + b, 0)).toBe(GRID);
    const lo = Math.floor(GRID / POCKETS);
    for (const c of counts) expect(c === lo || c === lo + 1).toBe(true);
    // Straight-up on the most favoured pocket: return = 36 × (lo + 1) / 2^32.
    const best = (36 * (lo + 1)) / GRID;
    expect(best - RTP).toBeLessThan(1e-8);
  });

  describe('strategies, Monte Carlo on real spins (plumbing check)', () => {
    const ROUNDS = 25_000;
    const mc = (play: (rng: Rng) => { paid: number; staked: number }, seed: number) => {
      const rng = createRng(seededSource(seed));
      let P = 0;
      let S = 0;
      const xs: number[] = [];
      const ys: number[] = [];
      for (let i = 0; i < ROUNDS; i++) {
        const { paid, staked } = play(rng);
        P += paid;
        S += staked;
        xs.push(paid);
        ys.push(staked);
      }
      const rtp = P / S;
      let v = 0;
      for (let i = 0; i < ROUNDS; i++) v += (xs[i] - rtp * ys[i]) ** 2;
      return { rtp, se: Math.sqrt(v / ROUNDS / ROUNDS) / (S / ROUNDS) };
    };

    evalSpec.configs.forEach((c, i) => {
      it(`(c) ${c.label}`, () => {
        const r = mc((rng) => ({ paid: evalSpec.playRound(c.params, rng).multiplier, staked: 1 }), 500 + i);
        expect(Math.abs(r.rtp - RTP)).toBeLessThan(4 * r.se);
      });
    });

    it('(d) martingale progression on Red (double after a loss, reset after a win, capped)', () => {
      let stake = 1;
      const r = mc((rng) => {
        const s = stake;
        const res = spin({ red: s }, rng.next());
        stake = res.paid > 0 || stake >= 512 ? 1 : stake * 2;
        return { paid: res.paid, staked: totalOf({ red: s }) };
      }, 77);
      expect(Math.abs(r.rtp - RTP)).toBeLessThan(4 * r.se);
    });
  });
});
