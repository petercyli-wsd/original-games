import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  MAX_N,
  MAX_OMEGA,
  MIN_N,
  PRIMES,
  TRIAL_PRIMES,
  bigOmega as omegaOf,
  candidateMask,
  finalOmegas,
  fmtInt,
  maxRemainder,
  reachable,
  wins,
  type Bet,
  type Trial,
} from './math';

// Two arrangements in viewBox units: "wide" puts the number grid beside the
// tree, the divisors and the Ω bars (desktop); "tall" stacks them (narrow).
interface Geo {
  wide: boolean;
  W: number;
  H: number;
  grid: { x: number; y: number; size: number; headY: number };
  tree: { x: number; y: number; w: number; h: number; headY: number };
  strip: { x: number; y: number; w: number; cellH: number; gap: number; headY: number };
  hist: { x: number; y: number; w: number; h: number; headY: number; horizontal: boolean };
  legendY: number;
  /** Where the round-over card sits. */
  overlay: { x: number; y: number; w: number; h: number };
}

const WIDE: Geo = {
  wide: true,
  W: 880,
  H: 452,
  grid: { x: 44, y: 32, size: 400, headY: 16 },
  tree: { x: 476, y: 30, w: 404, h: 186, headY: 16 },
  strip: { x: 476, y: 248, w: 404, cellH: 22, gap: 4, headY: 236 },
  hist: { x: 476, y: 342, w: 404, h: 76, headY: 324, horizontal: false },
  legendY: 448,
  overlay: { x: 470, y: 226, w: 410, h: 226 },
};

const TALL: Geo = {
  wide: false,
  W: 440,
  H: 630,
  tree: { x: 6, y: 30, w: 428, h: 150, headY: 16 },
  grid: { x: 40, y: 214, size: 300, headY: 200 },
  hist: { x: 352, y: 214, w: 86, h: 300, headY: 200, horizontal: true },
  strip: { x: 6, y: 576, w: 428, cellH: 22, gap: 4, headY: 564 },
  legendY: 538,
  overlay: { x: 0, y: 420, w: 440, h: 210 },
};

const COLS = 100;

/** One zero-length subpath per cell; round caps draw them as dots. Unit space, cell centres at integers. */
function dots(mask: Uint8Array, keep: (n: number) => boolean): string {
  let d = '';
  for (let n = MIN_N; n <= MAX_N; n++) if (mask[n] && keep(n)) d += `M${n % COLS} ${(n / COLS) | 0}h0`;
  return d;
}

const ALL = (() => {
  const m = new Uint8Array(MAX_N + 1);
  m.fill(1, MIN_N);
  return m;
})();
const GHOST = dots(ALL, () => true);

const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const sup = (n: number) => String(n).replace(/\d/g, (d) => SUP[Number(d)]);
const shortPct = (c: number) => {
  const v = c * 100;
  return (v >= 9.95 ? Math.round(v).toString() : v >= 0.995 ? v.toFixed(1) : v >= 0.1 ? v.toFixed(1) : '<0.1') + '%';
};

export interface Probe {
  p: number;
  /** null while the division is being tried. */
  result: 'hit' | 'miss' | 'end' | null;
}

export interface BoardProps {
  bet: Bet;
  /** The state on show (live, or the last live state once over). */
  trial: Trial;
  /** The state before the last step, for the cells it ruled out. */
  prev: Trial | null;
  /** Increments with every applied step (restarts the fade). */
  stepKey: number;
  probe: Probe | null;
  /** The finished run once the round is over: N and all its factors. */
  reveal: Trial | null;
  /** The round is in play (or animating). */
  live: boolean;
  chance: number;
  win: number;
  total: number;
  ms: number;
  overlay?: ReactNode;
}

export default function Board(props: BoardProps) {
  const { bet, trial, prev, stepKey, probe, reveal, live, win, total, ms, overlay } = props;

  // Pick the arrangement from the space the board has, and find where the
  // overlay region lands on screen (the SVG is letterboxed inside the board).
  const svg = useRef<SVGSVGElement>(null);
  const [wide, setWide] = useState(true);
  const [box, setBox] = useState<CSSProperties | null>(null);
  useLayoutEffect(() => {
    const el = svg.current;
    const host = el?.parentElement;
    if (!el || !host) return;
    const measure = () => {
      const w = host.clientWidth >= 700;
      setWide(w);
      const g = w ? WIDE : TALL;
      const o = g.overlay;
      const s = el.getBoundingClientRect();
      const h = host.getBoundingClientRect();
      const scale = Math.min(s.width / g.W, s.height / g.H);
      if (!(scale > 0)) return;
      const ox = s.left - h.left + (s.width - g.W * scale) / 2;
      const oy = s.top - h.top + (s.height - g.H * scale) / 2;
      setBox({ left: ox + o.x * scale, top: oy + o.y * scale, width: o.w * scale, height: o.h * scale });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const g = wide ? WIDE : TALL;

  const cand = useMemo(() => candidateMask(trial), [trial]);
  const layers = useMemo(() => {
    const isWin = (n: number) => wins(bet, omegaOf(n));
    return { win: dots(cand, isWin), lose: dots(cand, (n) => !isWin(n)) };
  }, [cand, bet]);
  const dropped = useMemo(() => {
    if (!prev) return '';
    const before = candidateMask(prev);
    return dots(before, (n) => !cand[n]);
  }, [prev, cand]);

  const n = reveal?.found ?? null;
  const pitch = g.grid.size / COLS;
  const ink = { '--ms': `${ms}ms` } as CSSProperties;

  return (
    <div className="fx-wrap">
      <svg ref={svg} viewBox={`0 0 ${g.W} ${g.H}`} className={'fx ' + (g.wide ? 'wide' : 'tall')} style={ink} role="img" aria-label={`${fmtInt(total)} candidates for N, ${fmtInt(win)} of them win`}>
        {/* ---------- The numbers 0 … 9999, a row of 100 per line ---------- */}
        <GridHead g={g} live={live} n={n} win={win} total={total} />
        <g transform={`translate(${g.grid.x + pitch / 2} ${g.grid.y + pitch / 2}) scale(${pitch})`}>
          <path d={GHOST} className="cell ghost" />
          <path d={layers.lose} className="cell lose" />
          <path d={layers.win} className="cell win" />
          {dropped && <path key={stepKey} d={dropped} className="cell drop" />}
          {n !== null && (
            <g className={'n-mark ' + (wins(bet, reveal!.factors.length) ? 'w' : 'l')}>
              <line x1={-0.5} x2={COLS - 0.5} y1={(n / COLS) | 0} y2={(n / COLS) | 0} />
              <line x1={n % COLS} x2={n % COLS} y1={-0.5} y2={COLS - 0.5} />
              <circle cx={n % COLS} cy={(n / COLS) | 0} r={2.6} />
            </g>
          )}
        </g>
        {Array.from({ length: 10 }, (_, r) => (
          <text key={r} x={g.grid.x - 5} y={g.grid.y + (r * 10 + 0.5) * pitch + 3.5} className="row-label">
            {r * 1000}
          </text>
        ))}
        <Legend g={g} />

        {/* ---------- Factor tree ---------- */}
        <TreeHead g={g} bet={bet} found={reveal ? reveal.factors.length : trial.factors.length} reveal={!!reveal} />
        <Tree g={g} trial={trial} reveal={reveal} probe={probe} ms={ms} />

        {/* ---------- Trial divisors ---------- */}
        <Strip g={g} trial={reveal ?? trial} probe={probe} over={!!reveal} />

        {/* ---------- Final Ω, chance of each ---------- */}
        <Hist g={g} bet={bet} trial={reveal ?? trial} />
      </svg>
      {overlay && box && (
        <div className="fx-overlay" style={box}>
          {overlay}
        </div>
      )}
    </div>
  );
}

function GridHead({ g, live, n, win, total }: { g: Geo; live: boolean; n: number | null; win: number; total: number }) {
  const x0 = g.grid.x;
  const x1 = g.grid.x + g.grid.size;
  const y = g.grid.headY;
  return (
    <>
      <text x={x0} y={y} className="head">
        {n !== null ? (
          <>
            N = <tspan className="accent">{fmtInt(n)}</tspan>
          </>
        ) : live ? (
          'Where N can still be'
        ) : (
          'N is any of these'
        )}
      </text>
      <text x={x1} y={y} className="head-r">
        <tspan className="win-t">{fmtInt(win)}</tspan> of {fmtInt(total)} win
      </text>
    </>
  );
}

function Legend({ g }: { g: Geo }) {
  const cx = g.grid.x + g.grid.size / 2;
  const items = [
    { cls: 'win', label: 'wins' },
    { cls: 'lose', label: 'loses' },
    { cls: 'ghost', label: 'ruled out' },
  ];
  const w = 78;
  return (
    <g className="legend">
      {items.map((it, i) => {
        const x = cx + (i - 1) * w - 24;
        return (
          <g key={it.cls}>
            <circle cx={x} cy={g.legendY - 4} r={4} className={'lg ' + it.cls} />
            <text x={x + 9} y={g.legendY}>
              {it.label}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function TreeHead({ g, bet, found, reveal }: { g: Geo; bet: Bet; found: number; reveal: boolean }) {
  const { x, w, headY: y } = g.tree;
  const slots = bet === 1 ? 2 : bet;
  const r = 5.5;
  const gap = 15;
  const right = x + w - 4;
  const startX = right - (slots - 1) * gap - r;
  const label = bet === 1 ? 'need exactly 1' : `need ${bet}+`;
  return (
    <>
      <text x={x + 2} y={y} className="head">
        Factor tree
      </text>
      <text x={startX - r - 8} y={y} className="head-r small">
        {label}
      </text>
      {Array.from({ length: slots }, (_, i) => {
        const filled = i < found;
        const forbidden = bet === 1 && i === 1;
        return (
          <circle
            key={i}
            cx={startX + i * gap}
            cy={y - 4}
            r={r}
            className={'slot' + (filled ? ' on' : '') + (forbidden ? ' no' : '') + (filled && reveal ? ' rv' : '')}
          />
        );
      })}
      {bet === 1 && <line x1={startX + gap - r} y1={y - 4 + r} x2={startX + gap + r} y2={y - 4 - r} className="slot-x" />}
    </>
  );
}

interface TNode {
  key: string;
  x: number;
  y: number;
  label: string;
  /** spine: a composite or hidden remainder (square); leaf: a prime factor (circle). */
  kind: 'spine' | 'leaf';
  hidden: boolean;
  /** Revealed only after the round ended. */
  late: boolean;
  root: boolean;
  current: boolean;
}

function Tree({ g, trial, reveal, probe, ms }: { g: Geo; trial: Trial; reveal: Trial | null; probe: Probe | null; ms: number }) {
  const area = g.tree;
  const played = trial.done ? trial.factors.length : trial.factors.length;
  const nodes: TNode[] = [];
  const edges: { key: string; a: TNode; b: TNode; late: boolean }[] = [];

  // Spine labels and leaves.
  let spine: { label: string; hidden: boolean; prime: boolean; late: boolean }[];
  let leaves: { p: number; late: boolean }[];
  if (reveal) {
    const f = reveal.factors;
    const n = reveal.found;
    leaves = f.slice(0, -1).map((p, i) => ({ p, late: i >= played }));
    spine = [];
    let rest = n;
    for (let j = 0; j < f.length; j++) {
      spine.push({ label: fmtInt(rest), hidden: false, prime: j === f.length - 1, late: j === f.length - 1 && j >= played });
      rest /= f[j];
    }
  } else {
    leaves = trial.factors.map((p) => ({ p, late: false }));
    spine = Array.from({ length: leaves.length + 1 }, () => ({ label: '?', hidden: true, prime: false, late: false }));
  }

  const L = spine.length;
  const s = Math.max(0.6, Math.min(1, (area.h - 26) / Math.max(1, L - 1) / 38));
  const dy = Math.min(42, (area.h - 30 * s) / Math.max(1, L - 1));
  const dx = Math.min(g.wide ? 44 : 50, (area.w - 70) / Math.max(1, L));
  const sx = area.x + area.w / 2 + dx - (L * dx) / 2;
  const sy = area.y + 14 * s + (L === 1 ? (area.h - 30) / 2 - 10 : 0);

  const spineNodes = spine.map((sp, j) => {
    const node: TNode = {
      key: `s${j}`,
      x: sx + j * dx,
      y: sy + j * dy,
      label: sp.label,
      kind: sp.prime ? 'leaf' : 'spine',
      hidden: sp.hidden,
      late: sp.late,
      root: j === 0,
      current: !reveal && j === L - 1,
    };
    nodes.push(node);
    return node;
  });
  leaves.forEach((lf, k) => {
    const j = k + 1;
    const node: TNode = { key: `l${j}`, x: sx + (j - 2) * dx, y: sy + j * dy, label: String(lf.p), kind: 'leaf', hidden: false, late: lf.late, root: false, current: false };
    nodes.push(node);
    edges.push({ key: `e${j}l`, a: spineNodes[j - 1], b: node, late: lf.late });
    edges.push({ key: `e${j}s`, a: spineNodes[j - 1], b: spineNodes[j], late: lf.late });
  });

  const cur = spineNodes[L - 1];
  const hi = maxRemainder(trial);
  const nodeH = 24 * s;

  return (
    <g className="tree" style={{ '--s': s } as CSSProperties}>
      {edges.map((e) => (
        <line key={e.key} x1={e.a.x} y1={e.a.y} x2={e.b.x} y2={e.b.y} className={'edge' + (e.late ? ' late' : '')} />
      ))}
      {nodes.map((nd) => {
        const wLabel = Math.max(nd.label.length, 1);
        if (nd.kind === 'leaf') {
          const r = (wLabel <= 2 ? 13 : 7 + wLabel * 3.6) * s;
          const pill = wLabel > 2;
          return (
            <g key={nd.key} className={'node leaf' + (nd.late ? ' late' : '')} style={{ transform: `translate(${nd.x}px, ${nd.y}px)` }}>
              <g className="pop">
                {pill ? <rect x={-r} y={-13 * s} width={2 * r} height={26 * s} rx={13 * s} /> : <circle r={r} />}
                <text y={4.5 * s} style={{ fontSize: `${13 * s}px` }}>
                  {nd.label}
                </text>
              </g>
            </g>
          );
        }
        const w = (nd.hidden ? 30 : 14 + wLabel * 7.6) * s;
        return (
          <g
            key={nd.key}
            className={'node spine' + (nd.hidden ? ' hidden' : '') + (nd.current ? ' current' : '') + (nd.root ? ' root' : '')}
            style={{ transform: `translate(${nd.x}px, ${nd.y}px)` }}
          >
            <g className="pop">
              <rect x={-w / 2} y={-nodeH / 2} width={w} height={nodeH} rx={5 * s} />
              <text y={4.5 * s} style={{ fontSize: `${13 * s}px` }}>
                {nd.label}
              </text>
              {nd.root && (
                <text y={-nodeH / 2 - 5} className="tag">
                  N
                </text>
              )}
            </g>
          </g>
        );
      })}
      {/* The remainder's range, beside the current node. */}
      {!reveal && (
        <text x={cur.x + 22 * s} y={cur.y + (L === 1 ? 4 : 4)} className="range" style={{ transition: `x ${ms}ms, y ${ms}ms` }}>
          {L === 1 ? `2 to ${fmtInt(MAX_N)}` : `≤ ${fmtInt(hi)}`}
        </text>
      )}
      {/* The division being tried. */}
      {probe && !reveal && (
        <g className={'probe ' + (probe.result ?? 'trying')} style={{ transform: `translate(${cur.x}px, ${cur.y + nodeH / 2 + 15}px)` }}>
          <rect x={-24} y={-11} width={48} height={22} rx={11} />
          <text y={4.5}>
            {probe.result === 'miss' ? `${probe.p} ∤` : probe.result === 'hit' ? `${probe.p} ∣` : probe.result === 'end' ? `${probe.p}² >` : `÷ ${probe.p}`}
          </text>
        </g>
      )}
    </g>
  );
}

function Strip({ g, trial, probe, over }: { g: Geo; trial: Trial; probe: Probe | null; over: boolean }) {
  const { x, y, w, cellH, gap, headY } = g.strip;
  const perRow = 13;
  const cw = (w - (perRow - 1) * gap) / perRow;
  const hi = maxRemainder(trial);
  const lastReach = TRIAL_PRIMES.filter((_, j) => reachable(trial, j)).pop();
  return (
    <g className="strip">
      <text x={x + 2} y={headY} className="head">
        Trial divisors
      </text>
      <text x={x + w - 2} y={headY} className="head-r small">
        {trial.done
          ? `stopped at ${PRIMES[trial.i]}: ${PRIMES[trial.i]}² > what was left`
          : lastReach
            ? `stops by ${lastReach} at the latest (${lastReach}² ≤ ${fmtInt(hi)})`
            : 'stops at the next check'}
      </text>
      {TRIAL_PRIMES.map((p, j) => {
        const row = Math.floor(j / perRow);
        const col = j % perRow;
        const cx = x + col * (cw + gap);
        const cy = y + row * (cellH + gap);
        const e = trial.exps[j] ?? 0;
        let state = 'ahead';
        if (j < trial.i) state = e > 0 ? 'hit' : 'miss';
        else if (j === trial.i && !trial.done) state = e > 0 ? 'hit current' : 'current';
        else if (j === trial.i && trial.done) state = 'stop';
        else if (!reachable(trial, j)) state = 'beyond';
        if (over && state.includes('current')) state = state.replace('current', '');
        const trying = probe && probe.p === p && !over;
        return (
          <g key={p} className={'pcell ' + state + (trying ? ' trying' : '')}>
            <rect x={cx} y={cy} width={cw} height={cellH} rx={5} />
            <text x={cx + cw / 2} y={cy + cellH / 2 + 4.5}>
              {p}
              {e > 1 && <tspan className="exp">{sup(e)}</tspan>}
            </text>
            {state === 'miss' && <line x1={cx + 6} y1={cy + cellH - 5} x2={cx + cw - 6} y2={cy + 5} className="slash" />}
          </g>
        );
      })}
    </g>
  );
}

function Hist({ g, bet, trial }: { g: Geo; bet: Bet; trial: Trial }) {
  const { x, y, w, h, headY, horizontal } = g.hist;
  const counts = finalOmegas(trial);
  const total = counts.reduce((a, b) => a + b, 0) || 1;
  const shown = Array.from({ length: MAX_OMEGA }, (_, k) => k + 1);
  const max = Math.max(...shown.map((j) => counts[j])) || 1;
  const n = shown.length;

  if (!horizontal) {
    const bw = w / n;
    const thresholdX = bet >= 2 ? x + (bet - 1) * bw : null;
    return (
      <g className="hist">
        <text x={x + 2} y={headY} className="head">
          Prime factors Ω(N)
        </text>
        <text x={x + w - 2} y={headY} className="head-r small">
          chance of each final count
        </text>
        {shown.map((j, k) => {
          const c = counts[j];
          const share = c / total;
          const bh = c ? Math.max(1.5, (h * c) / max) : 0;
          const bx = x + k * bw + 3;
          return (
            <g key={j}>
              <rect x={bx} y={y + h - 1} width={bw - 6} height={1} className="base" />
              <rect
                x={bx}
                y={y}
                width={bw - 6}
                height={h}
                className={'bar ' + (wins(bet, j) ? 'win' : 'lose')}
                style={{ transform: `scaleY(${bh / h})` }}
              />
              {share >= 0.001 && (
                <text x={bx + (bw - 6) / 2} y={y + h - bh - 4} className="pct">
                  {shortPct(share)}
                </text>
              )}
              <text x={bx + (bw - 6) / 2} y={y + h + 14} className={'axis' + (wins(bet, j) ? ' win-t' : '')}>
                {j}
              </text>
            </g>
          );
        })}
        {thresholdX !== null && <line x1={thresholdX} x2={thresholdX} y1={y - 6} y2={y + h + 2} className="threshold" />}
      </g>
    );
  }

  const bh = h / n;
  const labelW = 16;
  const barMax = w - labelW - 30;
  const thresholdY = bet >= 2 ? y + (bet - 1) * bh : null;
  return (
    <g className="hist">
      <text x={x + labelW} y={headY} className="head">
        Ω(N)
      </text>
      {shown.map((j, k) => {
        const c = counts[j];
        const share = c / total;
        const len = c ? Math.max(1.5, (barMax * c) / max) : 0;
        const by = y + k * bh + 2;
        return (
          <g key={j}>
            <text x={x + labelW - 4} y={by + bh / 2 + 2} className={'axis end' + (wins(bet, j) ? ' win-t' : '')}>
              {j}
            </text>
            <rect x={x + labelW} y={by} width={barMax} height={bh - 4} className={'bar h ' + (wins(bet, j) ? 'win' : 'lose')} style={{ transform: `scaleX(${len / barMax})` }} />
            {share >= 0.001 && (
              <text x={x + labelW + len + 3} y={by + bh / 2 + 2} className="pct start">
                {shortPct(share)}
              </text>
            )}
          </g>
        );
      })}
      {thresholdY !== null && <line x1={x + 2} x2={x + w} y1={thresholdY} y2={thresholdY} className="threshold" />}
    </g>
  );
}
