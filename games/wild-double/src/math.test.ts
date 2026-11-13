import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  BUY_PRICE,
  BUY_SPINS,
  COUNTS,
  FS_AWARD,
  FS_CAP,
  FS_MULT,
  LINES,
  MAX_MULTIPLIER,
  NSYM,
  PAYING,
  PAYLINES,
  PAYS,
  REELS,
  ROWS,
  RTP,
  SCATTER,
  SCATTER_PAY,
  WILD,
  WILD_PAY,
  awardFor,
  evaluate,
  linePay,
  lineStats,
  maxSpinWin,
  playRound,
  reelSet,
  reelWindows,
  spinOdds,
  windowAt,
  winTier,
  type ReelSet,
  type SpinOdds,
} from './math';

const set = reelSet();

/** The outcome class of one finished spin, straight from evaluate(): the odds bar's 0/1 end state. */
function classify(_s: ReelSet, grid: number[][], lines: number): SpinOdds {
  const { wins, scatterCells } = evaluate(grid, lines);
  return { pays: wins.length > 0 || scatterCells.length >= 2 ? 1 : 0, free: scatterCells.length >= 3 ? 1 : 0 };
}

const freqs = (strips: number[][]) =>
  strips.map((s) => {
    const f = new Array(NSYM).fill(0);
    for (const x of s) f[x]++;
    return f.map((c) => c / s.length);
  });

describe('Wild Double maths', () => {
  it('the paytable is the published one, value for value (published × 20 = line bets)', () => {
    // Published multiples of the spin value at 20 lines, 2 / 3 / 4 / 5 of a kind (0 = no pay).
    const published: number[][] = [
      [0.1, 1.25, 5, 37.5], // two highs
      [0.1, 1.25, 5, 37.5],
      [0, 0.75, 5, 20], // blue pendant
      [0, 0.5, 3.75, 12.5], // eye pendant
      [0, 0.5, 3.75, 12.5], // hand
      [0, 0.5, 2.5, 12.5], // purple rune
      [0, 0.25, 2.5, 5], // blue rune, as published
      [0, 0.25, 1.25, 5], // four plain low runes
      [0, 0.25, 1.25, 5],
      [0, 0.25, 1.25, 5],
      [0, 0.25, 1.25, 5],
    ];
    expect(PAYS.length).toBe(PAYING);
    PAYS.forEach((row, s) => row.forEach((v, k) => expect(v).toBeCloseTo(published[s][k] * 20, 9)));
    expect(WILD_PAY.map((v) => v / 20)).toEqual([0, 0, 0.5, 10, 100, 500]);
    expect(SCATTER_PAY).toEqual([0, 0, 2, 6, 50, 500]);
    expect(FS_AWARD).toBe(15);
    expect(FS_MULT).toBe(3);
    expect(FS_CAP).toBe(180);
    expect(BUY_PRICE).toBe(37);
    expect(MAX_MULTIPLIER).toBe(10_000);
    expect(FS_MULT * 2).toBe(6);
  });

  it('strips carry exactly their counts; reel lengths 30/30/30/30/41; at most one wild and one scatter per window', () => {
    expect(set.strips.map((s) => s.length)).toEqual([30, 30, 30, 30, 41]);
    set.strips.forEach((strip, r) => {
      expect(strip).not.toContain(-1);
      for (let s = 0; s < NSYM; s++) expect(strip.filter((x) => x === s).length).toBe(COUNTS[r][s]);
      expect(COUNTS[r][WILD]).toBeGreaterThan(0); // the wild lands on every reel
      let seen = 0;
      for (let stop = 0; stop < strip.length; stop++) {
        const w = [0, 1, 2].map((k) => strip[(stop + k) % strip.length]);
        expect(w.filter((x) => x === SCATTER).length).toBeLessThanOrEqual(1);
        expect(w.filter((x) => x === WILD).length).toBeLessThanOrEqual(1);
        seen += w.filter((x) => x === SCATTER).length;
      }
      expect(seen).toBe(ROWS * COUNTS[r][SCATTER]); // q = 3c / len
    });
  });

  it('every row of every reel has the strip frequency, so all 20 lines share one distribution', () => {
    set.strips.forEach((strip, r) => {
      for (let row = 0; row < ROWS; row++) {
        const f = new Array(NSYM).fill(0);
        for (let stop = 0; stop < strip.length; stop++) f[windowAt(set, set.strips.map((_, i) => (i === r ? stop : 0)))[r][row]]++;
        expect(f).toEqual(COUNTS[r]);
      }
    });
    expect(new Set(PAYLINES.map((l) => l.join(''))).size).toBe(LINES);
  });

  it('line rule: first non-wild symbol, doubled when a wild completes the run, wild pays by itself, max not sum', () => {
    const [BO, HE, CR, , , , , CI] = [0, 1, 2, 3, 4, 5, 6, 7];
    expect(linePay([CI, CI, CI, 8, 8])).toEqual({ sym: CI, count: 3, pay: 5, doubled: false });
    expect(linePay([CI, WILD, CI, 8, 8])).toEqual({ sym: CI, count: 3, pay: 10, doubled: true });
    expect(linePay([WILD, WILD, CI, CI, 8])).toEqual({ sym: CI, count: 4, pay: 50, doubled: true }); // 25 × 2 beats the wilds' 10
    expect(linePay([WILD, WILD, WILD, WILD, WILD])).toEqual({ sym: WILD, count: 5, pay: 10_000, doubled: false });
    expect(linePay([WILD, WILD, WILD, WILD, BO])).toEqual({ sym: WILD, count: 4, pay: 2000, doubled: false }); // 2000 beats the bolt's 100 × 2
    expect(linePay([WILD, WILD, WILD, CI, SCATTER])).toEqual({ sym: WILD, count: 3, pay: 200, doubled: false });
    expect(linePay([WILD, WILD, WILD, BO, BO])).toEqual({ sym: BO, count: 5, pay: 1500, doubled: true }); // 750 × 2 beats the wilds' 200
    expect(linePay([WILD, WILD, SCATTER, 1, 1])).toEqual({ sym: WILD, count: 2, pay: 10, doubled: false });
    expect(linePay([WILD, SCATTER, CI, CI, CI]).pay).toBe(0); // a scatter is not substituted for
    expect(linePay([SCATTER, WILD, WILD, WILD, WILD]).pay).toBe(0);
    expect(linePay([BO, BO, 5, 5, 5])).toEqual({ sym: BO, count: 2, pay: 2, doubled: false }); // highs pay on 2
    expect(linePay([BO, WILD, 5, 5, 5])).toEqual({ sym: BO, count: 2, pay: 4, doubled: true });
    expect(linePay([HE, WILD, WILD, HE, HE])).toEqual({ sym: HE, count: 5, pay: 1500, doubled: true });
    expect(linePay([WILD, CR, CR, CR, CI])).toEqual({ sym: CR, count: 4, pay: 200, doubled: true });
    expect(linePay([CI, CI, 8, CI, CI]).pay).toBe(0); // 2 of a kind pays only on the highs
    expect(linePay([CI, SCATTER, CI, CI, CI]).pay).toBe(0);
  });

  it('closed-form line law equals brute-force enumeration of all 13^5 symbol tuples', () => {
    const p = freqs(set.strips);
    let ev = 0;
    let ev2 = 0;
    let hit = 0;
    const syms = [0, 0, 0, 0, 0];
    const rec = (i: number, prob: number) => {
      if (prob === 0) return;
      if (i === REELS) {
        const pay = linePay(syms).pay;
        ev += prob * pay;
        ev2 += prob * pay * pay;
        if (pay > 0) hit += prob;
        return;
      }
      for (let s = 0; s < NSYM; s++) {
        syms[i] = s;
        rec(i + 1, prob * p[i][s]);
      }
    };
    rec(0, 1);
    const st = lineStats(p);
    expect(st.ev).toBeCloseTo(ev, 12);
    expect(st.hit).toBeCloseTo(hit, 12);
    expect(st.ev2).toBeCloseTo(ev2, 9);
    expect(set.lineEv).toBeCloseTo(ev, 12);
    expect(set.lineHit).toBeCloseTo(hit, 12);
  });

  it('scatter count distribution equals the convolution of per-reel window counts', () => {
    let dist = [1];
    for (const strip of set.strips) {
      const q = strip.filter((_, stop) => [0, 1, 2].some((k) => strip[(stop + k) % strip.length] === SCATTER)).length / strip.length;
      const next = new Array(dist.length + 1).fill(0);
      dist.forEach((v, k) => {
        next[k] += v * (1 - q);
        next[k + 1] += v * q;
      });
      dist = next;
    }
    dist.forEach((v, k) => expect(set.scatterP[k]).toBeCloseTo(v, 14));
    expect(set.trigger).toBeCloseTo(dist[3] + dist[4] + dist[5], 14);
    expect(set.scatterEv).toBeCloseTo(dist.reduce((s, v, k) => s + v * SCATTER_PAY[k], 0), 14);
  });

  it('expected free spins: the capped DP matches the geometric series 15/(1−μ) and a simulation', () => {
    const series = FS_AWARD / (1 - set.mu);
    expect(set.expSpins).toBeLessThanOrEqual(series + 1e-12);
    expect(series - set.expSpins).toBeLessThan(1e-6 * series);
    const rng = createRng(seededSource(21));
    const n = 200_000;
    let sum = 0;
    let sq = 0;
    for (let i = 0; i < n; i++) {
      let awarded = FS_AWARD;
      let played = 0;
      while (played < awarded) {
        played++;
        let k = 0;
        for (const strip of set.strips) {
          const stop = rng.int(strip.length);
          if ([0, 1, 2].some((d) => strip[(stop + d) % strip.length] === SCATTER)) k++;
        }
        awarded += Math.min(FS_CAP - awarded, awardFor(k));
      }
      sum += played;
      sq += played * played;
    }
    const mean = sum / n;
    const se = Math.sqrt((sq / n - mean * mean) / n);
    expect(Math.abs(mean - set.expSpins)).toBeLessThan(4 * se);
  });

  it('exact RTPs: closed form, 0.9784 to 4 dp (rounded the house’s way), buy priced from the same feature value', () => {
    const feature = FS_MULT * set.baseEv * set.expSpins;
    expect(set.featureEv).toBeCloseTo(feature, 12);
    expect(set.rtp).toBeCloseTo(set.lineEv + set.scatterEv + set.trigger * feature, 14);
    // Uncapped geometric series: RTP = B (1 + 3 · 15 P(trigger) / (1 − μ)).
    expect(Math.abs(set.rtp - set.baseEv * (1 + (FS_MULT * FS_AWARD * set.trigger) / (1 - set.mu)))).toBeLessThan(1e-6);
    expect(set.rtp).toBeLessThanOrEqual(0.9784);
    expect(set.rtp).toBeGreaterThan(0.9783);
    expect(set.buyRtp).toBeCloseTo(feature / BUY_PRICE, 14);
    expect(set.buyRtp).toBeLessThanOrEqual(set.rtp);
    expect(set.rtp - set.buyRtp).toBeLessThan(0.002);
    console.log(
      `RTP ${(set.rtp * 100).toFixed(4)}%  line EV ${set.lineEv.toFixed(5)}  scatter EV ${set.scatterEv.toFixed(5)}  free spins 1 in ${(1 / set.trigger).toFixed(1)}  E15 ${set.expSpins.toFixed(4)}  buy ${BUY_PRICE}× → ${(set.buyRtp * 100).toFixed(4)}%  line hit ${(set.lineHit * 100).toFixed(2)}%  spin pays (20 lines) ${(spinOdds(set, 20).pays * 100).toFixed(2)}%`,
    );
    expect(RTP).toBe(set.rtp);
    expect(manifest.rtp).toBe(RTP);
  });

  it('a spin returns the same EV on any number of lines (simulated)', () => {
    for (const lines of [1, 7, 20]) {
      const rng = createRng(seededSource(30 + lines));
      const n = 200_000;
      let sum = 0;
      let sq = 0;
      for (let i = 0; i < n; i++) {
        const grid = windowAt(set, set.strips.map((s) => rng.int(s.length)));
        const { linePays, scatterCells } = evaluate(grid, lines);
        const w = linePays / lines + SCATTER_PAY[scatterCells.length];
        sum += w;
        sq += w * w;
      }
      const mean = sum / n;
      const se = Math.sqrt((sq / n - mean * mean) / n);
      expect(Math.abs(mean - set.baseEv)).toBeLessThan(4 * se);
    }
  });

  it('the max win: one spin is bounded, a round never exceeds 10,000× and ends when it gets there', () => {
    // A rigged source that stops every reel with a wild on the middle row: five wilds on line 1.
    const wildStops = set.strips.map((s) => s.indexOf(WILD) - 1 + (s.indexOf(WILD) === 0 ? s.length : 0));
    let call = 0;
    const rigged = () => {
      const r = call++ % REELS;
      return (wildStops[r] + 0.5) / set.strips[r].length;
    };
    const one = playRound(set, 1, rigged);
    expect(one.spins[0].wins[0]).toMatchObject({ line: 0, sym: WILD, count: 5, pay: 10_000 });
    expect(one.multiplier).toBeGreaterThanOrEqual(MAX_MULTIPLIER);
    expect(one.multiplier).toBe(MAX_MULTIPLIER);
    expect(one.capped).toBe(true);
    // In a bought feature the same wild line pays ×3 on a spin; the cap is 37 × 10,000 stakes there.
    const buy = playRound(set, 1, rigged, true);
    expect(buy.spins[0].win).toBeGreaterThan(0);
    expect(buy.multiplier).toBeLessThanOrEqual(MAX_MULTIPLIER);
    // maxSpinWin is an upper bound that the wild line reaches (plus a scatter on another row).
    expect(maxSpinWin(1)).toBe(10_000 + SCATTER_PAY[5]);
    expect(3 * maxSpinWin(LINES)).toBeLessThan(MAX_MULTIPLIER); // on 20 lines a single free spin can never reach the cap
    const rng = createRng(seededSource(8));
    let worst = 0;
    for (let i = 0; i < 20_000; i++) {
      const n = 1 + rng.int(LINES);
      const grid = windowAt(set, set.strips.map((s) => rng.int(s.length)));
      const { linePays, scatterCells } = evaluate(grid, n);
      worst = Math.max(worst, linePays / n + SCATTER_PAY[scatterCells.length]);
      expect(linePays / n + SCATTER_PAY[scatterCells.length]).toBeLessThanOrEqual(maxSpinWin(n));
    }
    expect(worst).toBeGreaterThan(0);
  });

  it('a round resolves once: total = sum of spins, free spins follow the scatters, the cap holds', () => {
    const rng = createRng(seededSource(4));
    let sawFeature = false;
    for (let i = 0; i < 6000; i++) {
      const lines = 1 + rng.int(LINES);
      const r = playRound(set, lines, () => rng.next());
      expect(r.total).toBeCloseTo(r.spins.reduce((s, x) => s + x.win, 0), 9);
      expect(r.multiplier).toBe(r.total);
      expect(r.total).toBeLessThanOrEqual(MAX_MULTIPLIER);
      expect(r.spins[0].free).toBe(false);
      expect(r.freeSpins).toBe(r.spins.length - 1);
      expect(r.spins[0].awarded).toBe(awardFor(r.spins[0].scatterCells.length));
      r.spins.forEach((s, k) => {
        expect(s.mult).toBe(s.free ? FS_MULT : 1);
        if (!r.capped) expect(s.win).toBeCloseTo((s.wins.reduce((a, w) => a + w.pay, 0) / lines + SCATTER_PAY[s.scatterCells.length]) * s.mult, 9);
        if (k > 0) expect(s.n).toBe(k);
      });
      expect(r.spins[r.spins.length - 1].left).toBe(0);
      if (r.freeSpins) sawFeature = true;
    }
    expect(sawFeature).toBe(true);
    // A source that always stops on a scatter retriggers until the cap.
    const scatterStops = set.strips.map((s) => s.indexOf(SCATTER));
    let call = 0;
    const rigged = () => {
      const r = call++ % REELS;
      return (scatterStops[r] + 0.5) / set.strips[r].length;
    };
    const capped = playRound(set, LINES, rigged);
    expect(capped.spins[0].awarded).toBe(FS_AWARD);
    expect(capped.spins[0].scatterWin).toBe(SCATTER_PAY[5]);
    // Five scatters pay 500 × 3 on every free spin, so this round hits the max win within a few spins and stops there.
    expect(capped.capped).toBe(true);
    expect(capped.multiplier).toBe(MAX_MULTIPLIER);
    expect(capped.spins.length).toBeLessThan(12);
    expect(capped.spins[capped.spins.length - 1].left).toBe(0);
    // The buy plays only free spins and pays per amount paid.
    const b = playRound(set, LINES, () => rng.next(), true);
    expect(b.spins[0].free).toBe(true);
    expect(b.freeSpins).toBeGreaterThanOrEqual(BUY_SPINS);
    expect(b.multiplier).toBeCloseTo(b.total / BUY_PRICE, 12);
  });

  it('odds bar, all reels stopped: exactly the spin’s own outcome class from evaluate()', () => {
    const rng = createRng(seededSource(77));
    for (let i = 0; i < 3000; i++) {
      const lines = 1 + rng.int(LINES);
      const grid = windowAt(set, set.strips.map((s) => rng.int(s.length)));
      expect(spinOdds(set, lines, grid)).toEqual(classify(set, grid, lines));
    }
    // A hand-built screen: wilds and a scatter on reels 1–3 start free spins and pay.
    const sc = [[SCATTER, 6, 5], [SCATTER, 5, 6], [SCATTER, 6, 5], [5, 6, 5], [6, 5, 6]];
    expect(spinOdds(set, LINES, sc)).toEqual({ pays: 1, free: 1 });
    // Two scatters pay; a dead screen does not.
    const two = [[SCATTER, 6, 7], [8, 9, 10], [10, 9, 8], [SCATTER, 5, 6], [7, 8, 9]];
    expect(spinOdds(set, 1, two).pays).toBe(1);
    const dead = [[6, 7, 8], [9, 10, 6], [7, 8, 9], [10, 6, 7], [8, 9, 10]];
    expect(classify(set, dead, LINES)).toEqual({ pays: 0, free: 0 });
  });

  it('odds bar is a martingale reel by reel (tower property), so every shown figure is the exact conditional chance', () => {
    const rng = createRng(seededSource(78));
    const W = reelWindows(set);
    W.forEach((ws) => expect(ws.reduce((a, w) => a + w.p, 0)).toBeCloseTo(1, 14));
    for (let trial = 0; trial < 8; trial++) {
      const lines = trial === 0 ? LINES : 1 + rng.int(LINES);
      const grid = windowAt(set, set.strips.map((s) => rng.int(s.length)));
      for (let k = 0; k < REELS; k++) {
        const now = spinOdds(set, lines, grid.slice(0, k));
        const avg = { pays: 0, free: 0 };
        for (const w of W[k]) {
          const after = spinOdds(set, lines, [...grid.slice(0, k), w.win]);
          avg.pays += w.p * after.pays;
          avg.free += w.p * after.free;
        }
        expect(Math.abs(avg.pays - now.pays)).toBeLessThan(1e-12);
        expect(Math.abs(avg.free - now.free)).toBeLessThan(1e-12);
      }
    }
  });

  it('odds bar before a spin matches a direct simulation, and the trigger chance is exact', () => {
    for (const lines of [1, 5, LINES]) {
      const o = spinOdds(set, lines);
      const rng = createRng(seededSource(90 + lines));
      const n = 80_000;
      let pays = 0;
      let free = 0;
      for (let i = 0; i < n; i++) {
        const c = classify(set, windowAt(set, set.strips.map((s) => rng.int(s.length))), lines);
        pays += c.pays;
        free += c.free;
      }
      for (const [hits, p] of [[pays, o.pays], [free, o.free]] as const) {
        const se = Math.sqrt(Math.max(p * (1 - p), 1e-9) / n);
        expect(Math.abs(hits / n - p)).toBeLessThan(4 * se + 1e-12);
      }
      expect(o.free).toBeCloseTo(set.trigger, 14);
    }
  });

  it('odds bar stays fast: a full pre-spin count is well under the frame budget', () => {
    const t = performance.now();
    spinOdds(set, LINES - 1);
    expect(performance.now() - t).toBeLessThan(250);
  });

  it('win banners by size', () => {
    expect(winTier(9.99)).toBeNull();
    expect(winTier(10)).toBe('big');
    expect(winTier(25)).toBe('mega');
    expect(winTier(100)).toBe('epic');
  });

  it('simulated RTP matches each config’s exact RTP and the max is honest', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - (r.targetRtp ?? manifest.rtp))).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
