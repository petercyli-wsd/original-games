import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  BLINDS,
  CUPS,
  MAX_MULTIPLIER,
  MOVES,
  RTP,
  applyMove,
  drawMove,
  expectMove,
  finalChances,
  moveBall,
  nextOdds,
  schedule,
  startBelief,
  startChances,
} from './math';

const rng = createRng(seededSource(11));

describe('Shells maths', () => {
  it('the schedule has exactly the chosen number of blind moves', () => {
    for (const b of BLINDS) expect(schedule(b).filter(Boolean).length).toBe(b);
  });

  it('every slot is reachable at the start and the odds sum to 1', () => {
    for (const n of CUPS)
      for (const b of BLINDS) {
        const q = startChances(n, b);
        expect(q.reduce((a, x) => a + x, 0)).toBeCloseTo(1, 12);
        for (const x of q) expect(x).toBeGreaterThan(0);
        expect(Math.max(...q.map((x) => RTP / x))).toBeLessThanOrEqual(MAX_MULTIPLIER);
      }
  });

  it('the start odds match a direct simulation of the dealer', () => {
    for (const n of CUPS)
      for (const b of [0, 4]) {
        const sched = schedule(b);
        const rounds = 40_000;
        const counts = Array.from({ length: n }, () => 0);
        for (let r = 0; r < rounds; r++) {
          let ball = 0;
          for (const blind of sched) {
            const { pair, swapped } = drawMove(rng, n, blind);
            ball = moveBall(ball, pair, swapped);
          }
          counts[ball]++;
        }
        const q = startChances(n, b);
        q.forEach((p, s) => expect(Math.abs(counts[s] / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-3));
      }
  });

  it('the belief is the true posterior: given what was seen, the ball is where p says', () => {
    // Fix one observed sequence of pairs; simulate the hidden coins many times.
    const n = 5;
    const sched = schedule(4);
    const pairs = [0, 1, 1, 2, 0, 3];
    let p = startBelief(n);
    pairs.forEach((a, t) => (p = applyMove(p, a, sched[t])));
    const counts = Array.from({ length: n }, () => 0);
    const rounds = 40_000;
    for (let r = 0; r < rounds; r++) {
      let ball = 0;
      pairs.forEach((a, t) => (ball = moveBall(ball, a, sched[t] ? rng.next() < 0.5 : true)));
      counts[ball]++;
    }
    p.forEach((x, s) => expect(Math.abs(counts[s] / rounds - x)).toBeLessThan(4 * Math.sqrt((x * (1 - x)) / rounds) + 1e-3));
  });

  it('martingale: the per-move odds average to the odds now, at random reachable states', () => {
    for (let trial = 0; trial < 300; trial++) {
      const n = CUPS[rng.int(CUPS.length)];
      const sched = schedule(BLINDS[rng.int(BLINDS.length)]);
      const done = rng.int(MOVES);
      let p = startBelief(n);
      for (let t = 0; t < done; t++) p = applyMove(p, rng.int(n - 1), sched[t]);
      const now = finalChances(p, sched, done);
      for (let s = 0; s < n; s++) {
        const next = nextOdds(p, sched, done, s);
        expect(next.length).toBe(n - 1);
        expect(next.reduce((a, x) => a + x, 0) / next.length).toBeCloseTo(now[s], 12);
      }
      // And the cash-out V = prize × P is preserved in expectation.
      const prize = 3.7;
      const v = prize * now[0];
      const ev = nextOdds(p, sched, done, 0).reduce((a, x) => a + prize * x, 0) / (n - 1);
      expect(ev).toBeCloseTo(v, 12);
    }
  });

  it('expectMove is the average of the equally likely moves and keeps total mass', () => {
    const p = [0.1, 0.4, 0.2, 0.3];
    for (const blind of [false, true]) {
      const q = expectMove(p, blind);
      expect(q.reduce((a, x) => a + x, 0)).toBeCloseTo(1, 12);
    }
    expect(applyMove(p, 1, false)).toEqual([0.1, 0.2, 0.4, 0.3]);
    expect(applyMove(p, 1, true)).toEqual([0.1, 0.30000000000000004, 0.30000000000000004, 0.3]);
  });

  it('unreachable slots are exactly 0, and at the end the odds are the belief', () => {
    const sched = schedule(0);
    let p = startBelief(5);
    for (let t = 0; t < 4; t++) p = applyMove(p, 0, sched[t]); // ball stays at 0 or 1
    expect(finalChances(p, sched, 4)[4]).toBe(0);
    expect(finalChances(p, sched, MOVES)).toEqual(p);
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
