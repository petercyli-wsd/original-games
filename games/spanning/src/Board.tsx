import { fmtChance } from '@originals/game-sdk/ui';
import { chainFactors, grid, marginal, pickChance, type Pick, type TreeState } from './math';

export const LETTERS = ['A', 'B', 'C'];
const W = 440;
const GRID_TOP = 56;
const GRID_H = 210;
const BAR_X = 96;
const BAR_W = 270;
const ROW_H = 30;

export interface BoardProps {
  state: TreeState;
  picks: Pick[];
  /** Picks can be toggled by tapping edges (idle). */
  editable: boolean;
  onToggle(edge: number): void;
  /** The edge being revealed right now. */
  flash: number | null;
  /** Show the sweep's next layer. */
  live: boolean;
  outcome: 'win' | 'lose' | 'cashed' | null;
}

const pct = (p: number) => (p >= 1 ? '100%' : p <= 0 ? '0%' : p < 0.1 ? `${(p * 100).toFixed(1)}%` : `${Math.round(p * 100)}%`);

export default function Board({ state, picks, editable, onToggle, flash, live, outcome }: BoardProps) {
  const g = grid(state.size);
  const s = Math.min(300 / (g.cols - 1), GRID_H / (g.rows - 1), 110);
  const x0 = (W - s * (g.cols - 1)) / 2;
  const y0 = GRID_TOP + (GRID_H - s * (g.rows - 1)) / 2;
  const at = (v: number) => ({ x: x0 + (v % g.cols) * s, y: y0 + Math.floor(v / g.cols) * s });

  const marg = g.edges.map((_, e) => marginal(state, e));
  const pickOf = new Map(picks.map((p, i) => [p.edge, { ...p, i }]));
  const factors = chainFactors(state, picks);
  let cum = 1;
  const cums = factors.map((f) => (cum *= f));
  const win = picks.length ? cums[cums.length - 1] : 0;

  const nextLayer = live && state.next < g.edges.length ? g.edges[state.next].layer : null;
  const funnelTop = GRID_TOP + GRID_H + 34;
  const rows = Math.max(1, picks.length);
  const H = funnelTop + 22 + rows * ROW_H + 4;

  // The sweep band: a row of horizontal edges, or the rungs between two rows.
  let band: { y: number; h: number; label: string } | null = null;
  if (nextLayer !== null) {
    const r = Math.floor(nextLayer / 2);
    const y = y0 + r * s;
    band = nextLayer % 2 === 0 ? { y: y - 16, h: 32, label: `row ${r + 1}` } : { y: y + 12, h: s - 24, label: 'rungs' };
  }

  // A backed edge is settled once revealed, or once it is forced (chance 0 or 1).
  const chance = (p: Pick) => pickChance(state, p);
  const settled = (p: Pick) => state.status[p.edge] !== null || chance(p) === 0 || chance(p) === 1;
  const good = (p: Pick) => (state.status[p.edge] !== null ? state.status[p.edge] === p.want : chance(p) === 1);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="span-board" role="img" aria-label={`Spanning tree on a ${g.rows} by ${g.cols} grid, win chance ${pct(win)}`}>
      <text x={W / 2} y={16} className="legend">
        Edge width = its chance to be in the tree
      </text>

      {band && (
        <g className="sweep">
          <rect x={x0 - 30} y={band.y} width={s * (g.cols - 1) + 60} height={band.h} rx={10} />
          <text x={x0 - 36} y={band.y + band.h / 2 + 4} className="sweep-label">
            next
          </text>
        </g>
      )}

      {/* Edges: width is the live marginal. Decided edges are solid (IN) or ghosted (OUT). */}
      {g.edges.map((ed, e) => {
        const a = at(ed.u);
        const b = at(ed.v);
        const st = state.status[e];
        const pk = pickOf.get(e);
        const w = 2 + 11 * marg[e];
        const halo = pk ? (settled(pk) ? (good(pk) ? 'good' : 'bad') : 'held') : null;
        return (
          <g key={e} className={'edge ' + (st ?? 'open') + (flash === e ? ' flash' : '')}>
            {halo && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={'halo ' + halo} strokeWidth={w + 10} />}
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="wire" strokeWidth={st === 'out' ? 2 : w} />
            {editable && (
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="hit" onClick={() => onToggle(e)}>
                <title>{`${pct(marg[e])} chance to be in the tree`}</title>
              </line>
            )}
          </g>
        );
      })}

      {Array.from({ length: g.n }, (_, v) => {
        const { x, y } = at(v);
        return <circle key={v} cx={x} cy={y} r={6} className="dot" />;
      })}

      {/* Badges on backed edges: letter, and the edge's own live chance. */}
      {picks.map((p, i) => {
        const ed = g.edges[p.edge];
        const a = at(ed.u);
        const b = at(ed.v);
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const c = chance(p);
        const cls = 'badge ' + p.want + (settled(p) ? (good(p) ? ' good' : ' bad') : '');
        const tx = ed.horizontal ? mx : mx + 15;
        const ty = ed.horizontal ? my - 17 : my + 4;
        return (
          <g key={p.edge} className={cls} onClick={editable ? () => onToggle(p.edge) : undefined}>
            <circle cx={mx} cy={my} r={11} />
            <text x={mx} y={my + 4.5} className="letter">
              {LETTERS[i]}
            </text>
            <text x={tx} y={ty} className="tag" textAnchor={ed.horizontal ? 'middle' : 'start'}>
              {p.want} {pct(c)}
            </text>
          </g>
        );
      })}

      {/* The funnel: P(A) · P(B | A) · P(C | A, B). The last bar is the win chance. */}
      <g className="funnel" transform={`translate(0 ${funnelTop})`}>
        <text x={BAR_X} y={0} className="f-head">
          {picks.length ? 'Chance your edges all come good' : 'Tap edges to back them IN, tap again for OUT'}
        </text>
        {picks.length > 0 && (
          <text x={BAR_X + BAR_W} y={0} className={'f-total' + (outcome === 'lose' ? ' bad' : '')} textAnchor="end">
            {fmtChance(win)}
          </text>
        )}
        {picks.map((p, i) => {
          const y = 12 + i * ROW_H;
          const last = i === picks.length - 1;
          return (
            <g key={p.edge}>
              <text x={BAR_X - 10} y={y + 13} className="f-label" textAnchor="end">
                {i > 0 ? 'and ' : ''}
                {LETTERS[i]} {p.want}
              </text>
              <rect x={BAR_X} y={y} width={BAR_W} height={18} rx={5} className="f-track" />
              <rect x={BAR_X} y={y} width={Math.max(0, cums[i] * BAR_W)} height={18} rx={5} className={'f-fill' + (last ? ' last' : '')} />
              <text x={BAR_X + BAR_W + 8} y={y + 13} className="f-pct">
                {i === 0 ? pct(factors[i]) : `×${pct(factors[i])}`}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
