import { fmtChance, fmtMult } from '@originals/game-sdk/ui';
import type { CSSProperties } from 'react';

// Geometry (viewBox 0 0 560 400): the pump on the left, a hose to the nozzle,
// the balloon growing up from the nozzle, the pressure gauge on the right.
const NX = 330; // nozzle x
const NY = 348; // nozzle top (the balloon's knot)
const CY = 204; // balloon centre at full size
const TOP = 72; // balloon top at full size
const RX = 118;
const RY = 132;

const GX = 494; // gauge centre
const GY = 300;
const GR = 46;

export type BalloonState = 'idle' | 'live' | 'strain' | 'popped' | 'cashed' | 'max';

export interface BalloonProps {
  /** Balloon size, 0 (deflated start) to 1 (every safe pump used). */
  fill: number;
  state: BalloonState;
  /** Chance the next pump pops (what the gauge shows). */
  q: number;
  /** Cash-out multiplier shown above the balloon (null hides it). */
  label: number | null;
  /** Increments on every pump, to restart the pump animation. */
  tick: number;
  pumpMs: number;
}

/** Scale of the balloon group for a fill level. */
export const scaleOf = (fill: number) => 0.34 + 0.66 * Math.pow(Math.min(1, Math.max(0, fill)), 0.75);

const gaugePoint = (t: number, r = GR) => {
  const a = Math.PI * (1 - t); // t = 0 at the left end, 1 at the right end
  return { x: GX + r * Math.cos(a), y: GY - r * Math.sin(a) };
};
function gaugeArc(from: number, to: number, r = GR) {
  const a = gaugePoint(from, r);
  const b = gaugePoint(to, r);
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${r} ${r} 0 0 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

const SHARDS = Array.from({ length: 14 }, (_, i) => {
  const a = (i / 14) * Math.PI * 2 + (i % 2 ? 0.2 : -0.1);
  const dist = 90 + ((i * 37) % 60);
  return { dx: Math.cos(a) * dist, dy: Math.sin(a) * dist, rot: ((i * 97) % 300) - 150, s: 0.7 + ((i * 13) % 6) / 10 };
});

export default function Balloon({ fill, state, q, label, tick, pumpMs }: BalloonProps) {
  const s = scaleOf(fill);
  const cy = NY - s * (NY - CY);
  const top = NY - s * (NY - TOP);
  // The balloon warms from the accent towards red as the next pop chance climbs.
  const heat = Math.min(1, Math.max(0, (q - 0.04) / 0.5));
  const tint = `color-mix(in oklab, var(--accent), var(--red) ${Math.round(heat * 75)}%)`;
  const showBalloon = state !== 'popped';
  const ended = state === 'popped' || state === 'cashed' || state === 'max';
  const qClamped = Math.min(1, Math.max(0, q));
  const needle = gaugePoint(1 - qClamped, GR - 10);
  const animStyle = { animationDuration: `${pumpMs}ms` } as CSSProperties;

  return (
    <svg viewBox="0 0 560 400" className={`pump-svg ${state}`} role="img" aria-label={`Balloon at ${Math.round(fill * 100)}% size; next pump pops ${fmtChance(q)}`}>
      <defs>
        <radialGradient id="pump-skin" cx="0.36" cy="0.3" r="0.8">
          <stop offset="0" style={{ stopColor: `color-mix(in oklab, ${tint}, #fff 45%)` }} />
          <stop offset="0.55" style={{ stopColor: tint }} />
          <stop offset="1" style={{ stopColor: `color-mix(in oklab, ${tint}, #000 45%)` }} />
        </radialGradient>
        <linearGradient id="pump-metal" x1="0" x2="1">
          <stop offset="0" stopColor="#2b3242" />
          <stop offset="0.45" stopColor="#4a5468" />
          <stop offset="1" stopColor="#222835" />
        </linearGradient>
      </defs>

      {/* Floor and the full-size outline: how big the balloon gets at the top of the ladder. */}
      <line x1="24" x2="536" y1="372" y2="372" className="floor" />
      <ellipse cx={NX} cy={CY} rx={RX} ry={RY} className="max-outline" />
      {fill < 0.8 && (
        <text x={NX + RX * 0.72} y={TOP + 22} className="max-tag">
          full
        </text>
      )}

      {/* Hose with an air puff travelling along it on each pump. */}
      <path d={`M 128 344 C 190 344 210 366 270 366 S ${NX - 6} 366 ${NX - 6} 358`} className="hose" />
      {tick > 0 && (state === 'live' || state === 'strain') && (
        <path
          key={`puff-${tick}`}
          d={`M 128 344 C 190 344 210 366 270 366 S ${NX - 6} 366 ${NX - 6} 358`}
          pathLength={100}
          className="puff"
          style={animStyle}
        />
      )}

      {/* Nozzle stand. */}
      <path d={`M ${NX - 14} 372 L ${NX - 8} ${NY + 2} L ${NX + 8} ${NY + 2} L ${NX + 14} 372 Z`} className="stand" />

      {/* The pump: base, barrel, rod and handle (the handle presses on each pump). */}
      <rect x="66" y="358" width="88" height="14" rx="5" className="pump-base" />
      <rect x="92" y="234" width="36" height="126" rx="9" fill="url(#pump-metal)" className="barrel" />
      <rect x="98" y="300" width="24" height="40" rx="4" className="barrel-window" />
      <rect x="100" y={338 - 36 * Math.min(1, fill)} width="20" height={36 * Math.min(1, fill)} rx="3" className="barrel-level" />
      <g key={`press-${tick}`} className={tick > 0 && (state === 'live' || state === 'strain') ? 'plunger press' : 'plunger'} style={animStyle}>
        <rect x="106" y="180" width="8" height="58" rx="3" className="rod" />
        <rect x="68" y="168" width="84" height="16" rx="8" className="handle" />
      </g>

      {/* The balloon. */}
      {showBalloon && (
        <g className="float-wrap">
          <g className="balloon" style={{ transform: `scale(${s})`, transitionDuration: `${Math.round(pumpMs * 1.25)}ms` }}>
            <g className={state === 'strain' ? 'skin strain' : 'skin'} style={animStyle}>
              <path d={`M ${NX - 9} ${NY} L ${NX + 9} ${NY} L ${NX + 4} ${CY + RY - 2} L ${NX - 4} ${CY + RY - 2} Z`} className="knot" style={{ fill: tint }} />
              <ellipse cx={NX} cy={CY} rx={RX} ry={RY} fill="url(#pump-skin)" className="body" />
              <ellipse cx={NX - 46} cy={CY - 62} rx={24} ry={40} className="shine" transform={`rotate(28 ${NX - 46} ${CY - 62})`} />
              <ellipse cx={NX - 70} cy={CY - 2} rx={6} ry={12} className="shine dim" transform={`rotate(18 ${NX - 70} ${CY - 2})`} />
            </g>
          </g>
        </g>
      )}

      {/* The pop: shards fly out from where the balloon was, a ring flashes, a scrap is left on the nozzle. */}
      {state === 'popped' && (
        <g className="burst" key={`burst-${tick}`}>
          <circle cx={NX} cy={cy} r={RX * s} className="ring" style={{ transformOrigin: `${NX}px ${cy}px` }} />
          {SHARDS.map((sh, i) => (
            <path
              key={i}
              d={`M ${NX} ${cy - 9 * sh.s} L ${NX + 8 * sh.s} ${cy + 6 * sh.s} L ${NX - 7 * sh.s} ${cy + 5 * sh.s} Z`}
              className="shard"
              style={{ '--dx': `${sh.dx}px`, '--dy': `${sh.dy}px`, '--rot': `${sh.rot}deg`, transformOrigin: `${NX}px ${cy}px` } as CSSProperties}
            />
          ))}
          <path d={`M ${NX - 9} ${NY} L ${NX + 9} ${NY} L ${NX + 14} ${NY - 16} L ${NX + 3} ${NY - 10} L ${NX - 4} ${NY - 20} L ${NX - 13} ${NY - 12} Z`} className="scrap" />
          <text x={NX} y={cy + 12} className="pop-word">
            POP
          </text>
        </g>
      )}

      {label !== null && state !== 'popped' && (
        <g className="mult-tag" style={{ transform: `translateY(${top - 16 - (state === 'cashed' || state === 'max' ? 14 : 0)}px)`, transitionDuration: `${Math.round(pumpMs * 1.25)}ms` }}>
          <text x={NX} y={0} className={'mult' + (state === 'cashed' || state === 'max' ? ' gold' : '')}>
            {fmtMult(label)}
          </text>
        </g>
      )}

      {/* Pressure gauge: the red share of the dial is the chance the next pump pops. */}
      <g className="gauge">
        <path d={gaugeArc(0, 1)} className="g-track" />
        {!ended && qClamped < 1 && <path d={gaugeArc(0, 1 - qClamped)} className="g-safe" />}
        {!ended && qClamped > 0 && <path d={gaugeArc(1 - qClamped, 1)} className="g-risk" />}
        {!ended && <line x1={GX} y1={GY} x2={needle.x} y2={needle.y} className="g-needle" />}
        <circle cx={GX} cy={GY} r="5" className="g-hub" />
        <text x={GX} y={GY + 30} className="g-value">
          {ended ? '—' : fmtChance(qClamped)}
        </text>
        <text x={GX} y={GY + 48} className="g-label">
          pop chance
        </text>
      </g>
    </svg>
  );
}
