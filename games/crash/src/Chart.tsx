import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { RATE, fmtX, multAt, reachChance, timeTo } from './math';

export type ChartState = 'idle' | 'live' | 'crashed' | 'max';

export interface ChartProps {
  state: ChartState;
  /** Flight time shown (ms). */
  tau: number;
  /** Auto cash-out target in cents, or null. */
  target: number | null;
  /** Where the player cashed out: flight time and cents. */
  cash: { tau: number; cents: number } | null;
  /** Overlay (the big multiplier) drawn over the plot. */
  children?: ReactNode;
}

const PAD = { l: 50, r: 58, t: 30, b: 30 };

/** A "nice" step (1, 2, 2.5, 5 × 10^n) giving at most `max` ticks over a span. */
function niceStep(span: number, max: number, steps = [1, 2, 2.5, 5, 10]) {
  const raw = span / max;
  const mag = 10 ** Math.floor(Math.log10(raw));
  for (const s of steps) if (s * mag >= raw) return s * mag;
  return 10 * mag;
}

const fmtTick = (y: number) =>
  (y >= 1000 ? Math.round(y).toLocaleString('en-US') : y >= 10 ? y.toFixed(0) : y % 1 === 0 ? y.toFixed(1) : y.toFixed(2).replace(/0$/, '')) + '×';
const fmtPct = (p: number) => {
  const pct = p * 100;
  return (pct >= 10 ? pct.toFixed(1) : pct >= 1 ? pct.toFixed(2) : pct >= 0.01 ? pct.toFixed(2) : pct.toPrecision(2)) + '%';
};

/**
 * The crash graph: multiplier against flight time with axes, a right-hand
 * scale giving the exact chance of reaching each height (0.99 ÷ height), the
 * auto cash-out target as a dashed line, and the cash-out point on the curve.
 */
export default function Chart({ state, tau, target, cash, children }: ChartProps) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 640, h: 340 });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { w, h } = size;
  const narrow = w < 480;
  const pad = narrow ? { l: 42, r: 48, t: 28, b: 26 } : PAD;
  const pw = Math.max(10, w - pad.l - pad.r);
  const ph = Math.max(10, h - pad.t - pad.b);

  // Scale: idle previews up to the target; in flight the axes stretch ahead of the tip.
  const m = multAt(tau);
  const tY = target !== null ? target / 100 : null;
  let yTop: number;
  let xTop: number;
  if (state === 'idle') {
    yTop = Math.max(2, Math.min(tY !== null ? tY * 1.3 : 2.5, 1e6));
    xTop = Math.max(8000, timeTo(yTop) * 1.08);
  } else {
    yTop = Math.max(2, 1 + (m - 1) * 1.3);
    xTop = Math.max(8000, tau * 1.12);
  }
  const X = (t: number) => pad.l + (t / xTop) * pw;
  const Y = (y: number) => pad.t + ph * (1 - (y - 1) / (yTop - 1));

  const yStep = niceStep(yTop - 1, narrow ? 4 : 5);
  const yTicks: number[] = [1];
  for (let i = Math.ceil(1 / yStep + 1e-9); i * yStep <= yTop + 1e-9; i++) {
    const y = Math.round(i * yStep * 1000) / 1000;
    if (y > 1 + yStep * 0.4) yTicks.push(y);
  }
  const xStep = niceStep(xTop / 1000, narrow ? 4 : 6, [1, 2, 5, 10]) * 1000;
  const xTicks: number[] = [];
  for (let t = 0; t <= xTop + 1e-6; t += xStep) xTicks.push(t);

  // The curve, sampled densely near the tip where it bends most.
  const end = state === 'idle' ? timeTo(yTop) : tau;
  const N = 72;
  const pts: string[] = [];
  for (let i = 0; i <= N; i++) {
    const s = i / N;
    const t = end * (1 - (1 - s) ** 1.6);
    pts.push(`${X(t).toFixed(1)},${Y(multAt(t)).toFixed(1)}`);
  }
  const line = 'M' + pts.join('L');
  const area = `${line}L${X(end).toFixed(1)},${Y(1).toFixed(1)}L${X(0).toFixed(1)},${Y(1).toFixed(1)}Z`;
  const tip = { x: X(end), y: Y(multAt(end)) };
  // Direction of travel at the tip, for the comet's tail.
  const slope = Math.atan2(-(ph / (yTop - 1)) * RATE * multAt(end), pw / xTop);

  const targetVisible = tY !== null && tY <= yTop;
  const tone = state === 'crashed' ? 'crashed' : state === 'max' ? 'max' : cash ? 'cashed' : state;

  return (
    <div className={`crash-chart ${tone}`} ref={box}>
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={`Crash graph at ${fmtX(m)}`}>
        <defs>
          <linearGradient id="crash-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--curve)" stopOpacity="0.38" />
            <stop offset="1" stopColor="var(--curve)" stopOpacity="0.02" />
          </linearGradient>
          <filter id="crash-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
        </defs>

        {/* Grid and axes */}
        <g className="crash-grid">
          {yTicks.map((y) => (
            <line key={'y' + y} x1={pad.l} x2={pad.l + pw} y1={Y(y)} y2={Y(y)} />
          ))}
          {xTicks.map((t) => (
            <line key={'x' + t} x1={X(t)} x2={X(t)} y1={pad.t} y2={pad.t + ph} />
          ))}
        </g>
        <line className="crash-axis" x1={pad.l} x2={pad.l + pw} y1={pad.t + ph} y2={pad.t + ph} />
        <line className="crash-axis" x1={pad.l} x2={pad.l} y1={pad.t} y2={pad.t + ph} />
        <g className="crash-ylabels">
          {yTicks.map((y) => (
            <text key={y} x={pad.l - 8} y={Y(y) + 4} textAnchor="end">
              {fmtTick(y)}
            </text>
          ))}
        </g>
        <g className="crash-plabels">
          <text x={pad.l + pw + 8} y={pad.t - 14} className="head">
            reach
          </text>
          {yTicks.map((y) => (
            <text key={y} x={pad.l + pw + 8} y={Y(y) + 4}>
              {fmtPct(reachChance(Math.round(y * 100)))}
            </text>
          ))}
        </g>
        <g className="crash-xlabels">
          {xTicks.map((t) => (
            <text key={t} x={X(t)} y={pad.t + ph + 18} textAnchor="middle">
              {Math.round(t / 1000)}s
            </text>
          ))}
        </g>

        {/* Target line */}
        {tY !== null && (
          <g className={'crash-target' + (cash && cash.cents === target ? ' hit' : '')}>
            {targetVisible ? (
              <>
                <line x1={pad.l} x2={pad.l + pw} y1={Y(tY)} y2={Y(tY)} />
                <text x={pad.l + pw - 6} y={Y(tY) - 6} textAnchor="end">
                  Target {fmtX(tY)}
                </text>
              </>
            ) : (
              <text x={pad.l + pw - 6} y={pad.t + 12} textAnchor="end">
                Target {fmtX(tY)} ↑
              </text>
            )}
          </g>
        )}

        {/* Curve */}
        {state === 'idle' ? (
          <path className="crash-preview" d={line} />
        ) : (
          <>
            <path className="crash-area" d={area} fill="url(#crash-fill)" />
            <path className="crash-line glow" d={line} filter="url(#crash-glow)" />
            <path className="crash-line" d={line} />
          </>
        )}

        {/* Cash-out marker */}
        {cash && state !== 'idle' && (
          <g className="crash-cash" transform={`translate(${X(cash.tau)},${Y(cash.cents / 100)})`}>
            <circle r="10" className="halo" />
            <circle r="5.5" />
            <g transform={`translate(${X(cash.tau) > pad.l + pw - 90 ? -12 : 12},-14)`}>
              <rect x={X(cash.tau) > pad.l + pw - 90 ? -74 : 0} y="-13" width="74" height="22" rx="6" />
              <text x={X(cash.tau) > pad.l + pw - 90 ? -37 : 37} y="2" textAnchor="middle">
                {fmtX(cash.cents / 100)}
              </text>
            </g>
          </g>
        )}

        {/* Tip: a comet in flight, a burst on the crash */}
        {state !== 'idle' && (
          <g className="crash-tip" transform={`translate(${tip.x},${tip.y})`}>
            {state === 'crashed' ? (
              <g className="burst">
                {Array.from({ length: 10 }, (_, i) => {
                  const a = (i / 10) * Math.PI * 2;
                  return <line key={i} x1={Math.cos(a) * 7} y1={Math.sin(a) * 7} x2={Math.cos(a) * 17} y2={Math.sin(a) * 17} />;
                })}
                <circle r="6" />
              </g>
            ) : (
              <g transform={`rotate(${(slope * 180) / Math.PI})`}>
                <circle r="13" className="aura" />
                <path className="tail" d="M -26 0 L -4 -4 L -4 4 Z" />
                <circle r="6" className="core" />
              </g>
            )}
          </g>
        )}
      </svg>
      <div className="crash-overlay">{children}</div>
    </div>
  );
}
