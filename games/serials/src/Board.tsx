import { fmtChance } from '@originals/game-sdk/ui';
import type { CSSProperties } from 'react';
import { N_COUNT, N_MAX, N_MIN } from './math';

const W = 600;
const H = 372;
/** The shared number line: serials and N values 1..100 map to the same x. */
const X0 = 34;
const X1 = 586;
const STEP = (X1 - X0) / N_MAX;
const xOf = (v: number) => X0 + (v - 0.5) * STEP;
/** Histogram baseline and tallest bar. */
const BASE = 232;
const HMAX = 142;
const DOT_Y = BASE + 44;
const SLOT_Y = 314;
const SLOT_H = 44;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The kit's chance format, but never rounding a live chance up to 100%. */
export const fmtP = (p: number) => (p > 0.999 && p < 1 ? '>99.9%' : fmtChance(p));

export interface BoardProps {
  cut: number;
  /** Serials drawn before the reveal. */
  total: number;
  /** Serials on the board so far. */
  drawn: number[];
  /** A serial is being drawn right now (its slot rolls). */
  rolling: boolean;
  /** The posterior over N, indexed by N − 10. */
  post: Float64Array;
  /** The lowest N still possible. */
  lo: number;
  /** P(N ≤ cut | serials). */
  win: number;
  /** The revealed N (after a reveal or once the round is over). */
  truth: number | null;
  /** The N slot is turning over. */
  revealing: boolean;
  /** Bar transition time, ms. */
  ms: number;
}

export default function Board({ cut, total, drawn, rolling, post, lo, win, truth, revealing, ms }: BoardProps) {
  let peak = 0;
  for (let i = 0; i < N_COUNT; i++) peak = Math.max(peak, post[i]);
  const cutX = xOf(cut + 0.5);
  const max = drawn.length ? Math.max(...drawn) : 0;
  const last = drawn.length ? drawn[drawn.length - 1] : null;
  const ruledW = lo > N_MIN ? xOf(lo - 0.5) - xOf(N_MIN - 0.5) : 0;
  const barStyle = { '--ms': `${ms}ms` } as CSSProperties;

  // Slots: one per serial, then the hidden N.
  const slotW = 56;
  const gap = 8;
  const nW = 92;
  const rowW = total * slotW + (total - 1) * gap + 20 + nW;
  const rowX = (W - rowW) / 2;

  const cutLabelX = clamp(cutX, 70, W - 70);
  const truthWins = truth !== null && truth <= cut;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="serials" role="img" aria-label={`Chance the top serial is at most ${cut}: ${fmtP(win)}`}>
      {/* Header: what the shaded mass means, and its value. */}
      <text x={X0} y={24} className="hdr">
        Posterior over the top serial N
      </text>
      <text x={X1} y={24} className={'hdr-p' + (win <= 0 ? ' zero' : '')}>
        <tspan className="muted">mass N ≤ {cut} = </tspan>
        {fmtP(win)}
      </text>

      {/* Values of N that the serials have ruled out. */}
      {ruledW > 0 && (
        <g className="ruled">
          <rect x={xOf(N_MIN - 0.5)} y={BASE - HMAX} width={ruledW} height={HMAX} />
          {ruledW > 70 && (
            <text x={xOf(N_MIN - 0.5) + ruledW / 2} y={BASE - HMAX / 2}>
              ruled out
            </text>
          )}
        </g>
      )}

      {/* The posterior: one bar per possible N. Green bars win, red bars lose. */}
      <g className="bars" style={barStyle}>
        {Array.from({ length: N_COUNT }, (_, i) => {
          const n = N_MIN + i;
          const f = peak > 0 ? post[i] / peak : 0;
          const cls = n <= cut ? 'win' : 'lose';
          const hit = truth === n;
          return (
            <rect
              key={n}
              x={xOf(n) - STEP * 0.4}
              y={BASE - HMAX}
              width={STEP * 0.8}
              height={HMAX}
              className={`bar ${cls}` + (truth !== null ? (hit ? ' truth' : ' dim') : '')}
              style={{ transform: `scaleY(${f})` }}
            />
          );
        })}
      </g>

      {/* The cut. */}
      <line x1={cutX} y1={BASE - HMAX - 14} x2={cutX} y2={BASE + 6} className="cut" />
      <text x={cutLabelX} y={BASE - HMAX - 20} className="cut-label">
        cut X = {cut}
      </text>

      {/* The revealed N. */}
      {truth !== null && (
        <g className={'truth-mark ' + (truthWins ? 'win' : 'lose')}>
          <line x1={xOf(truth)} y1={BASE - HMAX + 4} x2={xOf(truth)} y2={DOT_Y + 10} />
          <text x={xOf(truth) + (truth > 80 ? -8 : 8)} y={BASE - HMAX + 18} className={truth > 80 ? 'flip' : undefined}>
            N = {truth}
          </text>
        </g>
      )}

      {/* The number line 1..100 shared by serials and N. */}
      <line x1={xOf(1) - 4} y1={BASE} x2={xOf(N_MAX) + 4} y2={BASE} className="axis" />
      {[1, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((v) => (
        <g key={v}>
          <line x1={xOf(v)} y1={BASE} x2={xOf(v)} y2={BASE + 5} className="tick" />
          <text x={xOf(v)} y={BASE + 20} className="tick-label">
            {v}
          </text>
        </g>
      ))}

      {/* Serials seen, on the same scale; the largest bounds N from below. */}
      <line x1={xOf(1) - 4} y1={DOT_Y} x2={xOf(N_MAX) + 4} y2={DOT_Y} className="dot-rail" />
      {max > 0 && <line x1={xOf(max)} y1={DOT_Y} x2={xOf(max)} y2={BASE} className="max-link" />}
      {drawn.map((s, i) => (
        <circle
          key={`${i}-${s}`}
          cx={xOf(s)}
          cy={DOT_Y}
          r={s === last ? 8 : 6}
          className={'serial' + (s > cut ? ' over' : '') + (s === last ? ' last' : '')}
        />
      ))}
      {max > 0 && (
        <text x={clamp(xOf(max), 40, W - 40)} y={DOT_Y + 24} className={'max-label' + (max > cut ? ' over' : '')}>
          largest {max}
        </text>
      )}
      {drawn.length === 0 && (
        <text x={W / 2} y={DOT_Y + 24} className="rail-hint">
          serials land here
        </text>
      )}

      {/* Slots: the serials in draw order, then the hidden N. */}
      {Array.from({ length: total }, (_, i) => {
        const s = drawn[i];
        const isRolling = rolling && i === drawn.length;
        const x = rowX + i * (slotW + gap);
        return (
          <g key={i} className={'slot' + (s !== undefined ? (s > cut ? ' over' : ' seen') : '') + (isRolling ? ' rolling' : '')}>
            <rect x={x} y={SLOT_Y} width={slotW} height={SLOT_H} rx={8} />
            <text x={x + slotW / 2} y={SLOT_Y + SLOT_H / 2 + 7}>
              {s !== undefined ? s : isRolling ? '•••' : '?'}
            </text>
          </g>
        );
      })}
      <g className={'slot n-slot' + (truth !== null ? (truthWins ? ' win' : ' lose') : '') + (revealing ? ' rolling' : '')}>
        <rect x={rowX + total * (slotW + gap) - gap + 20} y={SLOT_Y} width={nW} height={SLOT_H} rx={8} />
        <text x={rowX + total * (slotW + gap) - gap + 20 + nW / 2} y={SLOT_Y + SLOT_H / 2 + 7}>
          N = {truth !== null ? truth : revealing ? '•••' : '?'}
        </text>
      </g>
    </svg>
  );
}
