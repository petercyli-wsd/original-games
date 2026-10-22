import { useEffect, useRef } from 'react';
import { BOARD_R, INNER_R, OUTER_R, ZONES, ZONE_NAMES, tiersFor, type Difficulty, type Tier, type Zone } from './math';

// The dartboard: seven concentric zones, drawn to scale (each ring's area
// share is its exact chance). Rings are coloured by the tier of what they pay
// on the chosen difficulty; the 20 wedges are cosmetic, as on a real board.

const SEGMENTS = 20;
const SEG = (2 * Math.PI) / SEGMENTS;
// A real board puts a wedge centred at 12 o'clock.
const OFFSET = -Math.PI / 2 - SEG / 2;

const pt = (r: number, a: number) => `${(r * Math.cos(a)).toFixed(3)} ${(r * Math.sin(a)).toFixed(3)}`;

function sector(r0: number, r1: number, a0: number, a1: number) {
  return `M ${pt(r0, a0)} L ${pt(r1, a0)} A ${r1} ${r1} 0 0 1 ${pt(r1, a1)} L ${pt(r0, a1)} A ${r0} ${r0} 0 0 0 ${pt(r0, a0)} Z`;
}

/** A full ring (or disc when r0 = 0), filled with the even-odd rule. */
function annulus(r0: number, r1: number) {
  const circle = (r: number) => `M ${r} 0 A ${r} ${r} 0 1 0 ${-r} 0 A ${r} ${r} 0 1 0 ${r} 0 Z`;
  return r0 > 0 ? `${circle(r1)} ${circle(r0)}` : circle(r1);
}

const SEGMENTED: Zone[] = ['inner', 'triple', 'outer', 'double'];
const BANDS = new Set<Zone>(['triple', 'double', 'bull', 'bullseye']);

export interface Mark {
  id: number;
  x: number;
  y: number;
  zone: Zone;
  multiplier: number;
  tier: Tier;
}

export interface DartBoardProps {
  difficulty: Difficulty;
  /** The dart in flight or just landed. */
  dart: Mark | null;
  /** Earlier throws still on the board. */
  marks: Mark[];
  /** True while the dart is in the air. */
  flying: boolean;
  flightMs: number;
}

export default function DartBoard({ difficulty, dart, marks, flying, flightMs }: DartBoardProps) {
  const dartRef = useRef<SVGGElement>(null);

  // Fly the dart in from the thrower's side: large and off-board, arcing down onto the drawn point.
  useEffect(() => {
    const el = dartRef.current;
    if (!el || !dart || !flying || typeof el.animate !== 'function') return;
    const end = `translate(${dart.x}px, ${dart.y}px) scale(1) rotate(0deg)`;
    const sx = 150;
    const sy = 175;
    const mx = (sx + dart.x) / 2 + 6;
    const my = Math.min(sy, dart.y) - 60;
    const anim = el.animate(
      [
        { transform: `translate(${sx}px, ${sy}px) scale(3.4) rotate(-28deg)`, opacity: 0 },
        { transform: `translate(${(sx + mx) / 2}px, ${(sy + my) / 2 + 10}px) scale(2.6) rotate(-18deg)`, opacity: 1, offset: 0.2 },
        { transform: `translate(${mx}px, ${my}px) scale(1.7) rotate(-8deg)`, opacity: 1, offset: 0.62 },
        { transform: end, opacity: 1 },
      ],
      { duration: flightMs, easing: 'cubic-bezier(0.35, 0.05, 0.55, 1)' },
    );
    return () => anim.cancel();
  }, [dart?.id, flying]); // eslint-disable-line react-hooks/exhaustive-deps

  const hit = dart && !flying ? dart.zone : null;
  const tiers = tiersFor(difficulty);

  return (
    <svg className="dt-svg" viewBox="-118 -118 236 236" role="img" aria-label={hit ? `Dart in the ${ZONE_NAMES[hit]}` : 'Dartboard'}>
      <defs>
        <radialGradient id="dt-rim" cx="50%" cy="50%" r="50%">
          <stop offset="86%" stopColor="#1a1d26" />
          <stop offset="100%" stopColor="#0b0c11" />
        </radialGradient>
        <radialGradient id="dt-sheen" cx="38%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.09" />
          <stop offset="60%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle r={BOARD_R + 14} className="dt-halo" />
      <circle r={BOARD_R + 9} fill="url(#dt-rim)" className="dt-rim" />

      {ZONES.map((z) => {
        const tier = tiers[z];
        const cls = `dt-zone t-${tier}` + (BANDS.has(z) ? ' band' : '') + (z === 'miss' ? ' miss' : '');
        if (!SEGMENTED.includes(z)) return <path key={z} className={cls} d={annulus(INNER_R[z], OUTER_R[z])} fillRule="evenodd" />;
        return (
          <g key={z}>
            {Array.from({ length: SEGMENTS }, (_, i) => (
              <path key={i} className={cls + (i % 2 ? ' alt' : '')} d={sector(INNER_R[z], OUTER_R[z], OFFSET + i * SEG, OFFSET + (i + 1) * SEG)} />
            ))}
          </g>
        );
      })}

      {/* Wire: ring boundaries and wedge spokes. */}
      <g className="dt-wire">
        {ZONES.slice(0, -1).map((z) => (
          <circle key={z} r={OUTER_R[z]} />
        ))}
        {Array.from({ length: SEGMENTS }, (_, i) => {
          const a = OFFSET + i * SEG;
          return <line key={i} x1={OUTER_R.bull * Math.cos(a)} y1={OUTER_R.bull * Math.sin(a)} x2={OUTER_R.double * Math.cos(a)} y2={OUTER_R.double * Math.sin(a)} />;
        })}
      </g>

      {/* Miss ring: tick marks where a real board has its numbers. */}
      <g className="dt-ticks">
        {Array.from({ length: SEGMENTS }, (_, i) => {
          const a = OFFSET + (i + 0.5) * SEG;
          return <circle key={i} cx={92.5 * Math.cos(a)} cy={92.5 * Math.sin(a)} r={i % 5 === 0 ? 1.6 : 1} />;
        })}
      </g>
      <circle r={BOARD_R} fill="url(#dt-sheen)" pointerEvents="none" />
      <circle r={BOARD_R} className="dt-edge" />

      {/* The ring that was hit lights up. */}
      {hit && (
        <path
          key={`hit-${dart!.id}`}
          className={`dt-hit t-${dart!.tier}${dart!.multiplier === 0 ? ' is-miss' : ''}`}
          d={annulus(INNER_R[hit], OUTER_R[hit])}
          fillRule="evenodd"
        />
      )}

      {/* Earlier darts, as pins. */}
      <g className="dt-marks">
        {marks.map((m, i) => (
          <circle key={m.id} cx={m.x} cy={m.y} r={2.1} className={`dt-mark t-${m.tier}`} style={{ opacity: 0.85 - i * 0.06 }} />
        ))}
      </g>

      {dart && (
        <g key={dart.id} ref={dartRef} className="dt-dart" style={{ transform: `translate(${dart.x}px, ${dart.y}px)` }}>
          {!flying && <circle className={`dt-impact t-${dart.tier}`} r={4} />}
          <ellipse className="dt-shadow" cx={3} cy={2.5} rx={6} ry={2.2} />
          <line className="dt-shaft" x1={0} y1={0} x2={13} y2={-13} />
          <line className="dt-barrel" x1={2.4} y1={-2.4} x2={8} y2={-8} />
          <polygon className="dt-flight" points="12,-12 22,-14 25,-25 14,-22" />
          <line className="dt-flight-spine" x1={12} y1={-12} x2={25} y2={-25} />
          <circle className="dt-tip" r={1.1} />
        </g>
      )}

    </svg>
  );
}
