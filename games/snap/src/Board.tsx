import { useCallback, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent, type Ref } from 'react';
import { HALF, landscape, longPiece, pieces, polygonSides, winChance, winZone, type Piece, type Zone } from './math';

// Geometry of the board, in viewBox units. The stick runs from X0 to X1; the
// chance box sits right above it on the same x scale, so every column of the
// box is a spot on the stick.
const VB_W = 560;
const VB_H = 380;
const X0 = 40;
const W = 456;
const X1 = X0 + W;
const CT = 54; // chance box top (100%)
const CB = 204; // chance box bottom (0%)
const CH = CB - CT;
const SY = 228; // stick centre
const ST = 22; // stick thickness
const LY = 266; // piece labels
const R1 = 292; // ½ ruler from the long piece's left end
const R2 = 314; // ½ ruler from its right end
const DROP = SY - ST / 2 - 46; // how far the blade head falls

const sx = (u: number) => X0 + u * W;
const sy = (h: number) => CB - h * CH;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const fmtP = (p: number) => (p >= 1 ? '100%' : p <= 0 ? '0%' : `${(p * 100).toFixed(1)}%`);

export interface Blade {
  /** Where the blade is (fraction of the stick). */
  x: number;
  down: boolean;
  on: boolean;
}

export type Outcome = 'polygon' | 'stuck' | 'cashed';

export interface BoardProps {
  /** Your break, in percent. */
  brk: number;
  /** Random cuts already counted (fractions of the stick). */
  cuts: number[];
  /** The cut that has just landed and is being read off the chart. */
  landing: { u: number; p: number } | null;
  total: number;
  blade: Blade;
  slideMs: number;
  dropMs: number;
  foldMs: number;
  outcome: Outcome | null;
  live: boolean;
  /** Drag the break (only while not live). */
  onDrag?: (pct: number) => void;
  svgRef?: Ref<SVGSVGElement>;
}

function zonePath(z: Zone) {
  return `M ${sx(z.start).toFixed(2)} ${CB} L ${sx(z.start).toFixed(2)} ${sy(z.h0).toFixed(2)} L ${sx(z.end).toFixed(2)} ${sy(z.h1).toFixed(2)} L ${sx(z.end).toFixed(2)} ${CB} Z`;
}

function curvePath(zones: Zone[]) {
  return zones.map((z, i) => `${i ? 'L' : 'M'} ${sx(z.start).toFixed(2)} ${sy(z.h0).toFixed(2)} L ${sx(z.end).toFixed(2)} ${sy(z.h1).toFixed(2)}`).join(' ');
}

const samePiece = (a: Piece, b: Piece | null) => !!b && a.start === b.start && a.end === b.end;

/** Blade icons for the cuts: filled = still to fall. */
function CutIcons({ total, fallen, over }: { total: number; fallen: number; over: boolean }) {
  return (
    <g className="cut-icons">
      {Array.from({ length: total }, (_, i) => (
        <path key={i} d={`M ${X0 + i * 20} 13 L ${X0 + i * 20 + 14} 13 L ${X0 + i * 20 + 7} 27 Z`} className={i < fallen ? 'used' : 'todo'} />
      ))}
      {!over && (
        <text x={X0 + total * 20 + 4} y={25} className="hdr">
          {total - fallen === 0 ? 'no cuts left' : `${total - fallen} cut${total - fallen > 1 ? 's' : ''} to fall`}
        </text>
      )}
    </g>
  );
}

/** The pieces fold up into the polygon they make (a cyclic polygon with those sides). */
function PolygonFigure({ ps, foldMs }: { ps: Piece[]; foldMs: number }) {
  const sides = polygonSides(ps.map((p) => p.length));
  const xs = sides.map((s) => s.x1);
  const ys = sides.map((s) => s.y1);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  // Same scale as the stick if it fits, else shrink to the box.
  const s = Math.min(W, (CH - 26) / Math.max(1e-9, maxY - minY), (W - 40) / Math.max(1e-9, maxX - minX));
  const cx = X0 + W / 2 - (s * (minX + maxX)) / 2;
  const cy = CT + 4 + CH / 2 - (s * (minY + maxY)) / 2;
  const pts = sides.map((sd) => `${(cx + s * sd.x1).toFixed(2)},${(cy + s * sd.y1).toFixed(2)}`).join(' ');
  return (
    <g className="figure">
      <polygon points={pts} className="poly-fill" style={{ animationDelay: `${foldMs * 0.7}ms` }} />
      {ps.map((p, i) => {
        const sd = sides[i];
        const ang = (Math.atan2(sd.y2 - sd.y1, sd.x2 - sd.x1) * 180) / Math.PI;
        const from = `translate(${sx(p.start)}px, ${SY}px) rotate(0deg) scale(1)`;
        const to = `translate(${cx + s * sd.x1}px, ${cy + s * sd.y1}px) rotate(${ang}deg) scale(${s / W})`;
        return (
          <line
            key={i}
            x1={0}
            y1={0}
            x2={p.length * W}
            y2={0}
            className="fold side"
            style={{ '--from': from, '--to': to, animationDuration: `${foldMs}ms` } as CSSProperties}
          />
        );
      })}
    </g>
  );
}

/** No polygon: the long piece against all the others laid end to end. */
function StuckFigure({ ps, long, foldMs }: { ps: Piece[]; long: Piece; foldMs: number }) {
  const rowA = CT + 48;
  const rowB = CT + 104;
  const rest = 1 - long.length;
  let at = 0;
  return (
    <g className="figure">
      <text x={X0} y={rowA - 16} className="fig-label">
        long piece {pct(long.length)}
      </text>
      <text x={X0} y={rowB - 16} className="fig-label">
        all the others together {100 - Math.round(long.length * 100)}%
      </text>
      {ps.map((p, i) => {
        const isLong = samePiece(p, long);
        const tx = isLong ? X0 : X0 + at * W;
        if (!isLong) at += p.length;
        const from = `translate(${sx(p.start)}px, ${SY}px) rotate(0deg) scale(1)`;
        const to = `translate(${tx}px, ${isLong ? rowA : rowB}px) rotate(0deg) scale(1)`;
        return (
          <line
            key={i}
            x1={0}
            y1={0}
            x2={Math.max(0.001, p.length * W)}
            y2={0}
            className={'fold ' + (isLong ? 'long' : 'short')}
            style={{ '--from': from, '--to': to, animationDuration: `${foldMs}ms` } as CSSProperties}
          />
        );
      })}
      {/* What the others are missing to reach across the long side. */}
      <g className="shortfall" style={{ animationDelay: `${foldMs * 0.8}ms` }}>
        <line x1={sx(rest)} y1={rowB} x2={sx(long.length)} y2={rowB} />
        <text x={(sx(rest) + sx(long.length)) / 2} y={rowB + 26}>
          short by {2 * Math.round(long.length * 100) - 100}%
        </text>
      </g>
    </g>
  );
}

export default function Board({ brk, cuts, landing, total, blade, slideMs, dropMs, foldMs, outcome, live, onDrag, svgRef }: BoardProps) {
  const own = useRef<SVGSVGElement | null>(null);
  const x = brk / 100;
  const counted = [x, ...cuts];
  const shown = landing ? [...counted, landing.u] : counted;
  const ps = pieces(shown).filter((p) => p.length > 1e-9);
  const long = longPiece(shown);
  const left = total - cuts.length;
  const chartLong = longPiece(counted);
  const zones = outcome === 'polygon' || outcome === 'stuck' ? [] : landscape(counted, left);
  const p = winChance(chartLong?.length ?? null, left);
  const showRulers = !outcome && chartLong !== null && left > 0;
  const green = winZone(counted);
  const draggable = !live && !!onDrag;

  const setRefs = useCallback(
    (el: SVGSVGElement | null) => {
      own.current = el;
      if (typeof svgRef === 'function') svgRef(el);
      else if (svgRef) (svgRef as { current: SVGSVGElement | null }).current = el;
    },
    [svgRef],
  );

  const setFromPointer = (e: ReactPointerEvent<SVGElement>) => {
    const svg = own.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m || !onDrag) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const q = pt.matrixTransform(m.inverse());
    onDrag(Math.round(((q.x - X0) / W) * 100));
  };

  const header =
    outcome === 'polygon'
      ? 'every piece < ½ → polygon'
      : outcome === 'stuck'
        ? 'a piece ≥ ½ → no polygon'
        : outcome === 'cashed'
          ? 'cashed out'
          : left === 1
            ? 'green width = win chance'
            : 'green area = win chance';

  return (
    <svg
      ref={setRefs}
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      className={'snap' + (outcome ? ` over ${outcome}` : '')}
      role="img"
      aria-label={`Stick in ${ps.length} pieces; chance to make a polygon ${fmtP(p)}`}
    >
      <CutIcons total={total} fallen={cuts.length + (landing ? 1 : 0)} over={!!outcome} />
      <text x={X1} y={25} className={'hdr right' + (outcome ? ` ${outcome}` : '')}>
        {header}
      </text>

      {/* The chance box: for each spot on the stick, the green height is your chance if the next cut lands there. */}
      {zones.length > 0 && (
        <g className={'chart' + (outcome === 'cashed' ? ' frozen' : '')} key={`${counted.length}-${brk}-${total}`}>
          <rect x={X0} y={CT} width={W} height={CH} className="box" />
          {/* One base fill (no seams between wasted stretches), then the trims and the instant-win column on top. */}
          <path d={`M ${X0} ${CB} ${curvePath(zones).replace(/^M/, 'L')} L ${X1} ${CB} Z`} className="zone waste" />
          {zones.map((z, i) => (z.end > z.start && z.kind !== 'waste' ? <path key={i} d={zonePath(z)} className={'zone ' + z.kind} /> : null))}
          <path d={curvePath(zones)} className="curve" />
          <line x1={X0} y1={sy(p)} x2={X1} y2={sy(p)} className="level" />
          {green && (green.end - green.start) * W >= 40 && (
            <text x={sx((green.start + green.end) / 2)} y={CT + 20} className="zone-label">
              {(green.end - green.start) * W >= 104 ? 'instant win' : 'win'}
            </text>
          )}
          <text x={X1 + 6} y={sy(p) + 5} className="level-label">
            {fmtP(p)}
          </text>
          <text x={X0 - 6} y={CT + 5} className="axis">
            100
          </text>
          <text x={X0 - 6} y={CB} className="axis">
            0
          </text>
        </g>
      )}
      {zones.length === 0 && !outcome && (
        <rect x={X0} y={CT} width={W} height={CH} className="box empty" />
      )}

      {/* Where the cut landed: its height on the chart is the new chance. */}
      {landing && (
        <g className="marker">
          <line x1={sx(landing.u)} y1={sy(landing.p)} x2={sx(landing.u)} y2={SY - ST / 2} />
          <circle cx={sx(landing.u)} cy={sy(landing.p)} r={7} />
          <text x={Math.min(X1 - 30, Math.max(X0 + 30, sx(landing.u)))} y={Math.max(CT - 6, sy(landing.p) - 14)}>
            {landing.p >= 1 ? 'polygon!' : `→ ${fmtP(landing.p)}`}
          </text>
        </g>
      )}

      {/* The stick. */}
      <g className="stick">
        <rect x={X0} y={SY - ST / 2} width={W} height={ST} rx={5} className="ghost" />
        {ps.map((pc) => {
          const isLong = samePiece(pc, long);
          const gapL = pc.start > 0 ? 2 : 0;
          const gapR = pc.end < 1 ? 2 : 0;
          return (
            <rect
              key={`${pc.start}-${pc.end}`}
              x={sx(pc.start) + gapL}
              y={SY - ST / 2}
              width={Math.max(0.5, pc.length * W - gapL - gapR)}
              height={ST}
              rx={4}
              className={'piece ' + (outcome === 'polygon' ? 'won' : isLong ? 'long' : 'short')}
            />
          );
        })}
        {/* Random cuts. */}
        {[...cuts, ...(landing ? [landing.u] : [])].map((u, i) => (
          <line key={i} x1={sx(u)} y1={SY - ST / 2 - 5} x2={sx(u)} y2={SY + ST / 2 + 5} className="cutmark" />
        ))}
        {landing && <circle key={`flash-${cuts.length}`} cx={sx(landing.u)} cy={SY} r={4} className="flash" />}
        {/* Your break. */}
        {draggable && !outcome ? (
          <g className="handle">
            <circle cx={sx(x)} cy={SY} r={13} />
            <path d={`M ${sx(x) - 5} ${SY - 4} l -4 4 l 4 4 M ${sx(x) + 5} ${SY - 4} l 4 4 l -4 4`} />
          </g>
        ) : (
          <path d={`M ${sx(x)} ${SY + ST / 2 + 2} l -7 10 l 14 0 Z`} className="yours" />
        )}
      </g>

      {/* Piece lengths under the stick. */}
      <g className="lengths">
        {ps.map((pc) =>
          pc.length * W >= 34 ? (
            <text key={`${pc.start}-${pc.end}`} x={sx((pc.start + pc.end) / 2)} y={LY} className={samePiece(pc, long) && outcome !== 'polygon' ? 'long' : ''}>
              {pct(pc.length)}
              {samePiece(pc, long) && outcome !== 'polygon' && pc.length * W >= 90 ? ' ≥ ½' : ''}
            </text>
          ) : null,
        )}
      </g>

      {/* Two ½ rulers from the long piece's ends: a cut inside both leaves every piece < ½. */}
      {showRulers && chartLong && green && (
        <g className="rulers">
          <rect x={sx(green.start)} y={LY + 9} width={Math.max(1, (green.end - green.start) * W)} height={R2 - LY - 1} className="overlap" />
          {[
            { a: chartLong.start, y: R1 },
            { a: chartLong.end - HALF, y: R2 },
          ].map(({ a, y }) => (
            <g key={y} className="ruler">
              <line x1={sx(a)} y1={y} x2={sx(a + HALF)} y2={y} />
              <line x1={sx(a)} y1={y - 6} x2={sx(a)} y2={y + 6} />
              <line x1={sx(a + HALF)} y1={y - 6} x2={sx(a + HALF)} y2={y + 6} />
              <rect x={sx(a + HALF / 2) - 11} y={y - 9} width={22} height={18} rx={4} className="tag" />
              <text x={sx(a + HALF / 2)} y={y + 5}>
                ½
              </text>
            </g>
          ))}
          <text x={X0 + W / 2} y={350} className="caption">
            {left === 1 ? 'Last cut: it must land inside both ½ rulers' : 'Inside both ½ rulers → every piece < ½ → polygon'}
          </text>
        </g>
      )}

      {outcome === 'polygon' && <PolygonFigure ps={ps} foldMs={foldMs} />}
      {outcome === 'stuck' && long && <StuckFigure ps={ps} long={long} foldMs={foldMs} />}

      {/* The blade: slides along the top, then drops onto the stick. */}
      <g className={'blade' + (blade.on ? ' on' : '')} style={{ transform: `translateX(${sx(blade.x)}px)`, transitionDuration: `${slideMs}ms, 150ms` }}>
        <line x1={0} y1={46} x2={0} y2={SY - ST / 2 - 2} className="plumb" />
        <g className="head" style={{ transform: `translateY(${blade.down ? DROP : 0}px)`, transitionDuration: `${dropMs}ms` }}>
          <path d="M -10 30 L 10 30 L 0 47 Z" />
        </g>
      </g>

      {draggable && (
        <rect
          x={X0 - 14}
          y={SY - 34}
          width={W + 28}
          height={68}
          className="drag-zone"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            setFromPointer(e);
          }}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) setFromPointer(e);
          }}
        />
      )}
    </svg>
  );
}
