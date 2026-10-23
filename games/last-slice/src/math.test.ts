import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  MAX_WIN,
  RTP,
  SHAPES,
  SLICE_COUNTS,
  countAlive,
  fullMask,
  has,
  landing,
  lastChanceIE,
  lastChances,
  maxStartPrize,
  nextEvents,
  relock,
  spinChances,
  startPrize,
  wheel,
  winChance,
} from './math';

const rng = createRng(seededSource(23));

/** A random reachable wheel state: some slices already out, at least two left. */
function randomMask(k: number): number {
  let mask = fullMask(k);
  const out = rng.int(k - 1);
  for (let i = 0; i < out; i++) {
    const alive = Array.from({ length: k }, (_, j) => j).filter((j) => has(mask, j));
    mask &= ~(1 << alive[rng.int(alive.length)]);
  }
  return mask;
}

describe('Last Slice maths', () => {
  it('the spin recursion matches Plackett–Luce inclusion–exclusion, and sums to 1', () => {
    for (const k of SLICE_COUNTS)
      for (const s of SHAPES) {
        const w = wheel(k, s);
        expect(w.length).toBe(k);
        for (let t = 0; t < 12; t++) {
          const mask = t === 0 ? fullMask(k) : randomMask(k);
          const p = lastChances(w, mask);
          expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
          for (let i = 0; i < k; i++) expect(p[i]).toBeCloseTo(lastChanceIE(w, mask, i), 12);
        }
      }
  });

  it('two slices left: the other one is hit first with its share of the wheel', () => {
    const w = wheel(6, 'mixed');
    const mask = (1 << 1) | (1 << 4);
    expect(winChance(w, mask, 1)).toBeCloseTo(w[4] / (w[1] + w[4]), 14);
  });

  it('smaller slices are always likelier to be last', () => {
    for (const k of SLICE_COUNTS)
      for (const s of SHAPES) {
        const w = wheel(k, s);
        const p = lastChances(w, fullMask(k));
        for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) if (w[i] < w[j]) expect(p[i]).toBeGreaterThan(p[j]);
      }
  });

  it('the start odds match a direct simulation of the raw wheel', () => {
    const cases: [(typeof SLICE_COUNTS)[number], (typeof SHAPES)[number]][] = [
      [5, 'mixed'],
      [6, 'even'],
      [8, 'steep'],
    ];
    for (const [k, s] of cases) {
      const w = wheel(k, s);
      const rounds = 40_000;
      const last = new Array<number>(k).fill(0);
      for (let r = 0; r < rounds; r++) {
        // The raw process: pick a remaining slice with chance ∝ size, remove it.
        const alive = Array.from({ length: k }, (_, i) => i);
        while (alive.length > 1) {
          const W = alive.reduce((a, i) => a + w[i], 0);
          let x = rng.next() * W;
          let pick = alive.length - 1;
          for (let j = 0; j < alive.length; j++) {
            if (x < w[alive[j]]) {
              pick = j;
              break;
            }
            x -= w[alive[j]];
          }
          alive.splice(pick, 1);
        }
        last[alive[0]]++;
      }
      const p = lastChances(w, fullMask(k));
      for (let i = 0; i < k; i++) expect(Math.abs(last[i] / rounds - p[i])).toBeLessThan(4 * Math.sqrt((p[i] * (1 - p[i])) / rounds) + 1e-9);
    }
  });

  it('martingale: the next spin’s landings, weighted by slice angle, average back to the odds now', () => {
    for (const k of SLICE_COUNTS)
      for (const s of SHAPES) {
        const w = wheel(k, s);
        for (let t = 0; t < 20; t++) {
          const mask = randomMask(k);
          const alive = Array.from({ length: k }, (_, i) => i).filter((i) => has(mask, i));
          const mine = alive[rng.int(alive.length)];
          const ev = nextEvents(w, mask, mine);
          expect(ev.length).toBe(countAlive(mask));
          expect(ev.reduce((a, e) => a + e.prob, 0)).toBeCloseTo(1, 14);
          const now = winChance(w, mask, mine);
          expect(ev.reduce((a, e) => a + e.prob * e.win, 0)).toBeCloseTo(now, 12);
          const prize = startPrize(w, mine);
          expect(ev.reduce((a, e) => a + e.prob * prize * e.win, 0)).toBeCloseTo(prize * now, 9);
          // Losing a rival never hurts you; landing on yours ends it.
          for (const e of ev) if (e.slice === mine) expect(e.win).toBe(0);
          else expect(e.win).toBeGreaterThanOrEqual(now - 1e-12);
        }
      }
  });

  it('the drawn slice angles are the spin odds: sweeping the wheel lands on each slice that often', () => {
    for (const k of SLICE_COUNTS) {
      const w = wheel(k, 'steep');
      const mask = randomMask(k);
      const share = spinChances(w, mask);
      const N = 7_200;
      const hits = new Array<number>(k).fill(0);
      for (let i = 0; i < N; i++) {
        const { slice, within } = landing(w, mask, (i + 0.5) / N);
        expect(has(mask, slice)).toBe(true);
        expect(within >= 0 && within < 1).toBe(true);
        hits[slice]++;
      }
      for (let i = 0; i < k; i++) expect(Math.abs(hits[i] / N - share[i])).toBeLessThanOrEqual(1 / N + 1e-12);
      expect(share.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 14);
      expect(landing(w, mask, 0).slice).toBe(Array.from({ length: k }, (_, i) => i).find((i) => has(mask, i)));
    }
  });

  it('switching keeps the cash-out and relocks the prize fairly, within the cap', () => {
    for (let t = 0; t < 400; t++) {
      const k = SLICE_COUNTS[rng.int(SLICE_COUNTS.length)];
      const w = wheel(k, SHAPES[rng.int(SHAPES.length)]);
      const mask = randomMask(k);
      const cash = 0.05 + rng.next() * 20;
      const mine = rng.int(k);
      const prize = relock(cash, w, mask, mine);
      if (!has(mask, mine)) {
        expect(prize).toBeNull();
        continue;
      }
      const p = winChance(w, mask, mine);
      if (prize === null) expect(cash / p).toBeGreaterThan(MAX_WIN);
      else {
        expect(prize * p).toBeCloseTo(cash, 12);
        expect(prize).toBeLessThanOrEqual(MAX_WIN);
      }
    }
  });

  it('every fresh bet’s prize is under the cap', () => {
    expect(maxStartPrize()).toBeLessThanOrEqual(MAX_WIN);
    expect(manifest.maxMultiplier).toBe(MAX_WIN);
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
    expect(manifest.rtp).toBe(RTP);
  });
});
