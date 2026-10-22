import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  BUY_SPINS,
  FS_CAP,
  FS_MULT,
  LINES,
  MAX_MULTIPLIER,
  NSYM,
  PAYING,
  PAYLINES,
  REELS,
  ROWS,
  RTP,
  SCATTER,
  VOLS,
  WILD,
  awardFor,
  evaluate,
  linePay,
  playRound,
  reelSet,
  windowAt,
  winTier,
} from './math';

const sets = VOLS.map(reelSet);

/** Per-reel symbol frequencies, read off the strips themselves. */
const freqs = (strips: number[][]) =>
  strips.map((s) => {
    const f = new Array(NSYM).fill(0);
    for (const x of s) f[x]++;
    return f.map((c) => c / s.length);
  });

describe('Reels maths', () => {
  it('strips carry exactly their counts; wilds only on reels 2–4; at most one scatter per window', () => {
    for (const set of sets) {
      set.strips.forEach((strip, r) => {
        expect(strip).not.toContain(-1);
        for (let s = 0; s < NSYM; s++) expect(strip.filter((x) => x === s).length).toBe(set.counts[r][s]);
        if (r === 0 || r === REELS - 1) expect(set.counts[r][WILD]).toBe(0);
        let seen = 0;
        for (let stop = 0; stop < strip.length; stop++) {
          const w = [0, 1, 2].map((k) => strip[(stop + k) % strip.length]);
          const n = w.filter((x) => x === SCATTER).length;
          expect(n).toBeLessThanOrEqual(1);
          seen += n;
        }
        // A scatter is visible in exactly 3·c of the len stops: q = 3c / len.
        expect(seen).toBe(ROWS * set.counts[r][SCATTER]);
      });
    }
  });

  it('every row of every reel has the strip frequency, so all 20 lines share one distribution', () => {
    for (const set of sets) {
      set.strips.forEach((strip, r) => {
        for (let row = 0; row < ROWS; row++) {
          const f = new Array(NSYM).fill(0);
          for (let stop = 0; stop < strip.length; stop++) f[windowAt(set, set.strips.map((_, i) => (i === r ? stop : 0)))[r][row]]++;
          expect(f).toEqual(set.counts[r]);
        }
      });
    }
    expect(new Set(PAYLINES.map((l) => l.join(''))).size).toBe(LINES);
  });

  it('closed-form line EV equals brute-force enumeration of all 9^5 symbol lines', () => {
    for (const set of sets) {
      const p = freqs(set.strips);
      let ev = 0;
      let hit = 0;
      const syms = [0, 0, 0, 0, 0];
      const rec = (i: number, prob: number) => {
        if (prob === 0) return;
        if (i === REELS) {
          const pay = linePay(syms, set.pays).pay;
          ev += prob * pay;
          if (pay > 0) hit += prob;
          return;
        }
        for (let s = 0; s < NSYM; s++) {
          syms[i] = s;
          rec(i + 1, prob * p[i][s]);
        }
      };
      rec(0, 1);
      expect(set.lineEv).toBeCloseTo(ev, 12);
      expect(set.lineHit).toBeCloseTo(hit, 12);
    }
  });

  it('scatter count distribution equals the convolution of per-reel window counts', () => {
    for (const set of sets) {
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
    }
  });

  it('expected free spins: the capped DP matches the geometric series m/(1−μ) and a simulation', () => {
    for (const set of sets) {
      for (const m of [10, 15, 20]) {
        const series = m / (1 - set.mu);
        expect(set.expSpins[m]).toBeLessThanOrEqual(series + 1e-12);
        // The cap at FS_CAP spins trims under 0.01% of the expected length.
        expect(series - set.expSpins[m]).toBeLessThan(1e-4 * series);
      }
    }
    // Simulate feature lengths straight from the strips.
    const set = reelSet('medium');
    const rng = createRng(seededSource(21));
    const n = 200_000;
    let sum = 0;
    let sq = 0;
    for (let i = 0; i < n; i++) {
      let awarded = 10;
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
    expect(Math.abs(mean - set.expSpins[10])).toBeLessThan(4 * se);
  });

  it('exact RTPs: the closed form, ≈97% per set, the buy priced at or just under the spin', () => {
    for (const set of sets) {
      const feature = [3, 4, 5].reduce((s, k) => s + set.scatterP[k] * FS_MULT * set.lineEv * set.expSpins[awardFor(k)], 0);
      expect(set.rtp).toBeCloseTo(set.lineEv + feature, 14);
      // Uncapped geometric series: RTP = L (1 + μ) / (1 − μ).
      expect(Math.abs(set.rtp - (set.lineEv * (1 + set.mu)) / (1 - set.mu))).toBeLessThan(1e-6);
      expect(Math.abs(set.rtp - 0.97)).toBeLessThan(0.002);
      expect(set.buyRtp).toBeCloseTo((FS_MULT * set.lineEv * set.expSpins[BUY_SPINS]) / set.buyPrice, 14);
      expect(set.buyRtp).toBeLessThanOrEqual(set.rtp);
      expect(set.rtp - set.buyRtp).toBeLessThan(0.01);
      console.log(
        `${set.vol.padEnd(6)} RTP ${(set.rtp * 100).toFixed(4)}%  line EV ${set.lineEv.toFixed(5)}  free spins 1 in ${(1 / set.trigger).toFixed(1)}  μ ${set.mu.toFixed(5)}  buy ${set.buyPrice}× → ${(set.buyRtp * 100).toFixed(4)}%`,
      );
    }
    expect(RTP).toBe(reelSet('medium').rtp);
    expect(manifest.rtp).toBe(RTP);
  });

  it('a spin returns the same EV on any number of lines (simulated)', () => {
    const set = reelSet('low');
    for (const lines of [1, 7, 20]) {
      const rng = createRng(seededSource(30 + lines));
      const n = 150_000;
      let sum = 0;
      let sq = 0;
      for (let i = 0; i < n; i++) {
        const stops = set.strips.map((s) => rng.int(s.length));
        const w = evaluate(set, windowAt(set, stops), lines).linePays / lines;
        sum += w;
        sq += w * w;
      }
      const mean = sum / n;
      const se = Math.sqrt((sq / n - mean * mean) / n);
      expect(Math.abs(mean - set.lineEv)).toBeLessThan(4 * se);
    }
  });

  it('paytables are monotone; the top pay is reachable and the max is honest', () => {
    for (const set of sets) {
      for (let s = 0; s < PAYING; s++) {
        expect(set.pays[s][0]).toBeLessThan(set.pays[s][1]);
        expect(set.pays[s][1]).toBeLessThan(set.pays[s][2]);
        if (s > 0) for (let k = 0; k < 3; k++) expect(set.pays[s][k]).toBeLessThanOrEqual(set.pays[s - 1][k]);
      }
      // A screen of diamonds pays the top line on every line: maxLine stakes.
      const full = Array.from({ length: REELS }, () => [0, 0, 0]);
      expect(evaluate(set, full, LINES).linePays / LINES).toBe(set.maxLine);
      expect(set.maxSpinRound).toBe(set.maxLine * (1 + FS_MULT * FS_CAP));
      expect(set.maxSpinRound).toBeLessThanOrEqual(MAX_MULTIPLIER);
      expect(set.maxBuyRound).toBeLessThanOrEqual(MAX_MULTIPLIER);
    }
    // On the high set a full stack of diamonds can fill every reel.
    const high = reelSet('high');
    for (const strip of high.strips) expect(strip.some((_, stop) => [0, 1, 2].every((k) => strip[(stop + k) % strip.length] === 0))).toBe(true);
    expect(manifest.maxMultiplier).toBe(MAX_MULTIPLIER);
  });

  it('line rule: leftmost run, wild substitutes, scatter breaks and never starts a line', () => {
    const pays = reelSet('medium').pays;
    expect(linePay([2, WILD, 2, 5, 2], pays)).toEqual({ sym: 2, count: 3, pay: pays[2][0] });
    expect(linePay([4, WILD, WILD, WILD, 4], pays)).toEqual({ sym: 4, count: 5, pay: pays[4][2] });
    expect(linePay([4, 4, SCATTER, 4, 4], pays).pay).toBe(0);
    expect(linePay([SCATTER, SCATTER, SCATTER, 1, 1], pays).pay).toBe(0);
    expect(linePay([1, 1, 0, 1, 1], pays).pay).toBe(0);
  });

  it('a round resolves once: total = sum of spins, free spins follow the scatters, the cap holds', () => {
    const set = reelSet('medium');
    const rng = createRng(seededSource(4));
    for (let i = 0; i < 3000; i++) {
      const lines = 1 + rng.int(LINES);
      const r = playRound(set, lines, () => rng.next());
      expect(r.total).toBeCloseTo(r.spins.reduce((s, x) => s + x.win, 0), 12);
      expect(r.multiplier).toBe(r.total);
      expect(r.spins[0].free).toBe(false);
      expect(r.freeSpins).toBe(r.spins.length - 1);
      expect(r.spins[0].awarded).toBe(awardFor(r.spins[0].scatterCells.length));
      r.spins.forEach((s, k) => {
        expect(s.mult).toBe(s.free ? FS_MULT : 1);
        expect(s.win).toBeCloseTo((s.wins.reduce((a, w) => a + w.pay, 0) / lines) * s.mult, 12);
        if (k > 0) expect(s.n).toBe(k);
      });
      expect(r.spins[r.spins.length - 1].left).toBe(0);
    }
    // A source that always stops on a scatter retriggers until the cap.
    const scatterStops = set.strips.map((s) => s.indexOf(SCATTER));
    let call = 0;
    const rigged = () => {
      const r = call++ % REELS;
      return (scatterStops[r] + 0.5) / set.strips[r].length;
    };
    const capped = playRound(set, LINES, rigged);
    expect(capped.spins[0].awarded).toBe(20);
    expect(capped.freeSpins).toBe(FS_CAP);
    // The buy plays only free spins and pays per amount paid.
    const b = playRound(set, LINES, () => rng.next(), true);
    expect(b.spins[0].free).toBe(true);
    expect(b.freeSpins).toBeGreaterThanOrEqual(BUY_SPINS);
    expect(b.multiplier).toBeCloseTo(b.total / set.buyPrice, 12);
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
