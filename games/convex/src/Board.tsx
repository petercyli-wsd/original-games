import type { CSSProperties } from 'react';
import { fmtChance } from '@originals/game-sdk/ui';
import { FREE_DROPS, SQUARE, type Pt, type Target, type Zones } from './math';

// Unit coordinates (y up) map onto a 360-unit box, with a dot-progress row above it.
const W = 400;
const PAD = 20;
const TOP = 30;
const SIZE = 360;
const HGT = TOP + SIZE + 10;
const X = (x: number) => PAD + SIZE * x;
const Y = (y: number) => TOP + SIZE * (1 - y);
const svgPts = (poly: readonly Pt[]) => poly.map((p) => `${X(p.x).toFixed(2)},${Y(p.y).toFixed(2)}`).join(' ');
const ring = (poly: readonly Pt[]) => 'M' + poly.map((p) => `${X(p.x).toFixed(2)} ${Y(p.y).toFixed(2)}`).join('L') + 'Z';

/** A regular n-gon preview of the dots to place, inside the square. */
function ghost(n: number): { centre: Pt; corners: Pt[] } {
  const centre = { x: 0.5, y: 0.5 };
  const corners = Array.from({ length: n }, (_, k) => {
    const t = Math.PI / 2 + (2 * Math.PI * k) / n;
    return { x: centre.x + 0.35 * Math.cos(t), y: centre.y + 0.35 * Math.sin(t) };
  });
  return { centre, corners };
}

export interface BustInfo {
  point: Pt;
  swallowed: Pt[];
}

export interface BoardProps {
  target: Target;
  points: Pt[];
  zones: Zones;
  mode: 'idle' | 'live' | 'over';
  /** Whether the round ended with every dot placed. */
  complete: boolean;
  /** A dot is being dropped: the crosshair is travelling to `cursor`. */
  dropping: boolean;
  cursor: Pt;
  crossMs: number;
  bust: BustInfo | null;
  /** Exact chance to place every dot, for the idle preview. */
  chance: number;
}

export default function Board({ target, points, zones, mode, complete, dropping, cursor, crossMs, bust, chance }: BoardProps) {
  const n = points.length;
  const showZones = mode !== 'idle' && n >= FREE_DROPS && !complete;
  const h = zones.hull;
  const preview = mode === 'idle' ? ghost(target) : null;
  const vars = { '--cross-ms': `${crossMs}ms` } as CSSProperties;
  // One red region: the whole square minus the green caps (even-odd fill).
  const redPath = ring(SQUARE) + zones.caps.map(ring).join('');

  const label =
    mode === 'idle'
      ? `${target} dots to place, ${fmtChance(chance)} chance to place them all`
      : `${n} of ${target} dots placed. Red ${fmtChance(zones.q)} of the square, green ${fmtChance(1 - zones.q)}.`;

  return (
    <svg viewBox={`0 0 ${W} ${HGT}`} className={`cvx ${mode}${bust ? ' lost' : ''}`} style={vars} role="img" aria-label={label}>
      <defs>
        <clipPath id="cvx-clip">
          <polygon points={svgPts(SQUARE)} />
        </clipPath>
      </defs>

      <Progress n={n} target={target} complete={complete} mode={mode} />

      <polygon points={svgPts(SQUARE)} className="arena" />
      <g clipPath="url(#cvx-clip)">
        {showZones && (
          <g className="zones">
            <path d={redPath} fillRule="evenodd" className="bust-area" />
            {zones.caps.map((c, i) => (
              <polygon key={i} points={svgPts(c)} className="cap" />
            ))}
          </g>
        )}
      </g>
      <polygon points={svgPts(SQUARE)} className="arena-edge" />

      {/* Idle: the dots to place as a ghost shape. */}
      {preview && (
        <g key={target} className="ghost">
          <polygon points={svgPts(preview.corners)} />
          {preview.corners.map((p, i) => (
            <circle key={i} cx={X(p.x)} cy={Y(p.y)} r={6} />
          ))}
          <text x={X(preview.centre.x)} y={Y(preview.centre.y) + 14} className="ghost-n">
            {target}
          </text>
        </g>
      )}

      {/* The shape the dots make. */}
      {n === 2 && <line x1={X(points[0].x)} y1={Y(points[0].y)} x2={X(points[1].x)} y2={Y(points[1].y)} className="hull" />}
      {n >= 3 && (
        <polygon
          points={svgPts(h)}
          className={'hull' + (complete ? ' complete' : '') + (bust && bust.swallowed.length === 0 ? ' hit' : '')}
        />
      )}

      {points.map((p, i) => {
        // The last dot is the player's (accent) until the round ends, then keeps its outcome colour.
        const lastDot = i === n - 1 && mode !== 'idle';
        const done = lastDot && mode === 'over' && complete;
        return <circle key={`${i}-${p.x}`} cx={X(p.x)} cy={Y(p.y)} r={lastDot ? 7.5 : 6} className={'pt' + (lastDot ? ' last' : '') + (done ? ' done' : '')} />;
      })}
      {/* A dot that lands in a shadow pulls the dot in front of it inside the shape: ring that dot. */}
      {bust?.swallowed.map((p, i) => <circle key={i} cx={X(p.x)} cy={Y(p.y)} r={13} className="swallow-ring" />)}
      {bust && <circle cx={X(bust.point.x)} cy={Y(bust.point.y)} r={8} className="pt busted" />}

      {/* The crosshair travels to where the next dot lands. */}
      <g className={'cross' + (dropping ? ' on' : '')} clipPath="url(#cvx-clip)">
        <line x1={0} y1={TOP} x2={0} y2={TOP + SIZE} style={{ transform: `translate(${X(cursor.x)}px, 0px)` }} />
        <line x1={PAD} y1={0} x2={PAD + SIZE} y2={0} style={{ transform: `translate(0px, ${Y(cursor.y)}px)` }} />
      </g>
      <g className={'reticle' + (dropping ? ' on' : '')} style={{ transform: `translate(${X(cursor.x)}px, ${Y(cursor.y)}px)` }}>
        <circle r={12} />
        <circle r={2.5} className="dot" />
      </g>
    </svg>
  );
}

/** Dot progress above the square: one pip per dot. */
function Progress({ n, target, complete, mode }: { n: number; target: number; complete: boolean; mode: BoardProps['mode'] }) {
  const y = 13;
  const gap = 18;
  const x0 = W / 2 - ((target - 1) * gap) / 2;
  return (
    <g className="progress">
      {Array.from({ length: target }, (_, i) => (
        <circle key={i} cx={x0 + i * gap} cy={y} r={5.5} className={'pip' + (i < n ? ' on' : '') + (complete ? ' done' : '')} />
      ))}
      <text x={W - PAD} y={y + 4} className="end pip-count">
        {mode === 'idle' ? `${target} to place` : `${n} / ${target}`}
      </text>
    </g>
  );
}
