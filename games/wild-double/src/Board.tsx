// The slot machine: flat symbols, the five reel windows, payline overlay and
// line markers. Reel motion is driven by Game (WAAPI on the strip elements);
// this file only renders what it's given.

import { type MutableRefObject, type ReactNode } from 'react';
import { LINES, PAYLINES, REELS, ROWS, SCATTER, WILD } from './math';

/** Points of a regular star with `n` tips, centred in the 100×100 symbol box. */
const starPoints = (n: number, outer: number, inner: number) =>
  Array.from({ length: n * 2 }, (_, i) => {
    const a = (Math.PI * i) / n - Math.PI / 2;
    const r = i % 2 ? inner : outer;
    return `${(50 + r * Math.cos(a)).toFixed(1)},${(50 + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');

// Flat geometric symbols, best-paying first. Highs are bold fills, mids are
// two-tone (a fill with a cut-out), lows are single plain shapes.
const ART: Record<number, ReactNode> = {
  0: <polygon className="wd-f" points="58,8 22,56 45,56 37,92 78,40 55,40" />,
  1: <path className="wd-f" d="M50 86 C10 58 10 26 32 22 C42 20 48 26 50 32 C52 26 58 20 68 22 C90 26 90 58 50 86 Z" />,
  2: <path className="wd-f" d="M71 18 A38 38 0 1 0 71 82 A32 32 0 1 1 71 18 Z" />,
  3: (
    <>
      <circle className="wd-o" cx="50" cy="50" r="32" />
      <circle className="wd-f" cx="50" cy="50" r="11" />
    </>
  ),
  4: (
    <>
      <polygon className="wd-f" points={starPoints(5, 40, 17)} />
      <circle className="wd-b" cx="50" cy="52" r="8" />
    </>
  ),
  5: <polygon className="wd-f" points="38,16 62,16 62,38 84,38 84,62 62,62 62,84 38,84 38,62 16,62 16,38 38,38" />,
  6: <polygon className="wd-f" points="50,14 81,32 81,68 50,86 19,68 19,32" />,
  7: <circle className="wd-f" cx="50" cy="50" r="33" />,
  8: <rect className="wd-f" x="20" y="20" width="60" height="60" />,
  9: <polygon className="wd-f" points="50,16 86,82 14,82" />,
  10: <polygon className="wd-f" points="50,12 86,50 50,88 14,50" />,
  [WILD]: (
    <>
      <rect className="wd-f" x="8" y="20" width="84" height="60" rx="6" />
      <text x="50" y="58" textAnchor="middle" className="wd-sym-text wd-inv" fontSize="26">
        W ×2
      </text>
    </>
  ),
  [SCATTER]: (
    <>
      <polygon className="wd-f" points={starPoints(8, 46, 28)} />
      <text x="50" y="60" textAnchor="middle" className="wd-sym-text wd-inv" fontSize="30">
        S
      </text>
    </>
  ),
};

export function SymbolArt({ sym, className }: { sym: number; className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={'wd-sym' + (className ? ` ${className}` : '')} aria-hidden="true">
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
    <div className={'wd-markers ' + (side === 0 ? 'left' : 'right')} aria-hidden="true">
      {[0, 1, 2].map((row) => (
        <div key={row} className="wd-marker-row">
          {PAYLINES.map((p, l) => (p[side] === row ? l : -1))
            .filter((l) => l >= 0)
            .map((l) => (
              <span
                key={l}
                className={'wd-marker' + (l < activeLines ? ' on' : '') + (shown.has(l) ? ' won' : '') + (hoverLine === l ? ' pick' : '')}
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
  // Every winning line is drawn solid green (as far as it pays); a hovered or pinned line that didn't win is dashed in the accent.
  const drawn = picked ? [...shownLines, hoverLine] : shownLines;
  return (
    <div className="wd-machine">
      <Markers side={0} activeLines={activeLines} hoverLine={hoverLine} onHoverLine={onHoverLine} onPinLine={onPinLine} shown={shown} />
      <div className="wd-window">
        <div className="wd-reels">
          {cols.map((col, r) => (
            <div key={r} className={'wd-reel' + (anticip[r] ? ' anticip' : '') + (spinning[r] ? ' spinning' : '')}>
              <div
                ref={(el) => {
                  stripRefs.current[r] = el;
                }}
                className="wd-strip"
                style={{ height: `${(col.length / ROWS) * 100}%` }}
              >
                {col.map((sym, i) => {
                  const key = `${r}-${i}`;
                  const on = lit && i < ROWS ? lit.has(key) : false;
                  return (
                    <div key={i} className={'wd-cell' + (lit && col.length === ROWS ? (on ? ' win' : ' dim') : '')} style={{ height: `${100 / col.length}%` }}>
                      <SymbolArt sym={sym} />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <svg className="wd-lines" viewBox={`0 0 ${REELS * 100} ${ROWS * 100}`} preserveAspectRatio="none" aria-hidden="true">
          {drawn.map((l) => {
            const isPick = picked && l === hoverLine;
            const n = lineCounts[l] ?? REELS;
            const pts = PAYLINES[l].map((row, r) => `${r * 100 + 50},${row * 100 + 50}`);
            return (
              <g key={l} className={'wd-line' + (isPick ? ' pick' : '')}>
                <polyline points={pts.slice(0, Math.max(1, isPick ? REELS : n)).join(' ')} className="wd-line-over" vectorEffect="non-scaling-stroke" />
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
