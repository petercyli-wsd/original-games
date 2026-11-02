import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  H,
  MAX_MULTIPLIER,
  N,
  RTP,
  SEAT_OPTIONS,
  backedSeats,
  blowFromHere,
  decay,
  heat,
  maxStartPrize,
  mod,
  needleAngle,
  nextSpin,
  spin,
  startPrize,
  winChance,
  winsAt,
} from './math';

const rng = createRng(seededSource(11));

/** The resolvent row h·Σₖ (1 − h)^k P^k e₀, summed directly as a power series. */
function series(n: number, h: number): Float64Array {
  let v = new Float64Array(n);
  v[0] = 1;
  const out = new Float64Array(n);
  for (let w = h; w > 1e-18; w *= 1 - h) {
    for (let i = 0; i < n; i++) out[i] += w * v[i];
    const nv = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      nv[mod(i + 1, n)] += v[i] / 2;
      nv[mod(i - 1, n)] += v[i] / 2;
    }
    v = nv;
  }
  return out;
}

describe('Hot Potato maths', () => {
  it('the closed-form heat matches the series Σ h(1−h)^k P^k and sums to 1', () => {
    expect(decay()).toBeCloseTo(0.5, 15); // h = 1/5 makes the decay exactly ½
    for (const n of [N, 6, 9, 16]) {
      for (const h of [H, 0.05, 0.1, 0.35]) {
        const g = blowFromHere(n, h);
        const s = series(n, h);
        expect(g.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 13);
        for (let d = 0; d < n; d++) {
          expect(g[d]).toBeCloseTo(s[d], 13);
          expect(g[d]).toBeCloseTo(g[mod(-d, n)], 15); // mirror symmetry
        }
      }
    }
    // Rotating with the bomb: heat(seat)[s] = g[s − seat].
    const g = blowFromHere();
    for (let seat = 0; seat < N; seat++) {
      const hs = heat(seat);
      expect(hs.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 13);
      for (let s = 0; s < N; s++) expect(hs[s]).toBe(g[mod(s - seat, N)]);
    }
  });

  it('the start odds match a direct simulation of the raw bomb', () => {
    for (const k of SEAT_OPTIONS) {
      const picks = backedSeats(k);
      const rounds = 60_000;
      let hits = 0;
      for (let r = 0; r < rounds; r++) {
        let x = 0;
        // The raw process: blow where it sits with chance h, else a fair hop.
        while (!(rng.next() < H)) x = mod(x + (rng.next() < 0.5 ? 1 : -1), N);
        if (picks.includes(x)) hits++;
      }
      const p = winChance(0, picks);
      expect(Math.abs(hits / rounds - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / rounds));
    }
  });

  it('martingale: the three slices of the next spin average back to the odds now', () => {
    for (const k of SEAT_OPTIONS) {
      const picks = backedSeats(k);
      const prize = startPrize(picks);
      expect(prize * winChance(0, picks)).toBeCloseTo(RTP, 14); // first checkpoint pays RTP
      for (let seat = 0; seat < N; seat++) {
        const ev = nextSpin(seat, picks);
        expect(ev.reduce((a, e) => a + e.prob, 0)).toBeCloseTo(1, 15);
        const now = winChance(seat, picks);
        expect(ev.reduce((a, e) => a + e.prob * e.win, 0)).toBeCloseTo(now, 14);
        expect(ev.reduce((a, e) => a + e.prob * prize * e.win, 0)).toBeCloseTo(prize * now, 11);
      }
    }
  });

  it('what the board draws as your odds is your share of the heat ring', () => {
    for (const k of SEAT_OPTIONS) {
      const picks = backedSeats(k);
      for (let seat = 0; seat < N; seat++) {
        const hs = heat(seat);
        const mine = hs.reduce((a, p, s) => a + (winsAt(s, picks) ? p : 0), 0);
        expect(winChance(seat, picks)).toBeCloseTo(mine, 15);
      }
    }
  });

  it('the dial: the needle angle lands in the slice that decides the spin, each slice its chance wide', () => {
    // Slices in degrees clockwise from the bomb: red [−h·180, h·180), clockwise to 180, anticlockwise to 360 − h·180.
    const red = H * 180;
    for (let i = 0; i < 20_000; i++) {
      let calls = 0;
      const t = spin(() => {
        calls++;
        return rng.next();
      });
      expect(calls).toBe(1);
      const a = needleAngle(t.u);
      if (t.blows) expect(a >= -red && a < red).toBe(true);
      else if (t.dir === 1) expect(a >= red && a < 180).toBe(true);
      else expect(a >= 180 && a < 360 - red).toBe(true);
    }
    expect((2 * red) / 360).toBeCloseTo(H, 15);
    expect((180 - red) / 360).toBeCloseTo((1 - H) / 2, 15);
    // The draw's frequencies.
    const n = 100_000;
    let blows = 0;
    let cw = 0;
    for (let i = 0; i < n; i++) {
      const t = spin(rng.next);
      if (t.blows) blows++;
      else if (t.dir === 1) cw++;
    }
    expect(Math.abs(blows / n - H)).toBeLessThan(4 * Math.sqrt((H * (1 - H)) / n));
    const q = (1 - H) / 2;
    expect(Math.abs(cw / n - q)).toBeLessThan(4 * Math.sqrt((q * (1 - q)) / n));
  });

  it('the one knob spans over 25:1, backed seats fit the ring, and the max win is honest', () => {
    const ps = SEAT_OPTIONS.map((k) => winChance(0, backedSeats(k)));
    for (let i = 1; i < ps.length; i++) expect(ps[i]).toBeGreaterThan(ps[i - 1]);
    expect(ps[ps.length - 1] / ps[0]).toBeGreaterThan(25);
    for (const k of SEAT_OPTIONS) {
      const picks = backedSeats(k);
      expect(picks.length).toBe(k);
      expect(new Set(picks).size).toBe(k);
      for (const s of picks) expect(s > 0 && s < N).toBe(true);
    }
    expect(maxStartPrize()).toBeLessThanOrEqual(MAX_MULTIPLIER);
    expect(manifest.maxMultiplier).toBe(MAX_MULTIPLIER);
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    const results = runEval(evalSpec, { rounds: 50_000 });
    for (const r of results) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
    expect(manifest.rtp).toBe(RTP);
  });
});
