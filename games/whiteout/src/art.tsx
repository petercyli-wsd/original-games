// Whiteout: theme and symbol art. Original flat vector shapes on a 100 x 100 grid (docs/SLOT-STYLE.md §3).
// Alpine signage style: glacier white, ice blue, dusk pink, warning orange on alpine navy and rock grey.
// Every colour here is a palette colour (the four theme colours plus the bg, frame and tile tones).

import type { ReactElement } from 'react';
import type { SlotSymbols, SlotTheme } from '@originals/slots/ui';

export const WHITEOUT = {
  navy: '#023047', // bg
  rock: '#5C677D', // frame
  tile: '#0A3F5C', // tile
  orange: '#FB8500', // colors[0]: the win highlight, and the beacon / flag
  white: '#F1F7FB',
  ice: '#8ECAE6',
  pink: '#E5989B',
} as const;
const C = WHITEOUT;

const svg = (size: number, body: ReactElement) => (
  <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
    {body}
  </svg>
);

export const whiteoutTheme: SlotTheme = {
  name: 'Whiteout',
  palette: {
    bg: C.navy,
    frame: C.rock,
    tile: C.tile,
    colors: [C.orange, C.white, C.ice, C.pink],
    ink: C.white,
    // The storm: a flat swap to a near-black dusk window in a pink frame (symbols stay the same).
    featureBg: '#0B1220',
    featureFrame: C.pink,
    featureTile: '#17233A',
  },
  window: { cell: 'tile', separators: 'gap', frameWidth: 8, radius: 4, cellRadius: 3 },
};

export const whiteoutSymbols: SlotSymbols = {
  // Scatter: the avalanche beacon, a rescue transceiver with signal arcs
  1: {
    name: 'Avalanche beacon',
    render: (s) =>
      svg(
        s,
        <>
          <rect x="24" y="32" width="52" height="62" rx="8" fill={C.orange} />
          <rect x="34" y="42" width="32" height="22" rx="3" fill={C.navy} />
          <circle cx="50" cy="79" r="7" fill={C.white} />
          <path d="M62 32 V16" stroke={C.white} strokeWidth="6" strokeLinecap="round" />
          <path d="M72 24 Q80 14 72 6 M82 28 Q94 14 82 2" fill="none" stroke={C.white} strokeWidth="4" strokeLinecap="round" />
          <path d="M40 53 H60" stroke={C.orange} strokeWidth="5" strokeLinecap="round" />
        </>,
      ),
  },
  // Wild: the snow cornice, an overhanging lip with icicles (wide and low)
  2: {
    name: 'Snow cornice',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M4 34 Q24 12 52 20 Q82 26 96 46 Q86 58 74 52 Q62 62 50 54 Q38 64 26 54 Q14 60 4 50 Z" fill={C.white} />
          <path d="M20 54 L26 80 L32 54 Z M44 56 L50 90 L56 56 Z M66 54 L72 74 L78 52 Z" fill={C.ice} />
          <path d="M14 36 Q30 22 50 28" fill="none" stroke={C.ice} strokeWidth="5" strokeLinecap="round" />
        </>,
      ),
  },
  // P1 (top pay): the summit marker, a pole with a pennant on a peak
  3: {
    name: 'Summit flag',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M6 94 L50 38 L94 94 Z" fill={C.white} />
          <path d="M50 38 L94 94 H62 Z" fill={C.ice} />
          <path d="M50 38 V8" stroke={C.pink} strokeWidth="6" strokeLinecap="round" />
          <path d="M53 10 L88 20 L53 32 Z" fill={C.orange} />
          <path d="M34 62 L46 54 L52 64 L60 56" fill="none" stroke={C.navy} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        </>,
      ),
  },
  // P2: the lammergeier, a vulture with broad wings (wide wedge)
  4: {
    name: 'Lammergeier',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M4 34 Q28 24 50 44 Q72 24 96 34 Q82 56 62 62 L50 90 L38 62 Q18 56 4 34 Z" fill={C.pink} />
          <path d="M4 34 L22 46 L12 56 Z M96 34 L78 46 L88 56 Z" fill={C.rock} />
          <circle cx="50" cy="48" r="13" fill={C.white} />
          <path d="M50 48 L62 54 L50 60 Z" fill={C.orange} />
          <circle cx="46" cy="45" r="3" fill={C.navy} />
        </>,
      ),
  },
  // P3: the mountain hut, a pointed A-frame roof
  5: {
    name: 'Mountain hut',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M50 8 L96 52 H4 Z" fill={C.orange} />
          <rect x="16" y="52" width="68" height="40" fill={C.white} />
          <rect x="42" y="64" width="16" height="28" fill={C.rock} />
          <rect x="22" y="60" width="14" height="12" fill={C.ice} />
          <rect x="66" y="60" width="14" height="12" fill={C.ice} />
          <rect x="70" y="14" width="10" height="22" fill={C.pink} />
        </>,
      ),
  },
  // P4: the ibex, a head with long curved horns
  6: {
    name: 'Ibex',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M38 40 C30 30 18 24 14 4 C34 8 48 22 50 38 Z M62 40 C70 30 82 24 86 4 C66 8 52 22 50 38 Z" fill={C.ice} />
          <path d="M26 20 L34 16 M34 30 L42 26" stroke={C.tile} strokeWidth="3.5" strokeLinecap="round" />
          <path d="M74 20 L66 16 M66 30 L58 26" stroke={C.tile} strokeWidth="3.5" strokeLinecap="round" />
          <path d="M28 40 H72 L62 74 L56 92 H44 L38 74 Z" fill={C.white} />
          <path d="M28 40 L18 54 L34 54 Z M72 40 L82 54 L66 54 Z" fill={C.pink} />
          <circle cx="42" cy="54" r="4" fill={C.navy} />
          <circle cx="58" cy="54" r="4" fill={C.navy} />
          <path d="M44 84 H56" stroke={C.rock} strokeWidth="6" strokeLinecap="round" />
        </>,
      ),
  },
  // L1: snowflake, six arms
  7: {
    name: 'Snowflake',
    render: (s) => (
      svg(
        s,
        <path d="M50 10 V90 M15 30 L85 70 M15 70 L85 30 M38 16 L50 28 L62 16 M38 84 L50 72 L62 84" fill="none" stroke={C.white} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />,
      )
    ),
  },
  // L2: ice crystal, a tall hexagonal prism
  8: {
    name: 'Ice crystal',
    render: (s) => svg(s, <path d="M50 6 L78 24 V76 L50 94 L22 76 V24 Z" fill={C.ice} />),
  },
  // L3: pine sprig, stacked boughs
  9: {
    name: 'Pine sprig',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M50 8 L74 40 H60 L84 70 H16 L40 40 H26 Z" fill={C.ice} />
          <rect x="44" y="70" width="12" height="22" fill={C.rock} />
        </>,
      ),
  },
  // L4: ski pole basket, a ring on a shaft
  10: {
    name: 'Pole basket',
    render: (s) => (
      svg(
        s,
        <>
          <path d="M50 6 V94" stroke={C.rock} strokeWidth="8" strokeLinecap="round" />
          <circle cx="50" cy="64" r="26" fill="none" stroke={C.white} strokeWidth="8" />
          <path d="M24 64 H76" stroke={C.white} strokeWidth="6" />
        </>,
      )
    ),
  },
  // L5: snow boot print, a sole with treads
  11: {
    name: 'Boot print',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M30 6 H64 Q76 6 74 24 L70 44 H34 L26 24 Q24 6 30 6 Z" fill={C.pink} />
          <path d="M34 54 H68 L70 70 Q68 94 50 94 Q32 94 32 70 Z" fill={C.pink} />
          <path d="M36 18 H64 M36 32 H64 M40 70 H60" stroke={C.tile} strokeWidth="5" strokeLinecap="round" />
        </>,
      ),
  },
  // L6: ice axe, a T head on a long shaft
  12: {
    name: 'Ice axe',
    render: (s) => (
      svg(
        s,
        <>
          <path d="M50 28 V94" stroke={C.rock} strokeWidth="9" strokeLinecap="round" />
          <path d="M10 40 Q28 14 50 22 Q72 14 90 40 Q74 28 50 32 Q26 28 10 40 Z" fill={C.white} />
        </>,
      )
    ),
  },
};
