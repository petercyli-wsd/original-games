// Fairness audit: can any way of playing Last Light beat the RTP?
//
// The lamps are fixed at the bet (Game.tsx copies them into the round; the
// ring's tap targets and the chips are disabled while live). Each Walk on
// calls walkSegment once with the host rng, decided before it animates, and
// the round's value is cashValue = RTP × your slots / s. The only decision is
// cash out or walk on at a checkpoint, so the game is fair iff the cash-out
// is a martingale over a walk segment. Checked here three ways, all with the
// game's own functions:
//   - every single step: ½·V(step right) + ½·V(step left) = V, exactly;
//   - every segment, exactly: the walk's next light is the right end with
//     gambler's-ruin chance (x − lo + 1)/(m + 1), so E[V at walkSegment's next
//     stop] is a finite recursion over (lo, hi, side);
//   - Monte Carlo of walkSegment itself at 30+ checkpoints reached by play.
//
// Strategies (eval configs × several pick sets), against RTP:
//   (a) the tester's: walk on only when the walk's survival chance (the
//       Walk button's "x% safe", 1 − bustRisk) is ≥ 80%, else cash out;
//   (b) take any profit: cash out the moment V > bet;
//   (c) play to the end;
//   (d) dodge: cash out whenever one of your lamps is likelier than not to
//       light next (nextRisk ≥ ½), the board's red/gold figure;
//   (d') lock any gain over the fair start: cash out once V > RTP.
// Each is computed exactly (to 1e-9) by the same recursion, and simulated
// with walkSegment. Default: a few thousand rounds per cell, 4 SE.
// FAIRNESS_FULL=1 runs every cell until its SE is ≤ 0.3%.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import {
  RTP,
  VOLATILITY,
  bustRisk,
  cashValue,
  defaultPicks,
  exposed,
  lastLampExact,
  mod,
  nextRisk,
  prize,
  startWalk,
  status,
  walkSegment,
  type Walk,
} from './math';

const FULL = !!import.meta.env.FAIRNESS_FULL;

/** Cash out at this checkpoint? */
type Stop = (w: Walk, picks: readonly number[]) => boolean;

const STRATEGIES: { name: string; stop: Stop }[] = [
  { name: '(a) walk only at ≥ 80% safe', stop: (w, p) => 1 - bustRisk(w, p) < 0.8 },
  { name: '(b) take any profit', stop: (w, p) => cashValue(w, p) > 1 },
  { name: '(c) play to the end', stop: () => false },
  { name: '(d) dodge when yours is likely next', stop: (w, p) => nextRisk(w, p) >= 0.5 },
  { name: "(d') lock any gain over RTP", stop: (w, p) => cashValue(w, p) > RTP + 1e-12 },
];

/** Where walkSegment stops: a terminal state, or a light that touches your lamps. */
const isStop = (w: Walk, picks: readonly number[]) => status(w, picks) !== 'live' || picks.includes(mod(w.x, w.n)) || exposed(w, picks);

/** The round's payout once it stops at w and the strategy is applied (or the round ends). */
function payoutAt(w: Walk, picks: readonly number[]): number {
  const st = status(w, picks);
  if (st === 'won') return prize(w.n, picks.length);
  if (st === 'lost') return 0;
  return cashValue(w, picks);
}

/**
 * Exact expected payout of walking on from w and then following `stop` at
 * every later checkpoint (stop = always → E[V at the next checkpoint]).
 */
function exactValue(w0: Walk, picks: readonly number[], stop: Stop): number {
  const memo = new Map<string, number>();
  const walkOn = (w: Walk): number => {
    const key = `${w.lo},${w.hi},${w.x}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const pRight = (w.x - w.lo + 1) / (w.hi - w.lo + 2);
    const at = (next: Walk) => {
      if (!isStop(next, picks)) return walkOn(next);
      if (status(next, picks) !== 'live' || stop(next, picks)) return payoutAt(next, picks);
      return walkOn(next);
    };
    const v = pRight * at({ n: w.n, lo: w.lo, hi: w.hi + 1, x: w.hi + 1 }) + (1 - pRight) * at({ n: w.n, lo: w.lo - 1, hi: w.hi, x: w.lo - 1 });
    memo.set(key, v);
    return v;
  };
  return walkOn(w0);
}

/** One round as Game.tsx plays it: the bet walks, then cash out or walk on at each checkpoint. */
function playRound(n: number, picks: readonly number[], stop: Stop, rng: Rng): number {
  let w = startWalk(n);
  for (;;) {
    const seg = walkSegment(w, picks, rng.next, false);
    if (seg.result === 'won') return prize(n, picks.length);
    if (seg.result === 'lost') return 0;
    w = seg.end;
    if (stop(w, picks)) return cashValue(w, picks);
  }
}

function mc(play: (rng: Rng) => number, rounds: number, seed: number, adaptive = false, maxRounds = 20_000_000) {
  const rng = createRng(seededSource(seed));
  let s = 0;
  let s2 = 0;
  let n = 0;
  let max = 0;
  const stat = () => {
    const mean = s / n;
    return { mean, se: Math.sqrt(Math.max(0, s2 / n - mean * mean) / n), max, n };
  };
  for (;;) {
    const goal = n + (n < rounds ? rounds - n : 100_000);
    for (; n < goal; n++) {
      const x = play(rng);
      s += x;
      s2 += x * x;
      if (x > max) max = x;
    }
    if (!adaptive || stat().se <= 0.003 || n >= maxRounds) return stat();
  }
}

/** Pick sets per ring: the default spread, a run beside the start, the start's two neighbours, and a random set. */
function pickSets(n: number, s: number, rng: Rng): number[][] {
  const sets = [defaultPicks(n, s), Array.from({ length: s }, (_, i) => 1 + i), rng.shuffle(Array.from({ length: n - 1 }, (_, i) => i + 1)).slice(0, s)];
  if (s >= 2) sets.push([1, n - 1, ...Array.from({ length: s - 2 }, (_, i) => 2 + i)]);
  return sets;
}

const CONFIGS = Object.entries(VOLATILITY).map(([level, { n, s }]) => ({ level, n, s }));

describe('Last Light fairness', () => {
  it('martingale, one step: ½·V(right) + ½·V(left) = V at every reachable state (exhaustive for 6, 10 and 16 lamps)', () => {
    const rng = createRng(seededSource(51));
    let checked = 0;
    for (const n of [6, 10, 16]) {
      for (const s of [1, 2, 3, 4].filter((k) => k <= n - 2)) {
        for (const picks of pickSets(n, s, rng)) {
          for (let lo = -(n - 2); lo <= 0; lo++) {
            for (let hi = 0; hi - lo <= n - 2; hi++) {
              for (let x = lo; x <= hi; x++) {
                const w: Walk = { n, lo, hi, x };
                if (status(w, picks) !== 'live') continue;
                const right = { n, lo, hi: Math.max(hi, x + 1), x: x + 1 };
                const left = { n, lo: Math.min(lo, x - 1), hi, x: x - 1 };
                const after = (cashValue(right, picks) + cashValue(left, picks)) / 2;
                expect(Math.abs(after - cashValue(w, picks))).toBeLessThan(1e-12);
                checked++;
              }
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(5_000);
  });

  it('martingale, one walk: at 40 checkpoints reached by play (incl. one dark lamp from the end), E[V at the next stop] = V, exactly and by 100k walks each', () => {
    const rng = createRng(seededSource(52));
    const states: { w: Walk; picks: number[] }[] = [];
    let guard = 0;
    while (states.length < 40 && guard++ < 10_000) {
      const { n, s } = CONFIGS[guard % CONFIGS.length];
      const picks = pickSets(n, s, rng)[rng.int(3)];
      let w = startWalk(n);
      const stops = rng.int(6);
      for (let k = 0; ; k++) {
        const seg = walkSegment(w, picks, rng.next, false);
        if (seg.result !== 'checkpoint') break;
        w = seg.end;
        // Keep late states too: the last checkpoint before the end is the most leveraged.
        if (k === stops || rng.next() < 0.05) {
          states.push({ w, picks });
          break;
        }
      }
    }
    expect(states.length).toBe(40);
    let late = 0;
    const samples = 100_000;
    for (const { w, picks } of states) {
      const v = cashValue(w, picks);
      const exact = exactValue(w, picks, () => true);
      expect(Math.abs(exact - v)).toBeLessThan(1e-9);
      // Matches the slot picture against the raw last-lamp distribution.
      const p = picks.reduce((t, j) => t + lastLampExact(w)[j], 0);
      expect(Math.abs(prize(w.n, picks.length) * p - v)).toBeLessThan(1e-9);
      if (w.n - (w.hi - w.lo + 1) <= picks.length + 1) late++;
      let s = 0;
      let s2 = 0;
      for (let i = 0; i < samples; i++) {
        const seg = walkSegment(w, picks, rng.next, false);
        const x = payoutAt(seg.end, picks);
        s += x;
        s2 += x * x;
      }
      const mean = s / samples;
      const se = Math.sqrt(Math.max(1e-24, s2 / samples - mean * mean) / samples);
      expect(Math.abs(mean - v)).toBeLessThan(4 * se + 1e-9);
    }
    expect(late).toBeGreaterThan(0);
  });

  it('strategies, exactly: every rule and pick set returns RTP to 1e-9 on every eval config', () => {
    const rng = createRng(seededSource(53));
    for (const { n, s } of CONFIGS) {
      for (const picks of pickSets(n, s, rng)) {
        for (const { stop } of STRATEGIES) {
          expect(Math.abs(exactValue(startWalk(n), picks, stop) - RTP)).toBeLessThan(1e-9);
        }
      }
    }
  });

  it(`strategies, simulated with walkSegment: every eval config × rule within 4 SE of RTP${FULL ? ' (SE ≤ 0.3%)' : ''}`, () => {
    const rows: string[] = [];
    let seed = 600;
    for (const { level, n, s } of CONFIGS) {
      const picks = defaultPicks(n, s);
      for (const { name, stop } of STRATEGIES) {
        const rounds = FULL ? 200_000 : n >= 36 ? 1_500 : 4_000;
        const r = mc((rng) => playRound(n, picks, stop, rng), rounds, seed++, FULL);
        rows.push(`${level.padEnd(8)} ${name.padEnd(38)} ${(100 * r.mean).toFixed(2)}% ± ${(100 * r.se).toFixed(2)}%  n=${r.n}  max=${r.max.toFixed(2)}`);
        expect(Math.abs(r.mean - RTP)).toBeLessThan(4 * r.se + 1e-9);
        expect(r.max).toBeLessThanOrEqual(prize(n, s) + 1e-9);
      }
    }
    if (FULL) console.log(rows.join('\n'));
  }, 600_000);
});
