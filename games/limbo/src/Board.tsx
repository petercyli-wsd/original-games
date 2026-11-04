// The Limbo dial: a 300° gauge on the odds scale pos(x) = 1 − 0.99/x. The arc
// past the target is green and its length is exactly the win chance 0.99/t;
// the climbing counter sweeps the needle from 1.00× to the result, which lands
// uniformly along the dial.

import { fmtX, trackPos } from './math';

const CX = 200;
const CY = 172;
const R = 128;
const SWEEP = 300;
const START = -SWEEP / 2;

const angleOf = (pos: number) => START + SWEEP * pos;

function pt(angleDeg: number, r: number) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: CX + r * Math.sin(a), y: CY - r * Math.cos(a) };
}

function arc(p0: number, p1: number, r = R) {
  const a0 = angleOf(Math.max(0, Math.min(1, p0)));
  const a1 = angleOf(Math.max(0, Math.min(1, p1)));
  if (a1 - a0 < 0.01) return '';
  const s = pt(a0, r);
  const e = pt(a1, r);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
}

const TICKS: { x: number; label: string }[] = [
  { x: 1, label: '1×' },
  { x: 1.5, label: '1.5×' },
  { x: 2, label: '2×' },
  { x: 3, label: '3×' },
  { x: 5, label: '5×' },
  { x: 10, label: '10×' },
  { x: 50, label: '50×' },
];

export type DialState = 'idle' | 'rolling' | 'won' | 'lost';

export function Dial({ target, value, state }: { target: number; value: number; state: DialState }) {
  const tPos = trackPos(target);
  const vPos = trackPos(value);
  const needle = pt(angleOf(vPos), R);
  const tick0 = pt(angleOf(tPos), R - 20);
  const tick1 = pt(angleOf(tPos), R + 9);
  const text = fmtX(value) + '×';
  const fontSize = Math.min(44, 170 / (text.length * 0.6));

  return (
    <svg className={`limbo-dial ${state}`} viewBox="0 0 400 330" role="img" aria-label={`Result ${text}, target ${fmtX(target)}×`}>
      <circle cx={CX} cy={CY} r={R - 30} className="limbo-ring-in" />

      {/* odds arcs: red below the target, green (= win chance) above */}
      <path d={arc(0, tPos)} className="limbo-zone lose" />
      <path d={arc(tPos, 1)} className="limbo-zone win" />
      {/* the needle's sweep */}
      {state !== 'idle' && <path d={arc(trackPos(1), vPos)} className="limbo-sweep" />}

      {/* scale */}
      {TICKS.map(({ x, label }) => {
        const p = trackPos(x);
        const a = pt(angleOf(p), R + 10);
        const b = pt(angleOf(p), R + 16);
        const l = pt(angleOf(p), R + 30);
        return (
          <g key={label} className="limbo-tick">
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
            <text x={l.x} y={l.y} dominantBaseline="middle" textAnchor="middle">
              {label}
            </text>
          </g>
        );
      })}

      {/* target marker */}
      <line x1={tick0.x} y1={tick0.y} x2={tick1.x} y2={tick1.y} className="limbo-target" />

      {/* needle */}
      {state !== 'idle' && <circle cx={needle.x} cy={needle.y} r={9} className="limbo-needle" />}

      {/* the one hero number: counts up, then stays in win / lose colour */}
      <text x={CX} y={CY} className="limbo-value" textAnchor="middle" dominantBaseline="middle" style={{ fontSize }}>
        {text}
      </text>
    </svg>
  );
}
