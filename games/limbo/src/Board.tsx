// The Limbo dial: a 300° gauge on the odds scale pos(x) = 1 − 0.99/x. The arc
// past the target is green and its length is exactly the win chance 0.99/t;
// the climbing counter sweeps the needle from 1.00× to the result, which lands
// uniformly along the dial.

import { RTP, fmtX, trackPos } from './math';

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

export function Dial({ target, value, state, burstId }: { target: number; value: number; state: DialState; burstId: number }) {
  const tPos = trackPos(target);
  const vPos = trackPos(value);
  const needle = pt(angleOf(vPos), R);
  const tick0 = pt(angleOf(tPos), R - 20);
  const tick1 = pt(angleOf(tPos), R + 9);
  const passed = value >= target;
  const text = fmtX(value) + '×';
  const fontSize = Math.min(58, 250 / (text.length * 0.6));
  const chance = (RTP / target) * 100;
  const tone = state === 'won' ? 'won' : state === 'lost' ? 'lost' : state === 'rolling' && passed ? 'passing' : '';

  return (
    <svg className={`limbo-dial ${state} ${tone}`} viewBox="0 0 400 330" role="img" aria-label={`Result ${text}, target ${fmtX(target)}×`}>
      <defs>
        <radialGradient id="limbo-core" cx="50%" cy="45%" r="60%">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* concentric geometry */}
      <circle cx={CX} cy={CY} r={R - 30} className="limbo-core" />
      <circle cx={CX} cy={CY} r={R - 30} className="limbo-ring-in" />
      <circle cx={CX} cy={CY} r={R - 42} className="limbo-ring-in faint" />

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

      {/* win burst */}
      {state === 'won' && (
        <g key={burstId} className="limbo-burst">
          {Array.from({ length: 12 }, (_, i) => {
            const a = (i * 360) / 12;
            const p = pt(a, R - 26);
            const q = pt(a, R - 52);
            return <line key={i} x1={q.x} y1={q.y} x2={p.x} y2={p.y} />;
          })}
        </g>
      )}

      {/* counter */}
      <text key={state === 'lost' ? `l${burstId}` : 'c'} x={CX} y={CY - 6} className="limbo-value" textAnchor="middle" dominantBaseline="middle" style={{ fontSize }}>
        {text}
      </text>
      <text x={CX} y={CY + 40} className="limbo-sub" textAnchor="middle">
        TARGET {fmtX(target)}×
      </text>
      <text x={CX} y={CY + 62} className="limbo-sub chance" textAnchor="middle">
        {chance >= 0.01 ? chance.toFixed(2) : chance.toPrecision(2)}% green
      </text>
    </svg>
  );
}
