// Fairness audit: can any way of playing Mines beat the RTP?
//
// A round places m mines at bet time (placeMines with the host shuffle); the
// player then picks hidden tiles one at a time and may cash out after any
// gem. The decisions are (1) which tile to reveal and (2) when to stop; the
// mine count is fixed at the bet (the picker is disabled while live), and
// Auto is a preset tile set revealed in order. So the claim "cash out whenever
// the next tile is under 80% safe" fails exactly when, at every reachable
// state and for every hidden tile t,
//
//     P(t is a gem | gems found so far) · M(k + 1) = M(k).
//
// The martingale check computes P(t is a gem | state) for every hidden tile:
// exactly, by enumerating every mine layout consistent with the state (few
// mines left, or few gems left), and otherwise from 100k+ real placeMines
// boards conditioned on the revealed tiles being gems (4 SE). States come from
// random rounds on real boards, from the first tile to the last gem.
//
// Strategies, per eval config (each round samples the config's mine band):
//   (a) the tester's: reveal while the next tile is ≥ 80% safe, else cash out;
//   (b) take any profit: cash out the moment the cash-out exceeds the bet;
//   (c) clear the board;
//   (d) "gems cluster": always pick a hidden tile next to a found gem (corners
//       first), cash out at ≥ 3× or when the next tile is < 50% safe;
// played on real boards. Every rule is also valued exactly by backward
// induction (its stopping set depends only on k). (c) on 8+ mines pays
// C(25, m)-to-1 shots, so its Monte Carlo is only asserted where the clear
// is common enough to be sampled; the exact value and the martingale check
// are the binding tests there.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { MAX_MULTIPLIER, RTP, TILES, gemsFor, multiplier, nextSafe, placeMines, playSelection, surviveChance } from './math';

/** Rounds per strategy run; the audit's 200k run sets FAIRNESS_ROUNDS=200000. */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 5_000);

const board = (m: number, rng: Rng) => placeMines(m, (xs) => rng.shuffle(xs));
const ALL = Array.from({ length: TILES }, (_, i) => i);

interface State {
  m: number;
  /** Tiles revealed so far, all gems. */
  revealed: number[];
}

/** Next tile to reveal, given the state (the strategy's tile rule). */
type Pick = (s: State, b: readonly boolean[], rng: Rng) => number;
/** Cash out now (k ≥ 1 gems found)? */
type Stop = (m: number, k: number) => boolean;

const randomPick: Pick = (s, _b, rng) => {
  const hidden = ALL.filter((t) => !s.revealed.includes(t));
  return hidden[rng.int(hidden.length)];
};

const CORNERS = [0, 4, 20, 24];
const nextTo = (a: number, b: number) => Math.abs((a % 5) - (b % 5)) <= 1 && Math.abs(Math.floor(a / 5) - Math.floor(b / 5)) <= 1 && a !== b;
const clusterPick: Pick = (s, _b, rng) => {
  const hidden = ALL.filter((t) => !s.revealed.includes(t));
  const near = hidden.filter((t) => s.revealed.some((r) => nextTo(r, t)));
  if (near.length) return near[rng.int(near.length)];
  const corner = hidden.filter((t) => CORNERS.includes(t));
  return corner.length ? corner[0] : hidden[rng.int(hidden.length)];
};

/** One manual round as Game.tsx plays it: mines placed at the bet, first reveal mandatory, auto-pay on a full clear. */
function playRound(m: number, pick: Pick, stop: Stop, rng: Rng): number {
  const b = board(m, rng);
  const s: State = { m, revealed: [] };
  for (;;) {
    const k = s.revealed.length;
    if (k > 0 && stop(m, k)) return multiplier(m, k);
    const t = pick(s, b, rng);
    if (b[t]) return 0;
    s.revealed.push(t);
    if (s.revealed.length >= gemsFor(m)) return multiplier(m, s.revealed.length);
  }
}

/** Exact value of a k-only stopping rule by backward induction (first reveal mandatory). */
function exactValue(m: number, stop: Stop): number {
  const v = (k: number): number => (k === gemsFor(m) || (k > 0 && stop(m, k)) ? multiplier(m, k) : nextSafe(m, k) * v(k + 1));
  return v(0);
}

const STRATEGIES: { name: string; pick: Pick; stop: Stop }[] = [
  { name: '(a) reveal while ≥ 80% safe', pick: randomPick, stop: (m, k) => nextSafe(m, k) < 0.8 },
  { name: '(b) take any profit', pick: randomPick, stop: (m, k) => multiplier(m, k) > 1 },
  { name: '(c) clear the board', pick: randomPick, stop: () => false },
  { name: '(d) cluster picks, ≥ 3× or < 50% safe', pick: clusterPick, stop: (m, k) => multiplier(m, k) >= 3 || nextSafe(m, k) < 0.5 },
];

function mc(play: (rng: Rng) => number, rounds: number, seed: number) {
  const rng = createRng(seededSource(seed));
  let s = 0;
  let s2 = 0;
  let max = 0;
  for (let i = 0; i < rounds; i++) {
    const x = play(rng);
    s += x;
    s2 += x * x;
    if (x > max) max = x;
  }
  const mean = s / rounds;
  return { mean, se: Math.sqrt(Math.max(0, s2 / rounds - mean * mean) / rounds), max };
}

/** k-subsets of xs. */
function* subsets(xs: readonly number[], k: number, from = 0, acc: number[] = []): Generator<number[]> {
  if (acc.length === k) return void (yield acc);
  for (let i = from; i <= xs.length - (k - acc.length); i++) yield* subsets(xs, k, i + 1, [...acc, xs[i]]);
}

/**
 * Exact P(tile is a mine | the revealed tiles are gems) for every hidden tile:
 * every m-subset avoiding the revealed tiles is equally likely, so count them.
 * Enumerates mine sets (few mines) or gem sets (few gems left).
 */
function exactMineChance(s: State): Map<number, number> {
  const hidden = ALL.filter((t) => !s.revealed.includes(t));
  const gemsLeft = hidden.length - s.m;
  const byMines = s.m <= gemsLeft;
  const k = byMines ? s.m : gemsLeft;
  const count = new Map(hidden.map((t) => [t, 0]));
  let total = 0;
  for (const set of subsets(hidden, k)) {
    total++;
    for (const t of set) count.set(t, count.get(t)! + 1);
  }
  return new Map(hidden.map((t) => [t, byMines ? count.get(t)! / total : 1 - count.get(t)! / total]));
}

/** States reached by playing random rounds on real boards (any tile order), sampled at every depth. */
function reached(m: number, maxK: number, rng: Rng, want: number): State[] {
  const out: State[] = [];
  let guard = 0;
  while (out.length < want && guard++ < 100_000) {
    const b = board(m, rng);
    const order = rng.shuffle(ALL);
    const revealed: number[] = [];
    for (const t of order) {
      if (b[t] || revealed.length >= Math.min(maxK, gemsFor(m) - 1)) break;
      revealed.push(t);
    }
    const k = rng.int(revealed.length + 1);
    out.push({ m, revealed: revealed.slice(0, k) });
  }
  return out;
}

describe('Mines fairness', () => {
  it('martingale (exact): for every hidden tile, P(gem | state) · M(k+1) = M(k), all layouts enumerated', () => {
    const rng = createRng(seededSource(501));
    const states: State[] = [];
    // Few mines: enumerate mine sets. Many mines: enumerate gem sets (near the end of the board too).
    for (const m of [1, 2, 3]) states.push(...reached(m, 22, rng, 5), { m, revealed: ALL.slice(0, gemsFor(m) - 1) });
    for (const m of [22, 23, 24]) states.push(...reached(m, 3, rng, 4), { m, revealed: ALL.slice(0, gemsFor(m) - 1) });
    // Middle counts with ≤ 3 gems left: deep into the board.
    for (const m of [10, 15]) states.push({ m, revealed: ALL.slice(m, m + gemsFor(m) - 3) });
    expect(states.length).toBeGreaterThanOrEqual(30);
    for (const s of states) {
      const k = s.revealed.length;
      const exact = exactMineChance(s);
      for (const [, pMine] of exact) {
        expect(Math.abs((1 - pMine) * multiplier(s.m, k + 1) - multiplier(s.m, k))).toBeLessThan(1e-9 * multiplier(s.m, k + 1));
        expect(Math.abs(1 - pMine - nextSafe(s.m, k))).toBeLessThan(1e-12);
      }
    }
  });

  it('martingale (Monte Carlo on real boards): P(gem | state) for every hidden tile, 100k conditioned boards, 4 SE', () => {
    const rng = createRng(seededSource(502));
    const cases: State[] = [
      { m: 5, revealed: [0, 1, 2] },
      { m: 5, revealed: [12, 6, 18, 24, 3] },
      { m: 8, revealed: [7, 13] },
      { m: 12, revealed: [4] },
      { m: 12, revealed: [20, 21] },
      { m: 18, revealed: [] },
    ];
    for (const s of cases) {
      const k = s.revealed.length;
      const p = nextSafe(s.m, k);
      const hidden = ALL.filter((t) => !s.revealed.includes(t));
      const gems = new Map(hidden.map((t) => [t, 0]));
      let kept = 0;
      while (kept < 100_000) {
        const b = board(s.m, rng);
        if (s.revealed.some((t) => b[t])) continue;
        kept++;
        for (const t of hidden) if (!b[t]) gems.set(t, gems.get(t)! + 1);
      }
      const se = Math.sqrt((p * (1 - p)) / kept);
      // Each tile on its own; the 4 SE bound is per tile (a ~1e-4 chance each of a false alarm).
      for (const t of hidden) expect(Math.abs(gems.get(t)! / kept - p)).toBeLessThan(4.5 * se);
      // E[V after] = P̂(gem) · M(k+1) against M(k), averaged over the tiles.
      const pHat = [...gems.values()].reduce((a, g) => a + g, 0) / (kept * hidden.length);
      expect(Math.abs(pHat * multiplier(s.m, k + 1) - multiplier(s.m, k)) / multiplier(s.m, k)).toBeLessThan((4 * se) / p);
    }
  });

  it('Auto and manual are the same maths: an auto set pays what revealing the same tiles by hand pays', () => {
    const rng = createRng(seededSource(503));
    for (let r = 0; r < 5000; r++) {
      const m = 1 + rng.int(24);
      const b = board(m, rng);
      const set = rng.shuffle(ALL).slice(0, 1 + rng.int(gemsFor(m)));
      const auto = playSelection(b, m, set);
      let manual = 0;
      let k = 0;
      for (const t of set) {
        if (b[t]) break;
        k++;
      }
      manual = k === set.length ? multiplier(m, k) : 0;
      expect(auto.multiplier).toBe(manual);
    }
  });

  it('every strategy is worth exactly RTP (backward induction) for every mine count', () => {
    for (let m = 1; m <= 24; m++) for (const { stop } of STRATEGIES) expect(exactValue(m, stop)).toBeCloseTo(RTP, 10);
  });

  it('strategies (a)–(d) on every eval config return RTP within 4 SE on real boards, never above the max', () => {
    const rows: string[] = [];
    evalSpec.configs.forEach(({ label, params: { mines: band } }, ci) => {
      STRATEGIES.forEach(({ name, pick, stop }, si) => {
        const res = mc((r) => playRound(band[r.int(band.length)], pick, stop, r), ROUNDS, 7100 + 13 * ci + si);
        // Chance of the round's rarest payout under this rule; too rare to sample means the exact value decides.
        const rare = Math.min(...band.map((m) => surviveChance(m, si === 2 ? gemsFor(m) : 1)));
        const sampled = rare * ROUNDS >= 30;
        rows.push(`${label.padEnd(24)} ${name.padEnd(40)} ${(res.mean * 100).toFixed(2)}% ± ${(res.se * 100).toFixed(2)}%  max ${res.max.toFixed(1)}×${sampled ? '' : '  (clear too rare to sample: exact only)'}`);
        if (sampled) expect(Math.abs(res.mean - RTP)).toBeLessThan(4 * res.se + 1e-12);
        expect(res.max).toBeLessThanOrEqual(MAX_MULTIPLIER);
        for (const m of band) expect(exactValue(m, stop)).toBeCloseTo(RTP, 10);
      });
    });
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
