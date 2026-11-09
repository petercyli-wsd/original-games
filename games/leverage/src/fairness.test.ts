// Fairness audit: can any way of playing Leverage beat the RTP?
//
// Leverage, direction, expiry, take profit and stop loss are copied into the
// position when it opens (every knob is disabled while live), so the only
// decision during a round is when to close. Game.tsx draws one tick at a time
// as wall-clock time makes it due (`p.k += tickMove(rng.next())`, then
// barrierHit, then the expiry), and Close, unmount and every auto rule settle
// at valueAt(k, n) for the ticks drawn so far. The direction never enters the
// walk: k counts ticks in the player's favour and u < ½ is a favourable tick for
// Up and Down alike, so the price history (and any "momentum" in it) carries no
// information. `playPosition` runs the same per-tick rules and is what the
// strategies below play.
//
// Martingale check, exact: one tick has two outcomes, ½ each. At 2000+ states
// (random setups and positions, plus every state next to the bust, the stop
// and the take-profit levels, at n = 10 where a tick is 10% of the margin),
// ½·V(k+1) + ½·V(k−1) must equal V(k), where V after a tick is the value the
// game settles at (valueAt, which pays 0 exactly at the bust level).
//
// Strategies, per eval config (leverage band): (a) the tester's: hold while the
// chance of hitting the stop/bust within the next second (25 ticks, exact DP via
// `odds`) is ≤ 20%, else close; (b) close the moment the value exceeds the
// stake; (c) hold to the end (TP / SL / bust / expiry); (d) scalp: close on the
// first favourable tick, and cut a loser once half the clock is gone. Each is
// valued exactly by backward induction over (ticks, k) on 72 setups (every band
// at its low, middle and high leverage × every expiry × limits off / TP 1.5 +
// SL 0.5). The quick run keeps 34 of them to stay near 5 s: every leverage at
// 10 s, the middle leverage at 30 s, and the extreme band's middle leverage at
// 60 s. Then each is played by Monte Carlo on setups sampled as eval.ts
// samples them.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import {
  EXPIRIES,
  MAX_MULTIPLIER,
  RTP,
  barrierHit,
  barriersOf,
  odds,
  playPosition,
  tickMove,
  valueAt,
  type Barriers,
  type Direction,
  type Setup,
} from './math';

/** Rounds per strategy run; the heavy audit run sets FAIRNESS_ROUNDS=200000. */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 4_000);
/** The heavy run also values the 60 s expiry at every leverage (each such setup is ~1M states). */
const HEAVY = !!import.meta.env.FAIRNESS_ROUNDS;

/** P(the lower barrier is hit within r ticks from d ticks above it): exact, from the game's own DP. */
const HAZARD: number[][] = Array.from({ length: 26 }, (_, r) =>
  Array.from({ length: 27 }, (_, d) => (d === 0 ? 1 : r === 0 ? 0 : odds(0, { n: 100_000, lo: -d, hi: null, T: r }, r).lo)),
);
const hazard = (k: number, t: number, b: Barriers) => {
  const d = k - b.lo;
  const r = Math.min(25, b.T - t);
  return d > 26 ? 0 : HAZARD[r][d];
};

/** A stopping rule after tick t with k ticks in the player's favour: close now? */
type Stop = (k: number, t: number, b: Barriers) => boolean;

const STRATEGIES: { name: string; stop: Stop }[] = [
  { name: '(a) close when ≥ 20% to hit stop/bust within 1 s', stop: (k, t, b) => hazard(k, t, b) > 0.2 },
  { name: '(b) take any profit', stop: (k, _t, b) => valueAt(k, b.n) > 1 },
  { name: '(c) hold to the end', stop: () => false },
  { name: '(d) scalp one tick, cut losers at half time', stop: (k, t, b) => k >= 1 || (2 * t >= b.T && valueAt(k, b.n) < 1) },
];

/** Exact value of a stopping rule: backward induction over (t, k), |k| ≤ t. */
function exactRtp(b: Barriers, stop: Stop): number {
  const T = b.T;
  const off = T + 1;
  let next = new Float64Array(2 * T + 3);
  let cur = new Float64Array(2 * T + 3);
  for (let k = -T; k <= T; k++) next[k + off] = valueAt(k, b.n);
  for (let t = T - 1; t >= 0; t--) {
    for (let k = -t; k <= t; k += 2) {
      const at = k + off;
      if (t > 0 && (barrierHit(k, b) || stop(k, t, b))) cur[at] = valueAt(k, b.n);
      else {
        const up = k + 1;
        const dn = k - 1;
        // After the tick: a barrier or the clock ends it at valueAt, else the stored value.
        const vUp = barrierHit(up, b) ? valueAt(up, b.n) : next[up + off];
        const vDn = barrierHit(dn, b) ? valueAt(dn, b.n) : next[dn + off];
        cur[at] = 0.5 * vUp + 0.5 * vDn;
      }
    }
    // At t = T − 1 the next row holds valueAt for every k, the expiry payout.
    [cur, next] = [next, cur];
  }
  return next[off];
}

/** Setup sampler: the same draws as eval.ts's playRound (leverage band, direction, expiry, TP / SL). */
function sampleSetup(lo: number, hi: number, rng: Rng): Setup {
  const logUniform = (a: number, z: number) => Math.exp(Math.log(a) + rng.next() * (Math.log(z) - Math.log(a)));
  return {
    lev: Math.round(logUniform(lo, hi)),
    dir: (rng.next() < 0.5 ? 'up' : 'down') as Direction,
    expiry: EXPIRIES[rng.int(EXPIRIES.length)],
    tp: rng.next() < 0.5 ? Math.round(logUniform(1.01, 6) * 100) / 100 : null,
    sl: rng.next() < 0.4 ? Math.round((0.05 + rng.next() * 0.9) * 100) / 100 : null,
  };
}

function mc(lo: number, hi: number, stop: Stop, rounds: number, seed: number) {
  const rng = createRng(seededSource(seed));
  let s1 = 0;
  let s2 = 0;
  let max = 0;
  for (let i = 0; i < rounds; i++) {
    const b = barriersOf(sampleSetup(lo, hi, rng));
    const x = playPosition(b, rng, null, (k, t) => stop(k, t, b)).multiplier;
    s1 += x;
    s2 += x * x;
    if (x > max) max = x;
  }
  const mean = s1 / rounds;
  return { mean, se: Math.sqrt(Math.max(0, s2 / rounds - mean * mean) / rounds), max };
}

const BANDS = evalSpec.configs.map((c) => c.params);

describe('Leverage fairness', () => {
  it('a tick is +1 or −1 with chance ½ each (tickMove over a 2^16 grid of u)', () => {
    const N = 1 << 16;
    let up = 0;
    for (let i = 0; i < N; i++) up += tickMove(i / N) === 1 ? 1 : 0;
    expect(up).toBe(N / 2);
  });

  it('martingale: at 2000+ states, E[value after the next tick] = value now (exact two-point enumeration)', () => {
    const rng = createRng(seededSource(41));
    const check = (b: Barriers, k: number) => {
      if (barrierHit(k, b)) return 0;
      const after = 0.5 * valueAt(k + 1, b.n) + 0.5 * valueAt(k - 1, b.n);
      expect(Math.abs(after - valueAt(k, b.n))).toBeLessThan(1e-12);
      expect(valueAt(k + 1, b.n)).toBeLessThanOrEqual(MAX_MULTIPLIER + 1e-9);
      return 1;
    };
    let checked = 0;
    // States reached by random positions on eval-sampled setups.
    for (let i = 0; i < 400; i++) {
      const { lo, hi } = BANDS[i % BANDS.length];
      const b = barriersOf(sampleSetup(lo, hi, rng));
      const cut = 1 + rng.int(b.T);
      let k = 0;
      for (let t = 1; t <= cut; t++) {
        k += tickMove(rng.next());
        if (barrierHit(k, b)) break;
        if (rng.next() < 0.02) checked += check(b, k);
      }
    }
    // Every state next to a barrier, at the extreme lattice (n = 10) and at a few others.
    for (const lev of [2, 37, 500, 1000])
      for (const [tp, sl] of [
        [null, null],
        [1.01, 0.98],
        [6, 0.05],
      ] as const) {
        const b = barriersOf({ lev, dir: 'up', expiry: 60, tp, sl });
        for (const k of [b.lo + 1, b.lo + 2, -1, 0, 1, ...(b.hi !== null ? [b.hi - 1, b.hi - 2] : [b.T - 1])]) checked += check(b, k);
      }
    expect(checked).toBeGreaterThan(2000);
  });

  it(`exact strategy values: every stopping rule returns RTP on ${HEAVY ? 72 : 34} setups (backward induction over ticks)`, () => {
    let setups = 0;
    BANDS.forEach(({ lo, hi }, bi) => {
      const mid = Math.round(Math.sqrt(lo * hi));
      for (const lev of [lo, mid, hi])
        for (const expiry of EXPIRIES.filter((e) => HEAVY || e === 10 || (lev === mid && (e === 30 || bi === BANDS.length - 1))))
          for (const [tp, sl] of [
            [null, null],
            [1.5, 0.5],
          ] as const) {
            const b = barriersOf({ lev, dir: 'up', expiry, tp, sl });
            for (const st of STRATEGIES) expect(Math.abs(exactRtp(b, st.stop) - RTP), `${lev}× ${expiry}s ${tp}/${sl} ${st.name}`).toBeLessThan(1e-9);
            setups++;
          }
    });
    expect(setups).toBe(HEAVY ? 72 : 34);
  });

  it(`Monte Carlo (${ROUNDS} rounds per strategy and eval config, eval-sampled setups, real playPosition + seeded RNG): within 4 SE of RTP`, () => {
    const rows: string[] = [];
    evalSpec.configs.forEach((cfg, ci) =>
      STRATEGIES.forEach((st, si) => {
        const r = mc(cfg.params.lo, cfg.params.hi, st.stop, ROUNDS, 700 + 10 * ci + si);
        rows.push(`${cfg.label} | ${st.name} | ${(100 * r.mean).toFixed(2)}% ± ${(100 * r.se).toFixed(2)}% | max ${r.max.toFixed(2)}`);
        expect(Math.abs(r.mean - RTP), `${cfg.label} ${st.name}`).toBeLessThan(4 * r.se + 1e-9);
        expect(r.max).toBeLessThanOrEqual(MAX_MULTIPLIER);
      }),
    );
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
