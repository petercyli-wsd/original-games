import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  MAX_MULTIPLIER,
  PLAYERS,
  RTP,
  STREAKS,
  allSettings,
  branches,
  cashValue,
  expectedDuels,
  fracText,
  newDuel,
  playDuel,
  prizeFor,
  seatChances,
  seatFraction,
  table,
  winChance,
  type Duel,
} from './math';

const rng = createRng(seededSource(13));

/** The raw process, straight from the rules: a queue array and a coin. Returns the seat that takes the pot. */
function simulate(order: number[], streak: number, k: number): number {
  const q = [...order];
  let s = streak;
  for (;;) {
    const [c, x] = q;
    if (rng.next() < 0.5) {
      s++;
      if (s >= k) return c;
      q.splice(1, 1);
      q.push(x);
    } else {
      q.splice(0, 1);
      q.push(c);
      // q[0] is now the old challenger
      s = 1;
    }
  }
}

/** A random live state reached by playing some duels. */
function randomState(n: number, k: number): Duel {
  for (;;) {
    let d = newDuel(n);
    const m = rng.int(8);
    for (let i = 0; i < m && d.winner === null; i++) d = playDuel(d, k, rng.next() < 0.5);
    if (d.winner === null) return d;
  }
}

describe('Waldegrave maths', () => {
  it('Waldegrave 1713: three players, two in a row gives 5/14, 5/14, 2/7', () => {
    expect([0, 1, 2].map((s) => fracText(seatFraction(3, 2, s)))).toEqual(['5/14', '5/14', '2/7']);
  });

  it('every row of the table is a distribution, and the average duel count is 2^k − 1', () => {
    for (const n of PLAYERS)
      for (const k of STREAKS) {
        const t = table(n, k);
        for (const row of t.exact) {
          const num = row.reduce((a, f) => a + Number(f.n) / Number(f.d), 0);
          expect(num).toBeCloseTo(1, 12);
        }
        expect(expectedDuels(n, k)).toBeCloseTo(2 ** k - 1, 12);
      }
  });

  it('the exact seat chances match a simulation of the raw queue', () => {
    const rounds = 12_000;
    for (const n of PLAYERS)
      for (const k of STREAKS) {
        const counts = new Array(n).fill(0);
        for (let r = 0; r < rounds; r++) counts[simulate(newDuel(n).order, 0, k)]++;
        const p = seatChances(newDuel(n), k);
        for (let s = 0; s < n; s++) expect(Math.abs(counts[s] / rounds - p[s])).toBeLessThan(4 * Math.sqrt((p[s] * (1 - p[s])) / rounds) + 1e-3);
      }
  });

  it('the bars drawn mid-round are the true odds from that state', () => {
    const rounds = 6_000;
    for (const n of PLAYERS)
      for (const k of STREAKS) {
        const d = randomState(n, k);
        const counts = new Array(n).fill(0);
        for (let r = 0; r < rounds; r++) counts[simulate(d.order, d.streak, k)]++;
        const p = seatChances(d, k);
        expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
        for (let s = 0; s < n; s++) expect(Math.abs(counts[s] / rounds - p[s])).toBeLessThan(4 * Math.sqrt((p[s] * (1 - p[s])) / rounds) + 1e-3);
      }
  });

  it('the green bars sum to the win chance, back and lay', () => {
    for (const st of allSettings()) {
      const d = randomState(st.players, st.streak);
      const p = seatChances(d, st.streak);
      const green = p.reduce((a, x, s) => a + ((st.side === 'back') === (s === st.seat) ? x : 0), 0);
      expect(green).toBeCloseTo(winChance(d, st.streak, st.seat, st.side), 12);
    }
  });

  it('each duel is a fair bet: E[cash-out after] = cash-out before, and the start is RTP', () => {
    for (const st of allSettings()) {
      expect(cashValue(newDuel(st.players), st)).toBeCloseTo(RTP, 12);
      for (let t = 0; t < 10; t++) {
        const d = randomState(st.players, st.streak);
        const [a, b] = branches(d, st);
        const now = winChance(d, st.streak, st.seat, st.side);
        expect(Math.abs((a + b) / 2 - now)).toBeLessThan(1e-12);
        const after = [true, false].map((w) => {
          const e = playDuel(d, st.streak, w);
          return e.winner === null ? cashValue(e, st) : winChance(e, st.streak, st.seat, st.side) * prizeFor(st);
        });
        expect(Math.abs((after[0] + after[1]) / 2 - cashValue(d, st))).toBeLessThan(1e-9);
      }
    }
  });

  it('the max multiplier bounds every prize', () => {
    for (const st of allSettings()) expect(prizeFor(st)).toBeLessThanOrEqual(MAX_MULTIPLIER);
    expect(manifest.maxMultiplier).toBe(MAX_MULTIPLIER);
  });

  it('simulated RTP matches the manifest under sampled strategies', () => {
    const reports = runEval(evalSpec, { rounds: 50_000 });
    for (const r of reports) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
