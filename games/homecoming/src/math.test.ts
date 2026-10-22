import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  BUDGETS,
  DIMS,
  MAX_MULTIPLIER,
  RTP,
  SIDES,
  applyMove,
  cashAt,
  homeChance,
  isHome,
  l1,
  moveChances,
  movesOf,
  origin,
  prizeFor,
  randomMove,
  startChance,
  verdict,
  walkBurst,
  type Dim,
  type Settings,
} from './math';

const rng = createRng(seededSource(11));

/** Shortest paths from (3, 2) to the origin in 2D: 5 choose 2 orderings of the moves. */
const C5 = 10;

/** Central binomial C(2n, n) / 4^n. */
function central(n: number) {
  let p = 1;
  for (let k = 1; k <= n; k++) p *= (n + k) / (4 * k);
  return p;
}

/** Exact P(S_m = 0) for the walk on Z^d by direct multinomial counting. */
function returnAt(dim: Dim, m: number): number {
  if (m % 2) return 0;
  const n = m / 2;
  if (dim === 1) return central(n);
  if (dim === 2) return central(n) ** 2;
  // 3D: (2n)! / 6^(2n) Σ_{j+k ≤ n} 1 / (j! k! (n−j−k)!)².
  const lf = (x: number) => {
    let s = 0;
    for (let i = 2; i <= x; i++) s += Math.log(i);
    return s;
  };
  let sum = 0;
  for (let j = 0; j <= n; j++) for (let k = 0; j + k <= n; k++) sum += Math.exp(lf(2 * n) - 2 * (lf(j) + lf(k) + lf(n - j - k)) - 2 * n * Math.log(6));
  return sum;
}

/** First-return chances by the renewal equation u_m = Σ f_k u_{m−k}; returns P(return by T). */
function renewal(dim: Dim, T: number) {
  const u = Array.from({ length: T + 1 }, (_, m) => returnAt(dim, m));
  const f = [0];
  for (let m = 1; m <= T; m++) {
    let s = u[m];
    for (let k = 1; k < m; k++) s -= f[k] * u[m - k];
    f.push(s);
  }
  return f.reduce((a, b) => a + b, 0);
}

describe('Homecoming maths', () => {
  it('1D: P(no return in 2n steps) = C(2n, n) / 4^n', () => {
    for (const T of BUDGETS) expect(1 - homeChance(1, [0], T)).toBeCloseTo(central(T / 2), 12);
  });

  it('the DP matches the renewal equation from exact return counts in 1D, 2D and 3D', () => {
    for (const dim of DIMS) for (const T of BUDGETS) expect(homeChance(dim, origin(dim), T)).toBeCloseTo(renewal(dim, T), 10);
  });

  it('Pólya: 1D and 2D creep up towards certainty, 3D stays well below 0.3405', () => {
    expect(homeChance(1, [0], 40)).toBeGreaterThan(homeChance(1, [0], 20));
    expect(homeChance(2, [0, 0], 40)).toBeGreaterThan(homeChance(2, [0, 0], 20));
    expect(homeChance(3, [0, 0, 0], 40)).toBeLessThan(0.3405);
    expect(homeChance(3, [0, 0, 0], 2)).toBeCloseTo(1 / 6, 14);
  });

  it('playing to the end wins exactly as often as the formula says (direct simulation)', () => {
    for (const dim of DIMS) {
      for (const T of BUDGETS) {
        const rounds = 12000;
        let home = 0;
        for (let r = 0; r < rounds; r++) {
          const p = origin(dim);
          for (let s = 0; s < T; s++) {
            p[rng.int(dim)] += rng.next() < 0.5 ? 1 : -1;
            if (isHome(p)) {
              home++;
              break;
            }
          }
        }
        const q = homeChance(dim, origin(dim), T);
        expect(Math.abs(home / rounds - q)).toBeLessThan(4 * Math.sqrt((q * (1 - q)) / rounds));
      }
    }
  });

  it('the cash-out is a martingale: its average over the 2d moves equals its value now', () => {
    for (const dim of DIMS) {
      for (const budget of BUDGETS) {
        for (const side of SIDES) {
          const s: Settings = { dim, budget, side };
          for (let trial = 0; trial < 30; trial++) {
            // A random live state.
            let p = origin(dim);
            let left = budget;
            const k = 1 + rng.int(budget - 1);
            for (let i = 0; i < k && left > 0; i++) {
              const q = applyMove(p, randomMove(dim, rng.next()));
              if (verdict(side, q, left - 1)) break;
              p = q;
              left--;
            }
            const now = left === budget ? RTP : cashAt(s, p, left);
            const next = movesOf(dim).map((m) => cashAt(s, applyMove(p, m), left - 1));
            expect(next.reduce((a, b) => a + b, 0) / next.length).toBeCloseTo(now, 9);
          }
        }
      }
    }
  });

  it('the first step is free and the start is worth RTP', () => {
    for (const dim of DIMS)
      for (const budget of BUDGETS)
        for (const side of SIDES) {
          const s: Settings = { dim, budget, side };
          expect(prizeFor(s) * startChance(s)).toBeCloseTo(RTP, 12);
          expect(cashAt(s, applyMove(origin(dim), { axis: dim - 1, sign: -1 }), budget - 1)).toBeCloseTo(RTP, 12);
        }
  });

  it('the drawn move bars are the true odds, and their average is the chance drawn as "now"', () => {
    for (const dim of DIMS) {
      const s: Settings = { dim, budget: 20, side: 'home' };
      const p = dim === 1 ? [3] : dim === 2 ? [2, -1] : [1, 0, -2];
      const bars = moveChances(s, p, 9);
      const avg = bars.reduce((a, b) => a + b, 0) / bars.length;
      expect(avg).toBeCloseTo(homeChance(dim, p, 9), 12);
      // Each bar is the exact chance after that move: check one by simulation.
      const q = applyMove(p, movesOf(dim)[1]);
      const rounds = 20000;
      let hits = 0;
      for (let r = 0; r < rounds; r++) {
        const w = [...q];
        for (let t = 0; t < 8; t++) {
          if (isHome(w)) break;
          w[rng.int(dim)] += rng.next() < 0.5 ? 1 : -1;
        }
        if (isHome(w)) hits++;
      }
      const b = bars[1];
      expect(Math.abs(hits / rounds - b)).toBeLessThan(4 * Math.sqrt((b * (1 - b)) / rounds) + 1e-9);
    }
  });

  it('out of reach and home settle the round for each side', () => {
    expect(verdict('home', [0, 0], 5)).toBe('won');
    expect(verdict('away', [0, 0], 5)).toBe('lost');
    expect(verdict('home', [3, 3], 5)).toBe('lost');
    expect(verdict('away', [3, 3], 5)).toBe('won');
    expect(verdict('away', [1], 0)).toBe('won');
    expect(homeChance(2, [3, 3], 5)).toBe(0);
    expect(homeChance(2, [3, 2], 5)).toBeCloseTo(C5 / 4 ** 5, 15);
    expect(l1([3, -2, 1])).toBe(6);
  });

  it('a burst stops the moment the round settles', () => {
    const s: Settings = { dim: 1, budget: 40, side: 'home' };
    for (let r = 0; r < 200; r++) {
      const b = walkBurst(s, [1], 20, () => rng.next());
      expect(walkBurst(s, [0], 40, () => rng.next()).path.length).toBe(1);
      const last = b.path[b.path.length - 1];
      if (b.verdict) expect(b.path.slice(0, -1).every((p) => !isHome(p))).toBe(true);
      else expect(b.path.length).toBe(4);
      if (b.verdict === 'won') expect(isHome(last)).toBe(true);
    }
  });

  it('simulated RTP matches the manifest under random stopping', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
    // The largest prize: backing Away in 1D over 40 steps, RTP / (C(40, 20) / 2^40).
    expect(MAX_MULTIPLIER).toBeCloseTo(RTP / central(20), 9);
  });
});
