// Snowball: a Pólya urn. The urn starts with `blue` balls of the player's
// colour and `red` of the House's. Each draw picks a ball uniformly, then puts
// it back with a twin of the same colour, so whichever colour is ahead tends to
// stay ahead ("snowballs"). After N draws the player wins if blue holds a strict
// majority. Every preset starts with an even total and N is odd, so the final
// urn holds an odd number of balls and a tie is impossible.
//
// The number of blue balls among the next n draws is BetaBinomial(n, blue, red),
// which gives P(win) exactly. The prize is M = RTP / P0 and the cash-out value
// at any point is M × P_t. P_t is a martingale (the probability of an event
// given everything seen so far), so every stopping strategy returns exactly RTP.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

export type Colour = 'blue' | 'red';

export interface Preset {
  name: string;
  blue: number;
  red: number;
  volatility: Volatility;
  blurb: string;
}

export const PRESETS = {
  favourite: { name: 'Favourite', blue: 3, red: 1, volatility: 'low', blurb: 'Start 3 to 1 up. Small, steady wins.' },
  calm: { name: 'Calm', blue: 10, red: 10, volatility: 'medium', blurb: 'Big even urn. The lead moves slowly.' },
  wild: { name: 'Wild', blue: 1, red: 1, volatility: 'medium', blurb: 'One each. The first draws decide a lot.' },
  underdog: { name: 'Underdog', blue: 1, red: 3, volatility: 'high', blurb: 'Start 1 to 3 down. Comebacks pay.' },
  longshot: { name: 'Longshot', blue: 1, red: 5, volatility: 'extreme', blurb: 'Start 1 to 5 down. Rare, huge wins.' },
} satisfies Record<string, Preset>;

export type PresetId = keyof typeof PRESETS;
export const PRESET_IDS = Object.keys(PRESETS) as PresetId[];

/** Number of draws per round. Odd, so (with even starting totals) ties can't happen. */
export const PACES = [11, 21, 41] as const;
export type Pace = (typeof PACES)[number];

/** BetaBinomial(n, a, b) pmf for k = 0..n, built with the ratio recurrence. */
export function betaBinomialPmf(n: number, a: number, b: number): number[] {
  const pmf = new Array<number>(n + 1);
  // P(0) = Π (b+i)/(a+b+i): n reds in a row.
  let p = 1;
  for (let i = 0; i < n; i++) p *= (b + i) / (a + b + i);
  pmf[0] = p;
  for (let k = 0; k < n; k++) {
    p *= ((n - k) / (k + 1)) * ((a + k) / (b + n - k - 1));
    pmf[k + 1] = p;
  }
  return pmf;
}

/** Fewest of the remaining `left` draws that must be blue for a strict blue majority. */
export function blueNeeded(blue: number, red: number, left: number): number {
  // Final blue = blue + k, final red = red + left - k; need blue + k > red + left - k.
  return Math.floor((red - blue + left) / 2) + 1;
}

/** Exact P(blue ends with a strict majority) from the current urn with `left` draws to go. */
export function winProbability(blue: number, red: number, left: number): number {
  const need = blueNeeded(blue, red, left);
  if (need <= 0) return 1;
  if (need > left) return 0;
  const pmf = betaBinomialPmf(left, blue, red);
  let sum = 0;
  for (let k = need; k <= left; k++) sum += pmf[k];
  return Math.min(1, sum);
}

/** Pays this multiple of the bet when blue wins outright. */
export function prize(id: PresetId, draws: number): number {
  const { blue, red } = PRESETS[id];
  return RTP / winProbability(blue, red, draws);
}

/** Cash-out multiplier with the urn at (blue, red) and `left` draws to go: M × P_t. */
export function cashMultiplier(id: PresetId, draws: number, blue: number, red: number, left: number): number {
  return prize(id, draws) * winProbability(blue, red, left);
}

export const maxMultiplier = () => Math.max(...PRESET_IDS.flatMap((id) => PACES.map((n) => prize(id, n))));

/** Draws one ball: index into an urn of `blue + red` balls; the first `blue` are blue. */
export const drawColour = (blue: number, red: number, u: number): Colour => (u * (blue + red) < blue ? 'blue' : 'red');
