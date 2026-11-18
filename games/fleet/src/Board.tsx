import { ROCKETS, TOP, fmtX } from './math';

const TOP_Y = 28;
const H = 252;
const LEFT = 78;
const GAP = 58;
const FIRST = 112;

const yOf = (m: number) => TOP_Y + ((TOP - m) / TOP) * H;
const laneX = (i: number) => FIRST + i * GAP;
const TICKS = [1, 1.5, 2];

export interface BoardProps {
  /** The shared height of the flying rockets. */
  m: number;
  /** Crash height per lane (null while flying). */
  down: (number | null)[];
  /** How far each crashed rocket has dropped, 0 to 1. */
  drop: number[];
  /** The climb reached 2x with enough flying: survivors turn green. */
  won: boolean;
}

/** One rocket: a flat triangle, its tip at height y. */
function Rocket({ x, y, className }: { x: number; y: number; className: string }) {
  // y is the rocket's height; the body is centred on it.
  const t = y - 13;
  return <polygon className={className} points={`${x},${t} ${x - 11},${t + 26} ${x + 11},${t + 26}`} />;
}

/**
 * Five lanes on one linear axis from 0x to 2x. A rocket's height as a share of
 * the axis is its chance to reach 2x.
 */
export default function Fleet({ m, down, drop, won }: BoardProps) {
  return (
    <div className="fleet">
      <svg viewBox="0 0 400 300" role="img" aria-label="Five rockets on a 0 to 2x axis">
        <line className="axis" x1={LEFT} y1={TOP_Y} x2={LEFT} y2={TOP_Y + H} />
        {TICKS.map((t) => (
          <g key={t}>
            <line className={t === TOP ? 'tick top' : 'tick'} x1={LEFT} y1={yOf(t)} x2={390} y2={yOf(t)} />
            <text className="tick-label" x={LEFT - 8} y={yOf(t) + 5} textAnchor="end">
              {t === 1.5 ? '1.5×' : fmtX(t).replace('.00', '')}
            </text>
          </g>
        ))}
        {Array.from({ length: ROCKETS }, (_, i) => {
          const x = laneX(i);
          const c = down[i];
          if (c === null) return <Rocket key={i} x={x} y={yOf(m)} className={won ? 'rocket win' : 'rocket'} />;
          const y = yOf(c);
          const d = drop[i] ?? 0;
          return (
            <g key={i}>
              {d < 1 && <Rocket x={x} y={y + d * (TOP_Y + H - y)} className="rocket" />}
              <path className="miss" d={`M ${x - 9} ${y - 9} L ${x + 9} ${y + 9} M ${x + 9} ${y - 9} L ${x - 9} ${y + 9}`} />
            </g>
          );
        })}
      </svg>
      <p className="fleet-key">Height is each rocket&apos;s chance.</p>
    </div>
  );
}
