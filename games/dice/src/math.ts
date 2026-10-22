// Dice (Stake, BC.Game, Roobet, Shuffle, Rainbet…): a result r is drawn
// uniformly from [0, 100). "Roll over t" wins when r > t, "roll under t" when
// r < t, so the win chance is exactly the green share of the track. The payout
// is RTP / chance, which makes every target worth exactly RTP: the player's
// target only sets the volatility.

export const RTP = 0.99;

/** Targets are kept to 2 decimals and inside [MIN_CHANCE, MAX_CHANCE] of win chance. */
export const MIN_CHANCE = 0.01;
export const MAX_CHANCE = 98;

export type Direction = 'over' | 'under';

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Win chance in percent for a target and direction. */
export const chanceOf = (target: number, dir: Direction) => (dir === 'over' ? 100 - target : target);

/** Target that gives a win chance (percent). */
export const targetFor = (chance: number, dir: Direction) => round2(dir === 'over' ? 100 - chance : chance);

export const clampChance = (c: number) => Math.min(MAX_CHANCE, Math.max(MIN_CHANCE, round2(c)));

/** Payout multiplier for a win chance in percent. */
export const multiplierFor = (chance: number) => (RTP * 100) / chance;

/** Win chance (percent) for a desired multiplier. */
export const chanceForMultiplier = (mult: number) => clampChance((RTP * 100) / mult);

export const MAX_MULTIPLIER = multiplierFor(MIN_CHANCE);

/** One roll: the result, to 2 decimals for display, and whether it wins. */
export function roll(u: number, target: number, dir: Direction) {
  const r = u * 100;
  const win = dir === 'over' ? r > target : r < target;
  return { result: Math.floor(r * 100) / 100, raw: r, win };
}
