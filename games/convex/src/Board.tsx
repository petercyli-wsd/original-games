import type { CSSProperties } from 'react';
import { fmtChance } from '@originals/game-sdk/ui';
import { FREE_DROPS, arenaArea, arenaPolygon, hull, newWedge, polygonArea, type Arena, type Pt, type Target, type Zones } from './math';

// Unit coordinates (y up) map onto a 360-unit box, with a corner-progress row
// above it and the colour legend below it. When the round ends the legend
// gives way to the result card, which sits over that band (and the slack under
// the SVG), so the finished shape is never covered.
const W = 400;
const PAD = 20;
const TOP = 30;
const SIZE = 360;
const LEG = TOP + SIZE;
const HGT = LEG + 48;
const X = (x: number) => PAD + SIZE * x;
const Y = (y: number) => TOP + SIZE * (1 - y);
const svgPts = (poly: readonly Pt[]) => poly.map((p) => `${X(p.x).toFixed(2)},${Y(p.y).toFixed(2)}`).join(' ');
const ring = (poly: readonly Pt[]) => 'M' + poly.map((p) => `${X(p.x).toFixed(2)} ${Y(p.y).toFixed(2)}`).join('L') + 'Z';
const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Grid lines that cut the arena into 100 equal cells (1% each). */
function gridLines(arena: Arena): [Pt, Pt][] {
  const out: [Pt, Pt][] = [];
  if (arena === 'square') {
    for (let k = 1; k < 10; k++) {
      out.push([{ x: k / 10, y: 0 }, { x: k / 10, y: 1 }]);
      out.push([{ x: 0, y: k / 10 }, { x: 1, y: k / 10 }]);
    }
    return out;
  }
  // Lines parallel to each side at tenths: 100 congruent small triangles.
  const [a, b, c] = arenaPolygon('triangle');
  for (let k = 1; k < 10; k++) {
    const t = k / 10;
    out.push([lerp(a, c, t), lerp(b, c, t)]);
    out.push([lerp(b, a, t), lerp(b, c, t)]);
    out.push([lerp(a, b, t), lerp(a, c, t)]);
  }
  return out;
}

/** A regular n-gon preview of the target shape, inside the arena. */
function ghost(arena: Arena, n: number): { centre: Pt; corners: Pt[] } {
  const [a, , c] = arenaPolygon(arena);
  const centre = arena === 'square' ? { x: 0.5, y: 0.5 } : { x: 0.5, y: a.y + (c.y - a.y) / 3 };
  const r = arena === 'square' ? 0.35 : 0.245;
  const corners = Array.from({ length: n }, (_, k) => {
    const t = Math.PI / 2 + (2 * Math.PI * k) / n;
    return { x: centre.x + r * Math.cos(t), y: centre.y + r * Math.sin(t) };
  });
  return { centre, corners };
}

const centroid = (poly: readonly Pt[]) => ({
  x: poly.reduce((s, p) => s + p.x, 0) / poly.length,
  y: poly.reduce((s, p) => s + p.y, 0) / poly.length,
});

/** Where to write each cap's percentage, in SVG units: big caps first, skipping tiny caps and labels that would overlap. */
function capLabels(caps: readonly Pt[][], area: number) {
  const placed: { x: number; y: number; pct: number }[] = [];
  const order = caps.map((c) => ({ c, share: polygonArea(c) / area })).sort((a, b) => b.share - a.share);
  for (const { c, share } of order) {
    if (share < 0.035) break;
    const m = centroid(c);
    const x = X(m.x);
    const y = Y(m.y);
    if (placed.some((p) => Math.abs(p.x - x) < 34 && Math.abs(p.y - y) < 18)) continue;
    placed.push({ x, y, pct: Math.round(share * 100) });
  }
  return placed;
}

export interface BustInfo {
  point: Pt;
  swallowed: Pt[];
}

export interface BoardProps {
  arena: Arena;
  target: Target;
  points: Pt[];
  zones: Zones;
  mode: 'idle' | 'live' | 'over';
  /** Whether the round ended with a full polygon. */
  complete: boolean;
  /** A point is being dropped: the crosshair is travelling to `cursor`. */
  dropping: boolean;
  cursor: Pt;
  crossMs: number;
  fadeMs: number;
  bust: BustInfo | null;
  /** Headline chance to complete, for the idle preview. */
  chance: number;
}

export default function Board({ arena, target, points, zones, mode, complete, dropping, cursor, crossMs, fadeMs, bust, chance }: BoardProps) {
  const poly = arenaPolygon(arena);
  const n = points.length;
  const showZones = mode !== 'idle' && n >= FREE_DROPS && !complete;
  const area = arenaArea(arena);
  const h = zones.hull;
  const last = n > 0 ? points[n - 1] : null;
  const wedge = mode === 'live' && last ? newWedge(h, last) : null;
  const wouldBe = bust ? hull([...points, bust.point]) : null;
  const preview = mode === 'idle' ? ghost(arena, target) : null;
  const vars = { '--cross-ms': `${crossMs}ms`, '--fade-ms': `${fadeMs}ms` } as CSSProperties;
  const redPath = ring(poly) + zones.caps.map(ring).join('');

  const label =
    mode === 'idle'
      ? `${arena} arena, ${target} corners to build, ${fmtChance(chance)} to complete`
      : `${n} of ${target} corners. Red area ${fmtChance(zones.q)} of the arena.`;

  return (
    <svg viewBox={`0 0 ${W} ${HGT}`} className={`cvx ${mode}`} style={vars} role="img" aria-label={label}>
      <defs>
        <clipPath id="cvx-clip">
          <polygon points={svgPts(poly)} />
        </clipPath>
        <pattern id="cvx-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="8" className="hatch-line" />
        </pattern>
      </defs>

      <Progress n={n} target={target} complete={complete} mode={mode} />

      <polygon points={svgPts(poly)} className="arena" />
      <g clipPath="url(#cvx-clip)">
        <g className="grid">
          {gridLines(arena).map(([a, b], i) => (
            <line key={i} x1={X(a.x)} y1={Y(a.y)} x2={X(b.x)} y2={Y(b.y)} />
          ))}
        </g>

        {showZones && (
          <g key={`${arena}-${n}`} className="zones">
            <path d={redPath} fillRule="evenodd" className="bust-area" />
            <path d={redPath} fillRule="evenodd" className="bust-hatch" />
            {zones.caps.map((c, i) => (
              <polygon key={i} points={svgPts(c)} className="cap" />
            ))}
            {h.map((a, i) => {
              const b = h[(i + 1) % h.length];
              const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
              const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
              return <line key={i} x1={X(a.x - 2 * d.x)} y1={Y(a.y - 2 * d.y)} x2={X(b.x + 2 * d.x)} y2={Y(b.y + 2 * d.y)} className="ext" />;
            })}
          </g>
        )}
      </g>
      <polygon points={svgPts(poly)} className="arena-edge" />

      {/* Each green cap's share of the arena (biggest first; a label that would collide is skipped). */}
      {showZones && capLabels(zones.caps, area).map((l) => (
        <text key={`${n}-${l.x.toFixed(1)}-${l.y.toFixed(1)}`} x={l.x} y={l.y + 4.5} className="cap-label">
          {l.pct}%
        </text>
      ))}

      {/* Idle: the target shape as a ghost polygon, the free corners filled. */}
      {preview && (
        <g key={`${arena}-${target}`} className="ghost">
          <polygon points={svgPts(preview.corners)} />
          {preview.corners.map((p, i) => (
            <circle key={i} cx={X(p.x)} cy={Y(p.y)} r={6} className={i < FREE_DROPS ? 'free' : ''} />
          ))}
          <text x={X(preview.centre.x)} y={Y(preview.centre.y) - 4} className="ghost-n">
            {target}
          </text>
          <text x={X(preview.centre.x)} y={Y(preview.centre.y) + 15} className="ghost-sub">
            corners
          </text>
          <text x={X(preview.centre.x)} y={Y(preview.centre.y) + 34} className="ghost-odds">
            {fmtChance(chance)} to complete
          </text>
        </g>
      )}

      {/* Your shape: the hull. */}
      {n === 2 && <line x1={X(points[0].x)} y1={Y(points[0].y)} x2={X(points[1].x)} y2={Y(points[1].y)} className="hull" />}
      {n >= 3 && (
        <polygon
          key={complete ? 'done' : 'live'}
          points={svgPts(h)}
          className={'hull' + (showZones ? ' over-red' : '') + (complete ? ' complete' : '') + (bust && bust.swallowed.length === 0 ? ' hit' : '')}
        />
      )}
      {wedge && <polygon key={`w-${n}`} points={svgPts(wedge)} className="wedge" />}
      {wouldBe && <polygon points={svgPts(wouldBe)} className="would-be" />}

      {points.map((p, i) => (
        <circle key={`${i}-${p.x}`} cx={X(p.x)} cy={Y(p.y)} r={i === n - 1 ? 7.5 : 6} className={'pt' + (i === n - 1 && mode !== 'idle' ? ' last' : '')} />
      ))}
      {last && mode === 'live' && !dropping && <circle key={`r-${n}`} cx={X(last.x)} cy={Y(last.y)} r={9} className="ripple" />}
      {bust?.swallowed.map((p, i) => <circle key={i} cx={X(p.x)} cy={Y(p.y)} r={13} className="swallow-ring" />)}
      {bust && (
        <>
          <circle cx={X(bust.point.x)} cy={Y(bust.point.y)} r={9} className="ripple bad" />
          <circle cx={X(bust.point.x)} cy={Y(bust.point.y)} r={8} className="pt busted" />
        </>
      )}

      {/* The crosshair travels to where the next point lands. */}
      <g className={'cross' + (dropping ? ' on' : '')} clipPath="url(#cvx-clip)">
        <line x1={0} y1={TOP} x2={0} y2={TOP + SIZE} style={{ transform: `translate(${X(cursor.x)}px, 0px)` }} />
        <line x1={PAD} y1={0} x2={PAD + SIZE} y2={0} style={{ transform: `translate(0px, ${Y(cursor.y)}px)` }} />
      </g>
      <g className={'reticle' + (dropping ? ' on' : '')} style={{ transform: `translate(${X(cursor.x)}px, ${Y(cursor.y)}px)` }}>
        <circle r={12} />
        <circle r={2.5} className="dot" />
      </g>

      {mode !== 'over' && <Legend mode={mode} n={n} q={zones.q} />}
    </svg>
  );
}

/** Corner progress above the arena: one pip per corner, the free ones marked. */
function Progress({ n, target, complete, mode }: { n: number; target: number; complete: boolean; mode: BoardProps['mode'] }) {
  const y = 13;
  const gap = 18;
  const x0 = W / 2 - ((target - 1) * gap) / 2;
  return (
    <g className="progress">
      <text x={PAD} y={y + 4} className="start pip-label">
        Corners
      </text>
      {Array.from({ length: target }, (_, i) => (
        <circle
          key={i}
          cx={x0 + i * gap}
          cy={y}
          r={5.5}
          className={'pip' + (i < n ? ' on' : '') + (i < FREE_DROPS ? ' free' : '') + (complete ? ' done' : '')}
        />
      ))}
      <text x={W - PAD} y={y + 4} className="end pip-count">
        {mode === 'idle' ? `${target} to build` : `${n} / ${target}`}
      </text>
    </g>
  );
}

/** What the colours mean, with the live red and green shares. */
function Legend({ mode, n, q }: { mode: 'idle' | 'live'; n: number; q: number }) {
  const y1 = LEG + 21;
  const y2 = LEG + 38;
  if (mode === 'live' && n >= FREE_DROPS) {
    return (
      <g className="legend">
        <rect x={PAD} y={y1 - 11} width={12} height={12} rx={2.5} className="sw bust" />
        <text x={PAD + 19} y={y1} className="start lg bust">
          BUST {fmtChance(q)}
        </text>
        <text x={PAD + 19} y={y2} className="start lg-sub">
          inside, or behind a corner
        </text>
        <rect x={W - PAD - 12} y={y1 - 11} width={12} height={12} rx={2.5} className="sw safe" />
        <text x={W - PAD - 19} y={y1} className="end lg safe">
          SAFE {fmtChance(1 - q)}
        </text>
        <text x={W - PAD - 19} y={y2} className="end lg-sub">
          becomes a new corner
        </text>
      </g>
    );
  }
  const [a, b] =
    mode === 'idle'
      ? ['Each grid cell is 1% of the arena.', 'The first 3 drops are free; after that, red is risk.']
      : [`Free drop ${Math.min(n + 1, FREE_DROPS)} of ${FREE_DROPS}: any three points make a triangle.`, 'The red risk zone appears from corner 4.'];
  return (
    <g className="legend">
      <text x={W / 2} y={y1} className="lg-note">
        {a}
      </text>
      <text x={W / 2} y={y2} className="lg-sub">
        {b}
      </text>
    </g>
  );
}
