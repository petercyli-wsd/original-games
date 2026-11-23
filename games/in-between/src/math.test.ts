import { createRng, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import { F, MAX_MULTIPLIER, RTP, SLOTS, binom, chooseSlot, dealPosts, drawNumber, emptyRow, fitCount, fitsMask, legalSlots, place, rowChance, slotScore, startChance, type Row } from './math';
import { runEval } from '@originals/game-sdk';

/** Brute force: best chance of filling the row, trying every number and every legal slot (small universe). */
function brute(row: Row, size: number, memo = new Map<string, number>()): number {
  const free = row.filter((v) => v === null).length;
  if (free === 0) return 1;
  const key = row.join(',');
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  const used = new Set(row.filter((v): v is number => v !== null));
  let total = 0;
  let n = 0;
  for (let x = 1; x <= size; x++) {
    if (used.has(x)) continue;
    n++;
    let best = 0;
    for (const s of legalSlots(row, x)) best = Math.max(best, brute(place(row, s, x), size, memo));
    total += best;
  }
  const r = total / n;
  memo.set(key, r);
  return r;
}

describe('exact chances', () => {
  it('start chances match the published table', () => {
    const want = [0.3401, 0.1311, 0.05615, 0.02564, 0.01226];
    SLOTS.forEach((m, i) => expect(startChance(m)).toBeCloseTo(want[i]!, 4));
  });

  it('the closed form equals brute-force best play on small universes', () => {
    for (const [size, a, b, m] of [[12, 2, 11, 3], [14, 1, 13, 4], [10, 3, 9, 2], [13, 2, 12, 5], [9, 1, 9, 3]] as const) {
      const row = emptyRow(a, b, m);
      expect(rowChance(row, size)).toBeCloseTo(brute(row, size), 10);
    }
  });

  it('the best slot attains the brute-force value, the worst does not beat it', () => {
    const size = 12;
    const row = place(emptyRow(1, 12, 4), 2, 6);
    for (let x = 2; x <= 11; x++) {
      if (x === 6) continue;
      const legal = legalSlots(row, x);
      if (legal.length === 0) continue;
      const vals = legal.map((s) => brute(place(row, s, x), size));
      const best = chooseSlot(row, x, 'best');
      expect(brute(place(row, best, x), size)).toBeCloseTo(Math.max(...vals), 10);
      const worst = chooseSlot(row, x, 'worst');
      expect(brute(place(row, worst, x), size)).toBeCloseTo(Math.min(...vals), 10);
    }
  });

  it('F(w, j) is a probability and zero when the gap is too small', () => {
    expect(F(3, 4)).toBe(0);
    expect(F(5, 1)).toBe(1);
    expect(binom(98, 2)).toBe(4753);
    expect(slotScore(place(emptyRow(1, 20, 3), 2, 10), 1, 5)).toBeGreaterThan(0);
  });
});

describe('what the board shows is the true risk', () => {
  it('s of n counts the numbers that find a slot, and the green stretch is the same set', () => {
    const rng = createRng(seededSource(7));
    for (let t = 0; t < 40; t++) {
      const m = SLOTS[rng.int(5)]!;
      const { a, b } = dealPosts(rng, m);
      let row = emptyRow(a, b, m);
      for (let k = 0; k < rng.int(m + 1); k++) {
        const x = drawNumber(rng, row);
        const s = legalSlots(row, x);
        if (s.length === 0) break;
        row = place(row, s[rng.int(s.length)]!, x);
      }
      const { s, n } = fitCount(row);
      const used = new Set(row.filter((v): v is number => v !== null));
      let fits = 0;
      let und = 0;
      for (let x = 1; x <= 100; x++) {
        if (used.has(x)) continue;
        und++;
        if (legalSlots(row, x).length > 0) fits++;
      }
      expect(und).toBe(n);
      expect(fits).toBe(s);
      const mask = fitsMask(row);
      expect([...Array(100).keys()].filter((i) => mask[i + 1] && !used.has(i + 1)).length).toBe(s);
    }
  });

  it('posts always leave room for m numbers', () => {
    const rng = createRng(seededSource(3));
    for (let i = 0; i < 2000; i++) {
      const m = SLOTS[rng.int(5)]!;
      const { a, b } = dealPosts(rng, m);
      expect(a).toBeLessThan(b);
      expect(b - a - 1).toBeGreaterThanOrEqual(m);
    }
  });
});

describe('eval', () => {
  it('every config is within 4 SE of the manifest RTP and under the cap', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000, seed: 5 })) {
      expect(Math.abs(r.rtp - RTP)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier + 1e-9);
      expect(r.p99Steps).toBeLessThanOrEqual(5);
    }
    expect(MAX_MULTIPLIER).toBe(10_000);
  });
});
