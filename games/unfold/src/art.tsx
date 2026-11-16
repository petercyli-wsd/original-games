// Unfold: a quiet paper world. Symbols are folded washi in flat tones with crisp fold lines (no outlines).
// Palette: washi cream, sumi ink, vermilion, indigo, teal, gold foil. Every colour below is a palette colour.

import type { ReactElement } from 'react';
import type { SlotSymbols, SlotTheme } from '@originals/slots/ui';

export const PAPER = {
  ink: '#2B2D42', // window background, fold lines
  inkTile: '#363952', // tile tone (a step up from the ink)
  indigo: '#3D5A80', // frame
  gold: '#E9C46A', // win highlight, wild
  vermilion: '#E4572E',
  teal: '#2A9D8F',
  cream: '#F6F1E7',
  // Feature (the Great Fold): a deep teal night
  fBg: '#173B3F',
  fFrame: '#2A9D8F',
  fTile: '#1F4A4E',
} as const;
const C = PAPER;

const svg = (size: number, body: ReactElement) => (
  <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
    {body}
  </svg>
);

export const unfoldTheme: SlotTheme = {
  name: 'Unfold',
  palette: {
    bg: C.ink,
    frame: C.indigo,
    tile: C.inkTile,
    colors: [C.gold, C.vermilion, C.teal, C.cream],
    ink: C.cream,
    featureBg: C.fBg,
    featureFrame: C.fFrame,
    featureTile: C.fTile,
  },
  // Soft fold lines between reels instead of bars: thin gap, small radii.
  window: { cell: 'tile', separators: 'gap', frameWidth: 6, radius: 6, cellRadius: 4 },
};

export const unfoldSymbols: SlotSymbols = {
  // Scatter: the folded sun, a radiating paper medallion
  1: {
    name: 'Folded sun',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M50 6 L60 26 L82 18 L74 40 L94 50 L74 60 L82 82 L60 74 L50 94 L40 74 L18 82 L26 60 L6 50 L26 40 L18 18 L40 26 Z" fill={C.vermilion} />
          <circle cx="50" cy="50" r="24" fill={C.gold} />
          <path d="M50 26 V74 M26 50 H74" stroke={C.vermilion} strokeWidth="4" strokeLinecap="round" />
          <circle cx="50" cy="50" r="9" fill={C.cream} />
        </>,
      ),
  },
  // Wild: gold foil square, folded once (a diamond with a turned corner)
  2: {
    name: 'Gold foil',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M50 6 L94 50 L50 94 L6 50 Z" fill={C.gold} />
          <path d="M50 6 L94 50 L50 50 Z" fill={C.cream} />
          <path d="M50 50 L94 50 L50 94 Z" fill={C.vermilion} />
          <path d="M50 6 V94 M6 50 H94" stroke={C.ink} strokeWidth="4" />
        </>,
      ),
  },
  // P1: crane, wings spread (the top pay)
  3: {
    name: 'Crane',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M6 30 L48 50 L36 72 Z" fill={C.cream} />
          <path d="M94 30 L52 50 L64 72 Z" fill={C.cream} />
          <path d="M6 30 L48 50 L22 52 Z" fill={C.teal} />
          <path d="M94 30 L52 50 L78 52 Z" fill={C.teal} />
          <path d="M44 44 L56 44 L52 84 L48 84 Z" fill={C.cream} />
          <path d="M50 44 L44 14 L56 14 Z" fill={C.cream} />
          <path d="M50 12 L66 10 L52 20 Z" fill={C.vermilion} />
          <path d="M42 78 L50 94 L58 78 Z" fill={C.indigo} />
        </>,
      ),
  },
  // P2: fox, a pointed head with tall ears
  4: {
    name: 'Fox',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M10 8 L40 30 H60 L90 8 L88 56 L50 94 L12 56 Z" fill={C.vermilion} />
          <path d="M50 94 L12 56 L30 50 L50 66 L70 50 L88 56 Z" fill={C.cream} />
          <path d="M16 16 L34 30 L18 40 Z M84 16 L66 30 L82 40 Z" fill={C.ink} />
          <circle cx="36" cy="50" r="5" fill={C.ink} />
          <circle cx="64" cy="50" r="5" fill={C.ink} />
          <path d="M44 80 L50 88 L56 80 Z" fill={C.ink} />
        </>,
      ),
  },
  // P3: koi, a curved body and a swept tail
  5: {
    name: 'Koi',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M8 30 C34 2 78 14 84 44 C88 66 66 82 44 76 C30 72 22 60 30 48 C38 38 54 40 56 50 C48 46 42 52 46 60 C60 64 70 54 66 44 C62 28 36 24 14 44 Z" fill={C.vermilion} />
          <path d="M80 48 L96 34 L94 70 Z" fill={C.cream} />
          <path d="M60 38 C70 36 76 44 74 52 C66 50 62 46 60 38 Z" fill={C.cream} />
          <circle cx="20" cy="38" r="4" fill={C.ink} />
        </>,
      ),
  },
  // P4: frog, squat and wide with two eye bumps
  6: {
    name: 'Frog',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M6 70 C6 46 26 36 50 36 C74 36 94 46 94 70 C94 86 74 92 50 92 C26 92 6 86 6 70 Z" fill={C.teal} />
          <circle cx="28" cy="32" r="14" fill={C.teal} />
          <circle cx="72" cy="32" r="14" fill={C.teal} />
          <circle cx="28" cy="32" r="7" fill={C.cream} />
          <circle cx="72" cy="32" r="7" fill={C.cream} />
          <path d="M26 66 Q50 82 74 66" fill="none" stroke={C.ink} strokeWidth="5" strokeLinecap="round" />
          <path d="M6 70 L20 92 H8 Z M94 70 L80 92 H92 Z" fill={C.cream} />
        </>,
      ),
  },
  // L1: paper boat
  7: {
    name: 'Paper boat',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M8 62 H92 L76 84 H24 Z" fill={C.cream} />
          <path d="M50 14 L50 62 H20 Z" fill={C.cream} />
          <path d="M54 26 L82 62 H54 Z" fill={C.indigo} />
          <path d="M50 14 V62" stroke={C.ink} strokeWidth="4" />
        </>,
      ),
  },
  // L2: pinwheel, four vanes
  8: {
    name: 'Pinwheel',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M50 50 L50 8 L88 28 Z" fill={C.teal} />
          <path d="M50 50 L92 50 L72 88 Z" fill={C.cream} />
          <path d="M50 50 L50 92 L12 72 Z" fill={C.teal} />
          <path d="M50 50 L8 50 L28 12 Z" fill={C.cream} />
          <circle cx="50" cy="50" r="7" fill={C.gold} />
        </>,
      ),
  },
  // L3: paper fan, a half circle of pleats
  9: {
    name: 'Paper fan',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M6 76 A52 52 0 0 1 94 76 L50 90 Z" fill={C.gold} />
          <path d="M50 90 L18 40 L34 26 Z M50 90 L50 22 L66 26 Z M50 90 L82 40 L94 76 Z" fill={C.vermilion} />
          <path d="M50 90 L6 76 L12 58 Z" fill={C.cream} />
        </>,
      ),
  },
  // L4: paper star, four sharp points
  10: {
    name: 'Paper star',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M50 6 L62 38 L94 50 L62 62 L50 94 L38 62 L6 50 L38 38 Z" fill={C.gold} />
          <path d="M50 6 L62 38 L50 50 Z M94 50 L62 62 L50 50 Z M50 94 L38 62 L50 50 Z M6 50 L38 38 L50 50 Z" fill={C.cream} />
        </>,
      ),
  },
  // L5: water-bomb cube, three faces
  11: {
    name: 'Water bomb',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M50 8 L90 28 L90 72 L50 92 L10 72 L10 28 Z" fill={C.cream} />
          <path d="M50 50 L90 28 L90 72 L50 92 Z" fill={C.indigo} />
          <path d="M50 50 L10 28 L50 8 L90 28 Z" fill={C.teal} />
          <path d="M50 50 V92" stroke={C.ink} strokeWidth="4" />
        </>,
      ),
  },
  // Mystery: a blank folded square with crease lines (it opens with a flip)
  12: {
    name: 'Folded square',
    render: (s) =>
      svg(
        s,
        <>
          <rect x="10" y="10" width="80" height="80" rx="4" fill={C.cream} />
          <path d="M10 10 L90 90 M90 10 L10 90" stroke={C.indigo} strokeWidth="5" strokeLinecap="round" />
          <path d="M10 10 H50 L10 50 Z" fill={C.gold} />
          <path d="M90 90 H50 L90 50 Z" fill={C.teal} />
        </>,
      ),
  },
};
