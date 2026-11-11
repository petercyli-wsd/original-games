import { fmtChance } from '@originals/game-sdk/ui';
import type { End, Maze, MoveOdds } from './math';

const SIZE = 440;
const PAD = 10;

export interface FieldProps {
  maze: Maze;
  /** Where the ball is drawn. */
  ball: number;
  /** The chosen start cell (ringed). */
  start: number;
  /** Cells the ball has visited this round, in order. */
  trail: number[];
  /** The possible next moves (only at a checkpoint): their cells are outlined. */
  moves: MoveOdds[] | null;
  /** The live odds. */
  p: number;
  end: End;
  moveMs: number;
  /** Cells may be clicked to choose the start. */
  pickable: ((cell: number) => boolean) | null;
  onPick(cell: number): void;
}

/** Diverging flat shade: neutral at 50%, towards lose at 0% and towards win at 100%. */
const shade = (h: number) => `color-mix(in srgb, var(${h < 0.5 ? '--lose' : '--win'}) ${(8 + 44 * Math.abs(h - 0.5) * 2).toFixed(1)}%, var(--hover))`;

export default function Field({ maze: m, ball, start, trail, moves, p, end, moveMs, pickable, onPick }: FieldProps) {
  const cs = (SIZE - PAD * 2) / m.w;
  const x0 = (c: number) => PAD + (c % m.w) * cs;
  const y0 = (c: number) => PAD + Math.floor(c / m.w) * cs;
  const cx = (c: number) => x0(c) + cs / 2;
  const cy = (c: number) => y0(c) + cs / 2;
  const wall = Math.max(3, cs * 0.07);
  const cells = [...Array(m.w * m.h).keys()];
  const recent = trail.slice(-40);

  // Walls: the right and bottom side of each cell where there is no gap, plus the frame.
  const walls: string[] = [];
  for (const c of cells) {
    const x = c % m.w;
    const y = Math.floor(c / m.w);
    if (x < m.w - 1 && !m.nbrs[c].includes(c + 1)) walls.push(`M${x0(c) + cs} ${y0(c)}v${cs}`);
    if (y < m.h - 1 && !m.nbrs[c].includes(c + m.w)) walls.push(`M${x0(c)} ${y0(c) + cs}h${cs}`);
  }

  const cross = cs * 0.14;

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className={'maze' + (pickable ? ' picking' : '')} role="img" aria-label={`Win chance ${fmtChance(p)}`}>
      {/* The odds map: each cell is shaded from lose (0%) to win (100%) by its exact chance. */}
      {cells.map((c) => {
        const isExit = c === m.exit;
        const isTrap = m.traps.includes(c);
        const can = pickable?.(c) ?? false;
        const hit = (isExit && end === 'exit') || (isTrap && end === 'trap');
        return (
          <g key={c} className={'cell' + (can ? ' can' : '') + (pickable && !can ? ' cannot' : '')} onClick={can ? () => onPick(c) : undefined}>
            <rect
              x={x0(c) + 1.5}
              y={y0(c) + 1.5}
              width={cs - 3}
              height={cs - 3}
              rx={4}
              className={'tile' + (isExit ? ' exit' : isTrap ? ' trap' : '') + (hit ? ' hit' : '')}
              style={isExit || isTrap ? undefined : { fill: shade(m.odds[c]) }}
            />
          </g>
        );
      })}

      {/* Exit: a win dot; traps: a lose cross. */}
      <circle cx={cx(m.exit)} cy={cy(m.exit)} r={cs * 0.14} className="exit-mark" />
      {m.traps.map((t) => (
        <path key={t} d={`M${cx(t) - cross} ${cy(t) - cross}l${cross * 2} ${cross * 2}M${cx(t) + cross} ${cy(t) - cross}l${-cross * 2} ${cross * 2}`} className="trap-mark" />
      ))}

      <path d={walls.join('')} className="walls" style={{ strokeWidth: wall }} />
      <rect x={PAD} y={PAD} width={SIZE - 2 * PAD} height={SIZE - 2 * PAD} rx={4} className="frame" style={{ strokeWidth: wall + 1 }} />

      {/* Start ring and the ball's trail. */}
      <circle cx={cx(start)} cy={cy(start)} r={cs * 0.34} className="start-ring" />
      {recent.length > 1 && <polyline points={recent.map((c) => `${cx(c).toFixed(1)},${cy(c).toFixed(1)}`).join(' ')} className="trail" />}

      {/* The ball's possible next moves: the cells it can roll to are outlined in the accent. */}
      {moves?.map((mv) => (
        <rect key={mv.cell} x={x0(mv.cell) + 4} y={y0(mv.cell) + 4} width={cs - 8} height={cs - 8} rx={4} className="next" />
      ))}

      {/* The ball. */}
      <g className={'ball' + (end ? ` ${end}` : '')} style={{ transform: `translate(${cx(ball)}px, ${cy(ball)}px)`, transitionDuration: `${moveMs}ms` }}>
        <circle r={cs * 0.2} className="core" />
      </g>
    </svg>
  );
}
