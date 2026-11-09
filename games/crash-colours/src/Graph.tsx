// The crash graph. Its height axis is probability, not the multiplier: a
// multiplier x is drawn at height P(C < x), so each colour band is exactly as
// tall as its chance (Red 50.5%, Green 49.5%, Moon 9.9% at the classic lines)
// and the right-hand ticks show where the multipliers fall on that scale. The
// climb curve is drawn up to the current multiplier, and everything below it
// is shaded as spent: the bands' remaining chances are what is left above.

import { useEffect, useRef, useState } from 'react';
import { CURVE_K, heightAt, type Band, type Lines } from './math';

// The viewBox follows the measured width (between 360 and 640 units), so on a
// phone one unit is about one pixel and the labels stay readable. The header
// strip above the plot holds the live multiplier.
const geometry = (width: number) => {
  const W = Math.round(Math.min(640, Math.max(360, width)));
  const compact = W < 520;
  const HEAD = compact ? 56 : 60;
  const H = compact ? Math.round(W * 0.7) + HEAD : 400;
  return { W, H, HEAD, compact, X0: 14, X1: W - (compact ? 66 : 80), Y0: HEAD + 10, Y1: H - 12 };
};

const TICKS = [1, 1.2, 1.5, 2, 3, 5, 10, 20, 50, 100, 200, 500, 1000];

const fmtLine = (x: number) => (x >= 1000 ? Math.round(x).toLocaleString('en-US') : x >= 100 ? x.toFixed(0) : x.toFixed(2)) + '×';
const fmtBig = (x: number) => (x >= 10000 ? Math.floor(x).toLocaleString('en-US') : x.toFixed(2)) + '×';

export type Phase = 'idle' | 'live' | 'over';

export function bandAt(m: number, { split, moon }: Lines): Band {
  return m >= moon ? 'moon' : m >= split ? 'green' : 'red';
}

/** Below this height (px) the Moon band is too thin to hold its label, which moves under its line. */
const MOON_LABEL_MIN = 18;

export default function Graph({ m, phase, lines, staked }: { m: number; phase: Phase; lines: Lines; staked: Record<Band, boolean> }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const { W, H, HEAD, compact, X0, X1, Y0, Y1 } = geometry(width);
  const { split, moon } = lines;
  /** Height of multiplier v: P(C < v) of the plot, bottom (1.00×) to top. */
  const y = (v: number) => Y1 - heightAt(v) * (Y1 - Y0);

  // The curve m(τ) = (1 − τ)^(−K) for τ ∈ [0, τ_now]; the time axis widens once the head nears the edge.
  const tauNow = 1 - Math.pow(Math.max(1, m), -1 / CURVE_K);
  const tauWin = Math.max(tauNow, 1 - Math.pow(split * 1.3, -1 / CURVE_K));
  const xSpan = X1 - X0 - (compact ? 22 : 36);
  const pts: [number, number][] = [];
  const N = 72;
  for (let i = 0; i <= N; i++) {
    const tau = (tauNow * i) / N;
    pts.push([X0 + (tau / tauWin) * xSpan, y(i === N ? m : Math.pow(1 - tau, -CURVE_K))]);
  }
  const [hx, hy] = pts[N];
  const line = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
  const showCurve = phase !== 'idle' && m > 1.0001;

  const ySplit = y(split);
  const yMoon = y(moon);
  const moonInside = yMoon - Y0 >= MOON_LABEL_MIN;

  // Tick labels on the right, thinned to keep 24px apart and clear of the line tags.
  const ticks: number[] = [];
  for (const t of TICKS) {
    const ty = y(t);
    if (ty < Y0 + 6) break;
    if (ticks.length && y(ticks[ticks.length - 1]) - ty < 24) continue;
    if (Math.abs(ty - ySplit) < 20 || Math.abs(ty - yMoon) < 20) continue;
    ticks.push(t);
  }

  const started = phase !== 'idle';
  const passedSplit = started && m >= split;
  const passedMoon = started && m >= moon;
  const tone = phase === 'idle' ? 'idle' : 'on';

  return (
    <div className="cc-graph-wrap" ref={wrap}>
      <svg viewBox={`0 0 ${W} ${H}`} className={`cc-graph ${phase}`} role="img" aria-label={`Crash graph at ${m.toFixed(2)}×`}>
        <defs>
          <clipPath id="cc-plot">
            <rect x={X0} y={Y0 - 4} width={X1 - X0} height={Y1 - Y0 + 4} />
          </clipPath>
        </defs>

        {/* The live multiplier (the crash point once over), above the plot so it never covers the bands. */}
        <text className={`cc-readout ${tone}`} x={(X0 + X1) / 2} y={HEAD - 8}>
          {fmtBig(m)}
        </text>

        {/* The three bands, each as tall as its chance. Green is everything above its line; Moon is the top slice of it. */}
        <rect className="cc-region red" x={X0} y={ySplit} width={X1 - X0} height={Y1 - ySplit} />
        <rect className="cc-region green" x={X0} y={Y0} width={X1 - X0} height={ySplit - Y0} />
        <rect className="cc-region moon" x={X0} y={Y0} width={X1 - X0} height={Math.max(0, yMoon - Y0)} />

        {/* The player's own bets: an accent bar down the left edge of each backed band (Moon sits inside Green, so it is inset). */}
        {staked.red && <rect className="cc-mine" x={X0} y={ySplit} width={3} height={Y1 - ySplit} />}
        {staked.green && <rect className="cc-mine" x={X0} y={Y0} width={3} height={ySplit - Y0} />}
        {staked.moon && <rect className="cc-mine" x={X0 + 5} y={Y0} width={3} height={Math.max(0, yMoon - Y0)} />}

        {/* What the climb has used up: the rounds that would already have crashed. */}
        {started && (
          <g className="cc-spent">
            <rect x={X0} y={hy} width={X1 - X0} height={Math.max(0, Y1 - hy)} />
            <line x1={X0} x2={X1} y1={hy} y2={hy} />
          </g>
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
        <g className={'cc-bandline moon' + (passedMoon ? ' hit' : '')} key={`m${passedMoon}`}>
          <line x1={X0} x2={X1} y1={yMoon} y2={yMoon} />
          <rect x={X1 + 4} y={yMoon - 11} width={W - X1 - 6} height={22} rx={6} />
          <text x={X1 + 4 + (W - X1 - 6) / 2} y={yMoon + 4.5}>
            {fmtLine(moon)}
          </text>
        </g>

        <line className="cc-axis" x1={X0} x2={X1} y1={Y1} y2={Y1} />
        <line className="cc-axis" x1={X1} x2={X1} y1={Y0 - 4} y2={Y1} />

        {showCurve && (
          <g clipPath="url(#cc-plot)">
            <path className="cc-curve" d={line} />
          </g>
        )}
        {/* Band labels above the curve so it never hides them. */}
        {/* A backed band's label says so, which also names the accent bar down its left edge. */}
        <text className="cc-region-label red" x={X1 - 10} y={Y1 - 10}>
          {staked.red ? 'Red · your bet' : 'Red'}
        </text>
        <text className="cc-region-label green start" x={X0 + 10} y={ySplit - 9}>
          {staked.green ? 'Green · your bet' : 'Green'}
        </text>
        <text
          className="cc-region-label moon start"
          x={X0 + 10}
          y={moonInside ? Math.min(Y0 + (yMoon - Y0) / 2 + 5, yMoon - 4) : yMoon + 17}
        >
          {staked.moon ? 'Moon · your bet' : 'Moon'}
        </text>

        {started && (
          <g className="cc-head" transform={`translate(${hx.toFixed(1)} ${hy.toFixed(1)})`}>
            <circle className="cc-dot" r={5} />
          </g>
        )}
      </svg>
    </div>
  );
}
