import type { CSSProperties } from 'react';
import { fmtChance } from '@originals/game-sdk/ui';
import { FREE_DROPS, SQUARE, newWedge, polygonArea, type Pt, type Target, type Zones } from './math';

// Unit coordinates (y up) map onto a 360-unit box, with a dot-progress row
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

/** Grid lines that cut the square into 100 equal cells (1% each). */
const GRID: [Pt, Pt][] = Array.from({ length: 9 }, (_, i) => {
  const k = (i + 1) / 10;
  return [
    [{ x: k, y: 0 }, { x: k, y: 1 }],
    [{ x: 0, y: k }, { x: 1, y: k }],
  ] as [Pt, Pt][];
}).flat();

/** A regular n-gon preview of the dots to place, inside the square. */
function ghost(n: number): { centre: Pt; corners: Pt[] } {
  const centre = { x: 0.5, y: 0.5 };
  const corners = Array.from({ length: n }, (_, k) => {
    const t = Math.PI / 2 + (2 * Math.PI * k) / n;
    return { x: centre.x + 0.35 * Math.cos(t), y: centre.y + 0.35 * Math.sin(t) };
  });
  return { centre, corners };
}

const centroid = (poly: readonly Pt[]) => ({
  x: poly.reduce((s, p) => s + p.x, 0) / poly.length,
  y: poly.reduce((s, p) => s + p.y, 0) / poly.length,
});

/** Where to write each green cap's percentage, in SVG units: big caps first, skipping tiny caps and labels that would overlap. */
function capLabels(caps: readonly Pt[][]) {
  const placed: { x: number; y: number; pct: number }[] = [];
  const order = caps.map((c) => ({ c, share: polygonArea(c) })).sort((a, b) => b.share - a.share);
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

/** Where to write "LOSE" inside the shape: its centroid, if the label fits clear of every edge and dot. */
function loseLabel(h: readonly Pt[]): { x: number; y: number } | null {
  if (h.length < 3) return null;
  const m = centroid(h);
  const c = { x: X(m.x), y: Y(m.y) };
  const sv = h.map((p) => ({ x: X(p.x), y: Y(p.y) }));
  for (let i = 0; i < sv.length; i++) {
    const a = sv[i];
    const b = sv[(i + 1) % sv.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    // Distance from the label's centre to the edge line, with room for a 40 × 14 label.
    const d = Math.abs((b.x - a.x) * (a.y - c.y) - (a.x - c.x) * (b.y - a.y)) / len;
    const reach = (20 * Math.abs(b.y - a.y) + 7 * Math.abs(b.x - a.x)) / len;
    if (d < reach + 6) return null;
    if (Math.hypot(a.x - c.x, a.y - c.y) < 30) return null;
  }
  return c;
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
  fadeMs: number;
  bust: BustInfo | null;
  /** Exact chance to place every dot, for the idle preview. */
  chance: number;
}

export default function Board({ target, points, zones, mode, complete, dropping, cursor, crossMs, fadeMs, bust, chance }: BoardProps) {
  const n = points.length;
  const showZones = mode !== 'idle' && n >= FREE_DROPS && !complete;
  const h = zones.hull;
  const last = n > 0 ? points[n - 1] : null;
  const wedge = mode === 'live' && last ? newWedge(h, last) : null;
  const preview = mode === 'idle' ? ghost(target) : null;
  const lose = showZones && mode === 'live' ? loseLabel(h) : null;
  const vars = { '--cross-ms': `${crossMs}ms`, '--fade-ms': `${fadeMs}ms` } as CSSProperties;
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
          <g key={n} className="zones">
            <path d={redPath} fillRule="evenodd" className="bust-area" />
            {zones.caps.map((c, i) => (
              <polygon key={i} points={svgPts(c)} className="cap" />
            ))}
          </g>
        )}
        <g className="grid">
          {GRID.map(([a, b], i) => (
            <line key={i} x1={X(a.x)} y1={Y(a.y)} x2={X(b.x)} y2={Y(b.y)} />
          ))}
        </g>
      </g>
      <polygon points={svgPts(SQUARE)} className="arena-edge" />

      {/* Each green cap's share of the square (biggest first; a label that would collide is skipped). */}
      {showZones &&
        capLabels(zones.caps).map((l) => (
          <text key={`${n}-${l.x.toFixed(1)}-${l.y.toFixed(1)}`} x={l.x} y={l.y + 4.5} className="cap-label">
            {l.pct}%
          </text>
        ))}

      {/* Idle: the dots to place as a ghost shape, the free ones filled. */}
      {preview && (
        <g key={target} className="ghost">
          <polygon points={svgPts(preview.corners)} />
          {preview.corners.map((p, i) => (
            <circle key={i} cx={X(p.x)} cy={Y(p.y)} r={6} className={i < FREE_DROPS ? 'free' : ''} />
          ))}
          <text x={X(preview.centre.x)} y={Y(preview.centre.y) - 4} className="ghost-n">
            {target}
          </text>
          <text x={X(preview.centre.x)} y={Y(preview.centre.y) + 15} className="ghost-sub">
            dots to place
          </text>
          <text x={X(preview.centre.x)} y={Y(preview.centre.y) + 34} className="ghost-odds">
            {fmtChance(chance)} to place all
          </text>
        </g>
      )}

      {/* The shape the dots make. */}
      {n === 2 && <line x1={X(points[0].x)} y1={Y(points[0].y)} x2={X(points[1].x)} y2={Y(points[1].y)} className="hull" />}
      {n >= 3 && (
        <polygon
          key={complete ? 'done' : 'live'}
          points={svgPts(h)}
          className={'hull' + (showZones ? ' over-red' : '') + (complete ? ' complete' : '') + (bust && bust.swallowed.length === 0 ? ' hit' : '')}
        />
      )}
      {wedge && <polygon key={`w-${n}`} points={svgPts(wedge)} className="wedge" />}
      {lose && (
        <text key={`l-${n}`} x={lose.x} y={lose.y + 4.5} className="lose-label">
          LOSE
        </text>
      )}

      {points.map((p, i) => (
        <circle key={`${i}-${p.x}`} cx={X(p.x)} cy={Y(p.y)} r={i === n - 1 ? 7.5 : 6} className={'pt' + (i === n - 1 && mode !== 'idle' ? ' last' : '')} />
      ))}
      {last && mode === 'live' && !dropping && <circle key={`r-${n}`} cx={X(last.x)} cy={Y(last.y)} r={9} className="ripple" />}
      {/* A dot that lands in a shadow pulls the dot in front of it inside the shape: ring that dot. */}
      {bust?.swallowed.map((p, i) => <circle key={i} cx={X(p.x)} cy={Y(p.y)} r={13} className="swallow-ring" />)}
      {bust && (
        <>
          <circle cx={X(bust.point.x)} cy={Y(bust.point.y)} r={9} className="ripple bad" />
          <circle cx={X(bust.point.x)} cy={Y(bust.point.y)} r={8} className="pt busted" />
        </>
      )}

      {/* The crosshair travels to where the next dot lands. */}
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

/** Dot progress above the square: one pip per dot, the free ones marked. */
function Progress({ n, target, complete, mode }: { n: number; target: number; complete: boolean; mode: BoardProps['mode'] }) {
  const y = 13;
  const gap = 18;
  const x0 = W / 2 - ((target - 1) * gap) / 2;
  return (
    <g className="progress">
      <text x={PAD} y={y + 4} className="start pip-label">
        Dots
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
        {mode === 'idle' ? `${target} to place` : `${n} / ${target}`}
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
          RED {fmtChance(q)}
        </text>
        <text x={PAD} y={y2} className="start lg-sub">
          land here and you lose
        </text>
        <rect x={W - PAD - 12} y={y1 - 11} width={12} height={12} rx={2.5} className="sw safe" />
        <text x={W - PAD - 19} y={y1} className="end lg safe">
          GREEN {fmtChance(1 - q)}
        </text>
        <text x={W - PAD} y={y2} className="end lg-sub">
          land here and you are safe
        </text>
      </g>
    );
  }
  const [a, b] =
    mode === 'idle'
      ? ['Each grid cell is 1% of the square.', 'The first 3 dots are free. Then: land in green.']
      : [`Free dot ${Math.min(n + 1, FREE_DROPS)} of ${FREE_DROPS}: it always lands safe.`, 'Green and red zones appear from dot 4.'];
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
