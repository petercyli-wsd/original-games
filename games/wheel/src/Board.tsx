import { fmtMult } from '@originals/game-sdk/ui';
import { memo, type Ref } from 'react';
import type { WheelTable } from './math';

export const C = 200;
const R_OUT = 176;
const R_IN = 104;
const LABEL_R = (R_OUT + R_IN) / 2;

const pt = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return `${(C + r * Math.sin(a)).toFixed(3)} ${(C - r * Math.cos(a)).toFixed(3)}`;
};

function sector(a0: number, a1: number, r0: number, r1: number) {
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${pt(a0, r1)} A ${r1} ${r1} 0 ${large} 1 ${pt(a1, r1)} L ${pt(a1, r0)} A ${r0} ${r0} 0 ${large} 0 ${pt(a0, r0)} Z`;
}

export interface WheelRefs {
  wheel: Ref<SVGGElement>;
  live: Ref<SVGTextElement>;
}

export interface WheelProps {
  table: WheelTable;
  /** Segment the wheel stopped on (after the spin); it stays outlined until the next spin. */
  landed: number | null;
  spinning: boolean;
  refs: WheelRefs;
}

/** Flat neutral steps: 0x segments are --bg, anything that pays is --hover. The multiplier is the label. */
const Segments = memo(function Segments({ table }: { table: WheelTable }) {
  const n = table.segments;
  const s = 360 / n;
  return (
    <>
      {table.layout.map((m, i) => (
        <path key={i} d={sector(i * s, (i + 1) * s, R_IN, R_OUT)} fill={m === 0 ? 'var(--bg)' : 'var(--hover)'} stroke="var(--line)" strokeWidth={1} />
      ))}
      {table.layout.map((m, i) => {
        const mid = (i + 0.5) * s;
        const [x, y] = pt(mid, LABEL_R).split(' ');
        return (
          <text
            key={`t${i}`}
            x={x}
            y={y}
            className={'wh-seg-label' + (m === 0 ? ' zero' : '')}
            textAnchor="middle"
            dominantBaseline="central"
            transform={`rotate(${(mid - 90).toFixed(3)} ${x} ${y})`}
          >
            {fmtMult(m)}
          </text>
        );
      })}
    </>
  );
});

export default function WheelBoard({ table, landed, spinning, refs }: WheelProps) {
  const s = 360 / table.segments;
  const shown = landed !== null && !spinning ? landed : null;
  const m = shown !== null ? table.layout[shown] : null;
  const outline = m === null ? 'var(--text)' : m > 1 ? 'var(--win)' : m < 1 ? 'var(--lose)' : 'var(--text)';

  return (
    <svg viewBox="0 0 400 400" className="wh-svg" role="img" aria-label={`Wheel with ${table.segments} segments`}>
      <circle cx={C} cy={C} r={R_OUT + 8} fill="var(--raised)" stroke="var(--line-strong)" strokeWidth={1} />

      {/* The rotating wheel */}
      <g ref={refs.wheel} className="wh-wheel">
        <Segments table={table} />
        {shown !== null && <path d={sector(shown * s, (shown + 1) * s, R_IN, R_OUT)} fill="none" stroke={outline} strokeWidth={3} strokeLinejoin="round" />}
      </g>

      {/* Hub: the multiplier under the pointer while the wheel turns */}
      <circle cx={C} cy={C} r={R_IN} fill="var(--card)" stroke="var(--line)" strokeWidth={1} />
      {spinning && (
        <text ref={refs.live} x={C} y={C} className="wh-hub-live" textAnchor="middle" dominantBaseline="central">
          –
        </text>
      )}

      {/* Pointer (fixed at the top) */}
      <path d="M 186 6 L 214 6 L 200 38 Z" fill="var(--text)" />
    </svg>
  );
}
