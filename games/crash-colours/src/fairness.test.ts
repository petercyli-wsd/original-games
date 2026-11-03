// Fairness audit for Crash Colours.
//
// There is no decision once the bet is placed: the stakes, lines and mode are
// disabled while the line climbs, the only live control is "Skip to result",
// and leaving mid-climb settles at the already-drawn result (useTicket returns
// the resolved multiplier). So strategies (a) "act only at ≥ 80%" and (b) "take
// any profit" collapse to (c) "play to the end": the only choice is the ticket
// itself (stakes × lines), made before the draw.
//
// Checks, all through the game's own functions:
//  1. Grid-exact law: P(C ≥ x) on the host's 32-bit grid, by bisection on
//     crashPoint, is ≤ 0.99/x and within 2^-32 of it, for every line.
//  2. Martingale during the climb (≥ 30 states): the ticket's value given
//     C ≥ m equals the chance-weighted value one cent later, and the live odds
//     on the cards (chancesFrom) are the true conditional chances.
//  3. Every eval config: Monte Carlo through evalSpec.playRound, plus the exact
//     value of each sampled ticket (the same playRound replayed at one draw per
//     piece of the crash axis, weighted by that piece's grid probability).
//  4. (d) the strongest tickets: every band alone at every line, and the
//     widest hedges, exact, plus Monte Carlo for the extremes.
import { createRng, seededSource, type Rng } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import { BANDS, MOONS, RTP, SPLITS, chancesFrom, crashPoint, multiplierOf, type Lines, type Stakes } from './math';

const ENV = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const REPORT = !!ENV.FAIRNESS_REPORT;
const GRID = 2 ** 32;
const cents = (x: number) => Math.round(x * 100);

/** Smallest grid index j with crashPoint(j / 2^32) ≥ x (crashPoint is increasing in the draw). */
const memo = new Map<number, number>();
function firstJ(xc: number): number {
  let j = memo.get(xc);
  if (j !== undefined) return j;
  let lo = 0;
  let hi = GRID;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (cents(crashPoint(mid / GRID)) >= xc) hi = mid;
    else lo = mid + 1;
  }
  memo.set(xc, lo);
  return lo;
}
/** Exact P(C ≥ x) under the host rng (x in cents). */
const reach = (xc: number) => (GRID - firstJ(xc)) / GRID;

const ALL_LINES: Lines[] = SPLITS.flatMap((split) => MOONS.filter((m) => m > split).map((moon) => ({ split, moon })));
/** Every line on the crash axis: the multiplier of any ticket is constant between consecutive cuts. */
const CUTS = [...new Set([100, ...SPLITS.map(cents), ...MOONS.map(cents)])].sort((a, b) => a - b);

/** Exact E[f(draw)] for any f constant between the cuts: one draw per piece, weighted by its grid probability. */
function exactOver(f: (u: number) => number, fromC = 100): number {
  const cuts = [fromC, ...CUTS.filter((c) => c > fromC)];
  const total = reach(fromC);
  let e = 0;
  cuts.forEach((c, i) => {
    const p = (reach(c) - (i + 1 < cuts.length ? reach(cuts[i + 1]) : 0)) / total;
    e += p * f(firstJ(c) / GRID);
  });
  return e;
}
const ticketValue = (st: Stakes, ls: Lines, fromC = 100) => exactOver((u) => multiplierOf(st, crashPoint(u), ls), fromC);

/** A rng that replays recorded draws and swaps the last one (the crash draw) for `u`. */
function replay(draws: number[], u: number): Rng {
  let i = 0;
  const next = () => (i < draws.length - 1 ? draws[i++] : (i++, u));
  return { next, int: (n) => Math.floor(next() * n), shuffle: (xs) => xs.slice() };
}

describe('Crash Colours fairness', () => {
  it('the draw is exact on the host grid and rounds towards the house', () => {
    for (const xc of CUTS.filter((c) => c > 100)) {
      const p = reach(xc);
      expect(p).toBeLessThanOrEqual(0.99 / (xc / 100));
      expect(0.99 / (xc / 100) - p).toBeLessThanOrEqual(1 / GRID);
    }
    expect(crashPoint(0)).toBe(1); // U = 1: an instant crash
    // Every pure band at every line: within the grid's rounding of the RTP (≤ pay × 2^-32). Green and Moon round
    // down; Red (the complement) can round up, by at most 2.92 × 2^-32 < 1e-9.
    let worst = -1;
    for (const ls of ALL_LINES)
      for (const b of BANDS) {
        const st: Stakes = { red: 0, green: 0, moon: 0, [b]: 1 };
        const v = ticketValue(st, ls);
        expect(Math.abs(v - RTP)).toBeLessThan(1001 / GRID);
        if (b !== 'red') expect(v).toBeLessThanOrEqual(RTP + 1e-15);
        worst = Math.max(worst, v - RTP);
      }
    expect(worst).toBeLessThan(1e-9);
    if (REPORT) console.log(`largest excess of any band over the RTP on the 32-bit grid: ${worst.toExponential(2)}`);
  });

  it('martingale during the climb: value(C ≥ m) is the average of the next cent, and the card odds are exact', () => {
    const rng = createRng(seededSource(4));
    let checked = 0;
    while (checked < 40) {
      const ls = ALL_LINES[rng.int(ALL_LINES.length)];
      const st: Stakes = { red: rng.next() < 0.5 ? rng.next() : 0, green: rng.next(), moon: rng.next() < 0.5 ? rng.next() : 0 };
      // A climb state: a drawn crash point, and a level the line has reached before it.
      const c = cents(crashPoint(rng.next()));
      const near = [100, cents(ls.split) - 1, cents(ls.split), cents(ls.moon) - 1, cents(ls.moon)];
      const m = rng.next() < 0.4 ? near[rng.int(near.length)] : 100 + Math.floor(rng.next() * (c - 100 + 1));
      const V = ticketValue(st, ls, m);
      // Next event: the line crashes at m, or reaches m + 1 cent.
      const pStop = (reach(m) - reach(m + 1)) / reach(m);
      const atM = multiplierOf(st, crashPoint(firstJ(m) / GRID), ls);
      const next = pStop * atM + (1 - pStop) * ticketValue(st, ls, m + 1);
      expect(Math.abs(next - V)).toBeLessThan(1e-9);
      // The cards' "now" chances (chancesFrom) are the true conditional chances.
      const shown = chancesFrom(ls, m / 100);
      const trueGreen = cents(ls.split) <= m ? 1 : reach(cents(ls.split)) / reach(m);
      const trueMoon = cents(ls.moon) <= m ? 1 : reach(cents(ls.moon)) / reach(m);
      expect(Math.abs(shown.green - trueGreen)).toBeLessThan(1e-6);
      expect(Math.abs(shown.moon - trueMoon)).toBeLessThan(1e-6);
      expect(Math.abs(shown.red - (1 - trueGreen))).toBeLessThan(1e-6);
      checked++;
    }
  });

  it('(a) = (b) = (c): every eval config returns the RTP (Monte Carlo and exact per ticket)', () => {
    // Monte Carlo through evalSpec.playRound with the crash draw stratified (R replicates give the SE), and the
    // exact value of each sampled ticket (playRound replayed at one draw per piece of the crash axis).
    const R = 20;
    const per = REPORT ? 50_000 : 2_000;
    evalSpec.configs.forEach(({ label, params }, ci) => {
      const rng = createRng(seededSource(500 + ci));
      const means: number[] = [];
      let ex = 0;
      let exN = 0;
      for (let r = 0; r < R; r++) {
        let sum = 0;
        for (let i = 0; i < per; i++) {
          const draws: number[] = [];
          const rec: Rng = { next: () => (draws.push(rng.next()), draws[draws.length - 1]), int: (n) => Math.floor(rec.next() * n), shuffle: (xs) => xs.slice() };
          evalSpec.playRound(params, rec);
          const u = Math.floor(((i + rng.next()) / per) * GRID) / GRID;
          sum += evalSpec.playRound(params, replay(draws, u)).multiplier;
          if (i % 25 === 0) {
            ex += exactOver((v) => evalSpec.playRound(params, replay(draws, v)).multiplier);
            exN++;
          }
        }
        means.push(sum / per);
      }
      const mean = means.reduce((a, x) => a + x, 0) / R;
      const se = Math.sqrt(means.reduce((a, x) => a + (x - mean) ** 2, 0) / (R - 1) / R);
      const exact = ex / exN;
      if (REPORT) console.log(`${label} | MC ${(mean * 100).toFixed(3)}% ± ${(se * 100).toFixed(3)} (${R * per} rounds, stratified draw) | exact per ticket ${(exact * 100).toFixed(6)}%`);
      expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1000 / per);
      expect(Math.abs(exact - RTP)).toBeLessThan(1001 / GRID);
    });
  });

  it('(d) the strongest tickets: every band and hedge at every line is worth the RTP', () => {
    const mixes: Stakes[] = [
      { red: 1, green: 0, moon: 0 },
      { red: 0, green: 1, moon: 0 },
      { red: 0, green: 0, moon: 1 },
      { red: 1, green: 1, moon: 0 },
      { red: 1, green: 0, moon: 1 },
      { red: 0, green: 1, moon: 1 },
      { red: 3, green: 0.01, moon: 0.5 },
    ];
    for (const ls of ALL_LINES) for (const st of mixes) expect(Math.abs(ticketValue(st, ls) - RTP)).toBeLessThan(1001 / GRID);
    // Monte Carlo through the draw for the extremes: Red at 1.5× (top Red pay), Moon at 1,000× (stratified draws).
    const rng = createRng(seededSource(77));
    for (const [st, ls] of [
      [{ red: 1, green: 0, moon: 0 }, { split: 1.5, moon: 5 }],
      [{ red: 0, green: 0, moon: 1 }, { split: 2, moon: 1000 }],
    ] as [Stakes, Lines][]) {
      const R = 20;
      const per = REPORT ? 500_000 : 10_000;
      const means: number[] = [];
      for (let r = 0; r < R; r++) {
        let s = 0;
        for (let i = 0; i < per; i++) s += multiplierOf(st, crashPoint(Math.floor(((i + rng.next()) / per) * GRID) / GRID), ls);
        means.push(s / per);
      }
      const mean = means.reduce((a, x) => a + x, 0) / R;
      const se = Math.sqrt(means.reduce((a, x) => a + (x - mean) ** 2, 0) / (R - 1) / R);
      if (REPORT) console.log(`(d) ${JSON.stringify(st)} @ ${ls.split}/${ls.moon} | MC ${(mean * 100).toFixed(4)}% ± ${(se * 100).toFixed(4)} (${R * per} rounds, stratified)`);
      // + one boundary slice per replicate (a deterministic payout's only stratification error).
      expect(Math.abs(mean - RTP)).toBeLessThan(4 * se + 1000 / per);
    }
  });
});
