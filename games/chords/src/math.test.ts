import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  RTP,
  TARGETS,
  afterClearChord,
  afterFirstEnd,
  allClear,
  catalan,
  clearChance,
  blockStarts,
  dart,
  doubleFactorial,
  faces,
  finishChance,
  finishChanceMid,
  inBlock,
  isClear,
  maxMultiplier,
  onArc,
  regionAt,
  regions,
  typicalClear,
  unroll,
  type Chord,
} from './math';

const rng = createRng(seededSource(11));

/** Rim point in the plane (clockwise from the top). */
const pt = (t: number) => [Math.sin(2 * Math.PI * t), -Math.cos(2 * Math.PI * t)] as const;
const orient = (p: readonly number[], q: readonly number[], r: readonly number[]) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
/** Plain segment intersection in the plane, independent of the rim-order logic in math.ts. */
function segmentsCross(c: Chord, d: Chord) {
  const [p1, p2, p3, p4] = [pt(c.a), pt(c.b), pt(d.a), pt(d.b)];
  return orient(p1, p2, p3) * orient(p1, p2, p4) < 0 && orient(p3, p4, p1) * orient(p3, p4, p2) < 0;
}
const planeClear = (chords: Chord[], c: Chord) => chords.every((d) => !segmentsCross(d, c));

/** A random reachable board: k chords that landed clear. */
function randomBoard(k: number): Chord[] {
  for (;;) {
    let chords: Chord[] = [];
    while (chords.length < k) {
      const c = { a: rng.next(), b: rng.next() };
      if (!isClear(chords, c.a, c.b)) break;
      chords = [...chords, c];
    }
    if (chords.length === k) return chords;
  }
}

// 24-point Gauss–Legendre on [0, 1]: exact for the polynomials in U below.
const GL = (() => {
  const n = 24;
  const nodes: number[] = [];
  const weights: number[] = [];
  for (let i = 1; i <= n; i++) {
    let x = Math.cos((Math.PI * (i - 0.25)) / (n + 0.5));
    let dp = 0;
    for (let it = 0; it < 100; it++) {
      let p0 = 1;
      let p1 = x;
      for (let k = 2; k <= n; k++) [p0, p1] = [p1, ((2 * k - 1) * x * p1 - (k - 1) * p0) / k];
      dp = (n * (x * p1 - p0)) / (x * x - 1);
      const dx = p1 / dp;
      x -= dx;
      if (Math.abs(dx) < 1e-15) break;
    }
    nodes.push((1 - x) / 2);
    weights.push(1 / ((1 - x * x) * dp * dp));
  }
  return { nodes, weights };
})();

describe('Chords maths', () => {
  it('N random chords never cross with chance Catalan(N)/(2N−1)!! = 2^N/(N+1)!', () => {
    for (let n = 1; n <= 10; n++) expect(allClear(n)).toBeCloseTo(catalan(n) / doubleFactorial(2 * n - 1), 14);
    expect(allClear(3)).toBeCloseTo(1 / 3, 14);
    // Direct simulation of the raw process with plane geometry.
    for (const n of TARGETS) {
      const rounds = 40_000;
      let wins = 0;
      for (let r = 0; r < rounds; r++) {
        const chords: Chord[] = [];
        let ok = true;
        while (ok && chords.length < n) {
          const c = { a: rng.next(), b: rng.next() };
          ok = planeClear(chords, c);
          chords.push(c);
        }
        if (ok) wins++;
      }
      const p = allClear(n);
      expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-4);
    }
  });

  it('the ladder before betting: chord k is clear with average chance 2/(k+1), whose product is the win chance', () => {
    let product = 1;
    for (let k = 1; k <= 8; k++) {
      expect(typicalClear(k)).toBeCloseTo(allClear(k) / allClear(k - 1), 14);
      product *= typicalClear(k);
      expect(product).toBeCloseTo(allClear(k), 14);
    }
    // E[Σ L² | k − 1 clear chords] over reachable boards.
    for (const k of [2, 3, 4, 5]) {
      const n = 4000;
      let sum = 0;
      let sq = 0;
      for (let i = 0; i < n; i++) {
        const S = clearChance(faces(randomBoard(k - 1)));
        sum += S;
        sq += S * S;
      }
      const mean = sum / n;
      const se = Math.sqrt((sq / n - mean * mean) / n);
      expect(Math.abs(mean - typicalClear(k))).toBeLessThan(4 * se);
    }
  });

  it('regions: c clear chords make c + 1 regions whose rim shares add up to 1', () => {
    for (let k = 0; k <= 7; k++) {
      for (let t = 0; t < 30; t++) {
        const chords = randomBoard(k);
        const rs = regions(chords);
        expect(rs.length).toBe(k + 1);
        expect(rs.reduce((s, r) => s + r.length, 0)).toBeCloseTo(1, 12);
        expect(new Set(rs.map((r) => r.slot)).size).toBe(k + 1);
        expect(new Set(rs.map((r) => r.tone)).size).toBe(k + 1);
        // Each chord split exactly one region: the new slot appears and old ones stay.
        if (k > 0) expect(regions(chords.slice(0, -1)).every((r) => rs.some((s) => s.slot === r.slot))).toBe(true);
      }
    }
  });

  it('the live chance to finish (generating function) matches simulation from the board', () => {
    expect(finishChance([1], 5)).toBeCloseTo(allClear(5), 14);
    for (let t = 0; t < 6; t++) {
      const k = 1 + rng.int(4);
      const left = 1 + rng.int(3);
      const board = randomBoard(k);
      const p = finishChance(
        faces(board).map((f) => f.length),
        left,
      );
      const rounds = 30_000;
      let wins = 0;
      for (let r = 0; r < rounds; r++) {
        let chords = board;
        let ok = true;
        for (let i = 0; ok && i < left; i++) {
          const c = { a: rng.next(), b: rng.next() };
          ok = planeClear(chords, c);
          chords = [...chords, c];
        }
        if (ok) wins++;
      }
      expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-4);
    }
  });

  it('each stage is a fair bet: E[cash-out after] = cash-out before', () => {
    for (let t = 0; t < 200; t++) {
      const board = randomBoard(1 + rng.int(7));
      const rs = regions(board);
      const S = clearChance(rs);
      const V = RTP * (1 + rng.next() * 50);
      // Stage 1: the first end lands in region r with chance L_r.
      const e1 = rs.reduce((s, r) => s + r.length * afterFirstEnd(V, S, r.length), 0);
      expect(Math.abs(e1 - V) / V).toBeLessThan(1e-12);
      // Stage 2: the second end lands in the same region with chance L_r.
      for (const r of rs) {
        const mid = afterFirstEnd(V, S, r.length);
        expect(Math.abs(r.length * afterClearChord(V, S) - mid) / V).toBeLessThan(1e-12);
        // Cauchy–Schwarz: never more than ×(regions) per chord.
        expect(afterClearChord(V, S)).toBeLessThanOrEqual(V * rs.length * (1 + 1e-12));
        expect(mid).toBeLessThanOrEqual(afterClearChord(V, S) * (1 + 1e-12));
      }
    }
  });

  it('the chance to finish is a martingale too (stage by stage, exact)', () => {
    for (let t = 0; t < 40; t++) {
      const board = randomBoard(1 + rng.int(5));
      const L = faces(board).map((f) => f.length);
      const k = 1 + rng.int(4);
      const before = finishChance(L, k);
      const stage1 = L.reduce((s, l, r) => s + l * finishChanceMid(L, r, k), 0);
      expect(Math.abs(stage1 - before)).toBeLessThan(1e-12);
      // Stage 2: lands in r with chance L_r and splits it at a uniform U.
      for (let r = 0; r < L.length; r++) {
        let integral = 0;
        GL.nodes.forEach((u, i) => {
          const split = [...L.filter((_, s) => s !== r), u * L[r], (1 - u) * L[r]];
          integral += GL.weights[i] * finishChance(split, k - 1);
        });
        expect(Math.abs(L[r] * integral - finishChanceMid(L, r, k))).toBeLessThan(1e-12);
      }
    }
  });

  it('the odds on screen are the true risk: rim colours, green arcs and the pairs square', () => {
    const M = 300;
    for (let t = 0; t < 12; t++) {
      const board = randomBoard(1 + rng.int(6));
      const rs = regions(board);
      const S = clearChance(rs);
      const starts = blockStarts(rs);
      // The diagonal squares tile [0, 1) along each axis, in display order.
      expect(starts[0]).toBe(0);
      expect(starts[rs.length - 1] + rs[rs.length - 1].length).toBeCloseTo(1, 12);
      let clear = 0;
      let greenWrong = 0;
      let dotWrong = 0;
      const hits = new Array<number>(rs.length).fill(0);
      for (let i = 0; i < M; i++) {
        const x = (i + 0.5) / M;
        const home = regionAt(board, x);
        // The unrolled rim is measure-preserving: region r fills exactly its block.
        const u = unroll(rs, board, x);
        const r = rs.indexOf(home);
        if (u >= starts[r] && u < starts[r] + home.length) hits[r]++;
        for (let j = 0; j < M; j++) {
          const y = (j + 0.37) / M;
          const ok = planeClear(board, { a: x, b: y });
          if (ok) clear++;
          // The green arcs (the first end's region) are exactly the clear landing spots.
          if (home.arcs.some((a) => onArc(y, a.start, a.length)) !== ok) greenWrong++;
          // The chord's dot lands in a diagonal square exactly when the chord is clear.
          const d = dart(rs, board, x, y);
          if (inBlock(rs, d.u, d.v!) !== ok || d.u < 0 || d.u >= 1 || d.v! < 0 || d.v! >= 1 || d.region !== r) dotWrong++;
        }
      }
      expect(greenWrong).toBe(0);
      expect(dotWrong).toBe(0);
      expect(hits.reduce((a, b) => a + b, 0)).toBe(M);
      // The squares' area Σ L² is the share of clear (first, second) pairs.
      // Grid error: each region boundary crossing costs at most one cell per row.
      expect(Math.abs(clear / (M * M) - S)).toBeLessThan((4 * (board.length + 1)) / M);
      // And per region: the rim share is what the sweep finds.
      rs.forEach((reg) => {
        let n = 0;
        for (let i = 0; i < 4000; i++) if (regionAt(board, (i + 0.5) / 4000) === reg) n++;
        expect(Math.abs(n / 4000 - reg.length)).toBeLessThan((2 * (board.length + 1)) / 4000);
      });
    }
  });

  it('simulated RTP matches the manifest under every sampled strategy', () => {
    expect(manifest.maxMultiplier).toBeCloseTo(maxMultiplier(8), 9);
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
