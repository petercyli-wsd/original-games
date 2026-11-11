import { OUT, WHEELS, outsIn, sectorTint, type State, type Wheel } from './math';

const CX = 100;
const CY = 96;
const R = 84;
const polar = (deg: number, r: number) => ({ x: CX + r * Math.sin((deg * Math.PI) / 180), y: CY - r * Math.cos((deg * Math.PI) / 180) });
const label = (x: number) => (x === OUT ? 'Out' : String(x));
const NAME: Record<Wheel, string> = { block: 'Block', swing: 'Swing' };

export interface WheelProps {
  wheel: Wheel;
  /** The state used to tint sectors; null leaves them neutral. */
  tintState: State | null;
  /** Pointer angle (degrees, cumulative) and the time to turn there. */
  rot: number;
  ms: number;
  /** The sector the last ball landed on, if it was on this wheel. */
  landed: number | null;
  /** The wheel the player picked for the last ball. */
  picked: boolean;
}

/** One 12-sector wheel. The pointer arm turns to the sector the ball lands on. */
export function WheelView({ wheel, tintState, rot, ms, landed, picked }: WheelProps) {
  const sectors = WHEELS[wheel];
  return (
    <svg viewBox="0 0 200 224" className={'lw-wheel' + (picked ? ' picked' : '')} role="img" aria-label={`${NAME[wheel]} wheel`}>
      {sectors.map((x, i) => {
        const a = polar(i * 30, R);
        const b = polar((i + 1) * 30, R);
        const m = polar(i * 30 + 15, R * 0.68);
        const tint = x === OUT ? 'down' : tintState ? sectorTint(tintState, x) : 'none';
        return (
          <g key={i}>
            <path
              d={`M ${CX} ${CY} L ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${R} ${R} 0 0 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)} Z`}
              className={`sector ${tintState || x === OUT ? tint : 'none'}` + (landed === i ? ' landed' : '')}
            />
            <text x={m.x} y={m.y} className={`sec-label ${tintState || x === OUT ? tint : 'none'}`}>
              {label(x)}
            </text>
          </g>
        );
      })}
      <g className="arm" style={{ transform: `rotate(${rot}deg)`, transitionDuration: `${ms}ms` }}>
        <line x1={CX} y1={CY} x2={CX} y2={CY - R - 6} />
        <polygon points={`${CX - 6},${CY - R - 8} ${CX + 6},${CY - R - 8} ${CX},${CY - R + 4}`} />
      </g>
      <circle cx={CX} cy={CY} r={5} className="hub" />
      <text x={CX} y={206} className="wheel-name">{`${NAME[wheel]}: ${outsIn(wheel)} ${outsIn(wheel) === 1 ? 'out' : 'outs'} in 12`}</text>
    </svg>
  );
}

export interface ChaseProps {
  /** Runs needed per ball left, one decimal. */
  pace: string;
  need: number;
  target: number;
  balls: number;
  /** One entry per ball bowled: runs, or OUT. */
  results: number[];
  result: 'won' | 'lost' | null;
}

/** The chase: runs still needed (a bar that shrinks) and the over of balls. */
export function Chase({ pace, need, target, balls, results, result }: ChaseProps) {
  const left = balls - results.length;
  return (
    <div className="lw-chase">
      <div className="lw-need">
        <span className={'lw-need-n' + (result ? ` ${result}` : '')}>{`Need ${need}`}</span>
        <div className="lw-track" role="img" aria-label={`${need} of ${target} runs still needed`}>
          <i style={{ width: `${(need / target) * 100}%` }} />
        </div>
        <span className="lw-need-b">{`${left} ${left === 1 ? 'ball' : 'balls'}, ${pace} a ball`}</span>
      </div>
      <div className="lw-pips" role="img" aria-label="Balls bowled">
        {Array.from({ length: balls }, (_, i) => {
          const r = results[i];
          const last = i === results.length - 1;
          return (
            <span key={i} className={'lw-pip' + (r === undefined ? ' empty' : r === OUT ? ' out' : '') + (last ? ' last' : '')}>
              {r === undefined ? '' : r === OUT ? 'X' : r}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export const WIN_SPLIT = (p: number) => ({ width: `${Math.min(1, Math.max(0, p)) * 100}%` });
