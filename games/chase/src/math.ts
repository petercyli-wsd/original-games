// Chase: a runner and a hunter on a small grid with walls and one exit.
//
// Each turn the runner steps to a uniformly random open neighbour (up, down,
// left, right). Landing on the hunter is caught; landing on the exit escapes.
// Then, on turns when it moves, the hunter takes one step along a shortest
// path towards the runner (ties broken uniformly at random); landing on the
// runner catches it. A Slow hunter moves every third turn, a Steady one every
// second turn, a Fast one every turn.
//
// The game is an absorbing Markov chain on the joint state (runner, hunter,
// phase), where phase counts turns until the hunter's next move. The chance of
// escaping from each state is the unique solution of the linear system
//
//   V(s) = mean over runner moves n of Q(s, n),
//   Q(s, n) = 1 if n is the exit, 0 if n is the hunter, else the average of
//             V(n, h', phase') over the hunter's equally likely replies h'
//             (0 when h' = n),
//
// which we solve to machine precision by Gauss–Seidel sweeps (the tests check
// it against a dense Gaussian elimination). The board shades every cell by
// V(that cell, hunter, phase): the runner's own cell is the live odds, and its
// neighbours' Q values are the odds each possible next step would leave you
// with. They average to the current odds by the equation above.
//
// Pricing (fixed prize): escaping pays prize = RTP / V(start), and cashing out
// in state s pays prize × V(s). V along the round is a martingale (it is the
// conditional probability of the same event), so by optional stopping every
// cash-out rule returns exactly RTP.

import type { Rng, Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

// ---------- Boards ----------

export type BoardId = 'yard' | 'hall';
export type Gap = 'big' | 'medium' | 'small';
export type Speed = 'slow' | 'steady' | 'fast';

export const BOARD_IDS: BoardId[] = ['yard', 'hall'];
export const GAPS: Gap[] = ['big', 'medium', 'small'];
export const SPEEDS: Speed[] = ['slow', 'steady', 'fast'];

/** Turns between hunter moves. */
export const PERIOD: Record<Speed, number> = { slow: 3, steady: 2, fast: 1 };
export const SPEED_LABEL: Record<Speed, string> = { slow: 'Slow', steady: 'Steady', fast: 'Fast' };
export const SPEED_HINT: Record<Speed, string> = { slow: 'moves every 3rd turn', steady: 'moves every 2nd turn', fast: 'moves every turn' };
export const GAP_LABEL: Record<Gap, string> = { big: 'Big', medium: 'Medium', small: 'Small' };

// '#' wall, 'E' exit, 'R' runner start, 'a' / 'b' / 'c' hunter starts for a
// big / medium / small head start, '.' open floor.
const LAYOUTS: Record<BoardId, { name: string; rows: string[] }> = {
  yard: {
    name: 'Yard 5×5',
    rows: [
      '...Ec', //
      '.#R#.',
      '.b...',
      '.#.#.',
      'a....',
    ],
  },
  hall: {
    name: 'Hall 7×7',
    rows: [
      '.....Ec', //
      '.#.#.#.',
      'b...R..',
      '.#.#.#.',
      '.......',
      '.#.#.#.',
      'a......',
    ],
  },
};

export interface Board {
  id: BoardId;
  name: string;
  w: number;
  h: number;
  /** Per cell: open floor? */
  open: boolean[];
  exit: number;
  runner: number;
  hunters: Record<Gap, number>;
  /** Open neighbours of each cell, in the order up, right, down, left. */
  nbrs: number[][];
  /** All-pairs shortest-path distances (Infinity through walls). */
  dist: number[][];
}

function buildBoard(id: BoardId): Board {
  const { name, rows } = LAYOUTS[id];
  const h = rows.length;
  const w = rows[0].length;
  const open: boolean[] = [];
  let exit = -1;
  let runner = -1;
  const hunters = {} as Record<Gap, number>;
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const i = y * w + x;
      open[i] = ch !== '#';
      if (ch === 'E') exit = i;
      if (ch === 'R') runner = i;
      if (ch === 'a') hunters.big = i;
      if (ch === 'b') hunters.medium = i;
      if (ch === 'c') hunters.small = i;
    }),
  );
  const nbrs = open.map((o, i) => {
    if (!o) return [];
    const x = i % w;
    const y = Math.floor(i / w);
    const out: number[] = [];
    if (y > 0 && open[i - w]) out.push(i - w);
    if (x < w - 1 && open[i + 1]) out.push(i + 1);
    if (y < h - 1 && open[i + w]) out.push(i + w);
    if (x > 0 && open[i - 1]) out.push(i - 1);
    return out;
  });
  const dist = open.map((_, s) => {
    const d = new Array<number>(w * h).fill(Infinity);
    if (!open[s]) return d;
    d[s] = 0;
    const queue = [s];
    for (let k = 0; k < queue.length; k++) {
      const u = queue[k];
      for (const v of nbrs[u]) if (d[v] === Infinity) (d[v] = d[u] + 1), queue.push(v);
    }
    return d;
  });
  return { id, name, w, h, open, exit, runner, hunters, nbrs, dist };
}

const boards = new Map<BoardId, Board>();
export function board(id: BoardId): Board {
  let b = boards.get(id);
  if (!b) boards.set(id, (b = buildBoard(id)));
  return b;
}

/** The hunter's equally likely next cells: neighbours one step closer to the runner. */
export function hunterSteps(b: Board, hunter: number, runner: number): number[] {
  const d = b.dist[hunter][runner];
  return b.nbrs[hunter].filter((n) => b.dist[n][runner] === d - 1);
}

// ---------- The chain ----------

export interface State {
  runner: number;
  hunter: number;
  /** Turns played so far, mod the hunter's period. The hunter moves when it reaches period − 1. */
  phase: number;
}

/** Whether the hunter moves at the end of the coming turn. */
export const hunterMovesNow = (phase: number, speed: Speed) => phase === PERIOD[speed] - 1;

export interface Table {
  board: Board;
  speed: Speed;
  period: number;
  /** V(runner, hunter, phase), indexed by (runner·N + hunter)·period + phase. */
  v: Float64Array;
}

const idx = (t: { board: Board; period: number }, runner: number, hunter: number, phase: number) =>
  (runner * t.board.open.length + hunter) * t.period + phase;

/** Q(s, n): the escape chance just after the runner steps to n (averaged over the hunter's reply). */
function moveValue(t: Table, s: State, n: number): number {
  const b = t.board;
  if (n === s.hunter) return 0;
  if (n === b.exit) return 1;
  const next = (s.phase + 1) % t.period;
  if (!hunterMovesNow(s.phase, t.speed)) return t.v[idx(t, n, s.hunter, next)];
  const replies = hunterSteps(b, s.hunter, n);
  let sum = 0;
  for (const h of replies) if (h !== n) sum += t.v[idx(t, n, h, next)];
  return sum / replies.length;
}

/** The live (non-absorbed) states of a board, for any period. */
function liveStates(b: Board, period: number): State[] {
  const out: State[] = [];
  for (let r = 0; r < b.open.length; r++) {
    if (!b.open[r] || r === b.exit) continue;
    for (let h = 0; h < b.open.length; h++) {
      if (!b.open[h] || h === r) continue;
      for (let phase = 0; phase < period; phase++) out.push({ runner: r, hunter: h, phase });
    }
  }
  return out;
}

function solve(b: Board, speed: Speed): Table {
  const period = PERIOD[speed];
  const t: Table = { board: b, speed, period, v: new Float64Array(b.open.length * b.open.length * period) };
  const states = liveStates(b, period);
  // Gauss–Seidel: each sweep replaces V(s) by the right-hand side of its own
  // equation. Every live state reaches absorption with positive probability,
  // so the iteration contracts to the unique solution; we stop once a whole
  // sweep moves no value by more than 1e-15.
  for (let sweep = 0; sweep < 100_000; sweep++) {
    let change = 0;
    for (let k = states.length - 1; k >= 0; k--) {
      const s = states[k];
      const nb = b.nbrs[s.runner];
      let sum = 0;
      for (const n of nb) sum += moveValue(t, s, n);
      const v = sum / nb.length;
      const i = idx(t, s.runner, s.hunter, s.phase);
      change = Math.max(change, Math.abs(v - t.v[i]));
      t.v[i] = v;
    }
    if (change < 1e-15) return t;
  }
  throw new Error('Chase: value iteration did not converge');
}

const tables = new Map<string, Table>();
export function table(id: BoardId, speed: Speed): Table {
  const key = `${id}/${speed}`;
  let t = tables.get(key);
  if (!t) tables.set(key, (t = solve(board(id), speed)));
  return t;
}

/** Escape chance from a state (1 on the exit, 0 when caught). */
export function winChance(t: Table, s: State): number {
  if (s.runner === s.hunter) return 0;
  if (s.runner === t.board.exit) return 1;
  return t.v[idx(t, s.runner, s.hunter, s.phase)];
}

export interface MoveOdds {
  cell: number;
  /** Escape chance if the runner steps here (after the hunter's reply). */
  p: number;
}

/** The runner's possible next steps, each equally likely, with the odds each would leave. */
export function moveOdds(t: Table, s: State): MoveOdds[] {
  return t.board.nbrs[s.runner].map((cell) => ({ cell, p: moveValue(t, s, cell) }));
}

/** The escape chance the board would show for the runner on each cell, with the hunter where it is now. */
export function heatMap(t: Table, hunter: number, phase: number): number[] {
  const b = t.board;
  return b.open.map((o, r) => (!o ? 0 : winChance(t, { runner: r, hunter, phase })));
}

export const startState = (id: BoardId, gap: Gap): State => {
  const b = board(id);
  return { runner: b.runner, hunter: b.hunters[gap], phase: 0 };
};

export interface Settings {
  board: BoardId;
  gap: Gap;
  speed: Speed;
}

export const startChance = ({ board: id, gap, speed }: Settings) => winChance(table(id, speed), startState(id, gap));
export const prizeFor = (s: Settings) => RTP / startChance(s);

// ---------- One turn ----------

export type TurnEnd = 'escaped' | 'caught' | null;

export interface Turn {
  /** Where the runner stepped. */
  runner: number;
  /** Where the hunter ended the turn (unchanged on turns it rests or after an escape / catch by the runner). */
  hunter: number;
  /** Whether the hunter stepped this turn. */
  hunterMoved: boolean;
  phase: number;
  end: TurnEnd;
}

/** Plays one turn with the host RNG: the runner's step, then the hunter's reply. */
export function playTurn(t: Table, s: State, rng: Rng): Turn {
  const b = t.board;
  const nb = b.nbrs[s.runner];
  const runner = nb[rng.int(nb.length)];
  const phase = (s.phase + 1) % t.period;
  if (runner === s.hunter) return { runner, hunter: s.hunter, hunterMoved: false, phase, end: 'caught' };
  if (runner === b.exit) return { runner, hunter: s.hunter, hunterMoved: false, phase, end: 'escaped' };
  if (!hunterMovesNow(s.phase, t.speed)) return { runner, hunter: s.hunter, hunterMoved: false, phase, end: null };
  const replies = hunterSteps(b, s.hunter, runner);
  const hunter = replies[rng.int(replies.length)];
  return { runner, hunter, hunterMoved: true, phase, end: hunter === runner ? 'caught' : null };
}

// ---------- Settings, volatility, caps ----------

export const ALL_SETTINGS: Settings[] = BOARD_IDS.flatMap((board) => GAPS.flatMap((gap) => SPEEDS.map((speed) => ({ board, gap, speed }))));

export function volatilityOf(s: Settings): Volatility {
  const p = startChance(s);
  return p > 0.3 ? 'low' : p > 0.12 ? 'medium' : p > 0.03 ? 'high' : 'extreme';
}

/**
 * Escaping pays the prize and any cash-out pays prize × V ≤ prize, so the
 * largest prize (Hall, small head start, fast hunter: 68.1×) bounds every
 * payout. A constant, so importing the manifest solves nothing; the tests
 * check it against every setting.
 */
export const MAX_MULTIPLIER = 69;

/** Auto cash-out targets (null = play to the end). */
export const AUTO_TARGETS: (number | null)[] = [null, 1.5, 2, 3, 5, 10];

/** Auto's stopping rule: cash out once the cash-out reaches the target (null = play to the end). */
export const autoStops = (cash: number, target: number | null) => target !== null && cash >= target;

const hitTables = new Map<string, number>();

/**
 * Exact chance that an Auto round with this cash-out target pays at least the
 * target (it escapes, or the cash-out reaches the target first). Same chain,
 * with the states where the rule fires made absorbing, solved the same way.
 */
export function autoChance(s: Settings, target: number | null): number {
  if (target === null) return startChance(s);
  const key = `${s.board}/${s.gap}/${s.speed}/${target}`;
  const hit = hitTables.get(key);
  if (hit !== undefined) return hit;
  const t = table(s.board, s.speed);
  const b = t.board;
  const prize = prizeFor(s);
  const w = new Float64Array(t.v.length);
  const states = liveStates(b, t.period);
  const stops = (i: number) => autoStops(prize * t.v[i], target);
  for (const st of states) {
    const i = idx(t, st.runner, st.hunter, st.phase);
    if (stops(i)) w[i] = 1;
  }
  const free = states.filter((st) => !stops(idx(t, st.runner, st.hunter, st.phase)));
  for (let sweep = 0; sweep < 100_000; sweep++) {
    let change = 0;
    for (let k = free.length - 1; k >= 0; k--) {
      const st = free[k];
      const nb = b.nbrs[st.runner];
      const next = (st.phase + 1) % t.period;
      let sum = 0;
      for (const n of nb) {
        if (n === st.hunter) continue;
        if (n === b.exit) {
          sum += 1;
          continue;
        }
        if (!hunterMovesNow(st.phase, t.speed)) {
          sum += w[idx(t, n, st.hunter, next)];
          continue;
        }
        const replies = hunterSteps(b, st.hunter, n);
        let r = 0;
        for (const h of replies) if (h !== n) r += w[idx(t, n, h, next)];
        sum += r / replies.length;
      }
      const v = sum / nb.length;
      const i = idx(t, st.runner, st.hunter, st.phase);
      change = Math.max(change, Math.abs(v - w[i]));
      w[i] = v;
    }
    if (change < 1e-15) {
      const start = startState(s.board, s.gap);
      const p = w[idx(t, start.runner, start.hunter, start.phase)];
      hitTables.set(key, p);
      return p;
    }
  }
  throw new Error('Chase: auto chance did not converge');
}

/** One shortest path from the hunter to the runner (for drawing the gap). */
export function chasePath(b: Board, hunter: number, runner: number): number[] {
  const path = [hunter];
  let at = hunter;
  while (at !== runner && path.length < 64) {
    const next = b.nbrs[at].find((n) => b.dist[n][runner] === b.dist[at][runner] - 1);
    if (next === undefined) break;
    path.push((at = next));
  }
  return path;
}
