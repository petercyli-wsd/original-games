// Noughts: X and O play uniformly random legal moves on a 3×3 board, X first,
// until one of them completes a line or the board fills. You back X, O or a
// draw, for one game or for 2–3 games in a row (every game must go your way).
//
// Exact odds. The game tree under random play is tiny (4,520 unfinished
// positions), so every probability here is computed exactly, never sampled.
// In a position with n empty cells, a finish that takes m more marks has
// probability (n − m)!/n!, so N(b) = n!·P(outcome | b) is an integer. It obeys
//   N(b) = Σ over empty cells c of N(b + mark on c),
// with N = n!·[outcome] for a finished position (n empty cells left). From the
// empty board N = (212256, 104544, 46080) out of 9! = 362880:
//   P(X wins) = 737/1260 ≈ 58.49%, P(O wins) = 121/420 ≈ 28.81%,
//   P(draw)   = 8/63     ≈ 12.70%.
//
// Pricing (fixed prize). Backing side s for k games in a row wins with chance
// P₀ = p_s^k and pays prize = RTP / P₀. With w games already won and the
// current game at position b, the round is won with chance
//   P(win | S) = P_s(b) · p_s^(k − w − 1),
// and the cash-out is prize · P(win | S). The next mark lands on a uniformly
// random empty cell, so P_s(b) is the plain average of P_s over the positions
// it can lead to: the cash-out is a martingale that starts at RTP, and by
// optional stopping every strategy (any cash-out rule, playing a game out,
// stopping between games) returns exactly RTP. The board draws that average:
// each empty cell shows your chance if the next mark lands there, and the
// cells average to your chance now.
//
// When the backed result becomes impossible (N = 0) the round ends at once;
// when it becomes certain (N = n!) the rest of that game is a formality and
// plays out by itself. Both rules leave every value unchanged. The largest
// payout is the prize for a draw three times in a row, RTP·(63/8)³ ≈ 483.5×.

import type { Rng, Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

/** 0 = empty, 1 = X, 2 = O. Cells are numbered 0–8 in reading order. */
export type Mark = 0 | 1 | 2;
export type Grid = readonly Mark[];

/** What you back: X wins, O wins, or a draw. */
export type Side = 'X' | 'O' | 'D';
export const SIDES: readonly Side[] = ['X', 'O', 'D'];
export const SIDE_NAME: Record<Side, string> = { X: 'X wins', O: 'O wins', D: 'Draw' };

/** Games in a row that must all go your way. */
export const GAMES = [1, 2, 3] as const;
export type Games = (typeof GAMES)[number];

export const LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

export const EMPTY: Grid = [0, 0, 0, 0, 0, 0, 0, 0, 0];

const FACT = [1, 1, 2, 6, 24, 120, 720, 5040, 40320, 362880];

export const emptyCells = (g: Grid) => g.flatMap((m, i) => (m === 0 ? [i] : []));

/** Whose mark comes next: X when both have placed the same number. */
export function toMove(g: Grid): 1 | 2 {
  let x = 0;
  let o = 0;
  for (const m of g) {
    if (m === 1) x++;
    else if (m === 2) o++;
  }
  return x === o ? 1 : 2;
}

/** Lines completed by `mark` (any mark if omitted), as indices into LINES. */
export function completed(g: Grid, mark?: 1 | 2): number[] {
  const out: number[] = [];
  LINES.forEach(([a, b, c], i) => {
    const m = g[a];
    if (m !== 0 && m === g[b] && m === g[c] && (mark === undefined || m === mark)) out.push(i);
  });
  return out;
}

/** The finished game's result, or null while it is still going. */
export function outcome(g: Grid): Side | null {
  const [line] = completed(g);
  if (line !== undefined) return g[LINES[line][0]] === 1 ? 'X' : 'O';
  return g.includes(0) ? null : 'D';
}

/** The mover's mark on an empty cell of an unfinished game. */
export function place(g: Grid, cell: number): Grid {
  if (g[cell] !== 0 || outcome(g) !== null) throw new Error(`cell ${cell} is not playable`);
  const next = g.slice();
  next[cell] = toMove(g);
  return next;
}

export interface Tally {
  X: number;
  O: number;
  D: number;
}

const memo = new Map<number, Tally>();
const keyOf = (g: Grid) => g.reduce<number>((k, m, i) => k + m * 3 ** i, 0);

/**
 * n!·P(each outcome) under random play, where n is the number of empty cells.
 * Exact integers (at most 9! = 362880), memoised by position.
 */
export function tally(g: Grid): Tally {
  const key = keyOf(g);
  const hit = memo.get(key);
  if (hit) return hit;
  const done = outcome(g);
  let t: Tally;
  if (done) {
    const n = FACT[emptyCells(g).length];
    t = { X: done === 'X' ? n : 0, O: done === 'O' ? n : 0, D: done === 'D' ? n : 0 };
  } else {
    t = { X: 0, O: 0, D: 0 };
    for (const c of emptyCells(g)) {
      const s = tally(place(g, c));
      t.X += s.X;
      t.O += s.O;
      t.D += s.D;
    }
  }
  memo.set(key, t);
  return t;
}

/** The exact chance of each result from position g. */
export function chances(g: Grid): Tally {
  const t = tally(g);
  const n = FACT[emptyCells(g).length];
  return { X: t.X / n, O: t.O / n, D: t.D / n };
}

/** Chance that a fresh game goes the backed way. */
export const perGame = (side: Side) => chances(EMPTY)[side];
/** Chance to win the whole bet. */
export const startChance = (side: Side, games: Games) => perGame(side) ** games;
/** The prize for winning the whole bet. */
export const prizeFor = (side: Side, games: Games) => RTP / startChance(side, games);

export interface Series {
  side: Side;
  games: Games;
  /** Games already finished your way. */
  won: number;
  /** The current game (a fresh board between games). */
  grid: Grid;
  status: 'live' | 'won' | 'lost';
}

export const newSeries = (side: Side, games: Games): Series => ({ side, games, won: 0, grid: EMPTY, status: 'live' });

/** Chance the current game goes your way. */
export const gameChance = (s: Series) => chances(s.grid)[s.side];

/** Chance to win the round from here: this game, then every game still to play. */
export function winChance(s: Series): number {
  if (s.status !== 'live') return s.status === 'won' ? 1 : 0;
  return gameChance(s) * perGame(s.side) ** (s.games - s.won - 1);
}

/** The fair cash-out: prize × chance to win from here. */
export const cashValue = (s: Series) => prizeFor(s.side, s.games) * winChance(s);

/** The current game's result is settled your way, so its remaining marks are free. */
export const certain = (s: Series) => s.status === 'live' && tally(s.grid)[s.side] === FACT[emptyCells(s.grid).length];

export interface Move {
  cell: number;
  mark: 1 | 2;
  /** The board right after the mark. */
  grid: Grid;
  /** The game's result, if this mark finished it. */
  ended: Side | null;
  /** The series after the mark (a game won your way moves on to a fresh board). */
  next: Series;
}

/** Places the next mark on `cell` and resolves the series. */
export function play(s: Series, cell: number): Move {
  const mark = toMove(s.grid);
  const grid = place(s.grid, cell);
  const ended = outcome(grid);
  let next: Series;
  if (ended === null) next = { ...s, grid, status: tally(grid)[s.side] === 0 ? 'lost' : 'live' };
  else if (ended !== s.side) next = { ...s, grid, status: 'lost' };
  else if (s.won + 1 === s.games) next = { ...s, grid, won: s.won + 1, status: 'won' };
  else next = { ...s, grid: EMPTY, won: s.won + 1, status: 'live' };
  return { cell, mark, grid, ended, next };
}

export type Mode = 'move' | 'game';

/**
 * One player action, drawn in full before anything animates: a single mark
 * ('move') or the rest of the current game ('game'). Marks keep coming by
 * themselves while the current game's result is already certain.
 */
export function plan(s: Series, mode: Mode, rng: Rng): Move[] {
  const out: Move[] = [];
  let cur = s;
  for (;;) {
    const free = emptyCells(cur.grid);
    const m = play(cur, free[rng.int(free.length)]);
    out.push(m);
    cur = m.next;
    if (cur.status !== 'live' || m.ended) return out;
    if (mode === 'move' && !certain(cur)) return out;
  }
}

export interface CellChance {
  cell: number;
  /** Your chance this game if the next mark lands here. */
  p: number;
  /** The game's result if this mark ends it. */
  ends: Side | null;
}

/** Every empty cell's effect on your chance. Their average is exactly your chance now. */
export function cellChances(g: Grid, side: Side): CellChance[] {
  if (outcome(g)) return [];
  return emptyCells(g).map((cell) => {
    const next = place(g, cell);
    return { cell, p: chances(next)[side], ends: outcome(next) };
  });
}

export interface Threat {
  line: number;
  mark: 1 | 2;
  /** The empty cell that would complete it. */
  cell: number;
}

/** Lines holding two of one mark and an empty third cell. */
export function threats(g: Grid): Threat[] {
  if (outcome(g)) return [];
  const out: Threat[] = [];
  LINES.forEach((line, i) => {
    const marks = line.map((c) => g[c]);
    const empty = line.filter((c) => g[c] === 0);
    for (const mark of [1, 2] as const) {
      if (empty.length === 1 && marks.filter((m) => m === mark).length === 2) out.push({ line: i, mark, cell: empty[0] });
    }
  });
  return out;
}

/** The outcome bar, in the order X, Draw, O: each segment's [from, to) share of its length. */
export function shareBar(t: Tally): { side: Side; from: number; to: number }[] {
  const order: Side[] = ['X', 'D', 'O'];
  let at = 0;
  return order.map((side) => {
    const from = at;
    at += t[side];
    return { side, from, to: at };
  });
}

/** Share of empty cells where the next mark settles the game against you. */
export function nextLoss(s: Series): number {
  if (s.status !== 'live') return 0;
  const cells = cellChances(s.grid, s.side);
  return cells.length ? cells.filter((c) => c.p === 0).length / cells.length : 0;
}

export function volatilityOf(side: Side, games: Games): Volatility {
  const p = startChance(side, games);
  return p > 0.4 ? 'low' : p > 0.15 ? 'medium' : p > 0.03 ? 'high' : 'extreme';
}

export const VOLATILITY: Record<Volatility, { side: Side; games: Games }> = {
  low: { side: 'X', games: 1 },
  medium: { side: 'O', games: 1 },
  high: { side: 'D', games: 1 },
  extreme: { side: 'D', games: 2 },
};

/** The prize is the largest payout: cash-outs are prize × a probability. */
export const MAX_MULTIPLIER = Math.max(...SIDES.flatMap((s) => GAMES.map((k) => prizeFor(s, k))));
