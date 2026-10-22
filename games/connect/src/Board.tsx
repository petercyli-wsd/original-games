import { useRef } from 'react';
import { components, type Edge, type OpenPair, type Side } from './math';

const W = 400;
const C = { x: 200, y: 172 };
const R = 138;
const STRIP = { x: 20, y: 352, w: 360, h: 24 };
const PIPS = { x: 20, y: 424, w: 360 };

/** Colours for the groups, largest first. Single nodes stay grey. */
const GROUP = ['var(--accent)', '#ffd6a5', '#b8c0ff', '#ffafcc', '#fdffb6'];

const node = (i: number, n: number) => {
  const a = (i / n) * 2 * Math.PI;
  return { x: C.x + R * Math.sin(a), y: C.y - R * Math.cos(a) };
};

export interface BoardProps {
  side: Side;
  n: number;
  /** Edge budget. */
  E: number;
  edges: readonly Edge[];
  /** The open pairs as drawn on the strip (cross pairs first). */
  open: readonly OpenPair[];
  /** The strip cell the next edge was drawn from, while it is being placed. */
  pick: number | null;
  /** The picked edge is being drawn on the circle. */
  drawing: boolean;
  cursorMs: number;
  drawMs: number;
  live: boolean;
}

export default function Board({ side, n, E, edges, open, pick, drawing, cursorMs, drawMs, live }: BoardProps) {
  const comp = components(n, edges);
  const sizes = new Map<number, number>();
  for (const c of comp) sizes.set(c, (sizes.get(c) ?? 0) + 1);
  const groups = [...sizes.entries()].filter(([, s]) => s > 1).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const colour = (i: number) => {
    const g = groups.findIndex(([c]) => c === comp[i]);
    return g < 0 ? null : GROUP[g % GROUP.length];
  };
  const k = sizes.size;
  const cross = open.filter((p) => p.cross).length;
  const m = edges.length;
  const left = E - m;
  const cell = STRIP.w / Math.max(1, open.length);
  const gap = cell > 5 ? 1.5 : 0.75;
  const picked = pick !== null ? open[pick] : null;
  const swing = side === 'connect' ? 'good' : 'bad';
  const pip = Math.min(24, PIPS.w / E);
  // The pointer stays where the last edge was drawn and slides to the next pick.
  const lastX = useRef(STRIP.x + 6);
  if (pick !== null) lastX.current = STRIP.x + (pick + 0.5) * cell;
  if (!live) lastX.current = STRIP.x + 6;
  const cursorX = lastX.current;

  return (
    <svg viewBox={`0 0 ${W} 460`} className={`cx ${swing}`} role="img" aria-label={`${k} groups, ${m} of ${E} edges, ${cross} of ${open.length} open pairs join two groups`}>
      {/* Every open pair is a possible next edge. Those joining two groups are coloured. */}
      <g className="open">
        {open.map((p, i) => {
          const a = node(p.a, n);
          const b = node(p.b, n);
          return <line key={`${p.a}-${p.b}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={(p.cross ? 'cross' : 'inner') + (i === pick ? ' picked' : '')} />;
        })}
      </g>

      <g className="edges">
        {edges.map(([a, b]) => {
          const pa = node(a, n);
          const pb = node(b, n);
          return <line key={`${a}-${b}`} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke={colour(a) ?? 'var(--muted)'} />;
        })}
        {picked && drawing && (
          <line
            key={`new-${picked.a}-${picked.b}`}
            className="new"
            x1={node(picked.a, n).x}
            y1={node(picked.a, n).y}
            x2={node(picked.b, n).x}
            y2={node(picked.b, n).y}
            pathLength={1}
            style={{ animationDuration: `${drawMs}ms` }}
          />
        )}
      </g>

      {Array.from({ length: n }, (_, i) => {
        const { x, y } = node(i, n);
        const c = colour(i);
        const hot = picked && (picked.a === i || picked.b === i);
        return <circle key={i} cx={x} cy={y} r={hot ? 13 : 11} className={'node' + (c ? ' grouped' : '') + (hot ? ' hot' : '')} style={c ? { fill: c } : undefined} />;
      })}

      <text x={C.x} y={C.y - 6} className="big">
        {k}
      </text>
      <text x={C.x} y={C.y + 16} className="small">
        {k === 1 ? 'group: connected' : 'groups'}
      </text>

      {/* The next edge is a uniform pick among these cells. */}
      <text x={STRIP.x} y={STRIP.y - 10} className="lbl">
        {live || m === 0 ? `Next edge · ${open.length} open pairs` : `${open.length} pairs never drawn`}
      </text>
      <text x={STRIP.x + STRIP.w} y={STRIP.y - 10} className={'lbl strong end ' + swing}>
        {k === 1 ? 'all joined' : `${cross} join two groups`}
      </text>
      <rect x={STRIP.x - 2} y={STRIP.y - 2} width={STRIP.w + 4} height={STRIP.h + 4} rx={5} className="strip-bg" />
      {open.map((p, i) => (
        <rect
          key={`${p.a}-${p.b}`}
          x={STRIP.x + i * cell + gap / 2}
          y={STRIP.y}
          width={Math.max(0.5, cell - gap)}
          height={STRIP.h}
          rx={1.5}
          className={'cell ' + (p.cross ? 'cross' : 'inner') + (i === pick ? ' picked' : '')}
        />
      ))}
      <g className={'cursor' + (live ? '' : ' off')} style={{ transform: `translateX(${cursorX}px)`, transitionDuration: `${pick !== null ? cursorMs : 0}ms` }}>
        <path d={`M -6 ${STRIP.y + STRIP.h + 11} L 6 ${STRIP.y + STRIP.h + 11} L 0 ${STRIP.y + STRIP.h + 3} Z`} />
      </g>

      {/* Budget: one pip per edge. */}
      <text x={PIPS.x} y={PIPS.y - 14} className="lbl">
        Edges {m} of {E}
      </text>
      <text x={PIPS.x + PIPS.w} y={PIPS.y - 14} className={'lbl end' + (k > 1 && k - 1 >= left ? ' tight' : '')}>
        {k === 1 ? 'connected' : `${k - 1} merge${k - 1 === 1 ? '' : 's'} needed · ${left} edge${left === 1 ? '' : 's'} left`}
      </text>
      {Array.from({ length: E }, (_, i) => (
        <rect
          key={i}
          x={PIPS.x + i * pip + 1}
          y={PIPS.y}
          width={pip - 2}
          height={14}
          rx={3}
          className={'pip' + (i < m ? ' used' : '') + (i === m && drawing ? ' next' : '')}
        />
      ))}
    </svg>
  );
}
