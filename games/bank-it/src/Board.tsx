import { useEffect, useState } from 'react';
import { TURNS } from './math';

const W = 480;
export const BOARD_H = 250;
const PAD = 12;

// Pip positions on a 3x3 grid (0..2) for each face.
const PIPS: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};

export interface BoardProps {
  /** Target in points. */
  k: number;
  banked: number;
  pot: number;
  /** A pot the last wipe took (kept on show until the next roll). */
  lost: number;
  /** Turns left, this one included. */
  turns: number;
  /** The die on show (null before the first roll). */
  face: number | null;
  tumbling: boolean;
  /** The outcome of the round on show (marks the final face). */
  outcome: 'won' | 'lost' | 'cashed' | null;
  /** Transition time for the bar, in ms. */
  ms: number;
}

export default function Board({ k, banked, pot, lost, turns, face, tumbling, outcome, ms }: BoardProps) {
  // Cosmetic tumbling faces while the die is in the air (the result is already decided).
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!tumbling) return;
    const id = window.setInterval(() => setFrame((f) => f + 1), 70);
    return () => window.clearInterval(id);
  }, [tumbling]);
  const shown = tumbling ? ((frame * 5) % 6) + 1 : face;

  // ---- Score bar: banked (solid) then pot (light), out of the target ----
  const bx = PAD;
  const bw = W - 2 * PAD;
  const by = 34;
  const bh = 28;
  const unit = bw / k;
  const bankedW = Math.min(banked, k) * unit;
  const potW = Math.min(pot, Math.max(0, k - banked)) * unit;
  const lostW = Math.min(lost, Math.max(0, k - banked)) * unit;
  const tr = { transitionDuration: `${ms}ms` };

  // ---- Die and its six faces ----
  const dy = 84;
  const dieSize = 56;
  const step = dieSize / 4;
  const cellW = 56;
  const cellGap = 6;
  const cx0 = W - PAD - (6 * cellW + 5 * cellGap);
  const landed = face !== null && !tumbling;

  return (
    <svg viewBox={`0 0 ${W} ${BOARD_H}`} className="bank" role="img" aria-label={`Banked ${banked}, pot ${pot}, goal ${k}, ${turns} turns left`}>
      {/* Score bar */}
      <text x={bx} y={22} className="lab acc">{`Banked ${banked}`}</text>
      <text x={W / 2} y={22} className="lab mid">{`Pot ${pot}`}</text>
      <text x={W - PAD} y={22} className="lab end">{`Goal ${k}`}</text>
      <rect x={bx} y={by} width={bw} height={bh} rx={4} className="track" />
      {lostW > 0 && <rect x={bx + bankedW} y={by} width={lostW} height={bh} className="lost" />}
      <rect x={bx} y={by} width={bankedW} height={bh} rx={4} className="banked" style={tr} />
      <rect x={bx + bankedW} y={by} width={potW} height={bh} className="pot" style={tr} />
      <text x={bx} y={by + bh + 14} className="tick">0</text>
      <text x={W - PAD} y={by + bh + 14} className="tick end">{k}</text>

      {/* The die: pips of the last roll */}
      <g className="die">
        <rect x={PAD} y={dy} width={dieSize} height={dieSize} rx={6} className="die-body" />
        {shown === null ? (
          <text x={PAD + dieSize / 2} y={dy + dieSize / 2 + 9} className="die-blank">?</text>
        ) : (
          PIPS[shown].map(([px, py], i) => <circle key={i} cx={PAD + step * (px + 1)} cy={dy + step * (py + 1)} r={dieSize / 11} className="pip" />)
        )}
      </g>

      {/* Six equal faces: red wipes the pot, green adds its number */}
      {[1, 2, 3, 4, 5, 6].map((f, i) => {
        const x = cx0 + i * (cellW + cellGap);
        const wipe = f <= 2;
        const hit = landed && face === f;
        const cls = 'face ' + (wipe ? 'wipe' : 'add') + (hit ? ' hit' : landed ? ' dim' : '');
        return (
          <g key={f} className={cls}>
            <title>{wipe ? `Roll ${f}: pot wiped` : `Roll ${f}: pot grows by ${f}`}</title>
            <rect x={x} y={dy} width={cellW} height={dieSize} rx={6} className="cell" />
            <text x={x + cellW / 2} y={dy + 26} className="fnum">{f}</text>
            <text x={x + cellW / 2} y={dy + 45} className="fsub">{wipe ? 'wipe' : `+${f}`}</text>
          </g>
        );
      })}
      {landed && face !== null && (
        <rect x={cx0 + (face - 1) * (cellW + cellGap) - 2} y={dy - 2} width={cellW + 4} height={dieSize + 4} rx={8} className={'hit-frame' + (face <= 2 ? ' bad' : '')} />
      )}

      {/* Unit key */}
      <text x={W / 2} y={170} className="key">Green grows the pot, red wipes it</text>
      <text x={W / 2} y={188} className="key">Bank keeps the pot, ends the turn</text>

      {/* Turn pips */}
      <text x={PAD} y={229} className="lab">Turns left</text>
      {Array.from({ length: TURNS }, (_, i) => {
        const used = i < TURNS - turns;
        const current = i === TURNS - turns && outcome === null;
        return (
          <g key={i}>
            {current && <circle cx={118 + i * 28} cy={224} r={13} className="pip-ring" />}
            <circle cx={118 + i * 28} cy={224} r={8} className={used ? 'tp off' : 'tp on'} />
          </g>
        );
      })}
    </svg>
  );
}
