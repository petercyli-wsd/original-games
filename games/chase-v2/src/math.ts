// Chase: a runner and a hunter on a 5×5 yard with walls and one exit.
//
// Each turn the runner steps to a uniformly random open neighbour (up, down,
// left, right); the player never steers it. Landing on the hunter is caught;
// landing on the exit escapes. Then the hunter takes one step along a shortest
// path towards the runner (ties broken uniformly at random); landing on the
// runner catches it. So a runner step is fatal exactly when it lands on the
// hunter or on a square next to it (the hunter's only closer square is then
// the runner's), and every other step survives the turn for sure.
//
// The one setting is where the hunter starts: far away, near, next to the exit
// or between the runner and the exit.
//
// The game is an absorbing Markov chain on the joint state (runner, hunter).
// The chance of escaping from each state is the unique solution of
//
//   V(s) = mean over runner steps n of Q(s, n),
//   Q(s, n) = 1 if n is the exit, 0 if n is the hunter, else the average of
//             V(n, h') over the hunter's equally likely replies h'
//             (0 when h' = n),
//
// which we solve to machine precision by Gauss–Seidel sweeps (the tests check
// it against a dense Gaussian elimination). The board shades every square by
// V(that square, hunter): the runner's own square is the live odds.
//
// Pricing (fixed prize): escaping pays prize = RTP / V(start), and cashing out
// in state s pays prize × V(s). V along the round is a martingale (it is the
// conditional probability of the same event), so by optional stopping every
// cash-out rule returns exactly RTP.

import type { Rng, Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

// ---------- The yard ----------

export type Start = 'far' | 'near' | 'exit' | 'block';
export const STARTS: Start[] = ['far', 'near', 'exit', 'block'];
export const START_LABEL: Record<Start, string> = { far: 'Far', near: 'Near', exit: 'At exit', block: 'Blocks' };
export const START_HINT: Record<Start, string> = {
  far: 'in the far corner',
  near: 'two squares from the runner',
  exit: 'next to the exit',
  block: "on the runner's way out",
};

// '#' wall, 'E' exit, 'R' runner start, 'a' / 'b' / 'c' / 'd' hunter starts
// (far / near / by the exit / blocking), '.' open floor.
const ROWS = [
  '.d.Ec', //
  '.#R#.',
  '.b...',
  '.#.#.',
  'a....',
];
const START_CHAR: Record<string, Start> = { a: 'far', b: 'near', c: 'exit', d: 'block' };

export interface Board {
  w: number;
  h: number;
  /** Per cell: open floor? */
  open: boolean[];
  exit: number;
  runner: number;
  starts: Record<Start, number>;
  /** Open neighbours of each cell, in the order up, right, down, left. */
  nbrs: number[][];
  /** All-pairs shortest-path distances (Infinity through walls). */
  dist: number[][];
}

function buildBoard(): Board {
  const h = ROWS.length;
  const w = ROWS[0].length;
  const open: boolean[] = [];
  let exit = -1;
  let runner = -1;
  const starts = {} as Record<Start, number>;
  ROWS.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const i = y * w + x;
      open[i] = ch !== '#';
      if (ch === 'E') exit = i;
      if (ch === 'R') runner = i;
      if (START_CHAR[ch]) starts[START_CHAR[ch]] = i;
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
  return { w, h, open, exit, runner, starts, nbrs, dist };
}

let theBoard: Board | null = null;
export function board(): Board {
  return (theBoard ??= buildBoard());
}

/** The hunter's equally likely next cells: neighbours one step closer to the runner. */
export function hunterSteps(b: Board, hunter: number, runner: number): number[] {
  const d = b.dist[hunter][runner];
  return b.nbrs[hunter].filter((n) => b.dist[n][runner] === d - 1);
}

/**
 * The hunter's reach: its own square and the open squares next to it, except
 * the exit. A runner step onto one of these is caught this turn (next to the
 * hunter, its only closer square is the runner's); every other step survives
 * the turn. Stepping onto the exit escapes before the hunter moves, unless the
 * hunter stands on it. The tests check this against `nextSteps` on every state.
 */
export function hunterReach(b: Board, hunter: number): number[] {
  return [hunter, ...b.nbrs[hunter].filter((n) => n !== b.exit)];
}

/** The race the board shows: shortest walks (through open squares) from the runner to the exit and from the hunter to the runner. */
export function race(b: Board, runner: number, hunter: number): { toExit: number; toRunner: number } {
  return { toExit: b.dist[runner][b.exit], toRunner: b.dist[hunter][runner] };
}

// ---------- The chain ----------

export interface State {
  runner: number;
  hunter: number;
}

const N = () => board().open.length;
const idx = (runner: number, hunter: number) => runner * N() + hunter;

/** The live (non-absorbed) states. */
function liveStates(b: Board): State[] {
  const out: State[] = [];
  for (let r = 0; r < b.open.length; r++) {
    if (!b.open[r] || r === b.exit) continue;
    for (let h = 0; h < b.open.length; h++) if (b.open[h] && h !== r) out.push({ runner: r, hunter: h });
  }
  return out;
}

/**
 * One Gauss–Seidel solve of "V(s) = mean over runner steps of the value after
 * the hunter's reply", where `fixed(i)` marks states held at their current value
 * (used for Auto's stopping rule). Every live state reaches absorption with
 * positive probability, so the sweeps contract to the unique solution; we stop
 * once a whole sweep moves no value by more than 1e-15.
 */
function gaussSeidel(v: Float64Array, fixed: (i: number) => boolean): Float64Array {
  const b = board();
  const states = liveStates(b).filter((s) => !fixed(idx(s.runner, s.hunter)));
  for (let sweep = 0; sweep < 100_000; sweep++) {
    let change = 0;
    for (let k = states.length - 1; k >= 0; k--) {
      const s = states[k];
      const nb = b.nbrs[s.runner];
      let sum = 0;
      for (const n of nb) {
        if (n === s.hunter) continue;
        if (n === b.exit) {
          sum += 1;
          continue;
        }
        const replies = hunterSteps(b, s.hunter, n);
        let r = 0;
        for (const h of replies) if (h !== n) r += v[idx(n, h)];
        sum += r / replies.length;
      }
      const i = idx(s.runner, s.hunter);
      const next = sum / nb.length;
      change = Math.max(change, Math.abs(next - v[i]));
      v[i] = next;
    }
    if (change < 1e-15) return v;
  }
  throw new Error('Chase: value iteration did not converge');
}

let values: Float64Array | null = null;
const table = () => (values ??= gaussSeidel(new Float64Array(N() * N()), () => false));

/** Escape chance from a state (1 on the exit, 0 when caught). */
export function winChance(s: State): number {
  if (s.runner === s.hunter) return 0;
  if (s.runner === board().exit) return 1;
  return table()[idx(s.runner, s.hunter)];
}

/** What a runner step to `n` leads to this turn: caught for sure, out for sure, or neither. */
export type Fate = 'caught' | 'out' | null;

export interface Step {
  cell: number;
  fate: Fate;
  /** Escape chance if the runner steps here (after the hunter's reply). */
  p: number;
}

/** The runner's possible next steps, each equally likely (1 in k). */
export function nextSteps(s: State): Step[] {
  const b = board();
  return b.nbrs[s.runner].map((n) => {
    if (n === s.hunter) return { cell: n, fate: 'caught', p: 0 };
    if (n === b.exit) return { cell: n, fate: 'out', p: 1 };
    const replies = hunterSteps(b, s.hunter, n);
    // Next to the hunter, its only closer square is the runner's: caught.
    if (replies.every((h) => h === n)) return { cell: n, fate: 'caught', p: 0 };
    let sum = 0;
    for (const h of replies) if (h !== n) sum += winChance({ runner: n, hunter: h });
    return { cell: n, fate: null, p: sum / replies.length };
  });
}

/** The escape chance the board shows for the runner on each square, with the hunter where it is now. */
export function heatMap(hunter: number): number[] {
  const b = board();
  return b.open.map((o, r) => (!o ? 0 : winChance({ runner: r, hunter })));
}

export const startState = (start: Start): State => ({ runner: board().runner, hunter: board().starts[start] });
export const startChance = (start: Start) => winChance(startState(start));
export const prizeFor = (start: Start) => RTP / startChance(start);

// ---------- One turn ----------

export type TurnEnd = 'escaped' | 'caught' | null;

export interface Turn {
  /** Where the runner stepped. */
  runner: number;
  /** Where the hunter ended the turn (unchanged when the runner's own step ended the round). */
  hunter: number;
  /** Whether the hunter stepped this turn. */
  hunterMoved: boolean;
  end: TurnEnd;
}

/** Plays one turn with the host RNG: the runner's step, then the hunter's reply. */
export function playTurn(s: State, rng: Rng): Turn {
  const b = board();
  const nb = b.nbrs[s.runner];
  const runner = nb[rng.int(nb.length)];
  if (runner === s.hunter) return { runner, hunter: s.hunter, hunterMoved: false, end: 'caught' };
  if (runner === b.exit) return { runner, hunter: s.hunter, hunterMoved: false, end: 'escaped' };
  const replies = hunterSteps(b, s.hunter, runner);
  const hunter = replies[rng.int(replies.length)];
  return { runner, hunter, hunterMoved: true, end: hunter === runner ? 'caught' : null };
}

// ---------- Volatility, caps, Auto ----------

export function volatilityOf(start: Start): Volatility {
  const p = startChance(start);
  return p > 0.25 ? 'low' : p > 0.1 ? 'medium' : p > 0.01 ? 'high' : 'extreme';
}

/**
 * Escaping pays the prize and any cash-out pays prize × V ≤ prize, so the
 * largest prize (hunter blocking: 153.8×) bounds every payout. A constant, so
 * importing the manifest solves nothing; the tests check it against every start.
 */
export const MAX_MULTIPLIER = 154;

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
export function autoChance(start: Start, target: number | null): number {
  if (target === null) return startChance(start);
  const key = `${start}/${target}`;
  const hit = hitTables.get(key);
  if (hit !== undefined) return hit;
  const v = table();
  const prize = prizeFor(start);
  const stops = (i: number) => autoStops(prize * v[i], target);
  const w = new Float64Array(v.length);
  for (const s of liveStates(board())) {
    const i = idx(s.runner, s.hunter);
    if (stops(i)) w[i] = 1;
  }
  const s0 = startState(start);
  const p = gaussSeidel(w, stops)[idx(s0.runner, s0.hunter)];
  hitTables.set(key, p);
  return p;
}
