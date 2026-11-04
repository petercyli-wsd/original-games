// Fairness audit: can any way of playing Needle beat the RTP?
//
// A round is n needles (1–3), each two reveals: the centre lands uniformly in
// the cell (a checkpoint, unless the spin is already decided: then it spins on
// its own), then the needle spins to a uniform direction. Side, floor, length
// and count are fixed at the bet (every control is disabled while live), so
// the only decision is when to cash out. The tester's rule fails exactly when
// the cash-out is a martingale across both kinds of reveal:
//
//   drop:  E_c[cashOutValue(k, landed c)] = cashOutValue(k, none)
//   spin:  P(onSide | c) · cashOutValue(k + 1, none) = cashOutValue(k, landed c)
//
// Both are checked with 100k draws of the real process (rng.next() → centre,
// π·rng.next() → θ, onSide through `crosses`), 4 SE, at 40+ states from
// random rounds over every floor, side, length and count, plus edge centres
// (on a line, at the reach limit d = ℓ/2, grid corners where the two bow-ties
// just meet). The spin chance is also checked deterministically on a 200k-angle
// grid. Strategies, per eval config (Game.tsx's flow, real functions):
//   (a) the tester's: spin or drop only when the next reveal's chance ≥ 0.8;
//   (b) take any profit: cash out the moment the cash-out exceeds the bet;
//   (c) play to the end;
//   (d) cherry-pick centres: cash out whenever the centre is worse than an
//       average one (r < p), always spin a good one.
// Note: a drop never loses by itself (its "chance" for rule (a) is the
// average p of the needle it starts).

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import {
  FLOORS,
  LENGTHS,
  MAX_MULTIPLIER,
  NEEDLES,
  RTP,
  SIDES,
  cashOutValue,
  onSide,
  prizeOf,
  sideChance,
  sideFraction,
  type Centre,
  type Settings,
} from './math';

/** Rounds per strategy run; the audit's 200k run sets FAIRNESS_ROUNDS=200000. */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 20_000);
const SAMPLES = 100_000;

/** Decision at a checkpoint: cash out now? `next` is the next reveal's win chance, `landed` the current centre (null between needles). */
type Stop = (s: Settings, k: number, cash: number, next: number, landed: Centre | null) => boolean;

/** One round exactly as Game.tsx plays it: drop (auto), checkpoint, spin, checkpoint between needles, … */
function playRound(s: Settings, stop: Stop, rng: Rng): number {
  const p = sideChance(s);
  for (let k = 0; k < s.needles; k++) {
    if (k > 0) {
      const cash = cashOutValue(s, { settled: k, landed: null });
      if (stop(s, k, cash, p, null)) return cash;
    }
    const centre = { u: rng.next(), v: rng.next() };
    const r = sideFraction(s, centre);
    if (r > 0 && r < 1) {
      const cash = cashOutValue(s, { settled: k, landed: centre });
      if (stop(s, k, cash, r, centre)) return cash;
    }
    const theta = Math.PI * rng.next();
    if (!onSide(s, centre, theta)) return 0;
  }
  return cashOutValue(s, { settled: s.needles, landed: null });
}

const STRATEGIES: { name: string; stop: Stop }[] = [
  { name: '(a) reveal only when ≥ 80% to win it', stop: (_s, _k, _c, next) => next < 0.8 },
  { name: '(b) take any profit', stop: (_s, _k, cash) => cash > 1 },
  { name: '(c) play to the end', stop: () => false },
  { name: '(d) cash out on a worse-than-average centre', stop: (s, _k, _c, next, landed) => landed !== null && next < sideChance(s) },
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

interface State {
  s: Settings;
  settled: number;
  landed: Centre | null;
}

function randomSettings(rng: Rng): Settings {
  return {
    floor: FLOORS[rng.int(FLOORS.length)],
    side: SIDES[rng.int(SIDES.length)],
    length: LENGTHS[rng.int(LENGTHS.length)],
    needles: NEEDLES[rng.int(NEEDLES.length)],
  };
}

/** Checkpoints met while playing random rounds to the end: between needles and with a centre down. */
function reachedStates(count: number, rng: Rng): State[] {
  const out: State[] = [];
  while (out.length < count) {
    const s = randomSettings(rng);
    for (let k = 0; k < s.needles; k++) {
      out.push({ s, settled: k, landed: null });
      const centre = { u: rng.next(), v: rng.next() };
      const r = sideFraction(s, centre);
      if (r > 0 && r < 1) out.push({ s, settled: k, landed: centre });
      if (!onSide(s, centre, Math.PI * rng.next())) break;
    }
  }
  return out;
}

/** Hand-built edge states: centre on a line, at the reach limit, at grid corners where the bow-ties meet. */
function edgeStates(): State[] {
  const out: State[] = [];
  for (const side of SIDES) {
    for (const needles of [1, 3] as const) {
      const lines: Settings = { floor: 'lines', side, length: 1, needles };
      const grid: Settings = { floor: 'grid', side, length: 0.8, needles };
      const settled = needles - 1;
      out.push({ s: lines, settled, landed: { u: 0.3, v: 0 } }); // on a line: always crosses
      out.push({ s: lines, settled, landed: { u: 0.3, v: 0.5 - 1e-9 } }); // at the reach limit
      out.push({ s: lines, settled, landed: { u: 0.3, v: 0.25 } });
      // Grid: ax + ay = π/2 exactly when dx = dy = h·cos(π/4).
      const d = 0.4 * Math.SQRT1_2;
      out.push({ s: grid, settled, landed: { u: d, v: d } });
      out.push({ s: grid, settled, landed: { u: d + 0.01, v: d + 0.01 } });
      out.push({ s: grid, settled, landed: { u: 0.02, v: 0.97 } });
    }
  }
  return out.filter((st) => {
    const r = sideFraction(st.s, st.landed!);
    return r > 0 && r < 1;
  });
}

describe('Needle fairness', () => {
  it('martingale at the drop: E[cash-out once the centre lands] = cash-out now (100k real drops, 4 SE)', () => {
    const rng = createRng(seededSource(801));
    const states = reachedStates(40, rng).filter((st) => st.landed === null);
    // Plus every volatility preset at its last needle (near the end of a round).
    for (const { params } of evalSpec.configs) states.push({ s: params, settled: params.needles - 1, landed: null });
    expect(states.length).toBeGreaterThanOrEqual(15);
    for (const st of states) {
      const v = cashOutValue(st.s, st);
      let sum = 0;
      let sum2 = 0;
      for (let i = 0; i < SAMPLES; i++) {
        const after = cashOutValue(st.s, { settled: st.settled, landed: { u: rng.next(), v: rng.next() } });
        sum += after;
        sum2 += after * after;
      }
      const mean = sum / SAMPLES;
      const se = Math.sqrt(Math.max(0, sum2 / SAMPLES - mean * mean) / SAMPLES);
      expect(Math.abs(mean - v)).toBeLessThan(4 * se + 1e-12);
    }
  });

  it('martingale at the spin: P(lands your way | centre) · next cash-out = cash-out now (100k real spins, 4 SE; 200k-angle grid to 1e-4)', () => {
    const rng = createRng(seededSource(802));
    const states = [...reachedStates(90, rng).filter((st) => st.landed !== null), ...edgeStates()];
    expect(states.length).toBeGreaterThanOrEqual(30);
    const GRID = 200_000;
    for (const st of states) {
      const c = st.landed!;
      const r = sideFraction(st.s, c);
      const v = cashOutValue(st.s, st);
      const won = cashOutValue(st.s, { settled: st.settled + 1, landed: null });
      let wins = 0;
      for (let i = 0; i < SAMPLES; i++) if (onSide(st.s, c, Math.PI * rng.next())) wins++;
      const se = Math.sqrt((r * (1 - r)) / SAMPLES);
      expect(Math.abs(wins / SAMPLES - r)).toBeLessThan(4 * se + 1e-12);
      expect(Math.abs((wins / SAMPLES) * won - v)).toBeLessThan(4 * se * won + 1e-12);
      // Exact fair factor, and the angle measure itself on a fine grid (at most 4 boundaries, each off by ≤ 1 cell).
      expect(Math.abs(r * won - v)).toBeLessThan(1e-12 * won);
      let onGrid = 0;
      for (let i = 0; i < GRID; i++) if (onSide(st.s, c, (Math.PI * (i + 0.5)) / GRID)) onGrid++;
      expect(Math.abs(onGrid / GRID - r)).toBeLessThan(4 / GRID + 1e-9);
    }
  });

  it('a decided centre (every direction wins, or none) is not a checkpoint and its value is the decided outcome', () => {
    const rng = createRng(seededSource(803));
    let seen = 0;
    let wrong = 0;
    for (let i = 0; i < 20_000; i++) {
      const s = randomSettings(rng);
      const c = { u: rng.next(), v: rng.next() };
      const r = sideFraction(s, c);
      if (r > 0 && r < 1) continue;
      seen++;
      for (let j = 0; j < 20; j++) if (onSide(s, c, Math.PI * rng.next()) !== (r === 1)) wrong++;
    }
    expect(seen).toBeGreaterThan(100);
    expect(wrong).toBe(0);
  });

  it('strategies (a)–(d) on every eval config return RTP within 4 SE, never above the max', () => {
    const rows: string[] = [];
    evalSpec.configs.forEach(({ label, params }, ci) => {
      STRATEGIES.forEach(({ name, stop }, si) => {
        const res = mc((r) => playRound(params, stop, r), ROUNDS, 8100 + 13 * ci + si);
        rows.push(`${label.padEnd(44)} ${name.padEnd(44)} ${(res.mean * 100).toFixed(2)}% ± ${(res.se * 100).toFixed(2)}%  max ${res.max.toFixed(2)}×`);
        expect(Math.abs(res.mean - RTP)).toBeLessThan(4 * res.se + 1e-12);
        expect(res.max).toBeLessThanOrEqual(Math.min(MAX_MULTIPLIER, prizeOf(params)) + 1e-9);
      });
    });
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
