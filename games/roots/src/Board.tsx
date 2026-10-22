import { fmtChance } from '@originals/game-sdk/ui';
import { useLayoutEffect, useState } from 'react';
import {
  SIDE_LABEL,
  mapV,
  noRealOutline,
  other,
  pReal,
  roots,
  rulerBand,
  vertex,
  type Coeffs,
  type Range,
  type Side,
  type Stage,
} from './math';

/** One reveal's animation: the board moves from one stage's picture to the next. */
export interface Anim {
  from: Stage;
  to: Stage;
  key: number;
  ms: number;
}

export interface BoardProps {
  side: Side;
  range: Range;
  /** The coefficients known at stage `anim.to`. */
  k: Coeffs;
  anim: Anim;
  /** Whether the backed side won (final colouring), null while unknown. */
  won: boolean | null;
}

// ---------- animation helpers ----------

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
};
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

/** Signed, with a real minus sign; small values get a third decimal so they never read as 0.00. */
const fmt = (x: number, d = 2) => {
  const digits = d === 2 && Math.abs(x) < 0.095 && x !== 0 ? 3 : d;
  const s = Math.abs(x).toFixed(digits);
  return (x < 0 && Number(s) !== 0 ? '−' : '') + s;
};
/** A tick label: whole numbers plainly, halves as ½. */
const fmtTick = (x: number) => {
  const r = Math.round(x * 100) / 100;
  if (Math.abs(r) === 0.5) return (r < 0 ? '−' : '') + '½';
  return (r < 0 ? '−' : '') + String(Math.abs(r));
};
export const fmtRange = (B: number) => (B === 0.5 ? '½' : String(B));

/** 1, 2 or 5 × a power of ten, at least x. */
function niceStep(x: number) {
  const e = 10 ** Math.floor(Math.log10(x));
  const m = x / e;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * e;
}

const path = (pts: [number, number][], close = false) =>
  pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ') + (close ? ' Z' : '');

const VIEW_H = 350;

// ---------- the odds map ----------

const BX0 = 62;
const BX1 = 386;
const BY0 = 50;
const BY1 = 274;
const BW = BX1 - BX0;
const BH = BY1 - BY0;
const toX = (u: number) => BX0 + ((u + 1) / 2) * BW;
const toY = (v: number) => BY1 - v * BH;

interface MapState {
  zoom: number;
  alpha: number;
  /** The live band of the box (v from lo to hi); outside it is dimmed. */
  lo: number;
  hi: number;
  /** 0 → 1: the b-ruler fades in. */
  ruler: number;
  /** Where the b marker is (u = b/B), if shown. */
  marker: number | null;
}

function mapState(stage: Stage, from: Stage, p: number, k: Coeffs, B: number): MapState {
  const alpha = k.a === null ? 1 : Math.max(Math.abs(k.a), 1e-9);
  const vt = k.a !== null && k.c !== null ? mapV(k.a * k.c, 1, alpha) : 0.5;
  const uB = k.b !== null ? k.b / B : 0;
  const base: MapState = { zoom: 1, alpha, lo: 0, hi: 1, ruler: 0, marker: null };
  if (stage === 0) return { ...base, zoom: 0, alpha: 1 };
  if (stage === 1) {
    if (from !== 0) return base;
    // First narrow the box to the rows a allows, then zoom in on them.
    const s = ease(seg(p, 0, 0.42));
    const z = ease(seg(p, 0.48, 1));
    return { ...base, zoom: z, lo: lerp(0, mapV(-alpha, z, alpha), s), hi: lerp(1, mapV(alpha, z, alpha), s) };
  }
  if (stage === 2) {
    const s = from === 1 ? ease(seg(p, 0, 0.65)) : 1;
    return { ...base, lo: lerp(0, vt, s), hi: lerp(1, vt, s), ruler: from === 1 ? seg(p, 0.45, 0.9) : 1 };
  }
  // b sweeps in from the far end of the ruler, through the middle, and settles.
  const start = uB >= 0 ? -1 : 1;
  const m = from === 2 ? lerp(start, uB, easeOut(p)) : uB;
  return { ...base, lo: vt, hi: vt, ruler: 1, marker: m };
}

interface PanelProps {
  side: Side;
  range: Range;
  k: Coeffs;
  stage: Stage;
  from: Stage;
  p: number;
  won: boolean | null;
}

function OddsMap({ side, range: B, k, stage, from, p, won }: PanelProps) {
  const s = mapState(stage, from, p, k, B);
  const outline = noRealOutline(B, s.zoom, s.alpha);
  const cup = outline.slice(0, -2).map(([u, v]) => [toX(u), toY(v)] as [number, number]);
  const region = outline.map(([u, v]) => [toX(u), toY(v)] as [number, number]);
  const winNone = side === 'none';
  const t = k.a !== null && k.c !== null ? k.a * k.c : null;
  const vt = s.lo; // once collapsed, lo = hi = the ruler's height
  const h = k.a !== null && k.c !== null ? rulerBand(k.a, k.c, B) : 0;
  const open = s.hi - s.lo > 0.5;

  // What the box says right now (its stage before the reveal finishes).
  const shownStage: Stage = p < 1 ? from : stage;
  const shownK: Coeffs = { a: shownStage >= 1 ? k.a : null, c: shownStage >= 2 ? k.c : null, b: shownStage >= 3 ? k.b : null };
  const pr = pReal(shownK, B);

  // Ticks on the a·c axis: stretched before a, linear after.
  const ticks =
    s.zoom === 0
      ? [-0.5, -0.1, 0, 0.1, 0.5].map((q) => ({ q, label: fmtTick(q) }))
      : [-s.alpha, 0, s.alpha].map((q) => ({ q, label: q === 0 ? '0' : fmt(q) }));
  const v0 = mapV(0, s.zoom, s.alpha);

  // Label the cup on its right arm, inside the box.
  const arm = cup.filter(([x]) => x > toX(0)).find(([, y]) => y <= toY(0.8)) ?? cup[cup.length - 1];
  const armRight = arm[0] < BX1 - 80;
  const cupW = cup.length > 0 ? cup[cup.length - 1][0] - cup[0][0] : 0;

  let caption = 'Every point of the box is equally likely';
  if (shownStage === 1 && k.a !== null) caption = `a = ${fmt(k.a)}, so a·c is uniform on ±${fmt(Math.abs(k.a))}`;
  if (shownStage === 2 && t !== null)
    caption = t <= 0 ? `a·c = ${fmt(t)} ≤ 0: every b gives real roots` : `a·c = ${fmt(t)}: no real roots if |b| < ${fmt(2 * Math.sqrt(t))}`;
  if (shownStage === 3 && k.b !== null && t !== null) caption = `b = ${fmt(k.b)}: b² = ${fmt(k.b * k.b)} ${k.b * k.b >= 4 * t ? '≥' : '<'} 4ac = ${fmt(4 * t)}`;

  const share = (x: Side) => (x === 'real' ? pr : 1 - pr);

  return (
    <svg
      viewBox={`0 0 400 ${VIEW_H}`}
      className="roots-panel odds"
      role="img"
      aria-label={`Odds map: ${fmtChance(share(side))} of the box is ${SIDE_LABEL[side].toLowerCase()}`}
    >
      <rect x={4} y={4} width={392} height={VIEW_H - 8} rx={14} className="panel-bg" />
      <text x={18} y={26} className="panel-title">
        The odds · green area = your chance
      </text>
      <text x={BX0 - 8} y={BY0 - 9} className="axis-name end">
        a·c
      </text>

      <defs>
        <clipPath id="roots-box">
          <rect x={BX0} y={BY0} width={BW} height={BH} />
        </clipPath>
      </defs>

      <g clipPath="url(#roots-box)">
        <rect x={BX0} y={BY0} width={BW} height={BH} className={winNone ? 'zone lose' : 'zone win'} />
        <path d={path(region, true)} className={winNone ? 'zone win' : 'zone lose'} />
        <line x1={BX0} x2={BX1} y1={toY(v0)} y2={toY(v0)} className="zero-line" />
        <path d={path(cup)} className="cup" />
        {open && cupW > 130 && (
          <text x={toX(0)} y={BY0 + 18} className="zone-label">
            no real roots
          </text>
        )}
        {open && (
          <text x={toX(0)} y={BY1 - 10} className="zone-label">
            real roots
          </text>
        )}

        {/* What is already ruled out: dimmed. */}
        {s.hi < 1 && <rect x={BX0} y={BY0} width={BW} height={Math.max(0, toY(s.hi) - BY0)} className="dim" />}
        {s.lo > 0 && <rect x={BX0} y={toY(s.lo)} width={BW} height={Math.max(0, BY1 - toY(s.lo))} className="dim" />}
        {(s.lo > 0.001 || s.hi < 0.999) && s.hi - s.lo > 0.004 && (
          <>
            <line x1={BX0} x2={BX1} y1={toY(s.hi)} y2={toY(s.hi)} className="band-edge" />
            <line x1={BX0} x2={BX1} y1={toY(s.lo)} y2={toY(s.lo)} className="band-edge" />
          </>
        )}
      </g>
      <rect x={BX0} y={BY0} width={BW} height={BH} className="box" />
      {open && (
        <text x={arm[0] + (armRight ? 8 : -8)} y={Math.max(BY0 + 34, arm[1])} className={'cup-label' + (armRight ? '' : ' end')}>
          b² = 4ac
        </text>
      )}

      {/* The b-ruler: once a and c are known, b decides on this line. */}
      {s.ruler > 0 && t !== null && (
        <g style={{ opacity: s.ruler }}>
          <line x1={toX(-1)} x2={toX(1)} y1={toY(vt)} y2={toY(vt)} className={'ruler ' + (winNone ? 'lose' : 'win')} />
          {h > 0 && <line x1={toX(-h)} x2={toX(h)} y1={toY(vt)} y2={toY(vt)} className={'ruler ' + (winNone ? 'win' : 'lose')} />}
          {h > 0 && h < 1 && (
            <>
              <line x1={toX(-h)} x2={toX(-h)} y1={toY(vt) - 11} y2={toY(vt) + 11} className="ruler-tick" />
              <line x1={toX(h)} x2={toX(h)} y1={toY(vt) - 11} y2={toY(vt) + 11} className="ruler-tick" />
            </>
          )}
          <text x={BX0 - 8} y={toY(vt) + 4} className="tick end strong">
            {fmt(t)}
          </text>
          {stage === 2 && p >= 1 && (
            <text x={toX(0)} y={toY(vt) + (vt > 0.5 ? 30 : -18)} className="ruler-label">
              b lands somewhere on this ruler
            </text>
          )}
        </g>
      )}
      {s.marker !== null && (
        <g transform={`translate(${toX(s.marker).toFixed(1)} ${toY(vt).toFixed(1)})`}>
          <line x1={0} x2={0} y1={12} y2={BY1 - toY(vt)} className="marker-drop" />
          <circle r={9} className={'marker-dot' + (p >= 1 && won !== null ? (won ? ' won' : ' lost') : '')} />
        </g>
      )}

      {/* Axes. */}
      {s.ruler < 1 &&
        ticks.map((tk) => {
          const v = mapV(tk.q, s.zoom, s.alpha);
          if (v < -0.001 || v > 1.001) return null;
          return (
            <g key={tk.label} style={{ opacity: 1 - s.ruler }}>
              <line x1={BX0 - 4} x2={BX0} y1={toY(v)} y2={toY(v)} className="tick-mark" />
              <text x={BX0 - 8} y={toY(v) + 4} className="tick end">
                {tk.label}
              </text>
            </g>
          );
        })}
      {[-1, -0.5, 0, 0.5, 1].map((u) => (
        <text key={u} x={toX(u)} y={BY1 + 18} className={'tick' + (u === -1 ? ' start' : u === 1 ? ' end' : '')}>
          {fmtTick(u * B)}
        </text>
      ))}
      <text x={BX0 - 8} y={BY1 + 18} className="axis-name end">
        b
      </text>

      {/* Legend: the two shares of the box. */}
      {[side, other(side)].map((x, i) => (
        <g key={x} transform={`translate(${i === 0 ? 22 : 214} 318)`}>
          <rect x={0} y={-10} width={12} height={12} rx={3} className={'swatch ' + (i === 0 ? 'win' : 'lose')} />
          <text x={18} y={0} className={'legend' + (i === 0 ? ' mine' : '')}>
            {SIDE_LABEL[x]} <tspan className="legend-num">{fmtChance(share(x))}</tspan>
          </text>
        </g>
      ))}
      <text x={200} y={339} className="caption">
        {caption}
      </text>
    </svg>
  );
}

// ---------- the curve ----------

const PX0 = 14;
const PX1 = 386;
const PY0 = 46;
const PY1 = 306;
const OX = (PX0 + PX1) / 2;
const OY = (PY0 + PY1) / 2;
const HALF_W = (PX1 - PX0) / 2 - 8;
const HALF_H = (PY1 - PY0) / 2 - 12;

interface View {
  X: number;
  Y: number;
}
const BASE_VIEW: View = { X: 2.4, Y: 1.5 };

function viewFor(stage: Stage, k: Coeffs): View {
  if (stage <= 1 || k.a === null || k.c === null) return BASE_VIEW;
  const a = k.a === 0 ? 1e-9 : k.a;
  if (stage === 2 || k.b === null) {
    const X = a * k.c > 0 ? Math.min(60, Math.max(BASE_VIEW.X, 1.3 * Math.sqrt(k.c / a))) : BASE_VIEW.X;
    return { X, Y: BASE_VIEW.Y };
  }
  const vx = vertex(a, k.b, k.c);
  const rs = roots(a, k.b, k.c);
  const reach = Math.max(Math.abs(vx.x), ...rs.map(Math.abs));
  return {
    X: Math.min(400, Math.max(BASE_VIEW.X, 1.2 * reach)),
    Y: Math.min(5000, Math.max(BASE_VIEW.Y, 1.3 * Math.abs(vx.y))),
  };
}

const lerpView = (a: View, b: View, t: number): View => ({
  X: Math.exp(lerp(Math.log(a.X), Math.log(b.X), t)),
  Y: Math.exp(lerp(Math.log(a.Y), Math.log(b.Y), t)),
});

function curvePath(f: (x: number) => number, view: View, x0 = -view.X, x1 = view.X, n = 160) {
  const sx = HALF_W / view.X;
  const sy = HALF_H / view.Y;
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    pts.push([OX + x * sx, Math.max(-2000, Math.min(2400, OY - f(x) * sy))]);
  }
  return path(pts);
}

function Equation({ k, stage, from, p }: { k: Coeffs; stage: Stage; from: Stage; p: number }) {
  // A coefficient being revealed fades in; unknown ones are "?".
  const term = (val: number | null, idx: Stage, first: boolean, suffix: string) => {
    const known = val !== null && stage >= idx;
    if (!known)
      return (
        <>
          {first ? '' : ' + '}
          <tspan className="unknown">?</tspan>
          {suffix}
        </>
      );
    const fading = from < idx && p < 1;
    const sign = val! < 0 ? (first ? '−' : ' − ') : first ? '' : ' + ';
    return (
      <>
        {sign}
        <tspan className={'known' + (fading ? ' fresh' : '')} style={fading ? { opacity: 0.2 + 0.8 * seg(p, 0, 0.45) } : undefined}>
          {fmt(Math.abs(val!))}
        </tspan>
        {suffix}
      </>
    );
  };
  return (
    <text x={200} y={32} className="equation">
      y = {term(k.a, 1, true, 'x²')}
      {term(k.b, 3, false, 'x')}
      {term(k.c, 2, false, '')}
    </text>
  );
}

function Curve({ side, range: B, k, stage, from, p, won }: PanelProps) {
  const a = k.a ?? 0;
  const c = k.c ?? 0;
  const winNone = side === 'none';

  // Displayed coefficients and view, mid-reveal.
  let aD = 0;
  let cD = 0;
  let bD = 0;
  let ghost = 0;
  let bracket = 0;
  let track = 0;
  let view = BASE_VIEW;
  if (stage === 0) ghost = 1;
  if (stage === 1) {
    aD = lerp(0.0001, a, from === 0 ? ease(p) : 1);
    ghost = from === 0 ? 1 - seg(p, 0, 0.4) : 0;
    bracket = from === 0 ? seg(p, 0.5, 1) : 1;
  }
  if (stage === 2) {
    const t = from === 1 ? ease(p) : 1;
    aD = a;
    cD = lerp(0, c, t);
    bracket = from === 1 ? 1 - seg(p, 0, 0.4) : 0;
    track = from === 1 ? seg(p, 0.6, 1) : 1;
    view = lerpView(BASE_VIEW, viewFor(2, k), t);
  }
  if (stage === 3) {
    aD = a;
    cD = c;
    const uB = (k.b ?? 0) / B;
    const start = uB >= 0 ? -1 : 1;
    bD = (from === 2 ? lerp(start, uB, easeOut(p)) : uB) * B;
    track = from === 2 ? 1 - 0.65 * seg(p, 0.85, 1) : 0.35;
    view = lerpView(viewFor(2, k), viewFor(3, k), from === 2 ? ease(seg(p, 0.35, 1)) : 1);
  }
  const sx = HALF_W / view.X;
  const sy = HALF_H / view.Y;
  const settled = stage === 3 && p >= 1;
  const rs = settled && k.b !== null ? roots(a, k.b, c) : [];
  const vx = stage >= 2 && aD !== 0 ? vertex(aD, bD, cD) : null;

  // The vertex track: as b moves, the turning point slides along y = c − a·x².
  // Where that track is on the curve's own side of the line, the curve misses.
  const reachX = aD !== 0 ? B / (2 * Math.abs(aD)) : view.X;
  const trackX = Math.min(view.X * 1.05, reachX);
  const missX = a * c > 0 ? Math.sqrt(c / a) : 0;

  // Grid and tick labels at a round step that suits the zoom.
  const stepX = niceStep(view.X / 2.6);
  const stepY = niceStep(view.Y / 1.6);
  const gx: number[] = [];
  for (let x = stepX; x <= view.X * 1.04; x += stepX) gx.push(x, -x);
  const gy: number[] = [];
  for (let y = stepY; y <= view.Y * 1.12; y += stepY) gy.push(y, -y);

  const curveClass = settled && won !== null ? (won ? 'curve won' : 'curve lost') : stage >= 2 ? 'curve live' : 'curve pending';

  let caption = 'Will the curve cross the line y = 0?';
  if (stage >= 1 && !(stage === 1 && from === 0 && p < 0.5)) caption = a > 0 ? 'a > 0: the curve opens upward' : 'a < 0: the curve opens downward';
  if (stage >= 2 && !(stage === 2 && from === 1 && p < 0.5))
    caption = a * c <= 0 ? 'a and c have opposite signs: it must cross' : 'b slides the turning point along the dotted track';
  if (settled) {
    caption =
      rs.length === 0
        ? 'It misses the line: no real roots'
        : rs.length === 1 || Math.abs(rs[0] - rs[1]) < 1e-9
          ? `It touches the line at x = ${fmt(rs[0])}`
          : `It crosses the line at x = ${fmt(rs[0])} and ${fmt(rs[1])}`;
  }

  return (
    <svg viewBox={`0 0 400 ${VIEW_H}`} className="roots-panel curve-panel" role="img" aria-label="The parabola y = ax² + bx + c">
      <rect x={4} y={4} width={392} height={VIEW_H - 8} rx={14} className="panel-bg" />
      <Equation k={k} stage={stage} from={from} p={p} />
      <defs>
        <clipPath id="roots-plot">
          <rect x={PX0} y={PY0} width={PX1 - PX0} height={PY1 - PY0} />
        </clipPath>
      </defs>

      <g clipPath="url(#roots-plot)">
        {gx.map((x) => (
          <line key={'gx' + x} x1={OX + x * sx} x2={OX + x * sx} y1={PY0} y2={PY1} className="grid" />
        ))}
        {gy.map((y) => (
          <line key={'gy' + y} x1={PX0} x2={PX1} y1={OY - y * sy} y2={OY - y * sy} className="grid" />
        ))}
        <line x1={OX} x2={OX} y1={PY0} y2={PY1} className="y-axis" />
        <line x1={PX0} x2={PX1} y1={OY} y2={OY} className="the-line" />
        {gx
          .filter((x) => Math.abs(x) * sx < HALF_W - 6)
          .map((x) => (
            <text key={'tx' + x} x={OX + x * sx} y={OY + 16} className="axis-tick">
              {fmtTick(x)}
            </text>
          ))}
        {gy
          .filter((y) => Math.abs(y) * sy < HALF_H + 4)
          .map((y) => (
            <text key={'ty' + y} x={OX - 6} y={OY - y * sy + 4} className="axis-tick end">
              {fmtTick(y)}
            </text>
          ))}

        {ghost > 0 && (
          <g style={{ opacity: ghost }}>
            <path d={curvePath((x) => 0.42 * x * x - 0.8, BASE_VIEW)} className="ghost" />
            <text x={OX + 1.8 * (HALF_W / BASE_VIEW.X)} y={OY - 0.55 * (HALF_H / BASE_VIEW.Y)} className="ghost-q">
              ?
            </text>
          </g>
        )}

        {bracket > 0 && (
          <g style={{ opacity: bracket }} className="bracket">
            <line x1={OX} x2={OX} y1={OY - sy} y2={OY + sy} />
            <line x1={OX - 7} x2={OX + 7} y1={OY - sy} y2={OY - sy} />
            <line x1={OX - 7} x2={OX + 7} y1={OY + sy} y2={OY + sy} />
            <text x={OX + 12} y={OY - sy + 4}>
              c moves it up or down
            </text>
          </g>
        )}

        {track > 0 && aD !== 0 && (
          <g style={{ opacity: track }}>
            <path d={curvePath((x) => cD - aD * x * x, view, -trackX, trackX)} className={'track ' + (winNone ? 'lose' : 'win')} />
            {missX > 0 && (
              <path
                d={curvePath((x) => cD - aD * x * x, view, -Math.min(missX, trackX), Math.min(missX, trackX), 60)}
                className={'track ' + (winNone ? 'win' : 'lose')}
              />
            )}
          </g>
        )}

        {stage >= 1 && !(stage === 1 && from === 0 && p === 0) && <path d={curvePath((x) => aD * x * x + bD * x + cD, view)} className={curveClass} />}
        {vx && track > 0 && <circle cx={OX + vx.x * sx} cy={Math.max(-50, Math.min(380, OY - vx.y * sy))} r={5.5} className="vertex" />}
        {rs.map((r, i) => (
          <circle key={i} cx={OX + r * sx} cy={OY} r={7} className="root" />
        ))}
      </g>
      <text x={PX1 - 6} y={OY - 8} className="line-label">
        y = 0
      </text>
      <text x={200} y={334} className="caption">
        {caption}
      </text>
    </svg>
  );
}

export default function RootsBoard({ side, range, k, anim, won }: BoardProps) {
  const p = useProgress(anim.key, anim.ms);
  const props: PanelProps = { side, range, k, stage: anim.to, from: anim.from, p, won };
  return (
    <div className="roots-board">
      <Curve {...props} />
      <OddsMap {...props} />
    </div>
  );
}

export interface StepsProps {
  /** Chance of the backed side after 0, 1, 2 and 3 reveals (null if not yet known). */
  chances: (number | null)[];
  /** How many coefficients are shown. */
  stage: Stage;
  /** A reveal is animating towards the next node. */
  busy: boolean;
}

const STEP_NAMES = ['Start', 'After a', 'After c', 'After b'];
const STEP_NOTES = ['at the bet', 'cash-out point', 'cash-out point', 'settles'];

/** The round's path: four nodes, the chance at each, and where you can cash out. */
export function Steps({ chances, stage, busy }: StepsProps) {
  return (
    <ol className="roots-steps" aria-label="Round progress">
      {STEP_NAMES.map((name, i) => {
        const v = chances[i];
        const state = i < stage || (busy && i === stage) ? 'done' : i === stage ? 'now' : busy && i === stage + 1 ? 'next' : 'todo';
        return (
          <li key={name} className={`step ${state}` + (i === 1 || i === 2 ? ' cp' : '')}>
            <span>{name}</span>
            <b>{v === null ? '?' : fmtChance(v)}</b>
            <small>{STEP_NOTES[i]}</small>
          </li>
        );
      })}
    </ol>
  );
}
