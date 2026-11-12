// Last Wicket: a one-wicket run chase. You need `need` runs from `balls` balls.
// Before every ball you pick a wheel of 12 equal sectors:
//   Block: 1 Out, 6 x "1", 5 x "2"    (safe, slow)
//   Swing: 4 Out, 2 x "0", 3 x "4", 3 x "6"   (risky, fast)
// An Out loses the round (one wicket). Runs reduce `need`; win when need hits 0.
// With no balls left and runs still needed the round is lost.
//
// V(r, b) = best-play chance of making r runs in b balls (a Bellman DP over
// at most 40 x 12 states, exact):
//   V(0, b) = 1,  V(r, 0) = 0 for r > 0,
//   V(r, b) = max over wheels w of  W(w, r, b),
//   W(w, r, b) = (1/12) * sum over the non-Out sectors x of V(max(0, r - x), b - 1).
//
// Pricing (fixed prize with relock, as in Shut): prize = RTP / V(k, balls).
// The cash-out at any state is prize * V(state). The best wheel keeps the
// prize: the average of prize * V(next) over its 12 sectors is exactly
// prize * V(now) (Bellman). Picking the other wheel relocks the prize at
// prize * V(now) / W(that wheel), so the cash-out is unchanged at the moment
// of choosing: the choice moves volatility, never value. A relock above
// MAX_WIN, or onto a wheel that cannot win at all, is refused. By optional
// stopping every strategy returns exactly RTP.
//
// Out of reach: when r > 6 * b even six off every ball cannot win, so V = 0.
// The round ends there as a loss after the ball that caused it, as plain
// arithmetic on two numbers on the board.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;
export const MAX_WIN = 10_000;
export const MAX_MULTIPLIER = MAX_WIN;

export type Wheel = 'block' | 'swing';
/** -1 is the Out sector; otherwise the runs the ball scores. */
export const OUT = -1;
export const WHEELS: Record<Wheel, readonly number[]> = {
  block: [OUT, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1],
  swing: [OUT, 4, 6, OUT, 0, 4, OUT, 6, 0, OUT, 4, 6],
};
export const WHEEL_NAMES: Wheel[] = ['block', 'swing'];
export const outsIn = (w: Wheel) => WHEELS[w].filter((x) => x === OUT).length;

/** The chase settings: runs needed and balls to get them. */
export const SETTINGS = [
  { k: 8, balls: 5 },
  { k: 14, balls: 7 },
  { k: 26, balls: 10 },
  { k: 40, balls: 12 },
] as const;
export type Setting = (typeof SETTINGS)[number];

const RMAX = 40;
const BMAX = 12;

export interface State {
  need: number;
  balls: number;
}

let table: number[][] | null = null;
/** V[b][r] under best play. */
function winTable(): number[][] {
  if (table) return table;
  const V: number[][] = [];
  for (let b = 0; b <= BMAX; b++) {
    V.push([]);
    for (let r = 0; r <= RMAX; r++) V[b].push(r === 0 ? 1 : 0);
  }
  for (let b = 1; b <= BMAX; b++) for (let r = 1; r <= RMAX; r++) V[b][r] = Math.max(wheelValueIn(V, 'block', r, b), wheelValueIn(V, 'swing', r, b));
  table = V;
  return V;
}

function wheelValueIn(V: number[][], w: Wheel, r: number, b: number): number {
  let s = 0;
  for (const x of WHEELS[w]) if (x !== OUT) s += V[b - 1][Math.max(0, r - x)];
  return s / 12;
}

export const winChance = (s: State) => (s.need <= 0 ? 1 : s.balls <= 0 ? 0 : winTable()[s.balls][s.need]);

/** Chance of winning if you pick this wheel for the next ball (best play after). */
export const wheelChance = (w: Wheel, s: State) => (s.need <= 0 ? 1 : s.balls <= 0 ? 0 : wheelValueIn(winTable(), w, s.need, s.balls));

export const startState = (st: Setting): State => ({ need: st.k, balls: st.balls });
export const prize = (st: Setting) => RTP / winChance(startState(st));

/** The state after a ball scoring `runs` (not an Out). */
export const after = (s: State, runs: number): State => ({ need: Math.max(0, s.need - runs), balls: s.balls - 1 });

/** Even six off every remaining ball cannot make the runs. */
export const outOfReach = (s: State) => s.need > 0 && s.need > 6 * s.balls;

const EPS = 1e-12;
/** The best wheel (Block on a tie). */
export function bestWheel(s: State): Wheel {
  return wheelChance('swing', s) > wheelChance('block', s) + EPS ? 'swing' : 'block';
}

/**
 * The prize after picking `w`: unchanged on the best wheel, relocked on the
 * other. Null if that wheel cannot win or the new prize would exceed MAX_WIN.
 */
export function relock(prizeNow: number, s: State, w: Wheel): number | null {
  const best = winChance(s);
  const here = wheelChance(w, s);
  if (here >= best - EPS) return prizeNow;
  if (here <= 0) return null;
  const next = (prizeNow * best) / here;
  return next > MAX_WIN ? null : next;
}

/** Stake multiples cashed out at a live state. */
export const cashOut = (prizeNow: number, s: State) => prizeNow * winChance(s);

export type Tint = 'up' | 'down' | 'same';
/** How a sector changes your chance (best play after it, against now). */
export function sectorTint(s: State, x: number): Tint {
  const now = winChance(s);
  const next = x === OUT ? 0 : winChance(after(s, x));
  return next > now + EPS ? 'up' : next < now - EPS ? 'down' : 'same';
}

export function volatilityOf(st: Setting): Volatility {
  const p = winChance(startState(st));
  return p > 0.3 ? 'low' : p > 0.12 ? 'medium' : p > 0.04 ? 'high' : 'extreme';
}

export const need = (s: State) => s.need;
export const perBall = (s: State) => (s.balls > 0 ? s.need / s.balls : 0);
