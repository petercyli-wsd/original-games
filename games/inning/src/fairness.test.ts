// Fairness audit: can any way of playing Inning beat the RTP?
// The only decision is when to cash out (k is locked while live; Spin and Cash
// out exist only at a checkpoint). Cash-out = prize x P(win | state), where
// P(win | state) is the exact DP, so the value is a martingale. The exact check
// is in math.test.ts at every one of the 8 x 3 x k states; here the real
// functions are played under hostile strategies, each within 4 SE of RTP.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import { RTP, TARGETS, WHEEL, cashOut, prize, startState, step, winChance, type State } from './math';

const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 30_000);

type Stop = (s: State, cash: number, k: number) => boolean;
const STRATEGIES: { name: string; stop: Stop }[] = [
  { name: '(a) spin while next out chance is small: win chance >= 0.8 x start', stop: (s, _c, k) => winChance(s) < 0.8 * winChance(startState(k)) },
  { name: '(b) take any profit', stop: (_s, c) => c > 1 },
  { name: '(c) play to the end', stop: () => false },
  { name: '(d) stop at 2 outs, chase otherwise', stop: (s) => s.outs >= 2 },
];

function play(k: number, stop: Stop, rng: Rng): { x: number; spins: number } {
  let s = startState(k);
  let spins = 0;
  for (;;) {
    const r = step(s, WHEEL[rng.int(WHEEL.length)]);
    spins++;
    if (r.kind === 'out' && r.over) return { x: 0, spins };
    if (r.kind === 'hit' && r.won) return { x: prize(k), spins };
    s = r.state;
    const c = cashOut(k, s);
    if (stop(s, c, k)) return { x: c, spins };
  }
}

describe('Inning fairness', () => {
  it('hostile strategies return RTP on every config, within the manifest max', () => {
    evalSpec.configs.forEach(({ params: { k } }, ci) => {
      STRATEGIES.forEach(({ stop }, si) => {
        const rng = createRng(seededSource(900 + ci * 10 + si));
        let sum = 0;
        let sum2 = 0;
        let max = 0;
        for (let i = 0; i < ROUNDS; i++) {
          const { x } = play(k, stop, rng);
          sum += x;
          sum2 += x * x;
          max = Math.max(max, x);
        }
        const mean = sum / ROUNDS;
        const se = Math.sqrt(Math.max(0, sum2 / ROUNDS - mean * mean) / ROUNDS);
        expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-9);
        expect(max).toBeLessThanOrEqual(manifest.maxMultiplier + 1e-9);
      });
    });
    expect(TARGETS.length).toBe(6);
  });
});
