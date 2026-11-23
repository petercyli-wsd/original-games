import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import { MAX_MULTIPLIER, RTP, WALLS, activeWall, decided, drawSlips, initState, markOf, prizeOf, reach, safeChance, startChance, winChance, type State } from './math';

/** Brute force: every slip layout (final heights), tie to the earlier climber. */
function winnerOf(F: number[]): number {
  let best = 0;
  for (let j = 1; j < F.length; j++) if (F[j] > F[best]) best = j;
  return best;
}
function allLayouts(): number[][] {
  let out: number[][] = [[]];
  for (const N of WALLS) out = out.flatMap((p) => Array.from({ length: N }, (_, f) => [...p, f]));
  return out;
}

describe('Top Out maths', () => {
  it('start chances are 9/1024, 27/512, 123/512, 715/1024 and sum to 1', () => {
    expect(startChance(0)).toBeCloseTo(9 / 1024, 15);
    expect(startChance(1)).toBeCloseTo(27 / 512, 15);
    expect(startChance(2)).toBeCloseTo(123 / 512, 15);
    expect(startChance(3)).toBeCloseTo(715 / 1024, 15);
    expect([0, 1, 2, 3].reduce((a, i) => a + startChance(i), 0)).toBeCloseTo(1, 12);
    expect(prizeOf(0)).toBeCloseTo(112.64, 9);
    expect(prizeOf(3)).toBeCloseTo(1.418, 3);
    expect(MAX_MULTIPLIER).toBeCloseTo(112.64, 9);
  });

  it('winChance at every reachable state equals brute force over the layouts still consistent', () => {
    const rng = createRng(seededSource(5));
    const layouts = allLayouts();
    let states = 0;
    for (let t = 0; t < 300; t++) {
      const F = drawSlips(rng.int);
      let s = initState();
      for (;;) {
        // Layouts consistent with the state: finished walls fixed, the active wall ≥ h, the rest free.
        const ok = layouts.filter((L) => L.every((f, j) => (s.done[j] ? f === s.h[j] : f >= s.h[j])));
        for (let me = 0; me < 4; me++) {
          const exact = ok.filter((L) => winnerOf(L) === me).length / ok.length;
          expect(winChance(s, me)).toBeCloseTo(exact, 12);
        }
        states++;
        if (activeWall(s) < 0) break;
        s = reach(s, F).next;
      }
    }
    expect(states).toBeGreaterThan(1000);
  });

  it('simulated rounds match the start chances (4 SE)', () => {
    const rng = createRng(seededSource(8));
    const n = 200_000;
    const wins = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) wins[winnerOf(drawSlips(rng.int))]++;
    wins.forEach((w, me) => {
      const p = startChance(me);
      expect(Math.abs(w / n - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / n));
    });
  });

  it('the safe chance on screen is the true risk of the next reach, and no reach is a null event', () => {
    const rng = createRng(seededSource(9));
    for (let t = 0; t < 400; t++) {
      const F = drawSlips(rng.int);
      let s = initState();
      while (activeWall(s) >= 0) {
        const w = activeWall(s);
        const left = WALLS[w] - s.h[w];
        expect(left).toBeGreaterThan(1);
        expect(safeChance(s)).toBeCloseTo((left - 1) / left, 12);
        const ev = reach(s, F);
        // One hold left above after a safe reach: it is the forced slip, so the climb stops.
        if (ev.kind === 'reach') expect(WALLS[w] - ev.to).toBeGreaterThan(1);
        if (ev.kind === 'topped') expect(ev.slipHold).toBe(WALLS[w]);
        s = ev.next;
        if (decided(s, 0) === null && decided(s, 1) === null && decided(s, 2) === null && decided(s, 3) === null) continue;
        break;
      }
    }
  });

  it('martingale (exact): E[P after one reach] = P now at every reachable state, for every backed wall', () => {
    const rng = createRng(seededSource(21));
    let checked = 0;
    for (let t = 0; t < 120; t++) {
      const F = drawSlips(rng.int);
      let s: State = initState();
      while (activeWall(s) >= 0) {
        const w = activeWall(s);
        const left = WALLS[w] - s.h[w];
        const q = 1 / left;
        // The two outcomes of the reach, forced through F.
        const F2 = [...F];
        F2[w] = s.h[w];
        const slip = reach(s, F2);
        F2[w] = WALLS[w] - 1;
        const safe = reach(s, F2);
        for (let me = 0; me < 4; me++) {
          const after = q * winChance(slip.next, me) + (1 - q) * winChance(safe.next, me);
          expect(after).toBeCloseTo(winChance(s, me), 12);
          checked++;
        }
        s = reach(s, F).next;
        if ([0, 1, 2, 3].some((m) => decided(s, m) !== null && m === 0) && decided(s, 0) !== null && [1, 2, 3].every((m) => decided(s, m) !== null)) break;
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it('cue: a safe reach by your climber never lowers your chance, by a rival never raises it; a slip does the reverse', () => {
    const rng = createRng(seededSource(33));
    for (let t = 0; t < 300; t++) {
      const F = drawSlips(rng.int);
      let s = initState();
      while (activeWall(s) >= 0) {
        const ev = reach(s, F);
        for (let me = 0; me < 4; me++) {
          if (decided(s, me)) continue;
          const d = winChance(ev.next, me) - winChance(s, me);
          const good = ev.kind === 'slip' ? ev.wall !== me : ev.wall === me;
          if (good) expect(d).toBeGreaterThanOrEqual(-1e-12);
          else expect(d).toBeLessThanOrEqual(1e-12);
        }
        s = ev.next;
        if ([0, 1, 2, 3].every((m) => decided(s, m) !== null)) break;
      }
    }
  });

  it('the mark only rises, and a decided round is exactly won or lost', () => {
    const rng = createRng(seededSource(2));
    for (let t = 0; t < 200; t++) {
      const F = drawSlips(rng.int);
      let s = initState();
      let m = 0;
      while (activeWall(s) >= 0) {
        s = reach(s, F).next;
        expect(markOf(s)).toBeGreaterThanOrEqual(m);
        m = markOf(s);
      }
      expect([0, 1, 2, 3].filter((i) => decided(s, i) === 'won')).toEqual([winnerOf(F)]);
    }
  });

  it('runEval is within 4 SE of the RTP and under the max', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000, seed: 3 })) {
      expect(Math.abs(r.rtp - RTP)).toBeLessThan(4 * r.stdError + 1e-9);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier + 1e-9);
      expect(r.p99Steps).toBeLessThanOrEqual(30);
    }
  });
});
