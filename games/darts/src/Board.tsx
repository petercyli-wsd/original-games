import { useEffect, useRef } from 'react';
import { fmtMult } from '@originals/game-sdk/ui';
import { BOARD_R, CELLS, ZONE_NAMES, bounds, cellPattern, payout, radiusAt, type Difficulty, type Zone } from './math';

// The dartboard, drawn to scale: area is chance. Centre outwards: bullseye, a
// band of 18 equal wedge cells (low, mid, high), a light ring, a dark ring.
// Each zone's multiplier sits at the end of a thin leader line beside the board.

const pt = (r: number, a: number) => `${(r * Math.cos(a)).toFixed(3)} ${(r * Math.sin(a)).toFixed(3)}`;

/** An annular sector between radii r0 and r1 and angles a0..a1 (clockwise on screen). */
function sector(r0: number, r1: number, a0: number, a1: number) {
  return `M ${pt(r1, a0)} A ${r1} ${r1} 0 0 1 ${pt(r1, a1)} L ${pt(r0, a1)} A ${r0} ${r0} 0 0 0 ${pt(r0, a0)} Z`;
}

/** A full ring (or disc when r0 = 0), filled with the even-odd rule. */
function annulus(r0: number, r1: number) {
  const circle = (r: number) => `M ${r} 0 A ${r} ${r} 0 1 0 ${-r} 0 A ${r} ${r} 0 1 0 ${r} 0 Z`;
  return r0 > 0 ? `${circle(r1)} ${circle(r0)}` : circle(r1);
}

// Flat fills: rings below 1× are neutral, paying cells are green (deeper = more).
const FILL: Record<Zone, string> = {
  dark: 'var(--hover)',
  light: 'var(--line-strong)',
  low: 'color-mix(in srgb, var(--win) 35%, var(--bg))',
  mid: 'color-mix(in srgb, var(--win) 62%, var(--bg))',
  high: 'color-mix(in srgb, var(--win) 85%, var(--bg))',
  bull: 'var(--win)',
};

// Leader lines fan out to the right, top to bottom in this order.
const LABEL_ORDER: Zone[] = ['bull', 'high', 'mid', 'low', 'light', 'dark'];
const LABEL_R = 122;
const FAN_STEP = 17;
const leaderAngle = (i: number) => ((i - (LABEL_ORDER.length - 1) / 2) * FAN_STEP * Math.PI) / 180;
const cellAngle = (k: number) => ((k + 0.5) * 2 * Math.PI) / CELLS;

export interface Mark {
  id: number;
  x: number;
  y: number;
  zone: Zone;
  cell: number;
  multiplier: number;
}

export interface DartBoardProps {
  difficulty: Difficulty;
  /** The dart in flight or just landed; it stays until the next throw. */
  dart: Mark | null;
  /** True while the dart is in the air. */
  flying: boolean;
  flightMs: number;
}

export default function DartBoard({ difficulty, dart, flying, flightMs }: DartBoardProps) {
  const dartRef = useRef<SVGGElement>(null);
  const { b0, b1, b2 } = bounds(difficulty);
  const r0 = radiusAt(b0);
  const r1 = radiusAt(b1);
  const r2 = radiusAt(b2);
  const pattern = cellPattern(difficulty);

  // Fly the dot in from below the board, straight up the line of the (already decided)
  // landing point, so it visibly heads to where it lands.
  useEffect(() => {
    const el = dartRef.current;
    if (!el || !dart || !flying || typeof el.animate !== 'function') return;
    const anim = el.animate(
      [{ transform: `translate(${dart.x}px, ${BOARD_R + 24}px)` }, { transform: `translate(${dart.x}px, ${dart.y}px)` }],
      { duration: flightMs, easing: 'cubic-bezier(0.35, 0.05, 0.55, 1)' },
    );
    return () => anim.cancel();
  }, [dart?.id, flying]); // eslint-disable-line react-hooks/exhaustive-deps

  const hit = dart && !flying ? dart : null;
  const outcomeColor = !hit ? 'var(--text)' : hit.multiplier > 1 ? 'var(--win)' : 'var(--text)';

  return (
    <svg className="dt-svg" viewBox="-150 -118 300 236" role="img" aria-label={hit ? `Dart in the ${ZONE_NAMES[hit.zone]}` : 'Dartboard'}>
      <path className="dt-zone" fill={FILL.dark} d={annulus(r2, BOARD_R)} fillRule="evenodd" />
      <path className="dt-zone" fill={FILL.light} d={annulus(r1, r2)} fillRule="evenodd" />
      {pattern.map((tier, k) => (
        <path
          key={k}
          className={hit && hit.zone === tier && hit.cell === k ? 'dt-zone dt-cell-hit' : 'dt-zone dt-cell'}
          fill={FILL[tier]}
          d={sector(r0, r1, (k * 2 * Math.PI) / CELLS, ((k + 1) * 2 * Math.PI) / CELLS)}
        />
      ))}
      <circle r={r0} fill={FILL.bull} className="dt-bull" />
      <circle r={BOARD_R} className="dt-edge" />

      {/* One multiplier per zone, on a leader line. */}
      <g className="dt-labels">
        {LABEL_ORDER.map((z, i) => {
          const a = leaderAngle(i);
          let ang = a;
          let rad: number;
          if (z === 'bull') rad = r0 / 2;
          else if (z === 'light') rad = (r1 + r2) / 2;
          else if (z === 'dark') rad = (r2 + BOARD_R) / 2;
          else {
            // The cell of this tier nearest the leader's angle.
            const ks = pattern.map((t, k) => (t === z ? k : -1)).filter((k) => k >= 0);
            const wrap = (x: number) => Math.abs(Math.atan2(Math.sin(x), Math.cos(x)));
            const k = ks.reduce((best, c) => (wrap(cellAngle(c) - a) < wrap(cellAngle(best) - a) ? c : best), ks[0]);
            ang = cellAngle(k);
            rad = (r0 + r1) / 2;
          }
          const x1 = rad * Math.cos(ang);
          const y1 = rad * Math.sin(ang);
          const x2 = LABEL_R * Math.cos(a);
          const y2 = LABEL_R * Math.sin(a);
          const isHit = hit?.zone === z;
          const style = isHit ? { fill: outcomeColor } : undefined;
          return (
            <g key={z} className={isHit ? 'dt-label hit' : 'dt-label'}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} style={isHit ? { stroke: outcomeColor } : undefined} />
              <circle cx={x1} cy={y1} r={1.2} style={style} />
              <text x={x2 + 4} y={y2} dominantBaseline="central" style={style}>
                {fmtMult(payout(difficulty, z))}
              </text>
            </g>
          );
        })}
      </g>

      {/* The dart: the accent while flying, then a dot until the next throw. */}
      {dart && (
        <g key={dart.id} ref={dartRef} className="dt-dart" style={{ transform: `translate(${dart.x}px, ${dart.y}px)` }}>
          <circle r={3} fill={flying ? 'var(--accent)' : 'var(--text)'} className="dt-dot" />
        </g>
      )}

      <text className="dt-key" x={146} y={112} textAnchor="end">
        Area is chance; label is payout
      </text>
    </svg>
  );
}
