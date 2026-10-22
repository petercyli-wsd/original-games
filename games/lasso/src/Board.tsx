import { fmtChance } from '@originals/game-sdk/ui';
import { START, crossing, type Cell } from './math';

export type BoardOutcome = 'won' | 'sure' | 'loose' | 'reach' | 'cashed';

const GX = 20;
const GY = 20;
const GS = 360;
// Rope gauge, right of the field.
const DX = 478;
const DY = 128;
const DR = 56;

export interface BoardProps {
  field: number;
  laps: number;
  /** The cells walked so far (shown part), starting at START. */
  path: Cell[];
  w: number;
  /** Total angle swept round the pole, radians. */
  sweep: number;
  left: number;
  steps: number;
  /** Chance from every open cell, same winding and steps left. */
  heat: { cell: Cell; p: number }[];
  outcome: BoardOutcome | null;
}

export default function Board({ field, laps, path, w, sweep, left, steps, heat, outcome }: BoardProps) {
  const n = 2 * field + 1;
  const cs = GS / n;
  const px = (x: number) => GX + (x + field + 0.5) * cs;
  const py = (y: number) => GY + (field - y + 0.5) * cs;
  const maxP = Math.max(1e-12, ...heat.map((h) => h.p));
  const at = path[path.length - 1];
  const seamY = py(-0.5);
  const won = outcome === 'won' || outcome === 'sure';

  const crossings: { x: number; d: number }[] = [];
  for (let i = 1; i < path.length; i++) {
    const d = crossing(path[i - 1], path[i]);
    if (d) crossings.push({ x: path[i].x, d });
  }

  // The swept angle as a spiral: one extra lap per ring, drawn inwards.
  const spiral: string[] = [];
  const segs = Math.max(2, Math.ceil(Math.abs(sweep) / 0.05));
  for (let i = 0; i <= segs; i++) {
    const a = (sweep * i) / segs;
    const r = DR - 9 * (Math.abs(a) / (2 * Math.PI));
    spiral.push(`${(DX + r * Math.cos(a)).toFixed(1)},${(DY - r * Math.sin(a)).toFixed(1)}`);
  }
  const endA = sweep;
  const endR = DR - 9 * (Math.abs(endA) / (2 * Math.PI));
  const deg = Math.round((sweep * 180) / Math.PI);

  return (
    <svg viewBox="0 0 560 400" className="lasso" role="img" aria-label={`Rope wound ${w} times round the pole, ${left} steps left`}>
      {/* The field: each cell shaded by the chance of winning from there. */}
      <rect x={GX - 4} y={GY - 4} width={GS + 8} height={GS + 8} rx={10} className="wall" />
      {heat.map(({ cell, p }) => (
        <g key={`${cell.x},${cell.y}`}>
          <rect x={px(cell.x) - cs / 2 + 1.5} y={py(cell.y) - cs / 2 + 1.5} width={cs - 3} height={cs - 3} rx={4} className="cell" />
          <rect
            x={px(cell.x) - cs / 2 + 1.5}
            y={py(cell.y) - cs / 2 + 1.5}
            width={cs - 3}
            height={cs - 3}
            rx={4}
            className="heat"
            style={{ fillOpacity: 0.05 + 0.75 * (p / maxP) }}
          />
        </g>
      ))}

      {/* The pole. */}
      <rect x={px(0) - cs / 2 + 1.5} y={py(0) - cs / 2 + 1.5} width={cs - 3} height={cs - 3} rx={4} className="pole-cell" />
      <circle cx={px(0)} cy={py(0)} r={cs * 0.26} className="pole" />

      {/* The seam: crossing it down ties a loop, crossing it up unties one. */}
      <line x1={px(-0.5)} y1={seamY} x2={GX - 4} y2={seamY} className="seam" />
      <text x={GX + 10} y={seamY - 7} className="seam-label" textAnchor="start">
        seam
      </text>

      <circle cx={px(START.x)} cy={py(START.y)} r={cs * 0.32} className="start" />

      {path.length > 1 && <polyline points={path.map((c) => `${px(c.x)},${py(c.y)}`).join(' ')} className={'rope' + (won ? ' won' : '')} />}
      {crossings.map((c, i) => (
        <circle key={i} cx={px(c.x)} cy={seamY} r={5} className={'cross' + (c.d > 0 ? ' ccw' : ' cw')} />
      ))}
      <circle cx={px(at.x)} cy={py(at.y)} r={cs * 0.22} className={'walker' + (outcome === 'loose' || outcome === 'reach' ? ' lost' : '')} />

      {/* Rope gauge: the angle swept round the pole. */}
      <text x={DX} y={GY + 12} className="g-title">
        the rope
      </text>
      <circle cx={DX} cy={DY} r={DR} className="dial" />
      <line x1={DX - DR - 9} y1={DY} x2={DX - DR + 9} y2={DY} className="dial-seam" />
      <line x1={DX + DR - 7} y1={DY} x2={DX + DR + 7} y2={DY} className="dial-start" />
      {Math.abs(sweep) > 1e-6 && <polyline points={spiral.join(' ')} className="sweep" />}
      <circle cx={DX + endR * Math.cos(endA)} cy={DY - endR * Math.sin(endA)} r={5} className="sweep-end" />
      <text x={DX} y={DY + 4} className={'g-big' + (Math.abs(w) >= laps ? ' hit' : '')}>
        {w > 0 ? `+${w}` : w < 0 ? `−${-w}` : '0'}
      </text>
      <text x={DX} y={DY + 26} className="g-small">
        of {laps} {laps === 1 ? 'loop' : 'loops'}
      </text>
      <text x={DX} y={DY + DR + 26} className="g-mid">
        {deg > 0 ? '+' : deg < 0 ? '−' : ''}
        {Math.abs(deg)}° swept
      </text>

      <text x={DX} y={262} className="g-small">
        steps left
      </text>
      <text x={DX} y={290} className="g-mid strong">
        {left} / {steps}
      </text>
      <rect x={DX - 60} y={300} width={120} height={6} rx={3} className="bar-track" />
      <rect x={DX - 60} y={300} width={(120 * (steps - left)) / steps} height={6} rx={3} className="bar-fill" />

      {/* Legend for the shading. */}
      <defs>
        <linearGradient id="lasso-heat" x1="0" x2="1">
          <stop offset="0" className="lg0" />
          <stop offset="1" className="lg1" />
        </linearGradient>
      </defs>
      <text x={DX} y={340} className="g-small">
        shade = win chance
      </text>
      <rect x={DX - 60} y={348} width={120} height={10} rx={3} fill="url(#lasso-heat)" />
      <text x={DX - 60} y={376} className="g-tiny" textAnchor="start">
        0%
      </text>
      <text x={DX + 60} y={376} className="g-tiny" textAnchor="end">
        {fmtChance(maxP)}
      </text>
    </svg>
  );
}
