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
