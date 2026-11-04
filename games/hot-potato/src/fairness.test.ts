// Fairness audit: can any way of playing Hot Potato beat the RTP?
//
// The seats backed (k) are fixed at the bet. After that the only decision is
// when to cash out: at each checkpoint, cash out for prize · W(seat) or spin.
// The bomb's seat is a time-homogeneous Markov chain and the cash-out depends
// only on the seat, so the optimal stopping rule is a stopping SET of seats
// (classical optimal stopping for a finite Markov chain). There are only
// 2^10 = 1024 sets per k: the exact test values every one of them, so no
// stopping rule at all (history-dependent ones included) can do better.
//
// Strategies, per eval config:
//   (a) the tester's: spin while the next spin's survival chance is ≥ 80%,
//       else cash out. A spin loses only when it blows on a seat you don't
//       back (h = 20%), so survival is always ≥ 80%: (a) always spins and is
//       the same as (c). A stricter reading (spin only if it can't lose: sit
//       on your own seat) is checked too;
//   (b) take any profit: cash out the moment V > 1 (the stake);
//   (c) play to the blast;
//   (d) the strongest: the best of all 1024 stopping sets (exact), plus
//       "lock in any rise" (cash out right after a hop that raised V) and
//       every Auto target, by Monte Carlo through the real spin().

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { H, N, RTP, SEAT_OPTIONS, backedSeats, mod, nextSpin, spin, startPrize, winChance, winsAt } from './math';

/** Rounds per Monte Carlo run; the audit's heavy run sets FAIRNESS_ROUNDS=200000. */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 5_000);
const PASS = (1 - H) / 2;

/** The cash-out at a checkpoint, as Game.tsx computes it (cashOf). */
const V = (seat: number, picks: readonly number[]) => startPrize(picks) * winChance(mod(seat, N), picks);

/**
 * Exact value of "cash out as soon as the bomb's seat is in `stop`" from seat 0
 * (seat 0 itself included: stopping there is cashing out before the first spin).
 * Value iteration on v(x) = stop(x) ? V(x) : Σ_slices p · (blow ? payout : v(x ± 1)),
 * a contraction with factor ≤ 1 − h, run to machine precision.
 */
const tables = new Map<readonly number[], { slices: { p: number; to: number; pay: number }[][]; cash: number[] }>();
function tableOf(picks: readonly number[]) {
  let t = tables.get(picks);
  if (!t) {
    const prize = startPrize(picks);
    // The game's own slices and prices, read once per seat.
    const slices = Array.from({ length: N }, (_, x) => nextSpin(x, picks).map((s) => ({ p: s.prob, to: s.move === 0 ? -1 : mod(x + s.move, N), pay: winsAt(x, picks) ? prize : 0 })));
    tables.set(picks, (t = { slices, cash: Array.from({ length: N }, (_, x) => V(x, picks)) }));
  }
  return t;
}

function exactStopSet(picks: readonly number[], stop: (seat: number) => boolean): number {
  const { slices, cash } = tableOf(picks);
  const stops = Array.from({ length: N }, (_, x) => stop(x));
  let v = new Float64Array(N);
  // (1 − h)^200 < 1e-19.
  for (let it = 0; it < 200; it++) {
    const nv = new Float64Array(N);
    for (let x = 0; x < N; x++) {
      if (stops[x]) {
        nv[x] = cash[x];
        continue;
      }
      let e = 0;
      for (const s of slices[x]) e += s.p * (s.to < 0 ? s.pay : v[s.to]);
      nv[x] = e;
    }
    v = nv;
  }
  return v[0];
}

/** One manual round exactly as Game.tsx plays it (spinOnce / cashOut), with a stopping rule on (seat, previous cash). */
function playRound(picks: readonly number[], stop: (seat: number, cash: number, prev: number | null) => boolean, rng: Rng): number {
  const prize = startPrize(picks);
  let x = 0;
  let prev: number | null = null;
  for (;;) {
    const cash = prize * winChance(mod(x, N), picks);
    if (stop(mod(x, N), cash, prev)) return cash;
    const { blows, dir } = spin(rng.next);
    if (blows) return winsAt(mod(x, N), picks) ? prize : 0;
    prev = cash;
    x += dir;
  }
}

function mc(play: (rng: Rng) => number, rounds: number, seed: number) {
  const rng = createRng(seededSource(seed));
  let s = 0;
  let s2 = 0;
  for (let i = 0; i < rounds; i++) {
    const x = play(rng);
    s += x;
    s2 += x * x;
  }
  const mean = s / rounds;
  return { mean, se: Math.sqrt(Math.max(0, s2 / rounds - mean * mean) / rounds) };
}

describe('Hot Potato fairness', () => {
  it('the dial: spin() blows on [0, h), hops clockwise on [h, h + (1 − h)/2), else anticlockwise, as nextSpin() and the board say', () => {
    const at = (u: number) => spin(() => u);
    const eps = 2 ** -32;
    expect(at(0)).toMatchObject({ blows: true });
    expect(at(H - eps)).toMatchObject({ blows: true });
    expect(at(H)).toMatchObject({ blows: false, dir: 1 });
    expect(at(H + PASS - eps)).toMatchObject({ blows: false, dir: 1 });
    expect(at(H + PASS)).toMatchObject({ blows: false, dir: -1 });
    expect(at(1 - eps)).toMatchObject({ blows: false, dir: -1 });
    for (let x = 0; x < N; x++) {
      const sl = nextSpin(x, backedSeats(5));
      expect(sl.map((s) => s.prob)).toEqual([H, PASS, PASS]);
      expect(sl.map((s) => s.move)).toEqual([0, 1, -1]);
    }
    // The slice widths on the 2^32 grid of rng.next(): exact to 2^-32.
    const grid = 2 ** 32;
    expect(Math.abs(Math.ceil(H * grid) / grid - H)).toBeLessThan(eps);
  });

  it('winChance is the true absorption probability (independent value iteration on the raw walk)', () => {
    for (const k of SEAT_OPTIONS) {
      const picks = backedSeats(k);
      let w = new Float64Array(N);
      for (let it = 0; it < 400; it++) {
        const nw = new Float64Array(N);
        for (let x = 0; x < N; x++) nw[x] = H * (picks.includes(x) ? 1 : 0) + PASS * (w[mod(x - 1, N)] + w[mod(x + 1, N)]);
        w = nw;
      }
      for (let x = 0; x < N; x++) expect(winChance(x, picks)).toBeCloseTo(w[x], 13);
    }
  });

  it('martingale: at every reachable state (all 10 seats × 5 settings), the next spin keeps the cash-out value', () => {
    let states = 0;
    for (const k of SEAT_OPTIONS) {
      const picks = backedSeats(k);
      const prize = startPrize(picks);
      expect(V(0, picks)).toBeCloseTo(RTP, 14);
      for (let x = 0; x < N; x++) {
        states++;
        // The paid value after each slice, as spinOnce computes it.
        let ev = 0;
        for (const s of nextSpin(x, picks)) ev += s.prob * (s.move === 0 ? (winsAt(x, picks) ? prize : 0) : V(x + s.move, picks));
        expect(Math.abs(ev - V(x, picks))).toBeLessThan(1e-12);
        // Seats reached on unwrapped positions (x + 10m) price the same.
        expect(V(x + 3 * N, picks)).toBe(V(x, picks));
        expect(V(x - 2 * N, picks)).toBeCloseTo(V(x, picks), 15);
      }
    }
    expect(states).toBeGreaterThanOrEqual(30);
    // The same check on states reached by random play through the real spin().
    const rng = createRng(seededSource(81));
    let reached = 0;
    for (let r = 0; r < 200; r++) {
      const picks = backedSeats(SEAT_OPTIONS[rng.int(SEAT_OPTIONS.length)]);
      let x = 0;
      for (;;) {
        const { blows, dir } = spin(rng.next);
        if (blows) break;
        x += dir;
        reached++;
        let ev = 0;
        for (const s of nextSpin(mod(x, N), picks)) ev += s.prob * (s.move === 0 ? (winsAt(mod(x, N), picks) ? startPrize(picks) : 0) : V(x + s.move, picks));
        expect(Math.abs(ev - V(x, picks))).toBeLessThan(1e-12);
      }
    }
    expect(reached).toBeGreaterThanOrEqual(30);
  });

  it('exact: all 1024 stopping sets (so every stopping rule, including the best) are worth RTP for every setting', () => {
    let worst = 0;
    for (const k of SEAT_OPTIONS) {
      const picks = backedSeats(k);
      for (let m = 0; m < 1 << N; m++) {
        const v = exactStopSet(picks, (x) => ((m >> x) & 1) === 1);
        worst = Math.max(worst, Math.abs(v - RTP));
      }
      // The named strategies.
      expect(exactStopSet(picks, () => false)).toBeCloseTo(RTP, 12); // (a) = (c): to the blast
      expect(exactStopSet(picks, (x) => V(x, picks) > 1)).toBeCloseTo(RTP, 12); // (b)
    }
    expect(worst).toBeLessThan(1e-12);
  });

  it('Monte Carlo with the real spin(): (a)–(d) on every eval config are within 4 SE of RTP', () => {
    const rows: string[] = [];
    evalSpec.configs.forEach(({ label, params }, ci) => {
      const picks = backedSeats(params.seats);
      const plays: { name: string; stop: (seat: number, cash: number, prev: number | null) => boolean }[] = [
        // Survival of the next spin is 1 − h = 80% off your seats, 100% on them: always ≥ 80%.
        { name: '(a) spin while survival ≥ 80%', stop: (x) => (winsAt(x, picks) ? 1 : 1 - H) < 0.8 },
        { name: '(a′) spin only on own seat', stop: (x, _, prev) => prev !== null && !winsAt(x, picks) },
        { name: '(b) any profit', stop: (_, cash) => cash > 1 },
        { name: '(c) to the blast', stop: () => false },
        { name: '(d) lock in any rise', stop: (_, cash, prev) => prev !== null && cash > prev },
        { name: '(d) Auto 1.5×', stop: (_, cash) => cash >= 1.5 - 1e-12 },
        { name: '(d) Auto 3×', stop: (_, cash) => cash >= 3 - 1e-12 },
      ];
      plays.forEach(({ name, stop }, si) => {
        const { mean, se } = mc((r) => playRound(picks, stop, r), ROUNDS, 7100 + 13 * ci + si);
        rows.push(`${label.padEnd(24)} ${name.padEnd(32)} ${(mean * 100).toFixed(2)}% ± ${(se * 100).toFixed(2)}%`);
        expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1e-9); // (+1e-9: float summation error when a rule always pays RTP, se = 0)
      });
    });
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
