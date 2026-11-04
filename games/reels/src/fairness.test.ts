// Fairness audit: can any way of playing Reels beat the RTP?
//
// A round is a paid spin (or a bought feature) plus every free spin it leads
// to. Everything is drawn up front by playRound and the UI only animates it;
// there is no decision after Bet (reel set, lines and buy are disabled while a
// round runs, and the round keeps the set and line count it started with), no
// cash-out, and leaving mid-animation settles the drawn total (the ticket
// reads `resolved`, set right after place()). So the tester's rule (a) and
// "take any profit" (b) collapse to (c) "play the round"; Space / Stop only
// shortens the animation. What a player *can* choose, before the spin, is the
// reel set (low / medium / high), the line count (1-20), spin vs feature buy,
// auto-bet's stop-on-feature, and the stake sequence.
//
// (d), the strongest play, is therefore "pick the choice with the highest
// exact RTP". Checks, on the game's real functions:
//   1. Every choice's exact RTP is at most the headline (manifest) RTP, and
//      the buy never beats the spin of the same set.
//   2. The line count cannot move the RTP: every row of every reel has the
//      strip frequency (so all 20 lines share one law) and a spin pays
//      (Σ line pays) / lines, checked exactly over every stop of every reel.
//   3. The free-spin expectation used in the price is recomputed by an
//      independent forward DP over (awarded, left) with playRound's own cap
//      rule, and a direct count from playRound agrees (MC).
//   4. Strip stops use floor(u · len) from the host rng: on the 2^32 grid each
//      stop gets floor or ceil of 2^32 / len draws (bias < 1e-8).
//   5. Monte Carlo of every eval config, and of every (set, lines, buy) a
//      player might pick, is within 4 SE of its exact RTP (plumbing check: the
//      top config pays up to ~2000 line bets on one line, so the binding
//      checks are the exact ones).

import { createRng, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import { BUY_SPINS, FS_CAP, LINES, PAYLINES, REELS, ROWS, SCATTER, VOLS, awardFor, playRound, reelSet, reelWindows, type Vol } from './math';

describe('reels fairness', () => {
  it('(d) the best choice: no reel set, line count or buy beats the headline RTP', () => {
    for (const v of VOLS) {
      const s = reelSet(v);
      expect(s.rtp).toBeLessThanOrEqual(manifest.rtp + 1e-15);
      expect(s.buyRtp).toBeLessThanOrEqual(s.rtp + 1e-15);
    }
    expect(Math.max(...VOLS.map((v) => reelSet(v).rtp))).toBe(manifest.rtp);
  });

  it('the line count cannot move the RTP: every row of every reel has the strip frequency', () => {
    for (const v of VOLS) {
      const s = reelSet(v);
      s.strips.forEach((strip, r) => {
        const len = strip.length;
        for (let row = 0; row < ROWS; row++) {
          const freq = new Array(9).fill(0);
          for (let stop = 0; stop < len; stop++) freq[strip[(stop + row) % len]]++;
          expect(freq).toEqual(s.counts[r]);
        }
      });
      // Every payline reads one row per reel, so every line has the same law
      // and E[(Σ_l pay_l) / n] = lineEv for every n.
      for (const path of PAYLINES) expect(path.length).toBe(REELS);
      expect(PAYLINES.length).toBe(LINES);
    }
  });

  it('scatters: at most one per window, and P(window shows one) = 3 c / len exactly', () => {
    for (const v of VOLS) {
      const s = reelSet(v);
      reelWindows(s).forEach((ws, r) => {
        let q = 0;
        for (const w of ws) {
          expect(w.win.filter((x) => x === SCATTER).length).toBeLessThanOrEqual(1);
          if (w.scatter) q += w.p;
        }
        const len = s.strips[r].length;
        expect(Math.abs(q - (ROWS * s.counts[r][SCATTER]) / len)).toBeLessThan(1e-12);
      });
    }
  });

  it('expected free spins: an independent forward DP with playRound’s cap rule matches the price table', () => {
    for (const v of VOLS) {
      const s = reelSet(v);
      for (const m of [10, 15, 20]) {
        // dist over (awarded, played); a spin is played while played < awarded.
        let dist = new Map<number, number>([[m * 1000 + 0, 1]]);
        let expSpins = 0;
        for (let t = 0; t < FS_CAP + 1 && dist.size; t++) {
          const next = new Map<number, number>();
          for (const [key, p] of dist) {
            const awarded = Math.floor(key / 1000);
            const played = key % 1000;
            if (played >= awarded) continue;
            expSpins += p;
            for (let k = 0; k <= REELS; k++) {
              if (!s.scatterP[k]) continue;
              const add = Math.min(FS_CAP - awarded, awardFor(k));
              const k2 = (awarded + add) * 1000 + played + 1;
              next.set(k2, (next.get(k2) ?? 0) + p * s.scatterP[k]);
            }
          }
          dist = next;
        }
        expect(Math.abs(expSpins - s.expSpins[m])).toBeLessThan(1e-9);
      }
      // RTP recomposed from the independent pieces (Wald: E[Σ wins] = 2L · E[spins]).
      const rtp = s.lineEv + [3, 4, 5].reduce((a, k) => a + s.scatterP[k] * 2 * s.lineEv * s.expSpins[awardFor(k)], 0);
      expect(Math.abs(rtp - s.rtp)).toBeLessThan(1e-12);
    }
  });

  it('strip stops on the host 2^32 grid: every stop gets floor or ceil of 2^32 / len draws', () => {
    const GRID = 2 ** 32;
    for (const v of VOLS) {
      for (const strip of reelSet(v).strips) {
        const len = strip.length;
        const first = (i: number) => {
          let lo = 0;
          let hi = GRID;
          while (lo < hi) {
            const mid = Math.floor((lo + hi) / 2);
            if (Math.floor((mid / GRID) * len) >= i) hi = mid;
            else lo = mid + 1;
          }
          return lo;
        };
        const base = Math.floor(GRID / len);
        for (let i = 0; i < len; i++) {
          const c = (i === len - 1 ? GRID : first(i + 1)) - first(i);
          expect(c === base || c === base + 1).toBe(true);
        }
      }
    }
  });

  describe('Monte Carlo on real rounds (plumbing check)', () => {
    const ROUNDS = 20_000;
    const mc = (vol: Vol, lines: () => number, buy: boolean, seed: number) => {
      const rng = createRng(seededSource(seed));
      const set = reelSet(vol);
      let s = 0;
      let s2 = 0;
      let max = 0;
      for (let i = 0; i < ROUNDS; i++) {
        const m = playRound(set, lines(), () => rng.next(), buy).multiplier;
        s += m;
        s2 += m * m;
        if (m > max) max = m;
      }
      const mean = s / ROUNDS;
      return { mean, se: Math.sqrt(Math.max(0, s2 / ROUNDS - mean * mean) / ROUNDS), max };
    };

    evalSpec.configs.forEach((c, i) => {
      it(`(c) ${c.label}`, () => {
        const rng = createRng(seededSource(40 + i));
        const r = mc(c.params.vol, () => c.params.lines[rng.int(c.params.lines.length)], !!c.params.buy, 60 + i);
        expect(Math.abs(r.mean - c.rtp!)).toBeLessThan(4 * r.se);
        expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
      });
    });

    it('free spins played per award match the price table (direct count from playRound)', () => {
      const rng = createRng(seededSource(5));
      const set = reelSet('low');
      let n = 0;
      let sum = 0;
      let sq = 0;
      for (let i = 0; i < 20_000; i++) {
        const r = playRound(set, 20, () => rng.next(), true); // a buy starts at BUY_SPINS
        n++;
        sum += r.freeSpins;
        sq += r.freeSpins ** 2;
      }
      const mean = sum / n;
      const se = Math.sqrt((sq / n - mean * mean) / n);
      expect(Math.abs(mean - set.expSpins[BUY_SPINS])).toBeLessThan(4 * se);
    });
  });
});
