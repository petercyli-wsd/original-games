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
  /** One tick of price, for the ±2σ range cone. */
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
 * The simulated market chart: the price line, the entry, bust, take-profit and
 * stop-loss levels, a ±2σ cone for where the price can reach by expiry, the
 * expiry line, and the current price tag on the right-hand axis.
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
  // The cone from now to expiry (±2σ of a fair walk).
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

  let d = '';
  for (let i = from; i <= last && i <= x1; i++) d += (d ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(series[i]).toFixed(1);
  const pathEnd = Math.min(last, x1);
  const tail = state === 'idle' ? d : '';
  let live = '';
  let liveArea = '';
  if (state !== 'idle') {
    const s = Math.max(from, entryIdx);
    for (let i = s; i <= pathEnd; i++) live += (live ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(series[i]).toFixed(1);
    liveArea = `${live}L${X(pathEnd).toFixed(1)},${Y(entry).toFixed(1)}L${X(s).toFixed(1)},${Y(entry).toFixed(1)}Z`;
  }
  const hist = state === 'idle' ? '' : (() => {
    let p = '';
    for (let i = from; i <= Math.min(entryIdx, last); i++) p += (p ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(series[i]).toFixed(1);
    return p;
  })();

  // Cone polygon from now to expiry.
  let cone = '';
  if (state !== 'over' && remaining > 0) {
    const N = 24;
    const up: string[] = [];
    const dn: string[] = [];
    for (let j = 0; j <= N; j++) {
      const r = (remaining * j) / N;
      const xs = X(nowIdx + r).toFixed(1);
      const dv = 2 * view.tick * Math.sqrt(r);
      up.push(`${xs},${clampY(Y(nowPrice + dv)).toFixed(1)}`);
      dn.unshift(`${xs},${clampY(Y(nowPrice - dv)).toFixed(1)}`);
    }
    cone = 'M' + up.join('L') + 'L' + dn.join('L') + 'Z';
  }

  const pnlUp = view.dir === 'up' ? nowPrice >= entry : nowPrice <= entry;
  const tone = state === 'idle' ? 'idle' : pnlUp ? 'up' : 'down';
  const tagY = clampY(Y(nowPrice));
  const xNow = X(nowIdx);
  const xEntry = X(entryIdx);
  const xExp = X(x1);

  // Shaded zones beyond the bust and take-profit levels.
  const zone = (l: (typeof shown)[number]) => {
    if (!l.on || l.kind === 'sl') return null;
    const y = Y(l.price);
    const beyondUp = l.price > entry;
    const y1 = beyondUp ? pad.t : y;
    const y2 = beyondUp ? y : pad.t + ph;
    return <rect key={'z' + l.kind} className={`lev-zone ${l.kind}`} x={xEntry} width={Math.max(0, xExp - xEntry)} y={Math.min(y1, y2)} height={Math.abs(y2 - y1)} />;
  };

  // Labels on the right axis must not overlap: nudge them apart.
  const tags = [
    ...shown.filter((l) => l.on && !(state === 'over' && Math.abs(l.price - nowPrice) < 1e-6)).map((l) => ({ key: l.kind, y: Y(l.price), cls: l.kind, text: fmtPrice(l.price) })),
    ...(state !== 'idle' ? [{ key: 'entry', y: Y(entry), cls: 'entry', text: fmtPrice(entry) }] : []),
  ].sort((a, b) => a.y - b.y);
  // Stack the tags outward from the current-price tag (which never moves), so
  // none of them can cover it or each other.
  const TAG_H = 19;
  const NOW_GAP = 21;
  const yMin = pad.t - 8;
  const yMax = h - 12;
  const placed: { key: string; y: number; cls: string; text: string }[] = [];
  let cursor = tagY - NOW_GAP;
  for (const t of tags.filter((t) => t.y <= tagY).reverse()) {
    const y = Math.min(t.y, cursor);
    placed.push({ ...t, y });
    cursor = y - TAG_H;
  }
  cursor = tagY + NOW_GAP;
  for (const t of tags.filter((t) => t.y > tagY)) {
    const y = Math.max(t.y, cursor);
    placed.push({ ...t, y });
    cursor = y + TAG_H;
  }
  // If a stack runs off the chart, slide it back in (it may then overlap the
  // grid labels, which are hidden under tags below).
  const ups = placed.filter((t) => t.y < tagY).sort((a, b) => a.y - b.y);
  if (ups.length && ups[0].y < yMin) {
    let c = yMin;
    for (const t of ups) {
      t.y = Math.max(t.y, c);
      c = t.y + TAG_H;
    }
  }
  const downs = placed.filter((t) => t.y > tagY).sort((a, b) => b.y - a.y);
  if (downs.length && downs[0].y > yMax) {
    let c = yMax;
    for (const t of downs) {
      t.y = Math.min(t.y, c);
      c = t.y - TAG_H;
    }
  }
  // Grid labels hidden where a tag sits on top of them.
  const tagYs = [tagY, ...placed.map((t) => t.y)];
  const yLabels = yTicks.filter((v) => tagYs.every((ty) => Math.abs(Y(v) - ty) > 15));

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
    <div className={`lev-chart ${state} ${tone}`} ref={box}>
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={`Simulated price ${fmtPrice(nowPrice)}`}>
        <defs>
          <clipPath id="lev-clip">
            <rect x={pad.l} y={pad.t} width={pw} height={ph} />
          </clipPath>
        </defs>

        <g className="lev-grid">
          {yTicks.map((v) => (
            <line key={'y' + v} x1={pad.l} x2={pad.l + pw} y1={Y(v)} y2={Y(v)} />
          ))}
          {xTicks.map((s) => (
            <line key={'x' + s} x1={X(entryIdx + s * 25)} x2={X(entryIdx + s * 25)} y1={pad.t} y2={pad.t + ph} />
          ))}
        </g>
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
          {shown.map(zone)}
          {cone && <path className="lev-cone" d={cone} />}
          {/* Expiry window */}
          <rect className="lev-window" x={xEntry} y={pad.t} width={Math.max(0, xExp - xEntry)} height={ph} />
          {state === 'live' && <rect className="lev-elapsed" x={xEntry} y={pad.t} width={Math.max(0, xNow - xEntry)} height={ph} />}

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
          {state === 'idle' ? (
            <path className="lev-line idle" d={tail} />
          ) : (
            <>
              <path className="lev-line hist" d={hist} />
              <path className={'lev-area ' + (pnlUp ? 'up' : 'down')} d={liveArea} />
              <path className="lev-line glow" d={live} />
              <path className="lev-line" d={live} />
            </>
          )}
        </g>

        {/* Expiry marker */}
        <line className="lev-expiry" x1={xExp} x2={xExp} y1={pad.t} y2={pad.t + ph} />
        <text className="lev-expiry-label" x={xExp - 6} y={pad.t + ph - 8} textAnchor="end">
          expiry
        </text>

        {/* Entry marker */}
        {state !== 'idle' && (
          <g className="lev-entry-dot" transform={`translate(${xEntry},${Y(entry)})`}>
            <circle r="5" />
            <path d={view.dir === 'up' ? 'M -4 -9 L 0 -15 L 4 -9 Z' : 'M -4 9 L 0 15 L 4 9 Z'} />
          </g>
        )}

        {/* Close marker */}
        {view.close && (
          <g className={`lev-close ${view.close.tone}`} transform={`translate(${X(view.close.idx)},${clampY(Y(view.close.price))})`}>
            <circle r="11" className="halo" />
            <circle r="5.5" />
          </g>
        )}

        {/* Now dot */}
        {state === 'live' && (
          <g className="lev-now" transform={`translate(${xNow},${clampY(Y(nowPrice))})`}>
            <circle r="12" className="pulse" />
            <circle r="4.5" />
          </g>
        )}
        {state === 'idle' && (
          <g className="lev-now idle" transform={`translate(${xNow},${clampY(Y(nowPrice))})`}>
            <circle r="10" className="pulse" />
            <circle r="4" />
          </g>
        )}

        {/* Right-axis tags */}
        {placed.map((t) => (
          <g key={t.key} className={`lev-tag ${t.cls}`} transform={`translate(${pad.l + pw + 2},${t.y})`}>
            <rect x="0" y={-9} width={pad.r - 4} height="18" rx="4" />
            <text x={(pad.r - 4) / 2} y="4" textAnchor="middle">
              {t.text}
            </text>
          </g>
        ))}
        <g className={`lev-tag now ${tone}`} transform={`translate(${pad.l + pw + 2},${tagY})`}>
          <rect x="0" y={-11} width={pad.r - 4} height="22" rx="5" />
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

        {/* Clock */}
        <rect className="lev-clock-track" x={xEntry} y={h - 4} width={Math.max(0, xExp - xEntry)} height="3" rx="1.5" />
        <rect className="lev-clock" x={xEntry} y={h - 4} width={Math.max(0, xExp - xEntry) * Math.min(1, view.clock)} height="3" rx="1.5" />
      </svg>
      <div className="lev-overlay">{children}</div>
    </div>
  );
}
