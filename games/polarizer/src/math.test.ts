import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  GOAL,
  GRID,
  MAX_MULTIPLIER,
  MAX_TURN,
  RTP,
  TURNS,
  afterPass,
  allowedTurn,
  maxFactor,
  nextTurn,
  passChance,
  passes,
  plan,
  planChance,
  prizeFor,
  projection,
  zeno,
} from './math';

const rng = createRng(seededSource(11));

describe('Polarizer maths', () => {
  it("Malus's law: the pass chance is cos² of the turn", () => {
    expect(passChance(0)).toBe(1);
    expect(passChance(45)).toBeCloseTo(0.5, 14);
    expect(passChance(60)).toBeCloseTo(0.25, 14);
    expect(passChance(30)).toBeCloseTo(0.75, 14);
  });

  it('quantum Zeno: n equal turns pass with cos^(2n)(90°/n), rising towards 1', () => {
    let last = 0;
    for (const n of [2, 3, 6, 9, 18, 90]) {
      expect(planChance(0, GOAL / n)).toBeCloseTo(zeno(n), 14);
      expect(zeno(n)).toBeGreaterThan(last);
      last = zeno(n);
    }
    expect(zeno(2)).toBeCloseTo(0.25, 14);
    expect(zeno(100_000)).toBeGreaterThan(0.9999);
  });

  it('plans never pass 90° and never offer a 90° turn', () => {
    for (let angle = 0; angle < GOAL; angle += GRID) {
      for (const turn of TURNS) {
        const steps = plan(angle, turn);
        expect(steps.reduce((a, b) => a + b, angle)).toBe(GOAL);
        for (let i = 0, a = angle; i < steps.length; a += steps[i++]) expect(allowedTurn(a, steps[i])).toBe(true);
        expect(allowedTurn(angle, nextTurn(angle, turn))).toBe(true);
      }
    }
    expect(allowedTurn(0, 90)).toBe(false);
  });

  it('playing a plan to the end reaches 90° exactly as often as the formula says', () => {
    for (const turn of TURNS) {
      const rounds = 20_000;
      let wins = 0;
      for (let r = 0; r < rounds; r++) {
        // The raw process: each polarizer independently absorbs with 1 − cos²Δ.
        let ok = true;
        for (let a = 0; ok && a < GOAL; ) {
          const d = nextTurn(a, turn);
          ok = rng.next() < Math.cos((d * Math.PI) / 180) ** 2;
          a += d;
        }
        if (ok) wins++;
      }
      const p = planChance(0, turn);
      expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-4);
    }
  });

  it('every polarizer is a fair bet, whatever turn you choose', () => {
    for (let trial = 0; trial < 500; trial++) {
      const angle = GRID * rng.int(GOAL / GRID);
      const cash = RTP * (0.5 + 3 * rng.next());
      for (let d = GRID; d <= Math.min(MAX_TURN, GOAL - angle); d += GRID) {
        // E[cash after] = P(pass) · cash / P(pass) + P(absorb) · 0.
        expect(passChance(d) * afterPass(cash, d)).toBeCloseTo(cash, 9);
        // The cash-out is prize × chance for every plan: switching plans only re-prices the prize.
        for (const turn of TURNS) expect(prizeFor(cash, angle, turn) * planChance(angle, turn)).toBeCloseTo(cash, 9);
      }
    }
  });

  it('the drawn projection and bar are exactly the pass chance', () => {
    for (let angle = 0; angle < GOAL; angle += GRID) {
      for (let d = GRID; d <= Math.min(MAX_TURN, GOAL - angle); d += GRID) {
        const pr = projection(angle, d);
        // The foot of the perpendicular from the tip lies on the new axis...
        const ax = { x: Math.cos(((angle + d) * Math.PI) / 180), y: Math.sin(((angle + d) * Math.PI) / 180) };
        expect(pr.foot.x * ax.y - pr.foot.y * ax.x).toBeCloseTo(0, 12);
        // ...and the tip-to-foot segment is perpendicular to it.
        expect((pr.tip.x - pr.foot.x) * ax.x + (pr.tip.y - pr.foot.y) * ax.y).toBeCloseTo(0, 12);
        expect(Math.hypot(pr.foot.x, pr.foot.y) ** 2).toBeCloseTo(passChance(d), 12);
        expect(pr.bar).toBeCloseTo(passChance(d), 14);
        // Sweeping the marker up the bar: it passes exactly on the green part.
        const N = 2000;
        let green = 0;
        for (let i = 0; i < N; i++) if (passes((i + 0.5) / N, d)) green++;
        expect(Math.abs(green / N - pr.bar)).toBeLessThanOrEqual(1 / N);
      }
    }
  });

  it('the max payout is the 85° + 5° path, matching brute force over all paths', () => {
    const brute = (left: number): number => {
      if (left === 0) return 1;
      let m = 0;
      for (let d = GRID; d <= Math.min(MAX_TURN, left); d += GRID) m = Math.max(m, brute(left - d) / passChance(d));
      return m;
    };
    expect(maxFactor(0)).toBeCloseTo(brute(GOAL), 9);
    expect(maxFactor(0)).toBeCloseTo(1 / (passChance(85) * passChance(5)), 9);
    expect(MAX_MULTIPLIER).toBeGreaterThanOrEqual(RTP * maxFactor(0));
    expect(manifest.maxMultiplier).toBe(MAX_MULTIPLIER);
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
