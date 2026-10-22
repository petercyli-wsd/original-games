// Pearson Walk: a walker leaves the centre of a home disc and takes n unit
// steps, each in a uniformly random direction (Pearson's random walk, 1905).
// It wins if it ends inside home, a disc of radius ρ step lengths.
//
// The theorem. Kluyver (1906) wrote the chance that the walk ends within ρ
// of its start as a Bessel integral,
//
//     P(|S_n| ≤ ρ) = ρ ∫₀^∞ J₁(ρt) J₀(t)ⁿ dt.
//
// When home is exactly one step wide (ρ = 1) the integrand is
// −(d/dt) J₀(t)ⁿ⁺¹ / (n+1), so the chance is exactly 1/(n+1), for every n ≥ 2.
// Smaller or larger homes are the volatility knob.
//
// Live odds. The walk is isotropic, so with k steps left the chance of ending
// home depends only on the distance r from the centre:
//
//     P_0(r) = [r ≤ ρ]
//     P_1(r) = arccos((r² + 1 − ρ²) / 2r) / π           (exact: the share of
//              directions whose step lands inside home, drawn as a green arc)
//     P_k(r) = (1/π) ∫₀^π P_{k−1}(√(r² + 1 + 2r cos φ)) dφ.
//
// The level sets of P_k are circles around home: the iso-odds rings on the
// board. P_k is exactly 0 once home is out of reach (r ≥ k + ρ; for the last
// step, |r − 1| ≥ ρ) and exactly 1 when every reachable point is home
// (r + k ≤ ρ). Both end the round at once.
//
// Fairness. The full prize is RTP / P_n(0) and the cash-out in any state is
// prize × P_k(r). The recursion above *is* the one-step expectation, so the
// cash-out is a martingale that starts at RTP; by optional stopping every
// cash-out strategy returns exactly RTP. The first step is free: it always
// lands on the unit circle, where P_{n−1}(1) = P_n(0).
//
// Numerics. P_1 is closed form. For k ≥ 2, P_k is tabulated on pieces between
// its singular radii |m ± ρ| (where the circle of radius ρ around the walker
// is tangent to a circle on which the density of S_k is singular), on a grid
// clustered at each piece's ends, and read back by 8-point barycentric
// interpolation. Each node is a tanh-sinh quadrature of P_{k−1}, split where
// the step circle crosses P_{k−1}'s singular radii. No Monte Carlo anywhere.
// math.test.ts checks the tables against closed forms (Kluyver's 1/(k+1), the
// exact one-step formula, ∫P_k dA = πρ², ∫|x|²P_k dA = πρ²(ρ²/2 + k), and the
// identity (k+1)·P_k(r; ρ=1) = 1 − P_k(1; ρ=r)) to about 1e-9.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

/** Number of unit steps in a walk. */
export const STEPS = [2, 3, 4, 6, 9, 12] as const;
export type Steps = (typeof STEPS)[number];

/** Home radius, in step lengths. 1 is Kluyver's case: chance exactly 1/(n+1). */
export const HOMES = [0.5, 0.75, 1, 1.5] as const;
export type Home = (typeof HOMES)[number];

export const HOME_LABEL: Record<Home, string> = { 0.5: '½', 0.75: '¾', 1: '1', 1.5: '1½' };

export const VOLATILITY: Record<Volatility, { steps: Steps; home: Home }> = {
  low: { steps: 3, home: 1.5 },
  medium: { steps: 4, home: 1 },
  high: { steps: 6, home: 0.75 },
  extreme: { steps: 12, home: 0.5 },
};

// P(|S_n| ≤ ρ) for ρ ≠ 1 and n ≥ 3, indexed like STEPS (n = 2 uses the closed
// form (2/π)·asin(ρ/2)). Computed with this file's method on a 4× finer grid;
// math.test.ts re-derives every value from the live tables.
const KLUYVER_TABLE: Record<Exclude<Home, 1>, readonly number[]> = {
  0.5: [0.1608612465103, 0.04806277567016, 0.06251435745068, 0.03884584821535, 0.02587862210562, 0.01979174296981],
  0.75: [0.2447145870782, 0.1160041012928, 0.1240071671876, 0.08386112007479, 0.05740657218352, 0.04399856027470],
  1.5: [0.5398930876748, 0.5116794934010, 0.3878744730545, 0.2932398377081, 0.2118154638967, 0.1651105502568],
};

/** Chance that an n-step walk ends inside a home of radius ρ. */
export function winChance(n: Steps, home: Home): number {
  if (home === 1) return 1 / (n + 1);
  if (n === 2) return (2 / Math.PI) * Math.asin(home / 2);
  return KLUYVER_TABLE[home][STEPS.indexOf(n)];
}

/** The full prize: what a walk that ends home pays, per unit staked. */
export const prizeFor = (n: Steps, home: Home) => RTP / winChance(n, home);

/** Every payout is at most the prize, so the smallest win chance bounds them all. */
export const MAX_MULTIPLIER = Math.max(...HOMES.flatMap((h) => STEPS.map((n) => prizeFor(n, h))));

export function volatilityOf(n: Steps, home: Home): Volatility {
  const p = winChance(n, home);
  return p >= 0.3 ? 'low' : p >= 0.1 ? 'medium' : p >= 0.04 ? 'high' : 'extreme';
}

// ---------------------------------------------------------------------------
// Quadrature: tanh-sinh on [a, b]. Nodes crowd both ends double-exponentially,
// so integrands with square-root or logarithmic end singularities converge.

interface Rule {
  /** Node distance from the left end, as a fraction of the interval. */
  u: Float64Array;
  /** The same node's distance from the right end (kept separately for precision). */
  v: Float64Array;
  w: Float64Array;
}

function tanhSinh(h: number): Rule {
  const n = Math.ceil(3.2 / h);
  const u = new Float64Array(2 * n + 1);
  const v = new Float64Array(2 * n + 1);
  const w = new Float64Array(2 * n + 1);
  let total = 0;
  for (let i = -n; i <= n; i++) {
    const t = i * h;
    const s = (Math.PI / 2) * Math.sinh(t);
    const e = 1 / (Math.exp(2 * Math.abs(s)) + 1);
    u[i + n] = i < 0 ? e : 1 - e;
    v[i + n] = i < 0 ? 1 - e : e;
    w[i + n] = Math.cosh(t) / Math.cosh(s) ** 2;
    total += w[i + n];
  }
  for (let i = 0; i < w.length; i++) w[i] /= total;
  return { u, v, w };
}

const FINE = tanhSinh(1 / 6);
const STANDARD = tanhSinh(1 / 5);

export function integrate(f: (x: number) => number, a: number, b: number, rule: Rule = STANDARD): number {
  const L = b - a;
  if (!(L > 0)) return 0;
  const { u, v, w } = rule;
  let sum = 0;
  for (let i = 0; i < w.length; i++) sum += w[i] * f(u[i] <= 0.5 ? a + L * u[i] : b - L * v[i]);
  return sum * L;
}

// ---------------------------------------------------------------------------
// The live odds P_k(r).

/** Exact chance that one unit step from distance r lands within ρ of the centre. */
export function oneStepChance(r: number, rho: number): number {
  if (r + 1 <= rho) return 1;
  if (r <= 0) return 0;
  const c = (r * r + 1 - rho * rho) / (2 * r);
  if (c >= 1) return 0;
  if (c <= -1) return 1;
  return Math.acos(c) / Math.PI;
}

/** Radii where P_k(·; ρ) is not smooth: |m ± ρ| for m = 0..k, plus 0 and the reach k + ρ. */
export function singularRadii(k: number, rho: number): number[] {
  const reach = k + rho;
  const raw = [0, reach];
  for (let m = 0; m <= k; m++) raw.push(Math.abs(m - rho), m + rho);
  const sorted = raw.filter((b) => b >= 0 && b <= reach).sort((a, b) => a - b);
  const out: number[] = [];
  for (const b of sorted) if (out.length === 0 || b - out[out.length - 1] > 1e-9) out.push(b);
  return out;
}

const ORDER = 8;
const BARY = (() => {
  const w: number[] = [];
  let c = 1;
  for (let j = 0; j < ORDER; j++) {
    w.push(j % 2 ? -c : c);
    c = (c * (ORDER - 1 - j)) / (j + 1);
  }
  return w;
})();

/** Grid warp: clusters nodes quartically at both ends of each piece. */
const warp = (t: number) => {
  const a = t * t * t * t;
  const b = (1 - t) ** 4;
  return a / (a + b);
};
const unwarp = (y: number) => {
  if (y <= 0) return 0;
  if (y >= 1) return 1;
  const q = Math.sqrt(Math.sqrt(y / (1 - y)));
  return q / (1 + q);
};

interface Level {
  k: number;
  reach: number;
  breaks: number[];
  grid: number;
  vals: Float64Array;
}

function readLevel(L: Level, r: number): number {
  if (r >= L.reach) return 0;
  if (r <= 0) return L.vals[0];
  const br = L.breaks;
  let lo = 0;
  let hi = br.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (br[mid] <= r) lo = mid;
    else hi = mid;
  }
  const a = br[lo];
  const G = L.grid;
  const x = unwarp((r - a) / (br[lo + 1] - a)) * G;
  let i0 = Math.floor(x) - (ORDER / 2 - 1);
  if (i0 < 0) i0 = 0;
  if (i0 > G + 1 - ORDER) i0 = G + 1 - ORDER;
  const base = lo * (G + 1) + i0;
  let num = 0;
  let den = 0;
  for (let j = 0; j < ORDER; j++) {
    const d = x - (i0 + j);
    if (d === 0) return L.vals[base + j];
    const wj = BARY[j] / d;
    num += wj * L.vals[base + j];
    den += wj;
  }
  return num / den;
}

/** One table node: P_k(r) = average of P_{k−1} over the unit circle around a point at distance r. */
function averageOverStep(prev: (d: number) => number, prevBreaks: readonly number[], r: number, rule: Rule): number {
  if (r < 1e-12) return prev(1);
  const lo = Math.abs(r - 1);
  const hi = r + 1;
  const cuts = [0, Math.PI];
  for (const b of prevBreaks) {
    if (b > lo + 1e-12 && b < hi - 1e-12) cuts.push(Math.acos(Math.min(1, Math.max(-1, (b * b - r * r - 1) / (2 * r)))));
  }
  cuts.sort((a, b) => a - b);
  const r1 = (r - 1) * (r - 1);
  // d² = (r − 1)² + 4r·cos²(φ/2): a sum of non-negative terms, so no cancellation near d = 0.
  const g = (phi: number) => {
    const c = Math.cos(phi / 2);
    return prev(Math.sqrt(r1 + 4 * r * c * c));
  };
  let sum = 0;
  for (let i = 0; i + 1 < cuts.length; i++) sum += integrate(g, cuts[i], cuts[i + 1], rule);
  return sum / Math.PI;
}

const levels = new Map<number, Level[]>();

function buildLevel(k: number, rho: number, below: Level[]): Level {
  const prevBreaks = k === 2 ? singularRadii(1, rho) : below[k - 1].breaks;
  const prevLevel = below[k - 1];
  const prev = k === 2 ? (d: number) => oneStepChance(d, rho) : (d: number) => readLevel(prevLevel, d);
  const breaks = singularRadii(k, rho);
  const grid = k <= 3 ? 128 : 64;
  const rule = k === 2 ? FINE : STANDARD;
  const vals = new Float64Array((breaks.length - 1) * (grid + 1));
  for (let i = 0; i + 1 < breaks.length; i++) {
    const a = breaks[i];
    const b = breaks[i + 1];
    for (let j = 0; j <= grid; j++) {
      const r = j === grid ? b : a + (b - a) * warp(j / grid);
      vals[i * (grid + 1) + j] = averageOverStep(prev, prevBreaks, r, rule);
    }
  }
  return { k, reach: k + rho, breaks, grid, vals };
}

function tablesFor(rho: number): Level[] {
  let t = levels.get(rho);
  if (!t) levels.set(rho, (t = []));
  return t;
}

/**
 * Builds the tables for home ρ up to k steps (cached). Builds at least one
 * missing level per call, then stops once the time budget is spent; returns
 * whether everything up to k is ready.
 */
export function prepare(rho: number, k: number, budgetMs = Infinity): boolean {
  const t = tablesFor(rho);
  const t0 = performance.now();
  for (let j = 2; j <= k; j++) {
    if (t[j]) continue;
    t[j] = buildLevel(j, rho, t);
    if (j < k && performance.now() - t0 > budgetMs) return false;
  }
  return true;
}

/** Whether the tables for home ρ up to k steps exist already. */
export const isPrepared = (rho: number, k: number) => k < 2 || !!levels.get(rho)?.[k];

/**
 * Chance of ending home from distance r with k steps left: P_k(r).
 * Exactly 0 when home is out of reach and exactly 1 when every reachable point is home.
 */
export function homeChance(k: number, r: number, rho: number): number {
  if (k <= 0) return r <= rho ? 1 : 0;
  if (r + k <= rho) return 1;
  if (k === 1) return oneStepChance(r, rho);
  if (r >= k + rho) return 0;
  prepare(rho, k);
  const p = readLevel(levels.get(rho)![k], r);
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

export type Verdict = 'home' | 'lost';

/**
 * Whether the round is already decided at distance r with k steps left:
 * 'home' if every reachable point is inside, 'lost' if none is.
 */
export function verdict(k: number, r: number, rho: number): Verdict | null {
  if (k <= 0) return r <= rho ? 'home' : 'lost';
  if (r + k <= rho) return 'home';
  if (k === 1 ? Math.abs(r - 1) >= rho : r >= k + rho) return 'lost';
  return null;
}

// ---------------------------------------------------------------------------
// Pictures of the odds.

export interface Pt {
  x: number;
  y: number;
}

export const dist = (p: Pt) => Math.hypot(p.x, p.y);

/** Where a unit step at angle a (radians) from p lands. */
export const stepFrom = (p: Pt, a: number): Pt => ({ x: p.x + Math.cos(a), y: p.y + Math.sin(a) });

// The drawing helpers sample from just off the centre: exactly at r = 0 with one
// step left every direction lands on the unit circle, a measure-zero tie that
// only matters for a 1-step walk (not offered).
const NEAR_CENTRE = 1e-9;

/** P_k sampled on [0, rMax], for the shaded odds field. */
export function profile(k: number, rho: number, rMax: number, samples = 64): { r: number; p: number }[] {
  const out: { r: number; p: number }[] = [];
  for (let i = 0; i <= samples; i++) {
    const r = Math.max(NEAR_CENTRE, (rMax * i) / samples);
    out.push({ r, p: homeChance(k, r, rho) });
  }
  return out;
}

/** Round levels for the labelled iso-odds rings. */
export const NICE_LEVELS = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.25, 0.2, 0.15, 0.1, 0.08, 0.06, 0.05, 0.04, 0.03, 0.02, 0.015, 0.01, 0.005, 0.002, 0.001];

export interface Contour {
  level: number;
  radius: number;
}

/** Radii in [lo, hi] where P_k(r) = level (P_k need not be monotone, so there can be several). */
export function levelRadii(k: number, rho: number, level: number, lo: number, hi: number, samples = 240): number[] {
  const f = (r: number) => homeChance(k, r, rho) - level;
  const out: number[] = [];
  let a = lo;
  let fa = f(a);
  for (let i = 1; i <= samples; i++) {
    const b = lo + ((hi - lo) * i) / samples;
    const fb = f(b);
    if ((fa > 0) !== (fb > 0)) {
      let x0 = a;
      let x1 = b;
      let f0 = fa;
      for (let it = 0; it < 50; it++) {
        const m = (x0 + x1) / 2;
        const fm = f(m);
        if ((fm > 0) === (f0 > 0)) {
          x0 = m;
          f0 = fm;
        } else x1 = m;
      }
      out.push((x0 + x1) / 2);
    }
    a = b;
    fa = fb;
  }
  return out;
}

/**
 * Up to `max` labelled rings for the k-steps-left field: round levels spread
 * between the best odds on the board and a few percent of them.
 */
export function contours(k: number, rho: number, rMax: number, max = 4): Contour[] {
  if (k <= 0) return [];
  const prof = profile(k, rho, rMax, 96);
  const peak = Math.max(...prof.map((s) => s.p));
  if (!(peak > 0)) return [];
  const picked: number[] = [];
  for (const f of [0.8, 0.5, 0.25, 0.1, 0.04]) {
    const level = NICE_LEVELS.find((l) => l <= peak * f);
    if (level !== undefined && !picked.includes(level)) picked.push(level);
  }
  const out: Contour[] = [];
  for (const level of picked.slice(0, max)) for (const radius of levelRadii(k, rho, level, NEAR_CENTRE, rMax)) out.push({ level, radius });
  return out.sort((a, b) => a.radius - b.radius);
}

export interface StepArc {
  /** Absolute angles in radians (SVG convention: 0 = +x, increasing clockwise on screen). */
  from: number;
  to: number;
  /** Landing here raises the odds (for the last step: lands home). */
  up: boolean;
}

/**
 * Splits the circle of possible next landings around p into arcs where the
 * odds would rise and arcs where they would fall. With one step left the
 * rising arc is exactly the directions that land home, so its share of the
 * circle is the win chance. Returns null when every direction is equal (at
 * the centre).
 */
export function stepArcs(k: number, p: Pt, rho: number): StepArc[] | null {
  const r = dist(p);
  if (k <= 0 || r < 1e-9) return null;
  const now = homeChance(k, r, rho);
  const base = Math.atan2(p.y, p.x);
  // θ is measured from the outward direction; landing distance d(θ) = √(r² + 1 + 2r cos θ).
  let ups: [number, number][];
  if (k === 1) {
    const c = (rho * rho - r * r - 1) / (2 * r);
    ups = c <= -1 ? [] : c >= 1 ? [[0, Math.PI]] : [[Math.acos(c), Math.PI]];
  } else {
    const g = (t: number) => homeChance(k - 1, Math.sqrt(Math.max(0, r * r + 1 + 2 * r * Math.cos(t))), rho) - now;
    const N = 180;
    ups = [];
    let start: number | null = g(0) > 0 ? 0 : null;
    let ta = 0;
    let ga = g(0);
    for (let i = 1; i <= N; i++) {
      const tb = (Math.PI * i) / N;
      const gb = g(tb);
      if ((ga > 0) !== (gb > 0)) {
        let x0 = ta;
        let x1 = tb;
        for (let it = 0; it < 40; it++) {
          const m = (x0 + x1) / 2;
          if ((g(m) > 0) === (ga > 0)) x0 = m;
          else x1 = m;
        }
        const cross = (x0 + x1) / 2;
        if (gb > 0) start = cross;
        else if (start !== null) {
          ups.push([start, cross]);
          start = null;
        }
      }
      ta = tb;
      ga = gb;
    }
    if (start !== null) ups.push([start, Math.PI]);
  }
  // Mirror [0, π] to the full circle and fill the gaps with falling arcs.
  const marks: { from: number; to: number; up: boolean }[] = [];
  const upsFull: [number, number][] = [];
  for (const [a, b] of ups) {
    upsFull.push([a, b]);
    upsFull.push([2 * Math.PI - b, 2 * Math.PI - a]);
  }
  upsFull.sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const iv of upsFull) {
    const last = merged[merged.length - 1];
    if (last && iv[0] <= last[1] + 1e-12) last[1] = Math.max(last[1], iv[1]);
    else merged.push([iv[0], iv[1]]);
  }
  let at = 0;
  for (const [a, b] of merged) {
    if (a > at) marks.push({ from: at, to: a, up: false });
    marks.push({ from: a, to: b, up: true });
    at = b;
  }
  if (at < 2 * Math.PI) marks.push({ from: at, to: 2 * Math.PI, up: false });
  return marks.filter((m) => m.to - m.from > 1e-9).map((m) => ({ from: base + m.from, to: base + m.to, up: m.up }));
}

/** Share of the step circle where the odds rise (for the last step: the win chance). */
export const upShare = (arcs: StepArc[]) => arcs.reduce((s, a) => s + (a.up ? a.to - a.from : 0), 0) / (2 * Math.PI);
