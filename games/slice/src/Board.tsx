import { useRef, type CSSProperties, type PointerEvent } from 'react';
import type { Circle, Poly, Pt, Slice } from './math';

/** Board units per unit of the square. */
const S = 400;
const PAD = 22;

const path = (poly: Poly) => (poly.length ? 'M' + poly.map((p) => `${p.x * S} ${p.y * S}`).join('L') + 'Z' : '');

export interface Blade {
  from: Pt;
  to: Pt;
  id: number;
}

interface Props {
  circle: Circle;
  region: Poly;
  slices: Slice[];
  blade: Blade | null;
  /** The hidden dot, once the round is over. */
  dot: Pt | null;
  dotTone: 'win' | 'lose' | 'neutral';
  /** Whether the circle can be dragged into place. */
  editable: boolean;
  showHandle: boolean;
  onMove(p: Pt): void;
  bladeMs: number;
  fallMs: number;
}

export default function Board({ circle, region, slices, blade, dot, dotTone, editable, showHandle, onMove, bladeMs, fallMs }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);

  const toUnit = (e: PointerEvent): Pt | null => {
    const m = svg.current?.getScreenCTM();
    if (!m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x / S, y: p.y / S };
  };
  const move = (e: PointerEvent) => {
    const p = toUnit(e);
    if (p) onMove(p);
  };

  const { cx, cy, r } = circle;
  const vars = { '--blade': `${bladeMs}ms`, '--fall': `${fallMs}ms` } as CSSProperties;

  return (
    <svg
      ref={svg}
      className={'board' + (editable ? ' editable' : '')}
      viewBox={`${-PAD} ${-PAD} ${S + 2 * PAD} ${S + 2 * PAD}`}
      style={vars}
      role="img"
      aria-label="The square, the region still in play and your circle"
      onPointerDown={(e) => {
        if (!editable) return;
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        move(e);
      }}
      onPointerMove={(e) => dragging.current && editable && move(e)}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
    >
      <defs>
        <pattern id="slice-grid" width={S / 10} height={S / 10} patternUnits="userSpaceOnUse">
          <path d={`M ${S / 10} 0 L 0 0 0 ${S / 10}`} className="grid-line" />
        </pattern>
        <pattern id="slice-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="8" className="hatch-line" />
        </pattern>
        <clipPath id="slice-region">
          <path d={path(region)} />
        </clipPath>
        <radialGradient id="slice-overlap">
          <stop offset="0%" className="ov-0" />
          <stop offset="100%" className="ov-1" />
        </radialGradient>
      </defs>

      <rect x={0} y={0} width={S} height={S} className="square" />

      {/* Discarded halves fall away and grey out. */}
      {slices.map((s, i) => (
        <g key={i} className="piece" style={{ '--dx': `${s.away.x * 7}px`, '--dy': `${s.away.y * 7}px` } as CSSProperties}>
          <path d={path(s.lost)} className="piece-fill" />
          <path d={path(s.lost)} fill="url(#slice-hatch)" />
        </g>
      ))}

      <path d={path(region)} className="region" />
      <rect x={0} y={0} width={S} height={S} fill="url(#slice-grid)" clipPath="url(#slice-region)" className="grid" />

      {/* The overlap: the circle as seen through what's left. */}
      <g clipPath="url(#slice-region)">
        <circle cx={cx * S} cy={cy * S} r={r * S} fill="url(#slice-overlap)" className="overlap" />
        <circle cx={cx * S} cy={cy * S} r={r * S} className="ring-live" />
      </g>
      <circle cx={cx * S} cy={cy * S} r={r * S} className="ring-ghost" />
      <path d={path(region)} className="region-edge" />

      {showHandle && (
        <g className="handle" transform={`translate(${cx * S} ${cy * S})`}>
          <circle r={5} />
          <path d="M -12 0 H -8 M 8 0 H 12 M 0 -12 V -8 M 0 8 V 12" />
        </g>
      )}

      {blade && (
        <line
          key={blade.id}
          className="blade"
          x1={blade.from.x * S}
          y1={blade.from.y * S}
          x2={blade.to.x * S}
          y2={blade.to.y * S}
          pathLength={1}
        />
      )}

      {dot && (
        <g className={'dot ' + dotTone} transform={`translate(${dot.x * S} ${dot.y * S})`}>
          <circle r={7} className="dot-ripple" />
          <circle r={7} className="dot-core" />
        </g>
      )}
    </svg>
  );
}
