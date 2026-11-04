// Fairness audit: can any way of playing Ramsey beat the RTP?
//
// A round colours the edges of K_n one at a time; the colour of the chosen
// edge is drawn uniformly from c colours when the pick starts (Game.tsx:
// rng.int(colours)). The player's decisions at every checkpoint are (1) which
// open edge to colour (any offered edge, or the Random edge button) and (2)
// whether to cash out. The board and bet are fixed at the bet (the chips are
// disabled while live), the first edge is coloured for the player (always
// free: q = 0), and Space runs the same pickRandom as the button.
//
// The cash-out is a martingale iff, for every reachable state and every
// offered edge e with fatal colours F(e),
//
//     Σ_k (1/c) · [k ∉ F(e)] · V · c / (c − |F(e)|) = V,
//
// and the fatal set F(e) is exactly the set of colours that close a
// one-colour triangle (checked against a brute-force scan of every triangle).
// The next event has c outcomes, so the check is exact enumeration. Lock, cap
// and full-board endings pay V itself (stopping rules). States are reached by
// random rounds on every board, including states one pick from the lock and
// octagon states close to the ×10,000 cap.
//
// Strategies, per eval config, played with the game's own functions:
//   (a) the tester's: press Random edge while its safe chance is ≥ 80%, else
//       cash out;
//   (b) take any profit: Random edge until the cash-out exceeds the bet;
//   (c) play to the end: Random edge until bust, lock, full board or cap;
//   (d) Ramsey-specific: colour every free edge first (build as much
//       structure as possible for nothing), then always the riskiest edge
//       (highest variance), cashing out at ≥ ×10.
// (c) on the octagon only stops at the ×10,000 cap or a bust, so its payouts
// are heavy-tailed (a ~1e-4 chance of ×10,000): its Monte Carlo SE stays
// large at any feasible round count, and the exact per-step martingale check
// is the binding test there.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  BOARDS,
  BOARD_IDS,
  MAX_MULTIPLIER,
  MAX_WIN,
  RTP,
  afterSafePick,
  edgeOdds,
  emptyColouring,
  ending,
  graph,
  isOffered,
  monoTriangle,
  randomEdgeSafe,
  type BoardSpec,
  type EdgeOdds,
} from './math';

/** Rounds per strategy run; the heavy run sets FAIRNESS_ROUNDS (and FAIRNESS_TARGET_SE / FAIRNESS_MAX_ROUNDS). */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 8_000);
const TARGET_SE = Number(import.meta.env.FAIRNESS_TARGET_SE ?? 0);
const MAX_ROUNDS = Number(import.meta.env.FAIRNESS_MAX_ROUNDS ?? ROUNDS);

/** At a checkpoint: the edge to colour next, or null to cash out. */
type Strategy = (board: BoardSpec, col: readonly number[], cash: number, odds: EdgeOdds[], rng: Rng) => number | null;

const randomOffered = (odds: EdgeOdds[], rng: Rng) => {
  const offered = odds.filter(isOffered);
  return offered[rng.int(offered.length)].edge;
};

const STRATEGIES: { name: string; play: Strategy; heavy?: (b: BoardSpec) => boolean }[] = [
  { name: '(a) Random edge while ≥ 80% safe', play: (_b, _c, _v, odds, rng) => (randomEdgeSafe(odds) >= 0.8 ? randomOffered(odds, rng) : null) },
  { name: '(b) take any profit', play: (_b, _c, cash, odds, rng) => (cash > 1 ? null : randomOffered(odds, rng)) },
  { name: '(c) play to the end', play: (_b, _c, _v, odds, rng) => randomOffered(odds, rng), heavy: (b) => b.maxRisky === null },
  {
    name: '(d) free edges first, then the riskiest, cash at ≥ ×10',
    play: (_b, _c, cash, odds, rng) => {
      if (cash >= 10) return null;
      const offered = odds.filter(isOffered);
      const free = offered.filter((o) => o.q === 0);
      if (free.length) return free[rng.int(free.length)].edge;
      const top = Math.max(...offered.map((o) => o.q));
      const pool = offered.filter((o) => o.q === top);
      return pool[rng.int(pool.length)].edge;
    },
  },
];

/** One round as Game.tsx plays it. Returns the payout multiplier. */
function playRound(board: BoardSpec, strategy: Strategy, rng: Rng): number {
  const col = emptyColouring(board.n);
  let cash = RTP;
  let first = true;
  for (;;) {
    const odds = edgeOdds(board, col, cash);
    // The first edge is coloured for the player (pickRandom), like Bet does.
    const edge = first ? randomOffered(odds, rng) : strategy(board, col, cash, odds, rng);
    first = false;
    if (edge === null) return cash;
    const o = odds[edge];
    if (!isOffered(o)) throw new Error('strategy picked an edge the game does not offer');
    const colour = rng.int(board.colours);
    if ((o.mask >> colour) & 1) return 0;
    col[edge] = colour;
    cash = afterSafePick(cash, o.q);
    if (ending(board, col, cash)) return cash;
  }
}

function mc(play: (rng: Rng) => number, seed: number) {
  const rng = createRng(seededSource(seed));
  let n = 0;
  let s = 0;
  let s2 = 0;
  let max = 0;
  let se = Infinity;
  let mean = 0;
  // The heavy run keeps going in chunks until the SE is small enough (or MAX_ROUNDS).
  while (n < ROUNDS || (se > TARGET_SE && n < MAX_ROUNDS)) {
    for (let i = 0; i < ROUNDS; i++) {
      const x = play(rng);
      s += x;
      s2 += x * x;
      if (x > max) max = x;
    }
    n += ROUNDS;
    mean = s / n;
    se = Math.sqrt(Math.max(0, s2 / n - mean * mean) / n);
  }
  return { mean, se, max, n };
}

/** States reached by random safe picks, stopped at a random depth (or one pick before the end). */
function reached(board: BoardSpec, rng: Rng, startCash = RTP) {
  const col = emptyColouring(board.n);
  let cash = startCash;
  const depth = rng.int(col.length);
  for (let i = 0; i < depth; i++) {
    const offered = edgeOdds(board, col, cash).filter(isOffered);
    const o = offered[rng.int(offered.length)];
    const safe = [...Array(board.colours).keys()].filter((k) => !((o.mask >> k) & 1));
    const nextCol = col.slice();
    nextCol[o.edge] = safe[rng.int(safe.length)];
    const nextCash = afterSafePick(cash, o.q);
    // Keep the last live state: a state one pick from the lock or cap is the interesting one.
    if (ending(board, nextCol, nextCash)) break;
    col.splice(0, col.length, ...nextCol);
    cash = nextCash;
  }
  return { col, cash };
}

describe('Ramsey fairness', () => {
  it('martingale (exact, c outcomes): every offered edge is a fair bet, and its fatal colours are exactly the triangle-closers', () => {
    const rng = createRng(seededSource(701));
    let states = 0;
    let nearEnd = 0;
    for (const id of BOARD_IDS) {
      const board = BOARDS[id];
      const g = graph(board.n);
      // Octagon states are also started high, so the cap binds on some edges.
      const starts = id === 'k8' ? [RTP, 900, 3000, 6000, 6700, 9500] : [RTP];
      for (const start of starts) {
        for (let t = 0; t < 12; t++) {
          const { col, cash } = reached(board, rng, start);
          const end = ending(board, col, cash);
          const odds = edgeOdds(board, col, cash);
          const offered = odds.filter(isOffered);
          if (end) {
            expect(offered.length === 0 || end === 'cap' || end === 'full').toBe(true);
            continue;
          }
          states++;
          expect(offered.length).toBeGreaterThan(0);
          for (const o of odds) {
            if (o.state === 'coloured') continue;
            // The fatal mask against a brute-force triangle scan.
            for (let k = 0; k < board.colours; k++) {
              const next = col.slice();
              next[o.edge] = k;
              expect(((o.mask >> k) & 1) === 1).toBe(monoTriangle(g, next) !== null);
            }
            if (!isOffered(o)) continue;
            expect(o.q).toBeLessThan(1);
            expect(cash * o.factor).toBeLessThanOrEqual(MAX_WIN * (1 + 1e-12));
            let after = 0;
            for (let k = 0; k < board.colours; k++) after += ((o.mask >> k) & 1 ? 0 : afterSafePick(cash, o.q)) / board.colours;
            expect(Math.abs(after - cash)).toBeLessThan(1e-12 * cash);
            // After a safe pick the round either continues or auto-cashes at exactly that value.
          }
          // One pick from the end: some safe outcome ends the round.
          if (
            offered.some((o) =>
              [...Array(board.colours).keys()].some((k) => {
                if ((o.mask >> k) & 1) return false;
                const next = col.slice();
                next[o.edge] = k;
                return ending(board, next, afterSafePick(cash, o.q)) !== null;
              }),
            )
          )
            nearEnd++;
        }
      }
    }
    expect(states).toBeGreaterThanOrEqual(30);
    expect(nearEnd).toBeGreaterThanOrEqual(10);
  });

  for (const cfg of evalSpec.configs) {
    describe(cfg.label, () => {
      STRATEGIES.forEach((s, si) => {
        it(`${s.name}: RTP within 4 SE of ${RTP}`, () => {
          const r = mc((rng) => playRound(cfg.params, s.play, rng), 7_000 + si * 97 + cfg.params.n);
          if (import.meta.env.FAIRNESS_ROUNDS) console.log(`ramsey | ${cfg.label} | ${s.name} | n ${r.n} | rtp ${r.mean.toFixed(5)} ± ${r.se.toFixed(5)} | max ${r.max.toFixed(2)}`);
          expect(r.max).toBeLessThanOrEqual(MAX_MULTIPLIER);
          expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
          // Heavy-tailed (octagon, play to the cap): only the bound and a loose sanity check.
          if (s.heavy?.(cfg.params)) expect(r.mean).toBeLessThan(RTP + 4 * Math.max(r.se, 0.05));
          else expect(Math.abs(r.mean - RTP)).toBeLessThan(4 * r.se + 1e-12);
        });
      });
    });
  }
});
