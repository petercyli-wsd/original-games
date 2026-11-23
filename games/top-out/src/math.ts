// Top Out: four climbers go one at a time, shortest wall first, each until it
// hits its hidden slip. The highest climb wins; a tie goes to the EARLIER climber.
//
// The board. Wall k has N_k = 2, 4, 8, 16 holds. Each wall hides ONE slip at a
// uniform hold (drawn after place()). A climber at height h reaches for hold
// h + 1: safe unless that hold is the slip. A slip leaves the climber at the
// height already reached, so the final height F is uniform on {0, …, N − 1}.
// When only one hold is left above the climber (h = N − 1) it must be the slip:
// the climb stops there ("topped out") with no draw, so there is never a forced fall.
//
// Winning. Climber k wins iff F_k > F_j for every EARLIER j < k and
// F_k ≥ F_j for every LATER j > k (a later climber has to pass, not reach).
//
// Pricing (pattern 1, fixed prize). Walls are independent. Given the state, an
// unfinished wall at height h has F uniform on {h, …, N − 1} (surviving to h
// only says the slip is among the N − h holds still above), a finished wall has
// F fixed. So P(win | state) is a finite sum over the backed climber's final
// height f, computed here as an exact integer count over at most 2·4·8·16 = 1024
// equally likely slip layouts:
//   P(k wins | state) = Σ_f  Π_j  c_j(f) / Π_j size_j
// where c_k(f) = 1 for f in k's support, c_j(f) = #{F_j < f} for earlier j and
// #{F_j ≤ f} for later j. Start chances are 9/1024, 27/512, 123/512, 715/1024,
// prize = RTP / P(win), cash-out = prize × P(win | state). One reach changes the
// state by the true chance of its outcomes, so the cash-out is a martingale and
// by optional stopping every stopping rule returns exactly RTP. The backed wall
// is fixed before the bet, so no choice changes the value.
//
// The round stops the moment it is decided, i.e. when P(win) is exactly 0 or 1.

export const RTP = 0.99;
export const WALLS = [2, 4, 8, 16] as const;
export type Pick = 0 | 1 | 2 | 3;

export interface State {
  /** Height reached on each wall (0 = on the ground). */
  h: readonly number[];
  /** True once the climber on that wall has stopped (slipped or topped out). */
  done: readonly boolean[];
}

export const initState = (): State => ({ h: WALLS.map(() => 0), done: WALLS.map(() => false) });

/** The wall that climbs next (the first unfinished one), or -1 when all have stopped. */
export const activeWall = (s: State): number => s.done.indexOf(false);

/** The best height so far on any wall: the line to beat. */
export const markOf = (s: State): number => Math.max(...s.h);

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Integer win count and total over the equally likely slip layouts still possible. */
function counts(s: State, me: number): { num: number; den: number } {
  const lo = s.h;
  const hi = WALLS.map((N, j) => (s.done[j] ? s.h[j] : N - 1));
  const size = hi.map((x, j) => x - lo[j] + 1);
  const den = size.reduce((a, b) => a * b, 1);
  let num = 0;
  for (let f = lo[me]; f <= hi[me]; f++) {
    let prod = den / size[me];
    for (let j = 0; j < WALLS.length && prod > 0; j++) {
      if (j === me) continue;
      // Earlier climbers must be strictly below f, later ones at or below f.
      const c = j < me ? clamp(f - lo[j], 0, size[j]) : clamp(f + 1 - lo[j], 0, size[j]);
      prod = (prod / size[j]) * c;
    }
    num += prod;
  }
  return { num, den };
}

/** Exact P(the climber on wall `me` wins | state). */
export function winChance(s: State, me: number): number {
  const { num, den } = counts(s, me);
  return num / den;
}

export const startChance = (me: number) => winChance(initState(), me);
export const prizeOf = (me: number) => RTP / startChance(me);
export const MAX_MULTIPLIER = prizeOf(0);

/** 'won' / 'lost' once the round is decided (P exactly 1 or 0), else null. */
export function decided(s: State, me: number): 'won' | 'lost' | null {
  const { num, den } = counts(s, me);
  return num === 0 ? 'lost' : num === den ? 'won' : null;
}

export interface Reach {
  wall: number;
  /** Height before and after the reach. */
  from: number;
  to: number;
  /** 'reach' safe and still climbing, 'topped' safe and the next hold is the forced slip, 'slip' slipped. */
  kind: 'reach' | 'topped' | 'slip';
  /** The hold the climber reached for (1-based). */
  hold: number;
  /** The slip hold to mark red (slip and topped only). */
  slipHold: number | null;
  next: State;
}

/** One watched reach by the active wall, given the hidden final heights `F` (one slip per wall). */
export function reach(s: State, F: readonly number[]): Reach {
  const wall = activeWall(s);
  if (wall < 0) throw new Error('no climber left');
  const N = WALLS[wall];
  const from = s.h[wall];
  const hold = from + 1;
  const put = (to: number, stop: boolean): State => ({
    h: s.h.map((x, j) => (j === wall ? to : x)),
    done: s.done.map((x, j) => (j === wall ? stop : x)),
  });
  if (F[wall] === from) return { wall, from, to: from, kind: 'slip', hold, slipHold: hold, next: put(from, true) };
  if (hold === N - 1) return { wall, from, to: hold, kind: 'topped', hold, slipHold: N, next: put(hold, true) };
  return { wall, from, to: hold, kind: 'reach', hold, slipHold: null, next: put(hold, false) };
}

/** Chance that the next reach by the active wall is safe: a literal count of the holds above. */
export function safeChance(s: State): number {
  const w = activeWall(s);
  if (w < 0) return 0;
  const left = WALLS[w] - s.h[w];
  return left <= 1 ? 0 : (left - 1) / left;
}

/** The hidden final heights, one per wall, uniform on 0..N-1. */
export const drawSlips = (int: (n: number) => number): number[] => WALLS.map((N) => int(N));

export const volatilityOf = (p: number) => (p > 0.3 ? 'low' : p > 0.08 ? 'medium' : p > 0.02 ? 'high' : 'extreme') as 'low' | 'medium' | 'high' | 'extreme';
