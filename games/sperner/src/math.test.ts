import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  BETS,
  MAX_MULTIPLIER,
  RTP,
  SIZES,
  betWins,
  cashValue,
  chances,
  countColumns,
  decided,
  finalDistribution,
  freshColours,
  geometry,
  isOffered,
  nextSwing,
  nextVertex,
  orientation,
  paint,
  prizeFor,
  rainbows,
  rowRest,
  startChance,
  winChance,
  type Bet,
} from './math';

const rng = createRng(seededSource(19));

// ---------- An independent model of the raw process ----------

/** Allowed colours, written out again from the rules (not taken from math.ts). */
function allowedRaw(m: number, i: number, j: number): number[] {
  const top = i === 0;
  const left = j === 0;
  const right = j === i;
  const bottom = i === m;
  if (top) return [0];
  if (bottom && left) return [1];
  if (bottom && right) return [2];
  if (bottom) return [1, 2];
  if (left) return [0, 1];
  if (right) return [0, 2];
  return [0, 1, 2];
}

const key = (i: number, j: number) => `${i},${j}`;

/** Every small triangle as three (i, j) corners. */
function smallTriangles(m: number): [number, number][][] {
  const out: [number, number][][] = [];
  for (let i = 0; i < m; i++) {
    for (let j = 0; j <= i; j++) out.push([[i, j], [i + 1, j], [i + 1, j + 1]]);
    for (let j = 0; j < i; j++) out.push([[i, j], [i, j + 1], [i + 1, j + 1]]);
  }
  return out;
}

function countDirect(m: number, colour: Map<string, number>): number {
  let n = 0;
  for (const t of smallTriangles(m)) {
    const set = new Set(t.map(([i, j]) => colour.get(key(i, j))));
    if (set.size === 3 && !set.has(undefined)) n++;
  }
  return n;
}

function randomRaw(m: number): Map<string, number> {
  const colour = new Map<string, number>();
  for (let i = 0; i <= m; i++) {
    for (let j = 0; j <= i; j++) {
      const a = allowedRaw(m, i, j);
      colour.set(key(i, j), a[rng.int(a.length)]);
    }
  }
  return colour;
}

/** The game's colour array as an (i, j) map. */
function toMap(m: number, colours: readonly number[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const v of geometry(m).vertices) if (colours[v.id] >= 0) out.set(key(v.i, v.j), colours[v.id]);
  return out;
}

/** Exact final-count distribution by enumerating every completion of a board. */
function enumerate(m: number, colours: readonly number[]): Map<number, number> {
  const free = geometry(m).vertices.filter((v) => colours[v.id] < 0);
  const base = toMap(m, colours);
  const out = new Map<number, number>();
  const go = (k: number, w: number) => {
    if (k === free.length) {
      const n = countDirect(m, base);
      out.set(n, (out.get(n) ?? 0) + w);
      return;
    }
    const v = free[k];
    const a = allowedRaw(m, v.i, v.j);
    for (const c of a) {
      base.set(key(v.i, v.j), c);
      go(k + 1, w / a.length);
    }
    base.delete(key(v.i, v.j));
  };
  go(0, 1);
  return out;
}

/** A reachable board: the first `n` vertices of the reveal order coloured at random. */
function randomBoard(m: number, n: number): number[] {
  let c = freshColours(m);
  for (const v of geometry(m).order.slice(0, n)) {
    const a = geometry(m).vertices[v].allowed;
    c = paint(c, v, a[rng.int(a.length)]);
  }
  return c;
}

const offered = SIZES.flatMap((m) => BETS.filter((b) => isOffered(m, b)).map((bet) => ({ m, bet })));

describe('Sperner maths', () => {
  it("Sperner's lemma: the rainbow count is always odd, and forward minus reversed rainbows is exactly 1", () => {
    for (const m of [3, 4, 5, 6]) {
      for (let trial = 0; trial < 1500; trial++) {
        const colours = randomBoard(m, Infinity);
        const n = rainbows(m, colours).length;
        expect(n % 2).toBe(1);
        expect(n).toBe(countDirect(m, toMap(m, colours)));
        expect(geometry(m).tris.reduce((s, t) => s + orientation(colours, t), 0)).toBe(1);
      }
    }
  });

  it('the transfer DP matches exhaustive enumeration of every colouring', () => {
    for (const m of [3, 4]) {
      const exact = enumerate(m, freshColours(m));
      const dp = finalDistribution(m, freshColours(m));
      for (let k = 0; k < dp.length; k++) expect(dp[k]).toBeCloseTo(exact.get(k) ?? 0, 13);
    }
    // 9 triangles: 108 / 72 / 12 of the 192 colourings give 1 / 3 / 5 rainbows.
    expect(startChance(3, 1)).toBeCloseTo(9 / 16, 14);
    expect(startChance(3, 5)).toBeCloseTo(1 / 16, 14);
    // 16 triangles: 9+ rainbows in 24 of the 13,824 colourings: the largest prize.
    expect(startChance(4, 9)).toBeCloseTo(24 / 13824, 15);
    expect(MAX_MULTIPLIER).toBeCloseTo(RTP * 576, 9);
    for (const { m, bet } of offered) expect(prizeFor(m, bet)).toBeLessThanOrEqual(MAX_MULTIPLIER + 1e-9);
  });

  it('the start win chance matches a direct simulation of random colourings (4 SE)', () => {
    for (const m of SIZES) {
      const rounds = 20000;
      const counts = Array.from({ length: rounds }, () => countDirect(m, randomRaw(m)));
      for (const bet of BETS.filter((b) => isOffered(m, b))) {
        const p = startChance(m, bet);
        const hits = counts.filter((n) => betWins(bet, n)).length;
        expect(Math.abs(hits / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-4);
      }
    }
  });

  it('live odds are exact at random mid-round boards (vs enumerating every completion)', () => {
    for (const m of [4, 5] as const) {
      const order = geometry(m).order;
      for (let trial = 0; trial < 14; trial++) {
        const n = (m === 5 ? 5 : 1) + rng.int(order.length - (m === 5 ? 5 : 1));
        const colours = randomBoard(m, n);
        const exact = enumerate(m, colours);
        const dp = finalDistribution(m, colours);
        for (let k = 0; k < dp.length; k++) expect(dp[k]).toBeCloseTo(exact.get(k) ?? 0, 12);
        for (const bet of BETS.filter((b) => isOffered(m, b))) {
          let p = 0;
          for (const [k, w] of exact) if (betWins(bet, k)) p += w;
          expect(winChance(m, bet, colours)).toBeCloseTo(p, 12);
        }
      }
    }
  });

  it('each reveal is a fair bet: E[cash-out after] = cash-out before (one vertex or a whole row)', () => {
    for (const { m, bet } of offered) {
      const order = geometry(m).order;
      for (let trial = 0; trial < 25; trial++) {
        const colours = randomBoard(m, rng.int(order.length));
        const before = cashValue(m, bet, colours);
        // One vertex.
        const v = nextVertex(m, colours)!;
        const a = geometry(m).vertices[v].allowed;
        const after = a.reduce((s, c) => s + cashValue(m, bet, paint(colours, v, c)), 0) / a.length;
        expect(after).toBeCloseTo(before, 11);
        // The rest of the row, every colouring of it equally likely.
        let boards = [colours];
        for (const u of rowRest(m, colours)) boards = boards.flatMap((b) => geometry(m).vertices[u].allowed.map((c) => paint(b, u, c)));
        const burst = boards.reduce((s, b) => s + cashValue(m, bet, b), 0) / boards.length;
        expect(burst).toBeCloseTo(before, 11);
      }
    }
    // The start is worth exactly RTP.
    for (const { m, bet } of offered) expect(cashValue(m, bet, freshColours(m))).toBeCloseTo(RTP, 12);
  });

  it('the bars, the found count and the next-vertex chips are the true odds', () => {
    for (const { m, bet } of offered) {
      const order = geometry(m).order;
      for (let trial = 0; trial < 30; trial++) {
        const colours = randomBoard(m, rng.int(order.length + 1));
        const dist = finalDistribution(m, colours);
        const cols = countColumns(m, bet, dist);
        const p = winChance(m, bet, colours);
        expect(cols.reduce((s, c) => s + c.p, 0)).toBeCloseTo(1, 12);
        expect(cols.filter((c) => c.win).reduce((s, c) => s + c.p, 0)).toBeCloseTo(p, 12);
        // Every bar is wholly a win or wholly a loss.
        for (const c of cols) for (let k = c.from; k <= c.to; k++) if (dist[k] > 0) expect(betWins(bet, k)).toBe(c.win);
        // Rainbows found never go away, and the count is odd.
        const found = rainbows(m, colours).length;
        for (let k = 0; k < dist.length; k++) if (k < found || k % 2 === 0) expect(dist[k]).toBe(0);
        // Parity: two rainbows force a third, so "exactly 1" is lost and "k+" is won at k − 1.
        const d = decided(chances(m, bet, colours));
        if (bet === 1 && found >= 2) expect(d).toBe('lost');
        if (bet !== 1 && found >= (bet as Bet) - 1) expect(d).toBe('won');
        if (d === 'won') expect(p).toBe(1);
        if (d === 'lost') expect(p).toBe(0);
        // The chips under the bars average to the chance now.
        const swing = nextSwing(m, bet, colours);
        if (swing) expect(swing.options.reduce((s, o) => s + o.p, 0) / swing.options.length).toBeCloseTo(p, 12);
      }
    }
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
