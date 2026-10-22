import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  MAX_MULTIPLIER,
  PICK_COUNTS,
  RINGS,
  RTP,
  VOLATILITY,
  bustRisk,
  cashValue,
  darkCount,
  defaultPicks,
  ends,
  exposed,
  isLit,
  lastLampExact,
  mod,
  nextLight,
  nextRisk,
  owners,
  prize,
  slots,
  startChance,
  startWalk,
  status,
  walkSegment,
  winChance,
  yourSlots,
  type Walk,
} from './math';

const rng = createRng(seededSource(11));

/** One raw step of the walk, lighting a lamp if it is new. */
function step(w: Walk, dir: 1 | -1): Walk {
  const x = w.x + dir;
  return { n: w.n, lo: Math.min(w.lo, x), hi: Math.max(w.hi, x), x };
}

/** A random reachable state with at least `minDark` dark lamps left. */
function randomState(n: number, minDark = 2): Walk {
  let w = startWalk(n);
  const target = rng.int(n * n);
  for (let t = 0; t < target; t++) {
    const next = step(w, rng.next() < 0.5 ? 1 : -1);
    if (darkCount(next) < minDark) break;
    w = next;
  }
  return w;
}

function randomPicks(n: number, s: number): number[] {
  return rng.shuffle(Array.from({ length: n - 1 }, (_, i) => i + 1)).slice(0, s);
}

describe('Last Light maths', () => {
  it('the last lamp of a raw random walk on a cycle is uniform (Lovász): P = s/(n − 1)', () => {
    for (const n of RINGS) {
      const rounds = n <= 16 ? 30_000 : 12_000;
      const counts = new Array<number>(n).fill(0);
      for (let r = 0; r < rounds; r++) {
        // The raw process: a visited set and a position, nothing else.
        const seen = new Uint8Array(n);
        seen[0] = 1;
        let x = 0;
        let left = n - 1;
        let last = 0;
        while (left > 0) {
          x = mod(x + (rng.next() < 0.5 ? 1 : -1), n);
          if (!seen[x]) {
            seen[x] = 1;
            left--;
            last = x;
          }
        }
        counts[last]++;
      }
      expect(counts[0]).toBe(0);
      const p = 1 / (n - 1);
      const se = Math.sqrt((p * (1 - p)) / rounds);
      // Every lamp, and a few backed sets, against the closed form.
      for (let j = 1; j < n; j++) expect(Math.abs(counts[j] / rounds - p)).toBeLessThan(4.5 * se);
      for (const s of PICK_COUNTS) {
        const picks = defaultPicks(n, s);
        const ps = startChance(n, s);
        const hits = picks.reduce((t, j) => t + counts[j], 0);
        expect(Math.abs(hits / rounds - ps)).toBeLessThan(4 * Math.sqrt((ps * (1 - ps)) / rounds));
      }
    }
  });

  it('the slots drawn on the board are exactly the chance each lamp lights last', () => {
    for (const n of RINGS) {
      expect(lastLampExact(startWalk(n)).every((p, j) => Math.abs(p - (j === 0 ? 0 : 1 / (n - 1))) < 1e-12)).toBe(true);
      for (let trial = 0; trial < 40; trial++) {
        const w = randomState(n, 1);
        const exact = lastLampExact(w);
        const own = owners(w);
        // The slot picture: one slot per lamp except the walker's.
        expect(own.filter((o) => o === null)).toHaveLength(1);
        expect(own[mod(w.x, n)]).toBeNull();
        for (let j = 0; j < n; j++) {
          const drawn = own.filter((o) => o === j).length;
          expect(drawn).toBe(slots(w, j));
          expect(Math.abs(drawn / (n - 1) - exact[j])).toBeLessThan(1e-12);
          if (isLit(w, j)) expect(drawn).toBe(0);
        }
        const picks = randomPicks(n, 1 + rng.int(4));
        expect(Math.abs(winChance(w, picks) - picks.reduce((t, j) => t + exact[j], 0))).toBeLessThan(1e-12);
      }
    }
  });

  it('the next-light risk shown is the true chance the next lamp to light is yours', () => {
    for (const n of RINGS) {
      for (let trial = 0; trial < 6; trial++) {
        const w = randomState(n, 3);
        const e = ends(w);
        const picks = [e.right];
        const risk = nextRisk(w, picks);
        expect(risk).toBeCloseTo(nextLight(w).right, 12);
        const rounds = 4000;
        let hits = 0;
        for (let r = 0; r < rounds; r++) {
          let x = w.x;
          while (x >= w.lo && x <= w.hi) x += rng.next() < 0.5 ? 1 : -1;
          if (x > w.hi) hits++;
        }
        expect(Math.abs(hits / rounds - risk)).toBeLessThan(4 * Math.sqrt((risk * (1 - risk)) / rounds) + 1e-9);
      }
    }
  });

  it('the bust chance on the Walk button is the true chance the next walk loses the round', () => {
    for (const n of RINGS) {
      for (let trial = 0; trial < 8; trial++) {
        const w = randomState(n, 3);
        const e = ends(w);
        // One dark pick next in line (can bust), or two dark picks (cannot).
        const single = trial % 2 === 0;
        const others = Array.from({ length: n }, (_, j) => j).filter((j) => !isLit(w, j) && j !== e.right && j !== e.left);
        const picks = single ? [e.left] : [e.left, others[0] ?? e.right];
        const bust = bustRisk(w, picks);
        if (!single) expect(bust).toBe(0);
        else expect(bust).toBeCloseTo(nextLight(w).left, 12);
        const rounds = 3000;
        let lost = 0;
        for (let r = 0; r < rounds; r++) if (walkSegment(w, picks, rng.next, false).result === 'lost') lost++;
        expect(Math.abs(lost / rounds - bust)).toBeLessThan(4 * Math.sqrt((bust * (1 - bust)) / rounds) + 1e-9);
      }
    }
  });

  it('each step is a fair bet: E[cash-out after one step] = cash-out now', () => {
    for (const n of RINGS) {
      for (let trial = 0; trial < 200; trial++) {
        const w = randomState(n);
        const picks = randomPicks(n, 1 + rng.int(Math.min(4, n - 2)));
        if (status(w, picks) !== 'live') continue;
        const now = cashValue(w, picks);
        const after = (cashValue(step(w, 1), picks) + cashValue(step(w, -1), picks)) / 2;
        expect(Math.abs(after - now)).toBeLessThan(1e-12);
        // Your slots move by at most one per step.
        expect(Math.abs(yourSlots(step(w, 1), picks) - yourSlots(w, picks))).toBeLessThanOrEqual(1);
      }
    }
  });

  it('each walk to the next checkpoint is a fair bet, computed exactly over which end lights next', () => {
    // Value at the end of a walk that starts at (lo, hi, x): recurse over the
    // lighting chain, stopping where walkSegment stops.
    const settle = (w: Walk, picks: number[], s: number): number => {
      const st = status(w, picks);
      if (st === 'won') return prize(w.n, s);
      if (st === 'lost') return 0;
      return cashValue(w, picks);
    };
    const segmentValue = (w0: Walk, picks: number[]): number => {
      const s = picks.length;
      const memo = new Map<string, number>();
      const value = (w: Walk): number => {
        const key = `${w.lo},${w.hi},${w.x}`;
        const hit = memo.get(key);
        if (hit !== undefined) return hit;
        const m = w.hi - w.lo + 1;
        const pRight = (w.x - w.lo + 1) / (m + 1);
        const branch = (next: Walk) => {
          const st = status(next, picks);
          const stop = st !== 'live' || picks.includes(mod(next.x, w.n)) || exposed(next, picks);
          return stop ? settle(next, picks, s) : value(next);
        };
        const v = pRight * branch({ n: w.n, lo: w.lo, hi: w.hi + 1, x: w.hi + 1 }) + (1 - pRight) * branch({ n: w.n, lo: w.lo - 1, hi: w.hi, x: w.lo - 1 });
        memo.set(key, v);
        return v;
      };
      return value(w0);
    };
    for (const n of RINGS) {
      for (let trial = 0; trial < 60; trial++) {
        const w = randomState(n);
        const picks = randomPicks(n, 1 + rng.int(Math.min(4, n - 2)));
        if (status(w, picks) !== 'live') continue;
        expect(Math.abs(segmentValue(w, picks) - cashValue(w, picks))).toBeLessThan(1e-9);
      }
      // From the very start, the round is worth RTP whichever lamps you back.
      for (const s of PICK_COUNTS) {
        if (s > n - 2) continue;
        const picks = randomPicks(n, s);
        expect(cashValue(startWalk(n), picks)).toBeCloseTo(RTP, 12);
        expect(segmentValue(startWalk(n), picks)).toBeCloseTo(RTP, 9);
      }
    }
  });

  it('walks never stop on a lamp that cannot matter, and never run past one that does', () => {
    for (const n of RINGS) {
      for (let trial = 0; trial < 200; trial++) {
        const picks = randomPicks(n, 1 + rng.int(Math.min(4, n - 2)));
        let w = startWalk(n);
        for (let k = 0; k < 40; k++) {
          const before = yourSlots(w, picks);
          const seg = walkSegment(w, picks, rng.next);
          // Replay the path: every earlier lighting left your slots alone and exposed nothing.
          let lo = w.lo;
          let hi = w.hi;
          for (let i = 1; i < seg.xs.length; i++) {
            lo = Math.min(lo, seg.xs[i]);
            hi = Math.max(hi, seg.xs[i]);
            const isLight = seg.lights.includes(i);
            if (isLight && i !== seg.steps) {
              const mid: Walk = { n, lo, hi, x: seg.xs[i] };
              expect(yourSlots(mid, picks)).toBe(before);
              expect(picks.some((j) => j === ends(mid).right || j === ends(mid).left || j === mod(seg.xs[i], n))).toBe(false);
            }
          }
          expect(seg.lights[seg.lights.length - 1]).toBe(seg.steps);
          if (seg.result !== 'checkpoint') break;
          w = seg.end;
        }
      }
    }
  });

  it('most rounds reach a checkpoint: the first walk rarely ends the round', () => {
    for (const { n, s } of Object.values(VOLATILITY)) {
      const rounds = 4000;
      let reached = 0;
      for (let r = 0; r < rounds; r++) {
        if (walkSegment(startWalk(n), randomPicks(n, s), rng.next, false).result === 'checkpoint') reached++;
      }
      expect(reached / rounds).toBeGreaterThan(0.5);
    }
  });

  it('simulated RTP matches the manifest under sampled strategies, and no payout beats the bound', () => {
    expect(manifest.maxMultiplier).toBe(MAX_MULTIPLIER);
    expect(MAX_MULTIPLIER).toBeCloseTo(RTP * 35, 12);
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier + 1e-9);
    }
  });
});
