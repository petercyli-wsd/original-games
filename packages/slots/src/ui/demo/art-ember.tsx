// Demo symbol art: "Cinder Peak", a volcano theme. A different palette (ash, lava, a gold highlight, violet
// obsidian) and different shapes (mountain, egg, kite gem, flame, mask) on the same kit.

import type { ReactElement } from 'react';
import type { SlotSymbols, SlotTheme } from '../types';

export const EMBER = {
  night: '#1a0f12',
  frame: '#5a2a1e',
  tile: '#2c1a1a',
  gold: '#ffd23f',
  lava: '#ff5a2c',
  ash: '#c9b8a8',
  obsidian: '#8a5cd6',
} as const;
const C = EMBER;

const svg = (size: number, body: ReactElement) => (
  <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
    {body}
  </svg>
);

export const emberTheme: SlotTheme = {
  name: 'Cinder Peak',
  palette: { bg: C.night, frame: C.frame, tile: C.tile, colors: [C.gold, C.lava, C.ash, C.obsidian], ink: C.gold },
  window: { cell: 'tile', separators: 'gap', frameWidth: 6, radius: 4, cellRadius: 3 },
};

export const emberSymbols: SlotSymbols = {
  // Scatter: the volcano
  1: {
    name: 'Volcano',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M6 90 L36 30 H64 L94 90 Z" fill={C.ash} />
          <path d="M34 34 H66 L60 44 L50 38 L40 46 Z" fill={C.lava} />
          <path d="M44 30 L38 12 L50 22 L56 6 L60 30 Z" fill={C.gold} />
          <path d="M30 90 L42 62 L50 90 M58 90 L66 70 L72 90" fill="none" stroke={C.lava} strokeWidth="5" strokeLinejoin="round" />
        </>,
      ),
  },
  // Wild: a gold eye
  2: {
    name: 'Dragon eye',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M4 50 Q50 6 96 50 Q50 94 4 50 Z" fill={C.gold} />
          <circle cx="50" cy="50" r="19" fill={C.lava} />
          <rect x="45" y="34" width="10" height="32" rx="5" fill={C.night} />
        </>,
      ),
  },
  // P1: dragon egg, a tall oval with cracks
  3: {
    name: 'Dragon egg',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M50 6 C74 6 84 50 84 66 C84 84 68 94 50 94 C32 94 16 84 16 66 C16 50 26 6 50 6 Z" fill={C.lava} />
          <path d="M26 54 L38 62 L46 48 L56 64 L66 50 L76 60" fill="none" stroke={C.gold} strokeWidth="5" strokeLinejoin="round" strokeLinecap="round" />
          <circle cx="40" cy="80" r="5" fill={C.gold} />
          <circle cx="62" cy="78" r="4" fill={C.gold} />
        </>,
      ),
  },
  // P2: crystal, a tall kite
  4: {
    name: 'Obsidian crystal',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M50 4 L82 36 L50 96 L18 36 Z" fill={C.obsidian} />
          <path d="M50 4 L66 36 L50 96 L34 36 Z" fill={C.gold} />
          <path d="M18 36 H82" stroke={C.night} strokeWidth="3.5" />
        </>,
      ),
  },
  // P3: flame, a teardrop with a notch
  5: {
    name: 'Flame',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M52 4 C56 24 82 38 82 64 C82 84 68 96 50 96 C32 96 18 84 18 64 C18 52 24 44 30 38 C30 50 36 54 40 54 C38 34 44 18 52 4 Z" fill={C.lava} />
          <path d="M50 46 C58 58 66 62 66 74 C66 84 58 90 50 90 C42 90 34 84 34 74 C34 64 44 60 50 46 Z" fill={C.gold} />
        </>,
      ),
  },
  // P4: stone mask, a square face
  6: {
    name: 'Stone mask',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M16 10 H84 V62 L66 92 H34 L16 62 Z" fill={C.ash} />
          <path d="M26 34 L44 40 L44 50 L26 46 Z M74 34 L56 40 L56 50 L74 46 Z" fill={C.night} />
          <path d="M40 72 H60" stroke={C.night} strokeWidth="6" strokeLinecap="round" />
          <path d="M16 10 L30 24 M84 10 L70 24" stroke={C.lava} strokeWidth="6" strokeLinecap="round" />
        </>,
      ),
  },
  // L1: rock, an irregular slab
  7: {
    name: 'Rock',
    render: (s) => svg(s, <path d="M12 72 L24 36 L48 22 L78 34 L90 62 L72 84 L30 86 Z" fill={C.ash} />),
  },
  // L2: hot coal, a rounded block with cracks
  8: {
    name: 'Hot coal',
    render: (s) =>
      svg(
        s,
        <>
          <rect x="16" y="16" width="68" height="68" rx="14" fill={C.lava} />
          <path d="M30 30 L48 46 L44 62 L62 74 M56 28 L66 40" fill="none" stroke={C.night} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        </>,
      ),
  },
  // L3: ash cloud
  9: {
    name: 'Ash cloud',
    render: (s) =>
      svg(
        s,
        <>
          <circle cx="32" cy="58" r="20" fill={C.ash} />
          <circle cx="56" cy="44" r="24" fill={C.ash} />
          <circle cx="72" cy="64" r="16" fill={C.ash} />
          <rect x="22" y="62" width="58" height="18" fill={C.ash} />
        </>,
      ),
  },
  // L4: spark, a four-point star
  10: {
    name: 'Spark',
    render: (s) => svg(s, <path d="M50 6 L60 40 L94 50 L60 60 L50 94 L40 60 L6 50 L40 40 Z" fill={C.gold} />),
  },
  // Orb: carries a multiplier badge
  11: {
    name: 'Fire orb',
    render: (s) =>
      svg(
        s,
        <>
          <circle cx="50" cy="50" r="40" fill={C.gold} />
          <circle cx="50" cy="50" r="27" fill={C.lava} />
        </>,
      ),
  },
};
