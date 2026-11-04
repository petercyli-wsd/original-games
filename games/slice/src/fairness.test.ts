// Fairness audit: can any way of playing Slice beat the RTP?
//
// The dot is drawn uniformly in the square once the stake is placed (after
// the circle, size and cut count are locked). Each cut is drawn by
// `sampleCut(region, rng)`, which never looks at the dot, so given the cuts so
// far the dot is uniform over the region and the cash-out M · area(circle ∩
// region) / area(region) is a martingale. The only decision is at a
// checkpoint: cash out, or cut again (by hand or Auto-cut).
//
// Binding check (exact, per cut): at ≥ 30 varied states and for 400 real
// cuts at each, the expected value after the cut, averaged over which half
// holds the dot (each half with chance area share), equals the value now to
// 1e-9. The value after the cut comes from the real `cutRound()` (with a dot
// placed in that half) and `cashMultiplier()`, including the covered,
// sliced-away and final-reveal endings; on the final cut it is M × the half's
// win chance, the expectation of the reveal over a uniform dot in that half.
// Conditioning on the cut is stronger than averaging over it: it also shows
// that seeing the blade (or inferring the cut early) cannot help.
//
// Monte Carlo: the same step with the dot and the cut both sampled (100k per
// state), then (a)–(d) and the eval mix over whole rounds on the real code.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  CUT_OPTIONS,
  MODE_NAMES,
  RTP,
  cashMultiplier,
  centroid,
  clipHalfPlane,
  cutRound,
  newRound,
  polygonArea,
  radiusFor,
  randomPointIn,
  sampleCut,
  winChance,
  type Cut,
  type Mode,
  type Pt,
  type Round,
} from './math';

const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 20_000);
const STEP_SAMPLES = Number(import.meta.env.FAIRNESS_ROUNDS ? 100_000 : 20_000);

/** RTP = mean payout per unit stake, with its standard error. */
function mc(play: (rng: Rng) => number, rounds: number, seed: number) {
  const rng = createRng(seededSource(seed));
  let s = 0;
  let s2 = 0;
  let max = 0;
  for (let i = 0; i < rounds; i++) {
    const m = play(rng);
    s += m;
    s2 += m * m;
    if (m > max) max = m;
  }
  const mean = s / rounds;
  return { rtp: mean, se: Math.sqrt(Math.max(0, s2 / rounds - mean * mean) / rounds), max };
}

/** E[value after this cut | cut], exactly, over which half holds the (uniform) dot. */
function expectedAfter(round: Round, cut: Cut): number {
  const A = polygonArea(round.region);
  let e = 0;
  for (const side of [1, -1] as const) {
    const half = clipHalfPlane(round.region, cut, side);
    const a = half.length >= 3 ? polygonArea(half) : 0;
    if (a <= 0) continue;
    // A dot strictly inside this half (its centroid) makes cutRound keep this half.
    const next = cutRound({ ...round, dot: centroid(half) }, cut);
    expect(Math.abs(polygonArea(next.region) - a)).toBeLessThan(1e-12);
    const p = winChance(round.circle, half);
    let v: number;
    if (next.outcome === 'hit' || next.outcome === 'miss') {
      // The final reveal: mult if the dot is in the circle, else 0, averaged over a uniform dot in the half.
      v = round.mult * p;
    } else {
      v = cashMultiplier(next);
      // The covered / sliced-away endings agree with the half's win chance.
      if (next.outcome === 'covered') expect(p).toBe(1);
      if (next.outcome === 'missed') expect(p).toBe(0);
      if (next.outcome === 'live') expect(Math.abs(v - round.mult * p)).toBeLessThan(1e-12);
    }
    e += (a / A) * v;
  }
  return e;
}

/** A random circle centre: anywhere, or pushed into a corner or against an edge. */
function randomCentre(rng: Rng): Pt {
  const u = rng.next();
  if (u < 0.25) return { x: 0, y: 0 };
  if (u < 0.4) return { x: 1, y: rng.next() };
  return { x: rng.next(), y: rng.next() };
}

/** Reaches varied live checkpoints with the real code (random mode, centre, cut count and depth). */
function reachStates(rng: Rng, want: number): Round[] {
  const out: Round[] = [];
  while (out.length < want) {
    const mode = MODE_NAMES[rng.int(MODE_NAMES.length)];
    const maxCuts = CUT_OPTIONS[rng.int(CUT_OPTIONS.length)];
    // Bias toward deep states: half stop right before the final cut.
    const depth = rng.next() < 0.5 ? maxCuts - 1 : rng.int(maxCuts);
    let r = newRound(mode, randomCentre(rng), maxCuts, { x: rng.next(), y: rng.next() });
    while (r.outcome === 'live' && r.slices.length < depth) r = cutRound(r, sampleCut(r.region, rng));
    if (r.outcome === 'live') out.push(r);
  }
  return out;
}

type Policy = (r: Round, p0: number) => boolean; // true = cash out at this checkpoint

/** One round as App.tsx plays it: the first cut is part of the bet, then the policy decides at each checkpoint. */
function playRound(mode: Mode, maxCuts: number, centre: Pt, rng: Rng, cashOut: Policy): number {
  let r = newRound(mode, centre, maxCuts, { x: rng.next(), y: rng.next() });
  const p0 = r.chance;
  r = cutRound(r, sampleCut(r.region, rng));
  while (r.outcome === 'live' && !cashOut(r, p0)) r = cutRound(r, sampleCut(r.region, rng));
  return cashMultiplier(r);
}

const POLICIES: Record<string, Policy> = {
  // (a) Cut again only while the chance of not losing is ≥ 0.8 (the win chance P_t, the chance the dot ends inside).
  '(a) cut iff P ≥ 0.8': (r) => r.chance < 0.8,
  '(b) cash once V > 1': (r) => cashMultiplier(r) > 1,
  '(c) play to the reveal': () => false,
  // (d1) Cut losses: cash as soon as the chance falls below where it started; ride rises.
  '(d1) cash when P < P0': (r, p0) => r.chance < p0,
  // (d2) Lock in a jump: cash once the chance has doubled.
  '(d2) cash when P ≥ 2·P0': (r, p0) => r.chance >= 2 * p0,
  // (d3) Cash right before the reveal only if the chance is under a half (dodge a likely miss).
  '(d3) dodge an unlikely reveal': (r) => r.slices.length === r.maxCuts - 1 && r.chance < 0.5,
};

describe('Slice fairness', () => {
  it('martingale, exact per cut: at ≥ 30 varied states, every real cut keeps E[value after] = value now', () => {
    const rng = createRng(seededSource(2024));
    const states = reachStates(rng, 40);
    let lastCut = 0;
    let worst = 0;
    for (const r of states) {
      const now = cashMultiplier(r);
      if (r.slices.length === r.maxCuts - 1) lastCut++;
      for (let i = 0; i < 400; i++) {
        const e = expectedAfter(r, sampleCut(r.region, rng));
        worst = Math.max(worst, Math.abs(e - now));
      }
    }
    // The start (the first cut is part of the bet), for every size and a cornered circle.
    for (const mode of MODE_NAMES) {
      const r = newRound(mode, { x: 0, y: 1 }, 6, { x: 0.5, y: 0.5 });
      expect(Math.abs(cashMultiplier(r) - RTP)).toBeLessThan(1e-12);
      for (let i = 0; i < 400; i++) worst = Math.max(worst, Math.abs(expectedAfter(r, sampleCut(r.region, rng)) - RTP));
    }
    expect(lastCut).toBeGreaterThan(5);
    expect(worst).toBeLessThan(1e-9);
  });

  it('martingale, sampled: dot and cut both drawn by the real code, mean value after = value now (4 SE)', () => {
    const rng = createRng(seededSource(77));
    for (const r of reachStates(rng, 4)) {
      const now = cashMultiplier(r);
      let s = 0;
      let s2 = 0;
      for (let i = 0; i < STEP_SAMPLES; i++) {
        const v = cashMultiplier(cutRound({ ...r, dot: randomPointIn(r.region, rng) }, sampleCut(r.region, rng)));
        s += v;
        s2 += v * v;
      }
      const mean = s / STEP_SAMPLES;
      const se = Math.sqrt((s2 / STEP_SAMPLES - mean * mean) / STEP_SAMPLES);
      expect(Math.abs(mean - now)).toBeLessThan(4 * se + 1e-12);
    }
  });

  it('the circle size, position and cut count do not change the starting value', () => {
    for (const mode of MODE_NAMES)
      for (const c of [
        { x: 0, y: 0 },
        { x: 0.5, y: 0.5 },
        { x: 1, y: 0.3 },
      ])
        for (const k of CUT_OPTIONS) {
          const r = newRound(mode, c, k, { x: 0, y: 0 });
          expect(Math.abs(cashMultiplier(r) - RTP)).toBeLessThan(1e-12);
          // Wholly inside the square.
          expect(r.circle.cx - r.circle.r).toBeGreaterThanOrEqual(0);
          expect(r.circle.cx + r.circle.r).toBeLessThanOrEqual(1);
          expect(r.circle.r).toBeCloseTo(radiusFor(mode), 15);
        }
  });

  it('strategies: (a)–(d) on the real code for every eval config, plus the eval mix: RTP within 4 SE', () => {
    const rows: string[] = [];
    evalSpec.configs.forEach(({ label, params }, ci) => {
      Object.entries(POLICIES).forEach(([name, policy], pi) => {
        const r = mc(
          (rng) => playRound(params.mode, CUT_OPTIONS[rng.int(CUT_OPTIONS.length)], randomCentre(rng), rng, policy),
          ROUNDS,
          8100 + 10 * ci + pi,
        );
        rows.push(`${label.padEnd(8)} ${name.padEnd(30)} ${(r.rtp * 100).toFixed(3)}% ± ${(r.se * 100).toFixed(3)}%  max ${r.max.toFixed(2)}`);
        expect(Math.abs(r.rtp - RTP)).toBeLessThan(4 * r.se);
        expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier + 1e-9);
      });
      const e = mc((rng) => evalSpec.playRound(params, rng).multiplier, ROUNDS, 8900 + ci);
      rows.push(`${label.padEnd(8)} ${'eval mix'.padEnd(30)} ${(e.rtp * 100).toFixed(3)}% ± ${(e.se * 100).toFixed(3)}%`);
      expect(Math.abs(e.rtp - RTP)).toBeLessThan(4 * e.se);
    });
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
