// Euclid: a hidden pair 1 ≤ b < a ≤ N is drawn uniformly from the N(N−1)/2
// pairs. Euclid's algorithm on it is the classic picture of squares cut from
// an a × b rectangle: cut as many b × b squares as fit (the partial quotient
// q₁ = ⌊a/b⌋), leaving an r₁ × b remainder, then cut r₁ × r₁ squares from that
// (q₂ = ⌊b/r₁⌋), and so on until a remainder of 0. The quotients are the
// continued fraction a/b = [q₁; q₂, …, qₙ], n is the number of cuts, and the
// last square has side g = gcd(a, b).
//
// A round reveals the algorithm one cut at a time. Each reveal shows the next
// quotient and whether the remainder is now empty. Once the algorithm has
// finished, the shape a/b = P/Q (lowest terms) is known but not the scale:
// the pair is (gP, gQ) for one of g = 1 … ⌊N/P⌋, all equally likely, and the
// last reveal is the scale g, the side of the final square.
//
// Bets: Coprime (g = 1), Square ≥ 2 (g ≥ 2), or ≥ k cuts (n ≥ k). Coprime
// pairs number Σ_{a ≤ N} φ(a) − 1 ≈ (6/π²)·N²/2, so Coprime wins ≈ 61% of the
// time. Lamé's theorem bounds n by the Fibonacci pair that fits under N, and
// the mean of n grows like (12 ln 2/π²)·ln N, so long runs are rare.
//
// Pricing (pattern 1, fixed prize). The revealed clues S pick out a set of
// candidate pairs: those whose Euclid run begins with the revealed quotients
// (and has ended exactly there, or not, as revealed, with the revealed scale).
// The hidden pair is uniform on that set, so with W(S) winning candidates out
// of C(S),
//
//   P(win | S) = W(S) / C(S),   cash-out(S) = prize × W(S)/C(S),
//   prize = RTP × C(start) / W(start).
//
// The next reveal splits the candidates into the groups that share the next
// clue, each with chance (group size)/C(S), so E[W/C after] = Σ W_child/C(S)
// = W(S)/C(S): the cash-out is a martingale that starts at RTP and every
// cash-out rule returns exactly RTP. Everything is integer counting, so there
// are no floating-point boundaries. No payout exceeds the prize, and a bet is
// only offered when its chance is at least MIN_CHANCE, so maxMultiplier is the
// largest prize over the offered settings.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

/** Range N: the pair satisfies 1 ≤ b < a ≤ N. */
export const SIZES = [30, 60, 100, 200] as const;
export type Size = (typeof SIZES)[number];

/** Cut targets for the "≥ k cuts" bet. */
export const CUTS = [3, 4, 5, 6, 7, 8] as const;
export type Cuts = (typeof CUTS)[number];

export type BetKind = 'coprime' | 'square' | 'cuts';
export interface Bet {
  kind: BetKind;
  /** Only used by the "cuts" bet. */
  cuts: Cuts;
}

/** Bets rarer than this are not offered (they would only be a lottery ticket). */
export const MIN_CHANCE = 0.002;

export const VOLATILITY: Record<Volatility, { size: Size; bet: Bet }> = {
  low: { size: 100, bet: { kind: 'coprime', cuts: 5 } },
  medium: { size: 60, bet: { kind: 'square', cuts: 5 } },
  high: { size: 200, bet: { kind: 'cuts', cuts: 6 } },
  extreme: { size: 200, bet: { kind: 'cuts', cuts: 8 } },
};

export interface Pair {
  a: number;
  b: number;
  /** Partial quotients: a/b = [q₁; q₂, …, qₙ]. */
  q: number[];
  /** gcd(a, b): the side of the final square. */
  g: number;
}

/** Euclid's algorithm: the partial quotients of a/b and the gcd. */
export function euclid(a: number, b: number): { q: number[]; g: number } {
  const q: number[] = [];
  while (b > 0) {
    q.push(Math.floor(a / b));
    [a, b] = [b, a % b];
  }
  return { q, g: a };
}

/** What has been revealed so far. */
export interface Clues {
  quotients: number[];
  /** Whether the last revealed cut left no remainder (the algorithm has finished). */
  done: boolean;
  /** The side of the final square, once revealed (only after done). */
  scale: number | null;
}

export const NO_CLUES: Clues = { quotients: [], done: false, scale: null };

/** A node of the clue tree: every candidate pair for one set of clues. */
export interface Node {
  pairs: Pair[];
  coprime: number;
  /** byLength[n] = candidates whose run has exactly n cuts. */
  byLength: number[];
  children: Map<string, Node>;
}

const newNode = (): Node => ({ pairs: [], coprime: 0, byLength: [], children: new Map() });

/** The key of the clue revealed at depth j (0-based) for a pair. */
function keyAt(p: Pair, j: number): string {
  if (j < p.q.length) return `${p.q[j]}${j === p.q.length - 1 ? '.' : ''}`;
  return `g${p.g}`;
}

const trees = new Map<Size, Node>();

/** The clue tree for range N, built once (19 900 pairs at N = 200, a few ms). */
export function tree(size: Size): Node {
  let root = trees.get(size);
  if (root) return root;
  root = newNode();
  for (let a = 2; a <= size; a++) {
    for (let b = 1; b < a; b++) {
      const p: Pair = { a, b, ...euclid(a, b) };
      let node = root;
      for (let j = 0; ; j++) {
        node.pairs.push(p);
        if (p.g === 1) node.coprime++;
        node.byLength[p.q.length] = (node.byLength[p.q.length] ?? 0) + 1;
        if (j > p.q.length) break;
        const key = keyAt(p, j);
        let child = node.children.get(key);
        if (!child) node.children.set(key, (child = newNode()));
        node = child;
      }
    }
  }
  trees.set(size, root);
  return root;
}

function cluesKeys(c: Clues): string[] {
  const keys = c.quotients.map((q, j) => `${q}${c.done && j === c.quotients.length - 1 ? '.' : ''}`);
  if (c.scale !== null) keys.push(`g${c.scale}`);
  return keys;
}

/** The candidate set for some clues (undefined if no pair fits them). */
export function nodeAt(size: Size, clues: Clues): Node | undefined {
  let node: Node | undefined = tree(size);
  for (const k of cluesKeys(clues)) node = node?.children.get(k);
  return node;
}

/** Whether a pair wins the bet. */
export function wins(p: Pair, bet: Bet): boolean {
  if (bet.kind === 'coprime') return p.g === 1;
  if (bet.kind === 'square') return p.g >= 2;
  return p.q.length >= bet.cuts;
}

/** Winning candidates at a node, by counting. */
export function winCount(node: Node, bet: Bet): number {
  if (bet.kind === 'coprime') return node.coprime;
  if (bet.kind === 'square') return node.pairs.length - node.coprime;
  let w = 0;
  for (let n = bet.cuts; n < node.byLength.length; n++) w += node.byLength[n] ?? 0;
  return w;
}

export interface Odds {
  wins: number;
  total: number;
  p: number;
}

export function odds(size: Size, bet: Bet, clues: Clues = NO_CLUES): Odds {
  const node = nodeAt(size, clues);
  if (!node) return { wins: 0, total: 0, p: 0 };
  const w = winCount(node, bet);
  return { wins: w, total: node.pairs.length, p: w / node.pairs.length };
}

/** Chance to win at the bet. */
export const winChance = (size: Size, bet: Bet) => odds(size, bet).p;

/** Whether a bet is offered at this range. */
export const offered = (size: Size, bet: Bet) => winChance(size, bet) >= MIN_CHANCE;

/** What a full win pays. */
export function prize(size: Size, bet: Bet): number {
  const o = odds(size, bet);
  return (RTP * o.total) / o.wins;
}

/** The fair cash-out with these clues revealed: prize × P(win | clues). */
export const cashOut = (size: Size, bet: Bet, clues: Clues) => prize(size, bet) * odds(size, bet, clues).p;

/** The clues after one more reveal for this hidden pair (null when nothing is left). */
export function reveal(p: Pair, c: Clues): Clues | null {
  const j = c.quotients.length;
  if (!c.done) return { quotients: p.q.slice(0, j + 1), done: j + 1 === p.q.length, scale: null };
  if (c.scale === null) return { ...c, scale: p.g };
  return null;
}

/** The pair's full clues (everything revealed). */
export const allClues = (p: Pair): Clues => ({ quotients: p.q, done: true, scale: p.g });

/** Draws the hidden pair uniformly. */
export const drawPair = (size: Size, int: (n: number) => number): Pair => {
  const all = tree(size).pairs;
  return all[int(all.length)];
};

/** The value of the continued fraction [q₁; q₂, …] as an exact fraction num/den. */
export function cfValue(q: readonly number[]): { num: number; den: number } {
  let num = 1;
  let den = 0;
  for (let i = q.length - 1; i >= 0; i--) [num, den] = [q[i] * num + den, num];
  return { num, den };
}

/**
 * The slopes a/b that the clues allow. With quotients q₁…qⱼ revealed and the
 * run not finished, a/b = [q₁; …, qⱼ, x] for some x > 1, which lies strictly
 * between [q₁; …, qⱼ] and [q₁; …, qⱼ + 1]. A finished run fixes the slope.
 */
export function slopes(c: Clues): { num: number; den: number }[] {
  const j = c.quotients.length;
  if (j === 0) return [];
  const lo = cfValue(c.quotients);
  if (c.done) return [lo];
  return [lo, cfValue([...c.quotients.slice(0, -1), c.quotients[j - 1] + 1])];
}

export const MAX_MULTIPLIER = Math.max(
  ...SIZES.flatMap((size) =>
    (['coprime', 'square', 'cuts'] as const).flatMap((kind) =>
      CUTS.map((cuts) => ({ kind, cuts }))
        .filter((bet) => offered(size, bet))
        .map((bet) => prize(size, bet)),
    ),
  ),
);
