// Fairness audit: can any way of playing Fleet beat the RTP?
//
// The only decision is when to cash out (k is locked once the bet is placed,
// and the climb has no other choices). The cash-out is prize * P(Bin(a, m/2) >= k)
// with a rockets flying at height m. A rocket flying at m is still flying at
// m' > m with chance m/m' independently, so by exact enumeration over the
// number of survivors E[cash-out(a', m')] = cash-out(a, m) at every state
// and for every later height m' (including 2x, where the cash-out is the
// prize or 0). Crash heights are drawn once, when the bet is placed.
//
// Strategies run on the game's own playCrashes, per eval config:
//   (a) act only when safe: cash out the moment the win chance falls below 80%;
//   (b) take any profit: cash out the moment the value exceeds the stake;
//   (c) play to 2x;
//   (d) the strongest-looking: hold until one crash from losing, then cash out.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  KS,
  RTP,
  ROCKETS,
  cashOut,
  crashFrom,
  playCrashes,
  stopAfterCrashes,
  stopAtEdge,
  stopAtValue,
  stopNever,
  stopWhenChanceBelow,
  type K,
  type StopRule,
} from './math';

const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 40_000);

const STRATEGIES: { name: string; stop: StopRule }[] = [
  { name: '(a) cash out when chance < 80%', stop: stopWhenChanceBelow(0.8) },
  { name: '(b) take any profit', stop: stopAtValue(1) },
  { name: '(c) play to 2x', stop: stopNever },
  { name: '(d) hold to one crash from losing', stop: stopAtEdge },
  { name: '(e) cash out after the first crash', stop: stopAfterCrashes(1) },
];

function mc(play: (rng: Rng) => number, rounds: number, seed: number) {
  const rng = createRng(seededSource(seed));
  let s = 0;
  let s2 = 0;
  let max = 0;
  for (let i = 0; i < rounds; i++) {
    const x = play(rng);
    s += x;
    s2 += x * x;
    if (x > max) max = x;
  }
  const mean = s / rounds;
  return { mean, se: Math.sqrt(Math.max(0, s2 / rounds - mean * mean) / rounds), max };
}

const choose = (n: number, r: number) => {
  let c = 1;
  for (let i = 1; i <= r; i++) c = (c * (n - r + i)) / i;
  return c;
};

/** E[cash-out at height m2 | a rockets flying at m], exact over survivors. */
function expectedAfter(a: number, m: number, m2: number, k: K) {
  const s = m / m2;
  let e = 0;
  for (let j = 0; j <= a; j++) e += choose(a, j) * s ** j * (1 - s) ** (a - j) * cashOut(j, m2, k);
  return e;
}

describe('Fleet fairness', () => {
  it('martingale (exact): at 30+ (a, m) states, for every later height, E[cash-out] equals the cash-out now', () => {
    const rng = createRng(seededSource(2024));
    let states = 0;
    for (const k of KS)
      for (let a = k; a <= ROCKETS; a++)
        for (let i = 0; i < 4; i++) {
          const m = 1 + rng.next() * 0.95;
          const m2 = m + rng.next() * (2 - m);
          expect(expectedAfter(a, m, m2, k)).toBeCloseTo(cashOut(a, m, k), 9);
          expect(expectedAfter(a, m, 2, k)).toBeCloseTo(cashOut(a, m, k), 9);
          states++;
        }
    expect(states).toBeGreaterThanOrEqual(30);
    // The start: cash out at 1x with five flying is RTP.
    for (const k of KS) expect(cashOut(ROCKETS, 1, k)).toBeCloseTo(RTP, 12);
  });

  it('the cash-out never exceeds the manifest max', () => {
    for (const k of KS)
      for (let a = 0; a <= ROCKETS; a++) for (const m of [1, 1.5, 1.99, 2]) expect(cashOut(a, m, k)).toBeLessThanOrEqual(manifest.maxMultiplier + 1e-9);
  });

  it('strategies (a)-(e) on every eval config return RTP within 4 SE, never above the max', () => {
    const rows: string[] = [];
    evalSpec.configs.forEach(({ label, params: { k } }, ci) => {
      STRATEGIES.forEach(({ name, stop }, si) => {
        const { mean, se, max } = mc((r) => playCrashes(Array.from({ length: ROCKETS }, () => crashFrom(r.next())), k, stop).multiplier, ROUNDS, 900 + 13 * ci + si);
        rows.push(`${label.padEnd(28)} ${name.padEnd(36)} ${(mean * 100).toFixed(2)}% ± ${(se * 100).toFixed(2)}%  max ${max.toFixed(2)}×`);
        expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-9);
        expect(max).toBeLessThanOrEqual(manifest.maxMultiplier + 1e-9);
      });
    });
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
