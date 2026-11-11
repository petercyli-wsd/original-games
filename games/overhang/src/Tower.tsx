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
  s: number;
  /** The next drop's safe range (offsets from the top block) and odds; null hides the rail. */
  rail: { range: [number, number] | null; p: number } | null;
  drop: DropAnim | null;
  topple: ToppleAnim | null;
  /** The finished round's outcome: it stays marked on the tower until the next bet. */
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

function Block({ x, y }: { x: number; y: number }) {
  return <rect className="ovh-block" x={(x - 0.5) * U + 1} y={-(y + BH) * U + 1} width={U - 2} height={BH * U - 2} rx={4} />;
}

export default function Tower({ xs, s, rail, drop, topple, glow }: Props) {
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
        (topple && t < topple.t0 + topple.ms + 50);
      if (camMoving || busy) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [xs, s, rail, drop, topple]);

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
  // speeding up like a falling rod, then settle on the floor and stay there.
  let falling: string | null = null;
  let standing = xs;
  if (topple) {
    standing = xs.slice(0, topple.level);
    const t = clamp((now - topple.t0) / topple.ms, 0, 1);
    const tipEnd = 0.55;
    const tip = Math.min(t, tipEnd) / tipEnd;
    const angle = topple.dir * (tip * tip * 62 + ((Math.max(0, t - tipEnd) / (1 - tipEnd)) * 28));
    const px = (topple.level === 0 ? 0 : xs[topple.level - 1]) + topple.dir * 0.5;
    const py = surface(topple.level);
    // Fall until the lowest corner of the pile meets the floor, and no further.
    const rad = (angle * Math.PI) / 180;
    let lowest = Infinity;
    xs.slice(topple.level).forEach((x, i) => {
      const y0 = surface(topple.level + i);
      for (const cx of [x - 0.5, x + 0.5]) {
        for (const cy of [y0, y0 + BH]) {
          lowest = Math.min(lowest, py - (cx - px) * Math.sin(rad) + (cy - py) * Math.cos(rad));
        }
      }
    });
    const sink = (Math.max(0, t - tipEnd * 0.8) / (1 - tipEnd * 0.8)) ** 2 * Math.max(0, lowest);
    falling = `translate(0 ${sink * U}) rotate(${angle} ${px * U} ${-py * U})`;
  }

  // Centre of mass of the whole tower, plumbed down to the pedestal.
  const com = standing.length ? standing.reduce((a, b) => a + b, 0) / standing.length : null;
  const comY = standing.length ? PED_H + (standing.length * BH) / 2 : 0;

  return (
    <svg className={`ovh-tower ${glow ?? ''}`} viewBox={viewBox} preserveAspectRatio="xMidYMax meet" role="img" aria-label={`Tower ${n} blocks high`}>
      {/* Floor and the pedestal (level 0). */}
      <line x1={-60 * U} x2={60 * U} y1={0} y2={0} className="ovh-floor" />
      <rect x={-0.5 * U} y={-PED_H * U} width={U} height={PED_H * U} className="ovh-ped" />

      {/* The next drop's range: the part where the block's centre must come down is the win. */}
      {rail && !topple && (
        <g className="ovh-rail">
          <line x1={(top - s) * U} x2={(top + s) * U} y1={-railY * U} y2={-railY * U} className="ovh-track" />
          {rail.range && (
            <>
              <line x1={(top + rail.range[0]) * U} x2={(top + rail.range[1]) * U} y1={-railY * U} y2={-railY * U} className="ovh-safe" />
              {rail.range.map((r) => (
                <line key={r} x1={(top + r) * U} x2={(top + r) * U} y1={-railY * U - 11} y2={-railY * U + 11} className="ovh-tick" />
              ))}
            </>
          )}
        </g>
      )}

      <g className="ovh-blocks">
        {standing.map((x, i) => (
          <Block key={i} x={x} y={surface(i)} />
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
        <g className="ovh-fallen" transform={falling}>
          {xs.slice(topple!.level).map((x, i) => (
            <Block key={i} x={x} y={surface(topple!.level + i)} />
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
    </svg>
  );
}
