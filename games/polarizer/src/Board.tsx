import { GOAL, passChance, projection } from './math';

// Geometry: the photon's polarisation lives in a quarter circle, 0° along the
// floor and the 90° goal straight up. The bar on the right has the same height
// as the radius, so the squared shadow is drawn to the same scale.
const O = { x: 56, y: 336 };
const R = 250;
const BAR = { x: 392, w: 34, top: O.y - R, bottom: O.y };
const rad = (deg: number) => (deg * Math.PI) / 180;
const at = (deg: number, r = R) => ({ x: O.x + r * Math.cos(rad(deg)), y: O.y - r * Math.sin(rad(deg)) });
const f = (n: number) => n.toFixed(2);

function arcPath(from: number, to: number, r: number) {
  const a = at(from, r);
  const b = at(to, r);
  return `M ${f(a.x)} ${f(a.y)} A ${r} ${r} 0 0 0 ${f(b.x)} ${f(b.y)}`;
}

export interface Shot {
  from: number;
  delta: number;
  u: number;
  pass: boolean;
  /** aim: the marker waits above the bar; drop: it falls to u; turn: the photon turns (or dies). */
  stage: 'aim' | 'drop' | 'turn';
}

export type Outcome = 'absorbed' | 'through' | 'cashed';

export interface BoardProps {
  /** The photon's polarisation now (before the shot in flight). */
  angle: number;
  /** The next turn to draw (null when there is none). */
  delta: number | null;
  /** Axes of the polarizers already passed. */
  path: number[];
  /** Axes of the polarizers still planned. */
  planned: number[];
  shot: Shot | null;
  outcome: Outcome | null;
  /** True once the bet is placed (the photon is live, not a preview). */
  live: boolean;
  /** Changes on every bet, to replay the emission pulse. */
  roundKey: number;
  dropMs: number;
  turnMs: number;
}

export default function Board({ angle, delta, path, planned, shot, outcome, live, roundKey, dropMs, turnMs }: BoardProps) {
  // The construction on display: the shot in flight (or the one that ended the round), else the next turn.
  const from = shot ? shot.from : angle;
  const d = shot ? shot.delta : delta;
  const pr = d !== null ? projection(from, d) : null;
  const p = d !== null ? passChance(d) : null;

  const turned = shot && shot.stage === 'turn';
  // Passing turns the photon onto the new axis; an absorbed photon stays where it was, in red.
  const vecAngle = turned && shot.pass ? shot.from + shot.delta : shot ? shot.from : angle;
  const vecTone = outcome === 'absorbed' || (turned && !shot.pass) ? 'dead' : outcome === 'through' || vecAngle >= GOAL ? 'won' : live ? 'live' : 'ghost';

  const foot = pr && d !== null ? at(from + d, R * pr.shadow) : null;
  const tip = at(from);
  const nextAxis = d !== null ? at(from + d, R + 22) : null;

  const markerY = shot && shot.stage !== 'aim' ? BAR.bottom - shot.u * R : BAR.top - 18;
  const markerTone = !shot || shot.stage !== 'turn' ? 'falling' : shot.pass ? 'pass' : 'fail';
  const goalHit = outcome === 'through';

  return (
    <svg viewBox="0 0 460 392" className="polar" role="img" aria-label={`Photon at ${angle}°${p !== null ? `, next polarizer passes ${(p * 100).toFixed(1)}%` : ''}`}>
      {/* The quarter-circle dial, with a tick every 5°. */}
      <path d={`M ${O.x} ${O.y} L ${at(0).x} ${at(0).y} ${arcPath(0, GOAL, R).replace('M', 'L')} Z`} className="dial" />
      {Array.from({ length: GOAL / 5 + 1 }, (_, i) => {
        const a = i * 5;
        const big = a % 15 === 0;
        const p1 = at(a, R - (big ? 12 : 6));
        const p2 = at(a, R);
        return <line key={a} x1={f(p1.x)} y1={f(p1.y)} x2={f(p2.x)} y2={f(p2.y)} className={'tick' + (big ? ' big' : '')} />;
      })}
      <text x={at(0).x} y={O.y + 22} className="lbl">
        0°
      </text>
      <line x1={O.x} y1={O.y} x2={at(GOAL, R + 18).x} y2={at(GOAL, R + 18).y} className={'goal' + (goalHit ? ' hit' : '')} />
      <text x={O.x + 6} y={O.y - R - 26} className={'goal-lbl' + (goalHit ? ' hit' : '')}>
        goal 90°
      </text>

      {/* Polarizers already passed, and the rest of the plan. */}
      {path.map((a) => {
        const q = at(a, R + 12);
        return <line key={`p${a}`} x1={O.x} y1={O.y} x2={f(q.x)} y2={f(q.y)} className="passed" />;
      })}
      {path.map((a) => {
        const q = at(a);
        return <circle key={`pd${a}`} cx={f(q.x)} cy={f(q.y)} r={6} className="passed-dot" />;
      })}
      {planned.map((a) => {
        const q = at(a);
        return <circle key={`pl${a}`} cx={f(q.x)} cy={f(q.y)} r={5} className="planned" />;
      })}

      {/* The next polarizer's axis, the turn Δ, and the projection onto it. */}
      {d !== null && pr && foot && nextAxis && (
        <g className={'construction' + (turned ? ' fade' : '')}>
          <path d={arcPath(from, from + d, 58)} className="delta-arc" />
          <line x1={O.x} y1={O.y} x2={f(nextAxis.x)} y2={f(nextAxis.y)} className="axis" />
          <circle cx={f(at(from + d).x)} cy={f(at(from + d).y)} r={8} className={'axis-dot' + (shot && turned && !shot.pass ? ' fail' : '')} />
          <line x1={f(tip.x)} y1={f(tip.y)} x2={f(foot.x)} y2={f(foot.y)} className="perp" />
          <line x1={O.x} y1={O.y} x2={f(foot.x)} y2={f(foot.y)} className="shadow" />
          <circle cx={f(foot.x)} cy={f(foot.y)} r={4.5} className="foot" />
        </g>
      )}

      {/* The photon's polarisation vector. */}
      <g key={roundKey} className={`photon ${vecTone}` + (live ? ' emit' : '')}>
        <g className="rot" style={{ transform: `rotate(${-vecAngle}deg)`, transitionDuration: `${turnMs}ms` }}>
          <line x1={O.x} y1={O.y} x2={O.x + R - 12} y2={O.y} className="vec" />
          <path d={`M ${O.x + R + 4} ${O.y} l -20 -9 l 0 18 Z`} className="head" />
        </g>
      </g>
      <circle cx={O.x} cy={O.y} r={7} className="hub" />

      {/* Readout in the empty corner. */}
      <text x={300} y={46} className="big">
        {vecAngle}°
      </text>
      <text x={300} y={68} className="small">
        {outcome === 'absorbed' && d !== null ? `absorbed at ${from + d}°` : vecAngle >= GOAL ? 'reached the goal' : `photon · ${GOAL - vecAngle}° to go`}
      </text>
      {pr && (
        <>
          <text x={300} y={94} className="delta-lbl">
            turn Δ = {d}°
          </text>
          <text x={300} y={114} className="shadow-lbl">
            shadow cos Δ = {pr.shadow.toFixed(3)}
          </text>
        </>
      )}

      {/* The squared shadow as a bar: green passes, red absorbs. */}
      {p !== null && (
        <g className="bar">
          <text x={BAR.x + BAR.w / 2} y={BAR.top - 30} className="bar-val">
            {(p * 100).toFixed(1)}%
          </text>
          <text x={BAR.x + BAR.w / 2} y={BAR.top - 14} className="bar-cap">
            passes
          </text>
          <rect x={BAR.x} y={BAR.top} width={BAR.w} height={R * (1 - p)} className="absorb" />
          <rect x={BAR.x} y={BAR.bottom - R * p} width={BAR.w} height={R * p} className="pass" />
          <rect x={BAR.x} y={BAR.top} width={BAR.w} height={R} className="frame" />
          <text x={BAR.x + BAR.w / 2} y={BAR.bottom + 20} className="bar-cap">
            cos²Δ
          </text>
          {shot && (
            <g className={`marker ${markerTone}`} style={{ transform: `translateY(${markerY}px)`, transitionDuration: `${dropMs}ms` }}>
              <line x1={BAR.x - 8} y1={0} x2={BAR.x + BAR.w + 8} y2={0} />
              <circle cx={BAR.x - 8} cy={0} r={4} />
            </g>
          )}
        </g>
      )}
    </svg>
  );
}
