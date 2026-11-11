// Fairness audit: can any way of playing Banker beat the RTP?
//
// The only decision is when to take Deal (the board is locked while live).
// Deal = RTP x the mean of the sealed prizes, and the next case opened is
// uniform among the sealed prizes (yours is unknown), so the offer is a martingale. The exact
// check enumerates every possible next case at 30+ reachable states per board.
// Hostile strategies run on the real playRound(), per eval config.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import { BOARDS, CASES, PRIZES, RTP, deal, playRound, sealedOthers, sealedPrizes, shuffle, without, type BoardId } from './math';

const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 20_000);

type Stop = (openings: number, offer: number, sealed: number[]) => boolean;
const STRATEGIES: { name: string; stop: Stop }[] = [
  { name: '(a) deal at once', stop: () => true },
  { name: '(b) take any profit', stop: (_, o) => o > 1 },
  { name: '(c) play to the last case', stop: () => false },
  { name: '(d) deal when the offer falls', stop: (_, o) => o < 0.9 },
  { name: '(e) chase while a bar above 3x is lit', stop: (_, __, s) => !s.some((p) => 0.99 * p > 3) },
];

function mc(play: (rng: Rng) => number, rounds: number, seed: number) {
  const rng = createRng(seededSource(seed));
  let s = 0, s2 = 0, max = 0;
  for (let i = 0; i < rounds; i++) {
    const x = play(rng);
    s += x; s2 += x * x;
    if (x > max) max = x;
  }
  const mean = s / rounds;
  return { mean, se: Math.sqrt(Math.max(0, s2 / rounds - mean * mean) / rounds), max };
}

describe('Banker fairness', () => {
  it('martingale (exact): at 30+ reachable states per board, the mean offer after the next case equals the offer now', () => {
    const rng = createRng(seededSource(2024));
    for (const b of BOARDS) {
      for (let t = 0; t < 40; t++) {
        const cases = shuffle(PRIZES[b], (k) => rng.int(k));
        const opened: number[] = [];
        for (let s = rng.int(CASES - 2); s > 0; s--) {
          const left = sealedOthers(opened);
          opened.push(left[rng.int(left.length)]);
        }
        const sealed = sealedPrizes(cases, opened);
        // Which sealed prize is in your case is unknown, so the next one struck is uniform over all of them.
        const e = sealed.reduce((a, p) => a + deal(without(sealed, p)), 0) / sealed.length;
        expect(Math.abs(e - deal(sealed))).toBeLessThan(1e-12);
      }
    }
  });

  it('strategies (a)-(e) on every eval config return RTP within 4 SE, never above the manifest max', () => {
    const rows: string[] = [];
    evalSpec.configs.forEach(({ label, params }, ci) => {
      const board = (params as { board: BoardId }).board;
      STRATEGIES.forEach(({ name, stop }, si) => {
        const { mean, se, max } = mc((r) => playRound(board, (n) => r.int(n), stop).multiplier, ROUNDS, 700 + 13 * ci + si);
        rows.push(`${label.padEnd(24)} ${name.padEnd(40)} ${(mean * 100).toFixed(2)}% +- ${(se * 100).toFixed(2)}%  max ${max.toFixed(2)}x`);
        expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-9);
        expect(max).toBeLessThanOrEqual(manifest.maxMultiplier + 1e-9);
      });
    });
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
