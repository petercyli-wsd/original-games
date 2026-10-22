import { fmtChance } from '@originals/game-sdk/ui';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import {
  SLICES,
  SLICE_DEG,
  bell,
  cloudPoint,
  cosDeg,
  fan,
  greenSlices,
  missWedges,
  needSign,
  pLandGivenX,
  quadrantChances,
  sinDeg,
  targetWedges,
  type Pt,
  type Target,
} from './math';

/** One reveal of the current point: 0 = nothing known, 1 = x known, 2 = y known. */
export type Stage = 0 | 1 | 2;

export interface Anim {
  from: Stage;
  to: Stage;
  key: number;
  ms: number;
}

export interface BoardProps {
  target: Target;
  /** The axis angle used for drawing (eases when the slider moves). */
  theta: number;
  /** The axis angle of the settings, for the numbers. */
  thetaExact: number;
  /** Points already landed in the target. */
  landed: Pt[];
  /** The point being revealed, if any. */
  cur: { x: number; y: number | null } | null;
  anim: Anim;
  /** Whether the current point landed in the target, once y is known. */
  hit: boolean | null;
  /** 1, or 0.25 in turbo: scales the CSS transitions. */
  speed: number;
  /** "Point 2 of 3", when there is more than one. */
  pointLabel: string | null;
}

// ---------- animation helpers ----------

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOut = (t: number) => 1 - (1 - clamp01(t)) ** 3;
const seg = (p: number, lo: number, hi: number) => clamp01((p - lo) / (hi - lo));

/** 0 → 1 over `ms`, restarting whenever `key` changes. */
function useProgress(key: number, ms: number): number {
  const [p, setP] = useState(1);
  useLayoutEffect(() => {
    if (ms <= 0) {
      setP(1);
      return;
    }
    setP(0);
    const t0 = performance.now();
    let raf = requestAnimationFrame(function tick(t) {
      const q = Math.min(1, (t - t0) / ms);
      setP(q);
      if (q < 1) raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [key, ms]);
  return p;
}

/** A number that eases towards `target` over `ms` whenever it changes. */
export function useTween(target: number, ms: number): number {
  const [v, setV] = useState(target);
  const cur = useRef(target);
  useEffect(() => {
    const from = cur.current;
    if (from === target) return;
    if (ms <= 0) {
      cur.current = target;
      setV(target);
      return;
    }
    const t0 = performance.now();
    let raf = requestAnimationFrame(function tick(t) {
      const q = Math.min(1, (t - t0) / ms);
      const val = q >= 1 ? target : lerp(from, target, easeOut(q));
      cur.current = val;
      setV(val);
      if (q < 1) raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

// ---------- geometry of the plot ----------

const VW = 400;
const VH = 440;
const LIM = 3.4;
const PX0 = 16;
const PX1 = 384;
const PY0 = 10;
const PY1 = 378;
const S = (PX1 - PX0) / (2 * LIM);
const CX = (PX0 + PX1) / 2;
const CY = (PY0 + PY1) / 2;
/** Radius (in the round frame) of the drawn cloud. */
const R_PIE = 2.4;
const BELL_W = 86;

const clampL = (v: number) => Math.max(-LIM, Math.min(LIM, v));
const sx = (x: number) => CX + clampL(x) * S;
const sy = (y: number) => CY - clampL(y) * S;
const f1 = (v: number) => v.toFixed(1);

function path(pts: Pt[], close = true) {
  return pts.map(([x, y], i) => `${i ? 'L' : 'M'}${f1(CX + x * S)} ${f1(CY - y * S)}`).join(' ') + (close ? ' Z' : '');
}

/** Screen-space polygon path (already in px). */
function pxPath(pts: [number, number][], close = true) {
  return pts.map(([x, y], i) => `${i ? 'L' : 'M'}${f1(x)} ${f1(y)}`).join(' ') + (close ? ' Z' : '');
}

/** Signed, with a real minus sign. */
export const fmtNum = (v: number, d = 2) => {
  const s = Math.abs(v).toFixed(d);
  return (v < 0 && Number(s) !== 0 ? '−' : '') + s;
};

const QUADS = [
  { name: 'top-right', x: PX1 - 12, y: PY0 + 24, anchor: 'end' },
  { name: 'top-left', x: PX0 + 12, y: PY0 + 24, anchor: 'start' },
  { name: 'bottom-left', x: PX0 + 12, y: PY1 - 22, anchor: 'start' },
  { name: 'bottom-right', x: PX1 - 12, y: PY1 - 22, anchor: 'end' },
] as const;

const isTargetQuad = (target: Target, q: number) => q === 0 || (target === 'same' && q === 2);

// ---------- the board ----------

export default function QuadrantBoard({ target, theta, thetaExact, landed, cur, anim, hit, speed, pointLabel }: BoardProps) {
  const p = useProgress(anim.key, anim.ms);
  const stage: Stage = cur ? anim.to : 0;
  const from: Stage = cur ? anim.from : 0;
  const settled = p >= 1;

  // ----- the cloud: 36 equal-chance slices -----
  const green = targetWedges(target, theta).map(([a, b]) => path(fan(a, b, theta, R_PIE)));
  const red = missWedges(target, theta).map(([a, b]) => path(fan(a, b, theta, R_PIE)));
  const spokes = Array.from({ length: SLICES }, (_, k) => cloudPoint(k * SLICE_DEG, theta, R_PIE));
  const ring = (R: number) => path(Array.from({ length: 121 }, (_, i) => cloudPoint(i * 3, theta, R)));
  const cos = cosDeg(theta);
  const sin = sinDeg(theta);
  // Maps the round frame onto the screen, for the density glow.
  const glow = `matrix(${S} ${-S * cos} 0 ${-S * sin} ${CX} ${CY})`;
  const k = greenSlices(target, thetaExact);
  const pPoint = k / SLICES;
  const dim = stage >= 1;

  // ----- the slice through x -----
  const x = cur?.x ?? 0;
  let sliceX: number | null = null;
  let grow = 0;
  if (cur && stage >= 1) {
    if (stage === 1 && from === 0) {
      sliceX = lerp(-LIM - 0.3, x, easeOut(seg(p, 0, 0.7)));
      grow = easeOut(seg(p, 0.68, 1));
    } else {
      sliceX = x;
      grow = 1;
    }
  }
  const xKnown = cur !== null && (stage === 2 || (stage === 1 && settled));
  const pLand = cur ? pLandGivenX(target, thetaExact, x) : 0;

  // The bell bulges away from the centre when there is room, else inwards.
  const room = (LIM - Math.abs(x)) * S;
  const dir = room > BELL_W + 12 ? (x >= 0 ? 1 : -1) : x >= 0 ? -1 : 1;
  const want = cur ? needSign(target, x) : 0;
  let bellGreen = '';
  let bellRed = '';
  let labelG: { y: number; x: number } | null = null;
  let labelR: { y: number; x: number } | null = null;
  if (cur && sliceX !== null && grow > 0) {
    const samples = bell(x, theta);
    const x0 = sx(x);
    const part = (keep: (y: number) => boolean) => {
      const pts = samples.filter((s) => keep(s.y));
      if (pts.length < 2) return { d: '', mid: null as null | { x: number; y: number } };
      const poly: [number, number][] = [[x0, sy(pts[0].y)], ...pts.map((s) => [x0 + dir * BELL_W * grow * s.h, sy(s.y)] as [number, number]), [x0, sy(pts[pts.length - 1].y)]];
      // Label at the part's mass median.
      let total = 0;
      for (let i = 1; i < pts.length; i++) total += ((pts[i].h + pts[i - 1].h) / 2) * (pts[i].y - pts[i - 1].y);
      let acc = 0;
      let mid = pts[0];
      for (let i = 1; i < pts.length; i++) {
        acc += ((pts[i].h + pts[i - 1].h) / 2) * (pts[i].y - pts[i - 1].y);
        if (acc >= total / 2) {
          mid = pts[i];
          break;
        }
      }
      const maxH = Math.max(...pts.map((s) => s.h));
      return { d: pxPath(poly), mid: { x: x0 + dir * (BELL_W * grow * maxH + 8), y: Math.max(PY0 + 14, Math.min(PY1 - 30, sy(mid.y) + 4)) } };
    };
    const up = part((y) => y >= 0);
    const down = part((y) => y <= 0);
    const g = want === 1 ? up : want === -1 ? down : null;
    const r = want === 1 ? down : want === -1 ? up : null;
    if (g) {
      bellGreen = g.d;
      bellRed = r?.d ?? '';
      labelG = g.mid;
      labelR = r?.mid ?? null;
    } else {
      // No y can win: the whole bell is red.
      bellRed = [up.d, down.d].filter(Boolean).join(' ');
      labelR = (up.d ? up.mid : down.mid) ?? null;
    }
    // Keep the two labels apart.
    if (labelG && labelR && Math.abs(labelG.y - labelR.y) < 18) {
      const sgn = labelG.y <= labelR.y ? -1 : 1;
      const m = (labelG.y + labelR.y) / 2;
      labelG = { ...labelG, y: m + sgn * 9 };
      labelR = { ...labelR, y: m - sgn * 9 };
    }
  }

  // ----- the point -----
  let pointY: number | null = null;
  if (cur && stage === 2 && cur.y !== null) {
    pointY = from === 1 ? lerp(LIM + 0.4, cur.y, easeOut(seg(p, 0, 0.82))) : cur.y;
  }
  const landedNow = stage === 2 && (from !== 1 || p >= 0.82);
  const showResult = landedNow && hit !== null;

  // ----- captions -----
  const pct = (v: number) => fmtChance(v);
  let caption = (
    <>
      Green share of the cloud: <tspan className="em-g">{k}</tspan> of {SLICES} equal-chance slices = <tspan className="em-g">{pct(pPoint)}</tspan>
    </>
  );
  if (cur && stage === 1 && from === 0 && !settled) caption = <>Revealing x…</>;
  else if (cur && stage === 1) {
    caption =
      want === 0 ? (
        <>
          x = {fmtNum(x)} {target === 'corner' ? 'is left of the y-axis' : 'is on the axis'}: <tspan className="em-r">no y can win</tspan>
        </>
      ) : (
        <>
          Green share of the bell on the slice x = {fmtNum(x)}: <tspan className="em-g">{pct(pLand)}</tspan>
        </>
      );
  } else if (cur && stage === 2 && !landedNow) caption = <>Revealing y…</>;
  else if (cur && stage === 2 && cur.y !== null) {
    caption = (
      <>
        Landed at ({fmtNum(cur.x)}, {fmtNum(cur.y)}):{' '}
        {hit ? <tspan className="em-g">in the green</tspan> : <tspan className="em-r">outside the green</tspan>}
      </>
    );
  }

  const quadP = quadrantChances(thetaExact);
  const style = { '--quad-ms': `${Math.round(380 * speed)}ms` } as CSSProperties;

  return (
    <svg
      viewBox={`0 0 ${VW} ${VH}`}
      className="quad"
      style={style}
      role="img"
      aria-label={`Correlated cloud: ${k} of ${SLICES} slices, ${pct(pPoint)}, are in the target`}
    >
      <defs>
        <clipPath id="quad-plot">
          <rect x={PX0} y={PY0} width={PX1 - PX0} height={PY1 - PY0} rx={14} />
        </clipPath>
        <radialGradient id="quad-glow" gradientUnits="userSpaceOnUse" cx={0} cy={0} r={3.2} gradientTransform={glow}>
          {[0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1].map((t) => (
            <stop key={t} offset={t} stopColor="var(--accent)" stopOpacity={Math.exp(-0.5 * (3.2 * t) ** 2)} />
          ))}
        </radialGradient>
      </defs>

      <rect x={PX0} y={PY0} width={PX1 - PX0} height={PY1 - PY0} rx={14} className="plot-bg" />
      <g clipPath="url(#quad-plot)">
        {/* The target quadrants of the plane. */}
        <rect x={CX} y={PY0} width={PX1 - CX} height={CY - PY0} className="zone" />
        {target === 'same' && <rect x={PX0} y={CY} width={CX - PX0} height={PY1 - CY} className="zone" />}

        {[-3, -2, -1, 1, 2, 3].map((v) => (
          <g key={v} className="grid">
            <line x1={sx(v)} x2={sx(v)} y1={PY0} y2={PY1} />
            <line x1={PX0} x2={PX1} y1={sy(v)} y2={sy(v)} />
          </g>
        ))}

        <rect x={PX0} y={PY0} width={PX1 - PX0} height={PY1 - PY0} fill="url(#quad-glow)" className="glow" />

        <g className={'cloud' + (dim ? ' dim' : '')}>
          {red.map((d, i) => (
            <path key={'r' + i} d={d} className="slice miss" />
          ))}
          {green.map((d, i) => (
            <path key={'g' + i} d={d} className="slice win" />
          ))}
          <path d={ring(1)} className="contour" />
          <path d={ring(2)} className="contour" />
          {spokes.map(([px, py], i) => (
            <line key={i} x1={CX} y1={CY} x2={f1(CX + px * S)} y2={f1(CY - py * S)} className="spoke" />
          ))}
          <path d={ring(R_PIE)} className="rim" />
        </g>

        {/* The axes: the edges of the quadrants. */}
        <line x1={PX0} x2={PX1} y1={CY} y2={CY} className="axis" />
        <line x1={CX} x2={CX} y1={PY0} y2={PY1} className="axis" />
        {[-3, -2, -1, 1, 2, 3].map((v) => (
          <g key={'t' + v} className="tick">
            <text x={sx(v)} y={CY + 14}>
              {fmtNum(v, 0)}
            </text>
            <text x={CX - 6} y={sy(v) + 4} className="end">
              {fmtNum(v, 0)}
            </text>
          </g>
        ))}
        <text x={PX1 - 8} y={CY - 8} className="axis-name end">
          x
        </text>
        <text x={CX + 8} y={PY0 + 16} className="axis-name start">
          y
        </text>

        {/* Points that have already landed. */}
        {landed.map(([lx, ly], i) => (
          <g key={i} className="landed">
            <circle cx={sx(lx)} cy={sy(ly)} r={6} />
            <text x={sx(lx) + 10} y={sy(ly) - 8} className="start">
              {i + 1}
            </text>
          </g>
        ))}

        {/* The slice through x, and the bell of y on it. */}
        {sliceX !== null && (
          <g className="slice-g">
            <line x1={sx(sliceX)} x2={sx(sliceX)} y1={PY0} y2={PY1} className="slice-line" />
            {bellRed && <path d={bellRed} className={'bell miss' + (landedNow ? ' faded' : '')} />}
            {bellGreen && <path d={bellGreen} className={'bell win' + (landedNow ? ' faded' : '')} />}
            {grow > 0.85 && !landedNow && labelG && (
              <text x={labelG.x} y={labelG.y} className={'bell-label win ' + (dir > 0 ? 'start' : 'end')}>
                {pct(pLand)}
              </text>
            )}
            {grow > 0.85 && !landedNow && labelR && (
              <text x={labelR.x} y={labelR.y} className={'bell-label miss ' + (dir > 0 ? 'start' : 'end')}>
                {pct(1 - pLand)}
              </text>
            )}
          </g>
        )}

        {pointY !== null && cur && (
          <g className={'point' + (showResult ? (hit ? ' hit' : ' miss') : '')}>
            {showResult && <circle cx={sx(cur.x)} cy={sy(pointY)} r={13} className="ring" />}
            <circle cx={sx(cur.x)} cy={sy(pointY)} r={7} className="dot" />
          </g>
        )}
      </g>

      {/* Each quadrant's chance (Sheppard). */}
      {QUADS.map((q, i) => (
        <g key={q.name} className={'quad-label' + (isTargetQuad(target, i) ? ' win' : '') + (dim ? ' dim' : '')}>
          <text x={q.x} y={q.y} className={q.anchor}>
            {pct(quadP[i])}
          </text>
          <text x={q.x} y={q.y + 13} className={'sub ' + q.anchor}>
            {q.name}
          </text>
        </g>
      ))}

      {/* x and y once known. */}
      {cur && xKnown && (
        <g className="coord">
          <rect x={Math.max(PX0 + 4, Math.min(PX1 - 76, sx(x) - 36))} y={PY1 + 3} width={72} height={20} rx={10} />
          <text x={Math.max(PX0 + 40, Math.min(PX1 - 40, sx(x)))} y={PY1 + 17}>
            x = {fmtNum(x)}
          </text>
        </g>
      )}
      {cur && cur.y !== null && landedNow && pointY !== null && (
        <text
          x={sx(cur.x) + (dir > 0 ? -16 : 16)}
          y={Math.max(PY0 + 14, Math.min(PY1 - 8, sy(pointY) + 4))}
          className={'y-label ' + (dir > 0 ? 'end' : 'start') + (hit ? ' win' : ' miss')}
        >
          y = {fmtNum(cur.y)}
        </text>
      )}

      <text x={VW / 2} y={VH - 12} className="caption">
        {pointLabel && <tspan className="em">{pointLabel} · </tspan>}
        {caption}
      </text>
    </svg>
  );
}

// ---------- the per-point strip under the board ----------

export interface PointPill {
  state: 'todo' | 'now' | 'in' | 'out';
  value: string;
  note: string;
}

export function PointStrip({ pills }: { pills: PointPill[] }) {
  return (
    <ol className={'quad-points n' + pills.length} aria-label="Points to land">
      {pills.map((pill, i) => (
        <li key={i} className={'pill ' + pill.state}>
          <span>{pills.length > 1 ? `Point ${i + 1}` : 'Your point'}</span>
          <b>{pill.value}</b>
          <small>{pill.note}</small>
        </li>
      ))}
    </ol>
  );
}

/** A 2×2 glyph of the target quadrants, for the chips. */
export function Glyph({ target }: { target: Target }) {
  const cells: [number, number, boolean][] = [
    [9, 1, true],
    [1, 1, false],
    [1, 9, target === 'same'],
    [9, 9, false],
  ];
  return (
    <svg viewBox="0 0 16 16" className="quad-glyph" aria-hidden="true">
      {cells.map(([cx, cy, on], i) => (
        <rect key={i} x={cx} y={cy} width={6} height={6} rx={1.2} className={on ? 'on' : ''} />
      ))}
    </svg>
  );
}
