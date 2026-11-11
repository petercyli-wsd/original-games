import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import { KS, MATCHES, RTP, SEEDS, counts, pUpset, pWin, playMatch, prizeFor, sides, startP, status } from './math';

const rng = createRng(seededSource(5));

/** Exact enumeration of all 2^7 match results. */
function enumerate(k: number): number {
  let total = 0;
  for (let mask = 0; mask < 128; mask++) {
    const res: number[] = [];
    let p = 1;
    for (let i = 0; i < MATCHES; i++) {
      const [f, u] = sides(res, i);
      const pu = pUpset(res, i);
      if (mask >> i & 1) (res.push(u), (p *= pu));
      else (res.push(f), (p *= 1 - pu));
    }
    // the bet is decided by which count completes first
    let up = 0;
    let fav = 0;
    let won = false;
    for (let i = 0; i < MATCHES; i++) {
      if (res[i] === sides(res.slice(0, i), i)[1]) up++;
      else fav++;
      if (up >= k) (won = true);
      if (up >= k || fav >= SEEDS - k) break;
    }
    if (won) total += p;
  }
  return total;
}

describe('Upsets maths', () => {
  it('matches the card: P(win) for k = 1..5', () => {
    const want = [0.9181, 0.6364, 0.2916, 0.0874, 0.0207];
    KS.forEach((k, i) => expect(startP(k)).toBeCloseTo(want[i], 3));
  });
  it('the DP equals exact enumeration', () => {
    for (const k of KS) expect(pWin([], k)).toBeCloseTo(enumerate(k), 12);
  });
  it('exactly one count completes within 7 matches', () => {
    for (let t = 0; t < 2000; t++) {
      const res: number[] = [];
      while (status(res, 3) === 'live') res.push(playMatch(res, res.length, rng.next()));
      const { up, fav } = counts(res);
      expect(up >= 3 !== fav >= 5).toBe(true);
    }
  });
  it('an upset always raises the chance and a favourite win lowers it', () => {
    for (let t = 0; t < 3000; t++) {
      const k = KS[rng.int(5)];
      const res: number[] = [];
      while (status(res, k) === 'live') {
        const i = res.length;
        const [f, u] = sides(res, i);
        expect(pWin([...res, u], k)).toBeGreaterThan(pWin(res, k));
        expect(pWin([...res, f], k)).toBeLessThan(pWin(res, k));
        res.push(playMatch(res, i, rng.next()));
      }
    }
  });
  it('the cash-out is a martingale', () => {
    for (let t = 0; t < 500; t++) {
      const k = KS[rng.int(5)];
      const res: number[] = [];
      while (status(res, k) === 'live') {
        const i = res.length;
        const [f, u] = sides(res, i);
        const pu = pUpset(res, i);
        expect(pu * pWin([...res, u], k) + (1 - pu) * pWin([...res, f], k)).toBeCloseTo(pWin(res, k), 12);
        res.push(playMatch(res, i, rng.next()));
      }
    }
  });
  it('eval RTP is within 4 SE and max is bounded', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
    expect(prizeFor(1) * startP(1)).toBeCloseTo(RTP, 12);
  });
});
