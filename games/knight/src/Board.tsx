import { fmtChance } from '@originals/game-sdk/ui';
import { useEffect, useState } from 'react';
import { degree, fileOf, inTarget, rankOf, squareName, type Target } from './math';

/** Square size and board origin in viewBox units. */
const S = 47;
const X0 = 18;
const Y0 = 4;
/** Dot radius for probability 1: dot area is proportional to the chance of ending there. */
const DOT_K = 28;

const sx = (s: number) => X0 + fileOf(s) * S;
const sy = (s: number) => Y0 + (7 - rankOf(s)) * S;
const cx = (s: number) => sx(s) + S / 2;
const cy = (s: number) => sy(s) + S / 2;

export type BoardOutcome = 'win' | 'sure' | 'miss' | 'reach' | 'cashed';

export interface Move {
  id: number;
  from: number;
  to: number;
}

/** The L a knight move traces: the long leg first, then the short one. */
function lCorner(from: number, to: number) {
  const long = Math.abs(fileOf(to) - fileOf(from)) === 2;
  return { x: long ? cx(to) : cx(from), y: long ? cy(from) : cy(to) };
}
function lPath(from: number, to: number) {
  const c = lCorner(from, to);
  return `M ${cx(from)} ${cy(from)} L ${c.x} ${c.y} L ${cx(to)} ${cy(to)}`;
}
/** Point at fraction u of the way along the L (the long leg is 2 of its 3 units). */
function alongL(from: number, to: number, u: number) {
  const c = lCorner(from, to);
  const d = u * 3;
  if (d <= 2) return { x: cx(from) + ((c.x - cx(from)) * d) / 2, y: cy(from) + ((c.y - cy(from)) * d) / 2 };
  return { x: c.x + (cx(to) - c.x) * (d - 2), y: c.y + (cy(to) - c.y) * (d - 2) };
}

const ease = (u: number) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);

/** 0 → 1 over ms each time a new move id arrives; 1 when idle. */
function useProgress(id: number | null, ms: number) {
  const [st, setSt] = useState<{ id: number | null; u: number }>({ id: null, u: 1 });
  useEffect(() => {
    if (id === null) return;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const u = Math.min(1, (now - t0) / Math.max(1, ms));
      setSt({ id, u });
      if (u < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [id, ms]);
  if (id === null) return 1;
  return st.id === id ? st.u : 0;
}

export interface BoardProps {
  target: Target;
  /** Committed squares; path[0] is g1. */
  path: number[];
  /** The move in flight, if any. */
  move: Move | null;
  moveMs: number;
  /** Where the knight can end from its committed square (dot area ∝ chance). Null hides the dots. */
  dist: Float64Array | null;
  /** Chance to win after each possible next jump (null hides the labels). */
  next: Map<number, number> | null;
  outcome: BoardOutcome | null;
  /** Squares that may be clicked to pick the target (idle or over), null when locked. */
  onPick: ((s: number) => void) | null;
  pickable: (s: number) => boolean;
}

export default function Board({ target, path, move, moveMs, dist, next, outcome, onPick, pickable }: BoardProps) {
  const at = move ? move.to : path[path.length - 1];
  const u = ease(useProgress(move?.id ?? null, moveMs));
  const pos = move ? alongL(move.from, move.to, u) : { x: cx(at), y: cy(at) };
  const squares = Array.from({ length: 64 }, (_, i) => i);
  const tokenClass = 'token' + (outcome === 'win' || outcome === 'sure' ? ' won' : outcome === 'miss' || outcome === 'reach' ? ' lost' : '');
  const pickMode = onPick && (target.region === 'square' || target.region === 'corner');

  return (
    <svg viewBox="0 0 400 400" className="knight" role="img" aria-label={`Knight on ${squareName(at)}`}>
      {squares.map((s) => {
        const hit = inTarget(s, target);
        const can = !!pickMode && pickable(s);
        return (
          <g
            key={s}
            className={'sq' + (can ? ' pick' : '') + (pickMode && !can ? ' off' : '')}
            onClick={can ? () => onPick!(s) : undefined}
            role={can ? 'button' : undefined}
            aria-label={can ? `Target ${target.region === 'corner' ? 'the quadrant of ' : ''}${squareName(s)}` : undefined}
          >
            <rect x={sx(s)} y={sy(s)} width={S} height={S} className={(fileOf(s) + rankOf(s)) % 2 ? 'light' : 'dark'} />
            {hit && <rect x={sx(s) + 1} y={sy(s) + 1} width={S - 2} height={S - 2} className="target" />}
            <text x={sx(s) + 4} y={sy(s) + 11} className="deg">
              {degree(s)}
            </text>
          </g>
        );
      })}
      <rect x={X0} y={Y0} width={8 * S} height={8 * S} className="frame" />

      {/* File and rank labels. */}
      {squares.slice(0, 8).map((f) => (
        <text key={'f' + f} x={X0 + f * S + S / 2} y={Y0 + 8 * S + 11} className="coord">
          {'abcdefgh'[f]}
        </text>
      ))}
      {squares.slice(0, 8).map((r) => (
        <text key={'r' + r} x={X0 - 8} y={Y0 + (7 - r) * S + S / 2 + 4} className="coord">
          {r + 1}
        </text>
      ))}

      {/* Where the knight can end: each dot's area is the chance of finishing on that square. */}
      {dist &&
        squares.map((s) =>
          dist[s] > 1e-12 ? (
            <circle key={'d' + s} cx={cx(s)} cy={cy(s)} r={DOT_K * Math.sqrt(dist[s])} className={'mass' + (inTarget(s, target) ? ' in' : '')} />
          ) : null,
        )}

      {/* The trail: one L per move. */}
      {path.slice(1).map((s, i) => (
        <path key={'t' + i} d={lPath(path[i], s)} className="trail" />
      ))}
      {path.slice(0, -1).map((s, i) => (
        <circle key={'v' + i} cx={cx(s)} cy={cy(s)} r={i === 0 ? 5 : 3.5} className={'visit' + (i === 0 ? ' start' : '')} />
      ))}
      {move && <path key={'m' + move.id} d={lPath(move.from, move.to)} pathLength={1} className="trail fresh" style={{ animationDuration: `${moveMs}ms` }} />}

      {/* The next jump: each ringed square shows your chance if the knight lands there. */}
      {next &&
        [...next.entries()].map(([s, p]) => (
          <g key={'n' + s} className="next">
            <rect x={sx(s) + 1.5} y={sy(s) + 1.5} width={S - 3} height={S - 3} rx={3} className={'ring' + (p >= 1 ? ' sure' : p <= 0 ? ' dead' : '')} />
            <text x={cx(s)} y={sy(s) + S - 6} className="pct">
              {fmtChance(p)}
            </text>
          </g>
        ))}

      <g className="token-move" transform={`translate(${pos.x.toFixed(2)} ${pos.y.toFixed(2)})`}>
        <circle r={14} className={tokenClass} />
        <path d="M -3 -7 L -3 6 L 5 6" className="glyph" />
      </g>
    </svg>
  );
}
