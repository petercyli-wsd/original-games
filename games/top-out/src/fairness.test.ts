// Fairness audit: can any way of playing Top Out beat the RTP?
//
// The only decisions are the wall (locked before the bet) and when to stop:
// Next reach and Cash out exist only at a checkpoint, after a reach whose result
// is already priced. Cash-out = prize × exact P(win | state), and one reach moves
// that value by its true outcome chances, so it is a martingale (checked exactly
// below at 30+ states). Strategies: (a) reach only while the next reach is ≥ 80%
// safe, (b) take any profit, (c) ride to the end, (d) stop once the mark is high.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import { RTP, WALLS, activeWall, decided, drawSlips, initState, markOf, prizeOf, reach, safeChance, winChance, type State } from './math';

const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 40_000);

type Stop = (s: State, value: number) => boolean;
const STRATEGIES: { name: string; stop: Stop }[] = [
  { name: '(a) reach while next ≥ 80% safe', stop: (s) => safeChance(s) < 0.8 },
  { name: '(b) take any profit', stop: (_, v) => v > 1 },
  { name: '(c) ride to the end', stop: () => false },
  { name: '(d) stop when the mark is 4+', stop: (s) => markOf(s) >= 4 },
];

function playRound(me: number, stop: Stop, rng: Rng): number {
  const prize = prizeOf(me);
  const F = drawSlips(rng.int);
  let s = initState();
  for (;;) {
    s = reach(s, F).next;
    const d = decided(s, me);
    if (d) return d === 'won' ? prize : 0;
    const v = prize * winChance(s, me);
    if (stop(s, v)) return v;
  }
}

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

describe('Top Out fairness', () => {
  it('martingale (exact) at 30+ reached states, every wall', () => {
    const rng = createRng(seededSource(77));
    let n = 0;
    for (let t = 0; t < 40; t++) {
      const F = drawSlips(rng.int);
      let s = initState();
      while (activeWall(s) >= 0 && [0, 1, 2, 3].some((m) => !decided(s, m))) {
        const w = activeWall(s);
        const q = 1 / (WALLS[w] - s.h[w]);
        const F2 = [...F];
        F2[w] = s.h[w];
        const slip = reach(s, F2).next;
        F2[w] = WALLS[w] - 1;
        const safe = reach(s, F2).next;
        for (let me = 0; me < 4; me++) {
          if (decided(s, me)) continue;
          expect(q * winChance(slip, me) + (1 - q) * winChance(safe, me)).toBeCloseTo(winChance(s, me), 12);
          n++;
        }
        s = reach(s, F).next;
      }
    }
    expect(n).toBeGreaterThanOrEqual(30);
  });

  it('strategies (a)–(d) on every wall return RTP within 4 SE, never above the manifest max', () => {
    evalSpec.configs.forEach(({ params: { me } }, ci) => {
      STRATEGIES.forEach(({ name, stop }, si) => {
        const { mean, se, max } = mc((r) => playRound(me, stop, r), ROUNDS, 900 + 7 * ci + si);
        expect(Math.abs(mean - RTP), `${name} wall ${WALLS[me]}`).toBeLessThan(4 * se + 1e-9);
        expect(max).toBeLessThanOrEqual(manifest.maxMultiplier + 1e-9);
      });
    });
  });
});
