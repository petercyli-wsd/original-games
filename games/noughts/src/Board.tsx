import { fmtChance } from '@originals/game-sdk/ui';
import { LINES, SIDE_NAME, shareBar, type CellChance, type Grid, type Side, type Tally, type Threat } from './math';

// Layout of the board, in viewBox units.
const CELL = 88;
const GAP = 8;
const X0 = 60;
const Y0 = 50;
const SPAN = 3 * CELL + 2 * GAP;
const BAR_Y = Y0 + SPAN + 34;
const BAR_H = 16;
const HEIGHT = BAR_Y + BAR_H + 62;

const cellX = (i: number) => X0 + (i % 3) * (CELL + GAP);
const cellY = (i: number) => Y0 + Math.floor(i / 3) * (CELL + GAP);
const mid = (i: number) => ({ x: cellX(i) + CELL / 2, y: cellY(i) + CELL / 2 });

/** A line through three cells, stretched a little past both ends. */
function lineEnds(line: number, stretch: number) {
  const [a, , c] = LINES[line];
  const p = mid(a);
  const q = mid(c);
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const len = Math.hypot(dx, dy);
  const k = stretch / len;
  return { x1: p.x - dx * k, y1: p.y - dy * k, x2: q.x + dx * k, y2: q.y + dy * k };
}

function MarkGlyph({ mark, x, y, size, fresh }: { mark: 1 | 2; x: number; y: number; size: number; fresh?: boolean }) {
  const r = size / 2;
  if (mark === 1) {
    return (
      <g className={'nt-x' + (fresh ? ' nt-fresh' : '')}>
        <line x1={x - r} y1={y - r} x2={x + r} y2={y + r} pathLength={1} />
        <line x1={x + r} y1={y - r} x2={x - r} y2={y + r} pathLength={1} />
      </g>
    );
  }
  return (
    <g className={'nt-o' + (fresh ? ' nt-fresh' : '')}>
      <circle cx={x} cy={y} r={r * 1.12} pathLength={1} transform={`rotate(-90 ${x} ${y})`} />
    </g>
  );
}

/** A finished, live or upcoming game in the series strip. */
function Mini({ x, y, grid, state, line }: { x: number; y: number; grid: Grid | null; state: 'won' | 'live' | 'next' | 'lost'; line: number | null }) {
  const s = 26;
  const c = s / 3;
  // Top-left corner of cell i, and the middle of it.
  const at = (i: number) => ({ cx: x + (i % 3) * c, cy: y + Math.floor(i / 3) * c });
  const centre = (i: number) => ({ x: at(i).cx + c / 2, y: at(i).cy + c / 2 });
  const pad = 2.4;
  return (
    <g className={`nt-mini ${state}`}>
      <rect x={x} y={y} width={s} height={s} rx={5} />
      {grid?.map((m, i) => {
        if (m === 0) return null;
        const { cx, cy } = at(i);
        return m === 1 ? (
          <g key={i} className="nt-mini-x">
            <line x1={cx + pad} y1={cy + pad} x2={cx + c - pad} y2={cy + c - pad} />
            <line x1={cx + c - pad} y1={cy + pad} x2={cx + pad} y2={cy + c - pad} />
          </g>
        ) : (
          <circle key={i} className="nt-mini-o" cx={centre(i).x} cy={centre(i).y} r={c / 2 - 1.8} />
        );
      })}
      {line !== null && (
        <line className="nt-mini-line" x1={centre(LINES[line][0]).x} y1={centre(LINES[line][0]).y} x2={centre(LINES[line][2]).x} y2={centre(LINES[line][2]).y} />
      )}
      {state === 'next' && (
        <text x={x + s / 2} y={y + s / 2 + 1} className="nt-mini-q">
          ?
        </text>
      )}
    </g>
  );
}

export interface SeriesSlot {
  grid: Grid | null;
  state: 'won' | 'live' | 'next' | 'lost';
  line: number | null;
}

export interface BoardProps {
  grid: Grid;
  side: Side;
  /** One slot per game in the bet (shown when there are several). */
  slots: SeriesSlot[];
  /** Each empty cell's effect on your chance (null hides the numbers). */
  cells: CellChance[] | null;
  /** Your chance this game right now: the average of the cell numbers. */
  base: number;
  /** This game's outcome shares, for the bar. */
  odds: Tally;
  threats: Threat[];
  /** Completed lines on the board. */
  lines: number[];
  /** This game's result, once it has one. */
  result: Side | null;
  /** Whose mark is next, or null when no mark is coming. */
  mover: 1 | 2 | null;
  cursor: number | null;
  fresh: number | null;
  /** Mark-drawing time in ms. */
  drawMs: number;
  /** Scanner glide time in ms. */
  hopMs: number;
  /** Whether to draw the outcome bar (the result card covers it when the round is over). */
  band: boolean;
  /** A note in the header's right corner instead of the mover. */
  note?: string;
}

/** A cell's chance: whole percents, one decimal below 10%. */
function pct(p: number) {
  if (p >= 1) return '100%';
  if (p <= 0) return '0%';
  if (p >= 0.995) return '>99%';
  if (p < 0.001) return '<0.1%';
  return p < 0.1 ? `${(p * 100).toFixed(1)}%` : `${Math.round(p * 100)}%`;
}

export default function Board({ grid, side, slots, cells, base, odds, threats, lines, result, mover, cursor, fresh, drawMs, hopMs, band, note }: BoardProps) {
  const byCell = new Map(cells?.map((c) => [c.cell, c]));
  const bar = shareBar(odds);
  const yours = result === null ? null : result === side;
  const games = slots.length;
  const label = `${SIDE_NAME[side]}: ${fmtChance(base)} this game`;

  return (
    <svg viewBox={`${X0 - 8} 0 ${SPAN + 16} ${HEIGHT}`} className="nt" role="img" aria-label={label} style={{ ['--draw' as string]: `${drawMs}ms`, ['--fade' as string]: `${drawMs}ms` }}>
      {/* Header: the series on the left, whose mark is next on the right. */}
      <g className="nt-head">
        {games > 1 ? (
          slots.map((s, i) => <Mini key={i} x={X0 + i * 34} y={10} grid={s.grid} state={s.state} line={s.line} />)
        ) : (
          <text x={X0} y={28} className="nt-head-text">
            One game
          </text>
        )}
        <text x={X0 + SPAN} y={28} className="nt-head-text end">
          {note ??
            (mover && (
              <>
                Next mark <tspan className={mover === 1 ? 'nt-x-text' : 'nt-o-text'}>{mover === 1 ? 'X' : 'O'}</tspan>
              </>
            ))}
        </text>
      </g>

      {/* Cells, tinted by what a mark there does to your chance. */}
      {grid.map((_, i) => {
        const c = byCell.get(i);
        const delta = c ? c.p - base : 0;
        const tone = !c ? '' : Math.abs(delta) < 1e-9 ? 'even' : delta > 0 ? 'up' : 'down';
        const strength = c ? Math.min(0.5, 0.1 + Math.abs(delta) * 0.75) : 0;
        return (
          <g key={i}>
            <rect x={cellX(i)} y={cellY(i)} width={CELL} height={CELL} rx={12} className="nt-cell" />
            {c && tone !== 'even' && (
              <rect x={cellX(i)} y={cellY(i)} width={CELL} height={CELL} rx={12} className={`nt-tint ${tone}`} style={{ opacity: strength }} />
            )}
          </g>
        );
      })}

      {/* Threats: two in a line with the third cell open. */}
      {threats.map((t) => (
        <line key={`${t.line}-${t.mark}`} {...lineEnds(t.line, 22)} className={`nt-threat ${t.mark === 1 ? 'x' : 'o'}`} />
      ))}

      {/* Cell numbers: your chance this game if the next mark lands there. */}
      {cells?.map((c) => {
        const { x, y } = mid(c.cell);
        const delta = c.p - base;
        const tone = Math.abs(delta) < 1e-9 ? 'even' : delta > 0 ? 'up' : 'down';
        return (
          <g key={`v${c.cell}`} className="nt-val-g">
            <text x={x} y={y - (c.ends ? 7 : 0)} className={`nt-val ${tone}`}>
              {pct(c.p)}
            </text>
            {c.ends && (
              <text x={x} y={y + 17} className={`nt-ends ${tone}`}>
                {c.ends === 'D' ? 'draw' : `${c.ends} wins`}
              </text>
            )}
          </g>
        );
      })}

      {/* Marks. */}
      {grid.map((m, i) => (m === 0 ? null : <MarkGlyph key={`m${i}-${m}`} mark={m} {...mid(i)} size={38} fresh={i === fresh} />))}

      {/* The scanner that picks the next cell. */}
      {cursor !== null && (
        <rect
          x={0}
          y={0}
          width={CELL}
          height={CELL}
          rx={12}
          className="nt-cursor"
          style={{ transform: `translate(${cellX(cursor)}px, ${cellY(cursor)}px)`, transitionDuration: `${hopMs}ms` }}
        />
      )}

      {/* The finished game. */}
      {lines.map((l) => (
        <line key={`w${l}`} {...lineEnds(l, 30)} pathLength={1} className={'nt-winline ' + (yours ? 'yours' : 'theirs')} />
      ))}
      {result === 'D' && (
        <g className={'nt-drawn ' + (yours ? 'yours' : 'theirs')}>
          <rect x={X0 + 40} y={Y0 + SPAN / 2 - 24} width={SPAN - 80} height={48} rx={24} />
          <text x={X0 + SPAN / 2} y={Y0 + SPAN / 2 + 1}>
            Draw
          </text>
        </g>
      )}

      {/* This game's outcome shares: the green length is your chance. */}
      {band && (
        <g className="nt-band">
          <text x={X0} y={BAR_Y - 9} className="nt-bar-title">
            This game
          </text>
          <text x={X0 + SPAN} y={BAR_Y - 9} className="nt-bar-title end">
            green = your bet
          </text>
          <rect x={X0} y={BAR_Y} width={SPAN} height={BAR_H} rx={4} className="nt-bar-track" />
          {bar.map((b) =>
            b.to - b.from <= 0 ? null : (
              <rect
                key={b.side}
                x={X0 + b.from * SPAN}
                y={BAR_Y}
                width={(b.to - b.from) * SPAN}
                height={BAR_H}
                className={`nt-seg ${b.side === side ? 'yours' : 'theirs'} s-${b.side}`}
              />
            ),
          )}
          {bar.map((b, i) => {
            const anchor = i === 0 ? 'start' : i === 1 ? 'middle' : 'end';
            const x = i === 0 ? X0 : i === 1 ? X0 + SPAN / 2 : X0 + SPAN;
            return (
              <text key={`l${b.side}`} x={x} y={BAR_Y + BAR_H + 22} textAnchor={anchor} className={'nt-legend' + (b.side === side ? ' yours' : '')}>
                {b.side === 'D' ? 'Draw' : `${b.side} wins`} <tspan className="nt-legend-p">{fmtChance(odds[b.side])}</tspan>
              </text>
            );
          })}
          {cells && (
            <text x={X0 + SPAN / 2} y={BAR_Y + BAR_H + 46} className="nt-key">
              Cell % = your chance if the next mark lands there
            </text>
          )}
        </g>
      )}
    </svg>
  );
}
