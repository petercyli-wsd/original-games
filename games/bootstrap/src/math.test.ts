import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  KMAX,
  MAX_MULTIPLIER,
  RTP,
  SEEDS,
  SIZES,
  addSeed,
  allMask,
  allSettings,
  budget,
  cashOut,
  closure,
  falling,
  fullSequences,
  nextSeed,
  pFull,
  pWin,
  perimeter,
  popcount,
  prizeFor,
  startChance,
  wave,
  waves,
  type Size,
  type State,
} from './math';

const rng = createRng(seededSource(11));

/** Plain cell-by-cell bootstrap closure, as a reference for the bitmask version. */
function slowClosure(S: number, n: number): number {
  const inf = Array.from({ length: n * n }, (_, i) => (S >> i) & 1);
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < n * n; i++) {
      if (inf[i]) continue;
      const r = Math.floor(i / n);
      const c = i % n;
      const nb = (r > 0 ? inf[i - n] : 0) + (r < n - 1 ? inf[i + n] : 0) + (c > 0 ? inf[i - 1] : 0) + (c < n - 1 ? inf[i + 1] : 0);
      if (nb >= 2) {
        inf[i] = 1;
        changed = true;
      }
    }
  }
  return inf.reduce((m, v, i) => m | (v << i), 0);
}

const toMask = (cells: number[]) => cells.reduce((m, i) => m | (1 << i), 0);

function randomSubset(n: number, k: number): number[] {
  const cells = Array.from({ length: n * n }, (_, i) => i);
  for (let i = 0; i < k; i++) {
    const j = i + rng.int(cells.length - i);
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  return cells.slice(0, k);
}

/** Every k-subset of N items, as bitmasks. */
function* subsets(N: number, k: number, from = 0, acc = 0): Generator<number> {
  if (k === 0) {
    yield acc;
    return;
  }
  for (let i = from; i <= N - k; i++) yield* subsets(N, k - 1, i + 1, acc | (1 << i));
}

/** A random reachable state after a seeds. */
function randomState(n: Size, a: number): State {
  let st: State = { seeds: [], C: 0 };
  while (st.seeds.length < a) st = addSeed(st, nextSeed(st, n, rng.next()), n);
  return st;
}

describe('Bootstrap maths', () => {
  it('the bitmask closure matches a plain cell-by-cell closure', () => {
    for (const n of SIZES) {
      for (let t = 0; t < 400; t++) {
        const S = toMask(randomSubset(n, 1 + rng.int(9)));
        expect(closure(S, n)).toBe(slowClosure(S, n));
        expect(waves(S, n).reduce((m, w) => m | w, S)).toBe(closure(S, n));
      }
    }
  });

  it('perimeter theorem: spreading never grows the perimeter, a seed adds at most 4, the full grid has 4n', () => {
    for (const n of SIZES) {
      expect(perimeter(allMask(n), n)).toBe(4 * n);
      for (let t = 0; t < 300; t++) {
        let S = toMask(randomSubset(n, 1 + rng.int(8)));
        for (let w = wave(S, n); w; w = wave(S, n)) {
          // Add the wave one cell at a time: each joining cell has ≥ 2 infected neighbours.
          for (let i = 0; i < n * n; i++) {
            if (!(w & (1 << i))) continue;
            const before = perimeter(S, n);
            S |= 1 << i;
            expect(perimeter(S, n)).toBeLessThanOrEqual(before);
          }
        }
        expect(perimeter(S | (1 << rng.int(n * n)), n)).toBeLessThanOrEqual(perimeter(S, n) + 4);
      }
    }
  });

  it('exact P(full) at the start matches brute force over every seed set', () => {
    const count = (n: Size, k: number) => {
      let full = 0;
      let total = 0;
      for (const S of subsets(n * n, k)) {
        total++;
        if (closure(S, n) === allMask(n)) full++;
      }
      return full / total;
    };
    for (const k of SEEDS[4]) expect(pFull(0, 0, 4, k)).toBeCloseTo(count(4, k), 14);
    for (const k of [5, 6]) expect(pFull(0, 0, 5, k)).toBeCloseTo(count(5, k), 14);
    // Fewer than n seeds can never fill the grid.
    expect(count(5, 4)).toBe(0);
  });

  it('live P(full) matches brute force over the remaining seeds at random states', () => {
    for (let t = 0; t < 40; t++) {
      const n: Size = rng.next() < 0.5 ? 4 : 5;
      const k = SEEDS[n][rng.int(SEEDS[n].length)];
      const a = Math.max(1, k - (n === 5 ? 1 + rng.int(5) : 1 + rng.int(k - 1)));
      const st = randomState(n, a);
      const free: number[] = [];
      for (let i = 0; i < n * n; i++) if (!st.seeds.includes(i)) free.push(i);
      let full = 0;
      let total = 0;
      for (const B of subsets(free.length, k - a)) {
        let S = st.C;
        for (let j = 0; j < free.length; j++) if (B & (1 << j)) S |= 1 << free[j];
        total++;
        if (closure(S, n) === allMask(n)) full++;
      }
      expect(pFull(st.C, a, n, k)).toBeCloseTo(full / total, 12);
    }
  });

  it('the raw process (all seeds at once, spread at the end) fills as often as the formula says', () => {
    const cases: [Size, number][] = [
      [4, 5],
      [5, 6],
      [5, 9],
    ];
    for (const [n, k] of cases) {
      const rounds = 20000;
      let full = 0;
      for (let r = 0; r < rounds; r++) if (slowClosure(toMask(randomSubset(n, k)), n) === allMask(n)) full++;
      const p = pFull(0, 0, n, k);
      expect(Math.abs(full / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds));
    }
  });

  it('counts are exact integers below 2^53', () => {
    for (const n of SIZES) {
      expect(falling(n * n, KMAX[n])).toBeLessThan(2 ** 53);
      for (const k of SEEDS[n]) expect(Number.isInteger(fullSequences(0, 0, n, k))).toBe(true);
    }
  });

  it('each seed is a fair bet: E[cash-out after] = cash-out before, wasted seeds included', () => {
    for (const s of allSettings()) {
      for (let t = 0; t < 12; t++) {
        const a = rng.int(s.k);
        const st = randomState(s.n, a);
        const before = cashOut(s, st.C, a);
        const free: number[] = [];
        for (let i = 0; i < s.n * s.n; i++) if (!st.seeds.includes(i)) free.push(i);
        const after = free.reduce((sum, cell) => sum + cashOut(s, addSeed(st, cell, s.n).C, a + 1), 0) / free.length;
        expect(after).toBeCloseTo(before, 10);
      }
    }
  });

  it('the drawn odds are the true risk: split bar = P(full), and a short perimeter budget means Full is impossible', () => {
    for (const s of allSettings()) {
      expect(cashOut(s, 0, 0)).toBeCloseTo(RTP, 12);
      expect(pWin('full', 0, 0, s.n, s.k) + pWin('not', 0, 0, s.n, s.k)).toBeCloseTo(1, 14);
      for (let t = 0; t < 15; t++) {
        const a = rng.int(s.k + 1);
        const st = randomState(s.n, a);
        const p = pFull(st.C, a, s.n, s.k);
        expect(popcount(st.C)).toBeGreaterThanOrEqual(a);
        if (budget(st.C, s.k - a, s.n) < 4 * s.n) expect(p).toBe(0);
        if (st.C === allMask(s.n)) expect(p).toBe(1);
        if (a === s.k) expect(p).toBe(st.C === allMask(s.n) ? 1 : 0);
      }
    }
  });

  it('prizes are within the manifest bound and win chances span at least 25:1', () => {
    const ps = allSettings().map(startChance);
    expect(Math.max(...ps) / Math.min(...ps)).toBeGreaterThan(25);
    for (const s of allSettings()) expect(prizeFor(s)).toBeLessThanOrEqual(MAX_MULTIPLIER);
    expect(manifest.maxMultiplier).toBe(MAX_MULTIPLIER);
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
