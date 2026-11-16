// Hi-Score: a late-80s arcade cabinet. Chunky 8-bit symbols built on a visible pixel grid, drawn as flat
// SVG in the cabinet's palette (docs/SLOT-STYLE.md §3). Nothing here is traced from another game.

import type { ReactElement } from 'react';
import type { SlotSymbols, SlotTheme } from '@originals/slots/ui';

export const ARCADE = {
  crt: '#0B0B1A', // CRT black (window background)
  scan: '#5B2A86', // scanline violet (the bezel)
  tile: '#17173F', // tile tone, a step up from the CRT
  amber: '#FFB000', // win highlight
  cyan: '#00E5FF',
  magenta: '#FF2E88',
  lime: '#B6FF3B',
  // the bonus stage: a hotter, redder cabinet
  hotBg: '#1C0620',
  hotFrame: '#FF2E88',
  hotTile: '#2E1040',
} as const;
const C = ARCADE;

// Backdrops: flat shapes a shade off the window tone, so the tiles stay the loudest thing on screen.
function cabinetScene(w: number, h: number, tones: { line: string; px: string; px2: string; bezel: string }) {
  const u = Math.max(4, Math.round(Math.min(w, h) / 40)); // one "pixel"
  const horizon = Math.round(h * 0.55);
  const lines: ReactElement[] = [];
  for (let i = -6; i <= 6; i++) {
    lines.push(<line key={`v${i}`} x1={w / 2 + i * w * 0.05} y1={horizon} x2={w / 2 + i * w * 0.32} y2={h} stroke={tones.line} strokeWidth={1.5} />);
  }
  for (let k = 1; k <= 5; k++) {
    const y = horizon + (h - horizon) * (k / 5) ** 2;
    lines.push(<line key={`h${k}`} x1={0} y1={y} x2={w} y2={y} stroke={tones.line} strokeWidth={1.5} />);
  }
  const stars: [number, number, number][] = [
    [0.08, 0.1, 1], [0.22, 0.28, 2], [0.4, 0.07, 1], [0.58, 0.22, 2], [0.74, 0.09, 1],
    [0.9, 0.3, 2], [0.12, 0.42, 1], [0.84, 0.46, 1], [0.5, 0.38, 1],
  ];
  return (
    <g>
      <rect x={u} y={u} width={w - 2 * u} height={h - 2 * u} fill="none" stroke={tones.bezel} strokeWidth={u / 2} />
      {stars.map(([fx, fy, n], i) => (
        <rect key={i} x={Math.round(fx * w)} y={Math.round(fy * h)} width={u * n} height={u * n} fill={i % 2 ? tones.px : tones.px2} />
      ))}
      <rect x={0} y={horizon} width={w} height={2} fill={tones.px2} />
      {lines}
    </g>
  );
}

function bonusScene(w: number, h: number) {
  const u = Math.max(4, Math.round(Math.min(w, h) / 40));
  const cx = w / 2;
  const sunY = Math.round(h * 0.5);
  const r = Math.round(Math.min(w, h) * 0.3);
  const bands: ReactElement[] = [];
  for (let i = 0; i < 6; i++) {
    bands.push(<rect key={i} x={cx - r} y={sunY - r + i * (r / 3) + r * 0.9} width={r * 2} height={Math.max(2, i * 1.5)} fill={C.hotBg} />);
  }
  // stepped pixel hills along the bottom
  const steps: ReactElement[] = [];
  const cols = Math.ceil(w / (u * 3));
  for (let i = 0; i < cols; i++) {
    const hh = u * (2 + ((i * 7) % 5));
    steps.push(<rect key={i} x={i * u * 3} y={h - hh - u} width={u * 3} height={hh} fill="#2A0C33" />);
  }
  const bursts: [number, number][] = [[0.1, 0.12], [0.3, 0.3], [0.7, 0.14], [0.9, 0.34], [0.5, 0.08]];
  return (
    <g>
      <rect x={u} y={u} width={w - 2 * u} height={h - 2 * u} fill="none" stroke="#4A1A55" strokeWidth={u / 2} />
      <circle cx={cx} cy={sunY} r={r} fill="#3A1040" />
      {bands}
      {bursts.map(([fx, fy], i) => (
        <g key={i} fill="#5A1E5E">
          <rect x={fx * w} y={fy * h - u} width={u} height={u * 3} />
          <rect x={fx * w - u} y={fy * h} width={u * 3} height={u} />
        </g>
      ))}
      {steps}
    </g>
  );
}

export const hiScoreTheme: SlotTheme = {
  name: 'Hi-Score',
  palette: {
    bg: C.crt,
    frame: C.scan,
    tile: C.tile,
    colors: [C.amber, C.cyan, C.magenta, C.lime],
    ink: C.amber,
    featureBg: C.hotBg,
    featureFrame: C.hotFrame,
    featureTile: C.hotTile,
  },
  window: { cell: 'tile', separators: 'gap', frameWidth: 12, radius: 10, cellRadius: 3 },
  backdrop: (w, h) => cabinetScene(w, h, { line: '#1B1B4A', px: '#24246A', px2: '#2E2E7A', bezel: '#2A1450' }),
  featureBackdrop: bonusScene,
};

const svg = (size: number, body: ReactElement) => (
  <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
    {body}
  </svg>
);

/**
 * A pixel sprite: `rows` are strings, one character per cell; `.` is empty and any other character
 * names a colour in `ink`. One path per colour, centred in the 100 box.
 */
function sprite(rows: string[], ink: Record<string, string>, cell: number): ReactElement {
  const w = Math.max(...rows.map((r) => r.length));
  const x0 = (100 - w * cell) / 2;
  const y0 = (100 - rows.length * cell) / 2;
  const paths: Record<string, string> = {};
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      if (ch === '.') {
        x++;
        continue;
      }
      let end = x;
      while (end < row.length && row[end] === ch) end++;
      const d = `M${(x0 + x * cell).toFixed(2)} ${(y0 + y * cell).toFixed(2)}h${((end - x) * cell).toFixed(2)}v${cell}h${(-(end - x) * cell).toFixed(2)}z`;
      paths[ch] = (paths[ch] ?? '') + d;
      x = end;
    }
  });
  return (
    <>
      {Object.entries(paths).map(([ch, d]) => (
        <path key={ch} d={d} fill={ink[ch]} />
      ))}
    </>
  );
}

export const hiScoreSymbols: SlotSymbols = {
  // Scatter: the golden token, a round coin with a star punched through
  1: {
    name: 'Golden token',
    render: (s) =>
      svg(
        s,
        <>
          <circle cx="50" cy="50" r="43" fill={C.amber} />
          <circle cx="50" cy="50" r="33" fill="none" stroke={C.tile} strokeWidth="5" />
          <path d="M50 24 L57 42 L76 42 L61 53 L67 72 L50 60 L33 72 L39 53 L24 42 L43 42 Z" fill={C.tile} />
        </>,
      ),
  },
  // Wild: the glitch block, three colour-split slices that no longer line up
  2: {
    name: 'Glitch block',
    render: (s) =>
      svg(
        s,
        <>
          <rect x="6" y="14" width="66" height="24" fill={C.magenta} />
          <rect x="30" y="38" width="64" height="24" fill={C.cyan} />
          <rect x="14" y="62" width="62" height="24" fill={C.magenta} />
          <rect x="72" y="14" width="22" height="12" fill={C.lime} />
          <rect x="6" y="74" width="16" height="12" fill={C.lime} />
        </>,
      ),
  },
  // P1: the neon 7, seven-segment strokes on a plate (the top pay)
  3: {
    name: 'Neon seven',
    render: (s) =>
      svg(
        s,
        <>
          <rect x="8" y="8" width="84" height="84" rx="8" fill={C.scan} />
          <rect x="16" y="16" width="68" height="68" rx="4" fill={C.crt} />
          <rect x="28" y="26" width="46" height="11" fill={C.amber} />
          <rect x="63" y="26" width="11" height="26" fill={C.amber} />
          <rect x="53" y="52" width="11" height="22" fill={C.amber} />
          <rect x="43" y="64" width="11" height="10" fill={C.amber} />
        </>,
      ),
  },
  // P2: the pixel rocket, tall and thin
  4: {
    name: 'Pixel rocket',
    render: (s) =>
      svg(
        s,
        sprite(
          [
            '....M....',
            '...MMM...',
            '..CCCCC..',
            '..CCCCC..',
            '..CLLLC..',
            '..CLLLC..',
            '..CCCCC..',
            '.MCCCCCM.',
            'MMCCCCCMM',
            'MM.AAA.MM',
            '...AAA...',
            '....A....',
          ],
          { M: C.magenta, C: C.cyan, L: C.lime, A: C.amber },
          7.5,
        ),
      ),
  },
  // P3: the joystick, a ball on a stick over a wide base
  5: {
    name: 'Joystick',
    render: (s) =>
      svg(
        s,
        sprite(
          [
            '..MMMMM..',
            '.MMMMMMM.',
            '.MMMMMMM.',
            '.MMMMMMM.',
            '..MMMMM..',
            '....A....',
            '....A....',
            '.CCCCCCC.',
            'CCCCCCCCC',
            'CLLCCCAAC',
            'CCCCCCCCC',
          ],
          { M: C.magenta, A: C.amber, C: C.cyan, L: C.lime },
          8.2,
        ),
      ),
  },
  // L1: pixel heart
  6: {
    name: 'Pixel heart',
    render: (s) =>
      svg(
        s,
        sprite(['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'], { '#': C.magenta }, 12),
      ),
  },
  // L2: pixel star
  7: {
    name: 'Pixel star',
    render: (s) =>
      svg(
        s,
        sprite(
          ['....#....', '....#....', '...###...', '#########', '.#######.', '..#####..', '..##.##..', '.##...##.', '.#.....#.'],
          { '#': C.lime },
          9.6,
        ),
      ),
  },
  // L3: lightning bolt
  8: {
    name: 'Lightning bolt',
    render: (s) => svg(s, <path d="M60 6 L22 56 H44 L34 94 L78 40 H54 L70 6 Z" fill={C.cyan} />),
  },
  // L4: pixel bell
  9: {
    name: 'Pixel bell',
    render: (s) =>
      svg(
        s,
        sprite(
          ['....#....', '...###...', '..#####..', '..#####..', '.#######.', '.#######.', '#########', '.........', '...###...'],
          { '#': C.amber },
          9.6,
        ),
      ),
  },
};
