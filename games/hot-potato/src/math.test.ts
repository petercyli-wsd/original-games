import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  FUSE,
  FUSES,
  MAX_WIN,
  RTP,
  SEAT_COUNTS,
  blowChance,
  blowFromHere,
  heat,
  maxStartPrize,
  mod,
  nextEvents,
  presetPicks,
  PRESETS,
  relock,
  startPrize,
  tick,
  winChance,
  type Side,
} from './math';

const rng = createRng(seededSource(11));

function randomPicks(n: number): number[] {
  return rng.shuffle(Array.from({ length: n }, (_, s) => s)).slice(0, 1 + rng.int(3));
}

describe('Hot Potato maths', () => {
  it('the heat ring sums to 1 and matches the series Σ h(1−h)^(k−1) P^k', () => {
    for (const n of SEAT_COUNTS) {
      for (const fuse of FUSES) {
        const h = FUSE[fuse].h;
        const g = blowFromHere(n, fuse);
        expect(g.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
        // Power series of the killed walk, truncated where (1−h)^k < 1e-15.
        let v = new Float64Array(n);
        v[0] = 1;
        const series = new Float64Array(n);
        let w = h;
        for (let k = 1; w > 1e-17; k++) {
          const nv = new Float64Array(n);
          for (let i = 0; i < n; i++) {
            nv[mod(i + 1, n)] += v[i] / 2;
            nv[mod(i - 1, n)] += v[i] / 2;
          }
          v = nv;
          for (let i = 0; i < n; i++) series[i] += w * v[i];
          w *= 1 - h;
        }
        for (let d = 0; d < n; d++) {
          expect(g[d]).toBeCloseTo(series[d], 12);
          expect(g[d]).toBeCloseTo(g[mod(-d, n)], 14); // mirror symmetry
        }
        // Rotating with the bomb: heat(seat)[s] = g[s − seat].
        const seat = rng.int(n);
        const hs = heat(n, fuse, seat);
        expect(hs.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
        for (let s = 0; s < n; s++) expect(hs[s]).toBe(g[mod(s - seat, n)]);
      }
    }
  });

  it('the start odds match a direct simulation of the raw bomb', () => {
    const cases: [number, (typeof FUSES)[number], number[]][] = [
      [6, 'medium', [0]],
      [10, 'short', [1, 9]],
      [12, 'long', [6]],
      [16, 'short', [7, 8, 9]],
      [8, 'long', [2, 3, 5]],
    ];
    for (const [n, fuse, picks] of cases) {
      const rounds = 40_000;
      let hits = 0;
      for (let r = 0; r < rounds; r++) {
        let x = 0;
        for (;;) {
          x = mod(x + (rng.next() < 0.5 ? 1 : -1), n);
          if (rng.next() < FUSE[fuse].h) break;
        }
        if (picks.includes(x)) hits++;
      }
      const p = blowChance(n, fuse, 0, picks);
      expect(Math.abs(hits / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds));
    }
  });

  it('martingale: the next hop’s four outcomes average back to the odds now', () => {
    for (const n of SEAT_COUNTS) {
      for (const fuse of FUSES) {
        for (let t = 0; t < 30; t++) {
          const picks = randomPicks(n);
          const side: Side = rng.next() < 0.5 ? 'on' : 'off';
          const seat = rng.int(n);
          const ev = nextEvents(n, fuse, seat, picks, side);
          expect(ev.reduce((a, e) => a + e.prob, 0)).toBeCloseTo(1, 14);
          const now = winChance(n, fuse, seat, picks, side);
          expect(ev.reduce((a, e) => a + e.prob * e.win, 0)).toBeCloseTo(now, 12);
          // So the cash-out, prize × P, is a fair bet every hop.
          const prize = startPrize(n, fuse, picks, side);
          expect(ev.reduce((a, e) => a + e.prob * prize * e.win, 0)).toBeCloseTo(prize * now, 9);
        }
      }
    }
  });

  it('what the board draws as your odds is your share of the heat ring', () => {
    for (const n of SEAT_COUNTS) {
      for (const fuse of FUSES) {
        for (let seat = 0; seat < n; seat++) {
          const picks = randomPicks(n);
          const hs = heat(n, fuse, seat);
          const mine = picks.reduce((a, s) => a + hs[s], 0);
          expect(winChance(n, fuse, seat, picks, 'on')).toBeCloseTo(mine, 14);
          expect(winChance(n, fuse, seat, picks, 'off')).toBeCloseTo(1 - mine, 14);
        }
      }
    }
  });

  it('switching keeps the cash-out and relocks the prize fairly, within the cap', () => {
    for (let t = 0; t < 400; t++) {
      const n = SEAT_COUNTS[rng.int(SEAT_COUNTS.length)];
      const fuse = FUSES[rng.int(3)];
      const seat = rng.int(n);
      const cash = 0.05 + rng.next() * 5;
      const picks = randomPicks(n);
      const side: Side = rng.next() < 0.5 ? 'on' : 'off';
      const prize = relock(cash, n, fuse, seat, picks, side);
      const p = winChance(n, fuse, seat, picks, side);
      if (prize === null) expect(cash / p).toBeGreaterThan(MAX_WIN);
      else {
        expect(prize * p).toBeCloseTo(cash, 12);
        expect(prize).toBeLessThanOrEqual(MAX_WIN);
      }
    }
  });

  it('every fresh bet’s prize is under the cap, and presets fit every ring', () => {
    expect(maxStartPrize()).toBeLessThanOrEqual(MAX_WIN);
    expect(manifest.maxMultiplier).toBe(MAX_WIN);
    for (const n of SEAT_COUNTS)
      for (const p of PRESETS) {
        const picks = presetPicks(p, n);
        expect(new Set(picks).size).toBe(picks.length);
        for (const s of picks) expect(s >= 0 && s < n).toBe(true);
      }
  });

  it('the tick uses exact ½ hops and the fuse chance', () => {
    const counts = { cw: 0, blow: 0 };
    const N = 100_000;
    for (let i = 0; i < N; i++) {
      const t = tick(rng.next, 'medium');
      if (t.dir === 1) counts.cw++;
      if (t.blows) counts.blow++;
    }
    expect(Math.abs(counts.cw / N - 0.5)).toBeLessThan(4 * Math.sqrt(0.25 / N));
    expect(Math.abs(counts.blow / N - 0.1)).toBeLessThan(4 * Math.sqrt(0.09 / N));
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
    expect(manifest.rtp).toBe(RTP);
  });
});
