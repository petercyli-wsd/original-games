import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import { RTP, TARGETS, WHEEL, cashOut, ending, moveRunners, prize, startState, step, winChance, type State } from './math';

const rng = createRng(seededSource(11));

function allStates(k: number): State[] {
  const out: State[] = [];
  for (let bases = 0; bases < 8; bases++) for (let outs = 0; outs < 3; outs++) for (let need = 1; need <= k; need++) out.push({ bases, outs, need });
  return out;
}

describe('Inning maths', () => {
  it('matches the card: win chances for 1 to 6 runs', () => {
    const want = [0.369, 0.1975, 0.0969, 0.0448, 0.0198, 0.0084];
    TARGETS.forEach((k, i) => expect(winChance(startState(k))).toBeCloseTo(want[i], 3));
  });

  it('a hit moves everyone, and the same hit is worth 0 to 4 runs', () => {
    expect(moveRunners(0b000, 1)).toEqual({ bases: 0b001, runs: 0 });
    expect(moveRunners(0b111, 1)).toEqual({ bases: 0b111, runs: 1 });
    expect(moveRunners(0b111, 4).runs).toBe(4);
    expect(moveRunners(0b100, 2)).toEqual({ bases: 0b010, runs: 1 });
  });

  it('the drawn strip is a distribution and its green mass is the win chance', () => {
    for (const k of TARGETS) {
      for (const s of allStates(k)) {
        const e = ending(s);
        expect(e.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
        expect(e[s.need]).toBe(winChance(s));
      }
    }
  });

  it('martingale: the average cash-out after one spin equals the cash-out now', () => {
    for (const k of TARGETS) {
      for (const s of allStates(k)) {
        let after = 0;
        for (const sector of WHEEL) {
          const r = step(s, sector);
          after += (r.kind === 'out' ? (r.over ? 0 : cashOut(k, r.state)) : r.won ? prize(k) : cashOut(k, r.state)) / WHEEL.length;
        }
        expect(after).toBeCloseTo(cashOut(k, s), 12);
      }
    }
  });

  it('winning chance matches a direct simulation of the raw inning', () => {
    for (const k of [1, 3, 6]) {
      const n = 100_000;
      let wins = 0;
      for (let i = 0; i < n; i++) {
        let s = startState(k);
        for (;;) {
          const r = step(s, WHEEL[rng.int(12)]);
          if (r.kind === 'out' && r.over) break;
          if (r.kind === 'hit' && r.won) {
            wins++;
            break;
          }
          s = r.state;
        }
      }
      const p = winChance(startState(k));
      expect(Math.abs(wins / n - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / n));
    }
  });

  it('simulated RTP matches the manifest under random stopping', () => {
    for (const r of runEval(evalSpec, { rounds: 60_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
      expect(r.p99Steps).toBeLessThanOrEqual(30);
    }
    expect(RTP).toBe(0.99);
  });
});
