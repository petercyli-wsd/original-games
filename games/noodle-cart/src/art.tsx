// Noodle Cart art: a warm night-market stall. Original flat vector shapes in the theme's own colours.
// Silhouettes: wide low bowl (top pay), stacked round basket, tall hanging duck, curled C prawn,
// tall cook with a puffed hat (wild), slip with a torn edge (scatter). Lows are one-colour objects.

import type { ReactElement } from 'react';
import type { SlotSymbols, SlotTheme } from '@originals/slots/ui';

/** The theme's tones. The window palette below is built from exactly these. */
export const NC = {
  ink: '#3a160d', // behind the reels, and every outline
  red: '#c93a22', // the frame: lantern red
  cream: '#fdecc8', // the tiles: steam cream
  pink: '#d6246e', // win highlight: neon sign pink
  amber: '#f2a22b', // warm amber
  jade: '#2e9a6a', // jade green
  white: '#fff7e6', // paper white (hat, ticket stamp)
} as const;
const C = NC;

const svg = (size: number, body: ReactElement) => (
  <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
    {body}
  </svg>
);

export const noodleTheme: SlotTheme = {
  name: 'Noodle Cart',
  palette: {
    bg: C.ink,
    frame: C.red,
    tile: C.cream,
    colors: [C.pink, C.amber, C.jade, C.white],
    ink: C.cream,
    // The dinner rush: full lantern light. A flat swap of the window tones.
    featureBg: '#8c2412',
    featureFrame: C.amber,
    featureTile: '#ffe2a0',
  },
  window: { cell: 'tile', separators: 'gap', frameWidth: 10, radius: 10, cellRadius: 8 },
};

export const noodleSymbols: SlotSymbols = {
  // Scatter: an order ticket, a red slip with a torn edge and a stamp
  1: {
    name: 'Order ticket',
    render: (s) =>
      svg(
        s,
        <>
          <g transform="rotate(-8 50 50)">
            <path d="M22 8 H78 V84 L70 92 L62 84 L54 92 L46 84 L38 92 L30 84 L22 92 Z" fill={C.red} stroke={C.ink} strokeWidth="4" strokeLinejoin="round" />
            <circle cx="50" cy="34" r="14" fill={C.white} stroke={C.ink} strokeWidth="3.5" />
            <circle cx="50" cy="34" r="5" fill={C.pink} />
            <rect x="32" y="58" width="36" height="6" rx="3" fill={C.white} />
            <rect x="32" y="70" width="24" height="6" rx="3" fill={C.white} />
          </g>
        </>,
      ),
  },
  // Wild: the cook, a tall puffed hat over a smiling face
  2: {
    name: 'The cook',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M14 96 C14 80 28 76 50 78 C72 76 86 80 86 96 Z" fill={C.red} stroke={C.ink} strokeWidth="3.5" strokeLinejoin="round" />
          <circle cx="50" cy="60" r="17" fill={C.amber} stroke={C.ink} strokeWidth="3.5" />
          <path d="M24 44 C8 40 8 14 30 16 C34 4 66 4 70 16 C92 14 92 40 76 44 Z" fill={C.white} stroke={C.ink} strokeWidth="3.5" strokeLinejoin="round" />
          <rect x="26" y="42" width="48" height="10" rx="2" fill={C.pink} stroke={C.ink} strokeWidth="3.5" />
          <circle cx="43" cy="62" r="3.2" fill={C.ink} />
          <circle cx="57" cy="62" r="3.2" fill={C.ink} />
          <path d="M42 69 Q50 76 58 69" stroke={C.ink} strokeWidth="3.5" strokeLinecap="round" fill="none" />
        </>,
      ),
  },
  // P1 (top pay): golden noodle bowl, wide and low, noodles lifted on chopsticks
  3: {
    name: 'Golden noodle bowl',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M26 54 C28 36 36 30 38 14" stroke={C.ink} strokeWidth="11" strokeLinecap="round" fill="none" />
          <path d="M26 54 C28 36 36 30 38 14" stroke={C.amber} strokeWidth="5" strokeLinecap="round" fill="none" />
          <path d="M46 54 C48 40 56 32 54 14" stroke={C.ink} strokeWidth="11" strokeLinecap="round" fill="none" />
          <path d="M46 54 C48 40 56 32 54 14" stroke={C.amber} strokeWidth="5" strokeLinecap="round" fill="none" />
          <path d="M66 54 C68 38 76 32 72 14" stroke={C.ink} strokeWidth="11" strokeLinecap="round" fill="none" />
          <path d="M66 54 C68 38 76 32 72 14" stroke={C.amber} strokeWidth="5" strokeLinecap="round" fill="none" />
          <path d="M8 52 H92 C92 80 74 92 50 92 C26 92 8 80 8 52 Z" fill={C.red} stroke={C.ink} strokeWidth="4" strokeLinejoin="round" />
          <rect x="10" y="60" width="80" height="8" fill={C.amber} />
        </>,
      ),
  },
  // P2: dumpling basket, a stack of round bamboo tiers with a dumpling on top
  4: {
    name: 'Dumpling basket',
    render: (s) =>
      svg(
        s,
        <>
          <rect x="12" y="62" width="76" height="26" rx="8" fill={C.jade} stroke={C.ink} strokeWidth="4" />
          <rect x="12" y="44" width="76" height="22" rx="8" fill={C.jade} stroke={C.ink} strokeWidth="4" />
          <path d="M20 44 C20 20 42 14 52 14 C70 14 80 26 80 44 Z" fill={C.white} stroke={C.ink} strokeWidth="4" strokeLinejoin="round" />
          <path d="M42 22 L44 40 M54 20 L54 40 M66 24 L64 40" stroke={C.ink} strokeWidth="3.5" strokeLinecap="round" />
          <path d="M22 76 H78" stroke={C.ink} strokeWidth="4" strokeLinecap="round" />
        </>,
      ),
  },
  // P3: roast duck, tall and thin, hanging from a hook
  5: {
    name: 'Roast duck',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M50 4 V16" stroke={C.ink} strokeWidth="4.5" strokeLinecap="round" />
          <path d="M60 28 L76 33 L60 38 Z" fill={C.amber} stroke={C.ink} strokeWidth="3.5" strokeLinejoin="round" />
          <circle cx="50" cy="28" r="12" fill={C.red} stroke={C.ink} strokeWidth="4" />
          <ellipse cx="50" cy="62" rx="24" ry="30" fill={C.red} stroke={C.ink} strokeWidth="4" />
          <path d="M36 54 C36 70 44 80 54 82" stroke={C.amber} strokeWidth="6" strokeLinecap="round" fill="none" />
          <circle cx="54" cy="25" r="3" fill={C.white} />
          <path d="M42 92 V97 M58 92 V97" stroke={C.ink} strokeWidth="4.5" strokeLinecap="round" />
        </>,
      ),
  },
  // P4: tiger prawn, a thick C curl with stripes and a fan tail
  6: {
    name: 'Tiger prawn',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M66 20 C22 6 10 58 40 78 C54 86 72 84 80 70" stroke={C.ink} strokeWidth="26" strokeLinecap="round" fill="none" />
          <path d="M66 20 C22 6 10 58 40 78 C54 86 72 84 80 70" stroke={C.pink} strokeWidth="18" strokeLinecap="round" fill="none" />
          <path d="M24 36 L36 44 M24 56 L38 56 M32 70 L44 62 M58 78 L56 66" stroke={C.ink} strokeWidth="4" strokeLinecap="round" />
          <path d="M80 70 L96 62 L94 80 L84 92 Z" fill={C.amber} stroke={C.ink} strokeWidth="3.5" strokeLinejoin="round" />
          <circle cx="68" cy="26" r="3.5" fill={C.white} />
          <path d="M74 14 L92 6 M78 22 L96 22" stroke={C.ink} strokeWidth="3.5" strokeLinecap="round" />
        </>,
      ),
  },
  // L1: chopsticks, two crossed bars
  7: {
    name: 'Chopsticks',
    render: (s) =>
      svg(
        s,
        <>
          <rect x="45" y="6" width="9" height="88" rx="4.5" fill={C.amber} stroke={C.ink} strokeWidth="3.5" transform="rotate(38 50 50)" />
          <rect x="45" y="6" width="9" height="88" rx="4.5" fill={C.ink} transform="rotate(-38 50 50)" />
        </>,
      ),
  },
  // L2: chilli, a curved tapered pod
  8: {
    name: 'Chilli',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M20 34 C46 28 78 44 88 82 C80 94 70 92 66 82 C58 58 40 48 18 46 Z" fill={C.red} stroke={C.ink} strokeWidth="4" strokeLinejoin="round" />
          <path d="M8 36 C10 22 24 20 32 28 L28 46 C16 48 8 44 8 36 Z" fill={C.jade} stroke={C.ink} strokeWidth="4" strokeLinejoin="round" />
        </>,
      ),
  },
  // L3: spring onion, a tall green stalk on a white bulb
  9: {
    name: 'Spring onion',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M42 6 L52 6 L60 72 L40 72 Z" fill={C.jade} stroke={C.ink} strokeWidth="3.5" strokeLinejoin="round" />
          <path d="M60 12 L68 14 L68 68 L58 68 Z" fill={C.jade} stroke={C.ink} strokeWidth="3.5" strokeLinejoin="round" />
          <ellipse cx="50" cy="82" rx="15" ry="11" fill={C.white} stroke={C.ink} strokeWidth="3.5" />
        </>,
      ),
  },
  // L4: fish-cake slice, a round disc with a pink swirl
  10: {
    name: 'Fish cake',
    render: (s) =>
      svg(
        s,
        <>
          <circle cx="50" cy="50" r="40" fill={C.white} stroke={C.ink} strokeWidth="4" />
          <path d="M50 50 m0 -6 a6 6 0 1 1 -6 6 a14 14 0 1 1 14 14 a22 22 0 1 1 -22 -22" stroke={C.pink} strokeWidth="6" strokeLinecap="round" fill="none" />
        </>,
      ),
  },
  // L5: bok choy, a fan of green leaves on a pale stem
  11: {
    name: 'Bok choy',
    render: (s) =>
      svg(
        s,
        <>
          <ellipse cx="22" cy="44" rx="13" ry="30" fill={C.jade} stroke={C.ink} strokeWidth="3.5" transform="rotate(-38 22 44)" />
          <ellipse cx="78" cy="44" rx="13" ry="30" fill={C.jade} stroke={C.ink} strokeWidth="3.5" transform="rotate(38 78 44)" />
          <ellipse cx="50" cy="38" rx="15" ry="32" fill={C.jade} stroke={C.ink} strokeWidth="3.5" />
          <path d="M36 66 L64 66 L58 94 L42 94 Z" fill={C.white} stroke={C.ink} strokeWidth="3.5" strokeLinejoin="round" />
        </>,
      ),
  },
};
