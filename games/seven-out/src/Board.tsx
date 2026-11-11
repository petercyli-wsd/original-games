import { SEVEN_WAYS, greenCells, isLit, popcount, type Roll } from './math';

export type Phase = 'idle' | 'rolling' | 'checkpoint' | 'over';
export type Outcome = 'won' | 'lost' | 'cashed';

export const VIEW = { w: 400, h: 452 };
const CELL = 40;
const GRID = { x: 80, y: 150 };
const BAR = { x: 16, y: 412, w: 368, h: 16 };

export interface BoardProps {
  k: number;
  /** Lit totals as of the roll on show. */
  mask: number;
  /** The roll that last landed (stays marked), or null before the first. */
  last: Roll | null;
  /** Faces on show while the dice are tumbling. */
  tumble: { a: number; b: number } | null;
  phase: Phase;
  outcome: Outcome | null;
  /** The totals made, in the order they were rolled. */
  made: readonly number[];
  narrow?: boolean;
  svgRef?: (el: SVGSVGElement | null) => void;
}

export default function Board({ k, mask, last, tumble, phase, outcome, made, narrow, svgRef }: BoardProps) {
  const g = greenCells(mask);
  const j = popcount(mask);
  const faces = tumble ?? (last ? { a: last.a, b: last.b } : null);
  const total = tumble || !last ? null : last.t;
  const totalClass = last?.kind === 'seven' ? 'seven' : last?.kind === 'repeat' ? 'repeat' : 'new';

  // The live cells: green cells against the 6 red ones. With one total left this is the win chance itself.
  const barG = (g / (g + SEVEN_WAYS)) * BAR.w;
  const slotW = Math.min(36, (368 - (k - 1) * 4) / k);
  const slotsW = k * slotW + (k - 1) * 4;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${VIEW.w} ${VIEW.h}`}
      className={'so' + (outcome ? ` over ${outcome}` : '') + (narrow ? ' narrow' : '')}
      role="img"
      aria-label={`${j} of ${k} totals made, ${g} green cells against ${SEVEN_WAYS} red`}
    >
      {/* The dice: the roll that just landed, or tumbling. */}
      <rect x={118} y={10} width={52} height={52} rx={8} className="die" />
      <rect x={186} y={10} width={52} height={52} rx={8} className="die" />
      <text x={144} y={46} className="die-n">
        {faces ? faces.a : '?'}
      </text>
      <text x={212} y={46} className="die-n">
        {faces ? faces.b : '?'}
      </text>
      <text x={258} y={46} className="die-eq">
        =
      </text>
      <text x={314} y={50} className={'die-total ' + (total === null ? 'none' : totalClass)}>
        {total === null ? (tumble ? '' : '·') : total}
      </text>

      {/* The target: one slot per total you need. A made total fills the next slot. */}
      <text x={200} y={90} className="lab">
        {outcome === 'won' ? `all ${k} totals made` : `totals made: ${j} of ${k}`}
      </text>
      {Array.from({ length: k }, (_, i) => {
        const x = 200 - slotsW / 2 + i * (slotW + 4);
        const t = made[i];
        return (
          <g key={`${k}-${i}`}>
            <rect x={x} y={98} width={slotW} height={30} rx={6} className={'slot' + (t !== undefined ? ' made' : '')} />
            {t !== undefined && (
              <text x={x + slotW / 2} y={119} className="slot-n">
                {t}
              </text>
            )}
          </g>
        );
      })}

      {/* All 36 face pairs. Red: the 6 that make a 7. Green: totals not yet made. Grey: made. */}
      {Array.from({ length: 36 }, (_, i) => {
        const a = Math.floor(i / 6) + 1;
        const b = (i % 6) + 1;
        const t = a + b;
        const cls = t === 7 ? 'cell seven' : isLit(mask, t) ? 'cell lit' : 'cell open';
        const x = GRID.x + (b - 1) * CELL;
        const y = GRID.y + (a - 1) * CELL;
        return (
          <g key={i}>
            <rect x={x + 1.5} y={y + 1.5} width={CELL - 3} height={CELL - 3} rx={4} className={cls} />
            <text x={x + CELL / 2} y={y + CELL / 2 + 5.5} className={'cell-n ' + cls.slice(5)}>
              {t}
            </text>
          </g>
        );
      })}
      {/* The last roll stays outlined, win or lose, until the next bet. */}
      {last && !tumble && (
        <rect
          x={GRID.x + (last.b - 1) * CELL + 1}
          y={GRID.y + (last.a - 1) * CELL + 1}
          width={CELL - 2}
          height={CELL - 2}
          rx={5}
          className={'mark ' + totalClass}
        />
      )}

      {/* Green cells against red cells: the next roll that counts is new with chance green / (green + red). */}
      <text x={BAR.x} y={BAR.y - 8} className="bar-cap win">
        {g} green cells
      </text>
      <text x={BAR.x + BAR.w} y={BAR.y - 8} className="bar-cap lose end">
        {SEVEN_WAYS} red
      </text>
      <rect x={BAR.x} y={BAR.y} width={BAR.w} height={BAR.h} rx={4} className="bar-bg" />
      <rect x={BAR.x} y={BAR.y} width={barG} height={BAR.h} rx={4} className="bar-win" style={{ width: barG }} />
      <rect x={BAR.x + barG} y={BAR.y} width={BAR.w - barG} height={BAR.h} rx={4} className="bar-lose" style={{ x: BAR.x + barG, width: BAR.w - barG }} />
      {phase === 'idle' && null}
    </svg>
  );
}
