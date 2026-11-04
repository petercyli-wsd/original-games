// Fairness audit: can any way of playing Line Cut beat the RTP?
//
// The shape is fixed at the bet (round.shape; the chips are disabled while
// live). A round is a two-stage reveal, exactly as Game.tsx draws it:
//   1. aim(): φ = direction(rng.next()), uniform on a half-turn; checkpoint:
//      cash out at prize × aimedCutChance(shape, φ), or drop the line;
//   2. cut(): p = offset(rng.next()), uniform on [−1, 1); wins the prize iff
//      lineHits(shape, φ, p).
// The only decision is cash out or drop at the one checkpoint, so the game is
// fair iff both reveals are martingales for the cash-out. Stage 2 also needs
// every shadow to sit inside the ruler [−1, 1]: a shadow sticking out would
// overstate the hit chance and so the cash-out.
//
// Strategies, for every shape in every eval config, against RTP:
//   (a) the tester's: drop only when the shadow is ≥ 80% of the ruler, else cash out;
//   (b) take any profit: cash out when the cash-out is above the bet;
//   (c) always drop the line;
//   (d) bank a wide shadow (above the shape's average), drop on a narrow one;
//   (d') the reverse: drop only on a wide shadow.
// The pin (2%, 49.5×) is heavy-tailed under (c), so the default run checks
// 4 SE at a few thousand rounds; FAIRNESS_FULL=1 runs each cell until its
// standard error is ≤ 0.3% (scratch fairness/run-full.sh).

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { RTP, SHAPES, SHAPE_IDS, aimedCutChance, direction, lineHits, offset, prizeFor, shadow, winChance, type ShapeId } from './math';

const FULL = !!import.meta.env.FAIRNESS_FULL;
/** Samples per martingale state. */
const SAMPLES = 100_000;

interface Checkpoint {
  prize: number;
  /** The shape's average shadow, P(win) at the bet. */
  c: number;
  /** The aimed shadow share, P(win | φ). */
  s: number;
  cash: number;
}

type Stop = (k: Checkpoint) => boolean;

/** One round as Game.tsx plays it: aim() draws the direction, cut() the offset. */
function playRound(id: ShapeId, stop: Stop, rng: Rng): number {
  const shape = SHAPES[id];
  const prize = prizeFor(id);
  const phi = direction(rng.next());
  const s = aimedCutChance(shape, phi);
  const cash = prize * s;
  if (stop({ prize, c: winChance(id), s, cash })) return cash;
  return lineHits(shape, phi, offset(rng.next())) ? prize : 0;
}

const STRATEGIES: { name: string; stop: Stop }[] = [
  { name: '(a) drop only at ≥ 80% shadow', stop: (k) => k.s < 0.8 },
  { name: '(b) take any profit', stop: (k) => k.cash > 1 },
  { name: '(c) always drop', stop: () => false },
  { name: '(d) bank a wide shadow', stop: (k) => k.s > k.c },
  { name: "(d') drop only on a wide shadow", stop: (k) => k.s <= k.c },
];

/** Monte Carlo mean and SE; in full mode keeps going (100k chunks) until SE ≤ 0.3% or maxRounds. */
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

describe('Line Cut fairness', () => {
  it('martingale, aim stage: E[cash-out once aimed] = RTP for every shape (100k directions, 4 SE; and a 200k-point quadrature to 1e-8)', () => {
    const rng = createRng(seededSource(51));
    for (const id of SHAPE_IDS) {
      const prize = prizeFor(id);
      let s = 0;
      let s2 = 0;
      for (let i = 0; i < SAMPLES; i++) {
        const v = prize * aimedCutChance(SHAPES[id], direction(rng.next()));
        s += v;
        s2 += v * v;
      }
      const mean = s / SAMPLES;
      const se = Math.sqrt((s2 / SAMPLES - mean * mean) / SAMPLES);
      expect(Math.abs(mean - RTP)).toBeLessThan(4 * se);
      // direction() maps [0, 1) linearly onto the half-turn: midpoint rule over u.
      const n = 200_000;
      let acc = 0;
      for (let i = 0; i < n; i++) acc += aimedCutChance(SHAPES[id], direction((i + 0.5) / n));
      expect(Math.abs((prize * acc) / n - RTP)).toBeLessThan(1e-8);
    }
  });

  it('martingale, cut stage: at 30+ aimed states (incl. end-on and side-on), dropping the line pays the prize with exactly the shadow share (100k offsets, 4 SE)', () => {
    const rng = createRng(seededSource(52));
    const states: { id: ShapeId; phi: number }[] = [];
    while (states.length < 30) states.push({ id: SHAPE_IDS[rng.int(SHAPE_IDS.length)], phi: direction(rng.next()) });
    // The rod and pin end-on (narrowest) and side-on (widest), and both ends of the direction range.
    for (const id of ['rod', 'pin'] as ShapeId[]) {
      const [a, b] = SHAPES[id].verts;
      const along = Math.atan2(b.y - a.y, b.x - a.x);
      const wrap = (x: number) => x - Math.PI * Math.floor((x + Math.PI / 2) / Math.PI);
      states.push({ id, phi: wrap(along) }, { id, phi: wrap(along + Math.PI / 2) });
    }
    for (const id of SHAPE_IDS) states.push({ id, phi: direction(0) }, { id, phi: direction(1 - 2 ** -32) });

    for (const { id, phi } of states) {
      const sh = SHAPES[id];
      const s = aimedCutChance(sh, phi);
      const { lo, hi } = shadow(sh, phi);
      // The shadow sits on the ruler, so the hit set of offsets has length exactly 2s.
      expect(lo).toBeGreaterThanOrEqual(-1);
      expect(hi).toBeLessThanOrEqual(1);
      let hits = 0;
      for (let i = 0; i < SAMPLES; i++) if (lineHits(sh, phi, offset(rng.next()))) hits++;
      const se = Math.sqrt(Math.max(s * (1 - s), 1 / SAMPLES) / SAMPLES);
      expect(Math.abs(hits / SAMPLES - s)).toBeLessThan(4 * se);
      // Exactly: offset is linear in u, the hit set is u ∈ [(lo+1)/2, (hi+1)/2], of length s.
      expect(Math.abs((hi + 1) / 2 - (lo + 1) / 2 - s)).toBeLessThan(1e-15);
    }
  });

  it('every shadow over every direction stays on the ruler, and the cash-out never exceeds the prize', () => {
    for (const id of SHAPE_IDS) {
      let minLo = Infinity;
      let maxHi = -Infinity;
      let maxS = 0;
      for (let i = 0; i <= 20_000; i++) {
        const phi = direction(Math.min(i / 20_000, 1 - 2 ** -32));
        const { lo, hi } = shadow(SHAPES[id], phi);
        minLo = Math.min(minLo, lo);
        maxHi = Math.max(maxHi, hi);
        maxS = Math.max(maxS, aimedCutChance(SHAPES[id], phi));
      }
      // Stronger than sampling: every vertex lies in the unit disc, so every shadow is inside [−1, 1].
      for (const v of SHAPES[id].verts) expect(Math.hypot(v.x, v.y)).toBeLessThan(1);
      expect(minLo).toBeGreaterThanOrEqual(-1);
      expect(maxHi).toBeLessThanOrEqual(1);
      expect(maxS).toBeLessThan(1);
    }
  });

  it('strategies (a)–(d′) for every shape of every eval config return RTP within 4 SE', () => {
    const rows: string[] = [];
    const shapes = evalSpec.configs.flatMap(({ label, params }) => params.shapes.map((id) => ({ label, id })));
    expect(new Set(shapes.map((x) => x.id)).size).toBe(SHAPE_IDS.length);
    shapes.forEach(({ label, id }, ci) => {
      STRATEGIES.forEach(({ name, stop }, si) => {
        const { mean, se, max, n } = mc((r) => playRound(id, stop, r), FULL ? 200_000 : 20_000, 8100 + 17 * ci + si, FULL);
        rows.push(`${label.split(' ')[0].padEnd(8)} ${id.padEnd(9)} ${name.padEnd(32)} ${(mean * 100).toFixed(2)}% ± ${(se * 100).toFixed(2)}%  n ${n}  max ${max.toFixed(2)}×`);
        expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-12);
        expect(max).toBeLessThanOrEqual(prizeFor(id) + 1e-9);
      });
    });
    if (FULL) console.log(rows.join('\n'));
  });
});
