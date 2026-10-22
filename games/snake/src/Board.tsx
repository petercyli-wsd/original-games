import type { CSSProperties } from 'react';
import { fmtChance } from '@originals/game-sdk/ui';
import { DX, DY, blockers, type Blocker, type Dir } from './math';

const GAIN: Record<number, string> = { 4: 'free', 3: '×4/3', 2: '×2', 1: '×4' };

// Board geometry, in viewBox units. The grid is always 360 wide; cells scale with n.
const X0 = 20;
const Y0 = 12;
const S = 360;
const BAND = Y0 + S + 22;
export const VIEW_H = BAND + 64;

export type BoardMode = 'idle' | 'spin' | 'move' | 'live' | 'over';
export type Outcome = 'wall' | 'body' | 'cashed' | 'target' | 'trapped';

export interface Crash {
  dir: Dir;
  hit: Blocker;
}

export interface BoardProps {
  n: number;
  target: number;
  /** The snake's cells, tail first, head last. */
  path: number[];
  /** What blocks each direction from the head (null = free). */
  blocked: Blocker[];
  mode: BoardMode;
  outcome: Outcome | null;
  crash: Crash | null;
  /** Needle angle in degrees (cumulative, clockwise from up). */
  needle: number;
  spinMs: number;
  moveMs: number;
  /** Chance to reach the target from here (or at the start, in idle). */
  win: number;
}

/** A point at angle a (degrees clockwise from up), radius r, around the origin. */
const at = (a: number, r: number) => {
  const t = (a * Math.PI) / 180;
  return `${(r * Math.sin(t)).toFixed(2)} ${(-r * Math.cos(t)).toFixed(2)}`;
};

/** The ring quarter facing direction d. */
const quarter = (d: number, r: number, gap: number) => `M ${at(d * 90 - 45 + gap, r)} A ${r} ${r} 0 0 1 ${at(d * 90 + 45 - gap, r)}`;

export default function Board({ n, target, path, blocked, mode, outcome, crash, needle, spinMs, moveMs, win }: BoardProps) {
  const c = S / n;
  const cx = (cell: number) => X0 + ((cell % n) + 0.5) * c;
  const cy = (cell: number) => Y0 + (Math.floor(cell / n) + 0.5) * c;
  const head = path[path.length - 1];
  const body = new Set(path);
  const free = blocked.filter((b) => b === null).length;
  const showHints = mode === 'idle' || mode === 'live' || mode === 'spin';
  const over = mode === 'over';
  const won = outcome === 'target';
  const showRing = !over || crash !== null || outcome === 'trapped';

  // The head lunges toward whatever it hit.
  const lunge = crash ? 0.16 * c : 0;
  const hx = cx(head) + (crash ? DX[crash.dir] * lunge : 0);
  const hy = cy(head) + (crash ? DY[crash.dir] * lunge : 0);

  // The body is drawn up to the previous cell; the newest segment grows in as the head slides.
  const pts = path.map((p) => `${cx(p).toFixed(1)},${cy(p).toFixed(1)}`);
  const prev = path.length > 1 ? path[path.length - 2] : null;
  const bodyW = c * 0.4;

  const R = c * 0.5;
  const slot = Math.min(24, (S - (target - 1) * 6) / target);
  const slotsW = target * slot + (target - 1) * 6;
  const slotX = X0 + (S - slotsW) / 2;
  const mark = c * 0.15;

  // The factor the newest step paid, floated over the head for a moment.
  const lastFree = path.length > 1 ? blockers(n, path.slice(0, -1)).filter((b) => b === null).length : 0;
  const gain = (mode === 'move' || mode === 'live') && !crash && lastFree > 0 ? GAIN[lastFree] : null;

  const style = { '--spin': `${spinMs}ms`, '--move': `${moveMs}ms` } as CSSProperties;
  const cls = ['snk', over && 'over', won && 'won', outcome === 'trapped' && 'trapped', crash && 'crashed'].filter(Boolean).join(' ');

  return (
    <svg viewBox={`0 0 400 ${VIEW_H}`} className={cls} style={style} role="img" aria-label={`Snake of length ${path.length} on a ${n} by ${n} board; ${free} of 4 directions free`}>
      <rect x={X0 - 7} y={Y0 - 7} width={S + 14} height={S + 14} rx={12} className="frame" />

      {/* The board: one tile per cell, body tiles tinted. */}
      <g className="cells">
        {Array.from({ length: n * n }, (_, i) => (
          <rect
            key={i}
            x={X0 + (i % n) * c + 2.5}
            y={Y0 + Math.floor(i / n) * c + 2.5}
            width={c - 5}
            height={c - 5}
            rx={c * 0.16}
            className={'cell' + (body.has(i) ? ' body' : '')}
          />
        ))}
      </g>

      {/* The odds, part 1: the four neighbouring tiles, green if free, red if body; a red bar on a wall. */}
      {showHints && (
        <g className="hints" key={`t${path.length}`}>
          {blocked.map((b, d) => {
            if (b === 'wall') {
              const ex = cx(head) + DX[d] * c * 0.5;
              const ey = cy(head) + DY[d] * c * 0.5;
              const along = c * 0.4;
              return <line key={d} x1={ex - DY[d] * along} y1={ey - DX[d] * along} x2={ex + DY[d] * along} y2={ey + DX[d] * along} className="wall-hit" />;
            }
            return (
              <rect
                key={d}
                x={cx(head) + DX[d] * c - c / 2 + 2.5}
                y={cy(head) + DY[d] * c - c / 2 + 2.5}
                width={c - 5}
                height={c - 5}
                rx={c * 0.16}
                className={b ? 'tile-risk' : 'tile-safe'}
              />
            );
          })}
        </g>
      )}

      {/* The snake. */}
      <g className="snake">
        {path.length > 1 && <polyline points={pts.join(' ')} className="body-glow" style={{ strokeWidth: c * 0.7 }} />}
        {path.length > 2 && <polyline points={pts.slice(0, -1).join(' ')} className="body-line" style={{ strokeWidth: bodyW }} />}
        {prev !== null && (
          <line
            key={`seg${path.length}`}
            x1={cx(prev)}
            y1={cy(prev)}
            x2={cx(head)}
            y2={cy(head)}
            pathLength={1}
            className="body-line grow"
            style={{ strokeWidth: bodyW }}
          />
        )}
        {path.length > 1 && <circle cx={cx(path[0])} cy={cy(path[0])} r={c * 0.08} className="tail" />}
      </g>

      {/* The odds, part 2: an arrow into each free cell, a cross on each body cell in the way. */}
      {showHints && (
        <g className="hints" key={`m${path.length}`}>
          {blocked.map((b, d) => {
            if (b === 'wall') return null;
            const x = (cx(head) + DX[d] * c).toFixed(1);
            const y = (cy(head) + DY[d] * c).toFixed(1);
            return b ? (
              <path key={d} transform={`translate(${x} ${y})`} d={`M ${-mark} ${-mark} L ${mark} ${mark} M ${mark} ${-mark} L ${-mark} ${mark}`} className="mark-risk" />
            ) : (
              <path key={d} transform={`translate(${x} ${y}) rotate(${d * 90})`} d={`M ${-mark} ${mark * 0.5} L 0 ${-mark * 0.5} L ${mark} ${mark * 0.5}`} className="mark-safe" />
            );
          })}
        </g>
      )}

      {/* The head: a compass ring of four quarters (each 1 in 4) and the spinner needle. */}
      <g className="head-pos" style={{ transform: `translate(${hx}px, ${hy}px)` }}>
        {showRing && (
          <g className="ring">
            <circle r={R} className="ring-track" style={{ strokeWidth: c * 0.16 }} />
            {blocked.map((b, d) => (
              <path key={d} d={quarter(d, R, 9)} className={'q ' + (b ? 'risk' : 'safe') + (crash?.dir === d ? ' hit' : '')} style={{ strokeWidth: c * 0.1 }} />
            ))}
          </g>
        )}
        <circle r={c * 0.24} className="head" />
        {showRing && (
          <g className={'needle' + (mode === 'idle' || mode === 'live' ? ' resting' : '')} style={{ transform: `rotate(${needle}deg)` }}>
            <circle r={R + c * 0.12} className="needle-box" />
            <path d={`M ${-c * 0.08} ${-c * 0.1} L 0 ${-R - c * 0.08} L ${c * 0.08} ${-c * 0.1} Z`} />
            <circle r={c * 0.09} className="hub" />
          </g>
        )}
      </g>

      {/* What the last safe step paid: 4 / (free directions before it). */}
      {gain && (
        <text
          key={`g${path.length}`}
          x={cx(head) + (head % n >= n - 2 ? -1 : 1) * c * 0.78}
          y={cy(head) - c * 0.5}
          className="gain"
          style={{ fontSize: Math.max(12, c * 0.34) }}
        >
          {gain}
        </text>
      )}

      {/* Where it crashed: the wall edge, or the body cell it ran into. */}
      {crash && (
        <g
          className="burst"
          transform={`translate(${(cx(head) + DX[crash.dir] * c * (crash.hit === 'wall' ? 0.5 : 1)).toFixed(1)} ${(cy(head) + DY[crash.dir] * c * (crash.hit === 'wall' ? 0.5 : 1)).toFixed(1)})`}
        >
          {crash.hit === 'wall' ? (
            <line x1={-DY[crash.dir] * c * 0.45} y1={-DX[crash.dir] * c * 0.45} x2={DY[crash.dir] * c * 0.45} y2={DX[crash.dir] * c * 0.45} className="wall-hit" />
          ) : (
            <rect x={-c / 2 + 2.5} y={-c / 2 + 2.5} width={c - 5} height={c - 5} rx={c * 0.16} className="tile-risk" />
          )}
          <circle r={c * 0.2} />
          <path d={`M ${-c * 0.09} ${-c * 0.09} L ${c * 0.09} ${c * 0.09} M ${c * 0.09} ${-c * 0.09} L ${-c * 0.09} ${c * 0.09}`} />
        </g>
      )}

      {/* The win condition: a length meter with one slot per cell of the target. */}
      <g className="band">
        <text x={X0} y={BAND + 8} className="band-label">
          LENGTH
        </text>
        <text x={X0 + 60} y={BAND + 8} className="band-value">
          {path.length} / {target}
        </text>
        {!over && (
          <text x={X0 + S} y={BAND + 8} className="band-label end">
            {mode === 'idle' ? 'WIN CHANCE ' : 'WIN FROM HERE '}
            <tspan className="band-win">{fmtChance(win)}</tspan>
          </text>
        )}
        {Array.from({ length: target }, (_, i) => (
          <rect
            key={i}
            x={slotX + i * (slot + 6)}
            y={BAND + 22}
            width={slot}
            height={slot}
            rx={slot * 0.22}
            className={'slot' + (i < path.length ? ' on' : '') + (i === target - 1 ? ' goal' : '')}
          />
        ))}
      </g>
    </svg>
  );
}
