import { createRng, runEval, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  BOARDS,
  BOARD_IDS,
  MAX_WIN,
  RTP,
  afterSafePick,
  countTriangleFree,
  discSectors,
  edgeOdds,
  emptyColouring,
  ending,
  fatalMask,
  graph,
  isOffered,
  landingTurn,
  maxWin,
  monoTriangle,
  popcount,
  randomEdgeSafe,
  type BoardSpec,
} from './math';

const rng = createRng(seededSource(11));

/** A random state reached by safe random picks (the colouring and its cash-out). */
function randomState(board: BoardSpec, r: Rng, maxPicks: number) {
  const col = emptyColouring(board.n);
  let cash = RTP;
  const picks = r.int(maxPicks + 1);
  for (let i = 0; i < picks && !ending(board, col, cash); i++) {
    const offered = edgeOdds(board, col, cash).filter(isOffered);
    const o = offered[r.int(offered.length)];
    const safe = [...Array(board.colours).keys()].filter((k) => !((o.mask >> k) & 1));
    col[o.edge] = safe[r.int(safe.length)];
    cash = afterSafePick(cash, o.q);
  }
  return { col, cash };
}

/** Plays random picks until the round ends, with the game's own rules. True if it never busts. */
function survivesRandomPicks(board: BoardSpec, r: Rng) {
  const col = emptyColouring(board.n);
  let cash = RTP;
  while (!ending(board, col, cash)) {
    const offered = edgeOdds(board, col, cash).filter(isOffered);
    const o = offered[r.int(offered.length)];
    const k = r.int(board.colours);
    if ((o.mask >> k) & 1) return false;
    col[o.edge] = k;
    cash = afterSafePick(cash, o.q);
  }
  return true;
}

/** Exact P(survive to the end | uniform random picks), by DP over colourings (2 colours, small boards). */
function exactRandomSurvival(board: BoardSpec): number {
  const memo = new Map<string, number>();
  const rec = (col: number[], cash: number): number => {
    if (ending(board, col, cash)) return 1;
    const key = col.join(',');
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const offered = edgeOdds(board, col, cash).filter(isOffered);
    let p = 0;
    for (const o of offered) {
      for (let k = 0; k < board.colours; k++) {
        if ((o.mask >> k) & 1) continue;
        const next = col.slice();
        next[o.edge] = k;
        p += rec(next, afterSafePick(cash, o.q)) / board.colours / offered.length;
      }
    }
    memo.set(key, p);
    return p;
  };
  return rec(emptyColouring(board.n), RTP);
}

/** Most risky edges any round can survive (exhaustive, base-(c+1) memo), and whether a full board is reachable. */
function exhaustiveMaxRisky(n: number, c: number) {
  const g = graph(n);
  const m = g.edges.length;
  const pw: number[] = [];
  let size = 1;
  for (let k = 0; k < m; k++, size *= c + 1) pw.push(size);
  const memo = new Int8Array(size).fill(-1);
  const col = emptyColouring(n);
  const full = (1 << c) - 1;
  let fullReached = false;
  const rec = (key: number, coloured: number): number => {
    if (memo[key] >= 0) return memo[key];
    if (coloured === m) fullReached = true;
    let best = 0;
    for (let e = 0; e < m; e++) {
      if (col[e] >= 0) continue;
      const mask = fatalMask(g, col, e);
      if (mask === full) continue;
      for (let k = 0; k < c; k++) {
        if ((mask >> k) & 1) continue;
        col[e] = k;
        best = Math.max(best, (mask ? 1 : 0) + rec(key + (k + 1) * pw[e], coloured + 1));
        col[e] = -1;
      }
    }
    memo[key] = best;
    return best;
  };
  return { maxRisky: rec(0, 0), fullReached };
}

describe('Ramsey maths', () => {
  it('counts the triangle-free colourings: K5 has exactly the 12 pentagon splits, K6 has none (R(3,3) = 6)', () => {
    expect(countTriangleFree(3, 2)).toBe(6);
    expect(countTriangleFree(4, 2)).toBe(18);
    expect(countTriangleFree(5, 2)).toBe(12); // 4!/2 Hamiltonian 5-cycles, each with its pentagram complement
    expect(countTriangleFree(6, 2)).toBe(0); // Ramsey
    expect(countTriangleFree(4, 3)).toBe(450);
  });

  it('a raw random colouring avoids one-colour triangles exactly as often as the count says', () => {
    for (const [n, c] of [
      [4, 2],
      [5, 2],
      [6, 2],
      [5, 3],
    ] as const) {
      const g = graph(n);
      const p = countTriangleFree(n, c) / c ** g.edges.length;
      const rounds = 20_000;
      let clean = 0;
      for (let r = 0; r < rounds; r++) {
        const col = g.edges.map(() => rng.int(c));
        if (!monoTriangle(g, col)) clean++;
      }
      expect(Math.abs(clean / rounds - p)).toBeLessThanOrEqual(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-9);
    }
  });

  it('playing random picks to the lock survives exactly as often as the exact recursion says', () => {
    for (const id of ['k4', 'k5'] as const) {
      const board = BOARDS[id];
      const p = exactRandomSurvival(board);
      const rounds = 20_000;
      let wins = 0;
      for (let r = 0; r < rounds; r++) if (survivesRandomPicks(board, rng)) wins++;
      expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds));
    }
  });

  it('every pick is a fair bet: E[cash-out after] = cash-out now, whichever edge is chosen', () => {
    for (const id of BOARD_IDS) {
      const board = BOARDS[id];
      for (let trial = 0; trial < 150; trial++) {
        const { col, cash } = randomState(board, rng, 12);
        if (ending(board, col, cash)) continue;
        for (const o of edgeOdds(board, col, cash).filter(isOffered)) {
          let expected = 0;
          for (let k = 0; k < board.colours; k++) if (!((o.mask >> k) & 1)) expected += afterSafePick(cash, o.q) / board.colours;
          expect(expected).toBeCloseTo(cash, 9);
          expect(o.factor).toBeCloseTo(1 / (1 - o.q), 12);
        }
      }
    }
  });

  it('the max-win cap only removes picks: nothing offered can pay above MAX_WIN', () => {
    const board = BOARDS.k8;
    for (const cash of [900, 3000, 3400, 5000, 6600, 6700, 9000]) {
      for (let trial = 0; trial < 40; trial++) {
        const { col } = randomState(board, rng, 14);
        for (const o of edgeOdds(board, col, cash)) {
          if (isOffered(o)) expect(cash * o.factor).toBeLessThanOrEqual(MAX_WIN * (1 + 1e-12));
          if (o.state === 'capped') expect(cash * o.factor).toBeGreaterThan(MAX_WIN);
        }
        if (cash * 1.5 > MAX_WIN) expect(ending(board, col, cash)).toBe(col.every((x) => x >= 0) ? 'full' : 'cap');
      }
    }
  });

  it('the red slices on each disc are exactly the colours that close a one-colour triangle', () => {
    for (const id of BOARD_IDS) {
      const board = BOARDS[id];
      const g = graph(board.n);
      for (let trial = 0; trial < 120; trial++) {
        const { col, cash } = randomState(board, rng, 16);
        const odds = edgeOdds(board, col, cash);
        let pairs = 0;
        let safePairs = 0;
        for (const o of odds) {
          if (o.state === 'coloured') continue;
          const sectors = discSectors(board.colours, o.mask);
          // The red share of the disc is the bust chance.
          const red = sectors.filter((s) => s.fatal).reduce((t, s) => t + (s.end - s.start), 0);
          expect(red).toBeCloseTo(o.q, 12);
          expect(o.q).toBe(popcount(o.mask) / board.colours);
          for (let k = 0; k < board.colours; k++) {
            // Brute force over every triangle of the graph.
            const next = col.slice();
            next[o.edge] = k;
            const busts = monoTriangle(g, next) !== null;
            expect(sectors[k].fatal).toBe(busts);
            // The spinner lands inside the drawn slice of the colour it picks.
            const turn = landingTurn(board.colours, k, rng.next());
            expect(turn).toBeGreaterThanOrEqual(sectors[k].start);
            expect(turn).toBeLessThan(sectors[k].end);
            if (isOffered(o)) {
              pairs++;
              if (!busts) safePairs++;
            }
          }
          if (o.state === 'locked') expect(o.q).toBe(1);
        }
        // The "Random edge" bar is the exact share of (offered edge, colour) pairs that survive.
        if (pairs > 0) expect(randomEdgeSafe(odds)).toBeCloseTo(safePairs / pairs, 12);
      }
    }
  });

  it('exhaustive search: the boards lock after at most 3, 6 and 9 risky edges, and K6 can never be filled', () => {
    for (const id of ['k4', 'k5', 'k6'] as const) {
      const board = BOARDS[id];
      const { maxRisky, fullReached } = exhaustiveMaxRisky(board.n, board.colours);
      expect(maxRisky).toBe(board.maxRisky);
      expect(fullReached).toBe(id !== 'k6');
      expect(maxWin(board)).toBeCloseTo(RTP * 2 ** maxRisky, 9);
      expect(maxWin(board)).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  }, 30_000);

  it('simulated RTP matches the manifest under sampled strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
