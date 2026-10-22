// The slot machine: symbol art, the five reel windows, payline overlay and
// line markers. Reel motion is driven by Game (WAAPI on the strip elements);
// this file only renders what it's given.

import { type CSSProperties, type MutableRefObject, type ReactNode } from 'react';
import { LINES, PAYLINES, REELS, ROWS, SCATTER, WILD } from './math';

/** A distinct colour per payline (golden-angle hues). */
export const lineColour = (l: number) => `hsl(${Math.round((l * 137.508 + 20) % 360)} 90% 62%)`;

const GRADS: [string, string][] = [
  ['#f4feff', '#5fd8f0'], // diamond
  ['#ffb3c0', '#d3123f'], // ruby
  ['#9af5bb', '#04875c'], // emerald
  ['#a9cbff', '#2050d8'], // sapphire
  ['#ffe9a3', '#f08c00'], // triangle
  ['#e1c2ff', '#7a35e6'], // square
  ['#a7f8ea', '#0a958a'], // circle
  ['#ffc58a', '#e8540b'], // wild
];

/** Shared gradients; rendered once, referenced by every symbol. */
export function SymbolDefs() {
  return (
    <svg className="rl-defs" aria-hidden="true" width="0" height="0">
      <defs>
        {GRADS.map(([a, b], i) => (
          <linearGradient key={i} id={`rl-g${i}`} x1="0" y1="0" x2="0.35" y2="1">
            <stop offset="0" stopColor={a} />
            <stop offset="1" stopColor={b} />
          </linearGradient>
        ))}
        <radialGradient id="rl-g8" cx="0.38" cy="0.32" r="0.75">
          <stop offset="0" stopColor="#fffbea" />
          <stop offset="0.45" stopColor="#fbbf24" />
          <stop offset="1" stopColor="#9a3412" />
        </radialGradient>
        <radialGradient id="rl-shine" cx="0.3" cy="0.2" r="0.6">
          <stop offset="0" stopColor="#fff" stopOpacity="0.75" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
    </svg>
  );
}

const FACET = { fill: 'none', stroke: '#fff', strokeOpacity: 0.45, strokeWidth: 1.6, strokeLinejoin: 'round' as const };
const EDGE = { stroke: '#0008', strokeWidth: 2, strokeLinejoin: 'round' as const };

const ART: Record<number, ReactNode> = {
  0: (
    <>
      <polygon points="30,16 70,16 90,40 50,90 10,40" fill="url(#rl-g0)" {...EDGE} />
      <polyline points="10,40 90,40" {...FACET} />
      <polyline points="30,16 40,40 50,16 60,40 70,16" {...FACET} />
      <polyline points="40,40 50,90 60,40" {...FACET} />
      <polygon points="30,16 50,16 40,40 22,40" fill="url(#rl-shine)" />
    </>
  ),
  1: (
    <>
      <polygon points="50,8 87,29 87,71 50,92 13,71 13,29" fill="url(#rl-g1)" {...EDGE} />
      <polygon points="50,28 69,39 69,61 50,72 31,61 31,39" {...FACET} />
      <path d="M50 8V28M87 29L69 39M87 71L69 61M50 92V72M13 71L31 61M13 29L31 39" {...FACET} />
      <polygon points="50,8 13,29 31,39 50,28" fill="url(#rl-shine)" />
    </>
  ),
  2: (
    <>
      <polygon points="30,10 70,10 88,28 88,72 70,90 30,90 12,72 12,28" fill="url(#rl-g2)" {...EDGE} />
      <rect x="29" y="27" width="42" height="46" {...FACET} />
      <path d="M30 10L29 27M70 10L71 27M88 72L71 73M12 72L29 73M12 28L29 27M88 28L71 27M30 90L29 73M70 90L71 73" {...FACET} />
      <polygon points="30,10 70,10 71,27 29,27" fill="url(#rl-shine)" />
    </>
  ),
  3: (
    <>
      <circle cx="50" cy="50" r="39" fill="url(#rl-g3)" {...EDGE} />
      <polygon points="50,24 68,32 76,50 68,68 50,76 32,68 24,50 32,32" {...FACET} />
      <path d="M50 11V24M77.6 22.4L68 32M89 50H76M77.6 77.6L68 68M50 89V76M22.4 77.6L32 68M11 50H24M22.4 22.4L32 32" {...FACET} />
      <circle cx="38" cy="34" r="12" fill="url(#rl-shine)" />
    </>
  ),
  4: (
    <>
      <polygon points="50,12 91,84 9,84" fill="url(#rl-g4)" {...EDGE} />
      <polygon points="50,40 70,74 30,74" {...FACET} />
    </>
  ),
  5: (
    <>
      <rect x="15" y="15" width="70" height="70" rx="12" fill="url(#rl-g5)" {...EDGE} />
      <polygon points="50,30 70,50 50,70 30,50" {...FACET} />
    </>
  ),
  6: (
    <>
      <circle cx="50" cy="50" r="36" fill="url(#rl-g6)" {...EDGE} />
      <circle cx="50" cy="50" r="15" fill="#0b0d14" fillOpacity="0.55" stroke="#fff" strokeOpacity="0.45" strokeWidth="1.6" />
    </>
  ),
  [WILD]: (
    <>
      <rect x="7" y="7" width="86" height="86" rx="16" fill="url(#rl-g7)" {...EDGE} />
      <polygon
        points="50,14 57,33 77,33 61,45 67,64 50,53 33,64 39,45 23,33 43,33"
        fill="#fff"
        fillOpacity="0.92"
        stroke="#7c2d12"
        strokeOpacity="0.35"
        strokeWidth="1.5"
      />
      <text x="50" y="85" textAnchor="middle" className="rl-sym-text" fontSize="17">
        WILD
      </text>
    </>
  ),
  [SCATTER]: (
    <>
      <ellipse cx="50" cy="44" rx="44" ry="13" fill="none" stroke="#fbbf24" strokeOpacity="0.55" strokeWidth="2.5" transform="rotate(-16 50 44)" />
      <circle cx="50" cy="44" r="29" fill="url(#rl-g8)" {...EDGE} />
      <polygon points="50,24 54,40 70,44 54,48 50,64 46,48 30,44 46,40" fill="#fff" fillOpacity="0.95" />
      <text x="50" y="92" textAnchor="middle" className="rl-sym-text scatter" fontSize="13">
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
  /** Cells to light as "r-row" keys; null = no win presentation. */
  lit: Set<string> | null;
  /** Reels that are spinning (blurred) and reels building suspense. */
  spinning: boolean[];
  anticip: boolean[];
  /** Paylines to draw over the reels. */
  shownLines: number[];
  /** How far along each shown line pays (count of reels), for the stroke. */
  lineCounts: Record<number, number>;
  activeLines: number;
  hoverLine: number | null;
  onHoverLine(l: number | null): void;
  free: boolean;
}

/** Left / right line markers: numbered tabs at each line's entry and exit row. */
function Markers({ side, activeLines, hoverLine, onHoverLine, shown }: { side: 0 | 4; activeLines: number; hoverLine: number | null; onHoverLine(l: number | null): void; shown: Set<number> }) {
  return (
    <div className={'rl-markers ' + (side === 0 ? 'left' : 'right')} aria-hidden="true">
      {[0, 1, 2].map((row) => (
        <div key={row} className="rl-marker-row">
          {PAYLINES.map((p, l) => (p[side] === row ? l : -1))
            .filter((l) => l >= 0)
            .map((l) => (
              <span
                key={l}
                className={'rl-marker' + (l < activeLines ? ' on' : '') + (shown.has(l) || hoverLine === l ? ' lit' : '')}
                style={{ '--lc': lineColour(l) } as CSSProperties}
                onMouseEnter={() => onHoverLine(l)}
                onMouseLeave={() => onHoverLine(null)}
              >
                {l + 1}
              </span>
            ))}
        </div>
      ))}
    </div>
  );
}

export function Reels({ cols, stripRefs, lit, spinning, anticip, shownLines, lineCounts, activeLines, hoverLine, onHoverLine, free }: ReelsProps) {
  const shown = new Set(shownLines);
  const drawn = hoverLine !== null && !shown.has(hoverLine) ? [...shownLines, hoverLine] : shownLines;
  return (
    <div className={'rl-machine' + (free ? ' free' : '')}>
      <Markers side={0} activeLines={activeLines} hoverLine={hoverLine} onHoverLine={onHoverLine} shown={shown} />
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
            const n = lineCounts[l] ?? REELS;
            const pts = PAYLINES[l].map((row, r) => `${r * 100 + 50},${row * 100 + 50}`);
            return (
              <g key={l} style={{ '--lc': lineColour(l) } as CSSProperties} className={'rl-line' + (l === hoverLine && !shown.has(l) ? ' hover' : '')}>
                <polyline points={`0,${PAYLINES[l][0] * 100 + 50} ${pts.join(' ')} ${REELS * 100},${PAYLINES[l][4] * 100 + 50}`} className="rl-line-under" vectorEffect="non-scaling-stroke" />
                <polyline points={pts.slice(0, Math.max(1, n)).join(' ')} className="rl-line-over" vectorEffect="non-scaling-stroke" />
              </g>
            );
          })}
        </svg>
      </div>
      <Markers side={4} activeLines={activeLines} hoverLine={hoverLine} onHoverLine={onHoverLine} shown={shown} />
    </div>
  );
}

export const ALL_LINES = Array.from({ length: LINES }, (_, i) => i);
