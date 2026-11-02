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
  /** The hunter's reach (dashed red squares): a runner step there is caught. Shown with the arrows. */
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
  const k = steps?.length ?? 0;

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
            <rect x={x0} y={y0} width={cs - 4} height={cs - 4} rx={6} className="cell" />
            {i !== grid.exit && side > 0.5 && <rect x={x - side / 2} y={y - side / 2} width={side} height={side} rx={3} className="heat" />}
          </g>
        );
      })}

      {/* The exit: a green door. */}
      <rect x={ex.x - cs / 2 + 2} y={ex.y - cs / 2 + 2} width={cs - 4} height={cs - 4} rx={6} className={'door' + (end === 'escaped' ? ' won' : '')} />
      <path
        d={`M ${ex.x - cs * 0.14} ${ex.y - cs * 0.16} l ${cs * 0.14} ${cs * 0.16} l ${-cs * 0.14} ${cs * 0.16} M ${ex.x} ${ex.y - cs * 0.16} l ${cs * 0.14} ${cs * 0.16} l ${-cs * 0.14} ${cs * 0.16}`}
        className="door-mark"
      />

      {/* Where the runner and the hunter have been. */}
      {hunterTrail.length > 1 && <polyline points={pts(hunterTrail)} className="h-trail" />}
      {trail.length > 1 && <polyline points={pts(trail)} className="r-trail" />}

      {/* The hunter's reach: if the runner steps onto one of these squares, the hunter steps onto it next. */}
      {reach?.map((c) => {
        const { x, y } = xy(c);
        return <rect key={`reach-${c}`} x={x - cs / 2 + 6} y={y - cs / 2 + 6} width={cs - 12} height={cs - 12} rx={5} className="reach" />;
      })}

      {/* The hunter's reply, shown before it moves: the square one step closer (or the equally close squares it picks between). */}
      {hunterNext?.map((c) => {
        const t = xy(c);
        const dx = (t.x - h.x) / cs;
        const dy = (t.y - h.y) / cs;
        const tip = { x: h.x + dx * cs * 0.8, y: h.y + dy * cs * 0.8 };
        const mid = { x: h.x + dx * cs * 0.5, y: h.y + dy * cs * 0.5 };
        const many = hunterNext.length > 1;
        return (
          <g key={`next-${c}`} className="h-next">
            <rect x={-cs * 0.18} y={-cs * 0.18} width={cs * 0.36} height={cs * 0.36} rx={3} transform={`translate(${t.x} ${t.y}) rotate(45)`} className="ghost" />
            <line x1={h.x + dx * cs * 0.24} y1={h.y + dy * cs * 0.24} x2={tip.x - dx * 9} y2={tip.y - dy * 9} className="shaft" />
            <polygon points={arrowHead(tip.x, tip.y, dx, dy, 9)} className="head" />
            {many && (
              <>
                <rect x={mid.x - 23} y={mid.y - 11} width={46} height={22} rx={11} className="badge" />
                <text x={mid.x} y={mid.y + 4.5}>
                  1 in {hunterNext.length}
                </text>
              </>
            )}
          </g>
        );
      })}

      {/* The runner's next step is a random draw: k arrows, 1 in k each. Red = the hunter catches it, green = the exit. */}
      {steps?.map((m) => {
        const c = xy(m.cell);
        const dx = (c.x - r.x) / cs;
        const dy = (c.y - r.y) / cs;
        const tone = m.fate === 'caught' ? 'dead' : m.fate === 'out' ? 'out' : 'safe';
        const tip = { x: r.x + dx * cs * 0.88, y: r.y + dy * cs * 0.88 };
        const head = 9;
        const headPts = arrowHead(tip.x, tip.y, dx, dy, head);
        const mid = { x: r.x + dx * cs * 0.5, y: r.y + dy * cs * 0.5 };
        const w = 46;
        const hgt = 22;
        return (
          <g key={m.cell} className={'step ' + tone}>
            <line x1={r.x + dx * cs * 0.2} y1={r.y + dy * cs * 0.2} x2={tip.x - dx * head} y2={tip.y - dy * head} className="shaft" />
            <polygon points={headPts} className="head" />
            <rect x={mid.x - w / 2} y={mid.y - hgt / 2} width={w} height={hgt} rx={hgt / 2} className="badge" />
            <text x={mid.x} y={mid.y + 4.5}>
              1 in {k}
            </text>
          </g>
        );
      })}

      {/* Hunter: a red diamond. */}
      <g className={'hunter' + (end === 'caught' ? ' got' : '')} style={{ transform: `translate(${h.x}px, ${h.y}px)`, transitionDuration: `${moveMs}ms` }}>
        <rect x={-cs * 0.18} y={-cs * 0.18} width={cs * 0.36} height={cs * 0.36} rx={3} transform="rotate(45)" />
      </g>

      {/* Runner: a white dot; the shading under it is the live odds. */}
      <g className={'runner' + (end ? ` ${end}` : '')} style={{ transform: `translate(${r.x}px, ${r.y}px)`, transitionDuration: `${moveMs}ms` }}>
        <circle r={cs * 0.17} />
        {end === 'caught' && <path d={`M ${-cs * 0.1} ${-cs * 0.1} L ${cs * 0.1} ${cs * 0.1} M ${cs * 0.1} ${-cs * 0.1} L ${-cs * 0.1} ${cs * 0.1}`} className="x" />}
      </g>
    </svg>
  );
}
