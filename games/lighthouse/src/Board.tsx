import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { fmtChance } from '@originals/game-sdk/ui';
import { FAN, H_MAX, H_MIN, SHORE_MAX, SHORE_MIN, chanceAt, dialArcs, dragEnd, moveWindow, shoreX, windowAngles, type Wedge, type Win } from './math';

// Scene coordinates. One shore unit is K px; the tower stands at shore x = 0.
const VW = 640;
const X0 = 30;
const K = 61;
const GY = 290;
const SCENE_H = 360;
const sx = (x: number) => X0 + (x - SHORE_MIN) * K;
const unsx = (px: number) => (px - X0) / K + SHORE_MIN;
const TX = sx(0);
const lampY = (h: number) => GY - h * K;

/**
 * Wide frames put the fan dial in the sky at the top right. Narrow frames put
 * a bigger dial above the scene and use larger type, since the whole picture
 * is scaled down.
 */
const LAYOUTS = {
  wide: { top: 0, height: SCENE_H, dial: { x: 542, y: 46, r: 80 } },
  compact: { top: 92, height: SCENE_H + 92, dial: { x: 320, y: 38, r: 100 } },
};

const f = (v: number) => v.toFixed(2);
/** The point at distance r from (cx, cy) in beam direction θ (θ = 0 is straight down). */
const at = (cx: number, cy: number, th: number, r: number) => ({ x: cx + r * Math.sin(th), y: cy + r * Math.cos(th) });
const deg = (rad: number) => (rad * 180) / Math.PI;

/** An arc of directions [t0, t1] at radius r, split into ≤ 90° pieces. */
function arcPath(cx: number, cy: number, r: number, t0: number, t1: number) {
  if (!(t1 - t0 > 1e-6)) return '';
  const n = Math.ceil((t1 - t0) / (Math.PI / 2));
  const p0 = at(cx, cy, t0, r);
  let d = `M ${f(p0.x)} ${f(p0.y)}`;
  for (let i = 1; i <= n; i++) {
    const p = at(cx, cy, t0 + ((t1 - t0) * i) / n, r);
    d += ` A ${r} ${r} 0 0 0 ${f(p.x)} ${f(p.y)}`;
  }
  return d;
}

/** A filled pie slice of directions [t0, t1]. */
function slicePath(cx: number, cy: number, r: number, t0: number, t1: number) {
  const arc = arcPath(cx, cy, r, t0, t1);
  return arc ? `M ${f(cx)} ${f(cy)} L ${arc.slice(2)} Z` : '';
}

const STARS = Array.from({ length: 26 }, (_, i) => {
  const u = Math.sin(i * 12.9898 + 1) * 43758.5453;
  const v = Math.sin(i * 78.233 + 2) * 12345.6789;
  return { x: 12 + (u - Math.floor(u)) * 616, y: 6 + (v - Math.floor(v)) * 160, r: i % 5 === 0 ? 1.6 : 1 };
});

const fmtShore = (x: number) => (Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(2));

/** Tracks whether the board's frame is narrow. */
function useCompact(ref: RefObject<SVGSVGElement | null>) {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setCompact(e.contentRect.width < 560));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return compact;
}

interface DialProps {
  x: number;
  y: number;
  r: number;
  arcs: ReturnType<typeof dialArcs>;
  wedge: Wedge;
  beam: number | null;
  /** The big readout and its tone. */
  big: string;
  tone: '' | 'zero' | 'one';
  caption: string;
}

/** The lamp's 180° of directions as a bowl: green ÷ (green + red) is the chance. */
function Dial({ x, y, r, arcs, wedge, beam, big, tone, caption }: DialProps) {
  const shuttered = wedge[0] > FAN[0] + 1e-9 || wedge[1] < FAN[1] - 1e-9;
  return (
    <g className="dial">
      <path d={slicePath(x, y, r + 14, FAN[0], FAN[1])} className="dial-bg" />
      <path d={arcPath(x, y, r, FAN[0], FAN[1])} className="dial-track" />
      {arcs.red.map((w, i) => (
        <path key={`r${i}`} d={arcPath(x, y, r, w[0], w[1])} className="dial-arc red" />
      ))}
      {arcs.green && <path d={arcPath(x, y, r, arcs.green[0], arcs.green[1])} className="dial-arc green" />}
      {shuttered &&
        [wedge[0], wedge[1]].map((t, i) => {
          const a = at(x, y, t, r - 11);
          const b = at(x, y, t, r + 11);
          return <line key={i} x1={f(a.x)} y1={f(a.y)} x2={f(b.x)} y2={f(b.y)} className="dial-edge" />;
        })}
      {beam !== null && (
        <>
          <line
            x1={f(at(x, y, beam, r * 0.64).x)}
            y1={f(at(x, y, beam, r * 0.64).y)}
            x2={f(at(x, y, beam, r - 8).x)}
            y2={f(at(x, y, beam, r - 8).y)}
            className="needle"
          />
          <circle cx={f(at(x, y, beam, r).x)} cy={f(at(x, y, beam, r).y)} r={5.5} className="needle-tip" />
        </>
      )}
      <text x={x} y={y - 10} className="dial-title">
        LAMP’S FAN · 180°
      </text>
      <text x={x} y={y + r * 0.37} className={'dial-big' + (tone ? ` ${tone}` : '')}>
        {big}
      </text>
      <text x={x} y={y + r * 0.6} className="dial-small">
        {caption}
      </text>
    </g>
  );
}

export interface BoardProps {
  win: Win;
  /** Lamp height on screen, or null for the idle preview. */
  h: number | null;
  /** Idle preview: a height where P(win | h) equals the headline chance. */
  typicalH: number;
  headline: number;
  /** The lit wedge of directions on screen. */
  wedge: Wedge;
  /** The beam's direction on screen, while it sweeps or after it stops. */
  beam: number | null;
  result: 'lit' | 'miss' | 'dark' | null;
  /** Whether the window can be dragged (idle and over). */
  editable: boolean;
  onWindow(win: Win): void;
  /** A reveal in progress: the tower moving, or a shutter closing. */
  motion: 'rise' | 'shutter' | null;
  /** The chance at the last checkpoint, shown while a shutter closes. */
  heldP: number;
  /** Tells the game when the board switches between the wide and compact layouts. */
  onCompact?(compact: boolean): void;
}

export default function Board({ win, h, typicalH, headline, wedge, beam, result, editable, motion, heldP, onWindow, onCompact }: BoardProps) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ kind: 'move' | 'a' | 'b'; offset: number } | null>(null);
  const winRef = useRef(win);
  winRef.current = win;
  const compact = useCompact(svg);
  const report = useRef(onCompact);
  report.current = onCompact;
  useEffect(() => report.current?.(compact), [compact]);
  const L = compact ? LAYOUTS.compact : LAYOUTS.wide;

  const idle = h === null;
  const lh = h ?? typicalH;
  const LY = lampY(lh);
  const [al, be] = windowAngles(win, lh);
  const p = idle ? headline : chanceAt(win, lh, wedge);
  const arcs = dialArcs(win, lh, idle ? FAN : wedge);
  // The lit part of the window, as seen from the lamp.
  const g0 = Math.max(al, wedge[0]);
  const g1 = Math.min(be, wedge[1]);
  const litWin = idle || g1 > g0;
  const greenDeg = arcs.green ? deg(arcs.green[1] - arcs.green[0]) : 0;
  const litDeg = deg(wedge[1] - wedge[0]);
  const shuttered = !idle && (wedge[0] > FAN[0] + 1e-9 || wedge[1] < FAN[1] - 1e-9);

  // Where the beam meets the shore (or leaves the picture).
  let landing: { x: number; shore: number; off: boolean } | null = null;
  if (beam !== null) {
    const shore = shoreX(lh, beam);
    const px = sx(shore);
    const off = !(Math.abs(beam) < Math.PI / 2 - 1e-6) || px < 8 || px > VW - 8;
    landing = { x: off ? (shore < 0 ? 8 : VW - 8) : px, shore, off };
  }

  const toShore = (e: ReactPointerEvent) => {
    const m = svg.current?.getScreenCTM();
    if (!m) return null;
    return unsx(new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse()).x);
  };
  const begin = (kind: 'move' | 'a' | 'b' | 'ground') => (e: ReactPointerEvent) => {
    if (!editable) return;
    const x = toShore(e);
    if (x === null) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      svg.current?.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events have no active pointer */
    }
    const w = winRef.current;
    if (kind === 'ground') {
      onWindow(moveWindow(w, x));
      drag.current = { kind: 'move', offset: 0 };
    } else {
      drag.current = { kind, offset: kind === 'move' ? x - (w.a + w.b) / 2 : 0 };
    }
  };
  const move = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || !editable) return;
    const x = toShore(e);
    if (x === null) return;
    const w = winRef.current;
    onWindow(d.kind === 'move' ? moveWindow(w, x - d.offset) : dragEnd(w, d.kind, x));
  };
  const end = () => {
    drag.current = null;
  };

  const ticks: number[] = [];
  for (let x = Math.ceil(SHORE_MIN); x <= Math.floor(SHORE_MAX); x++) ticks.push(x);
  const winMid = (sx(win.a) + sx(win.b)) / 2;
  const far = at(TX, LY, beam ?? 0, 1600);
  const fired = result === 'lit' || result === 'miss';
  const dialText: Pick<DialProps, 'big' | 'tone' | 'caption'> = fired
    ? { big: result === 'lit' ? 'HIT' : 'MISS', tone: result === 'lit' ? 'one' : 'zero', caption: `chance was ${fmtChance(p)}` }
    : motion === 'shutter'
      ? { big: fmtChance(heldP), tone: '', caption: 'shutter closing…' }
      : {
          big: fmtChance(p),
          tone: p === 0 ? 'zero' : p === 1 ? 'one' : '',
          caption: idle
            ? 'avg over heights'
            : motion === 'rise'
              ? 'if it stopped here'
              : `${greenDeg.toFixed(1)}° of ${litDeg.toFixed(litDeg % 1 > 0.05 ? 1 : 0)}° lit`,
        };

  return (
    <svg
      ref={svg}
      viewBox={`0 0 ${VW} ${L.height}`}
      className={'lh' + (editable ? ' editable' : '') + (compact ? ' compact' : '')}
      role="img"
      aria-label={`Window ${win.a.toFixed(1)} to ${win.b.toFixed(1)} on the shore. The beam lights it with chance ${fmtChance(p)}.`}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <defs>
        <clipPath id="lh-sky">
          <rect x={0} y={-L.top} width={VW} height={GY + L.top} />
        </clipPath>
        <radialGradient id="lh-glow" gradientUnits="userSpaceOnUse" cx={TX} cy={LY} r={430}>
          <stop offset="0" stopColor="var(--accent)" stopOpacity="0.42" />
          <stop offset="0.35" stopColor="var(--accent)" stopOpacity="0.14" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {STARS.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r={s.r} className="star" />
      ))}

      <g transform={`translate(0 ${L.top})`}>
        <rect x={0} y={GY} width={VW} height={SCENE_H - GY} className="land" />
        {editable && <rect x={0} y={GY - 16} width={VW} height={SCENE_H - GY + 16} className="hit" onPointerDown={begin('ground')} />}

        <g clipPath="url(#lh-sky)">
          {/* The lit wedge: every direction the beam can still take. */}
          {!idle && <path d={slicePath(TX, LY, 1600, wedge[0], wedge[1])} className="glow" />}
          {shuttered &&
            [wedge[0], wedge[1]].map((t, i) => {
              const e = at(TX, LY, t, 1600);
              return <line key={i} x1={TX} y1={f(LY)} x2={f(e.x)} y2={f(e.y)} className="edge-ray" />;
            })}
          {/* The window's sector: the beams that light it. Dashed where a shutter has closed. */}
          <path d={`M ${f(TX)} ${f(LY)} L ${f(sx(win.a))} ${GY} L ${f(sx(win.b))} ${GY} Z`} className={'sector-ghost' + (idle ? ' idle' : '')} />
          {!idle && litWin && (
            <path d={`M ${f(TX)} ${f(LY)} L ${f(sx(shoreX(lh, g0)))} ${GY} L ${f(sx(shoreX(lh, g1)))} ${GY} Z`} className="sector" />
          )}
          {beam !== null && (
            <>
              <line x1={TX} y1={f(LY)} x2={f(far.x)} y2={f(far.y)} className="beam-halo" />
              <line x1={TX} y1={f(LY)} x2={f(far.x)} y2={f(far.y)} className="beam" />
            </>
          )}
        </g>
        <line x1={0} y1={GY} x2={VW} y2={GY} className="shoreline" />

        {/* Ruler: distance along the shore from the foot of the tower. */}
        {ticks.map((x) => (
          <g key={x}>
            <line x1={sx(x)} y1={GY} x2={sx(x)} y2={GY + (x === 0 ? 9 : 6)} className="tick" />
            <text x={sx(x)} y={GY + (compact ? 28 : 24)} className={'ruler' + (x === 0 ? ' zero' : '')}>
              {x}
            </text>
          </g>
        ))}

        {/* The window on the shore. */}
        <rect
          x={f(sx(win.a))}
          y={GY - 5}
          width={f(sx(win.b) - sx(win.a))}
          height={10}
          rx={3}
          className={'window' + (litWin ? '' : ' dark')}
          onPointerDown={begin('move')}
        />
        {editable && (
          <>
            <circle cx={f(sx(win.a))} cy={GY} r={compact ? 10 : 8} className="handle" onPointerDown={begin('a')} />
            <circle cx={f(sx(win.b))} cy={GY} r={compact ? 10 : 8} className="handle" onPointerDown={begin('b')} />
          </>
        )}
        <text x={f(Math.min(VW - 70, Math.max(70, winMid)))} y={GY + (compact ? 56 : 48)} className={'win-label' + (litWin ? '' : ' dark')}>
          {editable ? '◂ your window ▸' : result === 'dark' ? 'window in the dark' : 'your window'}
        </text>

        {/* The tower: solid up to the lamp; in the preview, dashed over the range it can rise to. */}
        {idle ? (
          <>
            <line x1={TX} y1={lampY(H_MIN)} x2={TX} y2={lampY(H_MAX)} className="range" />
            <line x1={TX - 9} y1={lampY(H_MAX)} x2={TX + 9} y2={lampY(H_MAX)} className="range-cap" />
            <text x={TX - 16} y={lampY(H_MAX) + 5} className="range-label">
              {H_MAX}
            </text>
            <text x={TX - 16} y={lampY(H_MIN) + 5} className="range-label">
              {H_MIN}
            </text>
            <text x={TX + (compact ? 30 : 0)} y={lampY(H_MAX) - 14} className="range-title">
              the lamp stops at a random height
            </text>
            <path d={`M ${TX - 11} ${GY} L ${TX - 7} ${f(lampY(H_MIN) + 8)} L ${TX + 7} ${f(lampY(H_MIN) + 8)} L ${TX + 11} ${GY} Z`} className="tower" />
            <circle cx={TX} cy={f(LY)} r={7} className="lamp ghost" />
          </>
        ) : (
          <>
            <line x1={TX - 9} y1={lampY(H_MAX)} x2={TX + 9} y2={lampY(H_MAX)} className="range-cap faint" />
            <path d={`M ${TX - 11} ${GY} L ${TX - 7} ${f(LY + 8)} L ${TX + 7} ${f(LY + 8)} L ${TX + 11} ${GY} Z`} className="tower" />
            {[0.3, 0.6].map((t) => (
              <line key={t} x1={TX - 10 + 3 * t} y1={f(GY - (GY - LY - 8) * t)} x2={TX + 10 - 3 * t} y2={f(GY - (GY - LY - 8) * t)} className="band" />
            ))}
            {/* The lamp's own small fan: a copy of the dial. */}
            {arcs.red.map((w, i) => (
              <path key={`r${i}`} d={arcPath(TX, LY, 15, w[0], w[1])} className="mini red" />
            ))}
            {arcs.green && <path d={arcPath(TX, LY, 15, arcs.green[0], arcs.green[1])} className="mini green" />}
            <circle cx={TX} cy={f(LY)} r={7} className="lamp" />
            <text x={TX - 24} y={f(LY + 5)} className="h-label">
              height {lh.toFixed(2)}
            </text>
          </>
        )}

        {/* Where the beam landed. */}
        {landing && (
          <g className={'landing' + (result === 'lit' ? ' hit' : result === 'miss' ? ' miss' : '')}>
            <circle cx={f(landing.x)} cy={GY} r={6} className="dot" />
            {result && <circle cx={f(landing.x)} cy={GY} r={12} className="ring" />}
            {result && (
              <text x={f(Math.min(VW - 34, Math.max(34, landing.x)))} y={GY - 18} className="land-label">
                {landing.off && landing.shore < 0 ? '◂ ' : ''}
                {fmtShore(landing.shore)}
                {landing.off && landing.shore > 0 ? ' ▸' : ''}
              </text>
            )}
          </g>
        )}
      </g>

      <Dial
        {...L.dial}
        arcs={arcs}
        wedge={idle ? FAN : wedge}
        beam={beam}
        {...dialText}
      />
    </svg>
  );
}
