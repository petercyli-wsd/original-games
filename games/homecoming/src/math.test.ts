import { createRng, runEval, seededSource } from '@originals/game-sdk';
import { describe, expect, it } from 'vitest';
import evalSpec from './eval';
import manifest from './manifest';
import {
  BUDGET,
  DIMS,
  MAX_MULTIPLIER,
  RTP,
  SIDES,
  applyMove,
  cashAt,
  closerCount,
  homeChance,
  isCloser,
  isHome,
  l1,
  movesOf,
  origin,
  prizeFor,
  randomMove,
  reachOn,
  sideChance,
  slotIndex,
  slotsOf,
  startChance,
  verdict,
  walkStep,
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

/** Every live state (sorted absolute coordinates, steps left) the walk can reach in a round. */
function liveStates(dim: Dim): { p: number[]; left: number }[] {
  const out: { p: number[]; left: number }[] = [];
  const seen = new Set<string>();
  let frontier = [origin(dim)];
  for (let taken = 1; taken < BUDGET; taken++) {
    const next: number[][] = [];
    for (const p of frontier)
      for (const m of movesOf(dim)) {
        const q = applyMove(p, m).map(Math.abs).sort((a, b) => b - a);
        const k = `${taken}:${q}`;
        if (seen.has(k) || verdict('home', q, BUDGET - taken)) continue;
        seen.add(k);
        next.push(q);
        out.push({ p: q, left: BUDGET - taken });
      }
    frontier = next;
  }
  return out;
}

describe('Homecoming maths', () => {
  it('1D: P(no return in 2n steps) = C(2n, n) / 4^n', () => {
    for (const T of [10, 20, BUDGET, 40]) expect(1 - homeChance(1, [0], T)).toBeCloseTo(central(T / 2), 12);
  });

  it('the DP matches the renewal equation from exact return counts in 1D, 2D and 3D', () => {
    for (const dim of DIMS) for (const T of [10, 20, BUDGET, 40]) expect(homeChance(dim, origin(dim), T)).toBeCloseTo(renewal(dim, T), 10);
  });

  it('Pólya: 1D and 2D creep up towards certainty, 3D stays well below 0.3405', () => {
    expect(homeChance(1, [0], 40)).toBeGreaterThan(homeChance(1, [0], 20));
    expect(homeChance(2, [0, 0], 40)).toBeGreaterThan(homeChance(2, [0, 0], 20));
    expect(homeChance(3, [0, 0, 0], 40)).toBeLessThan(0.3405);
    expect(homeChance(3, [0, 0, 0], 2)).toBeCloseTo(1 / 6, 14);
  });

  it('dimension is the risk knob: Home falls from 1D to 3D, Away rises', () => {
    const home = DIMS.map((dim) => startChance({ dim, side: 'home' }));
    expect(home[0]).toBeGreaterThan(home[1]);
    expect(home[1]).toBeGreaterThan(home[2]);
    for (const dim of DIMS) expect(startChance({ dim, side: 'away' })).toBeCloseTo(1 - startChance({ dim, side: 'home' }), 14);
  });

  it('playing to the end wins exactly as often as the formula says (direct simulation)', () => {
    for (const dim of DIMS) {
      const rounds = 20000;
      let home = 0;
      for (let r = 0; r < rounds; r++) {
        const p = origin(dim);
        for (let s = 0; s < BUDGET; s++) {
          p[rng.int(dim)] += rng.next() < 0.5 ? 1 : -1;
          if (isHome(p)) {
            home++;
            break;
          }
        }
      }
      const q = homeChance(dim, origin(dim), BUDGET);
      expect(Math.abs(home / rounds - q)).toBeLessThan(4 * Math.sqrt((q * (1 - q)) / rounds));
    }
  });

  it('the cash-out is a martingale: its average over the 2d moves equals its value now', () => {
    for (const dim of DIMS) {
      for (const side of SIDES) {
        const s: Settings = { dim, side };
        for (let trial = 0; trial < 40; trial++) {
          // A random live state (sometimes the start itself).
          let p = origin(dim);
          let left = BUDGET;
          const k = rng.int(BUDGET - 1);
          for (let i = 0; i < k && left > 0; i++) {
            const q = applyMove(p, randomMove(dim, rng.next()));
            if (verdict(side, q, left - 1)) break;
            p = q;
            left--;
          }
          const now = cashAt(s, p, left);
          const next = movesOf(dim).map((m) => cashAt(s, applyMove(p, m), left - 1));
          expect(next.reduce((a, b) => a + b, 0) / next.length).toBeCloseTo(now, 9);
        }
      }
    }
  });

  it('the start is worth RTP, and so is the position after the first step', () => {
    for (const dim of DIMS)
      for (const side of SIDES) {
        const s: Settings = { dim, side };
        expect(prizeFor(s) * startChance(s)).toBeCloseTo(RTP, 12);
        expect(cashAt(s, origin(dim), BUDGET)).toBe(RTP);
        expect(cashAt(s, applyMove(origin(dim), { axis: dim - 1, sign: -1 }), BUDGET - 1)).toBeCloseTo(RTP, 12);
      }
  });

  it('the next-step picture is the true split: closer slots are the moves that cut the distance', () => {
    for (const dim of DIMS) {
      for (const { p, left } of liveStates(dim)) {
        const slots = slotsOf(dim, p);
        expect(slots.length).toBe(2 * dim);
        const closer = movesOf(dim).filter((m) => l1(applyMove(p, m)) < l1(p));
        expect(slots.filter((x) => x.closer).length).toBe(closer.length);
        expect(closerCount(p)).toBe(closer.length);
        for (const m of movesOf(dim)) {
          const slot = slots[slotIndex(dim, p, m)];
          expect(slot.axis).toBe(m.axis);
          expect(slot.closer).toBe(isCloser(p, m));
        }
        // Colouring closer moves "good for Home" is honest: every closer move
        // leaves Home at least as likely as every further move.
        const after = (m: (typeof closer)[number]) => {
          const q = applyMove(p, m);
          return isHome(q) ? 1 : homeChance(dim, q, left - 1);
        };
        const moves = movesOf(dim);
        const minCloser = Math.min(...moves.filter((m) => isCloser(p, m)).map(after));
        const maxFurther = Math.max(...moves.filter((m) => !isCloser(p, m)).map(after));
        if (closer.length) expect(minCloser).toBeGreaterThanOrEqual(maxFurther - 1e-15);
      }
    }
  });

  it('the shaded out-of-reach stretch on each track is exactly where Home is lost', () => {
    for (const dim of DIMS) {
      for (const { p, left } of liveStates(dim)) {
        // Sweep the dot along each track, other axes fixed, with one step taken.
        for (let i = 0; i < dim; i++) {
          for (let v = 0; v <= BUDGET / 2 + 2; v++) {
            const q = [...p];
            q[i] = v;
            if ((l1(q) + left) % 2 !== (l1(p) + left) % 2 || isHome(q)) continue;
            const shaded = v > reachOn(q, i, left);
            expect(shaded).toBe(homeChance(dim, q, left) === 0);
            expect(shaded).toBe(verdict('home', q, left) === 'lost');
          }
        }
      }
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

  it('each press is exactly one step, settled the moment it lands', () => {
    for (const dim of DIMS)
      for (const side of SIDES) {
        const s: Settings = { dim, side };
        for (let r = 0; r < 200; r++) {
          const from = dim === 1 ? [1] : dim === 2 ? [1, 0] : [1, 0, 0];
          const st = walkStep(s, from, 9, rng.next());
          expect(l1(st.to) - l1(from)).toBe(isCloser(from, st.move) ? -1 : 1);
          if (st.verdict === null) expect(st.cash).toBeCloseTo(prizeFor(s) * sideChance(side, dim, st.to, 8), 12);
          else expect(st.cash).toBe(st.verdict === 'won' ? prizeFor(s) : 0);
          if (isHome(st.to)) expect(st.verdict).toBe(side === 'home' ? 'won' : 'lost');
        }
      }
  });

  it('simulated RTP matches the manifest under random stopping', () => {
    for (const r of runEval(evalSpec, { rounds: 50_000 })) {
      expect(Math.abs(r.rtp - manifest.rtp)).toBeLessThan(4 * r.stdError);
      expect(r.max).toBeLessThanOrEqual(manifest.maxMultiplier);
    }
    // The largest prize: backing Away in 1D, RTP / (C(T, T/2) / 2^T).
    expect(MAX_MULTIPLIER).toBeCloseTo(RTP / central(BUDGET / 2), 9);
  });
});
