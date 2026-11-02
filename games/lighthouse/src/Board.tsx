import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { fmtChance } from '@originals/game-sdk/ui';
import { FAN, H_MAX, H_MIN, chanceAt, dialArcs, shoreX, snapDist, widening, windowAngles, type Win } from './math';

// Scene coordinates. One shore unit is K px; the tower stands at shore x = 0.
const VW = 640;
const VIEW_MIN = -1;
const VIEW_MAX = 9;
const X0 = 30;
const K = 58;
const GY = 290;
const SCENE_H = 360;
const sx = (x: number) => X0 + (x - VIEW_MIN) * K;
const unsx = (px: number) => (px - X0) / K + VIEW_MIN;
const TX = sx(0);
const lampY = (h: number) => GY - h * K;

/**
 * Wide frames put the fan dial in the sky at the top right. Narrow frames put
 * a bigger dial above the scene and use larger type, since the whole picture
 * is scaled down.
 */
const LAYOUTS = {
  wide: { top: 0, height: SCENE_H, dial: { x: 532, y: 40, r: 84 } },
  compact: { top: 110, height: SCENE_H + 110, dial: { x: 320, y: 36, r: 104 } },
};

const f = (v: number) => v.toFixed(2);
/** The point at distance r from (cx, cy) in beam direction θ (θ = 0 is straight down). */
const at = (cx: number, cy: number, th: number, r: number) => ({ x: cx + r * Math.sin(th), y: cy + r * Math.cos(th) });

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
  return { x: 12 + (u - Math.floor(u)) * 616, y: 6 + (v - Math.floor(v)) * 120, r: i % 5 === 0 ? 1.6 : 1 };
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
  beam: number | null;
  /** The big readout and its tone. */
  big: string;
  tone: '' | 'zero' | 'one';
  caption: string;
}

/** The lamp's 180° of directions as a protractor: the green share is the chance. Ticks every 10%. */
function Dial({ x, y, r, arcs, beam, big, tone, caption }: DialProps) {
  return (
    <g className="dial">
      <path d={slicePath(x, y, r + 14, FAN[0], FAN[1])} className="dial-bg" />
      {arcs.red.map((w, i) => (
        <path key={`r${i}`} d={arcPath(x, y, r, w[0], w[1])} className="dial-arc red" />
      ))}
      <path d={arcPath(x, y, r, arcs.green[0], arcs.green[1])} className="dial-arc green" />
      {Array.from({ length: 9 }, (_, i) => {
        const t = FAN[0] + ((i + 1) * Math.PI) / 10;
        const a = at(x, y, t, r - (i === 4 ? 17 : 13));
        const b = at(x, y, t, r - 8);
        return <line key={i} x1={f(a.x)} y1={f(a.y)} x2={f(b.x)} y2={f(b.y)} className="dial-tick" />;
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
        YOUR SHARE OF THE FAN
      </text>
      <text x={x} y={y + r * 0.37} className={'dial-big' + (tone ? ` ${tone}` : '')}>
        {big}
      </text>
      <text x={x} y={y + r * 0.58} className="dial-small">
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
  /** The beam's direction on screen, while it sweeps or after it stops. */
  beam: number | null;
  result: 'lit' | 'miss' | null;
  /** Whether the window can be dragged (idle and over). */
  editable: boolean;
  /** The tower is rising. */
  rising: boolean;
  /** What a taller tower does to this window's slice, in plain words. */
  effect: string;
  onDist(d: number): void;
  /** Tells the game when the board switches between the wide and compact layouts. */
  onCompact?(compact: boolean): void;
}

export default function Board({ win, h, typicalH, headline, beam, result, editable, rising, effect, onDist, onCompact }: BoardProps) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ offset: number } | null>(null);
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
  const p = idle ? headline : chanceAt(win, lh);
  const arcs = dialArcs(win, lh);
  const [al, be] = windowAngles(win, lh);

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
  const centre = (w: Win) => (w.a + w.b) / 2;
  const begin = (kind: 'move' | 'ground') => (e: ReactPointerEvent) => {
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
    if (kind === 'ground') {
      onDist(snapDist(x));
      drag.current = { offset: 0 };
    } else {
      drag.current = { offset: x - centre(winRef.current) };
    }
  };
  const move = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || !editable) return;
    const x = toShore(e);
    if (x === null) return;
    onDist(snapDist(x - d.offset));
  };
  const end = () => {
    drag.current = null;
  };

  const ticks: number[] = [];
  for (let x = Math.ceil(VIEW_MIN); x <= Math.floor(VIEW_MAX); x++) ticks.push(x);
  const winMid = (sx(win.a) + sx(win.b)) / 2;
  const far = at(TX, LY, beam ?? 0, 1600);
  const dialText: Pick<DialProps, 'big' | 'tone' | 'caption'> = result
    ? { big: result === 'lit' ? 'HIT' : 'MISS', tone: result === 'lit' ? 'one' : 'zero', caption: `chance was ${fmtChance(p)}` }
    : {
        big: fmtChance(p),
        tone: '',
        caption: idle ? 'before tower stops' : rising ? (widening(win, lh) ? 'widening…' : 'narrowing…') : 'green share',
      };
  const titleX = TX + 18;

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
          <stop offset="0" stopColor="var(--accent)" stopOpacity="0.36" />
          <stop offset="0.35" stopColor="var(--accent)" stopOpacity="0.12" />
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
          {/* The fan: every direction the beam can take. */}
          {!idle && <path d={slicePath(TX, LY, 1600, FAN[0], FAN[1])} className="glow" />}
          {/* The window's cone: the beams that light it. */}
          <path
            d={`M ${f(TX)} ${f(LY)} L ${f(sx(shoreX(lh, al)))} ${GY} L ${f(sx(shoreX(lh, be)))} ${GY} Z`}
            className={'sector' + (idle ? ' idle' : '')}
          />
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
          y={GY - 6}
          width={f(sx(win.b) - sx(win.a))}
          height={12}
          rx={3}
          className="window"
          onPointerDown={begin('move')}
        />
        <text x={f(Math.min(VW - 90, Math.max(90, winMid)))} y={GY + (compact ? 58 : 48)} className="win-label">
          {editable ? '◂ drag your window ▸' : 'your window'}
        </text>

        {/* The tower: solid up to the lamp; in the preview, dashed over the range it can rise to. */}
        {(idle || rising) && (
          <>
            <text x={titleX} y={lampY(H_MAX) - (compact ? 44 : 36)} className="range-title">
              the lamp stops at a random height
            </text>
            <text x={titleX} y={lampY(H_MAX) - (compact ? 18 : 16)} className="effect-label">
              {effect}
            </text>
          </>
        )}
        {(idle || rising) && (
          <>
            <line x1={TX} y1={lampY(H_MIN)} x2={TX} y2={lampY(H_MAX)} className="range" />
            <line x1={TX - 9} y1={lampY(H_MAX)} x2={TX + 9} y2={lampY(H_MAX)} className="range-cap" />
            <line x1={TX - 9} y1={lampY(H_MIN)} x2={TX + 9} y2={lampY(H_MIN)} className="range-cap" />
            <text x={TX - 14} y={lampY(H_MAX) + 5} className="range-label">
              {H_MAX}
            </text>
            <text x={TX - 14} y={lampY(H_MIN) + 5} className="range-label">
              {H_MIN}
            </text>
          </>
        )}
        {idle ? (
          <>
            <path d={`M ${TX - 11} ${GY} L ${TX - 8} ${f(lampY(H_MIN) + 4)} L ${TX + 8} ${f(lampY(H_MIN) + 4)} L ${TX + 11} ${GY} Z`} className="tower" />
            <circle cx={TX} cy={f(LY)} r={7} className="lamp ghost" />
          </>
        ) : (
          <>
            <path d={`M ${TX - 11} ${GY} L ${TX - 7} ${f(LY + 8)} L ${TX + 7} ${f(LY + 8)} L ${TX + 11} ${GY} Z`} className="tower" />
            {/* The lamp's own small fan: a copy of the dial. */}
            {arcs.red.map((w, i) => (
              <path key={`r${i}`} d={arcPath(TX, LY, 15, w[0], w[1])} className="mini red" />
            ))}
            <path d={arcPath(TX, LY, 15, arcs.green[0], arcs.green[1])} className="mini green" />
            <circle cx={TX} cy={f(LY)} r={7} className="lamp" />
            {!rising && (
              <text x={TX + 14} y={f(LY - 16)} className="h-label">
                height {lh.toFixed(2)}
              </text>
            )}
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

      <Dial {...L.dial} arcs={arcs} beam={beam} {...dialText} />
    </svg>
  );
}
