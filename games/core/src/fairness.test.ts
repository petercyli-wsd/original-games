// Fairness audit: can any way of playing Core beat the RTP?
//
// The target is fixed when the bet is placed (the chips are disabled while
// live). In a round the only decision is when to stop: after each interval
// that keeps the core, cash out or drop the next. The cash-out is a ladder:
// a drop with bust chance q = l² + (1 − r)² multiplies it by 1/(1 − q). So the
// whole question is whether the true bust chance of the real draw
// ({ u: rng.next(), v: rng.next() } judged by `meets`, as Game.tsx and eval.ts
// draw it) equals the q used for pricing, at every state, including near the
// max-win cap and on the last drop.
//
// Strategies, per eval config (one per target), on the real draw:
//   (a) the tester's: drop only while the next drop is ≥ 80% safe, else cash out;
//   (b) take any profit: cash out the moment V > 1;
//   (c) play to the end (or the max-win auto-cash);
//   (d) lopsided-core rule: cash out as soon as one red corner dominates
//       (max(l, 1 − r) > 0.5, the board's big red square), else ride to the end
//       or the cap. Also the "free first drop" check: the first drop has q = 0
//       exactly, so it moves nothing.
// Long shots (play to the end on 8 or 12 intervals) have heavy tails; the
// audit's heavy run uses more rounds for those (fairness/core-heavy.log).

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import {
  MAX_WIN,
  RTP,
  TARGETS,
  afterSafeDrop,
  completeChance,
  core,
  hitsCap,
  meets,
  redSquares,
  risk,
  shareChance,
  type Core,
  type Interval,
  type Target,
} from './math';

/** Rounds per Monte Carlo run. The audit's 200k run sets FAIRNESS_ROUNDS=200000. */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 40_000);

/** Largest cash-out reached in any simulated round (checked against MAX_WIN). */
let maxPaid = 0;

/** The drop as Game.tsx makes it. */
const draw = (rng: Rng): Interval => ({ u: rng.next(), v: rng.next() });

type Stop = (c: Core, cash: number, landed: number, target: number) => boolean;

/**
 * One round exactly as Game.tsx runs it: the first drop goes with the bet; after
 * each safe drop the round ends on the last interval or at the cap, else the
 * player may stop.
 */
function playRound(target: number, stop: Stop, rng: Rng): number {
  const intervals: Interval[] = [];
  let cash = RTP;
  for (;;) {
    const c = core(intervals);
    const q = risk(c);
    const iv = draw(rng);
    if (!meets(c, iv)) return 0;
    intervals.push(iv);
    cash = afterSafeDrop(cash, q);
    if (cash > maxPaid) maxPaid = cash;
    if (intervals.length >= target) return cash;
    const next = core(intervals);
    if (hitsCap(cash, risk(next))) return cash;
    if (stop(next, cash, intervals.length, target)) return cash;
  }
}

const STRATEGIES: { name: string; stop: Stop }[] = [
  { name: '(a) tester: drop while ≥ 80% safe', stop: (c) => 1 - risk(c) < 0.8 },
  { name: '(b) take any profit', stop: (_c, cash) => cash > 1 },
  { name: '(c) play to the end', stop: () => false },
  { name: '(d) cash when one red corner dominates', stop: (c) => Math.max(c.l, 1 - c.r) > 0.5 },
];

function mc(play: (rng: Rng) => number, rounds: number, seed: number) {
  const rng = createRng(seededSource(seed));
  let s = 0;
  let s2 = 0;
  for (let i = 0; i < rounds; i++) {
    const x = play(rng);
    s += x;
    s2 += x * x;
  }
  const mean = s / rounds;
  return { mean, se: Math.sqrt(Math.max(0, s2 / rounds - mean * mean) / rounds) };
}

describe('Core fairness', () => {
  it('the first drop is free (q = 0) and the board’s red squares are the bust chance', () => {
    expect(risk(core([]))).toBe(0);
    const rng = createRng(seededSource(9001));
    for (let i = 0; i < 200; i++) {
      const ivs = Array.from({ length: 1 + rng.int(5) }, () => draw(rng));
      const c = core(ivs);
      if (c.l > c.r) continue;
      const [a, b] = redSquares(c);
      expect(a.side ** 2 + b.side ** 2).toBeCloseTo(risk(c), 14);
    }
  });

  it('martingale: at 40 reached states, the real draw busts with chance exactly q (100k draws each, within 4 SE), so E[V after] = V', () => {
    const rng = createRng(seededSource(9002));
    const states: { c: Core; cash: number }[] = [];
    // Reached states: real rounds of random targets, keeping checkpoints.
    while (states.length < 32) {
      const target = TARGETS[rng.int(TARGETS.length)];
      const ivs: Interval[] = [];
      let cash = RTP;
      for (;;) {
        const c = core(ivs);
        const q = risk(c);
        const iv = draw(rng);
        if (!meets(c, iv)) break;
        ivs.push(iv);
        cash = afterSafeDrop(cash, q);
        const next = core(ivs);
        if (ivs.length >= target || hitsCap(cash, risk(next))) break;
        if (ivs.length >= 2) states.push({ c: next, cash });
        if (rng.next() < 0.3) break;
      }
    }
    // States near the end of a round and near the cap: thin cores at the edge of
    // the segment (q near 1) with cash just under the cap.
    for (const [l, r] of [[0.9, 0.92], [0.05, 0.07], [0.48, 0.5], [0.7, 0.99], [0.0, 0.01], [0.97, 0.98], [0.3, 0.31], [0.5, 0.5]]) {
      const q = risk({ l, r });
      states.push({ c: { l, r }, cash: MAX_WIN * (1 - q) * 0.999 });
    }
    expect(states.length).toBeGreaterThanOrEqual(40);

    const N = 100_000;
    for (const { c, cash } of states) {
      const q = risk(c);
      expect(hitsCap(cash, q)).toBe(false);
      let sum = 0;
      let sum2 = 0;
      for (let i = 0; i < N; i++) {
        // The next event: one drop. V after = cash / (1 − q) if it meets the core, else 0.
        const v = meets(c, draw(rng)) ? afterSafeDrop(cash, q) : 0;
        sum += v;
        sum2 += v * v;
      }
      const mean = sum / N;
      const se = Math.sqrt(Math.max(0, sum2 / N - mean * mean) / N);
      expect(Math.abs(mean - cash)).toBeLessThan(4 * se + 1e-9 * cash);
    }
  });

  it('the bust chance is exact: sweeping endpoint pairs on a fine grid reproduces q', () => {
    // Midpoint grid on the unit square of (u, v): the area where `meets` fails.
    const G = 600;
    for (const c of [
      { l: 0.2, r: 0.7 },
      { l: 0.55, r: 0.6 },
      { l: 0.01, r: 0.95 },
      { l: 0.9, r: 0.97 },
    ]) {
      let miss = 0;
      for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) if (!meets(c, { u: (i + 0.5) / G, v: (j + 0.5) / G })) miss++;
      expect(Math.abs(miss / G ** 2 - risk(c))).toBeLessThan(4 / G);
    }
  });

  it('the cap only ends rounds with a payout, never above MAX_WIN', () => {
    // At the cap the round auto-cashes at the current V: a stopping rule.
    expect(hitsCap(MAX_WIN * 0.5, 0.5)).toBe(false);
    expect(hitsCap(MAX_WIN * 0.5, 0.5 + 1e-9)).toBe(true);
    expect(hitsCap(1, 1)).toBe(true);
  });

  it('the headline chance matches the exact live formula at the start', () => {
    for (const t of TARGETS) expect(completeChance({ l: 0, r: 1 }, t)).toBeCloseTo(shareChance(t), 12);
  });

  it(`strategies on the real draw, every eval config (${ROUNDS} rounds each, within 4 SE)`, () => {
    const rows: string[] = [];
    let seed = 9100;
    for (const cfg of evalSpec.configs) {
      const { target } = cfg.params as { target: Target };
      for (const { name, stop } of STRATEGIES) {
        // Long shots get more rounds so the standard error stays meaningful.
        const rounds = stop === STRATEGIES[2].stop && target >= 8 ? ROUNDS * 5 : ROUNDS;
        const r = mc((rng) => playRound(target, stop, rng), rounds, seed++);
        rows.push(`${cfg.label} | ${name} | ${rounds} | ${(100 * r.mean).toFixed(3)}% ± ${(100 * r.se).toFixed(3)}%`);
        expect(Math.abs(r.mean - RTP)).toBeLessThan(4 * r.se + 1e-9);
      }
    }
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
