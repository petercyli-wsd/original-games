// Fairness audit: can any way of playing Probe beat the RTP?
//
// A round as Game.tsx plays it: the bet drops the first ball. Each ball lands
// on h = rng.int(24) and slides clockwise; it busts if it would slide more
// than one slot. Surviving a ball with r red slots multiplies the cash-out by
// 24 / (24 − r). Balls with no red slot can't bust and are placed for you
// (factor 1); otherwise the round stops at a checkpoint where the only choice
// is Cash out or Drop next (both hidden while a ball is in flight; Space and C
// call the same functions). Reaching K balls pays the cash-out.
//
// Martingale check (exact): at 40+ reached states (all four ball counts, the
// last ball before K included) and hand-built extreme boards (one long run,
// many merging gaps), enumerate all 24 landing slots through the real drop():
// the bust count equals redCount, and the average cash-out after the ball is
// V exactly. Sampled: 100k real drops via rng.int at a spread of states.
//
// Strategies, per eval config, through the game's functions:
//   (a) drop while the next ball is ≥ 80% safe, else cash out;
//   (b) take any profit: cash out the moment the cash-out exceeds the bet;
//   (c) drop all K balls;
//   (d) stop right after a merge: cash out when the red count has just jumped
//       by 2 or more (Knuth's clustering makes the next balls riskier), else
//       drop. Probe has no choice but when to stop, so (d) is another stop rule.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import { BALLS, MAX_SLIDE, RTP, SLOTS, afterSafeBall, drop, emptyTable, maxMultiplier, redCount, type Balls } from './math';

const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 20_000);
const SAMPLES = 100_000;
const m = SLOTS;
const P = MAX_SLIDE;

interface State {
  K: Balls;
  table: boolean[];
  placed: number;
  cash: number;
  /** Red count before the last ball (for strategy (d)). */
  prevRed: number;
}

type Stop = (s: State, red: number) => boolean;

const STRATEGIES: { name: string; stop: Stop }[] = [
  { name: '(a) drop while ≥ 80% safe', stop: (_, red) => 1 - red / m < 0.8 },
  { name: '(b) take any profit', stop: (s) => s.cash > 1 },
  { name: '(c) drop all balls', stop: () => false },
  { name: '(d) cash right after a merge jump', stop: (s, red) => red - s.prevRed >= 2 },
];

/** One round as Game.tsx plays it: free balls drop on their own, checkpoints only when something is red. */
function playRound(K: Balls, stop: Stop, rng: Rng): number {
  const s: State = { K, table: emptyTable(m), placed: 0, cash: RTP, prevRed: 0 };
  for (;;) {
    const red = redCount(s.table, P);
    if (red > 0 && s.placed > 0 && stop(s, red)) return s.cash;
    const res = drop(s.table, rng.int(m), P);
    if (!res.safe) return 0;
    s.cash = afterSafeBall(s.cash, red, m);
    s.table = res.table;
    s.placed++;
    s.prevRed = red;
    if (s.placed >= K) return s.cash;
  }
}

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

/** Live states met while playing random rounds to the end (kept at random, always the last before K). */
function reachedStates(count: number, rng: Rng): State[] {
  const out: State[] = [];
  while (out.length < count) {
    const K = BALLS[out.length % BALLS.length];
    const s: State = { K, table: emptyTable(m), placed: 0, cash: RTP, prevRed: 0 };
    for (;;) {
      const red = redCount(s.table, P);
      const res = drop(s.table, rng.int(m), P);
      if (!res.safe) break;
      s.cash = afterSafeBall(s.cash, red, m);
      s.table = res.table;
      s.placed++;
      if (s.placed >= K) break;
      if (rng.next() < 0.3 || s.placed === K - 1) out.push({ ...s, table: [...s.table] });
    }
  }
  return out.slice(0, count);
}

/** A board with the given full slots and a cash-out that is the max-path value for that ball count. */
function board(full: number[], K: Balls): State {
  const table = emptyTable(m);
  for (const i of full) table[i] = true;
  return { K, table, placed: full.length, cash: maxMultiplier(m, full.length + 1, P), prevRed: 0 };
}

describe('Probe fairness', () => {
  it('martingale (exact): over all 24 landing slots, the bust count is redCount and E[V after the ball] = V', () => {
    const rng = createRng(seededSource(2024));
    const states = [
      ...reachedStates(44, rng),
      // One long run (the max-payout path), 17 balls: 16 red slots.
      board(Array.from({ length: 17 }, (_, i) => i), 18),
      // Pairs separated by single gaps: filling a gap merges two runs.
      board([0, 1, 3, 4, 6, 7, 9, 10, 12, 13, 15, 16], 14),
      // A ring with one gap left in a long run.
      board([0, 1, 2, 3, 4, 6, 7, 8, 9], 10),
    ];
    expect(states.filter((s) => s.placed === s.K - 1).length).toBeGreaterThanOrEqual(8);
    expect(states.filter((s) => redCount(s.table, P) >= 4).length).toBeGreaterThanOrEqual(5);
    for (const s of states) {
      const red = redCount(s.table, P);
      let bust = 0;
      let next = 0;
      for (let h = 0; h < m; h++) {
        const res = drop(s.table, h, P);
        if (!res.safe) bust++;
        else next += afterSafeBall(s.cash, red, m) / m;
        // A safe ball fills exactly one empty slot.
        if (res.safe) expect(res.table.filter(Boolean).length).toBe(s.placed + 1);
      }
      expect(bust).toBe(red);
      expect(red).toBeLessThan(m);
      expect(Math.abs(next - s.cash)).toBeLessThan(1e-12 * Math.max(1, s.cash));
      // The bound used for maxMultiplier: red ≤ placed − P.
      expect(red).toBeLessThanOrEqual(Math.max(0, s.placed - P));
    }
  });

  it('martingale (sampled): 100k real drops at a spread of states bust at red/24 within 4 SE', () => {
    const rng = createRng(seededSource(31));
    const states = reachedStates(8, rng).filter((s) => redCount(s.table, P) > 0);
    states.push(board(Array.from({ length: 17 }, (_, i) => i), 18));
    for (const s of states) {
      const q = redCount(s.table, P) / m;
      let bust = 0;
      for (let i = 0; i < SAMPLES; i++) if (!drop(s.table, rng.int(m), P).safe) bust++;
      expect(Math.abs(bust / SAMPLES - q)).toBeLessThan(4 * Math.sqrt((q * (1 - q)) / SAMPLES) + 1e-9);
    }
  });

  it('strategies (a)–(d) on every eval config return RTP within 4 SE, never above the manifest max', () => {
    const rows: string[] = [];
    evalSpec.configs.forEach(({ label, params: { balls } }, ci) => {
      STRATEGIES.forEach(({ name, stop }, si) => {
        const { mean, se, max } = mc((r) => playRound(balls, stop, r), ROUNDS, 6100 + 13 * ci + si);
        rows.push(`${label.padEnd(44)} ${name.padEnd(36)} ${(mean * 100).toFixed(2)}% ± ${(se * 100).toFixed(2)}%  max ${max.toFixed(2)}×`);
        expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-9);
        expect(max).toBeLessThanOrEqual(maxMultiplier(m, balls, P) + 1e-9);
        expect(max).toBeLessThanOrEqual(manifest.maxMultiplier);
      });
    });
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
