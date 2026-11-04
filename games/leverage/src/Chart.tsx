import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { fmtPrice, type Direction } from './math';

export interface ChartLine {
  kind: 'bust' | 'tp' | 'sl';
  price: number;
  label: string;
}

export interface ChartView {
  state: 'idle' | 'live' | 'over';
  /** The whole simulated price series (oldest first). */
  series: number[];
  /** Series index of the entry (or "now" in the preview). */
  entryIdx: number;
  /** Ticks from the entry to expiry. */
  T: number;
  /** History ticks shown before the entry. */
  pre: number;
  entry: number;
  dir: Direction;
  lines: ChartLine[];
  /** One tick of price, for sizing the range shown. */
  tick: number;
  /** Where the position closed, once over. */
  close: { idx: number; price: number; tone: 'win' | 'lose' | 'even'; label: string } | null;
  /** 0–1 share of the expiry clock used. */
  clock: number;
}

/** A "nice" step (1, 2, 2.5, 5 × 10^n) giving at most `max` ticks over a span. */
function niceStep(span: number, max: number) {
  const raw = span / max;
  const mag = 10 ** Math.floor(Math.log10(raw));
  for (const s of [1, 2, 2.5, 5, 10]) if (s * mag >= raw) return s * mag;
  return 10 * mag;
}

/**
 * The simulated market chart: a flat price line, the entry level (accent),
 * bust / take-profit / stop-loss levels, the expiry line, and the current
 * price tag on the right-hand axis.
 */
export default function Chart({ view, children }: { view: ChartView; children?: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 680, h: 340 });
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
  const pad = { l: 8, r: narrow ? 66 : 78, t: narrow ? 66 : 58, b: 26 };
  const pw = Math.max(10, w - pad.l - pad.r);
  const ph = Math.max(10, h - pad.t - pad.b);

  const { series, entryIdx, T, pre, entry, state } = view;
  const x0 = entryIdx - pre;
  const x1 = entryIdx + T;
  const last = series.length - 1;
  const nowIdx = state === 'idle' ? entryIdx : last;
  const nowPrice = series[nowIdx];

  // Visible path.
  const from = Math.max(0, x0);
  let lo = entry;
  let hi = entry;
  for (let i = from; i <= last && i <= x1; i++) {
    const p = series[i];
    if (p < lo) lo = p;
    if (p > hi) hi = p;
  }
  // The range from now to expiry (±2σ of a fair walk) sets the scale.
  const remaining = Math.max(0, x1 - nowIdx);
  const coneHalf = 2 * view.tick * Math.sqrt(remaining);
  const minHalf = view.tick * Math.max(10, 1.3 * Math.sqrt(T));
  let half = Math.max(minHalf, hi - entry, entry - lo, state === 'idle' ? coneHalf * 0.9 : 0);
  // Pull in the levels that sit reasonably close; the rest get an off-chart marker.
  const reach = half * 2.4;
  const shown = view.lines.map((l) => ({ ...l, on: Math.abs(l.price - entry) <= reach }));
  for (const l of shown) if (l.on) half = Math.max(half, Math.abs(l.price - entry) * 1.08);
  const yLo = Math.min(lo, entry - half) - half * 0.08;
  const yHi = Math.max(hi, entry + half) + half * 0.08;

  const X = (i: number) => pad.l + ((i - x0) / (x1 - x0)) * pw;
  const Y = (p: number) => pad.t + ph * (1 - (p - yLo) / (yHi - yLo));
  const clampY = (y: number) => Math.min(pad.t + ph, Math.max(pad.t, y));

  const yStep = niceStep(yHi - yLo, narrow ? 4 : 6);
  const yTicks: number[] = [];
  for (let v = Math.ceil(yLo / yStep) * yStep; v <= yHi; v += yStep) yTicks.push(v);
  const secs = T / 25;
  const xStepS = secs <= 10 ? 2 : secs <= 30 ? 5 : 10;
  const xTicks: number[] = [];
  for (let s = -Math.floor(pre / 25 / xStepS) * xStepS; s <= secs; s += xStepS) xTicks.push(s);

  const pathEnd = Math.min(last, x1);
  let d = '';
  for (let i = from; i <= pathEnd; i++) d += (d ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(series[i]).toFixed(1);

  const tagY = clampY(Y(nowPrice));
  const xNow = X(nowIdx);
  const xEntry = X(entryIdx);
  const xExp = X(x1);

  // Axis labels hidden where the current-price tag sits on top of them.
  const yLabels = yTicks.filter((v) => Math.abs(Y(v) - tagY) > 15);

  // Level labels sit just past the entry; when two would collide, the later
  // one moves to the expiry end of its line.
  const labelX = (state === 'idle' ? xNow : xEntry) + 8;
  const levelLabels: { l: (typeof shown)[number]; y: number; right: boolean }[] = [];
  for (const l of shown.filter((l) => l.on).sort((a, b) => Y(a.price) - Y(b.price))) {
    const y = l.price < entry ? Y(l.price) + 14 : Y(l.price) - 6;
    const right = levelLabels.some((o) => !o.right && Math.abs(o.y - y) < 15);
    levelLabels.push({ l, y, right });
  }
  const off = shown.filter((l) => !l.on);

  return (
    <div className={`lev-chart ${state}`} ref={box}>
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={`Simulated price ${fmtPrice(nowPrice)}`}>
        <defs>
          <clipPath id="lev-clip">
            <rect x={pad.l} y={pad.t} width={pw} height={ph} />
          </clipPath>
        </defs>

        <g className="lev-ylabels">
          {yLabels.map((v) => (
            <text key={v} x={pad.l + pw + 8} y={Y(v) + 4}>
              {fmtPrice(v)}
            </text>
          ))}
        </g>
        <g className="lev-xlabels">
          {xTicks.map((s) => (
            <text key={s} x={X(entryIdx + s * 25)} y={pad.t + ph + 17} textAnchor="middle">
              {s === 0 ? (state === 'idle' ? 'now' : 'entry') : `${s > 0 ? '+' : '−'}${Math.abs(s)}s`}
            </text>
          ))}
        </g>

        <g clipPath="url(#lev-clip)">
          {/* Levels */}
          {shown
            .filter((l) => l.on)
            .map((l) => (
              <line key={l.kind} className={`lev-level ${l.kind}`} x1={state === 'idle' ? xNow : xEntry} x2={xExp} y1={Y(l.price)} y2={Y(l.price)} />
            ))}
          <line className="lev-level entry" x1={state === 'idle' ? pad.l : xEntry} x2={xExp} y1={Y(entry)} y2={Y(entry)} />
          {levelLabels.map(({ l, y, right }) => (
            <text key={'t' + l.kind} className={`lev-level-label ${l.kind}`} x={right ? xExp - 8 : labelX} y={y} textAnchor={right ? 'end' : 'start'}>
              {l.label}
            </text>
          ))}

          {/* Price */}
          <path className="lev-line" d={d} />
        </g>

        {/* Expiry marker */}
        <line className="lev-expiry" x1={xExp} x2={xExp} y1={pad.t} y2={pad.t + ph} />
        <text className="lev-expiry-label" x={xExp - 6} y={pad.t + 14} textAnchor="end">
          expiry
        </text>

        {/* Entry marker */}
        {state !== 'idle' && <circle className="lev-entry-dot" cx={xEntry} cy={Y(entry)} r="5" />}

        {/* Close marker: stays until the next bet */}
        {view.close && <circle className={`lev-close ${view.close.tone}`} cx={X(view.close.idx)} cy={clampY(Y(view.close.price))} r="6" />}

        {/* Now dot */}
        {state !== 'over' && <circle className="lev-now" cx={xNow} cy={clampY(Y(nowPrice))} r="4.5" />}

        {/* Current price tag */}
        <g className="lev-tag" transform={`translate(${pad.l + pw + 2},${tagY})`}>
          <rect x="0" y={-11} width={pad.r - 4} height="22" rx="4" />
          <text x={(pad.r - 4) / 2} y="4.5" textAnchor="middle">
            {fmtPrice(nowPrice)}
          </text>
        </g>

        {/* Off-chart levels */}
        {off.map((l, i) => {
          const above = l.price > entry;
          return (
            <text
              key={l.kind}
              className={`lev-off ${l.kind}`}
              x={pad.l + pw - 6}
              y={above ? pad.t + 14 + i * 15 : pad.t + ph - 22 - i * 15}
              textAnchor="end"
            >
              {l.label} {fmtPrice(l.price)} {above ? '↑' : '↓'}
            </text>
          );
        })}
      </svg>
      <div className="lev-overlay">{children}</div>
    </div>
  );
}
