import { fmtMult } from '@originals/game-sdk/ui';
import { memo, type Ref } from 'react';
import { colourFor, type WheelTable } from './math';

export const C = 200;
const R_OUT = 166;
const R_IN = 112;
const R_HUB = 100;
const R_RIM = 178;

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
  pointer: Ref<SVGGElement>;
  live: Ref<SVGTextElement>;
}

export interface WheelProps {
  table: WheelTable;
  /** Segment the wheel stopped on (after the spin). */
  landed: number | null;
  /** Legend entry being hovered: its segments are highlighted. */
  focus: number | null;
  spinning: boolean;
  refs: WheelRefs;
}

/** The segments only re-render when the table changes, not on every frame. */
const Segments = memo(function Segments({ table }: { table: WheelTable }) {
  const n = table.segments;
  const s = 360 / n;
  const gap = n <= 20 ? 1.6 : n <= 30 ? 1.2 : 0.9;
  return (
    <>
      {table.layout.map((m, i) => {
        const col = colourFor(m, table.risk);
        return (
          <g key={i} className="wh-seg" data-i={i} data-e={table.layoutEntry[i]} style={{ ['--c' as string]: col }}>
            <path d={sector(i * s, (i + 1) * s, R_IN, R_OUT)} fill={col} stroke="#0d0f15" strokeWidth={gap} />
            <path d={sector(i * s, (i + 1) * s, R_OUT - 9, R_OUT)} fill="#fff" opacity={m === 0 ? 0.04 : 0.22} />
          </g>
        );
      })}
      {table.layout.map((_, i) => {
        const [x, y] = pt(i * s, R_RIM).split(' ');
        return <circle key={`d${i}`} cx={x} cy={y} r={n <= 20 ? 2.6 : 2} className="wh-stud" />;
      })}
    </>
  );
});

export default function WheelBoard({ table, landed, focus, spinning, refs }: WheelProps) {
  const landedEntry = landed !== null ? table.layoutEntry[landed] : null;
  const hit = landed !== null ? table.layout[landed] : null;
  const hitCol = hit !== null ? colourFor(hit, table.risk) : 'var(--accent)';
  const s = 360 / table.segments;
  const lit =
    focus !== null
      ? table.layoutEntry.flatMap((e, i) => (e === focus ? [i] : []))
      : landed !== null && !spinning
        ? [landed]
        : [];
  const cls = ['wh-svg', lit.length > 0 ? 'dim' : ''].filter(Boolean).join(' ');

  return (
    <svg viewBox="0 0 400 400" className={cls} role="img" aria-label={`Wheel with ${table.segments} segments`}>
      <defs>
        <radialGradient id="wh-shade" cx="50%" cy="50%" r="50%">
          <stop offset="62%" stopColor="#000" stopOpacity="0" />
          <stop offset="84%" stopColor="#000" stopOpacity="0.08" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.38" />
        </radialGradient>
        <linearGradient id="wh-rim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3a3f52" />
          <stop offset="100%" stopColor="#161924" />
        </linearGradient>
        <radialGradient id="wh-hub" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#1d212d" />
          <stop offset="100%" stopColor="#0c0e14" />
        </radialGradient>
      </defs>

      {/* Fixed rim and back plate */}
      <circle cx={C} cy={C} r={190} fill="url(#wh-rim)" />
      <circle cx={C} cy={C} r={186} fill="none" stroke="var(--accent)" strokeOpacity={0.35} strokeWidth={1.5} />
      <circle cx={C} cy={C} r={R_OUT + 3} fill="#0d0f15" />

      {/* The rotating wheel */}
      <g ref={refs.wheel} className="wh-wheel">
        <Segments table={table} />
        {lit.map((i) => {
          const col = colourFor(table.layout[i], table.risk);
          return (
            <g key={`h${i}`} className="wh-lit" style={{ ['--c' as string]: col }}>
              <path d={sector(i * s, (i + 1) * s, R_IN, R_OUT)} fill={col} stroke="#fff" strokeWidth={2.2} strokeLinejoin="round" />
              <path d={sector(i * s, (i + 1) * s, R_OUT - 9, R_OUT)} fill="#fff" opacity={0.3} />
            </g>
          );
        })}
      </g>
      <circle cx={C} cy={C} r={R_OUT} fill="url(#wh-shade)" pointerEvents="none" />

      {/* Hub */}
      <circle cx={C} cy={C} r={R_IN} fill="#0d0f15" />
      <circle cx={C} cy={C} r={R_HUB} fill="url(#wh-hub)" stroke={hitCol} strokeOpacity={landed !== null && !spinning ? 0.9 : 0.3} strokeWidth={2} className="wh-hub-ring" />
      {[0, 1, 2, 3, 4, 5, 6, 7].map((k) => (
        <circle key={k} cx={pt(k * 45, R_HUB - 12).split(' ')[0]} cy={pt(k * 45, R_HUB - 12).split(' ')[1]} r={1.6} fill="#fff" opacity={0.12} />
      ))}
      {spinning ? (
        <text ref={refs.live} x={C} y={C + 13} className="wh-hub-live" textAnchor="middle">
          –
        </text>
      ) : landed === null ? (
        <>
          <text x={C} y={C - 20} className="wh-hub-sub" textAnchor="middle">
            TOP PRIZE
          </text>
          <text x={C} y={C + 16} className="wh-hub-big" textAnchor="middle">
            {fmtMult(table.max)}
          </text>
          <text x={C} y={C + 42} className="wh-hub-sub" textAnchor="middle">
            {table.segments} SEGMENTS
          </text>
        </>
      ) : (
        <text x={C} y={C + 52} className="wh-hub-sub" textAnchor="middle">
          {table.entries[landedEntry!].count} OF {table.segments}
        </text>
      )}

      {/* Pointer (fixed at the top) */}
      <g ref={refs.pointer} className="wh-pointer">
        <path d="M 184 8 L 216 8 Q 220 8 218 12 L 203 44 Q 200 49 197 44 L 182 12 Q 180 8 184 8 Z" fill="#fff" />
        <circle cx={C} cy={16} r={4} fill={hitCol} />
      </g>
    </svg>
  );
}
