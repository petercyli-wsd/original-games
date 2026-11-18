import type { CSSProperties } from 'react';
import type { Kind } from './math';

const CX = 200;
const CY = 200;
const R = 150;
const STEP = 360 / 16;

const f = (v: number) => v.toFixed(2);
/** A point at `deg` degrees clockwise from the top. */
const polar = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return { x: CX + r * Math.sin(a), y: CY - r * Math.cos(a) };
};
/** Wedge i, centred on i * 22.5 degrees (before the wheel turns). */
function wedgePath(i: number) {
  const p = polar(i * STEP - STEP / 2, R);
  const q = polar(i * STEP + STEP / 2, R);
  return `M ${CX} ${CY} L ${f(p.x)} ${f(p.y)} A ${R} ${R} 0 0 1 ${f(q.x)} ${f(q.y)} Z`;
}

export interface BoardProps {
  wedges: readonly Kind[];
  /** Wheel rotation in degrees. */
  rot: number;
  spinMs: number;
  convMs: number;
  /** The wedge the pointer is on. */
  landed: number | null;
  hits: number;
  label: string;
}

export default function Board({ wedges, rot, spinMs, convMs, landed, hits, label }: BoardProps) {
  const order = wedges.map((_, i) => i).sort((a, b) => Number(a === landed) - Number(b === landed));
  return (
    <svg
      viewBox="0 20 400 410"
      className="grab-wheel"
      role="img"
      aria-label={label}
      style={{ '--spin': `${spinMs}ms`, '--conv': `${convMs}ms` } as CSSProperties}
    >
      {/* The wheel: 16 equal wedges. Green scores, red loses, grey turns green when landed. */}
      <g className="wheel" style={{ transform: `rotate(${rot}deg)`, transformOrigin: `${CX}px ${CY}px` }}>
        {order.map((i) => (
          <path key={i} d={wedgePath(i)} className={`wedge ${wedges[i]}${i === landed ? ' landed' : ''}`} />
        ))}
      </g>

      {/* The pointer stays on the last wedge. */}
      <path d={`M ${CX - 12} ${CY - R - 26} L ${CX + 12} ${CY - R - 26} L ${CX} ${CY - R + 4} Z`} className="pointer" />

      {/* Two hit slots (the player's own marks, so the accent). */}
      <circle cx={CX - 22} cy={382} r={11} className={'slot' + (hits >= 1 ? ' full' : '')} />
      <circle cx={CX + 22} cy={382} r={11} className={'slot' + (hits >= 2 ? ' full' : '')} />

      <text x={CX} y={420} className="key">
        Grey turns green. Green scores. Red loses.
      </text>
    </svg>
  );
}
