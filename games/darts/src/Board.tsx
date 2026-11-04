import { useEffect, useRef } from 'react';
import { fmtMult } from '@originals/game-sdk/ui';
import { BOARD_R, INNER_R, OUTER_R, ZONES, ZONE_NAMES, payout, type Difficulty, type Zone } from './math';

// The dartboard: seven flat concentric rings, drawn to scale (each ring's area
// share is its exact chance), so the picture is the odds. Each ring's
// multiplier is written at the end of a thin leader line beside the board.

/** A full ring (or disc when r0 = 0), filled with the even-odd rule. */
function annulus(r0: number, r1: number) {
  const circle = (r: number) => `M ${r} 0 A ${r} ${r} 0 1 0 ${-r} 0 A ${r} ${r} 0 1 0 ${r} 0 Z`;
  return r0 > 0 ? `${circle(r1)} ${circle(r0)}` : circle(r1);
}

// Rings alternate two neutral fills, outermost first.
const FILL: Record<Zone, string> = {
  miss: 'var(--raised)',
  double: 'var(--hover)',
  outer: 'var(--raised)',
  triple: 'var(--hover)',
  inner: 'var(--raised)',
  bull: 'var(--hover)',
  bullseye: 'var(--raised)',
};

// Leader lines fan out to the right, one per ring, bullseye at the top.
const LABEL_R = 122;
const FAN_STEP = 17;
const leaderAngle = (i: number) => ((i - (ZONES.length - 1) / 2) * FAN_STEP * Math.PI) / 180;

export interface Mark {
  id: number;
  x: number;
  y: number;
  zone: Zone;
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

  // Fly the dot in from below the board onto the drawn point.
  useEffect(() => {
    const el = dartRef.current;
    if (!el || !dart || !flying || typeof el.animate !== 'function') return;
    const anim = el.animate(
      [{ transform: `translate(0px, ${BOARD_R + 24}px)` }, { transform: `translate(${dart.x}px, ${dart.y}px)` }],
      { duration: flightMs, easing: 'cubic-bezier(0.35, 0.05, 0.55, 1)' },
    );
    return () => anim.cancel();
  }, [dart?.id, flying]); // eslint-disable-line react-hooks/exhaustive-deps

  const hit = dart && !flying ? dart.zone : null;
  const outcome = dart ? (dart.multiplier > 1 ? 'win' : dart.multiplier < 1 ? 'lose' : 'even') : 'even';
  const outcomeColor = outcome === 'win' ? 'var(--win)' : outcome === 'lose' ? 'var(--lose)' : 'var(--text)';

  return (
    <svg className="dt-svg" viewBox="-150 -112 300 224" role="img" aria-label={hit ? `Dart in the ${ZONE_NAMES[hit]}` : 'Dartboard'}>
      {ZONES.map((z) => (
        <path key={z} className="dt-zone" fill={FILL[z]} d={annulus(INNER_R[z], OUTER_R[z])} fillRule="evenodd" />
      ))}

      {/* Ring boundaries. */}
      <g className="dt-wire">
        {ZONES.slice(0, -1).map((z) => (
          <circle key={z} r={OUTER_R[z]} />
        ))}
      </g>
      <circle r={BOARD_R} className="dt-edge" />

      {/* One multiplier per ring, on a leader line. */}
      <g className="dt-labels">
        {ZONES.map((z, i) => {
          const a = leaderAngle(i);
          const mid = (INNER_R[z] + OUTER_R[z]) / 2;
          const x1 = mid * Math.cos(a);
          const y1 = mid * Math.sin(a);
          const x2 = LABEL_R * Math.cos(a);
          const y2 = LABEL_R * Math.sin(a);
          const isHit = hit === z;
          const color = isHit ? outcomeColor : undefined;
          return (
            <g key={z} className={isHit ? 'dt-label hit' : 'dt-label'}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} style={color ? { stroke: color } : undefined} />
              <circle cx={x1} cy={y1} r={1.2} style={color ? { fill: color } : undefined} />
              <text x={x2 + 4} y={y2} dominantBaseline="central" style={color ? { fill: color } : undefined}>
                {fmtMult(payout(difficulty, z))}
              </text>
            </g>
          );
        })}
      </g>

      {/* The dart: the accent while flying, then a dot in the outcome colour until the next throw. */}
      {dart && (
        <g key={dart.id} ref={dartRef} className="dt-dart" style={{ transform: `translate(${dart.x}px, ${dart.y}px)` }}>
          <circle r={3} fill={flying ? 'var(--accent)' : outcomeColor} className="dt-dot" />
        </g>
      )}
    </svg>
  );
}
