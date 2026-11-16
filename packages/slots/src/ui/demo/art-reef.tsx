// Demo symbol art: "Tide Chest", a reef theme. Original flat vector shapes in the theme's own colours.
// Each symbol has its own silhouette (square chest, round pearl in a fan, diamond fish, tall seahorse,
// wide turtle, star, branch, blades, fan, bubbles), so premiums differ by outline, not only by colour.

import type { ReactElement } from 'react';
import type { SlotSymbols, SlotTheme } from '../types';

export const REEF = {
  navy: '#0b2a3c',
  deep: '#123e55',
  water: '#1d6f93',
  coral: '#ff7a59',
  sand: '#f3d9a4',
  kelp: '#38b48b',
  pearl: '#f5f1e8',
} as const;
const C = REEF;

const svg = (size: number, body: ReactElement) => (
  <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
    {body}
  </svg>
);

const star = (cx: number, cy: number, ro: number, ri: number, n = 5, rot = -90) =>
  Array.from({ length: n * 2 }, (_, i) => {
    const a = ((rot + (i * 180) / n) * Math.PI) / 180;
    const r = i % 2 ? ri : ro;
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');

export const reefTheme: SlotTheme = {
  name: 'Tide Chest',
  palette: { bg: C.navy, frame: C.water, tile: C.deep, colors: [C.coral, C.sand, C.kelp, C.pearl], featureBg: '#2a1233', featureFrame: '#7a3b7e', featureTile: '#3a1b46' },
  window: { cell: 'tile', separators: 'gap', frameWidth: 8, radius: 10, cellRadius: 6 },
};

export const reefSymbols: SlotSymbols = {
  // Scatter: treasure chest (a box with an arched lid)
  1: {
    name: 'Treasure chest',
    render: (s) =>
      svg(
        s,
        <>
          <rect x="14" y="46" width="72" height="40" rx="4" fill={C.sand} />
          <path d="M14 48 V38 A36 28 0 0 1 86 38 V48 Z" fill={C.coral} />
          <rect x="43" y="18" width="14" height="68" fill={C.pearl} />
          <circle cx="50" cy="60" r="9" fill={C.navy} />
          <rect x="47.5" y="60" width="5" height="12" rx="1.5" fill={C.navy} />
        </>,
      ),
  },
  // Wild: a pearl in an open shell
  2: {
    name: 'Pearl in shell',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M50 94 L12 52 A40 40 0 0 1 88 52 Z" fill={C.coral} />
          <path d="M50 92 L28 50 M50 92 L40 40 M50 92 L60 40 M50 92 L72 50" stroke={C.navy} strokeWidth="3" strokeLinecap="round" fill="none" />
          <circle cx="50" cy="42" r="23" fill={C.pearl} />
          <path d="M38 34 A14 14 0 0 1 48 26" stroke={C.sand} strokeWidth="5" strokeLinecap="round" fill="none" />
        </>,
      ),
  },
  // P1: angelfish, a diamond with a tail
  3: {
    name: 'Angelfish',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M70 34 L94 18 L94 82 L70 66 Z" fill={C.sand} />
          <path d="M34 24 L52 6 L62 30 Z" fill={C.sand} />
          <path d="M34 76 L52 94 L62 70 Z" fill={C.sand} />
          <path d="M8 50 L42 16 L72 34 L72 66 L42 84 Z" fill={C.coral} />
          <path d="M46 20 L58 26 L58 74 L46 80 Z" fill={C.pearl} />
          <circle cx="26" cy="46" r="6" fill={C.navy} />
          <circle cx="27.5" cy="44.5" r="2" fill={C.pearl} />
        </>,
      ),
  },
  // P2: seahorse, tall and curled
  4: {
    name: 'Seahorse',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M60 24 C74 34 70 52 56 60 C44 68 46 82 60 86 C70 88 74 80 68 74" stroke={C.pearl} strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <circle cx="54" cy="20" r="13" fill={C.pearl} />
          <path d="M46 16 L22 18 L22 26 L46 28 Z" fill={C.pearl} />
          <path d="M60 8 L72 4 L68 16 Z" fill={C.coral} />
          <path d="M68 38 L82 42 L72 50 Z M64 58 L78 62 L66 68 Z" fill={C.coral} />
          <circle cx="52" cy="17" r="3.6" fill={C.navy} />
        </>,
      ),
  },
  // P3: sea turtle, a wide dome
  5: {
    name: 'Sea turtle',
    render: (s) =>
      svg(
        s,
        <>
          <ellipse cx="18" cy="56" rx="12" ry="10" fill={C.sand} />
          <ellipse cx="30" cy="78" rx="13" ry="7" fill={C.sand} transform="rotate(-25 30 78)" />
          <ellipse cx="72" cy="80" rx="13" ry="7" fill={C.sand} transform="rotate(25 72 80)" />
          <path d="M92 70 L84 66 L84 76 Z" fill={C.sand} />
          <path d="M26 72 A32 34 0 0 1 90 72 Z" fill={C.kelp} />
          <circle cx="44" cy="56" r="7" fill={C.pearl} />
          <circle cx="62" cy="52" r="7" fill={C.pearl} />
          <circle cx="76" cy="62" r="5" fill={C.pearl} />
          <circle cx="14" cy="52" r="3.4" fill={C.navy} />
        </>,
      ),
  },
  // P4: starfish
  6: {
    name: 'Starfish',
    render: (s) =>
      svg(
        s,
        <>
          <polygon points={star(50, 54, 46, 19)} fill={C.sand}/>
          <circle cx="50" cy="54" r="7" fill={C.coral} />
          {[0, 1, 2, 3, 4].map((i) => {
            const a = ((-90 + i * 72) * Math.PI) / 180;
            return <circle key={i} cx={50 + 27 * Math.cos(a)} cy={54 + 27 * Math.sin(a)} r="3.6" fill={C.coral} />;
          })}
        </>,
      ),
  },
  // L1: coral branch
  7: {
    name: 'Coral',
    render: (s) =>
      svg(
        s,
        <path d="M50 90 V40 M50 70 L26 48 V20 M50 58 L74 38 V16 M50 40 V12" stroke={C.coral} strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" fill="none" />,
      ),
  },
  // L2: kelp blades
  8: {
    name: 'Kelp',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M36 92 C20 72 52 62 36 42 C24 28 42 18 38 8" stroke={C.kelp} strokeWidth="12" strokeLinecap="round" fill="none" />
          <path d="M66 92 C52 76 80 62 68 46 C62 34 74 24 70 14" stroke={C.kelp} strokeWidth="12" strokeLinecap="round" fill="none" />
        </>,
      ),
  },
  // L3: scallop shell
  9: {
    name: 'Shell',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M50 88 L10 44 A46 46 0 0 1 90 44 Z" fill={C.sand} />
          <path d="M50 88 L26 34 M50 88 L50 24 M50 88 L74 34" stroke={C.navy} strokeWidth="3.5" strokeLinecap="round" fill="none" />
          <rect x="38" y="86" width="24" height="9" rx="3" fill={C.sand} />
        </>,
      ),
  },
  // L4: bubbles
  10: {
    name: 'Bubbles',
    render: (s) =>
      svg(
        s,
        <>
          <circle cx="38" cy="62" r="24" fill={C.pearl} />
          <circle cx="68" cy="34" r="16" fill={C.pearl} />
          <circle cx="74" cy="74" r="11" fill={C.pearl} />
          <path d="M26 56 A14 14 0 0 1 36 46" stroke={C.water} strokeWidth="5" strokeLinecap="round" fill="none" />
        </>,
      ),
  },
};
