// The slot machine: flat symbols, the five reel windows, payline overlay and
// line markers. Reel motion is driven by Game (WAAPI on the strip elements);
// this file only renders what it's given.

import { type MutableRefObject, type ReactNode } from 'react';
import { LINES, PAYLINES, REELS, ROWS, SCATTER, WILD } from './math';

/** Names of the plain shapes, best-paying first (the paytable in How to play lists them). */
export const SHAPE_LABEL = ['Hexagon', 'Circle', 'Square', 'Triangle', 'Diamond', 'Ring', 'Frame', 'Wild', 'Scatter'];

const ART: Record<number, ReactNode> = {
  0: <polygon className="rl-f" points="50,14 81,32 81,68 50,86 19,68 19,32" />,
  1: <circle className="rl-f" cx="50" cy="50" r="33" />,
  2: <rect className="rl-f" x="20" y="20" width="60" height="60" />,
  3: <polygon className="rl-f" points="50,16 86,82 14,82" />,
  4: <polygon className="rl-f" points="50,12 86,50 50,88 14,50" />,
  5: <circle className="rl-o" cx="50" cy="50" r="29" />,
  6: <rect className="rl-o" x="22" y="22" width="56" height="56" />,
  [WILD]: (
    <>
      <rect className="rl-o" x="10" y="26" width="80" height="48" />
      <text x="50" y="58" textAnchor="middle" className="rl-sym-text" fontSize="22">
        WILD
      </text>
    </>
  ),
  [SCATTER]: (
    <>
      <circle className="rl-f" cx="50" cy="38" r="24" />
      <text x="50" y="82" textAnchor="middle" className="rl-sym-text" fontSize="15">
        SCATTER
      </text>
    </>
  ),
};

export function SymbolArt({ sym, className }: { sym: number; className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={'rl-sym' + (className ? ` ${className}` : '')} aria-hidden="true">
      {ART[sym]}
    </svg>
  );
}

export interface ReelsProps {
  /** Symbols per reel, top to bottom (3 when settled, longer while spinning). */
  cols: number[][];
  stripRefs: MutableRefObject<(HTMLDivElement | null)[]>;
  /** Cells to mark as "r-row" keys; null = no win presentation. */
  lit: Set<string> | null;
  /** Reels that are spinning and reels building suspense. */
  spinning: boolean[];
  anticip: boolean[];
  /** Paylines to draw over the reels (the winning ones). */
  shownLines: number[];
  /** How far along each shown line pays (count of reels), for the stroke. */
  lineCounts: Record<number, number>;
  activeLines: number;
  hoverLine: number | null;
  onHoverLine(l: number | null): void;
  /** Tapping a tab pins its line (tap again to unpin). */
  onPinLine(l: number): void;
}

/** Left / right line markers: numbered tabs at each line's entry and exit row. */
function Markers({
  side,
  activeLines,
  hoverLine,
  onHoverLine,
  onPinLine,
  shown,
}: {
  side: 0 | 4;
  activeLines: number;
  hoverLine: number | null;
  onHoverLine(l: number | null): void;
  onPinLine(l: number): void;
  shown: Set<number>;
}) {
  return (
    <div className={'rl-markers ' + (side === 0 ? 'left' : 'right')} aria-hidden="true">
      {[0, 1, 2].map((row) => (
        <div key={row} className="rl-marker-row">
          {PAYLINES.map((p, l) => (p[side] === row ? l : -1))
            .filter((l) => l >= 0)
            .map((l) => (
              <span
                key={l}
                className={'rl-marker' + (l < activeLines ? ' on' : '') + (shown.has(l) ? ' won' : '') + (hoverLine === l ? ' pick' : '')}
                title={`Line ${l + 1}${l < activeLines ? '' : ' (not played)'}`}
                onMouseEnter={() => onHoverLine(l)}
                onMouseLeave={() => onHoverLine(null)}
                onClick={() => onPinLine(l)}
              >
                {l + 1}
              </span>
            ))}
        </div>
      ))}
    </div>
  );
}

export function Reels({ cols, stripRefs, lit, spinning, anticip, shownLines, lineCounts, activeLines, hoverLine, onHoverLine, onPinLine }: ReelsProps) {
  const shown = new Set(shownLines);
  const picked = hoverLine !== null && !shown.has(hoverLine);
  const drawn = picked ? [...shownLines, hoverLine] : shownLines;
  return (
    <div className="rl-machine">
      <Markers side={0} activeLines={activeLines} hoverLine={hoverLine} onHoverLine={onHoverLine} onPinLine={onPinLine} shown={shown} />
      <div className="rl-window">
        <div className="rl-reels">
          {cols.map((col, r) => (
            <div key={r} className={'rl-reel' + (anticip[r] ? ' anticip' : '') + (spinning[r] ? ' spinning' : '')}>
              <div
                ref={(el) => {
                  stripRefs.current[r] = el;
                }}
                className="rl-strip"
                style={{ height: `${(col.length / ROWS) * 100}%` }}
              >
                {col.map((sym, i) => {
                  const key = `${r}-${i}`;
                  const on = lit && i < ROWS ? lit.has(key) : false;
                  return (
                    <div key={i} className={'rl-cell' + (lit && col.length === ROWS ? (on ? ' win' : ' dim') : '')} style={{ height: `${100 / col.length}%` }}>
                      <SymbolArt sym={sym} />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <svg className="rl-lines" viewBox={`0 0 ${REELS * 100} ${ROWS * 100}`} preserveAspectRatio="none" aria-hidden="true">
          {drawn.map((l) => {
            const isPick = picked && l === hoverLine;
            const n = lineCounts[l] ?? REELS;
            const pts = PAYLINES[l].map((row, r) => `${r * 100 + 50},${row * 100 + 50}`);
            return (
              <g key={l} className={'rl-line' + (isPick ? ' pick' : '')}>
                <polyline points={pts.slice(0, Math.max(1, isPick ? REELS : n)).join(' ')} className="rl-line-over" vectorEffect="non-scaling-stroke" />
              </g>
            );
          })}
        </svg>
      </div>
      <Markers side={4} activeLines={activeLines} hoverLine={hoverLine} onHoverLine={onHoverLine} onPinLine={onPinLine} shown={shown} />
    </div>
  );
}

export const ALL_LINES = Array.from({ length: LINES }, (_, i) => i);
