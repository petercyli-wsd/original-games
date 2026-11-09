// Fairness audit: can any way of playing Median beat the RTP?
//
// The window and point count are locked at the bet: change() returns while
// live, the chips and slider are disabled, and round.s / round.prize are
// copied at the bet. Each Drop draws a burst of burstSize(n) points with
// rng.next() (fewer if the round is decided part-way), all decided before the
// burst animates. Only the side each point lands on (below / inside / above
// [a, b], chances a, b − a, 1 − b) affects V = prize × P(win | tally), so a
// burst has finitely many outcomes and the martingale check is an exact
// enumeration, point by point, with the game's decided() and outcomes().
// The only decision is cash out or drop at each checkpoint.
//
// Strategies (every eval config, its window and the riskiest allowed one at
// the edge), against RTP:
//   (a) the tester's: drop only when the burst's survival chance (no side
//       reaching m + 1 during it) is ≥ 80%, else cash out;
//   (b) take any profit: cash out the moment V > bet;
//   (c) play to the end;
//   (d) bank a favourite: cash out once the win chance passes 50%;
//   (d') lock any gain over RTP: cash out once V > RTP.
// Each is computed exactly (recursion over tallies) and simulated with the
// game's sideOf() on rng.next(). Default: 10k rounds per cell, 4 SE;
// FAIRNESS_FULL=1 runs every cell until its SE is ≤ 0.3%.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import {
  MAX_MULTIPLIER,
  MAX_PRIZE,
  POINTS,
  RTP,
  VOLATILITY,
  WIDTHS,
  burstSize,
  decided,
  loRange,
  outcomes,
  prizeFor,
  sideOf,
  windowOf,
  type Settings,
  type Side,
  type Tally,
} from './math';

const FULL = !!import.meta.env.FAIRNESS_FULL;
const SIDES: Side[] = ['below', 'inside', 'above'];

interface Ctx {
  s: Settings;
  a: number;
  b: number;
  prize: number;
  /** Per-tally caches (the game's functions are pure; this only saves time). */
  values: Map<string, number>;
  bursts: Map<string, [number, Tally][]>;
}

const ctxOf = (s: Settings): Ctx => ({ s, ...windowOf(s), prize: prizeFor(s), values: new Map(), bursts: new Map() });
const tkey = (t: Tally) => `${t.below},${t.inside},${t.above}`;
const sideP = (c: Ctx, side: Side) => (side === 'below' ? c.a : side === 'inside' ? c.b - c.a : 1 - c.b);
const add = (t: Tally, side: Side): Tally => ({ ...t, [side]: t[side] + 1 });
/** V at a tally: the prize once won, 0 once bust, else prize × P(win | tally), as Game.drop prices it. */
function value(c: Ctx, t: Tally): number {
  const k = tkey(t);
  let v = c.values.get(k);
  if (v === undefined) {
    const d = decided(c.s.n, t);
    v = d === 'win' ? c.prize : d === 'bust' ? 0 : c.prize * outcomes(c.s.n, t, c.a, c.b).win;
    c.values.set(k, v);
  }
  return v;
}

/** Exact distribution of the tally after one burst from t, as Game.drop draws it (stops early once decided). */
function burstOutcomes(c: Ctx, t: Tally): [number, Tally][] {
  const hit = c.bursts.get(tkey(t));
  if (hit) return hit;
  const merged = new Map<string, [number, Tally]>();
  const rec = (cur: Tally, p: number, k: number) => {
    if (k === burstSize(c.s.n) || decided(c.s.n, cur)) {
      const m = merged.get(tkey(cur));
      if (m) m[0] += p;
      else merged.set(tkey(cur), [p, cur]);
      return;
    }
    for (const side of SIDES) {
      const q = sideP(c, side);
      if (q > 0) rec(add(cur, side), p * q, k + 1);
    }
  };
  rec(t, 1, 0);
  const out = [...merged.values()];
  c.bursts.set(tkey(t), out);
  return out;
}

/** Chance the burst ends the round lost. */
const burstBust = (c: Ctx, t: Tally) => burstOutcomes(c, t).reduce((s, [p, u]) => s + (decided(c.s.n, u) === 'bust' ? p : 0), 0);

/** Cash out at this checkpoint? */
type Stop = (c: Ctx, t: Tally) => boolean;

const STRATEGIES: { name: string; stop: Stop }[] = [
  { name: '(a) drop only at ≥ 80% safe', stop: (c, t) => 1 - burstBust(c, t) < 0.8 },
  { name: '(b) take any profit', stop: (c, t) => value(c, t) > 1 },
  { name: '(c) play to the end', stop: () => false },
  { name: '(d) bank a favourite (> 50%)', stop: (c, t) => value(c, t) / c.prize > 0.5 },
  { name: "(d') lock any gain over RTP", stop: (c, t) => value(c, t) > RTP + 1e-12 },
];

/** Exact expected payout of dropping from tally t, then following `stop` at every checkpoint. */
function exactValue(c: Ctx, t0: Tally, stop: Stop): number {
  const memo = new Map<string, number>();
  const drop = (t: Tally): number => {
    const k = tkey(t);
    const hit = memo.get(k);
    if (hit !== undefined) return hit;
    let v = 0;
    for (const [p, u] of burstOutcomes(c, t)) v += p * (decided(c.s.n, u) || stop(c, u) ? value(c, u) : drop(u));
    memo.set(k, v);
    return v;
  };
  return drop(t0);
}

/** One round as Game.tsx plays it: the bet drops the first burst, then cash out or drop at each checkpoint. */
function playRound(c: Ctx, stop: Stop, rng: Rng): number {
  const t: Tally = { below: 0, inside: 0, above: 0 };
  for (;;) {
    for (let i = 0; i < burstSize(c.s.n) && !decided(c.s.n, t); i++) t[sideOf(rng.next(), c.a, c.b)]++;
    if (decided(c.s.n, t) || stop(c, t)) return value(c, t);
  }
}

function mc(play: (rng: Rng) => number, rounds: number, seed: number, adaptive = false, maxRounds = 40_000_000) {
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

/** The eval configs, plus the edge-most (riskiest) allowed window for each. */
const CELLS = Object.entries(VOLATILITY).flatMap(([level, s]) => [
  { label: `${level}`, s },
  { label: `${level} edge`, s: { ...s, lo: loRange(s.n, s.width).max } },
]);

describe('Median fairness', () => {
  it('martingale, exhaustive: every live tally of every eval window (and every point count × width at the edges), E[V after one burst] = V (1e-12)', () => {
    const settings: Settings[] = [...CELLS.map((x) => x.s)];
    for (const n of POINTS) for (const width of WIDTHS) for (const lo of [loRange(n, width).min, loRange(n, width).max]) settings.push({ n, width, lo });
    let checked = 0;
    for (const s of settings) {
      const c = ctxOf(s);
      // From the bet: E[V after the first burst] = RTP.
      expect(Math.abs(burstOutcomes(c, { below: 0, inside: 0, above: 0 }).reduce((x, [p, u]) => x + p * value(c, u), 0) - RTP)).toBeLessThan(1e-12);
      for (let below = 0; below <= s.n; below++) {
        for (let inside = 0; below + inside <= s.n; inside++) {
          for (let above = 0; below + inside + above <= s.n; above++) {
            const t = { below, inside, above };
            if (decided(s.n, t)) continue;
            const v = value(c, t);
            const after = burstOutcomes(c, t).reduce((x, [p, u]) => x + p * value(c, u), 0);
            expect(Math.abs(after - v)).toBeLessThan(1e-12 * Math.max(1, v));
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it('martingale at 30 checkpoints reached by play: 100k bursts each with sideOf(rng.next()) within 4 SE of V', () => {
    const rng = createRng(seededSource(81));
    let states = 0;
    for (let guard = 0; states < 30 && guard < 10_000; guard++) {
      const c = ctxOf(CELLS[guard % CELLS.length].s);
      const t: Tally = { below: 0, inside: 0, above: 0 };
      const bursts = 1 + rng.int(4);
      for (let k = 0; k < bursts; k++) for (let i = 0; i < burstSize(c.s.n) && !decided(c.s.n, t); i++) t[sideOf(rng.next(), c.a, c.b)]++;
      if (decided(c.s.n, t)) continue;
      const v = value(c, t);
      let s1 = 0;
      let s2 = 0;
      const N = 100_000;
      for (let r = 0; r < N; r++) {
        const u = { ...t };
        for (let i = 0; i < burstSize(c.s.n) && !decided(c.s.n, u); i++) u[sideOf(rng.next(), c.a, c.b)]++;
        const x = value(c, u);
        s1 += x;
        s2 += x * x;
      }
      const mean = s1 / N;
      const se = Math.sqrt(Math.max(0, s2 / N - mean * mean) / N);
      expect(Math.abs(mean - v)).toBeLessThan(4 * se + 1e-9);
      states++;
    }
    expect(states).toBe(30);
  });

  it('strategies, exactly: every rule returns RTP to 1e-12 on every cell', () => {
    for (const { s } of CELLS) {
      const c = ctxOf(s);
      for (const { stop } of STRATEGIES) expect(Math.abs(exactValue(c, { below: 0, inside: 0, above: 0 }, stop) - RTP)).toBeLessThan(1e-12);
    }
  });

  it(`strategies, simulated with sideOf(rng.next()): every cell × rule within 4 SE of RTP${FULL ? ' (SE ≤ 0.3%)' : ''}`, () => {
    const rows: string[] = [];
    let seed = 900;
    for (const { label, s } of CELLS) {
      const c = ctxOf(s);
      for (const { name, stop } of STRATEGIES) {
        const r = mc((rng) => playRound(c, stop, rng), FULL ? 200_000 : 10_000, seed++, FULL);
        rows.push(`${label.padEnd(13)} lo=${String(s.lo).padEnd(3)} ${name.padEnd(32)} ${(100 * r.mean).toFixed(2)}% ± ${(100 * r.se).toFixed(2)}%  n=${r.n}  max=${r.max.toFixed(2)}`);
        expect(Math.abs(r.mean - RTP)).toBeLessThan(4 * r.se + 1e-9);
        expect(r.max).toBeLessThanOrEqual(c.prize + 1e-9);
      }
    }
    if (FULL) console.log(rows.join('\n'));
  }, 600_000);

  it('every allowed window pays at most MAX_PRIZE, the allowed positions are one contiguous range, and MAX_MULTIPLIER bounds them', () => {
    for (const n of POINTS) {
      for (const width of WIDTHS) {
        const { min, max } = loRange(n, width);
        expect(min).toBeLessThanOrEqual(max);
        for (let lo = 0; lo + width <= 100; lo++) {
          const ok = prizeFor({ n, width, lo }) <= MAX_PRIZE;
          expect(ok).toBe(lo >= min && lo <= max);
        }
      }
    }
    expect(MAX_MULTIPLIER).toBe(MAX_PRIZE);
  });
});
