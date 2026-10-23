import { fmtChance } from '@originals/game-sdk/ui';
import type { Board as Grid, MoveOdds } from './math';

const SIZE = 440;
const PAD = 8;

export interface FieldProps {
  grid: Grid;
  /** Escape chance for the runner on each cell (hunter where it is now). */
  heat: number[];
  runner: number;
  hunter: number;
  /** Where the runner and hunter have been this round. */
  trail: number[];
  hunterTrail: number[];
  /** The runner's possible next steps and their odds (only at a checkpoint). */
  moves: MoveOdds[] | null;
  /** The live odds, to colour each move up or down. */
  p: number;
  /** Shortest path from the hunter to the runner. */
  path: number[];
  /** Turns until the hunter's next move: [done, period]. */
  rhythm: [number, number];
  end: 'escaped' | 'caught' | null;
  moveMs: number;
  /** The hunter can catch the runner on the coming turn. */
  threat: boolean;
}

export default function Field({ grid, heat, runner, hunter, trail, hunterTrail, moves, p, path, rhythm, end, moveMs, threat }: FieldProps) {
  const cs = (SIZE - PAD * 2) / grid.w;
  const xy = (i: number) => ({ x: PAD + (i % grid.w) * cs + cs / 2, y: PAD + Math.floor(i / grid.w) * cs + cs / 2 });
  const pts = (cells: number[]) => cells.map((c) => `${xy(c).x.toFixed(1)},${xy(c).y.toFixed(1)}`).join(' ');
  const r = xy(runner);
  const h = xy(hunter);
  const ex = xy(grid.exit);
  const moveAt = new Map((moves ?? []).map((m) => [m.cell, m.p]));
  const small = grid.w > 5;
  const fs = small ? 11 : 13;

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className={'chase' + (small ? ' small' : '')} role="img" aria-label={`Escape chance ${fmtChance(p)}`}>
      {grid.open.map((open, i) => {
        const { x, y } = xy(i);
        const x0 = x - cs / 2 + 2;
        const y0 = y - cs / 2 + 2;
        if (!open) return <rect key={i} x={x0} y={y0} width={cs - 4} height={cs - 4} rx={6} className="wall" />;
        const v = heat[i] ?? 0;
        // The green square's area is the escape chance from this cell.
        const side = (cs - 12) * Math.sqrt(v);
        const isExit = i === grid.exit;
        return (
          <g key={i}>
            <rect x={x0} y={y0} width={cs - 4} height={cs - 4} rx={6} className={'cell' + (isExit ? ' exit' : '')} />
            {!isExit && side > 0.5 && <rect x={x - side / 2} y={y - side / 2} width={side} height={side} rx={3} className="heat" />}
            {!isExit && i !== runner && i !== hunter && !moveAt.has(i) && (
              <text x={x} y={y + 4} className="cell-p" style={{ fontSize: fs - 1 }}>
                {v > 0 && v < 0.005 ? '<1' : Math.round(v * 100)}
              </text>
            )}
          </g>
        );
      })}

      {/* The exit: a green door. */}
      <rect x={ex.x - cs / 2 + 2} y={ex.y - cs / 2 + 2} width={cs - 4} height={cs - 4} rx={6} className={'door' + (end === 'escaped' ? ' won' : '')} />
      <path d={`M ${ex.x - cs * 0.14} ${ex.y - cs * 0.16} l ${cs * 0.14} ${cs * 0.16} l ${-cs * 0.14} ${cs * 0.16} M ${ex.x + 0} ${ex.y - cs * 0.16} l ${cs * 0.14} ${cs * 0.16} l ${-cs * 0.14} ${cs * 0.16}`} className="door-mark" />

      {/* Trails and the hunter's shortest path to the runner. */}
      {hunterTrail.length > 1 && <polyline points={pts(hunterTrail)} className="h-trail" />}
      {trail.length > 1 && <polyline points={pts(trail)} className="r-trail" />}
      {path.length > 1 && !end && <polyline points={pts(path)} className="gap-path" />}

      {/* The runner's possible next steps, each equally likely, with the odds each leaves. */}
      {moves?.map((m) => {
        const c = xy(m.cell);
        const dx = (c.x - r.x) / cs;
        const dy = (c.y - r.y) / cs;
        const tone = m.p === 0 ? 'dead' : m.p > p + 1e-9 ? 'up' : m.p < p - 1e-9 ? 'down' : 'flat';
        const w = small ? 44 : 54;
        const hgt = small ? 22 : 26;
        return (
          <g key={m.cell} className={'move ' + tone}>
            <line x1={r.x + dx * cs * 0.3} y1={r.y + dy * cs * 0.3} x2={r.x + dx * cs * 0.58} y2={r.y + dy * cs * 0.58} className="arrow" />
            <rect x={c.x - w / 2} y={c.y - hgt / 2} width={w} height={hgt} rx={hgt / 2} className="badge" />
            <text x={c.x} y={c.y + (small ? 4 : 5)} style={{ fontSize: small ? 12 : 14 }}>
              {m.p === 0 ? 'caught' : m.p === 1 ? 'out' : `${m.p * 100 < 10 ? (m.p * 100).toFixed(1) : Math.round(m.p * 100)}%`}
            </text>
          </g>
        );
      })}

      {/* Hunter: a red diamond, with pips counting down to its next move. */}
      <g className={'hunter' + (end === 'caught' ? ' got' : '') + (threat ? ' threat' : '')} style={{ transform: `translate(${h.x}px, ${h.y}px)`, transitionDuration: `${moveMs}ms` }}>
        {threat && <circle r={cs * 0.36} className="ring" />}
        <rect x={-cs * 0.2} y={-cs * 0.2} width={cs * 0.4} height={cs * 0.4} rx={3} transform="rotate(45)" />
        {rhythm[1] > 1 &&
          Array.from({ length: rhythm[1] }, (_, k) => (
            <circle key={k} cx={(k - (rhythm[1] - 1) / 2) * 8} cy={cs * 0.36} r={2.6} className={'pip' + (k < rhythm[0] ? ' on' : '')} />
          ))}
      </g>

      {/* Runner: a white dot; the shading under it is the live odds. */}
      <g className={'runner' + (end ? ` ${end}` : '')} style={{ transform: `translate(${r.x}px, ${r.y}px)`, transitionDuration: `${moveMs}ms` }}>
        <circle r={cs * 0.17} />
        {end === 'caught' && <path d={`M ${-cs * 0.1} ${-cs * 0.1} L ${cs * 0.1} ${cs * 0.1} M ${cs * 0.1} ${-cs * 0.1} L ${-cs * 0.1} ${cs * 0.1}`} className="x" />}
      </g>
    </svg>
  );
}
