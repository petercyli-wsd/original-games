import type { CSSProperties } from 'react';
import { hasEdge, isFatal, type Graph, type Pair } from './math';

const C = 200;
const R = 152;

/** Node i of n on the ring, clockwise from the top. */
const nodeAt = (i: number, n: number) => {
  const a = (i / n) * 2 * Math.PI;
  return { x: C + R * Math.sin(a), y: C - R * Math.cos(a) };
};

const nodeRadius = (n: number) => (n <= 6 ? 19 : n <= 8 ? 17 : n <= 10 ? 15.5 : 14);

/** The edge being drawn right now. Its fate is already decided; the board only reveals it at the end. */
export interface Pending {
  id: number;
  u: number;
  v: number;
  safe: boolean;
  /** Open cells the picker flickers over before it lands (cosmetic). */
  scan: Pair[];
  /** Total animation time. */
  ms: number;
}

/** When the picker lands and the chord starts to grow. */
export const landAt = (p: Pending) => (p.scan.length ? Math.round(p.ms * 0.45) : 0);

export interface Bust {
  u: number;
  v: number;
  /** Path from u to v through the graph: with v–u it is the odd cycle. */
  cycle: number[];
}

const toneClass = (t: number) => (t === 0 ? 'light' : t === 1 ? 'dark' : 'free');

// ---------------------------------------------------------------------------

export interface RingProps {
  graph: Graph;
  /** Open pairs that would close an odd cycle (drawn faintly). */
  fatal: Pair[];
  pending: Pending | null;
  bust: Bust | null;
  won: boolean;
}

export function Ring({ graph, fatal, pending, bust, won }: RingProps) {
  const { n } = graph;
  const pos = Array.from({ length: n }, (_, i) => nodeAt(i, n));
  const r = nodeRadius(n);
  const cycleEdges = new Set<string>();
  if (bust) for (let k = 0; k + 1 < bust.cycle.length; k++) cycleEdges.add(pairKey(bust.cycle[k], bust.cycle[k + 1]));
  const onCycle = new Set(bust ? bust.cycle : []);
  const land = pending ? landAt(pending) : 0;

  return (
    <svg viewBox="0 0 400 400" className={'tt-ring' + (won ? ' won' : '')} role="img" aria-label={`${n} nodes, ${graph.edges.length} edges, ${fatal.length} fatal pairs`}>
      <circle cx={C} cy={C} r={R} className="guide" />

      {fatal.map(([a, b]) => (
        <line key={`f${a}-${b}`} x1={pos[a].x} y1={pos[a].y} x2={pos[b].x} y2={pos[b].y} className="fatal" />
      ))}

      {graph.edges.map(([a, b]) => (
        <line
          key={`e${a}-${b}`}
          x1={pos[a].x}
          y1={pos[a].y}
          x2={pos[b].x}
          y2={pos[b].y}
          className={'edge' + (cycleEdges.has(pairKey(a, b)) ? ' cycle' : '')}
        />
      ))}

      {pending && (
        <line
          key={`p${pending.id}`}
          x1={pos[pending.u].x}
          y1={pos[pending.u].y}
          x2={pos[pending.v].x}
          y2={pos[pending.v].y}
          pathLength={1}
          className="growing"
          style={{ animationDuration: `${pending.ms - land}ms`, animationDelay: `${land}ms` } as CSSProperties}
        />
      )}
      {bust && <line x1={pos[bust.u].x} y1={pos[bust.u].y} x2={pos[bust.v].x} y2={pos[bust.v].y} className="killer" />}

      {pos.map((p, i) => {
        const ends = pending && (pending.u === i || pending.v === i);
        const cls = ['node', toneClass(graph.tone[i])];
        if (ends) cls.push('picked');
        if (onCycle.has(i)) cls.push('odd');
        return (
          <g key={i} className={cls.join(' ')}>
            <circle cx={p.x} cy={p.y} r={r} style={ends ? { animationDelay: `${land}ms` } : undefined} />
            <text x={p.x} y={p.y + 0.5} style={{ fontSize: r * 0.82 }}>
              {i + 1}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

const pairKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

// ---------------------------------------------------------------------------

export interface PairGridProps {
  graph: Graph;
  pending: Pending | null;
  bust: Bust | null;
  fatal: number;
  open: number;
  /** What the summary line under the grid says. */
  mode: 'idle' | 'live' | 'bust' | 'won' | 'cashed';
  target: number;
}

const GX = 30;
const GY = 4;
const GS = 240;

/**
 * Every pair of nodes as one cell of a staircase (row j, column i < j). Placed
 * edges are filled, fatal pairs red, safe pairs green. The next edge is a
 * uniformly random cell that isn't filled, so the red share is the risk.
 */
export function PairGrid({ graph, pending, bust, fatal, open, mode, target }: PairGridProps) {
  const { n } = graph;
  const s = GS / (n - 1);
  const pad = Math.max(1.2, s * 0.07);
  const dot = Math.min(s * 0.36, 10.5);
  const land = pending ? landAt(pending) : 0;
  const hop = pending && pending.scan.length ? land / pending.scan.length : 0;
  const scanAt = new Map<string, number>();
  pending?.scan.forEach(([a, b], k) => scanAt.set(pairKey(a, b), k));

  const cells = [];
  for (let j = 1; j < n; j++) {
    for (let i = 0; i < j; i++) {
      const key = pairKey(i, j);
      const state = hasEdge(graph, i, j) ? 'edge' : isFatal(graph, i, j) ? 'fatal' : 'safe';
      const cls = ['cell', state];
      let style: CSSProperties | undefined;
      const k = scanAt.get(key);
      if (pending && pairKey(pending.u, pending.v) === key) {
        cls.push('pick');
        style = { animationDelay: `${land}ms` };
      } else if (k !== undefined) {
        cls.push('scan');
        style = { animationDelay: `${Math.round(k * hop)}ms`, animationDuration: `${Math.max(40, Math.round(hop))}ms` };
      }
      if (bust && pairKey(bust.u, bust.v) === key) cls.push('killer');
      cells.push(<rect key={key} x={GX + i * s + pad} y={GY + (j - 1) * s + pad} width={s - 2 * pad} height={s - 2 * pad} rx={Math.min(4, s * 0.12)} className={cls.join(' ')} style={style} />);
    }
  }

  const label = (i: number, x: number, y: number) => (
    <g key={`l${x}-${y}`} className={'tag ' + toneClass(graph.tone[i])}>
      <circle cx={x} cy={y} r={dot} />
      <text x={x} y={y + 0.5} style={{ fontSize: dot * 1.05 }}>
        {i + 1}
      </text>
    </g>
  );

  const m = graph.edges.length;
  const safe = open - fatal;
  let head: string;
  let sub: string;
  let tone = '';
  if (mode === 'idle') {
    head = `${open} open pairs, 0 red`;
    sub = 'Red pairs appear once a node has two neighbours.';
  } else if (mode === 'bust') {
    head = `Odd cycle of ${bust?.cycle.length ?? 0}`;
    sub = 'The edge joined two nodes of the same tone.';
    tone = 'bad';
  } else if (mode === 'won') {
    head = `${m} edges, still two-toned`;
    sub = m < target ? 'Every open pair turned red: auto cash-out.' : 'Target reached.';
    tone = 'good';
  } else if (mode === 'cashed') {
    head = `${fatal} red of ${open} open`;
    sub = 'Cashed out before the next edge.';
  } else {
    head = `${fatal} red of ${open} open`;
    sub = fatal === 0 ? 'No red pairs: this edge is free.' : `The next edge is a random unfilled cell: ${safe} of ${open} are green.`;
    tone = fatal > 0 ? 'risk' : 'good';
  }

  return (
    <div className="tt-side">
      <div className="tt-side-head">
        <span>Pairs</span>
        <b>
          {m} / {target} edges
        </b>
      </div>
      <svg viewBox={`0 0 ${GX + GS + 2} ${GY + GS + 2 * dot + 8}`} className="tt-grid" role="img" aria-label={`${fatal} fatal of ${open} open pairs`}>
        {cells}
        {Array.from({ length: n - 1 }, (_, r) => label(r + 1, GX - dot - 5, GY + r * s + s / 2))}
        {Array.from({ length: n - 1 }, (_, c) => label(c, GX + c * s + s / 2, GY + GS + dot + 5))}
      </svg>
      <div className={'tt-sum ' + tone}>
        <b>{head}</b>
        <span>{sub}</span>
      </div>
      <div className="tt-legend">
        <span>
          <i className="edge" /> edge
        </span>
        <span>
          <i className="fatal" /> odd cycle
        </span>
        <span>
          <i className="safe" /> safe
        </span>
      </div>
    </div>
  );
}
