import type { CSSProperties } from 'react';
import type { Coin } from './math';

// Geometry (viewBox units). Columns are flip positions: column 0 is the latest
// flip, negative columns are older flips, 1…5 are the flips still to come.
export const W = 540;
export const H = 350;
const COL = 50;
const R = 19;
const X0 = 245;
const colX = (c: number) => X0 + c * COL;
const NOW_X = X0 + COL / 2;
const OLDEST = -4;
const LAST = 5;

const STRIP_Y = 72;
const YOU_Y = 148;
const HOUSE_Y = 230;
const AREA_TOP = 42;
const AREA_BOTTOM = 262;

// The odds bar: its green length is P(your pattern lands first).
const BAR_X = 26;
const BAR_W = W - 2 * BAR_X;
const BAR_Y = 298;
const BAR_H = 16;
export const barX = (p: number) => BAR_X + p * BAR_W;

const tr = (x: number, y: number): CSSProperties => ({ transform: `translate(${x}px, ${y}px)` });

function CoinFace({ face, r = R }: { face: Coin; r?: number }) {
  return (
    <>
      <circle r={r} className={`face ${face}`} />
      <text className={`glyph ${face}`} style={{ fontSize: r * 0.95 }}>
        {face}
      </text>
    </>
  );
}

export interface BoardProps {
  you: string;
  house: string;
  /** Every flip so far. */
  flips: string;
  /** The coin in the air (its index is flips.length), or null. */
  pending: Coin | null;
  spinMs: number;
  /** How long slides and bar moves take (turbo shortens it). */
  moveMs: number;
  /** Coins of each pattern matched by the tail of the flips. */
  youMatch: number;
  houseMatch: number;
  /** P(your pattern lands first), or null when the pair is invalid. */
  p: number | null;
  /** Where the bar goes after heads / tails (null hides the markers). */
  fork: { h: number; t: number } | null;
  /** Which pattern landed (draws a bracket round it in the strip). */
  landed: 'you' | 'house' | null;
  /** A line in the future area, e.g. when the race is decided early. */
  note: { text: string; side: 'you' | 'house' } | null;
  /** Changes every round, so a new round's coins never reuse the last round's. */
  roundKey: number;
  mode: 'idle' | 'live' | 'over';
}

function PatternRow({ pattern, matched, y, side, live }: { pattern: string; matched: number; y: number; side: 'you' | 'house'; live: boolean }) {
  const done = matched >= pattern.length;
  return (
    <g className={`row ${side}${done ? ' done' : ''}`} style={tr(colX(1 - matched), y)}>
      {/* The bar under the matched coins is the progress meter. */}
      <rect className="meter" x={-R} y={R + 4} width={Math.max(0, matched * COL - COL + 2 * R)} height={3} rx={1.5} opacity={matched ? 1 : 0} />
      {[...pattern].map((c, i) => {
        const state = i < matched ? 'hit' : i === matched && live ? 'need next' : 'need';
        return (
          <g key={i} className={state} transform={`translate(${i * COL} 0)`}>
            <circle r={R + 4} className="halo" />
            <CoinFace face={c as Coin} />
          </g>
        );
      })}
    </g>
  );
}

export default function Board({ you, house, flips, pending, spinMs, moveMs, youMatch, houseMatch, p, fork, landed, note, roundKey, mode }: BoardProps) {
  const n = flips.length;
  const coins: { i: number; face: Coin; col: number; spinning: boolean }[] = [];
  for (let i = Math.max(0, n - 1 + OLDEST); i < n; i++) coins.push({ i, face: flips[i] as Coin, col: i - (n - 1), spinning: false });
  if (pending) coins.push({ i: n, face: pending, col: 1, spinning: true });

  const landedLen = landed === 'you' ? you.length : landed === 'house' ? house.length : 0;

  // Fork markers: nudge them apart if they would overlap, keeping the stems on the true values.
  const fh = fork ? barX(fork.h) : 0;
  const ft = fork ? barX(fork.t) : 0;
  const markers = fork
    ? (() => {
        const gap = 24;
        if (Math.abs(fh - ft) < gap) {
          const mid = (fh + ft) / 2;
          const sign = fh <= ft ? -1 : 1;
          return { h: mid + (sign * gap) / 2, t: mid - (sign * gap) / 2 };
        }
        return { h: fh, t: ft };
      })()
    : null;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={`pn pn-${mode}`} role="img" aria-label={`Your ${you} against the house ${house}`} style={{ '--spin-ms': `${spinMs}ms`, '--move-ms': `${moveMs}ms` } as CSSProperties}>
      {/* The future: flips still to come. */}
      <rect className="future" x={NOW_X} y={AREA_TOP} width={colX(LAST) + R + 7 - NOW_X} height={AREA_BOTTOM - AREA_TOP} rx={12} />
      <line className="now" x1={NOW_X} x2={NOW_X} y1={AREA_TOP - 10} y2={AREA_BOTTOM} />
      <text x={BAR_X} y={26} className="cap">
        FLIPS{n ? ` · ${n}` : ''}
      </text>
      <text x={NOW_X + 12} y={26} className="cap accent">
        STILL NEEDED →
      </text>

      {/* Column guides. */}
      {Array.from({ length: LAST - OLDEST + 1 }, (_, k) => OLDEST + k).map((c) => (
        <line key={c} className="guide" x1={colX(c)} x2={colX(c)} y1={STRIP_Y + R + 6} y2={HOUSE_Y - R - 6} />
      ))}

      {n === 0 && !pending && (
        <text x={(BAR_X + NOW_X) / 2} y={STRIP_Y + 5} className="hint">
          flips land here
        </text>
      )}

      {/* The strip of flips, sliding left as each coin lands. */}
      {landedLen > 0 && (
        <rect
          className={`bracket ${landed}`}
          x={colX(1 - landedLen) - R - 6}
          y={STRIP_Y - R - 6}
          width={(landedLen - 1) * COL + 2 * R + 12}
          height={2 * R + 12}
          rx={R + 6}
        />
      )}
      {coins.map(({ i, face, col, spinning }) => (
        <g key={`${roundKey}-${i}`} className="strip-coin" style={{ ...tr(colX(col), STRIP_Y), opacity: col <= OLDEST ? 0.3 : col === OLDEST + 1 ? 0.6 : 1 }}>
          <g className={spinning ? 'spin' : undefined}>
            <CoinFace face={face} />
            {spinning && <circle r={R} className="cover" />}
          </g>
        </g>
      ))}

      {note && (
        <text x={(NOW_X + colX(LAST) + R) / 2} y={STRIP_Y + 5} className={`note ${note.side}`}>
          {note.text}
        </text>
      )}

      {/* Your pattern and the house's, lined up under the flips they match. */}
      <text x={BAR_X} y={YOU_Y - R - 12} className="label you">
        YOUR PATTERN
        <tspan className="count" dx={8}>
          {youMatch} of {you.length}
        </tspan>
      </text>
      <PatternRow pattern={you} matched={youMatch} y={YOU_Y} side="you" live={mode !== 'over'} />
      <text x={BAR_X} y={HOUSE_Y - R - 12} className="label house">
        HOUSE PATTERN
        <tspan className="count" dx={8}>
          {houseMatch} of {house.length}
        </tspan>
      </text>
      <PatternRow pattern={house} matched={houseMatch} y={HOUSE_Y} side="house" live={mode !== 'over'} />

      {/* The odds: a tug of war whose green length is your chance to land first. */}
      {p === null ? (
        <text x={W / 2} y={BAR_Y + 14} className="warn">
          Pick two patterns where neither contains the other
        </text>
      ) : (
        <g className="odds-group">
          <defs>
            <clipPath id="pn-bar-clip">
              <rect x={BAR_X} y={BAR_Y} width={BAR_W} height={BAR_H} rx={BAR_H / 2} />
            </clipPath>
          </defs>
          <g clipPath="url(#pn-bar-clip)">
            <rect className="bar-house" x={BAR_X} y={BAR_Y} width={BAR_W} height={BAR_H} />
            <rect className="bar-you" x={BAR_X} y={BAR_Y} width={BAR_W} height={BAR_H} style={{ transform: `scaleX(${p})` }} />
          </g>
          <g className="split" style={tr(barX(p), 0)}>
            <line y1={BAR_Y - 5} y2={BAR_Y + BAR_H + 5} />
          </g>

          {markers && fork && !pending && (
            <g className="fork">
              <line className="stem" x1={fh} y1={BAR_Y - 1} x2={markers.h} y2={BAR_Y - 12} />
              <line className="stem" x1={ft} y1={BAR_Y - 1} x2={markers.t} y2={BAR_Y - 12} />
              <g style={tr(markers.h, BAR_Y - 23)}>
                <CoinFace face="H" r={10} />
              </g>
              <g style={tr(markers.t, BAR_Y - 23)}>
                <CoinFace face="T" r={10} />
              </g>
            </g>
          )}

          <text x={BAR_X} y={BAR_Y + BAR_H + 22} className="odds you">
            YOU FIRST <tspan className="pct">{(p * 100).toFixed(1)}%</tspan>
          </text>
          <text x={BAR_X + BAR_W} y={BAR_Y + BAR_H + 22} className="odds house end">
            <tspan className="pct">{((1 - p) * 100).toFixed(1)}%</tspan> HOUSE FIRST
          </text>
        </g>
      )}
    </svg>
  );
}
