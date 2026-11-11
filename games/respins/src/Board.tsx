import { CELLS, TARGET } from './math';

export type Phase = 'idle' | 'spinning' | 'checkpoint' | 'over';
export type Outcome = 'won' | 'cashed' | 'lost';

const COLS = 5;
const CELL = 64;
const GAP = 8;
const X0 = 24;
const Y0 = 60;
const cx = (i: number) => X0 + (i % COLS) * (CELL + GAP);
const cy = (i: number) => Y0 + Math.floor(i / COLS) * (CELL + GAP);

export interface BoardProps {
  /** Which cells hold a coin. */
  full: readonly boolean[];
  /** Respins left, and the most there can be. */
  respins: number;
  maxRespins: number;
  /** The cell the spotlight is on while a spin is under way. */
  spot: number | null;
  /** The cell the last spin landed on, and whether it took a coin. It stays marked. */
  last: { cell: number; hit: boolean } | null;
  /** Two short lines: what just happened, and why the chance moved. */
  message: [string, string];
  svgRef?: (el: SVGSVGElement | null) => void;
}

export default function Board({ full, respins, maxRespins, spot, last, message, svgRef }: BoardProps) {
  const coins = full.reduce((a, b) => a + (b ? 1 : 0), 0);
  const empty = CELLS - coins;
  return (
    <svg ref={svgRef} className="rsp" viewBox="0 0 400 372" role="img" aria-label={`${coins} of ${TARGET} coins, ${respins} respins left`}>
      <text x={24} y={32} className="lab" textAnchor="start">
        Respins
      </text>
      {Array.from({ length: maxRespins }, (_, i) => (
        <circle key={i} cx={104 + i * 26} cy={27} r={8} className={i < respins ? 'lamp on' : 'lamp off'} />
      ))}
      <text x={376} y={32} className="lab" textAnchor="end">
        Coins {coins} / {TARGET}
      </text>

      {Array.from({ length: CELLS }, (_, i) => {
        const mark = spot === i ? 'spot' : spot === null && last?.cell === i ? (last.hit ? 'hit' : 'miss') : '';
        return (
          <g key={i}>
            <rect x={cx(i)} y={cy(i)} width={CELL} height={CELL} rx={6} className={'cell ' + (full[i] ? 'full' : 'empty') + (mark ? ' ' + mark : '')} />
            {full[i] && <circle cx={cx(i) + CELL / 2} cy={cy(i) + CELL / 2} r={20} className="coin" />}
          </g>
        );
      })}

      <text x={200} y={298} className="lab" textAnchor="middle">
        Next spin: {empty} of {CELLS} cells are empty
      </text>
      <text x={200} y={326} className="msg" textAnchor="middle">
        {message[0]}
      </text>
      <text x={200} y={350} className="msg" textAnchor="middle">
        {message[1]}
      </text>
    </svg>
  );
}
