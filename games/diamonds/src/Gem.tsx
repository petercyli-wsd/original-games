// The seven gems: one colour and one cut each, so a colour match is also a
// shape match (readable without colour vision). Drawn as faceted polygons:
// an outer girdle, an inner table, and side facets shaded by a fixed light.

export interface GemStyle {
  name: string;
  color: string;
  /** Outline in unit coordinates (radius about 1), clockwise from the top. */
  points: [number, number][];
}

const regular = (n: number, rot = -Math.PI / 2, sx = 1, sy = 1): [number, number][] =>
  Array.from({ length: n }, (_, i) => {
    const a = rot + (i * 2 * Math.PI) / n;
    return [Math.cos(a) * sx, Math.sin(a) * sy];
  });

export const GEM_STYLES: GemStyle[] = [
  { name: 'Ruby', color: '#fb4469', points: regular(6, -Math.PI / 2, 0.95, 1) },
  { name: 'Topaz', color: '#fb923c', points: regular(8, -Math.PI / 2 + Math.PI / 8) },
  { name: 'Citrine', color: '#facc15', points: [[0, -1], [1, 0.72], [-1, 0.72]] },
  {
    name: 'Emerald',
    color: '#22c55e',
    points: [[-0.42, -1], [0.42, -1], [0.78, -0.62], [0.78, 0.62], [0.42, 1], [-0.42, 1], [-0.78, 0.62], [-0.78, -0.62]],
  },
  { name: 'Aquamarine', color: '#2dd4bf', points: [[-0.5, -0.78], [0.5, -0.78], [1, -0.28], [0, 1], [-1, -0.28]] },
  { name: 'Sapphire', color: '#3b82f6', points: [[0, -1.08], [0.9, 0], [0, 1.08], [-0.9, 0]] },
  { name: 'Amethyst', color: '#c084fc', points: regular(5, -Math.PI / 2, 1.02, 1.02) },
];

const LIGHT = (() => {
  const x = -0.45;
  const y = -0.9;
  const l = Math.hypot(x, y);
  return [x / l, y / l];
})();

const fmt = (p: [number, number][]) => p.map(([x, y]) => `${x.toFixed(3)},${y.toFixed(3)}`).join(' ');

const facetCache = new Map<number, { outer: string; table: string; facets: { d: string; fill: string; opacity: number }[] }>();

function facets(index: number) {
  const hit = facetCache.get(index);
  if (hit) return hit;
  const P = GEM_STYLES[index].points;
  const cx = P.reduce((s, p) => s + p[0], 0) / P.length;
  const cy = P.reduce((s, p) => s + p[1], 0) / P.length;
  const Q = P.map(([x, y]) => [cx + (x - cx) * 0.5, cy + (y - cy) * 0.5 - 0.08] as [number, number]);
  const out = P.map((p, i) => {
    const j = (i + 1) % P.length;
    const ex = P[j][0] - p[0];
    const ey = P[j][1] - p[1];
    const len = Math.hypot(ex, ey) || 1;
    // Outward normal for a clockwise outline (screen coordinates, y down).
    const nx = ey / len;
    const ny = -ex / len;
    const d = nx * LIGHT[0] + ny * LIGHT[1];
    return {
      d: `M${fmt([p, P[j], Q[j], Q[i]])}Z`,
      fill: d > 0 ? '#ffffff' : '#000000',
      opacity: d > 0 ? 0.08 + 0.34 * d : 0.1 + 0.32 * -d,
    };
  });
  const v = { outer: fmt(P), table: fmt(Q), facets: out };
  facetCache.set(index, v);
  return v;
}

/** A gem centred on the origin, `size` px from centre to girdle. */
export function Gem({ index, size, dim }: { index: number; size: number; dim?: boolean }) {
  const s = GEM_STYLES[index];
  const f = facets(index);
  return (
    <g className={'dm-gem-shape' + (dim ? ' dim' : '')} transform={`scale(${size})`} aria-label={s.name}>
      <polygon points={f.outer} fill={s.color} />
      {f.facets.map((x, i) => (
        <path key={i} d={x.d} fill={x.fill} fillOpacity={x.opacity} />
      ))}
      <polygon points={f.table} fill="#ffffff" fillOpacity={0.2} />
      <polygon points={f.outer} fill="none" stroke="#ffffff" strokeOpacity={0.55} strokeWidth={0.05} strokeLinejoin="round" />
      <path d="M-0.34,-0.46 l0.1,-0.06 l0.02,0.1 Z" fill="#ffffff" fillOpacity={0.85} />
    </g>
  );
}

/** A small flat gem for the paytable icons. */
export function MiniGem({ index }: { index: number }) {
  const s = GEM_STYLES[index];
  return (
    <svg viewBox="-1.2 -1.2 2.4 2.4" className="dm-mini" aria-hidden="true">
      <polygon points={fmt(s.points)} fill={s.color} stroke="#ffffff" strokeOpacity={0.4} strokeWidth={0.12} strokeLinejoin="round" />
    </svg>
  );
}
