import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import { BOARDS, CASES, MAX_MULTIPLIER, PRIZES, RTP, deal, mean, pays, profitCount, sealedOthers, sealedPrizes, shuffle, without } from './math';

const rng = createRng(seededSource(11));

describe('Banker boards', () => {
  it('have 16 prizes, ascending, averaging exactly 1', () => {
    for (const b of BOARDS) {
      expect(PRIZES[b]).toHaveLength(CASES);
      expect(mean(PRIZES[b])).toBeCloseTo(1, 12);
      for (let i = 1; i < CASES; i++) expect(PRIZES[b][i]).toBeGreaterThan(PRIZES[b][i - 1]);
    }
  });
  it('the SD of the payout differs by at least 5x between Flat and Classic', () => {
    const sd = (b: 'flat' | 'classic') => Math.sqrt(mean(PRIZES[b].map((p) => (pays(p) - RTP) ** 2)));
    expect(sd('classic') / sd('flat')).toBeGreaterThan(5);
  });
  it('the drawn count of bars above the bet is the true chance of profit', () => {
    // Flat: exact count by enumeration over which prize is in your case.
    for (const b of BOARDS) {
      const direct = PRIZES[b].filter((p) => RTP * p > 1).length;
      expect(profitCount(PRIZES[b])).toBe(direct);
    }
    const n = 200_000;
    let hit = 0;
    for (let i = 0; i < n; i++) if (pays(shuffle(PRIZES.classic, (k) => rng.int(k))[0]) > 1) hit++;
    const p = profitCount(PRIZES.classic) / CASES;
    expect(Math.abs(hit / n - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / n));
  });
});

describe('Banker martingale', () => {
  it('E[Deal after the next case] = Deal now, exactly, at every opening count', () => {
    for (const b of BOARDS) {
      for (let trial = 0; trial < 30; trial++) {
        const cases = shuffle(PRIZES[b], (k) => rng.int(k));
        const opened: number[] = [];
        const steps = 1 + rng.int(CASES - 2);
        for (let s = 0; s < steps; s++) {
          const left = sealedOthers(opened);
          opened.push(left[rng.int(left.length)]);
        }
        const sealed = sealedPrizes(cases, opened);
        // Your case is unknown to the player, so the next prize struck is uniform among all the sealed ones.
        let e = 0;
        for (const p of sealed) e += deal(without(sealed, p)) / sealed.length;
        expect(e).toBeCloseTo(deal(sealed), 12);
      }
    }
  });
  it('the last other case: Deal before it is the mean of two, payout after is the one left', () => {
    const cases = shuffle(PRIZES.classic, (k) => rng.int(k));
    const opened = sealedOthers([]).slice(0, CASES - 2);
    const left = sealedOthers(opened);
    expect(left).toHaveLength(1);
    expect(deal(sealedPrizes(cases, opened))).toBeCloseTo(RTP * (cases[0] + cases[left[0]]) / 2, 12);
  });
});

describe('Banker eval', () => {
  it('returns RTP within 4 SE and stays under the manifest max', () => {
    expect(MAX_MULTIPLIER).toBe(manifest.maxMultiplier);
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - RTP)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier + 1e-9);
      expect(r.p99Steps).toBeLessThanOrEqual(30);
    }
  });
});
