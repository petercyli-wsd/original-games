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

// Paper landscape: a sheet creased into big triangular facets, folded hills, and and no sun: nothing round sits behind a reel.
// Everything sits a shade off the window tone.
const hills = (w: number, h: number, c: { far: string; mid: string; near: string; sun: string; ray: string; facet: string }) => {
  const peaks = (base: number, amp: number, n: number, phase: number) => {
    const step = w / n;
    let d = `M0 ${h} L0 ${base}`;
    for (let i = 0; i <= n; i++) d += ` L${(i * step).toFixed(1)} ${(base - (i % 2 === phase ? amp : 0)).toFixed(1)}`;
    return d + ` L${w} ${h} Z`;
  };
  return (
    <>
      <path d={`M0 0 L${w} 0 L${w} ${h * 0.5} Z`} fill={c.facet} />
      <path d={`M0 ${h} L0 ${h * 0.35} L${w * 0.5} ${h} Z`} fill={c.facet} />
      <path d={`M0 0 L${w} ${h} M${w} 0 L0 ${h}`} stroke={c.ray} strokeWidth="2" fill="none" />
      <path d={peaks(h * 0.62, h * 0.16, 4, 1)} fill={c.far} />
      <path d={peaks(h * 0.74, h * 0.14, 5, 0)} fill={c.mid} />
      <path d={peaks(h * 0.88, h * 0.1, 3, 1)} fill={c.near} />
    </>
  );
};

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
  backdrop: (w, h) => hills(w, h, { far: '#34385A', mid: '#383C60', near: '#3D4268', sun: '#6B4A52', ray: '#33375A', facet: '#30344F' }),
  featureBackdrop: (w, h) => hills(w, h, { far: '#1E4A4D', mid: '#215357', near: '#285E60', sun: '#3C6E66', ray: '#1C4549', facet: '#1B4448' }),
  window: { cell: 'tile', separators: 'gap', frameWidth: 6, radius: 4, cellRadius: 0, backdropMargin: 14 },
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
  // P3: koi, a plump side-on fish: rounded head left, forked tail right, dorsal fin, cream back patch
  5: {
    name: 'Koi',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M70 50 L96 22 L88 50 L96 78 Z" fill={C.cream} />
          <path d="M34 30 L52 12 L64 34 Z" fill={C.cream} />
          <path d="M34 70 L50 86 L62 66 Z" fill={C.cream} />
          <path d="M4 50 C4 30 28 26 48 28 C62 30 74 40 76 50 C74 60 62 70 48 72 C28 74 4 70 4 50 Z" fill={C.vermilion} />
          <path d="M40 31 C54 30 66 38 68 48 C58 46 46 42 40 31 Z" fill={C.cream} />
          <path d="M26 30 L26 70" stroke={C.ink} strokeWidth="3" strokeLinecap="round" />
          <circle cx="16" cy="46" r="4.5" fill={C.ink} />
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

// The folded sun lands with a short burst of paper rays.
export const unfoldFx = {
  1: (size: number) => (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <path d="M50 0 L56 30 L50 40 L44 30 Z M50 100 L56 70 L50 60 L44 70 Z M0 50 L30 44 L40 50 L30 56 Z M100 50 L70 44 L60 50 L70 56 Z" fill={C.gold} />
    </svg>
  ),
};
