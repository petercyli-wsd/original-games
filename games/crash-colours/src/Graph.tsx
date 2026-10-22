// The crash graph: a log-scale multiplier axis split into the three colour
// bands, and the climb curve drawn up to the current multiplier. The axis
// grows with the climb, as in a live crash game, and each band line flashes
// when the curve passes it.

import { useEffect, useRef, useState } from 'react';
import { CURVE_K, type Band, type Lines } from './math';

// The viewBox follows the measured width (between 360 and 640 units), so on a
// phone one unit is about one pixel and the labels stay readable.
const geometry = (width: number) => {
  const W = Math.round(Math.min(640, Math.max(360, width)));
  const compact = W < 520;
  const H = compact ? Math.round(W * 0.7) : 360;
  return { W, H, compact, X0: 14, X1: W - (compact ? 66 : 80), Y0: 18, Y1: H - (compact ? 22 : 36) };
};

const TICKS = [1, 1.2, 1.5, 2, 3, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 1e4, 2e4, 5e4, 1e5, 2e5, 5e5, 1e6];

const fmtLine = (x: number) => (x >= 1000 ? Math.round(x).toLocaleString('en-US') : x >= 100 ? x.toFixed(0) : x.toFixed(2)) + '×';
const fmtBig = (x: number) => (x >= 10000 ? Math.floor(x).toLocaleString('en-US') : x.toFixed(2)) + '×';

export type Phase = 'idle' | 'live' | 'over';

export function bandAt(m: number, { split, moon }: Lines): Band {
  return m >= moon ? 'moon' : m >= split ? 'green' : 'red';
}

export default function Graph({ m, phase, lines }: { m: number; phase: Phase; lines: Lines }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const { W, H, compact, X0, X1, Y0, Y1 } = geometry(width);
  const { split, moon } = lines;
  const yMax = Math.max(split * 1.45, 2.4, m * 1.2);
  const lnMax = Math.log(yMax);
  const y = (v: number) => Y1 - (Math.log(Math.max(1, v)) / lnMax) * (Y1 - Y0);

  // The curve m(τ) = (1 − τ)^(−K) for τ ∈ [0, τ_now]; the time axis widens once the head nears the edge.
  const tauNow = 1 - Math.pow(Math.max(1, m), -1 / CURVE_K);
  const tauWin = Math.max(tauNow, 1 - Math.pow(split * 1.3, -1 / CURVE_K));
  const xSpan = X1 - X0 - (compact ? 22 : 36);
  const pts: [number, number][] = [];
  const N = 64;
  for (let i = 0; i <= N; i++) {
    const tau = (tauNow * i) / N;
    pts.push([X0 + (tau / tauWin) * xSpan, y(Math.pow(1 - tau, -CURVE_K))]);
  }
  const [hx, hy] = pts[N];
  const line = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
  const area = `${line} L${hx.toFixed(1)},${Y1} L${X0},${Y1} Z`;
  const showCurve = phase !== 'idle' && m > 1.0001;

  const band = bandAt(m, lines);
  const ySplit = y(split);
  const moonOn = moon <= yMax;
  const yMoon = moonOn ? y(moon) : Y0;

  // Tick labels on the right, thinned to keep 26px apart and clear of the band tags.
  const ticks: number[] = [];
  for (const t of TICKS) {
    if (t > yMax * 0.97) break;
    const ty = y(t);
    if (ticks.length && y(ticks[ticks.length - 1]) - ty < 26) continue;
    if (Math.abs(ty - ySplit) < 20 || (moonOn && Math.abs(ty - yMoon) < 20)) continue;
    ticks.push(t);
  }

  const passedSplit = phase !== 'idle' && m >= split;
  const passedMoon = phase !== 'idle' && m >= moon;
  const crashed = phase === 'over';
  const tone = phase === 'idle' ? 'idle' : band;

  return (
    <div className="cc-graph-wrap" ref={wrap}>
    <svg viewBox={`0 0 ${W} ${H}`} className={`cc-graph ${phase}`} role="img" aria-label={`Crash graph at ${m.toFixed(2)}×`}>
      <defs>
        {(['red', 'green', 'moon'] as const).map((b) => (
          <linearGradient key={b} id={`cc-fill-${b}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" className={`cc-stop ${b}`} stopOpacity="0.45" />
            <stop offset="1" className={`cc-stop ${b}`} stopOpacity="0" />
          </linearGradient>
        ))}
        <clipPath id="cc-plot">
          <rect x={X0} y={Y0 - 4} width={X1 - X0} height={Y1 - Y0 + 4} />
        </clipPath>
      </defs>

      {/* The three bands as tinted regions of the axis. */}
      <rect className="cc-region red" x={X0} y={ySplit} width={X1 - X0} height={Y1 - ySplit} />
      <rect className="cc-region green" x={X0} y={yMoon} width={X1 - X0} height={ySplit - yMoon} />
      {moonOn && <rect className="cc-region moon" x={X0} y={Y0} width={X1 - X0} height={yMoon - Y0} />}

      {Y1 - ySplit > 34 && (
        <text className="cc-region-label red" x={X1 - 10} y={Y1 - 10}>
          {compact ? 'RED' : `RED · under ${fmtLine(split)}`}
        </text>
      )}
      {ySplit - yMoon > (moonOn ? 34 : 52) && (
        <text className="cc-region-label green start" x={X0 + 12} y={yMoon + (moonOn ? 22 : 40)}>
          {compact ? 'GREEN' : `GREEN · ${fmtLine(split)}+`}
        </text>
      )}
      {moonOn && yMoon - Y0 > 34 && (
        <text className="cc-region-label moon start" x={X0 + 12} y={Y0 + 22}>
          {compact ? 'MOON' : `MOON · ${fmtLine(moon)}+`}
        </text>
      )}

      {ticks.map((t) => (
        <g key={t} className="cc-tick">
          <line x1={X0} x2={X1} y1={y(t)} y2={y(t)} />
          <text x={X1 + 8} y={y(t) + 4}>
            {fmtLine(t)}
          </text>
        </g>
      ))}

      {/* Band lines with their tags in the gutter. */}
      <g className={'cc-bandline green' + (passedSplit ? ' hit' : '')} key={`s${passedSplit}`}>
        <line x1={X0} x2={X1} y1={ySplit} y2={ySplit} />
        <rect x={X1 + 4} y={ySplit - 11} width={W - X1 - 6} height={22} rx={6} />
        <text x={X1 + 4 + (W - X1 - 6) / 2} y={ySplit + 4.5}>
          {fmtLine(split)}
        </text>
      </g>
      {moonOn ? (
        <g className={'cc-bandline moon' + (passedMoon ? ' hit' : '')} key={`m${passedMoon}`}>
          <line x1={X0} x2={X1} y1={yMoon} y2={yMoon} />
          <rect x={X1 + 4} y={yMoon - 11} width={W - X1 - 6} height={22} rx={6} />
          <text x={X1 + 4 + (W - X1 - 6) / 2} y={yMoon + 4.5}>
            {fmtLine(moon)}
          </text>
        </g>
      ) : (
        <g className="cc-moon-tag">
          <rect x={X1 - 142} y={Y0 + 4} width={134} height={24} rx={12} />
          <text x={X1 - 75} y={Y0 + 20.5}>
            ▲ MOON {fmtLine(moon)}
          </text>
        </g>
      )}

      <line className="cc-axis" x1={X0} x2={X1} y1={Y1} y2={Y1} />
      <line className="cc-axis" x1={X1} x2={X1} y1={Y0 - 4} y2={Y1} />

      {showCurve && (
        <g clipPath="url(#cc-plot)">
          <path className="cc-area" d={area} fill={`url(#cc-fill-${band})`} />
          <path className={`cc-curve ${band}`} d={line} />
        </g>
      )}
      {phase !== 'idle' && (
        <g className={`cc-head ${band}` + (crashed ? ' crashed' : '')} transform={`translate(${hx.toFixed(1)} ${hy.toFixed(1)})`}>
          {crashed && <circle className="cc-burst" r={10} />}
          <circle className="cc-glow" r={14} />
          <circle className="cc-dot" r={6} />
        </g>
      )}

      <g
        className={`cc-readout ${tone}` + (crashed ? ' crashed' : '') + (compact ? ' compact' : '')}
        transform={`translate(${(X0 + X1) / 2} ${Y0 + (Y1 - Y0) * 0.4})`}
      >
        {crashed && (
          <text className="cc-readout-top" y={compact ? -38 : -50}>
            CRASHED AT
          </text>
        )}
        <text className="cc-readout-num" y={8}>
          {fmtBig(m)}
        </text>
        {phase === 'idle' && (
          <text className="cc-readout-sub" y={compact ? 34 : 44}>
            Stake your colours, then Bet
          </text>
        )}
      </g>
    </svg>
    </div>
  );
}
