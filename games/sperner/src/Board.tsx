import { COLOUR_NAMES, geometry, isRainbow, type Colours, type Tri } from './math';

/** Vertex colours: A (top), B (bottom-left), C (bottom-right). Kept clear of the red / green / gold used for risk, wins and cash. */
export const PALETTE = ['#38c6ff', '#ffd23f', '#b07cff'] as const;

const W = 400;
const H = 372;
const APEX = { x: 200, y: 44 };
const SIDE = 316;
const ROOT3_2 = Math.sqrt(3) / 2;

export function pos(m: number, i: number, j: number) {
  const s = SIDE / m;
  return { x: APEX.x + (j - i / 2) * s, y: APEX.y + i * s * ROOT3_2 };
}

const RADIUS: Record<number, number> = { 3: 12.5, 4: 11.5, 5: 10.5 };

// Each colour's wedge of an uncoloured vertex points at its corner (screen angles, y down).
const SIDE_DIRS: Record<string, number[]> = {
  left: [-60, 120], // A up-right, B down-left
  right: [-120, 60], // A up-left, C down-right
  bottom: [180, 0], // B left, C right
};
const INNER_DIRS = [-90, 150, 30];

function wedge(cx: number, cy: number, r: number, from: number, to: number) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const a = { x: cx + r * Math.cos(rad(from)), y: cy + r * Math.sin(rad(from)) };
  const b = { x: cx + r * Math.cos(rad(to)), y: cy + r * Math.sin(rad(to)) };
  return `M ${cx.toFixed(2)} ${cy.toFixed(2)} L ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)} Z`;
}

function arc(cx: number, cy: number, r: number, from: number, to: number) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const a = { x: cx + r * Math.cos(rad(from)), y: cy + r * Math.sin(rad(from)) };
  const b = { x: cx + r * Math.cos(rad(to)), y: cy + r * Math.sin(rad(to)) };
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

const dirsFor = (m: number, i: number, j: number, n: number) =>
  n === 3 ? INNER_DIRS : i === m ? SIDE_DIRS.bottom : j === 0 ? SIDE_DIRS.left : SIDE_DIRS.right;

/** The possible colours of a vertex as a solid pie, each wedge facing its corner (used while it spins). */
function Pie({ m, i, j, allowed, r }: { m: number; i: number; j: number; allowed: readonly number[]; r: number }) {
  const { x, y } = pos(m, i, j);
  const dirs = dirsFor(m, i, j, allowed.length);
  const half = 180 / allowed.length;
  return (
    <>
      {allowed.map((c, k) => (
        <path key={c} d={wedge(x, y, r, dirs[k] - half, dirs[k] + half)} fill={PALETTE[c]} />
      ))}
    </>
  );
}

/** An uncoloured vertex: a dark disc ringed by its possible colours (equal shares, each facing its corner). */
function Ring({ m, i, j, allowed, r }: { m: number; i: number; j: number; allowed: readonly number[]; r: number }) {
  const { x, y } = pos(m, i, j);
  const dirs = dirsFor(m, i, j, allowed.length);
  const half = 180 / allowed.length;
  const gap = 13;
  return (
    <>
      <circle cx={x} cy={y} r={r} className="sp-open-disc" />
      {allowed.map((c, k) => (
        <path key={c} d={arc(x, y, r - 2.2, dirs[k] - half + gap / 2, dirs[k] + half - gap / 2)} stroke={PALETTE[c]} className="sp-open-arc" />
      ))}
    </>
  );
}

function centroid(pts: { x: number; y: number }[]) {
  return { x: (pts[0].x + pts[1].x + pts[2].x) / 3, y: (pts[0].y + pts[1].y + pts[2].y) / 3 };
}

const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const poly = (pts: { x: number; y: number }[]) => pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');

export interface BoardProps {
  m: number;
  /** What the board shows (−1 = not coloured yet). */
  colours: Colours;
  /** The vertex spinning right now. */
  spinning: number | null;
  /** The vertex "Colour next" would colour (checkpoint only). */
  next: number | null;
  /** The row being coloured, banded while live. */
  row: number | null;
  /** Animation speed factor: 1, or about ¼ in turbo. */
  speed: number;
}

export default function Board({ m, colours, spinning, next, row, speed }: BoardProps) {
  const g = geometry(m);
  const r = RADIUS[m];
  const pt = (v: number) => pos(m, g.vertices[v].i, g.vertices[v].j);
  const done = (t: Tri) => t.v.every((v) => colours[v] >= 0);
  const rainbowTris = g.tris.filter((t) => isRainbow(colours, t));
  const corners = [pos(m, 0, 0), pos(m, m, 0), pos(m, m, m)];
  const sideMid = (a: number, b: number) => mid(corners[a], corners[b]);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="sp-tri"
      role="img"
      aria-label={`${m * m} small triangles, ${rainbowTris.length} rainbow${rainbowTris.length === 1 ? '' : 's'} so far`}
      style={{ ['--sp-speed' as string]: speed }}
    >
      {/* The big triangle. */}
      <polygon points={poly(corners)} className="sp-outer" />

      {/* The row being coloured. */}
      {row !== null && (
        <rect
          className="sp-band"
          x={pos(m, row, 0).x - r - 7}
          y={pos(m, row, 0).y - r - 7}
          width={pos(m, row, row).x - pos(m, row, 0).x + 2 * r + 14}
          height={2 * r + 14}
          rx={r + 7}
        />
      )}

      {/* Small triangles: tinted when finished, split into three colours when rainbow. */}
      {g.tris.map((t) => {
        const pts = t.v.map(pt);
        if (!done(t) || isRainbow(colours, t)) return <polygon key={t.id} points={poly(pts)} className="sp-cell" />;
        const cs = t.v.map((v) => colours[v]);
        const major = cs[0] === cs[1] || cs[0] === cs[2] ? cs[0] : cs[1];
        return <polygon key={`${t.id}-${cs.join('')}`} points={poly(pts)} className="sp-cell done" style={{ fill: PALETTE[major] }} />;
      })}
      {rainbowTris.map((t, n) => {
        const pts = t.v.map(pt);
        const c = centroid(pts);
        return (
          <g key={`${t.id}-rb`} className="sp-rainbow">
            {pts.map((p, k) => (
              <polygon
                key={k}
                points={poly([p, mid(p, pts[(k + 1) % 3]), c, mid(p, pts[(k + 2) % 3])])}
                fill={PALETTE[colours[t.v[k]]]}
                className="sp-kite"
              />
            ))}
            <polygon points={poly(pts)} className="sp-rb-edge" />
            <circle cx={c.x} cy={c.y} r={m === 5 ? 8 : 9} className="sp-badge" />
            <text x={c.x} y={c.y + 3.6} className="sp-badge-n">
              {n + 1}
            </text>
          </g>
        );
      })}

      {/* Which colours each side allows. */}
      <SideLabel at={sideMid(0, 1)} dir={[-ROOT3_2, -0.5]} angle={-60} a={0} b={1} />
      <SideLabel at={sideMid(0, 2)} dir={[ROOT3_2, -0.5]} angle={60} a={0} b={2} />
      <SideLabel at={sideMid(1, 2)} dir={[0, 1]} angle={0} a={1} b={2} />

      {/* Vertices. */}
      {g.vertices.map((v) => {
        const { x, y } = pos(m, v.i, v.j);
        const c = colours[v.id];
        const corner = v.allowed.length === 1;
        const rr = corner ? r + 3 : r;
        if (v.id === spinning) {
          return (
            <g key={`${v.id}-spin`}>
              <circle cx={x} cy={y} r={rr + 5} className="sp-spin-ring" />
              <g className="sp-spin" style={{ transformOrigin: `${x}px ${y}px` }}>
                <Pie m={m} i={v.i} j={v.j} allowed={v.allowed} r={rr} />
              </g>
            </g>
          );
        }
        if (c < 0) {
          return (
            <g key={`${v.id}-u`} className={'sp-open' + (v.id === next ? ' next' : '')}>
              {v.id === next && <circle cx={x} cy={y} r={rr + 6} className="sp-next-ring" />}
              <Ring m={m} i={v.i} j={v.j} allowed={v.allowed} r={rr} />
            </g>
          );
        }
        return (
          <g key={`${v.id}-${c}`} className={'sp-dot' + (corner ? ' corner' : ' landed')} style={{ transformOrigin: `${x}px ${y}px` }}>
            <circle cx={x} cy={y} r={rr} fill={PALETTE[c]} />
            <text x={x} y={y + (corner ? 4.6 : 3.8)} className={'sp-letter' + (corner ? ' big' : '')}>
              {COLOUR_NAMES[c]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function SideLabel({ at, dir, angle, a, b }: { at: { x: number; y: number }; dir: [number, number]; angle: number; a: number; b: number }) {
  const x = at.x + dir[0] * 31;
  const y = at.y + dir[1] * 31;
  return (
    <text x={x} y={y + 4} className="sp-side" transform={`rotate(${angle} ${x} ${y})`}>
      <tspan fill={PALETTE[a]}>{COLOUR_NAMES[a]}</tspan>
      <tspan className="sp-side-or"> or </tspan>
      <tspan fill={PALETTE[b]}>{COLOUR_NAMES[b]}</tspan>
      <tspan className="sp-side-or"> only</tspan>
    </text>
  );
}
