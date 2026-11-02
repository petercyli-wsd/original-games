import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  HOPS,
  MAX_MULTIPLIER,
  MOVES,
  RTP,
  START,
  TOTAL_DEGREE,
  VOLATILITY,
  allTargets,
  cashAt,
  chance,
  degree,
  drawHops,
  endDistribution,
  inTarget,
  isLight,
  prizeFor,
  reachable,
  startChance,
  verdict,
  volatilityOf,
  type Target,
} from './math';

const rng = createRng(seededSource(11));
const SOME: Target[] = allTargets().filter((t) => t.region !== 'square' || [0, 18, 29, 44, 56, 63].includes(t.square));

describe('Knight maths', () => {
  it('the knight graph: degrees 2…8, Σ deg = 336, every move changes colour', () => {
    expect(TOTAL_DEGREE).toBe(336);
    expect(degree(0)).toBe(2);
    expect(degree(27)).toBe(8);
    for (let s = 0; s < 64; s++)
      for (const y of MOVES[s]) {
        expect(MOVES[y]).toContain(s);
        expect(isLight(y)).toBe(!isLight(s));
      }
  });

  it('after 5 hops from g1 the knight can finish on exactly the 32 light squares', () => {
    expect(isLight(START)).toBe(false);
    for (let s = 0; s < 64; s++) expect(reachable(s)).toBe(isLight(s));
    expect(allTargets().filter((t) => t.region === 'square')).toHaveLength(32);
  });

  it('exact chances match a direct simulation of the random knight (4 SE)', () => {
    for (const t of SOME) {
      const p = startChance(t);
      const n = 8000;
      let hits = 0;
      for (let i = 0; i < n; i++) {
        let s = START;
        for (let k = 0; k < HOPS; k++) s = MOVES[s][rng.int(MOVES[s].length)];
        if (inTarget(s, t)) hits++;
      }
      expect(Math.abs(hits / n - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / n) + 1e-3);
    }
  });

  it('martingale: E[cash-out after the next hop] = cash-out now, at every state', () => {
    for (const t of allTargets()) {
      const prize = prizeFor(t);
      for (let left = 1; left <= HOPS; left++) {
        for (let s = 0; s < 64; s++) {
          const after = MOVES[s].reduce((a, y) => a + cashAt(prize, y, left - 1, t), 0) / MOVES[s].length;
          expect(Math.abs(after - cashAt(prize, s, left, t))).toBeLessThan(1e-9 * prize);
        }
      }
      expect(cashAt(prize, START, HOPS, t)).toBeCloseTo(RTP, 12);
    }
  });

  it('"Run to the end" pays the cash-out now in expectation (exact enumeration of every hop sequence)', () => {
    // Enumerate drawHops over every sequence of picks, weighting each by its probability.
    const expectRun = (s: number, left: number, t: Target, prize: number): number => {
      let total = 0;
      const walk = (picks: number[], w: number) => {
        let i = 0;
        let pending = false;
        let width = 0;
        const path = drawHops(s, left, t, true, (n) => {
          if (i < picks.length) return picks[i++];
          if (!pending) width = n;
          pending = true;
          return 0;
        });
        if (pending) {
          for (let k = 0; k < width; k++) walk([...picks, k], w / width);
          return;
        }
        const end = path[path.length - 1];
        const rest = left - path.length;
        const v = verdict(end, rest, t);
        expect(v).not.toBeNull();
        total += w * (v === 'win' ? prize : 0);
      };
      walk([], 1);
      return total;
    };
    for (const t of SOME) {
      const prize = prizeFor(t);
      expect(expectRun(START, HOPS, t, prize)).toBeCloseTo(RTP, 10);
      for (const s of [12, 21, 33]) expect(expectRun(s, 2, t, prize)).toBeCloseTo(cashAt(prize, s, 2, t), 10);
    }
  });

  it('the drawn odds are the true risk: green dot mass and the average of the next-hop labels both equal the chance', () => {
    for (const t of SOME) {
      for (let left = 0; left <= HOPS; left++) {
        for (let s = 0; s < 64; s++) {
          const d = endDistribution(s, left);
          const total = d.reduce((a, x) => a + x, 0);
          expect(total).toBeCloseTo(1, 12);
          const green = d.reduce((a, x, y) => a + (inTarget(y, t) ? x : 0), 0);
          expect(green).toBeCloseTo(chance(s, left, t), 12);
          if (left > 0) {
            const avg = MOVES[s].reduce((a, y) => a + chance(y, left - 1, t), 0) / MOVES[s].length;
            expect(avg).toBeCloseTo(chance(s, left, t), 12);
          }
        }
      }
    }
  });

  it('only green-filled squares (target ∩ light) can carry end mass, so "ends on a green square" is the win rule', () => {
    // Every square the knight can still finish on, from any state a round can reach, is light;
    // so a target square's dark half never carries any of the win chance.
    for (let taken = 0; taken <= HOPS; taken++) {
      const at = endDistribution(START, taken);
      for (let s = 0; s < 64; s++) {
        if (at[s] === 0) continue;
        const d = endDistribution(s, HOPS - taken);
        for (let y = 0; y < 64; y++) if (d[y] > 0) expect(isLight(y)).toBe(true);
      }
    }
    for (const t of SOME) {
      const green = endDistribution(START, HOPS).reduce((a, x, y) => a + (inTarget(y, t) && isLight(y) ? x : 0), 0);
      expect(green).toBeCloseTo(startChance(t), 12);
    }
  });

  it('the target alone moves the chance over 25:1, and the max multiplier bounds every prize', () => {
    const ps = allTargets().map((t) => startChance(t));
    expect(Math.max(...ps) / Math.min(...ps)).toBeGreaterThan(25);
    for (const t of allTargets()) expect(prizeFor(t)).toBeLessThanOrEqual(MAX_MULTIPLIER);
    expect(manifest.maxMultiplier).toBe(MAX_MULTIPLIER);
    for (const [level, c] of Object.entries(VOLATILITY)) expect(volatilityOf(startChance(c.target))).toBe(level);
  });

  it('simulated RTP matches the manifest under sampled stopping rules', () => {
    const rs = runEval(evalSpec, { rounds: 50_000 });
    for (const r of rs) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
  });
});
