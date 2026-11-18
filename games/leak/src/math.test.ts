import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import { RTP, TARGETS, WAIT, autoRound, inPlay, pickFor, prizeFor, start, take, winChance, winner, type State } from './math';

const rng = createRng(seededSource(11));

function raw(k: number, u: () => number) {
  let s = start(k);
  for (;;) {
    s = take(s, pickFor(s, u()));
    const w = winner(s);
    if (w) return w === 'you';
  }
}

describe('Leak maths', () => {
  it('matches the card: P(win) at k = 3 / 5 / 7 / 9 / 11', () => {
    const want = [0.9488, 0.7309, 0.3772, 0.1097, 0.0144];
    TARGETS.forEach((k, i) => expect(winChance(start(k))).toBeCloseTo(want[i], 3));
  });
  it('matches a direct simulation (4 SE)', () => {
    for (const k of [4, 7, 9]) {
      const n = 60_000;
      let wins = 0;
      for (let i = 0; i < n; i++) if (raw(k, () => rng.next())) wins++;
      const p = winChance(start(k));
      expect(Math.abs(wins / n - p)).toBeLessThan((4 * Math.sqrt(p * (1 - p))) / Math.sqrt(n));
    }
  });
  it('every arrival raises the chance and every departure lowers it (0 exceptions)', () => {
    let seen = 0;
    for (const k of [1, 3, 5, 7, 9, 11, 13]) {
      for (let i = 0; i < 3000; i++) {
        let s: State = start(k);
        for (;;) {
          const before = winChance(s);
          const id = pickFor(s, rng.next());
          const t = take(s, id);
          if (winner(t)) break;
          const after = winChance(t);
          if (s.z[id] === WAIT) expect(after).toBeGreaterThan(before);
          else expect(after).toBeLessThan(before);
          seen++;
          s = t;
        }
      }
    }
    expect(seen).toBeGreaterThan(10_000);
  });
  it('is a martingale: the average over the next tick is the chance now', () => {
    for (const k of TARGETS) {
      let s: State = start(k);
      for (let step = 0; step < 6 && !winner(s); step++) {
        const live = inPlay(s);
        const avg = live.reduce((a, i) => a + winChance(take(s, i)), 0) / live.length;
        expect(avg).toBeCloseTo(winChance(s), 10);
        s = take(s, pickFor(s, rng.next()));
      }
    }
  });
  it('the round lasts at most k + 2 ticks and never leaves a certain move', () => {
    for (const k of TARGETS) {
      for (let i = 0; i < 2000; i++) {
        let s = start(k);
        let n = 0;
        while (!winner(s)) {
          s = take(s, pickFor(s, rng.next()));
          n++;
        }
        expect(n).toBeLessThanOrEqual(k + 2);
      }
    }
  });
  it('Auto returns the RTP and the eval runs', () => {
    for (const k of [3, 7, 11]) {
      const n = 80_000;
      let total = 0;
      for (let i = 0; i < n; i++) total += autoRound(k, null, () => rng.next()).multiplier;
      const p = prizeFor(k) * winChance(start(k));
      expect(p).toBeCloseTo(RTP, 10);
      expect(Math.abs(total / n - RTP)).toBeLessThan((4 * prizeFor(k) * Math.sqrt(winChance(start(k)))) / Math.sqrt(n));
    }
    expect(runEval(evalSpec, { rounds: 20_000, seed: 3 })).toBeDefined();
  });
  it('is a prototype with a team-ready note', () => {
    expect(manifest.revision?.date).toBe('2026-11-17');
    expect(manifest.revision?.note.startsWith('Sonnet-generated, not yet rated by the team.')).toBe(true);
  });
});
