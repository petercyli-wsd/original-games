import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  CUBES,
  DIRS,
  PLACES,
  ROLLS,
  RTP,
  cashAt,
  closedForm,
  cubeChance,
  forecast,
  placeOf,
  prizeFor,
  roll,
  rollChances,
  startChance,
  startFaces,
  verdict,
  winChance,
  type Face,
  type Place,
} from './math';

const rng = createRng(seededSource(11));
const FACES: Face[] = ['top', 'bottom', 'N', 'E', 'S', 'W'];

describe('Tumble maths', () => {
  it('rolling a cube is a rotation: each roll permutes the six faces, and the opposite roll undoes it', () => {
    const back = { N: 'S', S: 'N', E: 'W', W: 'E' } as const;
    for (const d of DIRS) {
      expect(new Set(FACES.map((f) => roll(f, d))).size).toBe(6);
      for (const f of FACES) expect(roll(roll(f, d), back[d])).toBe(f);
    }
  });

  it('the red face moves as the 3-state chain: top → side, side → top ¼ / side ½ / bottom ¼, bottom → side', () => {
    const counts = (f: Face) => {
      const c: Record<Place, number> = { top: 0, side: 0, bottom: 0 };
      for (const d of DIRS) c[placeOf(roll(f, d))]++;
      return c;
    };
    expect(counts('top')).toEqual({ top: 0, side: 4, bottom: 0 });
    expect(counts('bottom')).toEqual({ top: 0, side: 4, bottom: 0 });
    for (const f of ['N', 'E', 'S', 'W'] as Face[]) expect(counts(f)).toEqual({ top: 1, side: 2, bottom: 1 });
  });

  it('the matrix-power table matches the eigenvalue closed form', () => {
    for (const target of PLACES)
      for (const place of PLACES)
        for (let m = 0; m <= 12; m++) expect(cubeChance(place, m, target)).toBeCloseTo(closedForm(place, m, target), 13);
    // Known values: red on top after 3 rolls is 1/8, on a side 3/4; the long-run law is (1/6, 2/3, 1/6).
    expect(cubeChance('top', 3, 'top')).toBe(1 / 8);
    expect(cubeChance('top', 3, 'side')).toBe(3 / 4);
    expect(cubeChance('top', 12, 'side')).toBeCloseTo(2 / 3, 3);
  });

  it('exact enumeration of every roll sequence gives the table', () => {
    for (const f of FACES) {
      for (let m = 0; m <= 6; m++) {
        const ends: Record<Place, number> = { top: 0, side: 0, bottom: 0 };
        const walk = (g: Face, k: number) => {
          if (k === 0) return void ends[placeOf(g)]++;
          for (const d of DIRS) walk(roll(g, d), k - 1);
        };
        walk(f, m);
        for (const t of PLACES) expect(ends[t] / 4 ** m).toBeCloseTo(cubeChance(placeOf(f), m, t), 14);
      }
    }
  });

  it('simulated rounds of the raw process win as often as the formula says', () => {
    for (const rolls of ROLLS) {
      for (const cubes of CUBES) {
        for (const target of PLACES) {
          const rounds = 4000;
          let wins = 0;
          for (let r = 0; r < rounds; r++) {
            let faces = startFaces(cubes);
            for (let i = 0; i < rolls; i++) faces = faces.map((f) => roll(f, DIRS[rng.int(4)]));
            if (faces.every((f) => placeOf(f) === target)) wins++;
          }
          const p = startChance(rolls, cubes, target);
          expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 2e-3);
        }
      }
    }
  });

  it('each roll is a fair bet: E[cash-out after the next roll] = cash-out now', () => {
    for (let trial = 0; trial < 400; trial++) {
      const rolls = ROLLS[rng.int(4)];
      const cubes = CUBES[rng.int(3)];
      const target = PLACES[rng.int(3)];
      const prize = prizeFor(rolls, cubes, target);
      let faces = startFaces(cubes);
      const done = rng.int(rolls);
      for (let i = 0; i < done; i++) faces = faces.map((f) => roll(f, DIRS[rng.int(4)]));
      const left = rolls - done;
      const now = cashAt(prize, faces, left, target);
      // Average over all 4^cubes joint rolls.
      let sum = 0;
      const n = 4 ** cubes;
      for (let code = 0; code < n; code++) {
        const next = faces.map((f, i) => roll(f, DIRS[Math.floor(code / 4 ** i) % 4]));
        sum += cashAt(prize, next, left - 1, target);
      }
      expect(sum / n).toBeCloseTo(now, 9);
    }
  });

  it('the bet starts worth exactly RTP, for every setting', () => {
    for (const rolls of ROLLS)
      for (const cubes of CUBES)
        for (const target of PLACES) expect(cashAt(prizeFor(rolls, cubes, target), startFaces(cubes), rolls, target)).toBeCloseTo(RTP, 12);
  });

  it('the drawn odds are the true risk: bars sum to 1, the four roll cells average to the bar, and the product is the win chance', () => {
    for (const f of FACES) {
      for (let left = 0; left <= 12; left++) {
        const bar = forecast(placeOf(f), left);
        expect(bar[0] + bar[1] + bar[2]).toBeCloseTo(1, 14);
        for (const target of PLACES) {
          const seg = bar[PLACES.indexOf(target)];
          expect(seg).toBe(cubeChance(placeOf(f), left, target));
          if (left > 0) {
            const cells = rollChances(f, left, target);
            expect(cells.reduce((a, b) => a + b, 0) / 4).toBeCloseTo(seg, 14);
          }
        }
      }
    }
    const faces: Face[] = ['N', 'top', 'bottom'];
    expect(winChance(faces, 4, 'side')).toBeCloseTo(faces.reduce((a, f) => a * forecast(placeOf(f), 4)[1], 1), 14);
  });

  it('the round ends early exactly when the chance is 0 or 1', () => {
    expect(verdict(['top'], 1, 'top')).toBe('lost'); // red on top must roll off
    expect(verdict(['top', 'bottom'], 1, 'side')).toBe('won'); // both must roll onto a side
    expect(verdict(['N'], 1, 'top')).toBeNull();
    for (const f of FACES) for (const t of PLACES) expect(verdict([f], 0, t)).toBe(placeOf(f) === t ? 'won' : 'lost');
  });

  it('maxMultiplier is the largest prize, and no cash-out can exceed its prize', () => {
    expect(manifest.maxMultiplier).toBeCloseTo(RTP * 512, 9);
    expect(prizeFor(3, 3, 'top')).toBeCloseTo(RTP * 512, 9);
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
