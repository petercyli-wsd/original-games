import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import { EMPTY, SHARES, addPoint, autoRound, forecast, isYours, needServer, needYou, prizeFor, winChance, winner, type Score } from './math';

const rng = createRng(seededSource(11));

function raw(p: number, u: () => number) {
  let r = 0;
  let s = 0;
  for (;;) {
    if (u() < 1 - p) r++;
    else s++;
    if (r >= 4 && r - s >= 2) return true;
    if (s >= 4 && s - r >= 2) return false;
  }
}

describe('Break Point maths', () => {
  it('matches the card: P(win) at p = 50 / 65 / 80 / 82', () => {
    expect(winChance(EMPTY, 0.5)).toBeCloseTo(0.5, 9);
    expect(winChance(EMPTY, 0.65)).toBeCloseTo(0.1704, 3);
    expect(winChance(EMPTY, 0.8)).toBeCloseTo(0.0218, 3);
    expect(winChance(EMPTY, 0.82)).toBeCloseTo(0.0145, 3);
  });
  it('matches a direct simulation of the raw game (4 SE)', () => {
    for (const p of [0.5, 0.65, 0.8]) {
      const n = 60_000;
      let wins = 0;
      for (let i = 0; i < n; i++) if (raw(p, () => rng.next())) wins++;
      const w = winChance(EMPTY, p);
      expect(Math.abs(wins / n - w)).toBeLessThan((4 * Math.sqrt(w * (1 - w))) / Math.sqrt(n));
    }
  });
  it('is a martingale over the next point, at every score', () => {
    for (const p of SHARES)
      for (let r = 0; r < 8; r++)
        for (let s = 0; s < 8; s++) {
          const x: Score = { r, s };
          if (winner(x)) continue;
          const f = forecast(x, p);
          expect((1 - p) * f.ifYou + p * f.ifServer).toBeCloseTo(winChance(x, p), 12);
        }
  });
  it('your point always raises the chance and the server\'s always lowers it', () => {
    for (const p of SHARES)
      for (let r = 0; r < 8; r++)
        for (let s = 0; s < 8; s++) {
          const x: Score = { r, s };
          if (winner(x)) continue;
          const f = forecast(x, p);
          expect(f.ifYou).toBeGreaterThan(winChance(x, p));
          expect(f.ifServer).toBeLessThan(winChance(x, p));
        }
  });
  it('the chance depends only on the two needs', () => {
    const seen = new Map<string, number>();
    for (let r = 0; r < 9; r++)
      for (let s = 0; s < 9; s++) {
        const x: Score = { r, s };
        if (winner(x)) continue;
        const k = `${needYou(x)},${needServer(x)}`;
        const w = winChance(x, 0.7);
        if (seen.has(k)) expect(w).toBeCloseTo(seen.get(k)!, 12);
        else seen.set(k, w);
      }
  });
  it('a won point lowers your need by one; the other need is unchanged or one higher', () => {
    for (let r = 0; r < 8; r++)
      for (let s = 0; s < 8; s++) {
        const x: Score = { r, s };
        if (winner(x)) continue;
        const y = addPoint(x, true);
        if (winner(y)) continue;
        expect(needYou(y)).toBe(needYou(x) - 1);
        expect([0, 1]).toContain(needServer(y) - needServer(x));
      }
  });
  it('the spinner green share is exactly your chance per point', () => {
    const n = 200_000;
    let g = 0;
    for (let i = 0; i < n; i++) if (isYours(rng.next(), 0.7)) g++;
    expect(Math.abs(g / n - 0.3)).toBeLessThan(0.005);
  });
  it('Auto and eval stay at RTP', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000, seed: 3 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier + 1e-9);
    }
    const prize = prizeFor(0.65);
    let tot = 0;
    const n = 80_000;
    for (let i = 0; i < n; i++) tot += autoRound(0.65, 2, () => rng.next()).multiplier;
    expect(Math.abs(tot / n - 0.99)).toBeLessThan(0.04);
    expect(prize).toBeGreaterThan(5);
  });
});
