import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  BURST,
  FIELDS,
  LAPS,
  RTP,
  START,
  STEPS,
  W,
  allowed,
  chance,
  chanceField,
  crossing,
  neighbours,
  prizeFor,
  sweepOf,
  tableWith,
  walk,
  windingOf,
  winChance,
  type Cell,
  type Field,
  type Settings,
} from './math';

const rng = createRng(seededSource(11));

/** The raw process, with no odds involved: a uniform step among open neighbours. */
function rawWalk(field: Field, steps: number, from: Cell = START): Cell[] {
  const path = [from];
  for (let i = 0; i < steps; i++) {
    const nb = neighbours(field, path[path.length - 1]);
    path.push(nb[rng.int(nb.length)]);
  }
  return path;
}

/** Reachable state after a random number of raw steps. */
function randomState(s: Settings) {
  const taken = rng.int(s.steps);
  const path = rawWalk(s.field, taken);
  return { at: path[path.length - 1], w: windingOf(path), left: s.steps - taken, path };
}

const ALL: Settings[] = FIELDS.flatMap((field) => STEPS.flatMap((steps) => LAPS.filter((laps) => allowed(steps, laps)).map((laps) => ({ field, steps, laps }))));

describe('Lasso maths', () => {
  it('the start chance matches a direct simulation of the walk', () => {
    const cases: Settings[] = [
      { field: 2, steps: 60, laps: 1 },
      { field: 3, steps: 20, laps: 1 },
      { field: 4, steps: 10, laps: 1 },
      { field: 2, steps: 60, laps: 2 },
    ];
    for (const s of cases) {
      const rounds = 30_000;
      let wins = 0;
      for (let r = 0; r < rounds; r++) if (Math.abs(windingOf(rawWalk(s.field, s.steps))) >= s.laps) wins++;
      const p = winChance(s);
      expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-4);
    }
  });

  it('a live state chance (the walker cell shading) matches simulation from that state', () => {
    const s: Settings = { field: 3, steps: 40, laps: 1 };
    // Halfway round the top, 25 steps left.
    const path: Cell[] = [START, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: -1, y: 1 }, { x: -1, y: 0 }];
    const at = path[path.length - 1];
    const p = chanceField(s.field, s.laps, 0, 25).find((c) => c.cell.x === at.x && c.cell.y === at.y)!.p;
    expect(p).toBe(chance(s.field, s.laps, at, 0, 25));
    const rounds = 30_000;
    let wins = 0;
    for (let r = 0; r < rounds; r++) if (Math.abs(windingOf([...path, ...rawWalk(s.field, 25, at).slice(1)])) >= 1) wins++;
    expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds));
  });

  it('martingale: each step averages the cash-out over the open neighbours exactly', () => {
    for (const s of ALL) {
      const prize = prizeFor(s);
      for (let i = 0; i < 40; i++) {
        const { at, w, left } = randomState(s);
        const now = prize * chance(s.field, s.laps, at, w, left);
        const nb = neighbours(s.field, at);
        const avg = nb.reduce((a, n) => a + prize * chance(s.field, s.laps, n, w + crossing(at, n), left - 1), 0) / nb.length;
        expect(Math.abs(avg - now)).toBeLessThan(1e-9 * Math.max(1, now));
      }
      expect(prize * winChance(s)).toBeCloseTo(RTP, 12);
    }
  });

  it('the seam count is the winding number of the walk closed the short way round', () => {
    for (let i = 0; i < 3000; i++) {
      const path = rawWalk(FIELDS[i % 3], 1 + rng.int(60));
      const th = sweepOf(path);
      // Tie rule: θ = ±π (mod 2π) on the ray y = 0, x < 0 belongs to the upper side.
      const half = Math.round(th / Math.PI);
      const onTie = Math.abs(th - half * Math.PI) < 1e-9 && half % 2 !== 0;
      const expected = onTie ? Math.ceil(half / 2 - 0.5) : Math.ceil(th / (2 * Math.PI) - 0.5);
      expect(windingOf(path)).toBe(expected + 0); // + 0 folds −0 into 0
    }
  });

  it('the w axis is wide enough: a wider table gives identical odds for every reachable w', () => {
    for (const field of FIELDS)
      for (const laps of LAPS) {
        const wide = tableWith(field, laps, W + 12);
        for (let i = 0; i < 300; i++) {
          const at: Cell = { x: rng.int(2 * field + 1) - field, y: rng.int(2 * field + 1) - field };
          if (at.x === 0 && at.y === 0) continue;
          const w = rng.int(7) - 3;
          const t = rng.int(61);
          expect(chance(field, laps, at, w, t)).toBe(wide.chance(at, w, t));
        }
      }
  });

  it('settled states are exactly 0 or 1, and the walk stops there', () => {
    // One step left and no seam edge within reach: certain to stay looped.
    expect(chance(3, 1, { x: -2, y: -2 }, 1, 1)).toBe(1);
    expect(chance(3, 1, { x: -1, y: -1 }, 1, 1)).toBe(0.75);
    expect(chance(4, 1, START, 0, 3)).toBe(0);
    for (const s of ALL) {
      for (let i = 0; i < 30; i++) {
        const { at, w, left } = randomState(s);
        const r = walk(s, at, w, left, BURST, () => rng.next());
        expect(r.cells.length).toBeLessThanOrEqual(BURST);
        if (r.cells.length < Math.min(BURST, left)) expect(r.p === 0 || r.p === 1).toBe(true);
        expect(r.w).toBe(w + windingOf([at, ...r.cells]));
      }
    }
  });

  it('manifest max multiplier bounds every prize', () => {
    for (const s of ALL) expect(prizeFor(s)).toBeLessThanOrEqual(manifest.maxMultiplier);
    expect(Math.max(...ALL.map(prizeFor))).toBeGreaterThan(manifest.maxMultiplier * 0.95);
  });

  it('simulated RTP matches the manifest under random stopping', () => {
    for (const r of runEval(evalSpec, { rounds: 40_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
