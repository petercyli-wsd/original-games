import { useMemo, useRef, type PointerEvent as ReactPointerEvent, type Ref } from 'react';
import { GRID, fmtX, inWindow, rowIndex, tOf, treeRows, xOfGrid, type Dir, type Node, type Win } from './math';

// Board geometry, in viewBox units. The number line runs along the bottom of
// the tree (t = x/(1+x) from X0 to X1); each tree row is one coin flip deeper.
const VB_W = 560;
const VB_H = 380;
const X0 = 30;
const W = 500;
const TOP = 82; // the root's row (below the window grips)
const AXIS = 292; // the final row = the number line
const tx = (t: number) => X0 + t * W;
const gx = (k: number) => X0 + (k / GRID) * W;

const TICKS: [number, number, string][] = [
  [0, 1, '0'],
  [1, 3, '⅓'],
  [1, 2, '½'],
  [2, 3, '⅔'],
  [1, 1, '1'],
  [3, 2, '3/2'],
  [2, 1, '2'],
  [3, 1, '3'],
  [1, 0, '∞'],
];

export type Outcome = 'won' | 'lost' | 'cashed';

export interface BoardProps {
  depth: number;
  win: Win;
  path: Dir[];
  /** Where the walker is heading during a step (null at rest). */
  moving: Dir | null;
  stepMs: number;
  lit: number;
  total: number;
  outcome: Outcome | null;
  live: boolean;
  /** Drag the window (only while not live). */
  onWindow?: (lo: number, hi: number) => void;
  svgRef?: Ref<SVGSVGElement>;
}

const yOf = (d: number, depth: number) => TOP + (d * (AXIS - TOP)) / depth;
const label = (n: Node) => (n.q === 1 ? String(n.p) : `${n.p}/${n.q}`);

/** One path string per edge class, so a depth-10 tree stays a handful of DOM nodes. */
function useEdges(depth: number, path: Dir[]) {
  return useMemo(() => {
    const rows = treeRows(depth);
    const k = path.length;
    const at = rowIndex(path);
    const pre = Array.from({ length: k + 1 }, (_, d) => rowIndex(path.slice(0, d)));
    let faint = '';
    let reach = '';
    let walked = '';
    for (let d = 0; d < depth; d++) {
      const y0 = yOf(d, depth).toFixed(1);
      const y1 = yOf(d + 1, depth).toFixed(1);
      rows[d].forEach((n, i) => {
        const x0 = tx(tOf(n.p, n.q)).toFixed(1);
        [0, 1].forEach((b) => {
          const c = rows[d + 1][2 * i + b];
          const seg = `M${x0} ${y0}L${tx(tOf(c.p, c.q)).toFixed(1)} ${y1}`;
          const j = 2 * i + b;
          const onPath = d < k && i === pre[d] && j === pre[d + 1];
          const below = d >= k && i >> (d - k) === at;
          if (onPath) walked += seg;
          else if (below) reach += seg;
          else faint += seg;
        });
      });
    }
    return { faint, reach, walked };
  }, [depth, path]);
}

export default function Board({ depth, win, path, moving, stepMs, lit, total, outcome, live, onWindow, svgRef }: BoardProps) {
  const rows = treeRows(depth);
  const k = path.length;
  const at = rowIndex(path);
  const node = rows[k][at];
  const edges = useEdges(depth, path);
  const leaves = rows[depth];
  const span = 2 ** (depth - k);
  const dragging = useRef<{
    mode: 'lo' | 'hi' | 'move';
    start: number;
    lo: number;
    hi: number;
  } | null>(null);
  const local = useRef<SVGSVGElement | null>(null);

  // Walker: at the current node, or sliding to the child it is heading for.
  const target = moving ? rows[k + 1][2 * at + (moving === 'R' ? 1 : 0)] : node;
  const wx = tx(tOf(target.p, target.q));
  const wy = yOf(moving ? k + 1 : k, depth);

  const toGrid = (e: ReactPointerEvent) => {
    const svg = local.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return 0;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return ((pt.x - X0) / W) * GRID;
  };
  const down = (mode: 'lo' | 'hi' | 'move') => (e: ReactPointerEvent) => {
    if (live || !onWindow) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragging.current = { mode, start: toGrid(e), lo: win.lo, hi: win.hi };
  };
  const move = (e: ReactPointerEvent) => {
    const d = dragging.current;
    if (!d || !onWindow) return;
    const g = toGrid(e);
    if (d.mode === 'lo') onWindow(Math.min(g, d.hi - 1), d.hi);
    else if (d.mode === 'hi') onWindow(d.lo, Math.max(g, d.lo + 1));
    else {
      const shift = Math.max(-d.lo, Math.min(GRID - d.hi, g - d.start));
      onWindow(d.lo + shift, d.hi + shift);
    }
  };
  const up = () => (dragging.current = null);

  const wl = gx(win.lo);
  const wr = gx(win.hi);
  const mid = (wl + wr) / 2;
  const winText = `x from ${fmtX(xOfGrid(win.lo))} to ${fmtX(xOfGrid(win.hi))}`;
  const leafR = depth <= 4 ? 5.5 : depth <= 6 ? 4.2 : depth <= 8 ? 3 : 2.3;
  const finalNode = k === depth ? node : null;
  const pct = total ? (lit / total) * 100 : 0;

  return (
    <svg
      ref={(el) => {
        local.current = el;
        if (typeof svgRef === 'function') svgRef(el);
        else if (svgRef && 'current' in svgRef) (svgRef as { current: SVGSVGElement | null }).current = el;
      }}
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      className={'mediant' + (depth >= 8 ? ' deep' : '')}
      role="img"
      aria-label={`${lit} of ${total} reachable fractions lie in the window, ${winText}`}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      {/* The window: a column over the number line. */}
      <rect x={wl} y={34} width={Math.max(1, wr - wl)} height={AXIS - 34 + 10} className={'win' + (live ? '' : ' grab')} onPointerDown={down('move')} />
      <line x1={wl} y1={34} x2={wl} y2={AXIS + 10} className="win-edge" />
      <line x1={wr} y1={34} x2={wr} y2={AXIS + 10} className="win-edge" />
      {!live && onWindow && (
        <>
          {[wl, wr].map((x, i) => (
            <g key={i}>
              <rect x={x - 4} y={36} width={8} height={24} rx={4} className="grip" />
              <rect x={x - 9} y={30} width={18} height={AXIS - 20} className="grip-hit" onPointerDown={down(i ? 'hi' : 'lo')} />
            </g>
          ))}
        </>
      )}
      <text x={Math.min(VB_W - 90, Math.max(90, mid))} y={22} className="win-label">
        {winText}
      </text>

      {/* The Stern–Brocot tree, drawn at each fraction's place on the line. */}
      <path d={edges.faint} className="edge faint" />
      <path d={edges.reach} className="edge reach" />
      <path d={edges.walked} className="edge walked" />

      {/* Number line. */}
      <line x1={X0} y1={AXIS} x2={X0 + W} y2={AXIS} className="axis" />
      {TICKS.map(([p, q, s]) => (
        <g key={s}>
          <line x1={tx(tOf(p, q))} y1={AXIS + 4} x2={tx(tOf(p, q))} y2={AXIS + 10} className="tick" />
          <text x={tx(tOf(p, q))} y={AXIS + 25} className="tick-label">
            {s}
          </text>
        </g>
      ))}

      {/* Every final fraction: lit if reachable and in the window. */}
      {leaves.map((n, i) => {
        const reachable = i >> (depth - k) === at;
        const inside = inWindow(n.p, n.q, win);
        const cls = !reachable ? 'leaf gone' : inside ? 'leaf lit' : 'leaf dark';
        return <circle key={i} cx={tx(tOf(n.p, n.q))} cy={AXIS} r={leafR} className={cls} />;
      })}

      {/* Where the walk is now. */}
      {!finalNode && (
        <text x={tx(tOf(node.p, node.q))} y={yOf(k, depth) - 14} className="node-label">
          {label(node)}
        </text>
      )}
      {finalNode && (
        <>
          <circle cx={tx(tOf(node.p, node.q))} cy={AXIS} r={11} className={'final ' + (inWindow(node.p, node.q, win) ? 'in' : 'out')} />
          <text x={Math.min(VB_W - 30, Math.max(30, tx(tOf(node.p, node.q))))} y={AXIS - 18} className="node-label final-label">
            {label(node)}
          </text>
        </>
      )}
      <g
        className="walker"
        style={{
          transform: `translate(${wx}px, ${wy}px)`,
          transitionDuration: `${stepMs}ms`,
        }}
      >
        <circle r={finalNode ? 0 : 7} />
      </g>

      {/* The odds, as a count. */}
      <text x={VB_W / 2} y={AXIS + 56} className="count">
        <tspan className="lit-n">{lit}</tspan>
        <tspan> of {total} reachable fractions lit</tspan>
        <tspan className="pct"> · {pct >= 10 || pct === 0 ? pct.toFixed(pct % 1 ? 1 : 0) : pct.toFixed(2)}%</tspan>
      </text>
      <text x={VB_W / 2} y={AXIS + 76} className="sub">
        {outcome
          ? k === depth
            ? `Final fraction ${label(node)} after ${depth} flips`
            : `${outcome === 'cashed' ? 'Cashed out' : 'Ended'} at ${label(node)} after ${k} of ${depth} flips`
          : k === 0
            ? `${depth} coin flips from 1/1 · ${span} equally likely endings`
            : `${depth - k} flip${depth - k === 1 ? '' : 's'} left · ${span} endings below ${label(node)}`}
      </text>
    </svg>
  );
}
