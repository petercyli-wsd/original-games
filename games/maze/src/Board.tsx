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
  /** The possible next moves and the odds each leaves (only at a checkpoint). */
  moves: MoveOdds[] | null;
  /** The live odds, to colour each move up or down. */
  p: number;
  end: End;
  moveMs: number;
  /** Cells may be clicked to choose the start. */
  pickable: ((cell: number) => boolean) | null;
  onPick(cell: number): void;
}

/** Diverging shade: grey at 50%, deepening to red towards 0% and to green towards 100%. */
const shade = (h: number) => `color-mix(in srgb, var(${h < 0.5 ? '--red' : '--green'}) ${(8 + 44 * Math.abs(h - 0.5) * 2).toFixed(1)}%, var(--hover))`;

const pct = (v: number) => (v >= 0.995 && v < 1 ? '99' : v > 0 && v < 0.01 ? '<1' : String(Math.round(v * 100)));

export default function Field({ maze: m, ball, start, trail, moves, p, end, moveMs, pickable, onPick }: FieldProps) {
  const cs = (SIZE - PAD * 2) / m.w;
  const x0 = (c: number) => PAD + (c % m.w) * cs;
  const y0 = (c: number) => PAD + Math.floor(c / m.w) * cs;
  const cx = (c: number) => x0(c) + cs / 2;
  const cy = (c: number) => y0(c) + cs / 2;
  const moveAt = new Map((moves ?? []).map((mv) => [mv.cell, mv.p]));
  const fs = Math.round(cs * 0.24);
  const wall = Math.max(3, cs * 0.07);
  const cells = [...Array(m.w * m.h).keys()];
  const recent = trail.slice(-40);
  // Tension cue: a trap or the exit one move from the ball.
  const nearTrap = !end && m.nbrs[ball].some((v) => m.traps.includes(v));
  const nearExit = !end && m.nbrs[ball].includes(m.exit);

  // Walls: the right and bottom side of each cell where there is no gap, plus the frame.
  const walls: string[] = [];
  for (const c of cells) {
    const x = c % m.w;
    const y = Math.floor(c / m.w);
    if (x < m.w - 1 && !m.nbrs[c].includes(c + 1)) walls.push(`M${x0(c) + cs} ${y0(c)}v${cs}`);
    if (y < m.h - 1 && !m.nbrs[c].includes(c + m.w)) walls.push(`M${x0(c)} ${y0(c) + cs}h${cs}`);
  }

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className={'maze' + (pickable ? ' picking' : '')} role="img" aria-label={`Win chance ${fmtChance(p)}`}>
      {/* The odds map: each cell is shaded from red (0%) to green (100%) by its exact chance, and labelled with it. */}
      {cells.map((c) => {
        const h = m.odds[c];
        const isExit = c === m.exit;
        const isTrap = m.traps.includes(c);
        const can = pickable?.(c) ?? false;
        return (
          <g key={c} className={'cell' + (can ? ' can' : '') + (pickable && !can ? ' cannot' : '')} onClick={can ? () => onPick(c) : undefined}>
            <rect
              x={x0(c) + 1.5}
              y={y0(c) + 1.5}
              width={cs - 3}
              height={cs - 3}
              rx={4}
              className={'tile' + (isExit ? ' exit' : isTrap ? ' trap' : '')}
              style={isExit || isTrap ? undefined : { fill: shade(h) }}
            />
            {/* A thin gauge along the bottom of the cell: its filled width is the chance. */}
            {!isExit && !isTrap && <rect x={x0(c) + 6} y={y0(c) + cs - 9} width={(cs - 12) * h} height={3} rx={1.5} className="gauge" />}
            {!isExit && !isTrap && c !== ball && !moveAt.has(c) && (
              <text x={cx(c)} y={cy(c) + fs * 0.36} className="cell-p" style={{ fontSize: fs }}>
                {pct(h)}
              </text>
            )}
          </g>
        );
      })}

      {/* Exit: a green square door; traps: red holes. */}
      <g className={'exit-mark' + (end === 'exit' ? ' won' : nearExit ? ' near' : '')}>
        <rect x={x0(m.exit) + cs * 0.22} y={y0(m.exit) + cs * 0.22} width={cs * 0.56} height={cs * 0.56} rx={4} />
        <path d={`M${cx(m.exit) - cs * 0.1} ${cy(m.exit) + cs * 0.1} L${cx(m.exit) + cs * 0.1} ${cy(m.exit) - cs * 0.1} M${cx(m.exit) - cs * 0.04} ${cy(m.exit) - cs * 0.1} H${cx(m.exit) + cs * 0.1} V${cy(m.exit) + cs * 0.04}`} />
      </g>
      {m.traps.map((t) => (
        <g key={t} className={'trap-mark' + (end === 'trap' && ball === t ? ' got' : !end && m.nbrs[ball].includes(t) ? ' near' : '')}>
          <circle cx={cx(t)} cy={cy(t)} r={cs * 0.3} className="ring" />
          <circle cx={cx(t)} cy={cy(t)} r={cs * 0.18} className="hole" />
        </g>
      ))}

      <path d={walls.join('')} className="walls" style={{ strokeWidth: wall }} />
      <rect x={PAD} y={PAD} width={SIZE - 2 * PAD} height={SIZE - 2 * PAD} rx={4} className="frame" style={{ strokeWidth: wall + 1 }} />

      {/* Start ring and the ball's trail. */}
      <circle cx={cx(start)} cy={cy(start)} r={cs * 0.34} className="start-ring" />
      {recent.length > 1 && <polyline points={recent.map((c) => `${cx(c).toFixed(1)},${cy(c).toFixed(1)}`).join(' ')} className="trail" />}

      {/* The ball's possible next moves, 1 in n each, with the odds each would leave. */}
      {moves?.map((mv) => {
        const dx = (cx(mv.cell) - cx(ball)) / cs;
        const dy = (cy(mv.cell) - cy(ball)) / cs;
        const tone = mv.p === 0 ? 'dead' : mv.p === 1 ? 'out' : mv.p > p + 1e-9 ? 'up' : mv.p < p - 1e-9 ? 'down' : 'flat';
        const w = Math.min(cs - 6, 52);
        const hgt = Math.min(cs * 0.42, 24);
        const label = mv.p === 0 ? 'trap' : mv.p === 1 ? 'exit' : `${mv.p < 0.1 ? (mv.p * 100).toFixed(1) : Math.round(mv.p * 100)}%`;
        return (
          <g key={mv.cell} className={'move ' + tone}>
            <line x1={cx(ball) + dx * cs * 0.24} y1={cy(ball) + dy * cs * 0.24} x2={cx(ball) + dx * cs * 0.5} y2={cy(ball) + dy * cs * 0.5} className="arrow" />
            <rect x={cx(mv.cell) - w / 2} y={cy(mv.cell) - hgt / 2} width={w} height={hgt} rx={hgt / 2} className="badge" />
            <text x={cx(mv.cell)} y={cy(mv.cell) + hgt * 0.2} style={{ fontSize: Math.min(13, cs * 0.22) }}>
              {label}
            </text>
          </g>
        );
      })}

      {/* The ball. The number on it is the live chance. */}
      <g className={'ball' + (end ? ` ${end}` : '')} style={{ transform: `translate(${cx(ball)}px, ${cy(ball)}px)`, transitionDuration: `${moveMs}ms` }}>
        {(nearTrap || nearExit) && <circle r={cs * 0.4} className={'halo ' + (nearTrap ? 'danger' : 'close')} />}
        <circle r={cs * 0.27} className="core" />
        {!end && (
          <text y={fs * 0.34} style={{ fontSize: fs * 0.92 }}>
            {pct(m.odds[ball])}
          </text>
        )}
      </g>
    </svg>
  );
}
