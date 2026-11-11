import { fmtChance } from '@originals/game-sdk/ui';
import type { Board as Grid, Step } from './math';

const SIZE = 440;
const PAD = 8;

export interface FieldProps {
  grid: Grid;
  /** Escape chance for the runner on each square (hunter where it is now). */
  heat: number[];
  runner: number;
  hunter: number;
  /** Where the runner and hunter have been this round. */
  trail: number[];
  hunterTrail: number[];
  /** The runner's possible next steps (only at a checkpoint or in the idle preview). */
  steps: Step[] | null;
  /** The hunter's reach (a flat red tint): a runner step there is caught. Shown with the arrows. */
  reach: number[] | null;
  /** The hunter's reply, shown after the runner's step and before the hunter moves: the square(s) one step closer. */
  hunterNext: number[] | null;
  /** The live odds (for the label). */
  p: number;
  end: 'escaped' | 'caught' | null;
  moveMs: number;
}

/** An arrowhead triangle with its tip at (x, y), pointing along the unit direction (dx, dy). */
function arrowHead(x: number, y: number, dx: number, dy: number, size: number): string {
  return [
    [x, y],
    [x - dx * size * 1.4 - dy * size, y - dy * size * 1.4 + dx * size],
    [x - dx * size * 1.4 + dy * size, y - dy * size * 1.4 - dx * size],
  ]
    .map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`)
    .join(' ');
}

export default function Field({ grid, heat, runner, hunter, trail, hunterTrail, steps, reach, hunterNext, p, end, moveMs }: FieldProps) {
  const cs = (SIZE - PAD * 2) / grid.w;
  const xy = (i: number) => ({ x: PAD + (i % grid.w) * cs + cs / 2, y: PAD + Math.floor(i / grid.w) * cs + cs / 2 });
  const pts = (cells: number[]) => cells.map((c) => `${xy(c).x.toFixed(1)},${xy(c).y.toFixed(1)}`).join(' ');
  const r = xy(runner);
  const h = xy(hunter);
  const ex = xy(grid.exit);
  // The caught square keeps the same red tint, so the last result stays marked.
  const reachSet = new Set(end === 'caught' ? [runner] : (reach ?? []));

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="chase" role="img" aria-label={`Escape chance ${fmtChance(p)}`}>
      {grid.open.map((open, i) => {
        const { x, y } = xy(i);
        const x0 = x - cs / 2 + 2;
        const y0 = y - cs / 2 + 2;
        if (!open) return <rect key={i} x={x0} y={y0} width={cs - 4} height={cs - 4} rx={6} className="wall" />;
        // The green square's area is the escape chance if the runner stood here.
        const side = (cs - 12) * Math.sqrt(heat[i] ?? 0);
        return (
          <g key={i}>
            <rect x={x0} y={y0} width={cs - 4} height={cs - 4} rx={6} className={reachSet.has(i) ? 'cell reach' : 'cell'} />
            {i !== grid.exit && side > 0.5 && <rect x={x - side / 2} y={y - side / 2} width={side} height={side} rx={3} className="heat" />}
          </g>
        );
      })}

      {/* The exit: an outlined win cell. */}
      <rect x={ex.x - cs / 2 + 2} y={ex.y - cs / 2 + 2} width={cs - 4} height={cs - 4} rx={6} className={'door' + (end === 'escaped' ? ' won' : '')} />

      {/* Where the runner and the hunter have been. */}
      {hunterTrail.length > 1 && <polyline points={pts(hunterTrail)} className="trail" />}
      {trail.length > 1 && <polyline points={pts(trail)} className="trail" />}

      {/* The hunter's reply, shown before it moves: the square one step closer (or the equally close squares it picks between). */}
      {hunterNext?.map((c) => {
        const t = xy(c);
        const dx = (t.x - h.x) / cs;
        const dy = (t.y - h.y) / cs;
        const tip = { x: h.x + dx * cs * 0.8, y: h.y + dy * cs * 0.8 };
        return (
          <g key={`next-${c}`} className="h-next">
            <rect x={-cs * 0.18} y={-cs * 0.18} width={cs * 0.36} height={cs * 0.36} rx={3} transform={`translate(${t.x} ${t.y}) rotate(45)`} className="ghost" />
            <line x1={h.x + dx * cs * 0.24} y1={h.y + dy * cs * 0.24} x2={tip.x - dx * 9} y2={tip.y - dy * 9} className="shaft" />
            <polygon points={arrowHead(tip.x, tip.y, dx, dy, 9)} className="head" />
          </g>
        );
      })}

      {/* The runner's next step is a random draw among the arrows. Red = the hunter catches it, green = the exit. */}
      {steps?.map((m) => {
        const c = xy(m.cell);
        const dx = (c.x - r.x) / cs;
        const dy = (c.y - r.y) / cs;
        const tone = m.fate === 'caught' ? 'dead' : m.fate === 'out' ? 'out' : 'safe';
        const tip = { x: r.x + dx * cs * 0.88, y: r.y + dy * cs * 0.88 };
        const head = 9;
        return (
          <g key={m.cell} className={'step ' + tone}>
            <line x1={r.x + dx * cs * 0.2} y1={r.y + dy * cs * 0.2} x2={tip.x - dx * head} y2={tip.y - dy * head} className="shaft" />
            <polygon points={arrowHead(tip.x, tip.y, dx, dy, head)} className="head" />
          </g>
        );
      })}

      {/* Hunter: a red diamond. */}
      <g className="hunter" style={{ transform: `translate(${h.x}px, ${h.y}px)`, transitionDuration: `${moveMs}ms` }}>
        <rect x={-cs * 0.18} y={-cs * 0.18} width={cs * 0.36} height={cs * 0.36} rx={3} transform="rotate(45)" />
      </g>

      {/* Runner: an accent dot. */}
      <g className={'runner' + (end ? ` ${end}` : '')} style={{ transform: `translate(${r.x}px, ${r.y}px)`, transitionDuration: `${moveMs}ms` }}>
        <circle r={cs * 0.17} />
        {end === 'caught' && <path d={`M ${-cs * 0.1} ${-cs * 0.1} L ${cs * 0.1} ${cs * 0.1} M ${cs * 0.1} ${-cs * 0.1} L ${-cs * 0.1} ${cs * 0.1}`} className="x" />}
      </g>
    </svg>
  );
}
