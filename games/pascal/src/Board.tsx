import { crossing, downRightChance, inGate, rowOf, waysIn, waysOut, type Gate, type Pos } from './math';

export type Phase = 'idle' | 'stepping' | 'checkpoint' | 'over';
export type Outcome = 'through' | 'missed' | 'locked' | 'unreachable' | 'cashed';

const W = 400;
const CX = W / 2;
/** Diamond extent (tile tip to tile tip), both ways. */
const D = 336;
const TOP = 10;
const BAR_Y = TOP + D + 34;
export const VIEW_H = BAR_Y + 46;

const fmtCount = (x: number) => x.toLocaleString('en-US');

export interface BoardProps {
  svgRef?: (el: SVGSVGElement | null) => void;
  n: number;
  gate: Gate;
  /** Where the walker is drawn (it glides there). */
  walker: Pos;
  /** Tiles visited after the start, in order, up to the walker. */
  trail: Pos[];
  phase: Phase;
  outcome: Outcome | null;
  stepMs: number;
  /** Tiles can be clicked to move the gate (idle or over). */
  onPick?: (tile: Pos) => void;
}

export default function Board({ svgRef, n, gate, walker, trail, phase, outcome, stepMs, onPick }: BoardProps) {
  const s = D / (2 * (n + 1));
  const h = s - Math.max(1.2, s * 0.05);
  const at = (p: Pos) => ({ x: CX + (p.a - p.b) * s, y: TOP + s + (p.a + p.b) * s });
  const wRow = rowOf(walker);
  const total = waysOut(n, walker);
  const live = phase === 'stepping' || phase === 'checkpoint';
  const visited = new Set(trail.map((p) => `${p.a},${p.b}`));
  const ended = phase === 'over';

  // The crossing bar: every remaining path, split by where it crosses the gate row.
  const bar = crossing(n, walker, gate.row).filter((c) => c.count > 0);
  const barTotal = bar.reduce((acc, c) => acc + c.count, 0);
  const green = bar.filter((c) => inGate(gate, c.tile)).reduce((acc, c) => acc + c.count, 0);
  const p = barTotal ? green / barTotal : 0;

  // Next-step odds (the moves left in the "deck").
  const qR = downRightChance(n, walker);
  const leftR = n - walker.a;
  const leftL = n - walker.b;
  const showOdds = wRow < 2 * n && !(ended && outcome !== 'cashed');

  const tiles: JSX.Element[] = [];
  for (let row = 0; row <= 2 * n; row++) {
    for (let a = Math.max(0, row - n); a <= Math.min(row, n); a++) {
      const v = { a, b: row - a };
      const { x, y } = at(v);
      const key = `${a},${v.b}`;
      const isWalker = v.a === walker.a && v.b === walker.b;
      let cls = 'tile';
      let label: number | null = null;
      let heat = 0;
      if (row < gate.row) {
        if (row <= wRow) {
          cls += row === 0 || visited.has(key) ? ' visited' : ' past';
        } else {
          const inW = waysIn(walker, v);
          if (inW > 0) {
            label = inW;
            heat = (inW * waysOut(n, v)) / total;
            cls += ' live';
          } else cls += ' dead';
        }
      } else if (row === gate.row) {
        const inW = waysIn(walker, v);
        const g = inGate(gate, v);
        cls += g ? ' gate' : ' miss';
        if (inW > 0) label = inW * waysOut(n, v);
        else cls += ' dead';
        if (ended && isWalker) cls += g ? ' hit' : ' fail';
      } else {
        cls += ' after';
        label = waysOut(n, v);
      }
      const pick = onPick && row > 0 && row < 2 * n ? () => onPick(v) : undefined;
      const digits = label === null ? 1 : String(label).length;
      const fs = Math.min(0.52 * s, (2 * h) / (0.62 * digits + 1.1));
      tiles.push(
        <g key={key} className={cls + (pick ? ' pickable' : '')} onClick={pick}>
          <path d={`M ${x} ${y - h} L ${x + h} ${y} L ${x} ${y + h} L ${x - h} ${y} Z`} />
          {heat > 0 && !cls.includes('gate') && !cls.includes('miss') && (
            <path className="heat" d={`M ${x} ${y - h} L ${x + h} ${y} L ${x} ${y + h} L ${x - h} ${y} Z`} style={{ fillOpacity: 0.07 + 0.5 * Math.sqrt(heat) }} />
          )}
          {label !== null && !isWalker && (
            <text x={x} y={y} className="num" style={{ fontSize: fs }} dy="0.35em">
              {label}
            </text>
          )}
          {pick && <title>{`Put the gate on row ${row}`}</title>}
        </g>,
      );
    }
  }

  // The path so far, from the start tile.
  const pts = [{ a: 0, b: 0 }, ...trail].map(at);
  const settled = pts.slice(0, Math.max(1, pts.length - 1));
  const last = pts.length > 1 ? [pts[pts.length - 2], pts[pts.length - 1]] : null;
  const wp = at(walker);

  // The gate row's edges, for the finish-line markers.
  const rowY = at({ a: gate.row, b: 0 }).y;
  const halfRow = (Math.min(gate.row, 2 * n - gate.row) + 1) * s;

  // Bar segments.
  const BX = 24;
  const BW = W - 2 * BX;
  let cursor = BX;
  const segs = bar.map((c) => {
    const w = (c.count / barTotal) * BW;
    const seg = { x: cursor, w, c, g: inGate(gate, c.tile) };
    cursor += w;
    return seg;
  });

  const deck = (side: 'L' | 'R') => {
    const left = side === 'L';
    const chance = left ? 1 - qR : qR;
    const remaining = left ? leftL : leftR;
    const x0 = left ? 14 : W - 14;
    const pip = Math.min(11, 92 / n);
    return (
      <g className={'deck' + (left ? '' : ' right')}>
        <text x={x0} y={22} className="cap">
          {left ? '↙ NEXT STEP' : 'NEXT STEP ↘'}
        </text>
        <text x={x0} y={48} className={'odds' + (showOdds && live ? '' : ' quiet')}>
          {showOdds ? `${Math.round(chance * 1000) / 10}%` : '—'}
        </text>
        {Array.from({ length: n }, (_, i) => {
          const cx = left ? x0 + 4 + i * pip : x0 - 4 - i * pip;
          const on = i < remaining;
          const r = pip * 0.36;
          return <path key={i} className={'pip' + (on ? ' on' : '')} d={`M ${cx} ${62 - r} L ${cx + r} ${62} L ${cx} ${62 + r} L ${cx - r} ${62} Z`} />;
        })}
        <text x={x0} y={84} className="small">
          {remaining} of {n} {left ? '↙' : '↘'} left
        </text>
      </g>
    );
  };

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${VIEW_H}`} className="pascal" role="img" aria-label={`Pascal board: ${fmtCount(green)} of ${fmtCount(barTotal)} paths pass the gate`}>
      {deck('L')}
      {deck('R')}

      {/* Finish-line stubs either side of the gate row. */}
      <g className="gate-line">
        <line x1={CX - halfRow - 18} x2={CX - halfRow - 3} y1={rowY} y2={rowY} />
        <line x1={CX + halfRow + 3} x2={CX + halfRow + 18} y1={rowY} y2={rowY} />
        <path d={`M ${CX - halfRow - 3} ${rowY} l -7 -5 v 10 Z`} />
        <path d={`M ${CX + halfRow + 3} ${rowY} l 7 -5 v 10 Z`} />
      </g>

      <g className="tiles">{tiles}</g>

      <polyline className="trail" points={settled.map((q) => `${q.x},${q.y}`).join(' ')} />
      {last && (
        <line
          key={pts.length}
          className="trail fresh"
          x1={last[0].x}
          y1={last[0].y}
          x2={last[1].x}
          y2={last[1].y}
          style={{ animationDuration: `${stepMs}ms`, strokeDasharray: `${s * 1.5}px`, ['--len' as string]: `${s * 1.5}px` }}
        />
      )}

      {/* Next-step arrows: thickness is the chance. */}
      {live && showOdds && phase === 'checkpoint' && (
        <g className="arrows">
          {leftL > 0 && <line x1={wp.x} y1={wp.y} x2={wp.x - s * 0.82} y2={wp.y + s * 0.82} style={{ strokeWidth: 1 + 6 * (1 - qR) }} />}
          {leftR > 0 && <line x1={wp.x} y1={wp.y} x2={wp.x + s * 0.82} y2={wp.y + s * 0.82} style={{ strokeWidth: 1 + 6 * qR }} />}
        </g>
      )}

      <g className={'walker' + (ended ? ` ${outcome}` : '')} style={{ transform: `translate(${wp.x}px, ${wp.y}px)`, transitionDuration: `${stepMs}ms` }}>
        <circle r={Math.max(6, s * 0.42)} />
      </g>

      {/* Bottom corners: what the numbers count. */}
      <g className="legend">
        <text x={14} y={TOP + D - 30} className="cap">
          PATH COUNTS
        </text>
        <text x={14} y={TOP + D - 14}>
          <tspan className="k-in">■</tspan> above: ways in
        </text>
        <text x={14} y={TOP + D + 2}>
          <tspan className="k-gate">■</tspan> gate: in × out
        </text>
        <text x={W - 14} y={TOP + D + 2} className="end">
          below: ways out <tspan className="k-out">■</tspan>
        </text>
      </g>

      {/* The crossing bar: its green share is the chance to win. */}
      <g className="bar">
        <text x={BX} y={BAR_Y - 9} className="cap">
          PATHS CROSSING ROW {gate.row}
        </text>
        <text x={W - BX} y={BAR_Y - 9} className="cap end">
          <tspan className="g">{fmtCount(green)}</tspan> OF {fmtCount(barTotal)} PATHS
        </text>
        {segs.map(({ x, w, c, g }) => (
          <g key={c.a} className={'seg' + (g ? ' g' : '')}>
            <rect x={x + 0.6} y={BAR_Y} width={Math.max(0.5, w - 1.2)} height={16} rx={3} />
            {w > String(c.count).length * 6.4 + 6 && (
              <text x={x + w / 2} y={BAR_Y + 8} dy="0.35em">
                {c.count}
              </text>
            )}
          </g>
        ))}
        <text x={CX} y={BAR_Y + 34} className={'share' + (p === 0 ? ' zero' : '')}>
          {p === 0
            ? 'No path from here passes your gate'
            : p === 1
              ? 'Every path from here passes your gate'
              : `${(p * 100).toFixed(p < 0.01 ? 2 : 1)}% of the paths from ${wRow === 0 ? 'the start' : 'here'} pass your gate`}
        </text>
      </g>
    </svg>
  );
}
