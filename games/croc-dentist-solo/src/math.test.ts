import { createRng, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import { initialState, reducer, type GameState } from './game';
import { buildLadder, maxMultiplier, pickTraps } from './math';

const rng = createRng(seededSource(11));
const TEETH = [8, 10, 12, 16, 20];
const BAD = [1, 2, 3, 4, 5];

describe('solo ladder maths', () => {
  it('every cash-out point is worth exactly the RTP', () => {
    for (const N of TEETH)
      for (const k of BAD)
        for (const step of buildLadder(N, k, 0.99)) expect(step.reach * step.mult).toBeCloseTo(0.99, 10);
  });

  it('matches the closed form rtp * C(N, j) / C(N-k, j)', () => {
    const C = (n: number, r: number) => {
      let c = 1;
      for (let i = 0; i < r; i++) c = (c * (n - i)) / (i + 1);
      return c;
    };
    const ladder = buildLadder(12, 3, 0.99);
    ladder.forEach((s) => expect(s.mult).toBeCloseTo((0.99 * C(12, s.press)) / C(9, s.press), 8));
  });

  it('pressing every good tooth pays rtp * C(N, k)', () => {
    expect(maxMultiplier([20], [5], 0.99)).toBeCloseTo(0.99 * 15504, 6);
  });
});

// Plays rounds through the reducer, cashing out after `cashAfter` safe presses.
function simulate(N: number, k: number, games: number, cashAfter: number) {
  let returned = 0;
  for (let g = 0; g < games; g++) {
    let s: GameState = reducer(initialState(), { type: 'start', bet: 1, N, k, rtp: 0.99, traps: pickTraps(N, k, rng) });
    while (s.phase === 'playing') {
      if (s.round!.safe >= cashAfter) {
        s = reducer(s, { type: 'cashOut' });
        break;
      }
      const free = s.round!.pressed.flatMap((p, i) => (p ? [] : [i]));
      s = reducer(s, { type: 'press', i: free[rng.int(free.length)] });
    }
    returned += s.history[0].mult;
  }
  return returned / games;
}

describe('solo reducer (Monte Carlo)', () => {
  it('RTP is ~99% for early and late cash-outs', () => {
    for (const [N, k, after] of [[12, 1, 3], [12, 1, 11], [8, 3, 2], [10, 2, 5]] as const) {
      const rtp = simulate(N, k, 40000, after);
      expect(rtp).toBeGreaterThan(0.95);
      expect(rtp).toBeLessThan(1.03);
    }
  });

  it('ends the game automatically once every good tooth is pressed', () => {
    let s: GameState = reducer(initialState(), { type: 'start', bet: 1, N: 8, k: 1, rtp: 0.99, traps: [7] });
    for (let i = 0; i < 7; i++) s = reducer(s, { type: 'press', i });
    expect(s.phase).toBe('over');
    expect(s.history[0].mult).toBeCloseTo(0.99 * 8, 10);
  });
});
