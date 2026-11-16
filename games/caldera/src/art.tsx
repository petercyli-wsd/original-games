// Caldera: a volcanic caldera. Warm rust, lava and sulphur on a deep brown window; obsidian and pumice as the
// cool-ish accents. Every symbol colour comes from this palette (docs/SLOT-STYLE.md §2). Ids match slot.spec.json.

import type { ReactElement } from 'react';
import type { SlotSymbols, SlotTheme } from '@originals/slots/ui';

export const CALDERA = {
  bg: '#2b1109',
  frame: '#a63f17',
  tile: '#451d10',
  sulphur: '#ffd23f',
  lava: '#ff5a1f',
  pumice: '#f2dcb5',
  obsidian: '#150907',
  // basalt, the plain low: dull grey-brown rock
  basalt: '#6e5d52',
  basaltDark: '#4b3d35',
  basaltTop: '#8c7a6c',
  // the premiums sit on a lit plaque with a gold rim
  plaque: '#7a3418',
  gold: '#e6b450',
  // the eruption: a hotter, redder window for the free spins
  hotBg: '#4a0e08',
  hotFrame: '#e8571f',
  hotTile: '#6e1a0e',
} as const;
const C = CALDERA;

const svg = (size: number, body: ReactElement) => (
  <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
    {body}
  </svg>
);

/** A premium's lit plaque with a gold rim; the art sits inside it, a little smaller. */
const plaque = (body: ReactElement) => (
  <>
    <rect x="3" y="3" width="94" height="94" rx="12" fill={C.plaque} stroke={C.gold} strokeWidth="5" />
    <g transform="translate(50 50) scale(0.84) translate(-50 -50)">{body}</g>
  </>
);

export const calderaTheme: SlotTheme = {
  name: 'Caldera',
  palette: {
    bg: C.bg,
    frame: C.frame,
    tile: C.tile,
    colors: [C.sulphur, C.lava, C.pumice, C.obsidian],
    ink: C.sulphur,
    featureBg: C.hotBg,
    featureFrame: C.hotFrame,
    featureTile: C.hotTile,
  },
  window: { cell: 'tile', separators: 'gap', frameWidth: 6, radius: 3, cellRadius: 3 },
};

export const calderaSymbols: SlotSymbols = {
  // 1 Scatter: a fumarole, a vent cone with a steam plume
  1: {
    name: 'Fumarole',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M8 92 L34 50 H66 L92 92 Z" fill={C.frame} />
          <path d="M34 50 H66 L72 60 H28 Z" fill={C.lava} />
          <path d="M42 42 C34 32 52 26 44 14 M58 42 C50 30 68 24 60 10" fill="none" stroke={C.pumice} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M30 92 L40 74 L48 92 M56 92 L66 76 L72 92" fill="none" stroke={C.sulphur} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        </>,
      ),
  },
  // 2 Wild: a lava pool, wide and low with a bubbling skin
  2: {
    name: 'Lava pool',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M4 66 C4 48 22 44 30 50 C34 36 48 30 56 40 C66 32 82 40 80 52 C92 52 96 62 96 70 C96 84 78 92 50 92 C22 92 4 84 4 66 Z" fill={C.lava} />
          <path d="M18 70 C30 62 40 76 54 68 C66 62 74 74 84 68" fill="none" stroke={C.sulphur} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="44" cy="52" r="6" fill={C.sulphur} />
          <circle cx="68" cy="56" r="5" fill={C.pumice} />
          <circle cx="28" cy="84" r="4" fill={C.sulphur} />
        </>,
      ),
  },
  // 3 Premium, top pay: sulphur crystals, a spiky crown on a lava crust
  3: {
    name: 'Sulphur crystals',
    render: (s) =>
      svg(
        s,
        plaque(<>
          <path d="M6 94 L10 78 H90 L94 94 Z" fill={C.lava} />
          <path d="M14 80 L22 36 L34 80 Z" fill={C.sulphur} />
          <path d="M66 80 L78 30 L88 80 Z" fill={C.sulphur} />
          <path d="M30 80 L50 6 L70 80 Z" fill={C.sulphur} />
          <path d="M50 6 L70 80 H52 Z" fill={C.pumice} />
          <path d="M22 36 L34 80 H24 Z M78 30 L88 80 H80 Z" fill={C.pumice} />
        </>),
      ),
  },
  // 4 Premium: an obsidian blade, a broad kite with a bright lava crack
  4: {
    name: 'Obsidian blade',
    render: (s) =>
      svg(
        s,
        plaque(<>
          <path d="M50 2 L84 36 L62 98 H38 L16 36 Z" fill={C.obsidian} />
          <path d="M50 2 L84 36 L58 36 Z" fill={C.pumice} />
          <path d="M16 36 L42 36 L50 2 Z" fill={C.basaltDark} />
          <path d="M52 16 L44 44 L58 62 L46 88" fill="none" stroke={C.lava} strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M52 16 L44 44 L58 62 L46 88" fill="none" stroke={C.sulphur} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        </>),
      ),
  },
  // 5 Premium: a fire opal, a flat-topped gem pointing down
  5: {
    name: 'Fire opal',
    render: (s) =>
      svg(
        s,
        plaque(<>
          <path d="M24 18 H76 L94 40 L50 92 L6 40 Z" fill={C.lava} />
          <path d="M24 18 H76 L62 40 H38 Z" fill={C.sulphur} />
          <path d="M6 40 H38 L50 92 Z" fill={C.frame} />
          <path d="M62 40 H94 L50 92 Z" fill={C.frame} />
          <path d="M38 40 H62 L50 92 Z" fill={C.pumice} />
        </>),
      ),
  },
  // 6 Low: basalt, a dull grey-brown hexagonal column seen from the side
  6: {
    name: 'Basalt',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M22 26 H78 V90 H22 Z" fill={C.basalt} />
          <path d="M22 26 L34 12 H66 L78 26 L66 38 H34 Z" fill={C.basaltTop} />
          <path d="M34 38 V90 M66 38 V90" stroke={C.basaltDark} strokeWidth="5" />
          <path d="M22 62 H34 M66 70 H78" stroke={C.basaltDark} strokeWidth="4" />
        </>,
      ),
  },
  // 7 Low: pumice, a round stone full of holes
  7: {
    name: 'Pumice',
    render: (s) =>
      svg(
        s,
        <>
          <circle cx="50" cy="50" r="40" fill={C.pumice} />
          <circle cx="36" cy="38" r="8" fill={C.tile} />
          <circle cx="64" cy="46" r="10" fill={C.tile} />
          <circle cx="44" cy="68" r="9" fill={C.tile} />
          <circle cx="72" cy="72" r="5" fill={C.tile} />
        </>,
      ),
  },
  // 8 Low: scoria, a jagged mound of cinder
  8: {
    name: 'Scoria',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M6 90 L28 52 L40 62 L52 14 L68 56 L80 44 L94 90 Z" fill={C.obsidian} />
          <path d="M52 14 L68 56 L52 56 Z" fill={C.frame} />
          <path d="M28 52 L40 62 L30 66 Z" fill={C.frame} />
          <path d="M20 90 H80" stroke={C.lava} strokeWidth="5" strokeLinecap="round" />
        </>,
      ),
  },
  // 9 Low: an ember, a small flame
  9: {
    name: 'Ember',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M52 8 C54 28 80 40 80 66 C80 84 66 94 50 94 C34 94 20 84 20 66 C20 52 30 44 38 34 C38 46 44 50 46 50 C44 34 46 20 52 8 Z" fill={C.lava} />
          <path d="M50 54 C56 64 62 68 62 76 C62 84 56 88 50 88 C44 88 38 84 38 76 C38 68 46 64 50 54 Z" fill={C.sulphur} />
        </>,
      ),
  },
  // 10 Low: steam, three wavy vents
  10: {
    name: 'Steam',
    render: (s) =>
      svg(
        s,
        <path
          d="M24 92 C10 76 38 66 24 50 C10 34 38 24 24 8 M50 92 C36 76 64 66 50 50 C36 34 64 24 50 8 M76 92 C62 76 90 66 76 50 C62 34 90 24 76 8"
          fill="none"
          stroke={C.pumice}
          strokeWidth="8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />,
      ),
  },
};

/** A short flat splash when lava lands: drops thrown out in lava and sulphur (no glow). */
export const lavaFx = (size: number): ReactElement =>
  svg(
    size,
    <>
      <circle cx="12" cy="40" r="6" fill={C.lava} />
      <circle cx="88" cy="36" r="6" fill={C.lava} />
      <circle cx="26" cy="12" r="5" fill={C.sulphur} />
      <circle cx="74" cy="10" r="5" fill={C.sulphur} />
      <circle cx="50" cy="4" r="4" fill={C.lava} />
      <circle cx="8" cy="76" r="4" fill={C.sulphur} />
      <circle cx="92" cy="74" r="4" fill={C.sulphur} />
    </>,
  );
