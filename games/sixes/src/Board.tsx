import { fmtChance } from '@originals/game-sdk/ui';
import { ROLLS, sixOnRoll, winChance } from './math';

const W = 560;
const D = 84;
const GAP = 22;
const DIE_Y = 52;
const COL_W = 46;
const COL_Y = DIE_Y + D + 22;
const COL_H = 132;

/** Pip positions (in thirds of the face) for each face value. */
const PIPS: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};

export type Outcome = 'won' | 'lost' | 'cashed';

export interface BoardProps {
  /** Face showing on each die (null = not rolled yet). */
  faces: (number | null)[];
  /** Faces shown while the free dice tumble (null when not rolling). */
  tumble: number[] | null;
  /** Rolls still to come, counting a roll in flight. */
  rollsLeft: number;
  outcome: Outcome | null;
}

function Die({ x, y, value, kind }: { x: number; y: number; value: number | null; kind: 'free' | 'six' | 'blank' | 'dead' | 'tumble' }) {
  const s = D / 4;
  return (
    <g className={`die ${kind}`} transform={`translate(${x} ${y})`}>
      <rect width={D} height={D} rx={8} className="face" />
      {value === null ? (
        <text x={D / 2} y={D / 2 + 11} className="q">
          ?
        </text>
      ) : (
        PIPS[value].map(([c, r], i) => <circle key={i} cx={s + c * s} cy={s + r * s} r={7.5} className="pip" />)
      )}
    </g>
  );
}

/** One die's bar: its chance to show a six in the rolls left, built from one piece per roll (the bottom piece is the next roll). */
function Bar({ x, locked, rollsLeft, dead }: { x: number; locked: boolean; rollsLeft: number; dead: boolean }) {
  const pieces: { h: number; next: boolean }[] = [];
  if (!locked && !dead) for (let k = 1; k <= rollsLeft; k++) pieces.push({ h: sixOnRoll(k) * COL_H, next: k === 1 });
  let y = COL_Y + COL_H;
  return (
    <g className="bar">
      <rect x={x} y={COL_Y} width={COL_W} height={COL_H} rx={6} className={'track' + (locked ? ' full' : dead ? ' dead' : '')} />
      {pieces.map((p, i) => {
        y -= p.h;
        return <rect key={i} x={x} y={y} width={COL_W} height={p.h} className={p.next ? 'piece next' : 'piece later'} />;
      })}
    </g>
  );
}

export default function Board({ faces, tumble, rollsLeft, outcome }: BoardProps) {
  const n = faces.length;
  const x0 = (W - (n * D + (n - 1) * GAP)) / 2;
  const free = faces.filter((f) => f !== 6).length;
  const rolling = tumble !== null;
  const p = outcome === 'won' ? 1 : outcome === 'lost' ? 0 : winChance(free, rollsLeft);

  return (
    <svg viewBox={`0 0 ${W} ${COL_Y + COL_H + 8}`} className="sixes" role="img" aria-label={`${free} of ${n} dice need a six, ${rollsLeft} rolls left, win chance ${fmtChance(p)}`}>
      {/* Roll budget */}
      <text x={0} y={26} className="lbl start">
        Rolls left
      </text>
      {Array.from({ length: ROLLS }, (_, i) => (
        <circle key={i} cx={104 + i * 26} cy={20} r={9} className={'token' + (i < rollsLeft ? ' on' : '')} />
      ))}

      {/* Dice and their bars */}
      {faces.map((f, i) => {
        const x = x0 + i * (D + GAP);
        const locked = f === 6;
        const dead = outcome === 'lost' && !locked;
        const kind = locked ? 'six' : rolling ? 'tumble' : dead ? 'dead' : f === null ? 'blank' : 'free';
        const shown = rolling && !locked ? tumble[i] : f;
        const bx = x + (D - COL_W) / 2;
        return (
          <g key={i}>
            <Die x={x} y={DIE_Y} value={shown} kind={kind} />
            <Bar x={bx} locked={locked} rollsLeft={rollsLeft} dead={dead} />
          </g>
        );
      })}
    </svg>
  );
}
