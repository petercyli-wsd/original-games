import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  FIELD,
  GAITS,
  LEG,
  MAX_WIN,
  RTP,
  TRACKS,
  U,
  chanceOf,
  indexTime,
  leg,
  legOutcomes,
  payout,
  remainingTable,
  startChances,
  startPrize,
  switchPrize,
  tick,
  winChances,
  type Track,
} from './math';

const rng = createRng(seededSource(11));
const n = FIELD.length;

/** Plays the raw race from `pos` to the line; returns each runner's share of the win. */
function race(pos: readonly number[], L: number): number[] {
  let x = pos.slice();
  for (;;) {
    const t = tick(x, L, rng.next);
    if (t.winners) return FIELD.map((_, i) => (t.winners!.includes(i) ? 1 / t.winners!.length : 0));
    x = t.pos;
  }
}

/** A random reachable mid-race position (nobody across yet). */
function midRace(L: number, legs: number): number[] {
  for (;;) {
    let x = FIELD.map(() => 0);
    let ok = true;
    for (let k = 0; k < legs && ok; k++) {
      const ticks = leg(x, L, rng.next);
      const last = ticks[ticks.length - 1];
      if (last.winners) ok = false;
      else x = last.pos;
    }
    if (ok) return x;
  }
}

describe('Derby maths', () => {
  it('each crossing-time table is a probability distribution, and Steady always finishes within L ticks', () => {
    for (const L of TRACKS) {
      for (const r of FIELD) {
        const R = remainingTable(r.gait, L);
        for (let x = 0; x < L; x++) {
          const mass = R[x].reduce((a, b) => a + b, 0);
          if (r.gait === 'steady' || r.gait === 'plodder') expect(mass).toBeCloseTo(1, 12);
          else expect(mass).toBeLessThanOrEqual(1 + 1e-12);
        }
      }
      // Steady from the start: its mean crossing time is (L − ½·E[overshoot-free part]) ≈ L/1.5 ticks.
      const steady = remainingTable('steady', L)[0];
      const mean = steady.reduce((m, p, i) => m + p * indexTime(i), 0);
      expect(mean).toBeGreaterThan(L / 1.5 - 1.5);
      expect(mean).toBeLessThan(L / 1.5 + 0.5);
    }
  });

  it('the starting odds sum to 1 and match a direct simulation of the race', () => {
    for (const L of TRACKS) {
      const P = startChances(L);
      expect(P.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
      const rounds = 12_000;
      const share = new Array(n).fill(0);
      for (let r = 0; r < rounds; r++) race(FIELD.map(() => 0), L).forEach((s, i) => (share[i] += s));
      for (let i = 0; i < n; i++) {
        const se = Math.sqrt((P[i] * (1 - P[i])) / rounds);
        expect(Math.abs(share[i] / rounds - P[i])).toBeLessThan(4 * se + 1e-3);
      }
    }
  });

  it('the live tote at mid-race positions matches a simulation from there', () => {
    for (const L of TRACKS) {
      const pos = midRace(L, 2);
      const P = winChances(pos, L);
      expect(P.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
      for (let i = 0; i < n; i++) expect(chanceOf(pos, L, i)).toBeCloseTo(P[i], 12);
      const rounds = 8_000;
      const share = new Array(n).fill(0);
      for (let r = 0; r < rounds; r++) race(pos, L).forEach((s, i) => (share[i] += s));
      for (let i = 0; i < n; i++) {
        const se = Math.sqrt((P[i] * (1 - P[i])) / rounds);
        expect(Math.abs(share[i] / rounds - P[i])).toBeLessThan(4 * se + 1e-3);
      }
    }
  });

  it('martingale: over every joint stride of the next tick, E[chance after] = chance now, for every runner', () => {
    for (const L of TRACKS) {
      for (let trial = 0; trial < 6; trial++) {
        const pos = midRace(L, trial % 4);
        const P = winChances(pos, L);
        const laws = FIELD.map((r, i) => GAITS[r.gait].law(pos[i], L));
        const expected = new Array(n).fill(0);
        const walk = (i: number, strides: number[], prob: number) => {
          if (i === n) {
            const crossed = strides.map((s, j) => (s > 0 && pos[j] + s >= L ? (U * (L - pos[j])) / s : Infinity));
            const best = Math.min(...crossed);
            if (best < Infinity) {
              const winners = crossed.map((c, j) => (c === best ? j : -1)).filter((j) => j >= 0);
              for (let j = 0; j < n; j++) expected[j] += prob * payout(1, j, winners);
            } else {
              const after = winChances(pos.map((x, j) => x + strides[j]), L);
              for (let j = 0; j < n; j++) expected[j] += prob * after[j];
            }
            return;
          }
          for (const [s, p] of laws[i]) walk(i + 1, [...strides, s], prob * p);
        };
        walk(0, [], 1);
        for (let j = 0; j < n; j++) expect(Math.abs(expected[j] - P[j])).toBeLessThan(1e-9);
      }
    }
  });

  it('the next-leg outcomes drawn for your runner average to your chance now, and match a simulation', () => {
    for (const L of TRACKS) {
      const pos = midRace(L, 1);
      for (let me = 0; me < n; me++) {
        const outs = legOutcomes(pos, L, me);
        expect(outs.reduce((s, o) => s + o.prob, 0)).toBeCloseTo(1, 12);
        expect(outs.reduce((s, o) => s + o.prob * o.chance, 0)).toBeCloseTo(winChances(pos, L)[me], 10);
      }
    }
    // Simulate one state: run raw races, and group them by how far runner `me`
    // goes in the next leg (its strides are drawn for the whole leg even if
    // another runner wins first, exactly as legOutcomes conditions on them).
    const L: Track = 20;
    const pos = midRace(L, 1);
    for (const me of [0, 1]) {
      const outs = legOutcomes(pos, L, me);
      const tally = new Map<number, { n: number; won: number }>();
      const rounds = 10_000;
      for (let r = 0; r < rounds; r++) {
        let x = pos.slice();
        let result: number | null = null;
        let mine = pos[me];
        for (let k = 0; k < LEG; k++) {
          if (mine >= L) break;
          if (result === null) {
            const t = tick(x, L, rng.next);
            mine = t.pos[me];
            if (t.winners) result = payout(1, me, t.winners);
            x = t.pos;
          } else {
            const law = GAITS[FIELD[me].gait].law(mine, L);
            const u = rng.next();
            let acc = 0;
            for (const [st, p] of law) {
              acc += p;
              if (u < acc) {
                mine += st;
                break;
              }
            }
          }
        }
        if (result === null) result = race(x, L)[me];
        const adv = mine - pos[me];
        const g = tally.get(adv) ?? { n: 0, won: 0 };
        g.n++;
        g.won += result;
        tally.set(adv, g);
      }
      for (const o of outs) {
        const g = tally.get(o.advance);
        if (!g) continue;
        expect(Math.abs(g.n / rounds - o.prob)).toBeLessThan(4 * Math.sqrt((o.prob * (1 - o.prob)) / rounds) + 1e-3);
        const se = Math.sqrt((o.chance * (1 - o.chance)) / g.n);
        expect(Math.abs(g.won / g.n - o.chance)).toBeLessThan(4 * se + 2e-3);
      }
    }
  });

  it('switching keeps the value and relocks the prize at value / P(new)', () => {
    const pos = midRace(30, 2);
    const P = winChances(pos, 30);
    const value = 0.73;
    for (let j = 0; j < n; j++) {
      const prize = switchPrize(value, P[j]);
      if (prize === null) expect(P[j] <= 0 || value / P[j] > MAX_WIN).toBe(true);
      else expect(prize * P[j]).toBeCloseTo(value, 12);
    }
    expect(switchPrize(1, 0)).toBeNull();
    expect(switchPrize(2, 1 / 1000)).toBeNull();
  });

  it('every starting prize is RTP / chance and below the cap', () => {
    for (const L of TRACKS)
      for (let i = 0; i < n; i++) {
        expect(startPrize(L, i) * startChances(L)[i]).toBeCloseTo(RTP, 12);
        expect(startPrize(L, i)).toBeLessThan(MAX_WIN);
      }
    expect(manifest.maxMultiplier).toBe(MAX_WIN);
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
