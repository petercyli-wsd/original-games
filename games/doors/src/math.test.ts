import { createRng, runEval, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { STRIP, VIEW_H, VIEW_W, barFill, layout, stripSegments } from './geometry';
import manifest from './manifest';
import {
  DOOR_COUNTS,
  PLANS,
  RTP,
  bestOther,
  canOpen,
  cashValue,
  chanceOf,
  closedCount,
  closedDoors,
  hostPick,
  lockedPrize,
  maxMultiplier,
  newState,
  openChances,
  openDoor,
  otherDoor,
  planChance,
  planPrize,
  posterior,
  prizeOf,
  switchTo,
  winChance,
  type DoorsState,
} from './math';

const rng = createRng(seededSource(11));

/** The raw process, written independently of math.ts: the host opens one random empty door you don't hold. */
function rawRound(n: number, finalSwitch: boolean, r: Rng): boolean {
  const prize = r.int(n);
  let held = r.int(n);
  let closed = Array.from({ length: n }, (_, i) => i);
  while (closed.length > 2) {
    const empty = closed.filter((d) => d !== held && d !== prize);
    const z = empty[r.int(empty.length)];
    closed = closed.filter((d) => d !== z);
  }
  if (finalSwitch) held = closed.find((d) => d !== held)!;
  return held === prize;
}

type Strategy = (s: DoorsState, step: number, opened: number) => DoorsState;
const STRATEGIES: Record<string, Strategy> = {
  hold: (s) => s,
  favourite: (s) => {
    const b = bestOther(s);
    return b !== null && chanceOf(s, b) > winChance(s) ? switchTo(s, b) : s;
  },
  // A deterministic but history-dependent zig-zag: switch on odd steps to a door picked from what was opened.
  zigzag: (s, step, opened) => {
    if (step % 2 === 0) return s;
    const others = closedDoors(s).filter((d) => d !== s.held);
    return switchTo(s, others[(opened * 7 + step) % others.length]);
  },
};

/**
 * Enumerates every host behaviour under a strategy, carrying the exact joint
 * probability of (prize door, history), and calls visit at every checkpoint.
 */
function enumerate(n: number, strategy: Strategy, visit: (s: DoorsState, joint: number[]) => void) {
  const rec = (s: DoorsState, joint: number[], step: number) => {
    visit(s, joint);
    const c = closedCount(s);
    if (c <= 2) return;
    for (const z of closedDoors(s)) {
      if (z === s.held) continue;
      const next = joint.map((p, x) => (p === 0 || x === z ? 0 : x === s.held ? p / (c - 1) : p / (c - 2)));
      if (next.every((p) => p === 0)) continue;
      rec(strategy(openDoor(s, z), step + 1, z), next, step + 1);
    }
  };
  rec(newState(n, 0), Array.from({ length: n }, () => 1 / n), 0);
}

/** A random reachable state with random switches along the way. */
function randomState(n: number, r: Rng) {
  let s = newState(n, r.int(n));
  const prize = r.int(n);
  const stop = r.int(n - 1);
  for (let k = 0; k < stop && canOpen(s); k++) {
    s = openDoor(s, hostPick(s, prize, r));
    const others = closedDoors(s).filter((d) => d !== s.held);
    if (r.next() < 0.5) s = switchTo(s, others[r.int(others.length)]);
  }
  return { s, prize };
}

describe('Doors maths', () => {
  it('Monty Hall: holding wins 1/N and switching at the end wins (N − 1)/N, matching a raw simulation', () => {
    for (const n of DOOR_COUNTS) {
      for (const plan of PLANS) {
        const rounds = 20_000;
        let wins = 0;
        for (let i = 0; i < rounds; i++) if (rawRound(n, plan === 'switch', rng)) wins++;
        const p = planChance(n, plan);
        expect(Math.abs(wins / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds));
        expect(planPrize(n, plan) * p).toBeCloseTo(RTP, 12);
      }
    }
  });

  it('holding one door throughout: its weight telescopes to 1/(N − 1) and its chance stays 1/N', () => {
    for (const n of DOOR_COUNTS) {
      let s = newState(n, 0);
      while (canOpen(s)) {
        s = openDoor(s, closedDoors(s).find((d) => d !== s.held)!);
        expect(winChance(s)).toBeCloseTo(1 / n, 14);
        expect(cashValue(s)).toBeCloseTo(RTP, 14);
      }
      expect(s.weight[0]).toBeCloseTo(1 / (n - 1), 14);
      expect(chanceOf(s, otherDoor(s))).toBeCloseTo((n - 1) / n, 14);
    }
  });

  it('the door weights are exact Bayes posteriors (brute force over every host behaviour)', () => {
    for (const n of [3, 5, 6, 8]) {
      for (const [name, strategy] of Object.entries(STRATEGIES)) {
        let checked = 0;
        let worst = 0;
        enumerate(n, strategy, (s, joint) => {
          const total = joint.reduce((a, p) => a + p, 0);
          const post = posterior(s);
          for (let x = 0; x < n; x++) worst = Math.max(worst, Math.abs(post[x] - joint[x] / total));
          checked++;
        });
        expect(worst, `${name} n=${n}`).toBeLessThan(1e-12);
        expect(checked).toBeGreaterThan(1);
      }
    }
  });

  it('every opening and the reveal are fair bets: E[cash-out after] = cash-out now, at every reachable state (exact)', () => {
    for (const n of [3, 5, 6, 8]) {
      for (const strategy of Object.values(STRATEGIES)) {
        let worst = 0;
        enumerate(n, strategy, (s) => {
          if (!canOpen(s)) {
            // The reveal pays the locked prize with chance P(your door).
            worst = Math.max(worst, Math.abs(lockedPrize(s) * winChance(s) - cashValue(s)));
            return;
          }
          const q = openChances(s);
          let expected = 0;
          let mass = 0;
          for (const z of closedDoors(s)) {
            if (z === s.held) continue;
            mass += q[z];
            expected += q[z] * cashValue(openDoor(s, z));
          }
          worst = Math.max(worst, Math.abs(mass - 1), Math.abs(expected - cashValue(s)));
        });
        expect(worst).toBeLessThan(1e-12);
      }
    }
  });

  it('the host opens each door with the chance openChances says (simulation at random states)', () => {
    for (const n of [5, 12]) {
      for (let trial = 0; trial < 4; trial++) {
        const { s } = randomState(n, rng);
        if (!canOpen(s)) continue;
        const q = openChances(s);
        const post = posterior(s);
        const rounds = 20_000;
        const counts = new Array(n).fill(0);
        for (let i = 0; i < rounds; i++) {
          // Draw the prize from the posterior, then let the host move.
          let u = rng.next();
          let prize = 0;
          while (prize < n - 1 && u >= post[prize]) u -= post[prize++];
          counts[hostPick(s, prize, rng)]++;
        }
        for (let z = 0; z < n; z++) {
          const p = q[z];
          expect(Math.abs(counts[z] / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds) + 1e-9);
        }
      }
    }
  });

  it('switching keeps the value, relocks the prize at V / P(new door), and the prize never exceeds RTP · N', () => {
    for (const n of DOOR_COUNTS) {
      for (let trial = 0; trial < 300; trial++) {
        let s = newState(n, rng.int(n));
        const prize = rng.int(n);
        while (canOpen(s)) {
          s = openDoor(s, hostPick(s, prize, rng));
          const v = cashValue(s);
          for (const d of closedDoors(s)) {
            expect(prizeOf(s, d) * chanceOf(s, d)).toBeCloseTo(v, 10);
            expect(prizeOf(s, d)).toBeLessThanOrEqual(maxMultiplier(n) + 1e-12);
          }
          const others = closedDoors(s).filter((d) => d !== s.held);
          const t = switchTo(s, others[rng.int(others.length)]);
          expect(cashValue(t)).toBe(v);
          expect(lockedPrize(t)).toBeCloseTo(v / winChance(t), 10);
          if (rng.next() < 0.6) s = t;
        }
        expect(lockedPrize(s)).toBeLessThanOrEqual(manifest.maxMultiplier + 1e-12);
      }
    }
    expect(manifest.maxMultiplier).toBeCloseTo(RTP * 12, 12);
  });

  it('the chance drawn on your door is calibrated against the hidden prize', () => {
    // Random rounds with random switches; at every checkpoint bucket by the
    // chance shown on your door and compare with how often the prize was there.
    const bins = Array.from({ length: 10 }, () => ({ n: 0, p: 0, hits: 0 }));
    for (const n of [5, 8, 12]) {
      for (let round = 0; round < 6000; round++) {
        const prize = rng.int(n);
        let s = newState(n, rng.int(n));
        while (canOpen(s)) {
          s = openDoor(s, hostPick(s, prize, rng));
          const others = closedDoors(s).filter((d) => d !== s.held);
          if (rng.next() < 0.4) s = switchTo(s, others[rng.int(others.length)]);
          else if (rng.next() < 0.4) s = switchTo(s, bestOther(s)!);
          const p = winChance(s);
          const bin = bins[Math.min(9, Math.floor(p * 10))];
          bin.n++;
          bin.p += p;
          if (s.held === prize) bin.hits++;
        }
      }
    }
    let used = 0;
    for (const b of bins) {
      if (b.n < 200) continue;
      used++;
      const p = b.p / b.n;
      expect(Math.abs(b.hits / b.n - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / b.n) + 1e-9);
    }
    expect(used).toBeGreaterThanOrEqual(6);
  });

  it('the board draws the odds literally: bar height and strip share equal each door’s chance', () => {
    for (const n of DOOR_COUNTS) {
      const { cells } = layout(n);
      expect(cells).toHaveLength(n);
      const { s } = randomState(n, rng);
      const post = posterior(s);
      const segs = stripSegments(post, s.held);
      expect(segs[0].door).toBe(s.held);
      expect(segs[0].x).toBe(STRIP.x);
      expect(segs.reduce((a, g) => a + g.w, 0)).toBeCloseTo(STRIP.w, 9);
      for (const g of segs) {
        expect(g.w / STRIP.w).toBeCloseTo(post[g.door], 12);
        expect(barFill(post[g.door], cells[g.door].bar.h) / cells[g.door].bar.h).toBeCloseTo(post[g.door], 12);
      }
      // Bars sit above their doors, everything stays inside the view box, and cells never overlap.
      for (let i = 0; i < n; i++) {
        const { bar, door, labelY, footY } = cells[i];
        expect(bar.h).toBeGreaterThan(40);
        expect(labelY).toBeLessThan(bar.y);
        expect(bar.y + bar.h).toBeLessThan(door.y);
        expect(door.x).toBeGreaterThanOrEqual(0);
        expect(door.x + door.w).toBeLessThanOrEqual(VIEW_W);
        expect(footY).toBeLessThan(STRIP.y - 12);
        expect(footY).toBeLessThan(VIEW_H);
        if (i + 1 < n) {
          const b = cells[i + 1];
          expect(door.x + door.w < b.door.x || footY < b.labelY - 8).toBe(true);
        }
      }
    }
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier + 1e-9);
    }
  });
});
