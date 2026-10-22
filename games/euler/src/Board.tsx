import { fmtChance } from '@originals/game-sdk/ui';
import type { CSSProperties } from 'react';
import { split, states, wins, type Bet } from './math';

const C = 200;
const R = 150;

const nodePos = (i: number, n: number) => {
  const a = (i / n) * 2 * Math.PI;
  return { x: C + R * Math.sin(a), y: C - R * Math.cos(a) };
};

/** A chord between two nodes, bent sideways for repeated edges so each copy shows. */
function edgePath(u: number, v: number, n: number, copy: number) {
  const a = nodePos(u, n);
  const b = nodePos(v, n);
  const off = copy === 0 ? 0 : Math.ceil(copy / 2) * 16 * (copy % 2 ? 1 : -1);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const mx = (a.x + b.x) / 2 - (dy / len) * off * 2;
  const my = (a.y + b.y) / 2 + (dx / len) * off * 2;
  return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
}

export interface GraphProps {
  n: number;
  edges: [number, number][];
  degrees: number[];
  /** The edge being drawn right now (its degrees are not counted yet). */
  pending: [number, number] | null;
  drawMs: number;
  /** The game is over and lost: odd nodes turn red. */
  lost: boolean;
}

export function Graph({ n, edges, degrees, pending, drawMs, lost }: GraphProps) {
  const copies = new Map<string, number>();
  const paths = edges.map(([u, v]) => {
    const key = `${u}-${v}`;
    const c = copies.get(key) ?? 0;
    copies.set(key, c + 1);
    return edgePath(u, v, n, c);
  });
  const pendingPath = pending ? edgePath(pending[0], pending[1], n, copies.get(`${pending[0]}-${pending[1]}`) ?? 0) : null;
  const odd = degrees.filter((d) => d % 2).length;
  const r = n <= 8 ? 17 : 15;

  return (
    <svg viewBox="0 0 400 400" className="eu-graph" role="img" aria-label={`${n} nodes, ${edges.length} edges, ${odd} odd`}>
      <circle cx={C} cy={C} r={R} className="guide" />
      {paths.map((d, i) => (
        <path key={i} d={d} className={'edge' + (i === paths.length - 1 && !pending ? ' last' : '')} />
      ))}
      {pendingPath && (
        <path
          key={`p${edges.length}`}
          d={pendingPath}
          pathLength={1}
          className="edge drawing"
          style={{ animationDuration: `${drawMs}ms` } as CSSProperties}
        />
      )}
      {degrees.map((d, i) => {
        const { x, y } = nodePos(i, n);
        const isOdd = d % 2 === 1;
        const hit = pending && (pending[0] === i || pending[1] === i);
        return (
          <g key={i} className={'node' + (isOdd ? ' odd' : ' even') + (isOdd && lost ? ' bad' : '') + (hit ? ' hit' : '')}>
            {isOdd && <circle cx={x} cy={y} r={r + 7} className="halo" />}
            <circle cx={x} cy={y} r={r} className="dot" />
            <text x={x} y={y + 5}>{d}</text>
          </g>
        );
      })}
    </svg>
  );
}

export interface ChainProps {
  n: number;
  bet: Bet;
  /** Current odd count. */
  k: number;
  /** Edges left to draw. */
  left: number;
  /** P(win | each k, left), for k = 0, 2, …, n. */
  chances: number[];
  /** P(win | each k, left − 1): the value after the next edge. Null hides the next-edge split. */
  next: number[] | null;
}

/** A short percentage that fits a slot: never rounds a live chance to 0 or 100. */
function pct(p: number) {
  if (p === 0) return '0';
  if (p >= 1 - 1e-12) return '100%';
  if (p < 0.0001) return '<.01%';
  if (p > 0.999) return '>99.9%';
  return (p * 100).toFixed(p < 0.1 ? 2 : 1) + '%';
}

const X0 = 18;
const X1 = 302;
const TOP = 66;
const BASE = 226;

/** The odd-count chain: a slot per k, its bar the exact win chance from there. */
export function Chain({ n, bet, k, left, chances, next }: ChainProps) {
  const ks = states(n);
  const w = (X1 - X0) / ks.length;
  const H = BASE - TOP;
  const sp = split(n, k);
  const cur = chances[k / 2];
  const zone = ks.filter((x) => wins(bet, x));

  return (
    <svg viewBox="0 0 320 360" className="eu-chain" role="img" aria-label={`${k} odd nodes, win chance ${fmtChance(cur)}`}>
      <text x={X0} y={22} className="title">
        Odd nodes k
      </text>
      <text x={X1} y={22} className="sub end">
        {left} edge{left === 1 ? '' : 's'} left
      </text>
      <text x={X0} y={44} className="sub">
        bar = exact chance to win from each k
      </text>

      {ks.map((x, i) => {
        const p = chances[i];
        // Bars use the slot minus a label strip, so the percentage always sits above its bar.
        const h = p > 0 ? Math.max(2, p * (H - 22)) : 0;
        const cx = X0 + i * w + w / 2;
        const on = x === k;
        const inZone = wins(bet, x);
        return (
          <g key={x} className={'col' + (on ? ' on' : '') + (inZone ? ' zone' : '')}>
            <rect x={X0 + i * w + 3} y={TOP} width={w - 6} height={H} rx={5} className="slot" />
            <rect x={X0 + i * w + 7} y={BASE - h} width={w - 14} height={h} rx={3} className="bar" />
            <text x={cx} y={BASE - h - 7} className="pct" style={{ fontSize: ks.length > 5 ? (on ? 10.5 : 10) : on ? 12 : 11 }}>
              {pct(p)}
            </text>
            <text x={cx} y={BASE + 20} className="k">
              {x}
            </text>
          </g>
        );
      })}
      <text x={X0} y={BASE + 42} className="legend">
        <tspan className="zone-key">■</tspan> win zone: {zone.length === 1 ? `k = ${zone[0]}` : zone[0] === 0 ? `k ≤ ${zone[zone.length - 1]}` : `k ≥ ${zone[0]}`}
        <tspan dx={10} className="on-key">
          ■
        </tspan>{' '}
        now: k = {k}
      </text>

      {next && <NextEdge sp={sp} k={k} cur={cur} next={next} y={BASE + 66} />}
    </svg>
  );
}

/**
 * The C(n, 2) possible next edges as one bar, split by how they move k. Each
 * part is green if landing there raises your cash-out, red if it lowers it.
 */
function NextEdge({ sp, k, cur, next, y }: { sp: ReturnType<typeof split>; k: number; cur: number; next: number[]; y: number }) {
  const W = X1 - X0;
  const tone = (k2: number) => {
    const after = next[k2 / 2] ?? 0;
    return after > cur * (1 + 1e-9) ? 'up' : after < cur * (1 - 1e-9) ? 'down' : 'flat';
  };
  const segs = [
    { n: sp.heal, cls: tone(k - 2), label: 'odd–odd', move: '−2' },
    { n: sp.shift, cls: tone(k), label: 'mixed', move: '±0' },
    { n: sp.add, cls: tone(k + 2), label: 'even–even', move: '+2' },
  ].map((s, i) => ({ ...s, key: i }));
  let x = X0;
  return (
    <g className="next">
      <text x={X0} y={y} className="sub">
        Next edge · {sp.total} pairs
      </text>
      {segs.map((s) => {
        const wd = (s.n / sp.total) * W;
        const r = (
          <rect key={s.key} x={x} y={y + 8} width={Math.max(0, wd - (s.n && wd > 2 ? 1.5 : 0))} height={14} rx={2} className={'seg ' + s.cls} />
        );
        x += wd;
        return r;
      })}
      <text x={X0} y={y + 40} className="legend">
        {segs.filter((s) => s.n > 0).map((s, i) => (
          <tspan key={s.key} dx={i ? 8 : 0} className={'key ' + s.cls}>
            {s.n} {s.label} {s.move}
          </tspan>
        ))}
      </text>
    </g>
  );
}
