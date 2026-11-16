// Grand Finale: symbol art and theme. Flat vector only (docs/SLOT-STYLE.md): filled shapes and round-cap strokes
// in the palette below, nothing else. Rocket values (+1 to +50) are painted by the kit as cell badges.

import type { ReactElement } from 'react';
import type { SlotSymbols, SlotTheme } from '@originals/slots/ui';

export const FINALE = {
  night: '#0D1B2A', // night navy: behind the reels
  smoke: '#6C757D', // smoke grey: the frame
  tile: '#16293D', // a lighter navy for the tiles
  gold: '#FFC857', // gold burst: the win highlight
  magenta: '#E84A8A',
  blue: '#4CC9F0',
  ember: '#F77F00',
  lilac: '#B9A3F2', // peony: apart from the rocket's magenta
  ash: '#C9D1DA', // light grey: reads on navy tiles
  // feature (the closing barrage): a dusk sky
  duskBg: '#1A0B24',
  duskTile: '#26112F',
} as const;
const C = FINALE;

const svg = (size: number, body: ReactElement) => (
  <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
    {body}
  </svg>
);

// A skyline over water, flat shapes only, a shade off the window tone so symbols stay readable.
// Base: night navy. Feature: dusk, with a few flat bursts (stars of round-cap strokes) in the sky.
const BUILDINGS = [
  [0.0, 0.10, 0.30], [0.08, 0.08, 0.20], [0.15, 0.12, 0.38], [0.27, 0.07, 0.24], [0.33, 0.11, 0.33],
  [0.44, 0.09, 0.18], [0.52, 0.12, 0.42], [0.64, 0.08, 0.26], [0.71, 0.11, 0.34], [0.82, 0.08, 0.20], [0.89, 0.11, 0.30],
];
function scene(w: number, h: number, dusk: boolean) {
  const sky = dusk ? '#3A1B4D' : '#1D3A5C';
  const city = dusk ? '#241035' : '#112844';
  const water = dusk ? '#321747' : '#183A5E';
  const wave = dusk ? '#5A2D78' : '#2F5F8C';
  const lit = dusk ? '#8A4DB0' : '#FFC857';
  const horizon = h * 0.72;
  const bursts = dusk
    ? [[0.2, 0.2, 0.09], [0.78, 0.15, 0.11], [0.52, 0.32, 0.07]]
    : [];
  return (
    <g>
      <rect width={w} height={h} fill={sky} />
      {bursts.map(([bx, by, br], i) => {
        const r = br * w;
        return (
          <g key={i} stroke={lit} strokeWidth={Math.max(2, w * 0.006)} strokeLinecap="round">
            {Array.from({ length: 8 }, (_, k) => {
              const a = (k * Math.PI) / 4;
              return (
                <line
                  key={k}
                  x1={bx * w + Math.cos(a) * r * 0.45}
                  y1={by * h + Math.sin(a) * r * 0.45}
                  x2={bx * w + Math.cos(a) * r}
                  y2={by * h + Math.sin(a) * r}
                />
              );
            })}
          </g>
        );
      })}
      {BUILDINGS.map(([x, bw, bh], i) => (
        <g key={i}>
          <rect x={x * w} y={horizon - bh * h} width={bw * w + 1} height={bh * h} fill={city} />
          <rect x={x * w + bw * w * 0.3} y={horizon - bh * h + h * 0.04} width={Math.max(2, bw * w * 0.12)} height={h * 0.03} fill={lit} />
        </g>
      ))}
      <rect y={horizon} width={w} height={h - horizon} fill={water} />
      {[0.08, 0.16, 0.24].map((f, i) => (
        <rect key={i} x={w * (0.1 + i * 0.3)} y={horizon + h * f} width={w * 0.22} height={Math.max(2, h * 0.012)} rx={2} fill={wave} />
      ))}
    </g>
  );
}

export const finaleTheme: SlotTheme = {
  name: 'Grand Finale',
  palette: {
    bg: C.night,
    frame: C.smoke,
    tile: C.tile,
    colors: [C.gold, C.magenta, C.blue, C.ember],
    ink: C.gold,
    featureBg: C.duskBg,
    featureFrame: C.magenta,
    featureTile: C.duskTile,
  },
  window: { cell: 'tile', separators: 'gap', frameWidth: 5, radius: 4, cellRadius: 4, backdropMargin: 16 },
  backdrop: (w, h) => scene(w, h, false),
  featureBackdrop: (w, h) => scene(w, h, true),
};

// Spokes of a round burst: [x1, y1, x2, y2] lines from the centre outwards.
const spokes = (n: number, r1: number, r2: number, rot = 0) =>
  Array.from({ length: n }, (_, i) => {
    const a = ((i / n) * 360 + rot) * (Math.PI / 180);
    return [50 + r1 * Math.cos(a), 50 + r1 * Math.sin(a), 50 + r2 * Math.cos(a), 50 + r2 * Math.sin(a)];
  });

// A star polygon with `n` points between radii r1 (inner) and r2 (outer).
const star = (n: number, r1: number, r2: number, cx = 50, cy = 50) =>
  Array.from({ length: n * 2 }, (_, i) => {
    const a = ((i / (n * 2)) * 360 - 90) * (Math.PI / 180);
    const r = i % 2 ? r1 : r2;
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');

export const finaleSymbols: SlotSymbols = {
  // Scatter: a round bomb with a curling fuse and a spark
  1: {
    name: 'Lit fuse',
    render: (s) =>
      svg(
        s,
        <>
          <circle cx="44" cy="64" r="28" fill={C.blue} />
          <rect x="34" y="30" width="20" height="10" rx="3" fill={C.smoke} />
          <path d="M46 32 C46 14 70 22 66 12 C64 8 76 10 80 18" fill="none" stroke={C.ember} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
          <polygon points={star(4, 5, 12, 80, 18)} fill={C.gold} />
        </>,
      ),
  },
  // Wild: a slim rocket
  2: {
    name: 'Rocket',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M50 6 C62 18 66 34 66 52 H34 C34 34 38 18 50 6 Z" fill={C.magenta} />
          <rect x="34" y="50" width="32" height="30" fill={C.gold} />
          <path d="M34 56 L16 80 V88 L34 78 Z M66 56 L84 80 V88 L66 78 Z" fill={C.magenta} />
          <circle cx="50" cy="40" r="7" fill={C.blue} />
          <path d="M38 82 H62 L50 96 Z" fill={C.ember} />
        </>,
      ),
  },
  // P1: the grand shell, a giant gold chrysanthemum (top pay)
  3: {
    name: 'Grand shell',
    render: (s) =>
      svg(
        s,
        <>
          <polygon points={star(12, 30, 46)} fill={C.gold} />
          <circle cx="50" cy="50" r="26" fill={C.magenta} />
          <circle cx="50" cy="50" r="15" fill={C.gold} />
          <circle cx="50" cy="50" r="6" fill={C.blue} />
        </>,
      ),
  },
  // P2: the firework barge, a wide low boat on the water with a mast
  4: {
    name: 'Barge',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M6 54 H94 L80 78 H20 Z" fill={C.ember} />
          <rect x="30" y="38" width="26" height="16" fill={C.gold} />
          <path d="M66 54 V22 L82 36 L66 36" fill={C.magenta} />
          <circle cx="66" cy="16" r="6" fill={C.gold} />
          <path d="M8 90 Q22 80 36 90 T64 90 T92 90" fill="none" stroke={C.blue} strokeWidth="6" strokeLinecap="round" />
        </>,
      ),
  },
  // P3: the Roman candle, a tall tube shooting balls
  5: {
    name: 'Roman candle',
    render: (s) =>
      svg(
        s,
        <>
          <rect x="36" y="42" width="28" height="52" rx="4" fill={C.magenta} />
          <rect x="36" y="54" width="28" height="8" fill={C.gold} />
          <rect x="36" y="76" width="28" height="8" fill={C.gold} />
          <circle cx="50" cy="32" r="9" fill={C.blue} />
          <circle cx="40" cy="14" r="7" fill={C.gold} />
          <circle cx="60" cy="18" r="6" fill={C.ember} />
        </>,
      ),
  },
  // P4: the sparkler, a hand-held stick with a star on the end
  6: {
    name: 'Sparkler',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M20 92 L52 56" stroke={C.ash} strokeWidth="8" strokeLinecap="round" />
          <polygon points={star(8, 11, 26, 66, 34)} fill={C.ember} />
          <circle cx="66" cy="34" r="8" fill={C.gold} />
        </>,
      ),
  },
  // L1: peony, a round burst
  7: {
    name: 'Peony',
    render: (s) =>
      svg(
        s,
        <>
          <circle cx="50" cy="50" r="26" fill={C.lilac} />
          {spokes(8, 38, 38).map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="7" fill={C.lilac} />
          ))}
        </>,
      ),
  },
  // L2: willow, trails drooping from a point
  8: {
    name: 'Willow',
    render: (s) =>
      svg(
        s,
        <>
          <circle cx="50" cy="16" r="8" fill={C.ash} />
          <path d="M50 16 C20 16 12 50 12 82 M50 16 C34 24 32 56 32 86 M50 16 C66 24 68 56 68 86 M50 16 C80 16 88 50 88 82" fill="none" stroke={C.ash} strokeWidth="6" strokeLinecap="round" />
        </>,
      ),
  },
  // L3: ring, a hollow circle
  9: {
    name: 'Ring',
    render: (s) => svg(s, <circle cx="50" cy="50" r="34" fill="none" stroke={C.blue} strokeWidth="14" />),
  },
  // L4: crossette, a cross whose four arms split at the ends
  10: {
    name: 'Crossette',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M50 14 V86 M14 50 H86" stroke={C.ember} strokeWidth="14" strokeLinecap="butt" />
          <circle cx="50" cy="14" r="8" fill={C.ember} />
          <circle cx="50" cy="86" r="8" fill={C.ember} />
          <circle cx="14" cy="50" r="8" fill={C.ember} />
          <circle cx="86" cy="50" r="8" fill={C.ember} />
        </>,
      ),
  },
  // L5: palm, a thick trunk with fronds
  11: {
    name: 'Palm',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M42 94 L46 42 H56 L62 94 Z" fill={C.magenta} />
          <path d="M50 42 C30 20 14 28 8 44 C22 36 34 38 50 42 Z M50 42 C70 20 86 28 92 44 C78 36 66 38 50 42 Z M50 40 C42 20 46 10 52 6 C58 14 58 26 50 40 Z" fill={C.magenta} />
        </>,
      ),
  },
};

// Rocket landing burst: a ring of gold and magenta rays, flat shapes only.
export const finaleFx: Record<number, (size: number) => ReactElement> = {
  2: (s) =>
    svg(
      s,
      <g strokeLinecap="round" strokeWidth="7">
        {spokes(12, 24, 46).map(([x1, y1, x2, y2], i) => (
          <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={i % 2 ? C.magenta : C.gold} />
        ))}
        <polygon points={star(6, 8, 18)} fill={C.gold} stroke="none" />
      </g>,
    ),
};
