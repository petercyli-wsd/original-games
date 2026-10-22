// Tumble: k cubes (k ∈ {1, 2, 3}) start with their red face on top. Each
// step, every cube tips over one of its four bottom edges, chosen uniformly
// and independently. After n steps (n ∈ {3, 5, 8, 12}) you win if every
// red face ends in the place you called: on top, on the bottom, or on a side.
//
// Where the red face sits is a 3-state Markov chain. Tipping a cube moves the
// top face to a side and that side to the bottom; the face opposite comes up.
//
//            top     side    bottom
//   top   [  0       1       0   ]
//   side  [  1/4     1/2     1/4 ]      (roll towards red: bottom; away: top)
//   bottom[  0       1       0   ]
//
// Its eigenvalues are 1, −1/2 and 0, so the m-step chance has a closed form.
// With m ≥ 1 steps left,
//
//   P(side) = 2/3 + 1/3·(−1/2)^m   from a side,
//   P(side) = 2/3 − 2/3·(−1/2)^m   from top or bottom,
//   P(top)  = P(bottom) = (1 − P(side)) / 2,
//
// (the 0 eigenvalue wipes out any top/bottom asymmetry after one roll), and
// with m = 0 it is just whether the face is there. The stationary law is
// (1/6, 2/3, 1/6). The table below is the matrix power itself, h_m = M·h_{m−1};
// the tests check it against the closed form.
//
// Pricing (fixed prize): the cubes are independent, so the round's win chance
// is the product of each cube's chance, P = Π h_m(place_i). The prize is
// RTP / P₀ and the cash-out is prize × P. One step of the chain averages h,
// and the cubes roll independently, so E[P after a step] = P now: the cash-out
// is a bounded martingale that starts at RTP, and by optional stopping every
// cash-out rule returns exactly RTP. A payout never exceeds the prize, so
// maxMultiplier is the largest prize the panel offers: three cubes, red on
// top (or bottom) after 3 rolls, P₀ = (1/8)³, prize 0.99 × 512 = 506.88×.
// Calling top, side or bottom before the bet only trades chance for prize.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

export const ROLLS = [3, 5, 8, 12] as const;
export type Rolls = (typeof ROLLS)[number];

export const CUBES = [1, 2, 3] as const;
export type Cubes = (typeof CUBES)[number];

export type Place = 'top' | 'side' | 'bottom';
export const PLACES: Place[] = ['top', 'side', 'bottom'];

/** Compass directions on the board (N is up on screen). */
export type Dir = 'N' | 'E' | 'S' | 'W';
export const DIRS: Dir[] = ['N', 'E', 'S', 'W'];
const OPPOSITE: Record<Dir, Dir> = { N: 'S', E: 'W', S: 'N', W: 'E' };

/** Where a cube's red face is: on top, on the bottom, or on one of the four sides. */
export type Face = 'top' | 'bottom' | Dir;

export const placeOf = (f: Face): Place => (f === 'top' || f === 'bottom' ? f : 'side');

/**
 * Tip the cube over its edge in direction d. The top face goes to side d,
 * side d goes to the bottom, the bottom comes up on the opposite side, and
 * the opposite side comes up on top. The two sides along the axis stay put.
 */
export function roll(f: Face, d: Dir): Face {
  if (f === 'top') return d;
  if (f === d) return 'bottom';
  if (f === 'bottom') return OPPOSITE[d];
  if (f === OPPOSITE[d]) return 'top';
  return f;
}

const IDX: Record<Place, number> = { top: 0, side: 1, bottom: 2 };

/** One step of the chain on a vector indexed [top, side, bottom]: (M·h). */
function step(h: readonly number[]): number[] {
  return [h[1], h[0] / 4 + h[1] / 2 + h[2] / 4, h[1]];
}

const MAX_ROLLS = 12;
const tables = new Map<Place, number[][]>();

/** rows[m][place] = chance the red face ends on `target` with m rolls to go (the matrix power M^m applied to the target indicator). */
export function table(target: Place): number[][] {
  const hit = tables.get(target);
  if (hit) return hit;
  const rows: number[][] = [PLACES.map((p) => (p === target ? 1 : 0))];
  for (let m = 1; m <= MAX_ROLLS; m++) rows.push(step(rows[m - 1]));
  tables.set(target, rows);
  return rows;
}

/** Chance one cube's red face ends on `target`, from `place` with `left` rolls to go. */
export const cubeChance = (place: Place, left: number, target: Place) => table(target)[left][IDX[place]];

/** Closed form of the same chance (eigenvalues 1, −1/2, 0). Used by the tests. */
export function closedForm(place: Place, left: number, target: Place): number {
  if (left === 0) return place === target ? 1 : 0;
  const r = (-0.5) ** left;
  const side = place === 'side' ? 2 / 3 + r / 3 : 2 / 3 - (2 / 3) * r;
  return target === 'side' ? side : (1 - side) / 2;
}

/** Where one cube's red face ends, from `place` with `left` rolls to go: [top, side, bottom], summing to 1. */
export const forecast = (place: Place, left: number): [number, number, number] =>
  [cubeChance(place, left, 'top'), cubeChance(place, left, 'side'), cubeChance(place, left, 'bottom')];

/** The round's win chance: every cube must end on the target (independent cubes multiply). */
export function winChance(faces: readonly Face[], left: number, target: Place): number {
  let p = 1;
  for (const f of faces) p *= cubeChance(placeOf(f), left, target);
  return p;
}

export const startFaces = (cubes: number): Face[] => Array.from({ length: cubes }, () => 'top' as Face);

/** Win chance when the bet is placed: every red face starts on top. */
export const startChance = (rolls: number, cubes: number, target: Place) => cubeChance('top', rolls, target) ** cubes;

export const prizeFor = (rolls: number, cubes: number, target: Place) => RTP / startChance(rolls, cubes, target);

/** Cash-out at a state: prize × the live win chance. */
export const cashAt = (prize: number, faces: readonly Face[], left: number, target: Place) => prize * winChance(faces, left, target);

export type Verdict = 'won' | 'lost' | null;

/**
 * The round ends early once its chance is exactly 0 or 1. Table entries that
 * are 0 or 1 are exact (they come from the indicator by copying, never by
 * averaging non-trivial values), so the comparison needs no tolerance.
 */
export function verdict(faces: readonly Face[], left: number, target: Place): Verdict {
  const p = winChance(faces, left, target);
  if (p === 0) return 'lost';
  if (p === 1) return 'won';
  return null;
}

/** The cube's chance after each of its four possible rolls; their average is its chance now. */
export const rollChances = (f: Face, left: number, target: Place): number[] =>
  DIRS.map((d) => (left > 0 ? cubeChance(placeOf(roll(f, d)), left - 1, target) : 0));

export function volatilityOf(p: number): Volatility {
  return p > 0.4 ? 'low' : p > 0.1 ? 'medium' : p > 0.015 ? 'high' : 'extreme';
}

/** A payout never exceeds the prize, so the largest prize over every setting bounds every payout. */
export const MAX_MULTIPLIER = Math.max(...ROLLS.flatMap((n) => CUBES.flatMap((k) => PLACES.map((t) => prizeFor(n, k, t)))));

export interface Config {
  rolls: Rolls;
  cubes: Cubes;
  target: Place;
}

export const VOLATILITY: Record<Volatility, Config> = {
  low: { rolls: 5, cubes: 1, target: 'side' },
  medium: { rolls: 5, cubes: 1, target: 'top' },
  high: { rolls: 8, cubes: 2, target: 'top' },
  extreme: { rolls: 5, cubes: 3, target: 'top' },
};
