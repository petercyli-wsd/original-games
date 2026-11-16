// Honeycomb: symbol art and window theme. A beekeeper's apiary in high summer. Flat shapes only, in the
// palette below (docs/SLOT-STYLE.md §2–3). Ids follow slot.spec.json: 1 wild, 2–5 premiums, 6–10 lows, 11 coin.

import type { ReactElement } from 'react';
import type { SlotSymbols, SlotTheme } from '@originals/slots/ui';

export const HIVE = {
  bg: '#1f130a', // behind the reels: dark hive
  frame: '#6b4226', // hive brown
  tile: '#33200f', // a cell of the comb
  gold: '#f2a900', // honey gold (also the win highlight)
  cream: '#fff3c4', // wax cream
  green: '#7fb069', // meadow green
  lavender: '#9d8cc2', // lavender
} as const;
const C = HIVE;

const svg = (size: number, body: ReactElement) => (
  <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
    {body}
  </svg>
);

/** A pointy-top hexagon centred on (cx, cy) with circumradius r, as polygon points. */
const hex = (cx: number, cy: number, r: number) =>
  Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 90);
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');

/** A spiky disc: n points alternating between radius ro and ri. */
const star = (cx: number, cy: number, ro: number, ri: number, n: number) =>
  Array.from({ length: n * 2 }, (_, i) => {
    const a = (Math.PI / n) * i - Math.PI / 2;
    const r = i % 2 ? ri : ro;
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');

/** Apiary backdrop: a faint comb over meadow hills with hive silhouettes. `chain` swaps to a denser, honey-filled comb. */
function meadow(w: number, h: number, chain: boolean) {
  const r = Math.max(w, h) / (chain ? 9 : 7);
  const dx = r * Math.sqrt(3);
  const cells: ReactElement[] = [];
  for (let row = 0, y = r; y < h + r; row++, y += r * 1.5) {
    for (let x = row % 2 ? dx / 2 : 0; x < w + dx; x += dx) {
      const filled = chain && (row * 3 + Math.round(x / dx)) % 4 === 0;
      cells.push(<polygon key={`${row}-${x}`} points={hex(x, y, r * 0.9)} fill={filled ? '#4a2f0c' : chain ? '#2e1c0d' : '#2a1a0c'} />);
    }
  }
  const hill = h * 0.82;
  return (
    <>
      {cells}
      <path d={`M0 ${hill} Q${w * 0.25} ${hill - h * 0.1} ${w * 0.5} ${hill} T${w} ${hill} V${h} H0 Z`} fill="#22301a" />
      <path d={`M0 ${h * 0.92} Q${w * 0.3} ${h * 0.84} ${w * 0.6} ${h * 0.92} T${w} ${h * 0.9} V${h} H0 Z`} fill="#1b2615" />
      <rect x={w * 0.04} y={h * 0.9} width={w * 0.07} height={h * 0.1} fill="#33200f" />
      <rect x={w * 0.03} y={h * 0.88} width={w * 0.09} height={h * 0.025} fill="#4a2f17" />
      <rect x={w * 0.9} y={h * 0.9} width={w * 0.07} height={h * 0.1} fill="#33200f" />
      <rect x={w * 0.89} y={h * 0.88} width={w * 0.09} height={h * 0.025} fill="#4a2f17" />
    </>
  );
}

export const honeycombTheme: SlotTheme = {
  name: 'Honeycomb',
  palette: { bg: C.bg, frame: C.frame, tile: C.tile, chainBg: '#2e1c0a', chainFrame: '#a8741c', chainTile: '#46290e', colors: [C.gold, C.cream, C.green, C.lavender], ink: C.cream },
  window: { cell: 'plain', separators: 'gap', frameWidth: 8, radius: 6, cellRadius: 4 },
  backdrop: (w, h) => meadow(w, h, false),
  featureBackdrop: (w, h) => meadow(w, h, true),
};

export const honeycombSymbols: SlotSymbols = {
  // Wild: the worker bee in flight, wings drawn twice so they read as a blur
  1: {
    name: 'Worker bee',
    render: (s) =>
      svg(
        s,
        <>
          <ellipse cx="34" cy="30" rx="26" ry="15" transform="rotate(-24 34 30)" fill={C.lavender} />
          <ellipse cx="66" cy="30" rx="26" ry="15" transform="rotate(24 66 30)" fill={C.lavender} />
          <ellipse cx="38" cy="36" rx="17" ry="10" transform="rotate(-20 38 36)" fill={C.cream} />
          <ellipse cx="62" cy="36" rx="17" ry="10" transform="rotate(20 62 36)" fill={C.cream} />
          <ellipse cx="50" cy="66" rx="26" ry="20" fill={C.gold} />
          <path d="M42 48 V84 M58 48 V84" stroke={C.bg} strokeWidth="7" strokeLinecap="round" fill="none" />
          <circle cx="50" cy="50" r="10" fill={C.bg} />
        </>,
      ),
  },
  // P1: the queen, upright and crowned (top pay)
  2: {
    name: 'Queen bee',
    render: (s) =>
      svg(
        s,
        <>
          <ellipse cx="22" cy="50" rx="16" ry="25" transform="rotate(20 22 50)" fill={C.cream} />
          <ellipse cx="78" cy="50" rx="16" ry="25" transform="rotate(-20 78 50)" fill={C.cream} />
          <ellipse cx="50" cy="60" rx="21" ry="32" fill={C.gold} />
          <path d="M33 56 H67 M34 72 H66" stroke={C.bg} strokeWidth="7" strokeLinecap="round" fill="none" />
          <circle cx="50" cy="30" r="12" fill={C.frame} />
          <polygon points="36,26 38,6 45,16 50,4 55,16 62,6 64,26" fill={C.cream} />
        </>,
      ),
  },
  // P2: the beekeeper's veil hat, wide brim and a hanging net
  3: {
    name: 'Veil hat',
    render: (s) =>
      svg(
        s,
        <>
          <polygon points="22,44 78,44 70,90 30,90" fill={C.lavender} />
          <path d="M33 56 H68 M36 70 H64" stroke={C.bg} strokeWidth="4" strokeLinecap="round" fill="none" />
          <path d="M28 44 Q28 12 50 12 Q72 12 72 44 Z" fill={C.cream} />
          <rect x="28" y="32" width="44" height="8" fill={C.frame} />
          <ellipse cx="50" cy="44" rx="43" ry="9" fill={C.cream} />
        </>,
      ),
  },
  // P3: the smoker, a can with bellows and a puff
  4: {
    name: 'Smoker',
    render: (s) =>
      svg(
        s,
        <>
          <circle cx="30" cy="14" r="8" fill={C.cream} />
          <circle cx="44" cy="10" r="6" fill={C.cream} />
          <polygon points="22,40 30,24 36,24 36,40" fill={C.gold} />
          <rect x="14" y="38" width="42" height="52" rx="8" fill={C.gold} />
          <rect x="14" y="54" width="42" height="8" fill={C.frame} />
          <polygon points="58,44 92,34 92,86 58,76" fill={C.frame} />
          <path d="M70 41 V80 M82 37 V83" stroke={C.cream} strokeWidth="4" strokeLinecap="round" fill="none" />
        </>,
      ),
  },
  // P4: the honey dipper, a long stick with a grooved head and a drip
  5: {
    name: 'Honey dipper',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M82 88 L52 42" stroke={C.cream} strokeWidth="9" strokeLinecap="round" fill="none" />
          <ellipse cx="38" cy="30" rx="26" ry="23" transform="rotate(-30 38 30)" fill={C.gold} />
          <path d="M18 24 L40 14 M14 36 L52 20 M24 46 L56 30" stroke={C.frame} strokeWidth="4" strokeLinecap="round" fill="none" />
          <path d="M20 62 Q14 74 20 80 Q28 74 20 62 Z" fill={C.gold} />
        </>,
      ),
  },
  // L1: clover, three round leaves
  6: {
    name: 'Clover',
    render: (s) =>
      svg(
        s,
        <>
          <circle cx="50" cy="28" r="20" fill={C.green} />
          <circle cx="30" cy="54" r="20" fill={C.green} />
          <circle cx="70" cy="54" r="20" fill={C.green} />
          <path d="M50 54 Q52 76 44 92" stroke={C.green} strokeWidth="7" strokeLinecap="round" fill="none" />
        </>,
      ),
  },
  // L2: lavender sprig, buds up a thin stem
  7: {
    name: 'Lavender',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M50 94 V30" stroke={C.green} strokeWidth="6" strokeLinecap="round" fill="none" />
          <ellipse cx="50" cy="14" rx="9" ry="11" fill={C.lavender} />
          <ellipse cx="35" cy="30" rx="9" ry="12" transform="rotate(-25 35 30)" fill={C.lavender} />
          <ellipse cx="65" cy="30" rx="9" ry="12" transform="rotate(25 65 30)" fill={C.lavender} />
          <ellipse cx="34" cy="52" rx="9" ry="12" transform="rotate(-25 34 52)" fill={C.lavender} />
          <ellipse cx="66" cy="52" rx="9" ry="12" transform="rotate(25 66 52)" fill={C.lavender} />
        </>,
      ),
  },
  // L3: sunflower, a spiky gold disc with a brown heart
  8: {
    name: 'Sunflower',
    render: (s) =>
      svg(
        s,
        <>
          <polygon points={star(50, 50, 44, 28, 10)} fill={C.gold} />
          <circle cx="50" cy="50" r="17" fill={C.frame} />
        </>,
      ),
  },
  // L4: dandelion clock, a round puff on a bent stem
  9: {
    name: 'Dandelion clock',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M52 94 Q60 70 44 52" stroke={C.green} strokeWidth="6" strokeLinecap="round" fill="none" />
          <path d="M42 36 L14 14 M50 32 V8 M58 36 L82 14 M30 46 L8 46 M70 46 L92 46" stroke={C.cream} strokeWidth="4" strokeLinecap="round" fill="none" />
          <circle cx="44" cy="40" r="15" fill={C.cream} />
        </>,
      ),
  },
  // L5: wax candle, a tall block with a flame
  10: {
    name: 'Wax candle',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M50 8 Q60 22 56 32 Q50 38 44 32 Q40 22 50 8 Z" fill={C.gold} />
          <rect x="30" y="38" width="40" height="54" rx="6" fill={C.cream} />
          <path d="M38 38 V56" stroke={C.gold} strokeWidth="6" strokeLinecap="round" fill="none" />
          <rect x="48" y="30" width="4" height="10" fill={C.frame} />
        </>,
      ),
  },
  // Coin: a honey cell, a capped hexagon (the value badge sits on top in the window)
  11: {
    name: 'Honey cell',
    render: (s) =>
      svg(
        s,
        <>
          <polygon points={hex(50, 50, 46)} fill={C.gold} />
          <polygon points={hex(50, 50, 31)} fill={C.frame} />
          <polygon points={hex(50, 50, 20)} fill={C.cream} />
        </>,
      ),
  },
};
