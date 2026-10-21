import { createRng, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import { buildLadder, ladderStats, pickTraps } from './math';
import { initialState, reducer, type GameState } from './game';

const rng = createRng(seededSource(7));

const CONFIGS: [number, number, number][] = [];
for (const N of [8, 10, 12, 16, 20]) for (const k of [1, 2, 3, 4, 5]) for (const J of [1, 1.5, 2]) CONFIGS.push([N, k, J]);

// Exact expected return of the strategy "cash out after `stop` rounds" (Infinity = play to the end).
function exactReturn(N: number, k: number, J: number, stop: number) {
  const ladder = buildLadder(N, k, J, 0.99);
  let reach = 1;
  let ev = 0;
  for (let r = 0; r < ladder.length; r++) {
    if (r === stop) return ev + reach * ladder[r].cash;
    const g = ladder[r];
    ev += reach * g.pHouse * g.bite;
    reach *= g.pBoth;
  }
  const last = ladder[ladder.length - 1];
  return ev + (last.pBoth > 0 ? reach * last.next : 0);
}

describe('ladder maths', () => {
  it('returns exactly the RTP for every cash-out strategy', () => {
    for (const [N, k, J] of CONFIGS) {
      const rounds = buildLadder(N, k, J, 0.99).length;
      for (let stop = 1; stop <= rounds + 1; stop++) {
        expect(exactReturn(N, k, J, stop)).toBeCloseTo(0.99, 10);
      }
    }
  });

  it('at Bite Bonus 2 with one bad tooth is a flat 50/50 duel paying 1.98x', () => {
    const ladder = buildLadder(12, 1, 2, 0.99);
    for (const r of ladder) expect(r.bite).toBeCloseTo(1.98, 10);
    expect(ladderStats(ladder).winChance).toBeCloseTo(0.5, 10);
  });

  it('picks distinct traps in range', () => {
    for (let i = 0; i < 200; i++) {
      const t = pickTraps(12, 3, rng);
      expect(new Set(t).size).toBe(3);
      t.forEach((x) => expect(x >= 0 && x < 12).toBe(true));
    }
  });
});

// Plays real games through the reducer with random presses, holding to the end.
function simulate(N: number, k: number, J: number, games: number, cashAfter = Infinity) {
  let returned = 0;
  for (let g = 0; g < games; g++) {
    let s: GameState = reducer(initialState(), { type: 'start', bet: 1, N, k, J, rtp: 0.99, traps: pickTraps(N, k, rng) });
    while (s.phase === 'you' || s.phase === 'house') {
      const free = s.round!.pressed.flatMap((p, i) => (p ? [] : [i]));
      const i = free[rng.int(free.length)];
      if (s.phase === 'you' && s.round!.r >= cashAfter) s = reducer(s, { type: 'cashOut' });
      else s = reducer(s, { type: s.phase === 'you' ? 'pressYou' : 'pressHouse', i });
    }
    returned += s.history[0].mult;
  }
  return returned / games;
}

describe('game reducer (Monte Carlo)', () => {
  it('RTP is ~99% when playing to the end', () => {
    for (const [N, k, J] of [[12, 1, 1.5], [8, 3, 1], [20, 5, 2]] as const) {
      expect(simulate(N, k, J, 40000)).toBeGreaterThan(0.96);
      expect(simulate(N, k, J, 40000)).toBeLessThan(1.02);
    }
  });

  it('RTP is ~99% when cashing out after 2 rounds', () => {
    const rtp = simulate(12, 2, 1.5, 40000, 2);
    expect(rtp).toBeGreaterThan(0.96);
    expect(rtp).toBeLessThan(1.02);
  });
});
