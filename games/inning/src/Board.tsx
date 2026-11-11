import { WHEEL, isGood, type Sector } from './math';

export interface Token {
  id: number;
  /** 0 = batter at home plate, 1-3 = bases, 4 = scored. */
  pos: number;
}

const BASE_XY = [
  { x: 150, y: 226 },
  { x: 248, y: 130 },
  { x: 150, y: 34 },
  { x: 52, y: 130 },
];
const at = (pos: number, scoredIndex = 0) => (pos % 4 === 0 && pos > 0 ? { x: BASE_XY[0].x + (scoredIndex - 1) * 18, y: BASE_XY[0].y + 22 } : BASE_XY[pos]);

export interface DiamondProps {
  tokens: Token[];
  outs: number;
  runs: number;
  need: number;
  target: number;
  stepMs: number;
  result: 'won' | 'lost' | null;
}

export function Diamond({ tokens, outs, runs, need, target, stepMs, result }: DiamondProps) {
  void need;
  let scoredSeen = 0;
  return (
    <svg viewBox="0 0 300 270" className="in-diamond" role="img" aria-label={`${runs} of ${target} runs, ${outs} outs`}>
      <polygon points="150,226 248,130 150,34 52,130" className="field" />
      {[1, 2, 3].map((b) => (
        <rect key={b} x={BASE_XY[b].x - 11} y={BASE_XY[b].y - 11} width={22} height={22} className="base" transform={`rotate(45 ${BASE_XY[b].x} ${BASE_XY[b].y})`} />
      ))}
      <rect x={139} y={215} width={22} height={22} className="base home" transform="rotate(45 150 226)" />
      <text x={150} y={94} className="lbl">
        runs
      </text>
      <text x={150} y={124} className={'runs' + (result ? ` ${result}` : '')}>
        {runs}
      </text>
      <text x={150} y={146} className="lbl">
        need <tspan className="target">{target}</tspan>
      </text>
      <text x={150} y={166} className="lbl">
        outs
      </text>
      {[0, 1, 2].map((i) => (
        <circle key={i} cx={130 + i * 20} cy={181} r={7} className={'light' + (i < outs ? ' on' : '')} />
      ))}
      {tokens.map((t) => {
        const scored = t.pos >= 4;
        const p = at(t.pos, scored ? scoredSeen++ : 0);
        return (
          <g key={t.id} className="token" style={{ transform: `translate(${p.x}px, ${p.y}px)`, transitionDuration: `${stepMs}ms` }}>
            <circle r={11} className={scored ? 'scored' : ''} />
          </g>
        );
      })}
    </svg>
  );
}

const W = 240;
const CX = 120;
const CY = 128;
const R = 104;
const polar = (deg: number, r: number) => ({ x: CX + r * Math.sin((deg * Math.PI) / 180), y: CY - r * Math.cos((deg * Math.PI) / 180) });
const LABEL: Record<Sector, string> = { out: 'Out', h1: '+1', h2: '+2', h4: '+4' };
export const sectorLabel = (s: Sector) => LABEL[s];

export interface WheelProps {
  rot: number;
  ms: number;
  /** The sector the last spin landed on. */
  landed: number | null;
  /** The line under the wheel. */
  caption: string;
}

export function Wheel({ rot, ms, landed, caption }: WheelProps) {
  return (
    <svg viewBox={`0 0 ${W} 262`} className="in-wheel" role="img" aria-label="Batting wheel: 8 outs, 2 of +1, one +2, one +4">
      <g className="wheel" style={{ transform: `rotate(${rot}deg)`, transitionDuration: `${ms}ms` }}>
        {WHEEL.map((sec, i) => {
          const a = polar(i * 30, R);
          const b = polar((i + 1) * 30, R);
          const m = polar(i * 30 + 15, R * 0.68);
          return (
            <g key={i}>
              <path
                d={`M ${CX} ${CY} L ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${R} ${R} 0 0 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)} Z`}
                className={'sector ' + (isGood(sec) ? 'good' : 'bad') + (landed === i ? ' landed' : '')}
              />
              <text x={m.x} y={m.y} transform={`rotate(${i * 30 + 15} ${m.x} ${m.y})`} className="sec-label">
                {LABEL[sec]}
              </text>
            </g>
          );
        })}
      </g>
      <polygon points={`${CX - 9},${CY - R - 14} ${CX + 9},${CY - R - 14} ${CX},${CY - R + 2}`} className="pointer" />
      <circle cx={CX} cy={CY} r={6} className="hub" />
      <text x={CX} y={256} className="last">
        {caption}
      </text>
    </svg>
  );
}

export interface StripProps {
  /** Chance of ending with 0, 1, ... runs still to come (losses), then the win. */
  ending: number[];
  /** Runs already scored. */
  scored: number;
  target: number;
}

/** The whole bet as one bar: every way the inning can end, the green share is the win chance. */
export function Strip({ ending, scored, target }: StripProps) {
  const n = ending.length - 1;
  return (
    <div className="in-strip" role="img" aria-label="How the inning ends">
      <div className="in-strip-head">How the inning ends, runs scored</div>
      <div className="in-strip-bar">
        {ending.map((p, j) => (
          <i key={j} className={j === n ? 'win' : 'lose'} style={{ width: `${p * 100}%` }} />
        ))}
      </div>
      <div className="in-strip-labels">
        {ending.map((p, j) => (
          <span key={j} style={{ width: `${p * 100}%` }}>
            {p >= 0.08 ? (j === n ? `${target}+` : scored + j) : ''}
          </span>
        ))}
      </div>
    </div>
  );
}
