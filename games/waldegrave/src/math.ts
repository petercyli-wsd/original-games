// Waldegrave: n players wait in a ring queue. The first two play a fair duel
// (a coin flip). The winner stays on as champion and plays the next in the
// queue; the loser goes to the back. The first player to win k duels in a row
// takes the pot. This is the problem James Waldegrave posed to Montmort and
// Nicolaus Bernoulli in 1713: with three players and k = 2 the seats' chances
// are 5/14, 5/14 and 2/7.
//
// The process is a Markov chain. Everything about the future depends only on
// the champion's streak s and on who stands where: champion at position 0,
// challenger at 1, the rest of the queue at 2 … n−1. Relabelling players
// changes nothing, so W[s][i] = P(the player at position i ends up taking
// the pot | streak s) is a small table (k × n unknowns). One duel moves:
//
//   champion wins (½): streak s+1 (pot if s+1 = k); challenger → back
//   challenger wins (½): challenger is champion with streak 1; champion → back
//
// and the queue behind them shuffles up one place either way. W solves a
// linear system, which we solve in exact rational arithmetic (BigInt), then
// read off as floats. The opening duel is streak 0 with seat A as champion.
//
// Pricing: the bet backs (or lays) a seat. Its prize is RTP / P(win at the
// start) and the cash-out in any state is prize × P(win | state). Since
// P(win | state) = ½·P(after champion wins) + ½·P(after challenger wins) is
// exactly the chain's equation, the cash-out is a martingale starting at
// RTP, so every stopping rule (cash out after any duel, or play it out) is
// worth exactly RTP. Choosing a seat or back/lay only changes volatility.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

export const PLAYERS = [3, 4, 5] as const;
export type Players = (typeof PLAYERS)[number];

export const STREAKS = [2, 3, 4] as const;
export type Streak = (typeof STREAKS)[number];

export type Side = 'back' | 'lay';
export const SIDES: Side[] = ['back', 'lay'];

export const SEAT_NAMES = ['A', 'B', 'C', 'D', 'E'] as const;

export interface Settings {
  players: Players;
  streak: Streak;
  /** Seat index 0 … players−1 (A, B, …). */
  seat: number;
  side: Side;
}

export const VOLATILITY: Record<Volatility, Settings> = {
  low: { players: 5, streak: 2, seat: 4, side: 'lay' },
  medium: { players: 3, streak: 2, seat: 0, side: 'back' },
  high: { players: 4, streak: 3, seat: 3, side: 'back' },
  extreme: { players: 5, streak: 2, seat: 4, side: 'back' },
};

// ---------- exact rational arithmetic ----------

export interface Frac {
  n: bigint;
  d: bigint;
}

const gcd = (a: bigint, b: bigint): bigint => {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
};
const frac = (n: bigint, d = 1n): Frac => {
  if (d < 0n) [n, d] = [-n, -d];
  const g = gcd(n, d) || 1n;
  return { n: n / g, d: d / g };
};
const add = (a: Frac, b: Frac) => frac(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Frac, b: Frac) => frac(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Frac, b: Frac) => frac(a.n * b.n, a.d * b.d);
const div = (a: Frac, b: Frac) => frac(a.n * b.d, a.d * b.n);
const ZERO = frac(0n);
const HALF = frac(1n, 2n);
export const toNumber = (f: Frac) => Number(f.n) / Number(f.d);
export const fracText = (f: Frac) => (f.d === 1n ? `${f.n}` : `${f.n}/${f.d}`);

/** Solves A x = b exactly (A square and non-singular). */
function solveExact(A: Frac[][], b: Frac[]): Frac[] {
  const m = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < m; c++) {
    const p = M.findIndex((row, r) => r >= c && row[c].n !== 0n);
    if (p < 0) throw new Error('singular system');
    [M[c], M[p]] = [M[p], M[c]];
    const piv = M[c][c];
    for (let j = c; j <= m; j++) M[c][j] = div(M[c][j], piv);
    for (let r = 0; r < m; r++) {
      if (r === c || M[r][c].n === 0n) continue;
      const f = M[r][c];
      for (let j = c; j <= m; j++) M[r][j] = sub(M[r][j], mul(f, M[c][j]));
    }
  }
  return M.map((row) => row[m]);
}

// ---------- the chain ----------

/** Where the player at position i stands after the champion wins. */
export const afterChampWins = (i: number, n: number) => (i === 0 ? 0 : i === 1 ? n - 1 : i - 1);
/** Where the player at position i stands after the challenger wins. */
export const afterChallengerWins = (i: number, n: number) => (i === 1 ? 0 : i === 0 ? n - 1 : i - 1);

export interface Table {
  /** W[s][i]: chance the player at position i takes the pot, champion on streak s. */
  exact: Frac[][];
  W: number[][];
  /** Expected duels still to play from streak s. */
  duelsLeft: number[];
}

const tables = new Map<string, Table>();

export function table(n: number, k: number): Table {
  const key = `${n}:${k}`;
  const hit = tables.get(key);
  if (hit) return hit;
  const idx = (s: number, i: number) => s * n + i;
  const m = n * k;
  const A = Array.from({ length: m }, () => Array.from({ length: m }, () => ZERO));
  const b = Array.from({ length: m }, () => ZERO);
  for (let s = 0; s < k; s++) {
    for (let i = 0; i < n; i++) {
      const r = idx(s, i);
      A[r][r] = add(A[r][r], frac(1n));
      if (s + 1 >= k) {
        if (i === 0) b[r] = add(b[r], HALF);
      } else {
        const c = idx(s + 1, afterChampWins(i, n));
        A[r][c] = sub(A[r][c], HALF);
      }
      const c = idx(1, afterChallengerWins(i, n));
      A[r][c] = sub(A[r][c], HALF);
    }
  }
  const x = solveExact(A, b);
  const exact = Array.from({ length: k }, (_, s) => Array.from({ length: n }, (_, i) => x[idx(s, i)]));

  // Expected duels: E[s] = 1 + ½·E[s+1] (0 at the pot) + ½·E[1].
  const EA = Array.from({ length: k }, () => Array.from({ length: k }, () => ZERO));
  const Eb = Array.from({ length: k }, () => frac(1n));
  for (let s = 0; s < k; s++) {
    EA[s][s] = add(EA[s][s], frac(1n));
    if (s + 1 < k) EA[s][s + 1] = sub(EA[s][s + 1], HALF);
    EA[s][1] = sub(EA[s][1], HALF);
  }
  const E = solveExact(EA, Eb).map(toNumber);

  const t: Table = { exact, W: exact.map((row) => row.map(toNumber)), duelsLeft: E };
  tables.set(key, t);
  return t;
}

export interface Duel {
  /** Seats in order: champion, challenger, then the queue to the back. */
  order: number[];
  /** The champion's current run of wins (0 before the opening duel). */
  streak: number;
  /** The seat that took the pot, once someone has. */
  winner: number | null;
  duels: number;
}

export const newDuel = (n: number): Duel => ({ order: Array.from({ length: n }, (_, i) => i), streak: 0, winner: null, duels: 0 });

/** Plays one duel. champWins is decided by a fair coin. */
export function playDuel(d: Duel, k: number, champWins: boolean): Duel {
  const [c, x, ...rest] = d.order;
  if (champWins) {
    const streak = d.streak + 1;
    return { order: [c, ...rest, x], streak, winner: streak >= k ? c : null, duels: d.duels + 1 };
  }
  return { order: [x, ...rest, c], streak: 1, winner: null, duels: d.duels + 1 };
}

/** Every seat's exact chance to take the pot from here, by seat index. */
export function seatChances(d: Duel, k: number): number[] {
  const n = d.order.length;
  if (d.winner !== null) return d.order.map((_, s) => (s === d.winner ? 1 : 0));
  const row = table(n, k).W[d.streak];
  const out = new Array<number>(n);
  d.order.forEach((seat, pos) => (out[seat] = row[pos]));
  return out;
}

/** The exact starting chance of a seat, as a fraction. */
export function seatFraction(n: number, k: number, seat: number): Frac {
  return table(n, k).exact[0][seat];
}

export function winChance(d: Duel, k: number, seat: number, side: Side): number {
  const p = seatChances(d, k)[seat];
  return side === 'back' ? p : 1 - p;
}

export const startChance = ({ players, streak, seat, side }: Settings) => winChance(newDuel(players), streak, seat, side);

export const prizeFor = (s: Settings) => RTP / startChance(s);

/** The cash-out: prize × P(win | state). A martingale from RTP. */
export const cashValue = (d: Duel, s: Settings) => prizeFor(s) * winChance(d, s.streak, s.seat, s.side);

/** The chance after each possible result of the next duel: [champion wins, challenger wins]. */
export function branches(d: Duel, s: Settings): [number, number] {
  return [winChance(playDuel(d, s.streak, true), s.streak, s.seat, s.side), winChance(playDuel(d, s.streak, false), s.streak, s.seat, s.side)];
}

export const expectedDuels = (n: number, k: number) => table(n, k).duelsLeft[0];

/** Every legal setting. */
export function allSettings(): Settings[] {
  const out: Settings[] = [];
  for (const players of PLAYERS)
    for (const streak of STREAKS) for (let seat = 0; seat < players; seat++) for (const side of SIDES) out.push({ players, streak, seat, side });
  return out;
}

/** The payout is at most the full prize, so the largest prize bounds every payout. */
export const MAX_MULTIPLIER = Math.max(...allSettings().map(prizeFor));

export function volatilityOf(s: Settings): Volatility {
  const p = startChance(s);
  return p > 0.5 ? 'low' : p > 0.2 ? 'medium' : p > 0.1 ? 'high' : 'extreme';
}
