import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  GRIDS,
  MAX_MULTIPLIER,
  RTP,
  TARGETS,
  autoStop,
  blockers,
  centre,
  freeCount,
  liveOutlook,
  neighbours,
  outlook,
  startOutlook,
  step,
  walkCount,
  type Dir,
} from './math';

const rng = createRng(seededSource(23));
const randomDir = () => rng.int(4) as Dir;

/** A random reachable live state: walk the game forward, re-drawing any losing step. */
function randomState(n: number, target: number, maxLen = target - 1) {
  let path = [centre(n)];
  let cash = RTP;
  const len = 2 + rng.int(Math.max(1, maxLen - 1));
  while (path.length < len && !autoStop(n, target, path)) {
    const r = step(n, path, cash, randomDir());
    if (!r.safe) continue;
    path = r.path;
    cash = r.cash;
  }
  return { path, cash };
}

describe('Snake maths', () => {
  it('counts self-avoiding walks exactly (OEIS A001411 on an open grid)', () => {
    const open = [1, 4, 12, 36, 100, 284, 780, 2172, 5916, 16268, 44100];
    // A 23×23 board: ten steps from the centre never reach a wall.
    open.forEach((c, k) => expect(walkCount(23, k)).toBe(c));
    // On the boards the walls bite: e.g. 1,816 of the 4^7 seven-step paths survive on 9×9, 1,048 on 7×7.
    expect(walkCount(9, 7)).toBe(1816);
    expect(walkCount(7, 7)).toBe(1048);
  });

  it('chance to win = c_(T-1) / 4^(T-1), and the symmetric shortcut matches the full enumeration', () => {
    for (const n of GRIDS) {
      for (const t of TARGETS) {
        const exact = walkCount(n, t - 1) / 4 ** (t - 1);
        expect(startOutlook(n, t).win).toBe(exact);
        expect(outlook(n, t, [centre(n)], RTP).win).toBe(exact);
      }
    }
  });

  it('a blind random walk reaches the target exactly as often as the formula says', () => {
    for (const n of GRIDS) {
      for (const t of TARGETS) {
        const rounds = 40_000;
        let wins = 0;
        const nb = neighbours(n);
        for (let r = 0; r < rounds; r++) {
          // The raw process: no pricing, no stopping rules, just the walk.
          const seen = new Set([centre(n)]);
          let head = centre(n);
          let alive = true;
          for (let k = 1; k < t && alive; k++) {
            head = nb[head * 4 + rng.int(4)];
            alive = head >= 0 && !seen.has(head);
            seen.add(head);
          }
          if (alive) wins++;
        }
        const p = startOutlook(n, t).win;
        expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-4);
      }
    }
  });

  it('each step is a fair bet: E[cash-out after one step] = cash-out now, at random reachable states', () => {
    for (const n of GRIDS) {
      for (const t of TARGETS) {
        for (let trial = 0; trial < 40; trial++) {
          const { path, cash } = randomState(n, t);
          if (autoStop(n, t, path)) continue;
          let expected = 0;
          for (let d = 0; d < 4; d++) expected += step(n, path, cash, d as Dir).cash / 4;
          expect(expected).toBeCloseTo(cash, 10);
        }
      }
    }
  });

  it('playing every path to the end returns exactly RTP, from the start and from live states', () => {
    for (const n of GRIDS) {
      for (const t of TARGETS) {
        const o = startOutlook(n, t);
        expect(o.win + o.trapped + o.crash).toBeCloseTo(1, 12);
        expect(o.winPay + o.trapPay).toBeCloseTo(RTP, 10);
        for (let trial = 0; trial < 10; trial++) {
          const { path, cash } = randomState(n, t);
          const live = outlook(n, t, path, cash);
          expect(live.winPay + live.trapPay).toBeCloseTo(cash, 9);
        }
      }
    }
  });

  it('the lit arrows are exactly the directions that survive, so the green share is the true risk', () => {
    for (const n of GRIDS) {
      for (let trial = 0; trial < 300; trial++) {
        const { path, cash } = randomState(n, 12, 12);
        const drawn = blockers(n, path);
        let safe = 0;
        for (let d = 0; d < 4; d++) {
          const r = step(n, path, cash, d as Dir);
          expect(r.safe).toBe(drawn[d] === null);
          if (!r.safe) expect(r.hit).toBe(drawn[d]);
          if (r.safe) safe++;
        }
        expect(freeCount(n, path)).toBe(safe);
      }
    }
  });

  it('the live win chance on screen matches simulation from mid-round positions', () => {
    for (const [n, t] of [
      [7, 12],
      [9, 10],
    ] as const) {
      for (let trial = 0; trial < 4; trial++) {
        const { path, cash } = randomState(n, t, 6);
        if (autoStop(n, t, path)) continue;
        const p = liveOutlook(n, t, path, cash).win;
        const rounds = 20_000;
        let wins = 0;
        for (let r = 0; r < rounds; r++) {
          let s = { path, cash, safe: true };
          while (s.safe && !autoStop(n, t, s.path)) s = step(n, s.path, s.cash, randomDir());
          if (s.safe && s.path.length >= t) wins++;
        }
        expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-4);
      }
    }
  });

  it('no payout can exceed maxMultiplier (exact enumeration over every setting)', () => {
    for (const n of GRIDS) for (const t of TARGETS) expect(outlook(n, t, [centre(n)], RTP).maxCash).toBeLessThanOrEqual(MAX_MULTIPLIER);
    expect(manifest.maxMultiplier).toBe(MAX_MULTIPLIER);
    // 7×7, length 12: the largest product of 4/f over 11 steps.
    expect(MAX_MULTIPLIER).toBeCloseTo(3203.98, 2);
  });

  it('simulated RTP matches the manifest under mixed stopping strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
