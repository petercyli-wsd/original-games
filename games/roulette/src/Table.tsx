// The betting table as one SVG. Geometry lives in a "horizontal" unit frame
// (zero on the left, three rows of numbers, columns' "2:1" on the right,
// dozens and even-money bets underneath) and is mapped to pixels either
// as-is (wide frames) or rotated a quarter turn (narrow frames, zero on top).
// Inside bets that straddle lines (splits, streets, corners, six lines, the
// zero trios and first four) are invisible hot spots on those lines.

import { memo, type MouseEvent, type ReactNode } from 'react';
import { SPOT_BY_ID, colourOf, insideId, type Layout } from './math';

export type Orientation = 'h' | 'v';

const H = { u: 60, v: 56 }; // px per unit in the horizontal frame
const V = { u: 40, v: 78 }; // vertical frame: unit x → Y px, unit y → X px
const PAD = 4;
const DEPTH = 4.5; // rows of numbers (3) + dozens + even money

interface Pt {
  x: number;
  y: number;
}
const map = (o: Orientation, x: number, y: number): Pt => (o === 'h' ? { x: x * H.u, y: y * H.v } : { x: (DEPTH - y) * V.v, y: x * V.u });
function mapRect(o: Orientation, x0: number, y0: number, x1: number, y1: number) {
  const a = map(o, x0, y0);
  const b = map(o, x1, y1);
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}
export const viewBoxOf = (o: Orientation) => {
  const w = o === 'h' ? 14 * H.u : DEPTH * V.v;
  const h = o === 'h' ? DEPTH * H.v : 14 * V.u;
  return { box: `${-PAD} ${-PAD} ${w + 2 * PAD} ${h + 2 * PAD}`, w: w + 2 * PAD, h: h + 2 * PAD };
};

/** Column (0–11) and row (0 = top: 3, 6, …) of a number in the horizontal frame. */
const cellOf = (n: number) => ({ c: Math.floor((n - 1) / 3), r: 2 - ((n - 1) % 3) });

interface Cell {
  id: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  label: ReactNode;
  cls: string;
  nums: number[];
}

interface Hot {
  id: string;
  cx: number;
  cy: number;
  w: number;
  h: number;
}

const CELLS: Cell[] = (() => {
  const cells: Cell[] = [];
  for (let n = 1; n <= 36; n++) {
    const { c, r } = cellOf(n);
    cells.push({ id: insideId('straight', [n]), x0: 1 + c, y0: r, x1: 2 + c, y1: r + 1, label: n, cls: 'num ' + colourOf(n), nums: [n] });
  }
  // "2:1" column bets: top row is column 3 (3, 6, … 36).
  for (const r of [0, 1, 2]) {
    const k = 3 - r;
    cells.push({ id: `column:${k}`, x0: 13, y0: r, x1: 14, y1: r + 1, label: '2:1', cls: 'out col', nums: SPOT_BY_ID[`column:${k}`].nums });
  }
  const dz = ['1st 12', '2nd 12', '3rd 12'];
  for (const d of [0, 1, 2]) {
    cells.push({ id: `dozen:${d + 1}`, x0: 1 + 4 * d, y0: 3, x1: 5 + 4 * d, y1: 3.75, label: dz[d], cls: 'out dozen', nums: SPOT_BY_ID[`dozen:${d + 1}`].nums });
  }
  const evens: [string, string][] = [
    ['low', '1–18'],
    ['even', 'Even'],
    ['red', ''],
    ['black', ''],
    ['odd', 'Odd'],
    ['high', '19–36'],
  ];
  evens.forEach(([id, label], i) => {
    cells.push({ id, x0: 1 + 2 * i, y0: 3.75, x1: 3 + 2 * i, y1: DEPTH, label, cls: 'out even ' + id, nums: SPOT_BY_ID[id].nums });
  });
  return cells;
})();

const HOTS: Hot[] = (() => {
  const hots: Hot[] = [];
  const S = 0.26; // thin side of an edge spot
  const L = 0.62; // long side
  const C = 0.3; // corner spot
  for (let n = 1; n <= 36; n++) {
    const { c, r } = cellOf(n);
    if (n <= 33) hots.push({ id: insideId('split', [n, n + 3]), cx: 2 + c, cy: r + 0.5, w: S, h: L });
    if (n % 3 !== 0) hots.push({ id: insideId('split', [n, n + 1]), cx: 1.5 + c, cy: r, w: L, h: S });
    if (n % 3 !== 0 && n <= 32) hots.push({ id: insideId('corner', [n, n + 1, n + 3, n + 4]), cx: 2 + c, cy: r, w: C, h: C });
  }
  for (let c = 0; c < 12; c++) hots.push({ id: insideId('street', [3 * c + 1, 3 * c + 2, 3 * c + 3]), cx: 1.5 + c, cy: 3, w: L, h: S });
  for (let c = 0; c < 11; c++) hots.push({ id: insideId('line', [3 * c + 1, 3 * c + 2, 3 * c + 3, 3 * c + 4, 3 * c + 5, 3 * c + 6]), cx: 2 + c, cy: 3, w: C, h: C });
  for (const n of [1, 2, 3]) hots.push({ id: insideId('split', [0, n]), cx: 1, cy: cellOf(n).r + 0.5, w: S, h: L });
  hots.push({ id: insideId('trio', [0, 1, 2]), cx: 1, cy: 2, w: C, h: C });
  hots.push({ id: insideId('trio', [0, 2, 3]), cx: 1, cy: 1, w: C, h: C });
  hots.push({ id: insideId('basket', [0, 1, 2, 3]), cx: 1, cy: 3, w: C, h: C });
  return hots;
})();

/** Where a spot's chips sit, in unit coordinates. */
const CENTRES: Record<string, { x: number; y: number }> = (() => {
  const m: Record<string, { x: number; y: number }> = { 'straight:0': { x: 0.55, y: 1.5 } };
  for (const c of CELLS) m[c.id] = { x: (c.x0 + c.x1) / 2, y: (c.y0 + c.y1) / 2 };
  for (const h of HOTS) m[h.id] = { x: h.cx, y: h.cy };
  return m;
})();

const CHIP_COLOURS: [number, string][] = [
  [1, '#64748b'],
  [5, '#2563eb'],
  [10, '#7c3aed'],
  [25, '#ea580c'],
  [100, '#059669'],
  [500, '#27272a'],
  [1000, '#b45309'],
  [Infinity, '#db2777'],
];
export const chipColour = (v: number) => CHIP_COLOURS.find(([lim]) => v < lim - 1e-9)![1];

/** 0.5 → "0.5", 12.5 → "12.5", 2500 → "2.5K". */
export function fmtChip(v: number): string {
  if (v >= 1e6) return `${Number((v / 1e6).toFixed(1))}M`;
  if (v >= 1000) return `${Number((v / 1000).toFixed(v >= 1e4 ? 0 : 1))}K`;
  if (v >= 100) return String(Math.round(v));
  if (v >= 10) return String(Number(v.toFixed(1)));
  return String(Number(v.toFixed(2)));
}

export function ChipDisc({ value, r = 13, className }: { value: number; r?: number; className?: string }) {
  const label = fmtChip(value);
  const fs = label.length <= 2 ? r * 0.82 : label.length === 3 ? r * 0.68 : r * 0.56;
  return (
    <g className={'rl-chip' + (className ? ' ' + className : '')}>
      <circle r={r} fill={chipColour(value)} />
      <circle r={r - 1.6} className="edge" strokeDasharray={`${((r - 1.6) * Math.PI) / 6} ${((r - 1.6) * Math.PI) / 6}`} />
      <circle r={r * 0.66} className="face" fill={chipColour(value)} />
      <text dy="0.36em" fontSize={fs}>
        {label}
      </text>
    </g>
  );
}

interface TableProps {
  orientation: Orientation;
  layout: Layout;
  highlight: Set<number>;
  winner: number | null;
  /** Spots that won on the last spin (null while no result is shown). */
  winners: Set<string> | null;
  disabled: boolean;
  onAdd(id: string): void;
  onRemove(id: string): void;
  onHover(nums: number[] | null): void;
}

const Static = memo(function Static({ o }: { o: Orientation }) {
  const zero = [
    [1, 0],
    [0.4, 0],
    [0.06, 1.5],
    [0.4, 3],
    [1, 3],
  ]
    .map(([x, y]) => map(o, x, y))
    .map((p) => `${p.x},${p.y}`)
    .join(' ');
  const zc = map(o, 0.55, 1.5);
  return (
    <>
      <polygon points={zero} className="rl-cell num green" data-cell="0" />
      <text x={zc.x} y={zc.y} dy="0.36em" className="rl-cell-t big">
        0
      </text>
      {CELLS.map((c) => {
        const r = mapRect(o, c.x0, c.y0, c.x1, c.y1);
        const cx = r.x + r.w / 2;
        const cy = r.y + r.h / 2;
        const isColour = c.id === 'red' || c.id === 'black';
        return (
          <g key={c.id} data-cell={c.nums.length === 1 ? c.nums[0] : c.id}>
            <rect x={r.x} y={r.y} width={r.w} height={r.h} className={'rl-cell ' + c.cls} />
            {isColour ? (
              <path className={'rl-diamond ' + c.id} d={`M${cx} ${cy - 13}L${cx + 20} ${cy}L${cx} ${cy + 13}L${cx - 20} ${cy}Z`} />
            ) : (
              <text x={cx} y={cy} dy="0.36em" className={'rl-cell-t' + (c.nums.length === 1 ? ' big' : '')}>
                {c.label}
              </text>
            )}
          </g>
        );
      })}
    </>
  );
});

export function Table({ orientation: o, layout, highlight, winner, winners, disabled, onAdd, onRemove, onHover }: TableProps) {
  const vb = viewBoxOf(o);
  const zeroLit = highlight.has(0);

  const handlers = (id: string) => ({
    'data-spot': id,
    onClick: (e: MouseEvent) => (e.shiftKey ? onRemove(id) : onAdd(id)),
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault();
      onRemove(id);
    },
    onPointerEnter: () => onHover(SPOT_BY_ID[id].nums),
    onPointerLeave: () => onHover(null),
  });

  const zeroPts = [
    [1, 0],
    [0.4, 0],
    [0.06, 1.5],
    [0.4, 3],
    [1, 3],
  ]
    .map(([x, y]) => map(o, x, y))
    .map((p) => `${p.x},${p.y}`)
    .join(' ');

  const chipIds = Object.keys(layout).filter((id) => layout[id] > 0 && CENTRES[id]);

  return (
    <svg className={`rl-table ${o}` + (disabled ? ' locked' : '')} viewBox={vb.box} style={{ aspectRatio: `${vb.w} / ${vb.h}` }} role="group" aria-label="Betting table">
      <Static o={o} />

      {/* Lit numbers: hover preview and the winning number. */}
      {zeroLit && <polygon points={zeroPts} className="rl-lit" />}
      {[...highlight].filter((n) => n > 0).map((n) => {
        const { c, r } = cellOf(n);
        const R = mapRect(o, 1 + c, r, 2 + c, r + 1);
        return <rect key={n} x={R.x} y={R.y} width={R.w} height={R.h} className="rl-lit" />;
      })}
      {winner !== null &&
        (winner === 0 ? (
          <polygon points={zeroPts} className="rl-win" />
        ) : (
          (() => {
            const { c, r } = cellOf(winner);
            const R = mapRect(o, 1 + c, r, 2 + c, r + 1);
            return <rect x={R.x + 2} y={R.y + 2} width={R.w - 4} height={R.h - 4} rx={6} className="rl-win" />;
          })()
        ))}

      {/* Click targets: whole cells first, then the line hot spots above them. */}
      <polygon points={zeroPts} className="rl-hit" aria-label="Straight 0" {...handlers('straight:0')} />
      {CELLS.map((c) => {
        const r = mapRect(o, c.x0, c.y0, c.x1, c.y1);
        return <rect key={c.id} x={r.x} y={r.y} width={r.w} height={r.h} className="rl-hit" aria-label={SPOT_BY_ID[c.id].name} {...handlers(c.id)} />;
      })}
      {HOTS.map((h) => {
        const r = mapRect(o, h.cx - h.w / 2, h.cy - h.h / 2, h.cx + h.w / 2, h.cy + h.h / 2);
        return <rect key={h.id} x={r.x} y={r.y} width={r.w} height={r.h} rx={4} className="rl-hit hot" aria-label={SPOT_BY_ID[h.id].name} {...handlers(h.id)} />;
      })}

      {/* Chips. */}
      <g className="rl-chips">
        {chipIds.map((id) => {
          const p = map(o, CENTRES[id].x, CENTRES[id].y);
          const state = winners ? (winners.has(id) ? 'won' : 'lost') : '';
          return (
            <g key={id} transform={`translate(${p.x} ${p.y})`} className={'rl-chip-at ' + state}>
              <ChipDisc value={layout[id]} r={o === 'h' ? 14 : 13} />
            </g>
          );
        })}
      </g>
    </svg>
  );
}
