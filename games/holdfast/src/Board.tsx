// The Holdfast board: 5 columns (3, 4, 4, 4, 3 cells), flat symbols, and the lock track
// that lists what 1-12 held keystones pay. Motion is driven by Game; this only draws.

import type { ReactNode } from 'react';
import { KEY, LOCK_PAY, PAYLINES, ROWS_PER_REEL, SCATTER, WILD } from './math';

export const EMPTY = -1;

/** Names of the shapes, for the info modal and aria labels. */
export const SHAPE_NAME = ['Ring', 'Bar', 'Square', 'Triangle', 'Hexagon', 'Pentagon', 'Diamond', 'Circle', 'Cross', 'Keystone', 'Star', 'Wild'];

// Shape tone: --text for the best payers (s5-s7), --muted for the middle, --faint for the rest.
const TONE = ['faint', 'muted', 'muted', 'muted', 'hi', 'hi', 'hi', 'muted', 'faint'];

const ART: Record<number, ReactNode> = {
  0: <circle cx="50" cy="50" r="28" className="hf-o" />,
  1: <rect x="14" y="36" width="72" height="28" className="hf-f" />,
  2: <rect x="22" y="22" width="56" height="56" className="hf-f" />,
  3: <polygon points="50,16 86,82 14,82" className="hf-f" />,
  4: <polygon points="50,12 82,31 82,69 50,88 18,69 18,31" className="hf-f" />,
  5: <polygon points="50,12 88,40 74,84 26,84 12,40" className="hf-f" />,
  6: <polygon points="50,10 88,50 50,90 12,50" className="hf-f" />,
  7: <circle cx="50" cy="50" r="32" className="hf-f" />,
  8: <path d="M38,14 H62 V38 H86 V62 H62 V86 H38 V62 H14 V38 H38 Z" className="hf-o" />,
  [KEY]: <polygon points="30,16 70,16 84,84 16,84" className="hf-key" />,
  [SCATTER]: <polygon points="50,8 60,40 92,50 60,60 50,92 40,60 8,50 40,40" className="hf-f hf-hi" />,
  [WILD]: (
    <>
      <rect x="10" y="16" width="80" height="68" className="hf-wild" />
      <text x="50" y="66" textAnchor="middle" className="hf-wild-text">
        W
      </text>
    </>
  ),
};

export function SymbolArt({ sym, className }: { sym: number; className?: string }) {
  const tone = sym >= 0 && sym < TONE.length ? TONE[sym] : '';
  return (
    <svg viewBox="0 0 100 100" className={'hf-sym' + (tone ? ` ${tone}` : '') + (className ? ` ${className}` : '')} role="img" aria-label={SHAPE_NAME[sym]}>
      {ART[sym]}
    </svg>
  );
}

const SIZE = 76;
const PITCH = 82;
export const BOARD_W = 5 * PITCH - (PITCH - SIZE);
export const BOARD_H = 4 * PITCH - (PITCH - SIZE);

export interface GridProps {
  grid: number[][];
  spinning: boolean[];
  /** "reel-row" keys of cells on a paying line; null = no win presentation. */
  lit: Set<string> | null;
  /** Lock feature: which of the 12 inner cells are held, and which just landed. */
  held: boolean[] | null;
  landed: boolean[] | null;
  /** A respin is in flight: unlocked inner cells show a dot. */
  respinning: boolean;
  /** Winning lines to draw: line index and how many reels it pays across. */
  wins?: { line: number; run: number }[];
}

export function Grid({ grid, spinning, lit, held, landed, respinning, wins }: GridProps) {
  return (
    <svg viewBox={`0 0 ${BOARD_W} ${BOARD_H}`} className="hf-grid" role="group" aria-label="Holdfast board">
      {ROWS_PER_REEL.map((rows, r) =>
        Array.from({ length: rows }, (_, row) => {
          const x = r * PITCH;
          const y = (4 - rows) * (PITCH / 2) + row * PITCH;
          const inner = r >= 1 && r <= 3;
          const idx = (r - 1) * 4 + row;
          let sym = grid[r]?.[row] ?? EMPTY;
          let open = false;
          if (held && inner) {
            sym = held[idx] ? KEY : EMPTY;
            open = !held[idx];
          }
          const on = lit?.has(`${r}-${row}`) ?? false;
          const dim = lit !== null && lit.size > 0 && !on && !held;
          const fresh = !!landed?.[idx] && inner;
          return (
            <g key={`${r}-${row}`} transform={`translate(${x} ${y})`}>
              <rect width={SIZE} height={SIZE} rx={6} className={'hf-cell' + (on ? ' win' : '') + (fresh ? ' fresh' : '')} />
              {open && respinning && <circle cx={SIZE / 2} cy={SIZE / 2} r={5} className="hf-dot" />}
              {sym !== EMPTY && (
                <g transform="scale(0.76)" className={'hf-sym' + (spinning[r] ? ' blur' : '') + (dim ? ' dim' : '')}>
                  <g className={sym < TONE.length ? TONE[sym] : ''}>{ART[sym]}</g>
                </g>
              )}
            </g>
          );
        }),
      )}
      {(wins ?? []).map((w, i) => (
        <polyline
          key={`${w.line}-${i}`}
          className="hf-line"
          points={PAYLINES[w.line]
            .slice(0, w.run)
            .map((row, r) => `${r * PITCH + SIZE / 2},${(4 - ROWS_PER_REEL[r]) * (PITCH / 2) + row * PITCH + SIZE / 2}`)
            .join(' ')}
        />
      ))}
    </svg>
  );
}

export interface TrackProps {
  /** P(final count = k) for k = 0..12 from the current lock state. */
  dist: number[];
  /** Keystones held now (null when no lock is showing). */
  count: number | null;
  /** The lock has ended: the reached box stays marked. */
  done: boolean;
}

/** The lock's pay track: 1-12 held, what each pays, and a bar for the chance to finish there. */
export function Track({ dist, count, done }: TrackProps) {
  const top = Math.max(...dist.slice(1), 1e-9);
  return (
    <div className="hf-track" role="group" aria-label="Lock pay by keystones held">
      <p className="hf-key-line">Lock: keystones held and pay</p>
      <p className="hf-key-line">Bar: chance to end on each</p>
      <div className="hf-boxes">
        {Array.from({ length: 12 }, (_, i) => {
          const k = i + 1;
          const reached = count !== null && k <= count;
          const final = count === k;
          return (
            <div key={k} className={'hf-box' + (reached ? ' lit' : '') + (final ? (done ? ' final' : ' now') : '')}>
              <span className="hf-bar">
                <i style={{ height: `${Math.round((dist[k] / top) * 100)}%` }} />
              </span>
              <b>{k}</b>
              <small>{LOCK_PAY[k]}×</small>
            </div>
          );
        })}
      </div>
    </div>
  );
}
