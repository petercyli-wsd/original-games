// The seven gem kinds: one flat neutral shape each (circle, square, triangle,
// diamond, hexagon, pentagon, cross), so a match is read by shape alone.

export interface GemStyle {
  name: string;
  /** Polygon outline in unit coordinates (radius about 1); omitted for the circle. */
  points?: [number, number][];
}

const regular = (n: number, rot = -Math.PI / 2): [number, number][] =>
  Array.from({ length: n }, (_, i) => {
    const a = rot + (i * 2 * Math.PI) / n;
    return [Math.cos(a), Math.sin(a)];
  });

const CROSS: [number, number][] = [
  [-0.36, -1],
  [0.36, -1],
  [0.36, -0.36],
  [1, -0.36],
  [1, 0.36],
  [0.36, 0.36],
  [0.36, 1],
  [-0.36, 1],
  [-0.36, 0.36],
  [-1, 0.36],
  [-1, -0.36],
  [-0.36, -0.36],
];

export const GEM_STYLES: GemStyle[] = [
  { name: 'Circle' },
  { name: 'Square', points: [[-0.82, -0.82], [0.82, -0.82], [0.82, 0.82], [-0.82, 0.82]] },
  { name: 'Triangle', points: [[0, -1], [1, 0.72], [-1, 0.72]] },
  { name: 'Diamond', points: [[0, -1.08], [0.9, 0], [0, 1.08], [-0.9, 0]] },
  { name: 'Hexagon', points: regular(6, 0) },
  { name: 'Pentagon', points: regular(5) },
  { name: 'Cross', points: CROSS },
];

const fmt = (p: [number, number][]) => p.map(([x, y]) => `${x.toFixed(3)},${y.toFixed(3)}`).join(' ');

/** A gem centred on the origin, `size` px from centre to edge. */
export function Gem({ index, size, dim }: { index: number; size: number; dim?: boolean }) {
  const s = GEM_STYLES[index];
  return (
    <g className={'dm-gem-shape' + (dim ? ' dim' : '')} transform={`scale(${size})`} aria-label={s.name}>
      {s.points ? <polygon points={fmt(s.points)} /> : <circle r={0.92} />}
    </g>
  );
}

/** A small gem for a hand's example row. */
export function MiniGem({ index }: { index: number }) {
  const s = GEM_STYLES[index];
  return (
    <svg viewBox="-1.2 -1.2 2.4 2.4" className="dm-mini" aria-hidden="true">
      {s.points ? <polygon points={fmt(s.points)} /> : <circle r={0.92} />}
    </svg>
  );
}
