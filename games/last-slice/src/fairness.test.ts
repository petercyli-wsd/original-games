// Fairness audit: can any way of playing Last Slice beat the RTP?
//
// Decisions in a round: when to stop, and (at any checkpoint) which slice to
// back, which keeps the cash-out and relocks the prize at cash / P(new slice
// last). The wheel (slice count and sizes) is locked while live. A spin is
// `landing(w, mask, rng.next())`, and what it pays is computed as Game.tsx's
// spin() / playAuto() do: your slice → 0, one slice left → prize, else
// prize · winChance.
//
// Checks:
//  - `landing` turns a uniform u into slice j with chance w_j / W (swept over a
//    2^16-point dyadic grid of u, including u = 0 and the slice boundaries).
//  - Martingale, exact: at every wheel × every mask with 2+ slices left × every
//    backed slice (prize as if never switched, and at random relocked prizes
//    from switching rounds), E[cash-out after the next spin] = cash-out now,
//    enumerating the slices left; and every switch keeps the cash-out (1e-12
//    relative) or is refused only above MAX_WIN.
//  - Strategies, per eval config: (a) the tester's: spin while the spin misses
//    your slice ≥ 80% of the time, else cash out; (b) take any profit; (c) play
//    to the last slice; (d) always switch to the slice least likely to be hit
//    next, then spin while ≥ 80% safe; (e) chase the longshot: switch to the
//    biggest slice still allowed by MAX_WIN, play to the end; (f) Auto at 2×.
//    Each valued exactly by enumerating the whole elimination tree, then played
//    on the real functions with the seeded RNG.

import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import {
  MAX_WIN,
  RTP,
  SHAPES,
  SLICE_COUNTS,
  aliveList,
  countAlive,
  fullMask,
  has,
  landing,
  relock,
  spinChances,
  startPrize,
  totalWeight,
  wheel,
  winChance,
} from './math';

/** Rounds per strategy run; the heavy audit run sets FAIRNESS_ROUNDS=200000. */
const ROUNDS = Number(import.meta.env.FAIRNESS_ROUNDS ?? 20_000);

const WHEELS = SLICE_COUNTS.flatMap((k) => SHAPES.map((shape) => ({ k, shape, w: wheel(k, shape) })));

interface St {
  w: readonly number[];
  mask: number;
  mine: number;
  prize: number;
}
const cashOf = (s: St) => s.prize * winChance(s.w, s.mask, s.mine);

/** What a spin landing on `slice` leads to, as Game.tsx's spin() computes it. */
function afterSpin(s: St, slice: number): { done: boolean; paid: number; next: St } {
  if (slice === s.mine) return { done: true, paid: 0, next: s };
  const next = { ...s, mask: s.mask & ~(1 << slice) };
  if (countAlive(next.mask) === 1) return { done: true, paid: s.prize, next };
  return { done: false, paid: cashOf(next), next };
}

/** A strategy at a checkpoint: cash out, or spin (after optionally switching to another slice). */
type Strategy = (s: St, cash: number) => { cash: true } | { cash: false; switchTo?: number };

const hitShare = (s: St, i: number) => s.w[i] / totalWeight(s.w, s.mask);
function switched(s: St, to: number | undefined): St {
  if (to === undefined || to === s.mine) return s;
  const prize = relock(cashOf(s), s.w, s.mask, to);
  return prize === null ? s : { ...s, mine: to, prize };
}

const STRATEGIES: { name: string; play: Strategy }[] = [
  { name: '(a) spin while ≥ 80% safe', play: (s) => ({ cash: 1 - hitShare(s, s.mine) < 0.8 }) },
  { name: '(b) take any profit', play: (_s, c) => ({ cash: c > 1 }) },
  { name: '(c) play to the last slice', play: () => ({ cash: false }) },
  {
    name: '(d) switch to the least-hit slice, spin while ≥ 80% safe',
    play: (s) => {
      const best = aliveList(s.mask, s.w.length).reduce((a, i) => (s.w[i] < s.w[a] ? i : a));
      const t = switched(s, best);
      return 1 - hitShare(t, t.mine) < 0.8 ? { cash: true } : { cash: false, switchTo: best };
    },
  },
  {
    name: '(e) chase the longshot (biggest slice allowed), to the end',
    play: (s) => {
      const order = aliveList(s.mask, s.w.length).sort((a, b) => s.w[b] - s.w[a]);
      const pick = order.find((i) => i === s.mine || relock(cashOf(s), s.w, s.mask, i) !== null);
      return { cash: false, switchTo: pick };
    },
  },
  { name: '(f) Auto: cash out at 2×', play: (_s, c) => ({ cash: c >= 2 - 1e-12 }) },
];

/** Exact value of a strategy from a fresh bet: the whole elimination tree. */
function exactRtp(s0: St, play: Strategy): number {
  const spin = (s: St): number => {
    const p = spinChances(s.w, s.mask);
    let ev = 0;
    for (const j of aliveList(s.mask, s.w.length)) {
      const r = afterSpin(s, j);
      ev += p[j] * (r.done ? r.paid : decide(r.next, r.paid));
    }
    return ev;
  };
  const decide = (s: St, cash: number): number => {
    const d = play(s, cash);
    return d.cash ? cash : spin(switched(s, d.switchTo));
  };
  return spin(s0);
}

function playRound(s0: St, play: Strategy, rng: Rng): number {
  let s = s0;
  for (;;) {
    const { slice } = landing(s.w, s.mask, rng.next());
    const r = afterSpin(s, slice);
    if (r.done) return r.paid;
    const d = play(r.next, r.paid);
    if (d.cash) return r.paid;
    s = switched(r.next, d.switchTo);
  }
}

function mc(s0: St, play: Strategy, rounds: number, seed: number) {
  const rng = createRng(seededSource(seed));
  let s1 = 0;
  let s2 = 0;
  let max = 0;
  for (let i = 0; i < rounds; i++) {
    const x = playRound(s0, play, rng);
    s1 += x;
    s2 += x * x;
    if (x > max) max = x;
  }
  const mean = s1 / rounds;
  return { mean, se: Math.sqrt(Math.max(0, s2 / rounds - mean * mean) / rounds), max };
}

const fresh = (k: number, shape: (typeof SHAPES)[number], mine: number): St => {
  const w = wheel(k as (typeof SLICE_COUNTS)[number], shape);
  return { w, mask: fullMask(k), mine, prize: startPrize(w, mine) };
};

describe('Last Slice fairness', () => {
  it('landing(u) hits slice j with chance w_j / W (2^16-point grid of u, every wheel, sample masks)', () => {
    const N = 1 << 16;
    for (const { k, w } of WHEELS)
      for (const mask of [fullMask(k), fullMask(k) & ~1, fullMask(k) & ~(1 << (k - 1)), 0b11, 0b101]) {
        const count = new Float64Array(k);
        for (let i = 0; i < N; i++) count[landing(w, mask, i / N).slice]++;
        const p = spinChances(w, mask);
        for (let j = 0; j < k; j++) {
          if (!has(mask, j)) expect(count[j]).toBe(0);
          expect(Math.abs(count[j] / N - p[j])).toBeLessThanOrEqual(2 / N);
        }
      }
  });

  it('martingale: every wheel × mask × backed slice, E[cash-out after the spin] = cash-out now; every switch keeps the value', () => {
    let checked = 0;
    for (const { k, w } of WHEELS)
      for (let mask = 1; mask <= fullMask(k); mask++) {
        if (countAlive(mask) < 2) continue;
        for (const mine of aliveList(mask, k)) {
          const s: St = { w, mask, mine, prize: startPrize(w, mine) };
          const now = cashOf(s);
          const p = spinChances(w, mask);
          const after = aliveList(mask, k).reduce((a, j) => a + p[j] * afterSpin(s, j).paid, 0);
          expect(Math.abs(after - now)).toBeLessThan(1e-12 * Math.max(1, s.prize));
          for (const j of aliveList(mask, k)) {
            const prize = relock(now, w, mask, j);
            if (prize === null) {
              expect(now / winChance(w, mask, j)).toBeGreaterThan(MAX_WIN);
              continue;
            }
            expect(prize).toBeLessThanOrEqual(MAX_WIN);
            expect(Math.abs(prize * winChance(w, mask, j) - now)).toBeLessThan(1e-12 * Math.max(1, now));
          }
          checked++;
        }
      }
    expect(checked).toBeGreaterThan(5000);
  });

  it('martingale at 40 states reached by random rounds with random switches (relocked prizes)', () => {
    const rng = createRng(seededSource(31));
    let checked = 0;
    while (checked < 40) {
      const { w } = WHEELS[rng.int(WHEELS.length)];
      let s: St = { w, mask: fullMask(w.length), mine: rng.int(w.length), prize: 0 };
      s.prize = startPrize(w, s.mine);
      for (;;) {
        const r = afterSpin(s, landing(w, s.mask, rng.next()).slice);
        if (r.done) break;
        s = switched(r.next, rng.int(w.length));
        if (!has(s.mask, s.mine)) break;
        const now = cashOf(s);
        expect(Math.abs(now - r.paid)).toBeLessThan(1e-12 * Math.max(1, now));
        const p = spinChances(w, s.mask);
        const after = aliveList(s.mask, w.length).reduce((a, j) => a + p[j] * afterSpin(s, j).paid, 0);
        expect(Math.abs(after - now)).toBeLessThan(1e-12 * Math.max(1, s.prize));
        checked++;
      }
    }
  });

  it('exact strategy values: every strategy on every eval config and every backed slice of every wheel returns RTP', () => {
    for (const cfg of evalSpec.configs) {
      const { k, shape, mine } = cfg.params;
      for (const st of STRATEGIES) expect(Math.abs(exactRtp(fresh(k, shape, mine), st.play) - RTP), `${cfg.label} ${st.name}`).toBeLessThan(1e-12);
    }
    // Every starting slice on the 5- and 6-slice wheels (the bigger trees run in the eval configs above).
    for (const { k, shape } of WHEELS.filter((x) => x.k <= 6))
      for (let mine = 0; mine < k; mine++)
        for (const st of STRATEGIES) expect(Math.abs(exactRtp(fresh(k, shape, mine), st.play) - RTP)).toBeLessThan(1e-12);
  });

  it(`Monte Carlo (${ROUNDS} rounds per strategy and eval config, real landing + seeded RNG): within 4 SE of RTP, never above MAX_WIN`, () => {
    const rows: string[] = [];
    evalSpec.configs.forEach((cfg, ci) =>
      STRATEGIES.forEach((st, si) => {
        const { k, shape, mine } = cfg.params;
        const r = mc(fresh(k, shape, mine), st.play, ROUNDS, 300 + 10 * ci + si);
        rows.push(`${cfg.label} | ${st.name} | ${(100 * r.mean).toFixed(2)}% ± ${(100 * r.se).toFixed(2)}% | max ${r.max.toFixed(1)}`);
        expect(Math.abs(r.mean - RTP), `${cfg.label} ${st.name}`).toBeLessThan(4 * r.se + 1e-9);
        expect(r.max).toBeLessThanOrEqual(MAX_WIN);
      }),
    );
    if (import.meta.env.FAIRNESS_ROUNDS) console.log(rows.join('\n'));
  });
});
