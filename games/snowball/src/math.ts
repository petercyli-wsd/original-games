// Snowball: a Pólya urn race. The urn starts with `blue` balls of the player's
// colour and `red` of the House's. Each draw picks a ball uniformly, then puts
// it back with a twin of the same colour, so whichever colour is drawn more
// tends to keep being drawn ("snowballs"). A round is DRAWS = 11 draws and blue
// wins if most of them are blue, i.e. blue is first to MAJORITY = 6 draws. DRAWS
// is odd, so there are no ties, and the round ends as soon as either colour
// reaches 6 (the rest could not change the result).
//
// With the urn at (blue, red), the number of blue balls among the next n draws
// is BetaBinomial(n, blue, red) (Pólya's urn theorem), so
//   P(win | state) = P(BetaBinomial(left, blue, red) >= blue still needed)
// exactly. The prize is M = RTP / P0 and the cash-out value at any point is
// M × P_t. P_t is the probability of a fixed event given everything seen so
// far, hence a martingale, and by optional stopping every strategy returns
// exactly RTP.

import type { Volatility } from '@originals/game-sdk';

export const RTP = 0.99;

/** Draws per round. Odd, so one colour always has a strict majority. */
export const DRAWS = 11;
/** Blue draws needed to win: a strict majority of DRAWS. */
export const MAJORITY = (DRAWS + 1) / 2;

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
  calm: { name: 'Calm', blue: 10, red: 10, volatility: 'medium', blurb: 'Big even urn. Twins barely tilt it.' },
  wild: { name: 'Wild', blue: 1, red: 1, volatility: 'medium', blurb: 'One each. Every twin tilts it hard.' },
  underdog: { name: 'Underdog', blue: 1, red: 3, volatility: 'high', blurb: 'Start 1 to 3 down. Comebacks pay.' },
  longshot: { name: 'Longshot', blue: 1, red: 7, volatility: 'extreme', blurb: 'Start 1 to 7 down. Rare, huge wins.' },
} satisfies Record<string, Preset>;

export type PresetId = keyof typeof PRESETS;
export const PRESET_IDS = Object.keys(PRESETS) as PresetId[];

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

/** What the tally shows after `blueDrawn` blue and `redDrawn` red draws. */
export function tally(blueDrawn: number, redDrawn: number) {
  return {
    /** Blue draws still needed to reach the majority (0 = blue has won). */
    blueNeeds: Math.max(0, MAJORITY - blueDrawn),
    /** Red draws still needed (0 = red has won). */
    redNeeds: Math.max(0, MAJORITY - redDrawn),
    /** Empty tally slots: draws not made yet. */
    left: DRAWS - blueDrawn - redDrawn,
  };
}

/** Exact P(at least `need` of the next `left` draws are blue) from an urn of blue:red. */
export function winProbability(blue: number, red: number, need: number, left: number): number {
  if (need <= 0) return 1;
  if (need > left) return 0;
  const pmf = betaBinomialPmf(left, blue, red);
  let sum = 0;
  for (let k = need; k <= left; k++) sum += pmf[k];
  return Math.min(1, sum);
}

/** The urn after some draws: every drawn ball added a twin of its colour. */
export function urnAfter(id: PresetId, blueDrawn: number, redDrawn: number) {
  const { blue, red } = PRESETS[id];
  return { blue: blue + blueDrawn, red: red + redDrawn };
}

/** Exact P(blue wins) after `blueDrawn` blue and `redDrawn` red draws. */
export function winChance(id: PresetId, blueDrawn: number, redDrawn: number): number {
  const { blue, red } = urnAfter(id, blueDrawn, redDrawn);
  const { blueNeeds, left } = tally(blueDrawn, redDrawn);
  if (redDrawn >= MAJORITY) return 0;
  return winProbability(blue, red, blueNeeds, left);
}

const prizeCache = new Map<PresetId, number>();
/** Pays this multiple of the bet when blue wins. */
export function prize(id: PresetId): number {
  let m = prizeCache.get(id);
  if (m === undefined) prizeCache.set(id, (m = RTP / winChance(id, 0, 0)));
  return m;
}

/** Cash-out multiplier after `blueDrawn` blue and `redDrawn` red draws: M × P_t. */
export function cashMultiplier(id: PresetId, blueDrawn: number, redDrawn: number): number {
  return prize(id) * winChance(id, blueDrawn, redDrawn);
}

export const maxMultiplier = () => Math.max(...PRESET_IDS.map(prize));

/** Draws one ball: index into an urn of `blue + red` balls; the first `blue` are blue. */
export const drawColour = (blue: number, red: number, u: number): Colour => (u * (blue + red) < blue ? 'blue' : 'red');
