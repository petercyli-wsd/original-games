import { fmtChance } from '@originals/game-sdk/ui';
import { PAIRS, PICK_NAME, RANKINGS, leaderOf, shareBar, type Cand, type Chances, type Margins, type Pick } from './math';

export const COLOR: Record<Pick, string> = { A: '#bde0fe', B: '#ffafcc', C: '#ffd6a5', cycle: '#a594f9' };

// Layout, in viewBox units.
const W = 420;
const NODE: Record<Cand, { x: number; y: number }> = { A: { x: 210, y: 62 }, B: { x: 340, y: 222 }, C: { x: 80, y: 222 } };
const NR = 25;
const CX = 210;
const CY = (62 + 222 + 222) / 3;
const BAR_Y = 292;
const BAR_H = 16;
const TILE_Y = 360;
const TILE_H = 44;
const LOW_STRIP_Y = 438;
const HEIGHT = 482;
const X0 = 20;
const SPAN = W - 2 * X0;

export interface SeriesView {
  elections: number;
  /** Elections won so far. */
  won: number;
  /** The election on screen (0-based). */
  current: number;
  lost: boolean;
}

export interface BoardProps {
  pick: Pick;
  voters: number;
  ballots: number[];
  margins: Margins;
  /** Ballots left uncounted because the result was already certain. */
  skipped: number;
  fresh: number | null;
  /** Chances for this election's result (from the counted ballots). */
  chances: Chances;
  /** Your chance this election after each possible next ballot, or null when counting is closed. */
  tiles: number[] | null;
  series: SeriesView;
  note: string | null;
  barTitle: string;
  revealMs: number;
}

function Arrow({ x, y, ux, uy, color }: { x: number; y: number; ux: number; uy: number; color: string }) {
  const bx = x - ux * 14;
  const by = y - uy * 14;
  const px = -uy * 7.5;
  const py = ux * 7.5;
  return <polygon points={`${x},${y} ${bx + px},${by + py} ${bx - px},${by - py}`} fill={color} />;
}

function Edge({ pair, margin, revealMs }: { pair: readonly [Cand, Cand]; margin: number; revealMs: number }) {
  const [p, q] = pair;
  const lead = margin > 0 ? p : margin < 0 ? q : null;
  const from = NODE[lead === q ? q : p];
  const to = NODE[lead === q ? p : q];
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const gap = NR + 7;
  const a = { x: from.x + ux * gap, y: from.y + uy * gap };
  const b = { x: to.x - ux * gap, y: to.y - uy * gap };
  // The label sits just outside the triangle, beside the middle of the edge.
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const ox = mx - CX;
  const oy = my - CY;
  const ol = Math.hypot(ox, oy);
  const lx = mx + (ox / ol) * 22;
  const ly = my + (oy / ol) * 22 + 5;
  const color = lead ? COLOR[lead] : 'var(--muted)';
  const width = lead ? 3 + Math.min(Math.abs(margin), 9) * 0.8 : 2;
  return (
    <g className={'cd-edge' + (lead ? '' : ' tied')} style={{ transitionDuration: `${revealMs}ms` }}>
      <line x1={a.x} y1={a.y} x2={lead ? b.x - ux * 10 : b.x} y2={lead ? b.y - uy * 10 : b.y} stroke={color} strokeWidth={width} />
      {lead && <Arrow x={b.x} y={b.y} ux={ux} uy={uy} color={color} />}
      <text x={lx} y={ly} className="cd-margin" style={{ fill: color }}>
        {lead ? `${lead} +${Math.abs(margin)}` : 'tied'}
      </text>
      <text x={lx} y={ly + 13} className="cd-pair">
        {p} v {q}
      </text>
    </g>
  );
}

/** A ballot: the ranking as three stacked dots, first choice on top. */
function Ballot({ x, y, w, h, ranking, state }: { x: number; y: number; w: number; h: number; ranking: number | null; state: 'counted' | 'fresh' | 'pending' | 'skipped' }) {
  const r = Math.min(5.5, w * 0.3, h / 7.5);
  return (
    <g className={`cd-ballot ${state}`}>
      <rect x={x} y={y} width={w} height={h} rx={Math.min(5, w / 4)} />
      {ranking !== null &&
        RANKINGS[ranking].map((c, i) => <circle key={c} cx={x + w / 2} cy={y + h / 2 + (i - 1) * (h / 3.2)} r={r} fill={COLOR[c]} />)}
      {state === 'skipped' && <line x1={x + w * 0.25} y1={y + h / 2} x2={x + w * 0.75} y2={y + h / 2} />}
    </g>
  );
}

export default function Board({ pick, voters, ballots, margins, skipped, fresh, chances, tiles, series, note, barTitle, revealMs }: BoardProps) {
  const leader = leaderOf(margins);
  const bar = shareBar(chances);
  const mine = chances[pick];
  const stripY = LOW_STRIP_Y;
  const slotW = Math.min(34, SPAN / voters);
  const stripX = X0 + (SPAN - slotW * voters) / 2;
  const tileW = (SPAN - 5 * 4) / 6;
  const counted = ballots.length;

  return (
    <svg viewBox={`0 0 ${W} ${HEIGHT}`} className="cd" role="img" aria-label={`${counted} of ${voters} ballots counted; ${PICK_NAME[pick]} ${fmtChance(mine)}`}>
      {/* Corners: the series and the count. */}
      {series.elections > 1 && (
        <g>
          <text x={14} y={20} className="cd-head">
            ELECTION {series.current + 1} OF {series.elections}
          </text>
          {Array.from({ length: series.elections }, (_, i) => {
            const st = i < series.won ? 'won' : i === series.current ? (series.lost ? 'lost' : 'live') : 'next';
            return <circle key={i} cx={20 + i * 16} cy={34} r={5} className={`cd-pip ${st}`} />;
          })}
        </g>
      )}
      <text x={W - 14} y={20} className="cd-head end">
        {counted} / {voters} BALLOTS
      </text>
      {skipped > 0 && (
        <text x={W - 14} y={36} className="cd-head end soft">
          {skipped} not needed
        </text>
      )}

      {/* The triangle of pairwise majorities. */}
      {PAIRS.map((pair, i) => (
        <Edge key={i} pair={pair} margin={margins[i]} revealMs={revealMs} />
      ))}
      <g className={'cd-centre' + (pick === 'cycle' ? ' mine' : '') + (leader === 'cycle' ? ' on' : '')}>
        <circle cx={CX} cy={CY + 4} r={30} />
        {leader === 'cycle' ? (
          <>
            <path d={`M ${CX + 16} ${CY - 6} A 17 17 0 1 0 ${CX + 17} ${CY + 9}`} className="cd-loop" />
            <polygon points={`${CX + 21},${CY + 1} ${CX + 12},${CY - 3} ${CX + 22},${CY - 12}`} className="cd-loop-head" />
            <text x={CX} y={CY + 9} className="cd-centre-text">
              cycle
            </text>
          </>
        ) : (
          <text x={CX} y={CY + 9} className="cd-centre-text">
            {leader ? `${leader} leads` : counted ? 'tied' : 'no votes'}
          </text>
        )}
      </g>
      {(['A', 'B', 'C'] as const).map((c) => (
        <g key={c} className={'cd-node' + (c === pick ? ' mine' : '') + (leader === c ? ' lead' : '')}>
          {c === pick && <circle cx={NODE[c].x} cy={NODE[c].y} r={NR + 7} className="cd-ring" />}
          <circle cx={NODE[c].x} cy={NODE[c].y} r={NR} fill={COLOR[c]} />
          <text x={NODE[c].x} y={NODE[c].y + 8} className="cd-node-text">
            {c}
          </text>
        </g>
      ))}

      {/* The four ways the election can end, as lengths. */}
      <text x={X0} y={BAR_Y - 9} className="cd-head">
        {barTitle}
      </text>
      <rect x={X0} y={BAR_Y} width={SPAN} height={BAR_H} rx={4} className="cd-bar-bg" />
      {bar.map((s) =>
        s.to - s.from > 0 ? (
          <rect
            key={s.pick}
            x={X0 + s.from * SPAN}
            y={BAR_Y}
            width={(s.to - s.from) * SPAN}
            height={BAR_H}
            fill={COLOR[s.pick]}
            className={'cd-seg' + (s.pick === pick ? ' mine' : '')}
          />
        ) : null,
      )}
      {bar.map((s) =>
        s.pick === pick && s.to > s.from ? (
          <rect key="mine" x={X0 + s.from * SPAN} y={BAR_Y - 2} width={(s.to - s.from) * SPAN} height={BAR_H + 4} rx={3} className="cd-seg-mine" />
        ) : null,
      )}
      {bar.map((s, i) => (
        <g key={s.pick} className={'cd-legend' + (s.pick === pick ? ' mine' : '')}>
          <rect x={X0 + i * 95} y={BAR_Y + 27} width={10} height={10} rx={2} fill={COLOR[s.pick]} />
          <text x={X0 + i * 95 + 15} y={BAR_Y + 36}>
            {s.pick === 'cycle' ? 'Cycle' : s.pick} {fmtChance(chances[s.pick])}
          </text>
        </g>
      ))}

      {/* The six possible next ballots: each 1 in 6, so they average to your chance. */}
      {tiles && (
        <g>
          <text x={X0} y={TILE_Y - 9} className="cd-head">
            NEXT BALLOT (1 in 6 each) → {PICK_NAME[pick].toUpperCase()}
          </text>
          {tiles.map((p, b) => {
            const x = X0 + b * (tileW + 4);
            const tone = p === 0 ? 'dead' : p === 1 ? 'sure' : p > mine + 1e-12 ? 'up' : p < mine - 1e-12 ? 'down' : 'flat';
            return (
              <g key={b} className={`cd-tile ${tone}`}>
                <rect x={x} y={TILE_Y} width={tileW} height={TILE_H} rx={6} />
                {RANKINGS[b].map((c, i) => (
                  <circle key={c} cx={x + 9} cy={TILE_Y + 10 + i * 12} r={4} fill={COLOR[c]} />
                ))}
                <text x={x + 9 + (tileW - 9) / 2 + 2} y={TILE_Y + TILE_H / 2 + 4.5} className="cd-tile-p">
                  {fmtChance(p)}
                </text>
              </g>
            );
          })}
        </g>
      )}

      {/* The ballots of this election. */}
      <text x={X0} y={stripY - 9} className="cd-head">
        BALLOTS (top dot = first choice)
      </text>
      {Array.from({ length: voters }, (_, i) => {
        const state = i < counted ? (i === fresh ? 'fresh' : 'counted') : skipped > 0 ? 'skipped' : 'pending';
        return (
          <Ballot
            key={i}
            x={stripX + i * slotW + 1.5}
            y={stripY}
            w={slotW - 3}
            h={38}
            ranking={i < counted ? ballots[i] : null}
            state={state}
          />
        );
      })}

      {note && !tiles && (
        <text x={W / 2} y={TILE_Y + TILE_H / 2 + 4} className="cd-note">
          {note}
        </text>
      )}
    </svg>
  );
}
