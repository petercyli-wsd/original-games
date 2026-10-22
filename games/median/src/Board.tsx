import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { half, median, medianDensity, sideOf, type Outcomes, type Tally } from './math';

// Board geometry in viewBox units. The number line runs from X0 to X1; the
// plot above it (the median's density in the preview, the dropped points when
// live) shares its x scale.
const VB_W = 560;
const VB_H = 408;
const X0 = 30;
const W = 500;
const X1 = X0 + W;
const PT = 58; // plot top
const LY = 200; // number line
const CH = LY - PT - 16; // curve height at its peak
const DOT = 6.5;
const TUG_Y = 300; // tally slots
const BAR_Y = 356; // outcome bar

const sx = (u: number) => X0 + u * W;
const pct = (p: number) => (p >= 1 ? '100%' : p <= 0 ? '0%' : p < 0.001 ? '<0.1%' : `${(p * 100).toFixed(1)}%`);
const ord = (k: number) => `${k}${k % 10 === 1 && k !== 11 ? 'st' : k % 10 === 2 && k !== 12 ? 'nd' : k % 10 === 3 && k !== 13 ? 'rd' : 'th'}`;

export type Outcome = 'win' | 'bust' | 'cashed';

export interface BoardProps {
  n: number;
  a: number;
  b: number;
  /** Points on the line so far (in drop order). */
  points: number[];
  tally: Tally;
  odds: Outcomes;
  /** True before the bet: show the median's law instead of points. */
  preview: boolean;
  outcome: Outcome | null;
  dropMs: number;
  /** Drag the window (only before a round). */
  onDrag?: (centre: number) => void;
}

/** Stack dots that would overlap, so every point stays visible. */
function stack(points: number[]) {
  const placed: { x: number; level: number }[] = [];
  for (const p of points) {
    const x = sx(p);
    const used = new Set(placed.filter((q) => Math.abs(q.x - x) < 2 * DOT + 1).map((q) => q.level));
    let level = 0;
    while (used.has(level)) level++;
    placed.push({ x, level });
  }
  return placed;
}

function curve(n: number, from: number, to: number, closed: boolean) {
  const peak = medianDensity(n, 0.5);
  const steps = Math.max(2, Math.ceil((to - from) * 200));
  let d = '';
  for (let i = 0; i <= steps; i++) {
    const u = from + ((to - from) * i) / steps;
    const y = LY - (medianDensity(n, u) / peak) * CH;
    d += `${i ? 'L' : 'M'} ${sx(u).toFixed(2)} ${y.toFixed(2)} `;
  }
  return closed ? `${d}L ${sx(to).toFixed(2)} ${LY} L ${sx(from).toFixed(2)} ${LY} Z` : d;
}

export default function Board({ n, a, b, points, tally, odds, preview, outcome, dropMs, onDrag }: BoardProps) {
  const svg = useRef<SVGSVGElement>(null);
  const m = half(n);
  const left = n - points.length;
  const dots = stack(points);
  const allIn = points.length === n;
  const med = allIn ? median(points) : null;
  const medIdx = med === null ? -1 : points.indexOf(med);
  const draggable = preview && !!onDrag;

  const fromPointer = (e: ReactPointerEvent<SVGElement>) => {
    const el = svg.current;
    const mtx = el?.getScreenCTM();
    if (!el || !mtx || !onDrag) return;
    const pt = el.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const q = pt.matrixTransform(mtx.inverse());
    onDrag(((q.x - X0) / W) * 100);
  };

  // Tally slots: m allowed per side, the (m + 1)-th is the bust slot.
  const slot = Math.min(22, (W / 2 - 36) / (m + 1));
  const cx = X0 + W / 2;
  const slotX = (side: 'below' | 'above', i: number) => (side === 'below' ? cx - 30 - (i + 0.5) * slot : cx + 30 + (i + 0.5) * slot);
  const r = Math.min(7.5, slot * 0.36);

  let note: string | null = null;
  if (outcome && !allIn) {
    if (tally.below > m) note = `${m + 1} points below the window: the median is below it`;
    else if (tally.above > m) note = `${m + 1} points above the window: the median is above it`;
    else if (outcome === 'win') note = `Neither side can reach ${m + 1}: the median is locked in`;
  }

  const labelX = Math.min(X1 - 64, Math.max(X0 + 64, sx((a + b) / 2)));
  const lowW = odds.low * W;
  const winW = odds.win * W;

  return (
    <svg
      ref={svg}
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      className="median"
      role="img"
      aria-label={`Window ${Math.round(a * 100)} to ${Math.round(b * 100)} percent, ${points.length} of ${n} points dropped, ${pct(odds.win)} chance`}
    >
      {/* Header */}
      <text x={X0} y={24} className="hdr">
        {n} points · median = {ord(m + 1)} smallest
      </text>
      <text x={X1} y={24} className="hdr right">
        {preview ? 'preview' : `${points.length} of ${n} dropped`}
      </text>

      {/* Preview: the law of the median, with the window's share shaded. */}
      {preview && (
        <g className="law">
          <path d={curve(n, 0, 1, true)} className="law-all" />
          <path d={curve(n, a, b, true)} className="law-win" />
          <path d={curve(n, 0, 1, false)} className="law-line" />
          <text x={X0} y={PT - 10} className="lbl">
            where the median lands (Beta({m + 1}, {m + 1}))
          </text>
          <text x={X1} y={PT - 10} className="lbl right win">
            shaded area = {pct(odds.win)}
          </text>
        </g>
      )}

      {/* Number line: the window and the two sides. */}
      <rect x={X0} y={LY - 6} width={W} height={12} rx={6} className="track" />
      <rect x={sx(0)} y={LY - 6} width={a * W} height={12} className="side-zone" />
      <rect x={sx(b)} y={LY - 6} width={(1 - b) * W} height={12} className="side-zone" />
      <rect x={sx(a)} y={LY - 11} width={Math.max(2, (b - a) * W)} height={22} rx={3} className="window" />
      {!preview && <line x1={sx(a)} y1={PT - 4} x2={sx(a)} y2={LY} className="edge" />}
      {!preview && <line x1={sx(b)} y1={PT - 4} x2={sx(b)} y2={LY} className="edge" />}
      <text x={labelX} y={LY + 30} className="lbl mid strong">
        window {Math.round(a * 100)}–{Math.round(b * 100)}%
      </text>
      <text x={X0} y={LY + 30} className="lbl">
        0
      </text>
      <text x={X1} y={LY + 30} className="lbl right">
        1
      </text>
      <text x={cx} y={LY + 52} className="lbl mid">
        each point lands below {pct(a)} · in {pct(b - a)} · above {pct(1 - b)}
      </text>

      {/* Dropped points, stacked so none hide. */}
      {dots.map((d, i) => {
        const side = sideOf(points[i], a, b);
        const y = LY - 16 - d.level * (2 * DOT + 2);
        return (
          <g key={i} className="dot-wrap" style={{ animationDuration: `${dropMs}ms` }}>
            <circle cx={d.x} cy={y} r={DOT} className={`dot ${side}` + (i === medIdx ? ' med' : '')} />
          </g>
        );
      })}
      {med !== null && (
        <g className="med-mark">
          <line x1={sx(med)} y1={PT + 6} x2={sx(med)} y2={LY + 12} />
          <text x={Math.min(X1 - 40, Math.max(X0 + 40, sx(med)))} y={PT}>
            median {pct(med)}
          </text>
        </g>
      )}
      {note && (
        <text x={cx} y={PT + 18} className={'note ' + (outcome === 'win' ? 'win' : 'lose')}>
          {note}
        </text>
      )}
      {!preview && !outcome && points.length === 0 && (
        <text x={cx} y={PT + 60} className="lbl mid">
          dropping…
        </text>
      )}

      {/* Tug of war: each side may take m points; the (m + 1)-th pulls the median out. */}
      <text x={X0} y={TUG_Y - 24} className="lbl">
        below the window <tspan className={tally.below > m ? 'lose' : 'strong'}>{tally.below}</tspan> / {m}
      </text>
      <text x={X1} y={TUG_Y - 24} className="lbl right">
        <tspan className={tally.above > m ? 'lose' : 'strong'}>{tally.above}</tspan> / {m} above the window
      </text>
      <line x1={slotX('below', m) - slot / 2} y1={TUG_Y} x2={slotX('above', m) + slot / 2} y2={TUG_Y} className="rope" />
      {(['below', 'above'] as const).map((side) =>
        Array.from({ length: m + 1 }, (_, i) => {
          const x = slotX(side, i);
          const filled = i < tally[side];
          const bust = i === m;
          return bust ? (
            <rect
              key={`${side}${i}`}
              x={x - r}
              y={TUG_Y - r}
              width={2 * r}
              height={2 * r}
              rx={2}
              className={'slot bust' + (filled ? ' hit' : '')}
            />
          ) : (
            <circle key={`${side}${i}`} cx={x} cy={TUG_Y} r={r} className={'slot' + (filled ? ' on' : '')} />
          );
        }),
      )}
      <circle cx={cx} cy={TUG_Y} r={16} className="knot" />
      <text x={cx} y={TUG_Y + 5} className="knot-n">
        {tally.inside}
      </text>
      <text x={cx} y={TUG_Y + 34} className="lbl mid">
        {preview ? `in the window · ${n} to drop` : `in the window · ${left} to drop`}
      </text>
      <text x={slotX('below', m)} y={TUG_Y + 34} className="lbl mid lose small">
        bust
      </text>
      <text x={slotX('above', m)} y={TUG_Y + 34} className="lbl mid lose small">
        bust
      </text>

      {/* The odds: where the median will finish, as shares of one bar. */}
      <rect x={X0} y={BAR_Y} width={W} height={18} rx={4} className="bar-bg" />
      <rect x={X0} y={BAR_Y} width={lowW} height={18} className="bar-lose" />
      <rect x={X0 + lowW} y={BAR_Y} width={winW} height={18} className="bar-win" />
      <rect x={X0 + lowW + winW} y={BAR_Y} width={Math.max(0, W - lowW - winW)} height={18} className="bar-lose alt" />
      <text x={X0} y={BAR_Y + 42} className="lbl lose">
        median below {pct(odds.low)}
      </text>
      <text x={cx} y={BAR_Y + 42} className="lbl mid win strong">
        in window {pct(odds.win)}
      </text>
      <text x={X1} y={BAR_Y + 42} className="lbl right lose">
        above {pct(odds.high)}
      </text>

      {draggable && (
        <rect
          x={X0 - 10}
          y={PT - 30}
          width={W + 20}
          height={LY - PT + 50}
          className="drag"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            fromPointer(e);
          }}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) fromPointer(e);
          }}
        />
      )}
    </svg>
  );
}
