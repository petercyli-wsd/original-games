import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import { CHIPS, TARGETS, autoRound, boils, forecast, prizeFor, slotFor, start, take, winChance, winner, type State } from './math';

const rng = createRng(seededSource(11));

function raw(k: number, u: () => number) {
  let s = start(k);
  for (;;) {
    s = take(s, slotFor(s, u()));
    const w = winner(s);
    if (w) return w === 'you';
  }
}

describe('Brew maths', () => {
  it('matches the card: P(win) at k = 2 / 4 / 6 / 8 / 10', () => {
    const want = [0.9488, 0.7684, 0.477, 0.188, 0.0239];
    TARGETS.forEach((k, i) => expect(winChance(start(k))).toBeCloseTo(want[i], 3));
  });
  it('matches a direct simulation (4 SE)', () => {
    for (const k of [3, 6, 9]) {
      const n = 60_000;
      let wins = 0;
      for (let i = 0; i < n; i++) if (raw(k, () => rng.next())) wins++;
      const p = winChance(start(k));
      expect(Math.abs(wins / n - p)).toBeLessThan((4 * Math.sqrt(p * (1 - p))) / Math.sqrt(n));
    }
  });
  it('every green chip raises the chance and every white lowers it (a white leaves it unchanged in under 0.5%)', () => {
    let seen = 0;
    let same = 0;
    for (const k of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      for (let i = 0; i < 4000; i++) {
        let s: State = start(k);
        for (;;) {
          const before = winChance(s);
          const slot = slotFor(s, rng.next());
          const t = take(s, slot);
          if (winner(t)) break;
          const after = winChance(t);
          if (CHIPS[slot] === 0) expect(after).toBeGreaterThan(before);
          else {
            expect(after).toBeLessThanOrEqual(before + 1e-12);
            if (Math.abs(after - before) < 1e-12) same++;
          }
          seen++;
          s = t;
        }
      }
    }
    expect(seen).toBeGreaterThan(10_000);
    expect(same / seen).toBeLessThan(0.005); // a last safe 1 at heat 6 leaves the red set unchanged
  });
  it('is a martingale: prize x chance is the average over the next chip', () => {
    for (const k of TARGETS) {
      let s: State = start(k);
      for (let step = 0; step < 6 && !winner(s); step++) {
        const left = s.bag.flatMap((b, i) => (b ? [i] : []));
        const avg = left.reduce((a, i) => a + winChance(take(s, i)), 0) / left.length;
        expect(avg).toBeCloseTo(winChance(s), 10);
        s = take(s, slotFor(s, rng.next()));
      }
    }
  });
  it('a red chip is exactly one that passes the limit', () => {
    expect(boils(4, 3)).toBe(false);
    expect(boils(5, 3)).toBe(true);
    expect(boils(6, 2)).toBe(true);
    expect(boils(7, 1)).toBe(true);
    expect(boils(7, 0)).toBe(false);
  });
  it('forecast is consistent with the chance now', () => {
    const f = forecast(start(6));
    expect(f.ifGreen).toBeGreaterThan(winChance(start(6)));
    expect(f.ifWhite).toBeLessThan(winChance(start(6)));
  });
  it('Auto and the eval return the RTP', () => {
    for (const k of [2, 6, 10]) {
      const n = 80_000;
      let total = 0;
      for (let i = 0; i < n; i++) total += autoRound(k, null, () => rng.next()).multiplier;
      expect(total / n).toBeGreaterThan(0.96 * 0.99 - 0.1);
      expect(prizeFor(k)).toBeGreaterThan(1);
    }
    const out = runEval(evalSpec, { rounds: 20_000, seed: 3 });
    expect(out).toBeDefined();
  });
  it('is a prototype with a team-ready note', () => {
    expect(manifest.revision?.date).toBe('2026-11-13');
  });
});
