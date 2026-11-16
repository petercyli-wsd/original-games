// Escapement: a clockmaker's bench at dusk. Theme palette and original flat-vector symbol art
// (docs/SLOT-STYLE.md): brass, enamel and teal on graphite, with ruby jewels.
// Symbol ids follow slot.spec.json: 1 key (scatter), 2 pendulum (wild), 3-6 premiums, 7-11 lows.

import type { ReactElement } from 'react';
import type { SlotSymbols, SlotTheme } from '@originals/slots/ui';

export const C = {
  graphite: '#2E2E2E',
  walnut: '#4A2C2A',
  tile: '#38302E',
  brass: '#C9A227',
  enamel: '#F2EFE6',
  teal: '#3E7C7B',
  ruby: '#B0243A',
  // the feature room: the bench lamp goes out, the teal workshop lights up
  fBg: '#1C2E2D',
  fFrame: '#3E7C7B',
  fTile: '#28403F',
} as const;

const svg = (size: number, body: ReactElement) => (
  <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
    {body}
  </svg>
);

/** n teeth around (50,50): a toothed wheel as one polygon. */
function cogPoints(teeth: number, rOut: number, rIn: number): string {
  const pts: string[] = [];
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    const q = step / 4;
    const p = (r: number, ang: number) => `${(50 + r * Math.cos(ang)).toFixed(1)},${(50 + r * Math.sin(ang)).toFixed(1)}`;
    pts.push(p(rIn, a - q * 2), p(rOut, a - q), p(rOut, a + q), p(rIn, a + q * 2));
  }
  return pts.join(' ');
}

/** Toothed wheel centred at (cx,cy) with a hub hole, as flat shapes. */
function gear(cx: number, cy: number, r: number, teeth: number, fill: string, hole: string, key: string) {
  const step = (Math.PI * 2) / teeth;
  const q = step / 4;
  const pts: string[] = [];
  const p = (rr: number, a: number) => `${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`;
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    pts.push(p(r * 0.82, a - q * 2), p(r, a - q), p(r, a + q), p(r * 0.82, a + q * 2));
  }
  return (
    <g key={key}>
      <polygon points={pts.join(' ')} fill={fill} />
      <circle cx={cx} cy={cy} r={r * 0.55} fill={hole} />
      <circle cx={cx} cy={cy} r={r * 0.2} fill={fill} />
    </g>
  );
}

/** Flat clockmaker's-bench scene: a bench edge, big gears and a mainspring outline, all a shade off the window tone. */
function benchScene(w: number, h: number, a: string, b: string, c: string) {
  const m = Math.min(w, h);
  // mainspring: an outline spiral, centred left-low
  const sx = w * 0.2, sy = h * 0.74;
  const pts: string[] = [];
  for (let i = 0; i <= 90; i++) {
    const t = i / 90;
    const ang = t * Math.PI * 6;
    const r = m * (0.03 + 0.2 * t);
    pts.push(`${(sx + r * Math.cos(ang)).toFixed(1)},${(sy + r * Math.sin(ang)).toFixed(1)}`);
  }
  return (
    <>
      <rect x={0} y={h * 0.9} width={w} height={h * 0.1} fill={c} />
      <rect x={0} y={h * 0.9} width={w} height={Math.max(2, h * 0.012)} fill={b} />
      {gear(w * 0.82, h * 0.24, m * 0.3, 16, a, c, 'g1')}
      {gear(w * 0.5, h * 0.5, m * 0.16, 12, b, a, 'g2')}
      {gear(w * 0.13, h * 0.2, m * 0.2, 14, b, c, 'g3')}
      <polyline points={pts.join(' ')} fill="none" stroke={a} strokeWidth={Math.max(3, m * 0.025)} strokeLinecap="round" strokeLinejoin="round" />
    </>
  );
}

export const escapementTheme: SlotTheme = {
  name: 'Escapement',
  palette: {
    bg: C.graphite,
    frame: C.walnut,
    tile: C.tile,
    colors: [C.brass, C.enamel, C.teal, C.ruby],
    ink: C.enamel,
    featureBg: C.fBg,
    featureFrame: C.fFrame,
    featureTile: C.fTile,
    // the winding chain: a warm brass-lit bench, apart from the teal feature room
    chainBg: '#2B2118',
    chainFrame: '#6E521C',
    chainTile: '#3B2E20',
  },
  window: { cell: 'plain', separators: 'none', frameWidth: 10, radius: 6, cellRadius: 4 },
  backdrop: (w, h) => benchScene(w, h, '#3A3535', '#403A37', '#343030'),
  featureBackdrop: (w, h) => benchScene(w, h, '#274543', '#2D4D4B', '#223B39'),
};

export const escapementSymbols: SlotSymbols = {
  // Scatter: the winding key, a butterfly-shaped bow on a shaft with teeth
  1: {
    name: 'Winding key',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M50 38 C34 4 6 14 14 34 C20 48 40 46 50 40 Z" fill={C.ruby} />
          <path d="M50 38 C66 4 94 14 86 34 C80 48 60 46 50 40 Z" fill={C.ruby} />
          <circle cx="29" cy="27" r="6" fill={C.tile} />
          <circle cx="71" cy="27" r="6" fill={C.tile} />
          <rect x="44" y="34" width="12" height="60" rx="3" fill={C.brass} />
          <rect x="56" y="70" width="14" height="8" fill={C.brass} />
          <rect x="56" y="84" width="10" height="8" fill={C.brass} />
        </>,
      ),
  },
  // Wild: the pendulum, a long rod from a pivot to a heavy bob, with its swing arc
  2: {
    name: 'Pendulum',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M16 70 A44 44 0 0 0 84 70" fill="none" stroke={C.teal} strokeWidth="5" strokeLinecap="round" />
          <rect x="46" y="8" width="8" height="52" rx="3" fill={C.enamel} />
          <circle cx="50" cy="10" r="7" fill={C.brass} />
          <circle cx="50" cy="72" r="20" fill={C.brass} />
          <circle cx="50" cy="72" r="10" fill={C.ruby} />
        </>,
      ),
  },
  // P1: the astronomical dial (top pay), a round face with a toothed sun ring and a moon window
  3: {
    name: 'Astronomical dial',
    render: (s) =>
      svg(
        s,
        <>
          <polygon points={cogPoints(12, 46, 38)} fill={C.brass} />
          <circle cx="50" cy="50" r="32" fill={C.teal} />
          <circle cx="50" cy="50" r="24" fill={C.enamel} />
          <path d="M50 30 A20 20 0 1 0 50 70 A14 14 0 1 1 50 30 Z" fill={C.brass} />
          <circle cx="50" cy="50" r="7" fill={C.ruby} />
          <rect x="48" y="34" width="4" height="16" fill={C.tile} />
        </>,
      ),
  },
  // P2: the mantel clock, wide and low with an arched top and feet
  4: {
    name: 'Mantel clock',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M6 82 V52 C6 30 24 20 50 20 C76 20 94 30 94 52 V82 Z" fill={C.brass} />
          <rect x="2" y="82" width="96" height="10" rx="2" fill={C.ruby} />
          <circle cx="50" cy="52" r="23" fill={C.enamel} />
          <path d="M50 36 V52 L62 58" fill="none" stroke={C.tile} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="50" cy="12" r="6" fill={C.teal} />
        </>,
      ),
  },
  // P3: the pocket watch, tall: a ring and a crown over a round case
  5: {
    name: 'Pocket watch',
    render: (s) =>
      svg(
        s,
        <>
          <circle cx="50" cy="12" r="9" fill="none" stroke={C.enamel} strokeWidth="5" />
          <rect x="42" y="18" width="16" height="12" fill={C.teal} />
          <circle cx="50" cy="63" r="33" fill={C.brass} />
          <circle cx="50" cy="63" r="25" fill={C.enamel} />
          <path d="M50 46 V63 H62" fill="none" stroke={C.ruby} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="50" cy="63" r="4" fill={C.tile} />
        </>,
      ),
  },
  // P4: the cuckoo clock, a gabled house with a bird at the door and a hanging weight
  6: {
    name: 'Cuckoo clock',
    render: (s) =>
      svg(
        s,
        <>
          <polygon points="50,4 96,40 4,40" fill={C.teal} />
          <rect x="14" y="40" width="72" height="42" fill={C.brass} />
          <rect x="38" y="48" width="24" height="26" rx="12" fill={C.tile} />
          <circle cx="50" cy="62" r="8" fill={C.ruby} />
          <rect x="28" y="82" width="4" height="6" fill={C.enamel} />
          <circle cx="30" cy="91" r="5" fill={C.enamel} />
          <rect x="68" y="82" width="4" height="6" fill={C.enamel} />
          <circle cx="70" cy="91" r="5" fill={C.enamel} />
        </>,
      ),
  },
  // L1: a small cog with many teeth
  7: {
    name: 'Cog',
    render: (s) =>
      svg(
        s,
        <>
          <polygon points={cogPoints(14, 44, 34)} fill={C.brass} />
          <circle cx="50" cy="50" r="12" fill={C.tile} />
        </>,
      ),
  },
  // L2: a screw, a round head with a slot
  8: {
    name: 'Screw',
    render: (s) =>
      svg(
        s,
        <>
          <circle cx="50" cy="50" r="38" fill={C.teal} />
          <rect x="16" y="44" width="68" height="12" rx="3" fill={C.tile} transform="rotate(-35 50 50)" />
        </>,
      ),
  },
  // L3: the mainspring, a flat coil
  9: {
    name: 'Mainspring',
    render: (s) =>
      svg(
        s,
        <polyline points="56.0,50.0 56.3,51.8 56.1,53.7 55.3,55.6 53.8,57.3 51.8,58.6 49.4,59.4 46.7,59.4 44.0,58.6 41.4,57.1 39.3,54.7 37.9,51.8 37.3,48.4 37.7,44.8 39.1,41.3 41.5,38.3 44.7,35.9 48.7,34.4 53.0,34.1 57.5,35.0 61.6,37.1 65.1,40.4 67.7,44.7 69.0,49.6 69.0,54.9 67.5,60.1 64.5,64.8 60.3,68.7 55.0,71.3 49.1,72.4 42.9,71.9 37.0,69.6 31.7,65.8 27.7,60.5 25.1,54.2 24.3,47.3 25.5,40.3 28.5,33.7 33.4,28.1 39.7,23.9 47.0,21.5 54.9,21.2 62.7,23.0 69.8,27.0 75.8,32.9 80.0,40.3 82.0,48.7 81.8,57.5 79.1,66.0 74.1,73.6 67.2,79.7 58.7,83.8 49.3,85.5 39.6,84.5 30.4,80.9 22.4,74.9 16.2,66.8 12.4,57.2 11.3,46.7 13.0,36.3 17.6,26.5" fill="none" stroke={C.enamel} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />,
      ),
  },
  // L4: the jewel bearing, a red faceted stone
  10: {
    name: 'Jewel',
    render: (s) =>
      svg(
        s,
        <>
          <polygon points="50,12 82,34 82,66 50,88 18,66 18,34" fill={C.ruby} />
          <polygon points="50,12 66,34 50,50 34,34" fill={C.enamel} />
          <polygon points="34,34 50,50 50,88 18,66 18,34" fill={C.walnut} />
        </>,
      ),
  },
  // L5: an ornate clock hand, a spade tip on a long tail
  11: {
    name: 'Clock hand',
    render: (s) =>
      svg(
        s,
        <>
          <path d="M50 6 C66 24 70 34 58 44 C54 40 52 40 52 44 V92 H48 V44 C48 40 46 40 42 44 C30 34 34 24 50 6 Z" fill={C.brass} />
          <circle cx="50" cy="76" r="9" fill={C.brass} />
          <circle cx="50" cy="76" r="4" fill={C.tile} />
        </>,
      ),
  },
};
