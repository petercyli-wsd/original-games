// Fairness audit: can any way of playing Wild Double beat the RTP?
//
// A round is a paid spin (or a bought feature) plus every free spin it leads
// to. Everything is drawn up front by playRound and the UI only animates it;
// there is no decision after Bet (the line count and the buy are disabled
// while a round runs, and the round keeps the line count it started with), no
// cash-out, and leaving mid-animation settles the drawn total (the ticket
// reads `resolved`, set right after place()). So the tester's rules "act only
// when the next step is >= 80% safe", "take any profit" and "play to the end"
// collapse to "play the round"; Space / Stop only shortens the animation. What
// a player *can* choose, before the spin, is the line count (1-20), spin vs
// feature buy, auto-bet's stop-on-feature, and the stake sequence and when to
// stop playing.
//
// So the strongest play is "pick the choice with the highest exact RTP", and
// the hostile strategies are about *when to stop betting*. Checks, on the
// game's real functions:
//   1. Every choice's exact RTP is at most the headline (manifest) RTP, and
//      the buy never beats the spin.
//   2. The line count cannot move the RTP: every row of every reel has the
//      strip frequency (so all 20 lines share one law) and a spin pays
//      (Σ line pays) / lines, so E = L + S for every n.
//   3. The free-spin expectation used in the price is recomputed by an
//      independent forward DP over (awarded, left) with playRound's own cap
//      rule, and a direct count from playRound agrees.
//   4. Strip stops use floor(u · len) from the host rng: on the 2^32 grid each
//      stop gets floor or ceil of 2^32 / len draws (bias < 1e-8).
//   5. Hostile sessions, each a stopping rule on a stream of independent
//      rounds, so by optional stopping E[Σ wins − RTP · Σ stakes] = 0: lines 1
//      vs lines 20, buy only, spin only, stop at the first profit, quit when
//      ahead, quit after a losing streak, switch to the buy after a win. Each
//      session's mean of (return − RTP · rounds) is within 4 SE of 0.
//   6. Monte Carlo of every eval config is within 4 SE of its exact RTP.

import { createRng, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import { BUY_PRICE, FS_AWARD, FS_CAP, LINES, MAX_MULTIPLIER, NSYM, PAYLINES, REELS, ROWS, SCATTER, awardFor, playRound, reelSet, reelWindows } from './math';

const set = reelSet();

describe('wild-double fairness', () => {
  it('(d) the best choice: no line count or buy beats the headline RTP', () => {
    expect(set.rtp).toBeLessThanOrEqual(manifest.rtp + 1e-15);
    expect(set.buyRtp).toBeLessThanOrEqual(set.rtp + 1e-15);
    for (const c of evalSpec.configs) expect(c.rtp!).toBeLessThanOrEqual(manifest.rtp + 1e-15);
  });

  it('the line count cannot move the RTP: every row of every reel has the strip frequency', () => {
    set.strips.forEach((strip, r) => {
      const len = strip.length;
      for (let row = 0; row < ROWS; row++) {
        const freq = new Array(NSYM).fill(0);
        for (let stop = 0; stop < len; stop++) freq[strip[(stop + row) % len]]++;
        expect(freq).toEqual(set.counts[r]);
      }
    });
    // Every payline reads one row per reel, so every line has the same law
    // and E[(Σ_l pay_l) / n] = lineEv for every n.
    for (const path of PAYLINES) expect(path.length).toBe(REELS);
    expect(PAYLINES.length).toBe(LINES);
  });

  it('scatters: at most one per window, and P(window shows one) = 3 c / len exactly', () => {
    reelWindows(set).forEach((ws, r) => {
      let q = 0;
      for (const w of ws) {
        expect(w.win.filter((x) => x === SCATTER).length).toBeLessThanOrEqual(1);
        if (w.scatter) q += w.p;
      }
      expect(Math.abs(q - (ROWS * set.counts[r][SCATTER]) / set.strips[r].length)).toBeLessThan(1e-12);
    });
  });

  it('expected free spins: an independent forward DP with playRound’s cap rule matches the price', () => {
    // dist over (awarded, played); a spin is played while played < awarded.
    let dist = new Map<number, number>([[FS_AWARD * 1000 + 0, 1]]);
    let expSpins = 0;
    for (let t = 0; t < FS_CAP + 1 && dist.size; t++) {
      const next = new Map<number, number>();
      for (const [key, p] of dist) {
        const awarded = Math.floor(key / 1000);
        const played = key % 1000;
        if (played >= awarded) continue;
        expSpins += p;
        for (let k = 0; k <= REELS; k++) {
          if (!set.scatterP[k]) continue;
          const add = Math.min(FS_CAP - awarded, awardFor(k));
          const k2 = (awarded + add) * 1000 + played + 1;
          next.set(k2, (next.get(k2) ?? 0) + p * set.scatterP[k]);
        }
      }
      dist = next;
    }
    expect(Math.abs(expSpins - set.expSpins)).toBeLessThan(1e-9);
    // RTP recomposed from the independent pieces (Wald: E[Σ wins] = 3B · E[spins]).
    const rtp = set.baseEv * (1 + set.trigger * 3 * expSpins);
    expect(Math.abs(rtp - set.rtp)).toBeLessThan(1e-12);
    expect(Math.abs((3 * set.baseEv * expSpins) / BUY_PRICE - set.buyRtp)).toBeLessThan(1e-12);
  });

  it('strip stops on the host 2^32 grid: every stop gets floor or ceil of 2^32 / len draws', () => {
    const GRID = 2 ** 32;
    for (const strip of set.strips) {
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
  });

  describe('Monte Carlo on real rounds', () => {
    const ROUNDS = 40_000;
    const mc = (lines: () => number, buy: boolean, seed: number) => {
      const rng = createRng(seededSource(seed));
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
        const r = mc(() => c.params.lines[rng.int(c.params.lines.length)], !!c.params.buy, 60 + i);
        expect(Math.abs(r.mean - c.rtp!)).toBeLessThan(4 * r.se);
        expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
      });
    });

    it('every fixed line count, spin and buy, is within 4 SE of its exact RTP', () => {
      for (const n of [1, 2, 3, 5, 10, 15, 20]) {
        const r = mc(() => n, false, 100 + n);
        expect(Math.abs(r.mean - set.rtp)).toBeLessThan(4 * r.se);
      }
      for (const n of [1, 20]) {
        const r = mc(() => n, true, 200 + n);
        expect(Math.abs(r.mean - set.buyRtp)).toBeLessThan(4 * r.se);
      }
    });

    it('free spins played per award match the price table (direct count from playRound)', () => {
      const rng = createRng(seededSource(5));
      let n = 0;
      let sum = 0;
      let sq = 0;
      for (let i = 0; i < 20_000; i++) {
        const r = playRound(set, 20, () => rng.next(), true); // a buy starts at 15
        n++;
        sum += r.freeSpins;
        sq += r.freeSpins ** 2;
      }
      const mean = sum / n;
      const se = Math.sqrt((sq / n - mean * mean) / n);
      expect(Math.abs(mean - set.expSpins)).toBeLessThan(4 * se);
    });
  });

  describe('hostile betting strategies (optional stopping)', () => {
    // A session plays rounds until `stop` says so (at most `max` rounds). Each
    // round costs its price (1 or the buy price) and returns its payout. The
    // session's D = Σ payout − RTP_round · Σ price has mean 0 for any
    // stopping rule, because every round is a fair-value bet at its own RTP.
    const SESSIONS = 6000;
    type Round = { price: number; ret: number; won: boolean };
    const session = (seed: number, play: (rng: ReturnType<typeof createRng>, history: Round[]) => { lines: number; buy: boolean } | null) => {
      const rng = createRng(seededSource(seed));
      let s = 0;
      let s2 = 0;
      for (let k = 0; k < SESSIONS; k++) {
        const history: Round[] = [];
        let d = 0;
        for (;;) {
          const choice = play(rng, history);
          if (!choice) break;
          const r = playRound(set, choice.lines, () => rng.next(), choice.buy);
          const price = choice.buy ? BUY_PRICE : 1;
          const ret = r.total;
          history.push({ price, ret, won: ret > price });
          d += ret - (choice.buy ? set.buyRtp : set.rtp) * price;
        }
        s += d;
        s2 += d * d;
      }
      const mean = s / SESSIONS;
      return { mean, se: Math.sqrt(Math.max(0, s2 / SESSIONS - mean * mean) / SESSIONS) };
    };
    const within = (r: { mean: number; se: number }) => expect(Math.abs(r.mean)).toBeLessThan(4 * r.se);

    it('one line only, until the first profit (max 30 rounds)', () => {
      within(session(301, (_, h) => (h.length >= 30 || h.some((x) => x.won) ? null : { lines: 1, buy: false })));
    });
    it('20 lines only, until the first profit (max 30 rounds)', () => {
      within(session(302, (_, h) => (h.length >= 30 || h.some((x) => x.won) ? null : { lines: 20, buy: false })));
    });
    it('quit when ahead of the stake, else play up to 40 rounds (random line count)', () => {
      within(
        session(303, (rng, h) => {
          const net = h.reduce((a, x) => a + x.ret - x.price, 0);
          return h.length >= 40 || (h.length > 0 && net > 0) ? null : { lines: 1 + rng.int(LINES), buy: false };
        }),
      );
    });
    it('quit after 5 losses in a row, else up to 40 rounds', () => {
      within(
        session(304, (rng, h) => {
          const lastFive = h.slice(-5);
          return h.length >= 40 || (lastFive.length === 5 && lastFive.every((x) => !x.won)) ? null : { lines: 1 + rng.int(LINES), buy: false };
        }),
      );
    });
    it('buy only, until a buy returns more than it cost (max 10)', () => {
      within(session(305, (_, h) => (h.length >= 10 || h.some((x) => x.won) ? null : { lines: 20, buy: true })));
    });
    it('switch to the buy right after a spin that wins, else spin on 3 lines (max 30)', () => {
      within(session(306, (_, h) => (h.length >= 30 ? null : { lines: 3, buy: h.length > 0 && h[h.length - 1].won })));
    });
    it('play on 1 line until three scatters land a feature, then stop (max 200)', () => {
      within(
        session(307, (_, h) => {
          const last = h[h.length - 1];
          // a round that paid more than 3 stakes is almost surely a feature
          return h.length >= 200 || (last && last.ret > 3) ? null : { lines: 1, buy: false };
        }),
      );
    });
  });

  it('the round pays at most the max win', () => {
    const rng = createRng(seededSource(12));
    for (let i = 0; i < 3000; i++) expect(playRound(set, 1 + rng.int(LINES), () => rng.next(), i % 5 === 0).multiplier).toBeLessThanOrEqual(MAX_MULTIPLIER);
  });
});
