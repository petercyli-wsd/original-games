// Fairness audit: can any way of playing Lighthouse beat the RTP?
//
// A round is a two-stage reveal. The window (distance) is fixed at the bet:
// Game.tsx locks round.win, and the slider, chips and board drag are all
// disabled while live. Then:
//   1. the tower stops at h = towerHeight(rng.next()), uniform on [H_MIN, H_MAX];
//      checkpoint: cash out at prize × P(win | h), or fire;
//   2. the beam fires at θ = fireAngle(rng.next()), uniform on the fan, and
//      wins the prize iff lands(win, h, θ).
// The only decision is cash out or fire at the one checkpoint, so the game is
// fair iff both reveals are martingales for the cash-out. Both are checked
// here with the game's own functions, in the order Game.tsx calls them.
//
// Strategies, per eval config (window distance), against RTP:
//   (a) the tester's: fire only when the beam's hit chance is ≥ 80%, else cash out;
//   (b) take any profit: cash out when the cash-out is above the bet;
//   (c) always fire;
//   (d) bank a widened slice (P(win | h) > P₀), fire a narrowed one;
//   (d') the reverse: fire only when the tower widened the slice.
// Far windows are heavy-tailed under (c) (P₀ ≈ 0.7%, prize ≈ 140×), so the
// default run checks 4 SE at a few thousand rounds; FAIRNESS_FULL=1 runs each
// cell until its standard error is ≤ 0.3% (scratch fairness/run-full.sh).

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { H_MAX, H_MIN, PRESETS, PRESET_IDS, RTP, chanceAt, fireAngle, headlineChance, lands, prizeFor, snapDist, towerHeight, windowAt, type Win } from './math';

const FULL = !!import.meta.env.FAIRNESS_FULL;
/** Samples per martingale state. */
const SAMPLES = 100_000;

interface Checkpoint {
  win: Win;
  prize: number;
  p0: number;
  /** P(win | h). */
  p: number;
  cash: number;
}

/** Cash out at the checkpoint? */
type Stop = (c: Checkpoint) => boolean;

/** One round as Game.tsx plays it: start() draws the tower, fire() draws the beam. */
function playRound(win: Win, stop: Stop, rng: Rng): number {
  const prize = prizeFor(win);
  const p0 = headlineChance(win);
  const h = towerHeight(rng.next());
  const p = chanceAt(win, h);
  const cash = prize * p;
  if (stop({ win, prize, p0, p, cash })) return cash;
  return lands(win, h, fireAngle(rng.next())) ? prize : 0;
}

const STRATEGIES: { name: string; stop: Stop }[] = [
  { name: '(a) fire only at ≥ 80% hit', stop: (c) => c.p < 0.8 },
  { name: '(b) take any profit', stop: (c) => c.cash > 1 },
  { name: '(c) always fire', stop: () => false },
  { name: '(d) bank a widened slice', stop: (c) => c.p > c.p0 },
  { name: "(d') fire only when widened", stop: (c) => c.p <= c.p0 },
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

/** A spread of legal windows: the presets, both ends, and random snapped distances. */
function windows(rng: Rng): Win[] {
  const ds = [...PRESET_IDS.map((id) => PRESETS[id].dist), 0.1, 0.5, 1, 7.9];
  for (let i = 0; i < 6; i++) ds.push(snapDist(rng.next() * 8));
  return ds.map(windowAt);
}

describe('Lighthouse fairness', () => {
  it('martingale, tower stage: E[cash-out once the tower stops] = RTP for every window (100k heights each, 4 SE, and Simpson to 1e-9)', () => {
    const rng = createRng(seededSource(41));
    for (const win of windows(rng)) {
      const prize = prizeFor(win);
      let s = 0;
      let s2 = 0;
      for (let i = 0; i < SAMPLES; i++) {
        const v = prize * chanceAt(win, towerHeight(rng.next()));
        s += v;
        s2 += v * v;
      }
      const mean = s / SAMPLES;
      const se = Math.sqrt((s2 / SAMPLES - mean * mean) / SAMPLES);
      expect(Math.abs(mean - RTP)).toBeLessThan(4 * se);

      // Exact: towerHeight maps [0, 1) linearly onto [H_MIN, H_MAX), so the
      // average is the integral, here by composite Simpson.
      const n = 2000;
      const d = (H_MAX - H_MIN) / n;
      let acc = chanceAt(win, H_MIN) + chanceAt(win, H_MAX);
      for (let i = 1; i < n; i++) acc += (i % 2 ? 4 : 2) * chanceAt(win, H_MIN + i * d);
      expect(Math.abs((prize * acc * d) / 3 / (H_MAX - H_MIN) - RTP)).toBeLessThan(1e-9);
    }
  });

  it('martingale, beam stage: at 30+ checkpoints (incl. the tallest and shortest towers), firing pays the prize with exactly P(win | h) (100k beams each, 4 SE)', () => {
    const rng = createRng(seededSource(42));
    const states: { win: Win; h: number }[] = [];
    const ws = windows(rng);
    // Random rounds' checkpoints, plus the extreme heights for every window.
    while (states.length < 30) states.push({ win: ws[rng.int(ws.length)], h: towerHeight(rng.next()) });
    for (const win of [windowAt(0), windowAt(8), windowAt(3)]) states.push({ win, h: H_MIN }, { win, h: towerHeight(1 - 2 ** -32) });

    for (const { win, h } of states) {
      const prize = prizeFor(win);
      const p = chanceAt(win, h);
      expect(p).toBeGreaterThan(0);
      expect(p).toBeLessThan(1);
      let hits = 0;
      for (let i = 0; i < SAMPLES; i++) if (lands(win, h, fireAngle(rng.next()))) hits++;
      // E[V after] = prize · P̂(hit), against V now = prize · p.
      const se = prize * Math.sqrt((p * (1 - p)) / SAMPLES);
      expect(Math.abs((prize * hits) / SAMPLES - prize * p)).toBeLessThan(4 * se);
      // Exactly: fireAngle is linear in u, so the hit set is a u-interval of length (β − α)/π = p.
      const uLo = (Math.atan2(win.a, h) + Math.PI / 2) / Math.PI;
      const uHi = (Math.atan2(win.b, h) + Math.PI / 2) / Math.PI;
      expect(Math.abs(uHi - uLo - p)).toBeLessThan(1e-12);
      expect(lands(win, h, fireAngle(uLo + 1e-9))).toBe(true);
      expect(lands(win, h, fireAngle(uHi - 1e-9))).toBe(true);
      expect(lands(win, h, fireAngle(Math.max(0, uLo - 1e-6)))).toBe(uLo < 1e-6);
      expect(lands(win, h, fireAngle(Math.min(1 - 2 ** -32, uHi + 1e-6)))).toBe(false);
    }
  });

  it('the cash-out never exceeds the prize, so the max win is the prize of the farthest window', () => {
    const rng = createRng(seededSource(43));
    let worstShare = 0;
    let maxPrize = 0;
    for (let i = 0; i < 20_000; i++) {
      const win = windowAt(snapDist(rng.next() * 8));
      const h = towerHeight(rng.next());
      worstShare = Math.max(worstShare, chanceAt(win, h));
      maxPrize = Math.max(maxPrize, prizeFor(win));
    }
    expect(worstShare).toBeLessThan(1);
    expect(maxPrize).toBeLessThanOrEqual(prizeFor(windowAt(8)) * (1 + 1e-12));
  });

  it('strategies (a)–(d′) on every eval config return RTP within 4 SE', () => {
    const rows: string[] = [];
    evalSpec.configs.forEach(({ label, params: { win } }, ci) => {
      STRATEGIES.forEach(({ name, stop }, si) => {
        const { mean, se, max, n } = mc((r) => playRound(win, stop, r), FULL ? 200_000 : 20_000, 7300 + 17 * ci + si, FULL);
        rows.push(`${label.padEnd(40)} ${name.padEnd(30)} ${(mean * 100).toFixed(2)}% ± ${(se * 100).toFixed(2)}%  n ${n}  max ${max.toFixed(1)}×`);
        expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-12);
        expect(max).toBeLessThanOrEqual(prizeFor(win) + 1e-9);
      });
    });
    if (FULL) console.log(rows.join('\n'));
  });
});
