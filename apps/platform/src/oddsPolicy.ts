// Operator policy for the odds readout. See docs/STYLE.md section 6.
// Only the 'ladder' and 'paytable' groups may be hidden by the operator;
// every other group always shows its probability numbers.

import type { OddsReadout } from '@originals/game-sdk';

export type OddsGroup = 'input' | 'choice' | 'timing' | 'ladder' | 'paytable' | 'table' | 'skill';

/** Groups an operator may switch off. */
export const HIDEABLE_GROUPS: readonly OddsGroup[] = ['ladder', 'paytable'];

const groups: Record<OddsGroup, string[]> = {
  // The chance is what the player sets, or the whole point of the game.
  input: ['dice', 'limbo', 'range-dice', 'drift', 'half-moon', 'lighthouse', 'line-cut', 'slice', 'needle', 'template', 'knight', 'overhang', 'pivot', 'snowball', 'records', 'prime-time', 'polarizer', 'quadrant'],
  // The player picks between options whose odds differ.
  choice: [
    'back-to-back', 'bracket', 'break-point', 'cross', 'derby', 'derby-v2', 'full-set', 'homecoming', 'hot-potato', 'inning',
    'landing', 'last-slice', 'last-wicket', 'last-wicket-v2', 'majority', 'maze', 'pascal', 'penney', 'scales', 'seven-out',
    'shootout', 'showdown', 'shut', 'sixes', 'socks', 'stepladder', 'stepladder-v2', 'tally', 'thales', 'tumble', 'upsets',
    'hilo', 'snake', 'banker', 'bank-it', 'card-duel', 'noughts', 'shells',
  ],
  // Shared, timed rounds: the number is tied to the target.
  timing: ['crash', 'crash-colours', 'leverage'],
  // Push-your-luck ladders: the rising multiplier encodes the odds.
  ladder: ['mines', 'chicken', 'tower', 'pump', 'coin-flip', 'rps', 'snakes', 'chase-v2', 'convex', 'crocodile-dentist', 'shunt'],
  // One draw from a discrete paytable: per-outcome chances.
  paytable: ['plinko', 'booster', 'keno', 'wheel', 'diamonds', 'cases', 'darts', 'tarot', 'tile-pick', 'reels', 'respins'],
  // Land-casino layouts.
  table: ['roulette', 'strip-roulette', 'baccarat', 'craps', 'sic-bo', 'dragon-tiger'],
  // The chance depends on the player's decisions.
  skill: ['blackjack', 'video-poker'],
};

export const ODDS_GROUPS: Record<string, OddsGroup> = Object.fromEntries(
  (Object.entries(groups) as [OddsGroup, string[]][]).flatMap(([group, ids]) => ids.map((id) => [id, group])),
);

/** The operator's wish, from VITE_ODDS_READOUT ('off' hides where allowed; anything else is 'on'). */
export function operatorOddsReadout(raw: string | undefined = import.meta.env.VITE_ODDS_READOUT): OddsReadout {
  return raw?.trim().toLowerCase() === 'off' ? 'off' : 'on';
}

/** The value a game actually gets: 'off' only for hideable groups, and unknown games stay 'on'. */
export function resolveOddsReadout(gameId: string, operator: OddsReadout = operatorOddsReadout()): OddsReadout {
  const group = ODDS_GROUPS[gameId];
  return operator === 'off' && group && HIDEABLE_GROUPS.includes(group) ? 'off' : 'on';
}
