// Fairness audit: can any way of playing Sperner beat the RTP?
//
// Vertices are coloured row by row, each uniformly among its allowed colours
// (allowed[rng.int(allowed.length)] in Game.tsx). The cash-out is prize ×
// P(win | board), computed by an exact transfer DP, and the round settles at
// the prize or 0 the moment the bet is decided, so the value is a bounded
// martingale starting at RTP; by optional stopping every rule returns RTP.
//
// Decisions mid-round: cash out, colour the next vertex, or colour the rest of
// the row (a burst that stops early once the bet is decided). Grid and bet are
// locked while live. A burst is just "don't stop at the vertices inside it",
// so every way of playing is a stopping rule on the vertex-by-vertex chain.
// Bet colours the first vertex straight away: no decision before it.
//
// The future of a board depends only on (next vertex, the row above it, the
// part of its own row already coloured, rainbows found so far): later
// triangles only touch those rows. That is the key the exact checks memoise
// on, which keeps the 25-triangle grid at a few hundred thousand states.
//
// Checks, with the game's own functions (chances, decided, paint, nextVertex,
// geometry, prizeFor) and Game.tsx's settlement (won → prize, lost → 0):
//   - martingale: at every reachable board of the 9- and 16-triangle grids
//     (every offered bet) and at 40+ random boards of the 25-triangle grid,
//     every colour of the next vertex is enumerated: E[V after] = V (1e-12);
//   - optimal stopping: the Snell envelope over the reveal tree equals V;
//   - strategies (a)–(d) exactly (memoised DFS over the reveal tree) on every
//     offered setting (25 triangles in the heavy run only), and by Monte Carlo
//     through the real reveal on every eval config.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { BETS, RTP, SIZES, chances, decided, freshColours, geometry, isOffered, nextVertex, paint, prizeFor, rainbows, vid, type Bet, type Colours } from './math';

/** Rounds per strategy run; the audit's heavy run sets FAIRNESS_ROUNDS. */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 3_000);
const HEAVY = !!import.meta.env.FAIRNESS_ROUNDS;

const OFFERED = SIZES.flatMap((m) => BETS.filter((b) => isOffered(m, b)).map((bet) => ({ m, bet })));
const EVAL = evalSpec.configs;

/** Game.tsx's value of a board: the prize or 0 once decided, else the cash-out. */
function value(m: number, bet: Bet, colours: Colours): { v: number; over: boolean } {
  const c = chances(m, bet, colours);
  const d = decided(c);
  if (d) return { v: d === 'won' ? prizeFor(m, bet) : 0, over: true };
  if (nextVertex(m, colours) === null) throw new Error('a full board is always decided');
  return { v: prizeFor(m, bet) * c.p, over: false };
}

/** The children of a live board: each colour of the next vertex, equally likely. */
function children(m: number, colours: Colours): number[][] {
  const v = nextVertex(m, colours)!;
  return geometry(m).vertices[v].allowed.map((c) => paint(colours, v, c));
}

/** The Markov key of a board (see the header). */
function stateKey(m: number, colours: Colours): string {
  const v = nextVertex(m, colours)!;
  const { i, j } = geometry(m).vertices[v];
  const above = Array.from({ length: i }, (_, k) => colours[vid(i - 1, k)]).join('');
  const own = Array.from({ length: j }, (_, k) => colours[vid(i, k)]).join('');
  return `${v}|${above}|${own}|${rainbows(m, colours).length}`;
}

/** A stopping rule at a checkpoint: true = cash out. Gets the cash-out and the children's values. */
type Stop = (cash: number, kids: { v: number; over: boolean }[]) => boolean;

const STRATEGIES: { name: string; stop: Stop }[] = [
  // Survival: P(the next vertex doesn't decide the bet as lost).
  { name: '(a) colour while survival ≥ 0.8', stop: (_, kids) => kids.filter((k) => !(k.over && k.v === 0)).length / kids.length < 0.8 },
  { name: '(b) take any profit', stop: (cash) => cash > 1 },
  { name: '(c) colour to the end', stop: () => false },
  // Ride the swings: bank 1.5×, or bail out when some colour of the next vertex would halve the value.
  { name: '(d) take 1.5× or dodge a halving', stop: (cash, kids) => cash >= 1.5 || Math.min(...kids.map((k) => k.v)) <= 0.5 * cash },
];

/**
 * Exact value of a stopping rule (stop = null: the Snell envelope, checked
 * equal to V at every state), with the martingale step checked at every state.
 */
function exactValue(m: number, bet: Bet, stop: Stop | null): { ev: number; states: number } {
  const memo = new Map<string, number>();
  const go = (colours: Colours, canStop: boolean): number => {
    const here = value(m, bet, colours);
    if (here.over) return here.v;
    const key = stateKey(m, colours) + (canStop ? '' : '!');
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const kidBoards = children(m, colours);
    const kids = kidBoards.map((b) => value(m, bet, b));
    // The martingale step: E[V after] = V.
    const mean = kids.reduce((s, k) => s + k.v, 0) / kids.length;
    expect(Math.abs(mean - here.v)).toBeLessThan(1e-12 * Math.max(1, here.v));
    const cont = kidBoards.reduce((s, b) => s + go(b, true), 0) / kidBoards.length;
    let x: number;
    if (stop === null) {
      x = canStop ? Math.max(here.v, cont) : cont;
      expect(Math.abs(x - here.v)).toBeLessThan(1e-11 * Math.max(1, here.v));
    } else x = canStop && stop(here.v, kids) ? here.v : cont;
    memo.set(key, x);
    return x;
  };
  // Bet colours the first vertex before any decision.
  const ev = go(freshColours(m), false);
  return { ev, states: memo.size };
}

/** One round through the real reveal, as Game.tsx plays it (vertex by vertex; bursts are the same chain). */
function playRound(m: number, bet: Bet, stop: Stop, rng: Rng): number {
  let colours: number[] = freshColours(m);
  let first = true;
  for (;;) {
    const here = value(m, bet, colours);
    if (here.over) return here.v;
    if (!first) {
      const kids = children(m, colours).map((b) => value(m, bet, b));
      if (stop(here.v, kids)) return here.v;
    }
    first = false;
    const v = nextVertex(m, colours)!;
    const allowed = geometry(m).vertices[v].allowed;
    colours = paint(colours, v, allowed[rng.int(allowed.length)]);
  }
}

describe('Sperner fairness', () => {
  it('martingale at 40+ random boards of the 25-triangle grid (every next colour enumerated, 1e-12)', () => {
    const rng = createRng(seededSource(2024));
    let n = 0;
    for (const bet of BETS.filter((b) => isOffered(5, b))) {
      for (let t = 0; t < 12; t++) {
        let colours: number[] = freshColours(5);
        const depth = rng.int(geometry(5).order.length);
        for (let k = 0; k < depth; k++) {
          const v = nextVertex(5, colours)!;
          const a = geometry(5).vertices[v].allowed;
          const next = paint(colours, v, a[rng.int(a.length)]);
          if (value(5, bet, next).over) break;
          colours = next;
        }
        const here = value(5, bet, colours);
        const kids = children(5, colours).map((b) => value(5, bet, b).v);
        expect(Math.abs(kids.reduce((s, x) => s + x, 0) / kids.length - here.v)).toBeLessThan(1e-12 * Math.max(1, here.v));
        n++;
      }
    }
    expect(n).toBeGreaterThan(30);
  });

  it('optimal stopping: the Snell envelope equals V at every reachable board (9 and 16 triangles; 25 in the heavy run)', () => {
    for (const { m, bet } of OFFERED.filter((s) => HEAVY || s.m < 5)) {
      const { ev, states } = exactValue(m, bet, null);
      expect(states).toBeGreaterThan(5);
      expect(Math.abs(ev - RTP)).toBeLessThan(1e-11);
    }
  });

  it('strategies (a)–(d) are worth exactly RTP (9 and 16 triangles; 25 in the heavy run)', () => {
    const rows: string[] = [];
    for (const { m, bet } of OFFERED.filter((s) => HEAVY || s.m < 5)) {
      for (const { name, stop } of STRATEGIES) {
        const { ev, states } = exactValue(m, bet, stop);
        rows.push(`${m * m} triangles, bet ${bet} | ${name} | ${(ev * 100).toFixed(10)}% (${states} states)`);
        expect(Math.abs(ev - RTP)).toBeLessThan(1e-11);
      }
    }
    if (HEAVY) console.log(rows.join('\n'));
  });

  it(`strategies (a)–(d) through the real reveal return RTP on every eval config (${ROUNDS} rounds, 4 SE)`, () => {
    const rows: string[] = [];
    for (const [ci, { label, params }] of EVAL.entries()) {
      for (const [si, { name, stop }] of STRATEGIES.entries()) {
        const rng = createRng(seededSource(31_000 + ci * 31 + si));
        let sum = 0;
        let sq = 0;
        for (let i = 0; i < ROUNDS; i++) {
          const x = playRound(params.size, params.bet, stop, rng);
          sum += x;
          sq += x * x;
        }
        const mean = sum / ROUNDS;
        const se = Math.sqrt(Math.max(0, sq / ROUNDS - mean * mean) / ROUNDS);
        rows.push(`${label} | ${name} | ${(mean * 100).toFixed(2)}% ± ${(se * 100).toFixed(2)}`);
        expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-9);
      }
    }
    if (HEAVY) console.log(rows.join('\n'));
  });
});
