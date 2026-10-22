// The single-zero wheel: 37 pockets in casino order, a ball that orbits the
// track against the wheel's rotation, drops and bounces into the drawn pocket.
// The pocket is decided before the spin starts; the animation only shows it.
// Angles are in degrees, clockwise from 12 o'clock.

import { forwardRef, memo, useEffect, useImperativeHandle, useRef } from 'react';
import { POCKETS, WHEEL_INDEX, WHEEL_ORDER, colourOf } from './math';

const STEP = 360 / POCKETS;
const R_RIM = 110;
const R_TRACK_OUT = 106;
const R_TRACK_IN = 90;
const R_NUM_OUT = 89;
const R_NUM_IN = 72;
const R_POCKET_IN = 56;
const R_BALL_TRACK = 98;
const R_BALL_SEAT = 64;
const DRIFT = 7; // idle wheel drift, degrees per second

const rad = (a: number) => (a * Math.PI) / 180;
const pt = (r: number, a: number) => [r * Math.sin(rad(a)), -r * Math.cos(rad(a))] as const;
const f = (x: number) => x.toFixed(2);

function wedge(rIn: number, rOut: number, a0: number, a1: number) {
  const [x0, y0] = pt(rOut, a0);
  const [x1, y1] = pt(rOut, a1);
  const [x2, y2] = pt(rIn, a1);
  const [x3, y3] = pt(rIn, a0);
  return `M${f(x0)} ${f(y0)}A${rOut} ${rOut} 0 0 1 ${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}A${rIn} ${rIn} 0 0 0 ${f(x3)} ${f(y3)}Z`;
}

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const easeOutQuad = (t: number) => 1 - (1 - t) ** 2;
const mod = (a: number, m: number) => ((a % m) + m) % m;

export interface WheelHandle {
  /** Spins to the pocket at wheel index `index` over `ms`; `cosmetic` ∈ [0,1) varies the spin. */
  spin(index: number, ms: number, cosmetic: number): void;
}

interface Props {
  /** Pockets to light (hover preview, coverage). */
  highlight: Set<number>;
  /** Numbers that carry chips. */
  covered: Set<number>;
  /** The winning number once the ball has settled. */
  winner: number | null;
  /** Clicking a pocket (neighbours bet); null disables. */
  onPick: ((n: number) => void) | null;
  onHover(n: number | null): void;
  spinning: boolean;
}

const Pockets = memo(function Pockets({ onPick, onHover }: { onPick: ((n: number) => void) | null; onHover(n: number | null): void }) {
  return (
    <g className="rl-w-pockets">
      {WHEEL_ORDER.map((n, i) => {
        const a = i * STEP;
        const c = colourOf(n);
        return (
          <g
            key={n}
            className={'rl-w-pocket ' + c + (onPick ? ' pick' : '')}
            data-pocket={n}
            onClick={onPick ? () => onPick(n) : undefined}
            onPointerEnter={() => onHover(n)}
            onPointerLeave={() => onHover(null)}
          >
            <path className="num" d={wedge(R_NUM_IN, R_NUM_OUT, a - STEP / 2, a + STEP / 2)} />
            <path className="cup" d={wedge(R_POCKET_IN, R_NUM_IN, a - STEP / 2, a + STEP / 2)} />
            <text transform={`rotate(${f(a)}) translate(0 ${-(R_NUM_IN + R_NUM_OUT) / 2})`} dy="0.35em">
              {n}
            </text>
          </g>
        );
      })}
      {WHEEL_ORDER.map((_, i) => {
        const [x0, y0] = pt(R_POCKET_IN, (i + 0.5) * STEP);
        const [x1, y1] = pt(R_NUM_IN, (i + 0.5) * STEP);
        return <line key={i} className="rl-w-fret" x1={f(x0)} y1={f(y0)} x2={f(x1)} y2={f(y1)} />;
      })}
    </g>
  );
});

export const Wheel = forwardRef<WheelHandle, Props>(function Wheel({ highlight, covered, winner, onPick, onHover, spinning }, ref) {
  const wheelG = useRef<SVGGElement>(null);
  const ball = useRef<SVGGElement>(null);
  const st = useRef({
    w: 0,
    phi: 0, // ball angle in the wheel's frame while seated
    seated: true,
    r: R_BALL_SEAT,
    beta: 0,
    anim: null as null | { t0: number; ms: number; w0: number; dw: number; phiEnd: number; L: number; r0: number; wob: number },
  });

  useImperativeHandle(ref, () => ({
    spin(index, ms, cosmetic) {
      const s = st.current;
      const phiEnd = index * STEP;
      const w0 = s.w;
      const dw = 420 + 300 * cosmetic;
      const L = 4 * 360 + mod(s.beta - w0 - phiEnd, 360);
      s.anim = { t0: performance.now(), ms: Math.max(200, ms), w0, dw, phiEnd, L, r0: s.r, wob: cosmetic };
      s.seated = false;
    },
  }));

  useEffect(() => {
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let prev = performance.now();
    const draw = () => {
      const s = st.current;
      wheelG.current?.setAttribute('transform', `rotate(${f(s.w)})`);
      const [x, y] = pt(s.r, s.beta);
      ball.current?.setAttribute('transform', `translate(${f(x)} ${f(y)})`);
    };
    const tick = (now: number) => {
      const s = st.current;
      const dt = Math.min(0.1, (now - prev) / 1000);
      prev = now;
      const a = s.anim;
      if (a) {
        const t = Math.min(1, (now - a.t0) / a.ms);
        s.w = a.w0 + a.dw * easeOutCubic(t);
        const sb = Math.min(1, t / 0.82);
        let phi = a.phiEnd + a.L * (1 - easeOutQuad(sb));
        let r: number;
        if (sb < 0.08) r = a.r0 + (R_BALL_TRACK - a.r0) * (sb / 0.08);
        else if (sb < 0.5) r = R_BALL_TRACK - 1.5 * Math.sin(sb * 40) * (0.5 - sb);
        else if (sb < 0.72) {
          const u = (sb - 0.5) / 0.22;
          r = R_BALL_TRACK + (R_BALL_SEAT - R_BALL_TRACK) * u * u;
        } else {
          // Bounces off the frets, each smaller, and a small sideways skip that dies out.
          const u = (sb - 0.72) / 0.28;
          r = R_BALL_SEAT + 9 * Math.abs(Math.sin(3 * Math.PI * u)) * (1 - u) ** 2;
          phi += (4 + 6 * a.wob) * Math.sin(2 * Math.PI * u) * (1 - u) ** 2;
        }
        s.r = r;
        s.beta = s.w + phi;
        if (t >= 1) {
          s.anim = null;
          s.seated = true;
          s.phi = a.phiEnd;
          s.r = R_BALL_SEAT;
        }
      } else if (s.seated) {
        if (!reduce) s.w = mod(s.w + DRIFT * dt, 360);
        s.beta = s.w + s.phi;
      }
      draw();
      raf = requestAnimationFrame(tick);
    };
    draw();
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const winIdx = winner === null ? -1 : WHEEL_INDEX[winner];

  return (
    <svg className={'rl-wheel' + (spinning ? ' spinning' : '') + (onPick ? ' pickable' : '')} viewBox="-114 -114 228 228" role="img" aria-label="Roulette wheel">
      <defs>
        <radialGradient id="rl-rim" cx="0" cy="0" r="1" gradientUnits="objectBoundingBox" fx="0.5" fy="0.5">
          <stop offset="0.8" stopColor="#1d1d27" />
          <stop offset="1" stopColor="#0b0b10" />
        </radialGradient>
        <radialGradient id="rl-cone" cx="0.5" cy="0.45" r="0.6">
          <stop offset="0" stopColor="#2a2a36" />
          <stop offset="1" stopColor="#121218" />
        </radialGradient>
        <radialGradient id="rl-ball" cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.6" stopColor="#e6e6ee" />
          <stop offset="1" stopColor="#9a9aa8" />
        </radialGradient>
      </defs>
      <circle r={R_RIM + 3} className="rl-w-glow" />
      <circle r={R_RIM} fill="url(#rl-rim)" className="rl-w-rim" />
      <circle r={(R_TRACK_OUT + R_TRACK_IN) / 2} className="rl-w-track" strokeWidth={R_TRACK_OUT - R_TRACK_IN} />
      {/* Deflector diamonds on the track. */}
      {Array.from({ length: 8 }, (_, i) => {
        const [x, y] = pt(R_TRACK_IN + 6, i * 45 + 22.5);
        return <rect key={i} className="rl-w-diamond" x={-2.4} y={-2.4} width={4.8} height={4.8} transform={`translate(${f(x)} ${f(y)}) rotate(${i * 45 + 22.5 + 45})`} />;
      })}

      <g ref={wheelG}>
        <circle r={R_NUM_OUT + 1} className="rl-w-ring" />
        <Pockets onPick={onPick} onHover={onHover} />
        {WHEEL_ORDER.map((n, i) => {
          const lit = highlight.has(n);
          const has = covered.has(n);
          if (!lit && !has && i !== winIdx) return null;
          const a = i * STEP;
          return (
            <g key={n} className="rl-w-marks">
              {(lit || i === winIdx) && <path className={i === winIdx ? 'rl-w-win' : 'rl-w-lit'} d={wedge(R_POCKET_IN, R_NUM_OUT, a - STEP / 2, a + STEP / 2)} />}
              {has && <circle className="rl-w-chipdot" cx={f(pt(R_NUM_OUT + 5, a)[0])} cy={f(pt(R_NUM_OUT + 5, a)[1])} r={2} />}
            </g>
          );
        })}
        <circle r={R_POCKET_IN} fill="url(#rl-cone)" className="rl-w-cone" />
        {Array.from({ length: 4 }, (_, i) => (
          <g key={i} transform={`rotate(${i * 90 + 45})`}>
            <path className="rl-w-spoke" d="M-3 -16 L0 -46 L3 -16 Z" />
            <circle className="rl-w-knob" cy={-46} r={3.2} />
          </g>
        ))}
        <circle r={16} className="rl-w-hub" />
        <circle r={7} className="rl-w-hub-in" />
      </g>

      <g ref={ball} className="rl-ball">
        <circle r={5.2} fill="url(#rl-ball)" />
      </g>

      {winner !== null && !spinning && (
        <g className={'rl-w-result ' + colourOf(winner)} key={winner + ':' + winIdx}>
          <circle r={22} />
          <text dy="0.36em">{winner}</text>
        </g>
      )}
    </svg>
  );
});
