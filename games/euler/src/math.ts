// Euler: random edges join n nodes, repeats allowed (each edge is a uniformly
// random pair of distinct nodes). At the end you win on the number of
// odd-degree nodes, k.
//
// Handshake lemma: the degrees add up to twice the edge count, so k is always
// even. An edge flips the parity of both its ends, so only the parities of
// its two endpoints matter:
//
//   both odd   (C(k, 2) of the C(n, 2) pairs)   → k − 2   ("heals")
//   one odd    (k(n − k) pairs)                 → k       ("shifts")
//   both even  (C(n − k, 2) pairs)              → k + 2   ("adds")
//
// So k is a Markov chain on {0, 2, …, n} and the chance of ending in the win
// zone with r edges left, P(k, r), is a three-term recursion (winTable).
// Closed form (Fourier on the cube {0,1}ⁿ): the parity vector is a random walk
// whose characters have eigenvalues λⱼ = 1 − 2j(n − j)/C(n, 2), so
//
//   P(k odd after T edges) = C(n, k) · 2⁻ⁿ · Σⱼ Kⱼ(k) λⱼᵀ   (Krawtchouk Kⱼ),
//
// which is 1/2ⁿ⁻¹ for "all even" as T → ∞. The tests check the DP against it.
//
// Pricing (fixed prize): a full win pays prize = RTP / P(0, T), and the
// cash-out at any state is prize × P(k, r). P(k, r) is the average of the
// three next states weighted by their pair counts, so the cash-out is a
// martingale starting at RTP and every stopping rule returns exactly RTP.
// The round ends early when the bet is decided: P = 0 (lost) or the losing
// chance is exactly 0 (auto cash-out of the prize).

import type { Rng, Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

export const NODES = [6, 8, 10, 12] as const;
export type Nodes = (typeof NODES)[number];

/** Few edges on purpose: the chain mixes fast (slowest eigenvalue 1 − 4/n), so short rounds keep k's history mattering. */
export const EDGES = [3, 4, 5, 6, 8] as const;
export type Edges = (typeof EDGES)[number];

/** What you back: the odd-node count at the end. */
export type Bet = 'circuit' | 'trail' | 'tangle';
export const BETS: { id: Bet; label: string; rule: string; name: string }[] = [
  { id: 'circuit', label: '0 odd', rule: 'every degree even', name: 'Euler circuit parity' },
  { id: 'trail', label: '≤ 2 odd', rule: 'at most 2 odd nodes', name: 'Euler trail parity' },
  { id: 'tangle', label: '≥ 4 odd', rule: '4 or more odd nodes', name: 'no Euler trail' },
];

export const wins = (bet: Bet, k: number) => (bet === 'circuit' ? k === 0 : bet === 'trail' ? k <= 2 : k >= 4);

export interface Settings {
  nodes: Nodes;
  edges: Edges;
  bet: Bet;
}

export const VOLATILITY: Record<Volatility, Settings> = {
  low: { nodes: 10, edges: 6, bet: 'tangle' },
  medium: { nodes: 6, edges: 5, bet: 'trail' },
  high: { nodes: 10, edges: 6, bet: 'trail' },
  extreme: { nodes: 8, edges: 6, bet: 'circuit' },
};

const pairs = (m: number) => (m < 2 ? 0 : (m * (m - 1)) / 2);

export interface Split {
  /** Pairs of two odd nodes: k → k − 2. */
  heal: number;
  /** Pairs of one odd and one even node: k stays. */
  shift: number;
  /** Pairs of two even nodes: k → k + 2. */
  add: number;
  total: number;
}

/** How the C(n, 2) possible next edges split by their effect on k. */
export function split(n: number, k: number): Split {
  return { heal: pairs(k), shift: k * (n - k), add: pairs(n - k), total: pairs(n) };
}

type Table = number[][];
const cache = new Map<string, { win: Table; lose: Table }>();
const MAX_R = Math.max(...EDGES);

function build(n: number, final: (k: number) => number): Table {
  const t: Table = [];
  t[0] = Array.from({ length: n + 1 }, (_, k) => (k % 2 ? 0 : final(k)));
  for (let r = 1; r <= MAX_R; r++) {
    const row = new Array<number>(n + 1).fill(0);
    for (let k = 0; k <= n; k += 2) {
      const s = split(n, k);
      let v = 0;
      if (s.heal) v += s.heal * t[r - 1][k - 2];
      if (s.shift) v += s.shift * t[r - 1][k];
      if (s.add) v += s.add * t[r - 1][k + 2];
      row[k] = v / s.total;
    }
    t[r] = row;
  }
  return t;
}

function tables(n: number, bet: Bet) {
  const key = `${n}|${bet}`;
  let t = cache.get(key);
  if (!t) {
    t = { win: build(n, (k) => (wins(bet, k) ? 1 : 0)), lose: build(n, (k) => (wins(bet, k) ? 0 : 1)) };
    cache.set(key, t);
  }
  return t;
}

/** Exact chance of ending in the win zone from k odd nodes with r edges left. */
export const winChance = (n: number, bet: Bet, k: number, r: number) => tables(n, bet).win[r][k];

/**
 * Whether the bet is already settled: 'lost' when no path wins, 'won' when no
 * path loses. Both are exact zeros of the DP (it only adds positive terms).
 */
export function decided(n: number, bet: Bet, k: number, r: number): 'won' | 'lost' | null {
  const t = tables(n, bet);
  if (t.win[r][k] === 0) return 'lost';
  if (t.lose[r][k] === 0) return 'won';
  return null;
}

/** The full prize: RTP divided by the chance of winning from the empty graph. */
export const prize = ({ nodes, edges, bet }: Settings) => RTP / winChance(nodes, bet, 0, edges);

/** Fair cash-out: prize × P(win | k odd, r edges left). */
export const cashOut = (s: Settings, k: number, r: number) => prize(s) * winChance(s.nodes, s.bet, k, r);

/** The k after an edge between nodes with these parities. */
export const nextK = (k: number, uOdd: boolean, vOdd: boolean) => (uOdd && vOdd ? k - 2 : !uOdd && !vOdd ? k + 2 : k);

/** A uniformly random pair of distinct nodes. */
export function drawPair(n: number, rng: Rng): [number, number] {
  const u = rng.int(n);
  let v = rng.int(n - 1);
  if (v >= u) v++;
  return u < v ? [u, v] : [v, u];
}

export const oddCount = (degrees: readonly number[]) => degrees.reduce((a, d) => a + (d % 2), 0);

/** Every odd count k that can be reached (0, 2, …, n). */
export const states = (n: number) => Array.from({ length: n / 2 + 1 }, (_, i) => 2 * i);

// ---------- Closed form (for the tests) ----------

function binom(a: number, b: number) {
  if (b < 0 || b > a) return 0;
  let c = 1;
  for (let i = 1; i <= b; i++) c = (c * (a - b + i)) / i;
  return c;
}

/** Krawtchouk polynomial Kⱼ(k) for the n-cube. */
export function krawtchouk(n: number, j: number, k: number) {
  let s = 0;
  for (let i = 0; i <= j; i++) s += (i % 2 ? -1 : 1) * binom(k, i) * binom(n - k, j - i);
  return s;
}

/** P(exactly k odd nodes after T edges), by the Fourier closed form. */
export function oddDistribution(n: number, T: number, k: number) {
  let s = 0;
  for (let j = 0; j <= n; j++) s += krawtchouk(n, j, k) * (1 - (2 * j * (n - j)) / pairs(n)) ** T;
  return (binom(n, k) * s) / 2 ** n;
}

/** A volatility label for the chosen settings, by the win chance. */
export function volatilityOf(s: Settings): Volatility {
  const p = winChance(s.nodes, s.bet, 0, s.edges);
  return p > 0.3 ? 'low' : p > 0.08 ? 'medium' : p > 0.01 ? 'high' : 'extreme';
}

/** The largest prize over every setting: no cash-out can exceed its round's prize. */
export const MAX_MULTIPLIER = Math.max(
  ...NODES.flatMap((nodes) => EDGES.flatMap((edges) => BETS.map(({ id: bet }) => prize({ nodes, edges, bet })))),
);
