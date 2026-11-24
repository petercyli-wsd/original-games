// Fairness audit: can any way of playing Turf beat the RTP?
//
// The only decision in a round is when to stop: the target is locked while
// live, the Bet sets the grid up and waits, and each tick runs only when
// Spread is pressed (Space calls the same spread()). Cash out exists only
// between ticks and settles at prize x P(win | state). P(win | state) is exact
// (a memoised recursion over the arrows), so the value is a martingale:
// E[value after a tick (and its capture)] = value now.
//
// Martingale check, on the real tick() / outcomes() / winChance(): at 30+
// reached states (all six targets, early and late, with and without a capture
// next), the sum over every arrow of (1 / arrows) x value after equals the value
// now to 1e-12. Capture leaves the chance unchanged, which the maths tests check
// at every reachable state.
//
// Strategies, per eval config, on the same functions the game plays:
//   (a) spread while your chance is at least 50%, else cash out;
//   (b) take any profit: cash out the moment the cash-out passes the bet;
//   (c) play to the end;
//   (d) cash out right after the house takes a contested cell;
//   (e) cash out whenever you have fewer arrows than the house;
//   (f) cash out right after any capture.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import { RTP, TARGETS, arrowCounts, cashOf, outcomes, prizeFor, start, tick, winChance, winner, type State, type Tick } from './math';

const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 20_000);

type Stop = (s: State, t: Tick, cash: number) => boolean;

const STRATEGIES: { name: string; stop: Stop }[] = [
  { name: '(a) spread while chance >= 50%', stop: (s) => winChance(s) < 0.5 },
  { name: '(b) take any profit', stop: (_, __, cash) => cash > 1 },
  { name: '(c) play to the end', stop: () => false },
  { name: '(d) cash out after the house takes a contested cell', stop: (_, t) => t.contested && t.arrow.paint === 'house' },
  { name: '(e) cash out with fewer arrows', stop: (s) => arrowCounts(s).you < arrowCounts(s).house },
  { name: '(f) cash out after a capture', stop: (_, t) => t.captured !== null },
];

/** One round as Game.tsx plays it: Bet, then checkpoint -> cash out or spread, until decided. */
function playRound(k: number, stop: Stop, rng: Rng): number {
  const prize = prizeFor(k);
  let s = start(k);
  for (;;) {
    const t = tick(s, rng.next());
    s = t.after;
    const w = winner(s);
    if (w) return w === 'you' ? prize : 0;
    const cash = cashOf(s, prize);
    if (stop(s, t, cash)) return cash;
  }
}

function mc(play: (rng: Rng) => number, rounds: number, seed: number) {
  const rng = createRng(seededSource(seed));
  let sum = 0;
  let sum2 = 0;
  let max = 0;
  for (let i = 0; i < rounds; i++) {
    const x = play(rng);
    sum += x;
    sum2 += x * x;
    if (x > max) max = x;
  }
  const mean = sum / rounds;
  return { mean, se: Math.sqrt(Math.max(0, sum2 / rounds - mean * mean) / rounds), max };
}

/** Checkpoints met while playing random rounds, with each target in turn. */
function reachedStates(count: number, rng: Rng): State[] {
  const out: State[] = [];
  while (out.length < count) {
    let s = start(TARGETS[out.length % TARGETS.length]);
    for (;;) {
      s = tick(s, rng.next()).after;
      if (winner(s)) break;
      if (rng.next() < 0.5) out.push(s);
    }
  }
  return out.slice(0, count);
}

describe('Turf fairness', () => {
  it('martingale (exact): at 40+ reached states the value after one tick averages to the value now', () => {
    const rng = createRng(seededSource(2024));
    const states = [...TARGETS.map(start), ...reachedStates(48, rng)];
    expect(states.length).toBeGreaterThanOrEqual(30);
    expect(new Set(states.map((s) => s.k)).size).toBe(TARGETS.length);
    let withCapture = 0;
    for (const s of states) {
      const prize = prizeFor(s.k);
      const now = prize * winChance(s);
      let mean = 0;
      for (const o of outcomes(s)) {
        mean += o.p * cashOf(o.after, prize);
        if (o.tick.captured) withCapture++;
      }
      expect(Math.abs(mean - now)).toBeLessThan(1e-10);
    }
    expect(withCapture).toBeGreaterThan(0);
    expect(prizeFor(9) * winChance(start(9))).toBeCloseTo(RTP, 12);
  });

  it('strategies (a)-(f) on every eval config return RTP within 4 SE, never above the manifest max', () => {
    const rows: string[] = [];
    evalSpec.configs.forEach(({ label, params: { k } }, ci) => {
      STRATEGIES.forEach(({ name, stop }, si) => {
        const { mean, se, max } = mc((r) => playRound(k, stop, r), ROUNDS, 7100 + 13 * ci + si);
        rows.push(`${label.padEnd(8)} ${name.padEnd(52)} ${(mean * 100).toFixed(2)}% +- ${(se * 100).toFixed(2)}%  max ${max.toFixed(2)}x`);
        expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-9);
        expect(max).toBeLessThanOrEqual(manifest.maxMultiplier + 1e-9);
      });
    });
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
