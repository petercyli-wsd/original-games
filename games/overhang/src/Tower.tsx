import { formatPercent } from '@originals/game-sdk';
import { useEffect, useRef, useState } from 'react';

// World units: a block is 1 wide. SVG user units are world × U, with y up in
// the world and down in SVG.
const U = 100;
const BH = 0.4; // block height
const PED_H = 1.1; // pedestal height
const HOVER_GAP = 1.15; // gap between the top surface and a hovering block
const RAIL_GAP = 0.32; // rail sits this far above a hovering block

export interface DropAnim {
  /** Offset the block lands at, relative to the top block. */
  d: number;
  t0: number;
  swingMs: number;
  fallMs: number;
}

export interface ToppleAnim {
  /** Level that gave way (0 = pedestal); blocks xs[level..] fall. */
  level: number;
  dir: 1 | -1;
  t0: number;
  ms: number;
}

interface Props {
  /** Centres of the standing blocks, bottom up (the pedestal is at 0). */
  xs: number[];
  /** Odds each block had when it was dropped (tints it: riskier = deeper). */
  ps: number[];
  s: number;
  /** The next drop's safe range (offsets from the top block) and odds; null hides the rail. */
  rail: { range: [number, number] | null; p: number } | null;
  drop: DropAnim | null;
  topple: ToppleAnim | null;
  /** When the top block landed and the factor it paid, for the floating label. */
  landed: { t0: number; factor: number } | null;
  glow: 'win' | 'lose' | null;
}

const topOf = (xs: number[]) => (xs.length ? xs[xs.length - 1] : 0);
const surface = (n: number) => PED_H + n * BH;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** The hovering block sweeps across the rail and settles on its landing offset. */
function swingX(d: number, s: number, tau: number) {
  if (tau >= 1) return d;
  const phase = Math.asin(clamp(-d / s, -1, 1));
  return clamp(d + s * (1 - tau) ** 2 * Math.sin(2 * Math.PI * 2.25 * tau + phase), -s, s);
}

interface Cam {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** World-space box the camera should show. */
function frame(xs: number[], s: number, railShown: boolean): Cam {
  const n = xs.length;
  const top = topOf(xs);
  let lo = -0.8;
  let hi = 0.8;
  for (const x of xs) {
    lo = Math.min(lo, x - 0.5);
    hi = Math.max(hi, x + 0.5);
  }
  if (railShown) {
    lo = Math.min(lo, top - s - 0.6);
    hi = Math.max(hi, top + s + 0.6);
  }
  const yTop = surface(n) + HOVER_GAP + BH + RAIL_GAP + 0.75;
  const h = Math.max(yTop + 0.4, surface(7) + 2.6);
  const w = Math.max(hi - lo + 1.2, 5.2);
  return { x: (lo + hi) / 2 - w / 2, y: h - 0.4, w, h };
}

function Block({ x, y, p, className }: { x: number; y: number; p: number; className?: string }) {
  // Hue runs from gold (safe drop) to deep orange (long shot).
  const hue = 22 + 22 * p;
  return (
    <g className={className}>
      <rect
        x={(x - 0.5) * U + 1}
        y={-(y + BH) * U + 1}
        width={U - 2}
        height={BH * U - 2}
        rx={4}
        fill={`hsl(${hue} 92% ${52 + 6 * p}%)`}
      />
      <rect x={(x - 0.5) * U + 1} y={-(y + BH) * U + 1} width={U - 2} height={BH * U - 2} rx={4} fill="url(#ovh-shade)" />
      <line x1={(x - 0.5) * U + 6} x2={(x + 0.5) * U - 6} y1={-(y + BH) * U + 3.5} y2={-(y + BH) * U + 3.5} className="ovh-hi" />
    </g>
  );
}

export default function Tower({ xs, ps, s, rail, drop, topple, landed, glow }: Props) {
  const [now, setNow] = useState(() => performance.now());
  const cam = useRef<Cam | null>(null);
  const n = xs.length;
  const top = topOf(xs);

  // While toppling the camera holds still, so the falling blocks leave the frame.
  const target = useRef<Cam>(frame(xs, s, !!rail));
  if (!topple) target.current = frame(xs, s, !!rail);

  // One animation loop drives the swing, fall, topple and camera. It stops once
  // everything has settled and restarts when the props change.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (t: number) => {
      const dt = Math.min(64, t - last);
      last = t;
      const c = cam.current ?? target.current;
      const k = 1 - Math.exp(-dt / 140);
      const g = target.current;
      const next = { x: c.x + (g.x - c.x) * k, y: c.y + (g.y - c.y) * k, w: c.w + (g.w - c.w) * k, h: c.h + (g.h - c.h) * k };
      cam.current = next;
      setNow(t);
      const camMoving = Math.abs(next.x - g.x) + Math.abs(next.y - g.y) + Math.abs(next.w - g.w) + Math.abs(next.h - g.h) > 0.002;
      const busy =
        (drop && t < drop.t0 + drop.swingMs + drop.fallMs + 50) ||
        (topple && t < topple.t0 + topple.ms + 50) ||
        (landed && t < landed.t0 + 1200);
      if (camMoving || busy) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [xs, s, rail, drop, topple, landed]);

  const c = cam.current ?? target.current;
  const viewBox = `${c.x * U} ${-c.y * U} ${c.w * U} ${c.h * U}`;

  // The hovering block: waiting at the rail's centre, swinging, or falling.
  const hoverY = surface(n) + HOVER_GAP;
  const railY = hoverY + BH + RAIL_GAP;
  let hover: { x: number; y: number } | null = rail ? { x: top, y: hoverY } : null;
  let cable = !!rail;
  if (drop) {
    const t = now - drop.t0;
    const tau = clamp(t / drop.swingMs, 0, 1);
    const fall = clamp((t - drop.swingMs) / drop.fallMs, 0, 1);
    hover = { x: top + swingX(drop.d, s, tau), y: hoverY - HOVER_GAP * fall * fall };
    cable = fall === 0;
  }

  // Topple: blocks above the failed level rotate about the supporting edge,
  // speeding up like a falling rod, then drop away.
  let falling: { transform: string; opacity: number } | null = null;
  let standing = xs;
  if (topple) {
    standing = xs.slice(0, topple.level);
    const t = clamp((now - topple.t0) / topple.ms, 0, 1);
    const tipEnd = 0.55;
    const tip = Math.min(t, tipEnd) / tipEnd;
    const angle = topple.dir * (tip * tip * 62 + Math.max(0, t - tipEnd) * 110);
    const sink = Math.max(0, t - tipEnd * 0.8) ** 2 * 14;
    const px = (topple.level === 0 ? 0 : xs[topple.level - 1]) + topple.dir * 0.5;
    const py = surface(topple.level);
    falling = {
      transform: `translate(${topple.dir * sink * 0.25 * U} ${sink * U}) rotate(${angle} ${px * U} ${-py * U})`,
      opacity: 1 - clamp((t - 0.75) / 0.25, 0, 1),
    };
  }

  // Centre of mass of the whole tower, plumbed down to the pedestal.
  const com = standing.length ? standing.reduce((a, b) => a + b, 0) / standing.length : null;
  const comY = standing.length ? PED_H + (standing.length * BH) / 2 : 0;

  const lift = landed ? clamp((now - landed.t0) / 1100, 0, 1) : 1;

  return (
    <svg className={`ovh-tower ${glow ?? ''}`} viewBox={viewBox} preserveAspectRatio="xMidYMax meet" role="img" aria-label={`Tower ${n} blocks high`}>
      <defs>
        <linearGradient id="ovh-shade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.38" />
          <stop offset="0.45" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.32" />
        </linearGradient>
        <linearGradient id="ovh-ped" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#262633" />
          <stop offset="0.5" stopColor="#343444" />
          <stop offset="1" stopColor="#1c1c26" />
        </linearGradient>
        <linearGradient id="ovh-zone" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--og-green, #00e701)" stopOpacity="0.16" />
          <stop offset="1" stopColor="var(--og-green, #00e701)" stopOpacity="0.02" />
        </linearGradient>
        <radialGradient id="ovh-floor" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#000" stopOpacity="0.55" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Floor, contact shadow and the pedestal (level 0). */}
      <line x1={-60 * U} x2={60 * U} y1={0} y2={0} className="ovh-floor" />
      <ellipse cx={(com ?? 0) * 0.3 * U} cy={6} rx={1.6 * U} ry={14} fill="url(#ovh-floor)" />
      <line x1={-0.5 * U} x2={-0.5 * U} y1={-PED_H * U} y2={-(railY + 0.2) * U} className="ovh-edge" />
      <line x1={0.5 * U} x2={0.5 * U} y1={-PED_H * U} y2={-(railY + 0.2) * U} className="ovh-edge" />
      <rect x={-0.5 * U} y={-PED_H * U} width={U} height={PED_H * U} fill="url(#ovh-ped)" />
      <rect x={-0.5 * U} y={-PED_H * U} width={U} height={5} className="ovh-ped-cap" />

      {/* Landing zone: where the hovering block's centre must come down. */}
      {rail && !topple && (
        <g className="ovh-rail">
          {rail.range && (
            <rect
              x={(top + rail.range[0]) * U}
              y={-railY * U}
              width={(rail.range[1] - rail.range[0]) * U}
              height={(railY - surface(n)) * U}
              fill="url(#ovh-zone)"
            />
          )}
          <line x1={(top - s) * U} x2={(top + s) * U} y1={-railY * U} y2={-railY * U} className="ovh-track" />
          {rail.range && (
            <>
              <line x1={(top + rail.range[0]) * U} x2={(top + rail.range[1]) * U} y1={-railY * U} y2={-railY * U} className="ovh-safe" />
              {rail.range.map((r) => (
                <line key={r} x1={(top + r) * U} x2={(top + r) * U} y1={-railY * U - 11} y2={-railY * U + 11} className="ovh-tick" />
              ))}
              <text x={(top + (rail.range[0] + rail.range[1]) / 2) * U} y={-railY * U - 20} className="ovh-pct">
                {formatPercent(rail.p)}
              </text>
            </>
          )}
        </g>
      )}

      <g className="ovh-blocks">
        {standing.map((x, i) => (
          <Block key={i} x={x} y={surface(i)} p={ps[i] ?? 1} className={i === n - 1 && lift < 1 ? 'ovh-new' : undefined} />
        ))}
      </g>

      {/* Plumb line from the tower's centre of mass: it must stay between the pedestal's edges. */}
      {com !== null && !topple && (
        <g className={`ovh-com ${Math.abs(com) > 0.38 ? 'warn' : ''}`}>
          <line x1={com * U} x2={com * U} y1={-comY * U} y2={-PED_H * U} />
          <circle cx={com * U} cy={-comY * U} r={7} />
        </g>
      )}

      {falling && (
        <g transform={falling.transform} opacity={falling.opacity}>
          {xs.slice(topple!.level).map((x, i) => (
            <Block key={i} x={x} y={surface(topple!.level + i)} p={ps[topple!.level + i] ?? 0} />
          ))}
        </g>
      )}

      {hover && (
        <g className="ovh-hover">
          {cable && <line x1={hover.x * U} x2={hover.x * U} y1={-railY * U} y2={-(hover.y + BH) * U} className="ovh-cable" />}
          <rect x={(hover.x - 0.5) * U + 1} y={-(hover.y + BH) * U + 1} width={U - 2} height={BH * U - 2} rx={4} />
          <line x1={hover.x * U} x2={hover.x * U} y1={-(hover.y + BH) * U + 6} y2={-hover.y * U - 6} className="ovh-notch" />
          {cable && <circle cx={hover.x * U} cy={-railY * U} r={6} className="ovh-pin" />}
        </g>
      )}

      {landed && lift < 1 && n > 0 && !glow && (
        <text x={(top + 0.62) * U} y={-(surface(n) - BH / 2 + lift * 0.5) * U} className="ovh-factor" opacity={1 - lift}>
          ×{landed.factor.toFixed(2)}
        </text>
      )}
    </svg>
  );
}
