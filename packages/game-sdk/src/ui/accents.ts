// The accent palette from docs/STYLE.md. Each game picks exactly one, uses it
// for GameLayout's `accent` and its manifest's `accent`, and for nothing but the
// player's own piece or choice on the board. None is close to the fixed win
// green or lose red, so an accent never reads as an outcome.

export const ACCENTS = {
  blue: '#7b93ff',
  violet: '#a78bfa',
  sky: '#5ec4e6',
  amber: '#e6b450',
  pink: '#e879b9',
  sand: '#c9b28f',
} as const;

export type AccentName = keyof typeof ACCENTS;
