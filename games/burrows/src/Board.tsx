import { BURROWS, floor2, value, type Tap } from './math';

const compact = (x: number) => {
  const v = floor2(x);
  if (v >= 1e6) return `${floor2(v / 1e6)}M×`;
  if (v >= 1e4) return `${Math.floor(v / 100) / 10}K×`;
  return `${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`;
};

// Seven burrows in a 2-3-2 hex cluster, so every position looks equivalent.
const POS: { x: number; y: number }[] = [
  { x: 145, y: 66 },
  { x: 255, y: 66 },
  { x: 90, y: 160 },
  { x: 200, y: 160 },
  { x: 310, y: 160 },
  { x: 145, y: 254 },
  { x: 255, y: 254 },
];
const R = 42;

export interface BoardProps {
  /** Critters hidden among the seven burrows. */
  m: number;
  /** The last tap's result, once it is revealed; it stays marked until the next bet. */
  last: Tap | null;
  /** The burrow just tapped, before its result shows. */
  pending: number | null;
  clickable: boolean;
  onPick(burrow: number): void;
  /** Auto: planned taps per burrow (null in Manual). */
  counts: number[] | null;
  /** Finds so far, the finds the ladder shows (round cap, or the Auto target) and whether the last tap was empty. */
  finds: number;
  steps: number;
  lost: boolean;
}

function Critter({ x, y, found }: { x: number; y: number; found: boolean }) {
  return (
    <g className={'crit' + (found ? ' found' : '')} aria-hidden="true">
      <circle cx={x} cy={y} r={25} />
      <circle className="eye" cx={x - 9} cy={y - 4} r={3.5} />
      <circle className="eye" cx={x + 9} cy={y - 4} r={3.5} />
    </g>
  );
}

export default function Field({ m, last, pending, clickable, onPick, counts, finds, steps, lost }: BoardProps) {
  const n = Math.min(5, steps);
  const start = Math.max(1, Math.min(finds - 1, steps - n + 1));
  return (
    <svg className="burrows" viewBox="0 0 400 470" role="group" aria-label={`Seven burrows, ${m} critters hidden`}>
      {POS.map(({ x, y }, b) => {
        const tapped = last?.burrow === b;
        const state = pending === b ? 'pending' : tapped ? (last!.hit ? 'found' : 'miss') : 'idle';
        const showCritter = last ? (last.hit ? tapped : last.hidden[b]) : false;
        const cnt = counts?.[b] ?? 0;
        return (
          <g
            key={b}
            className={'hole ' + state + (clickable ? ' click' : '')}
            role={clickable ? 'button' : undefined}
            tabIndex={clickable ? 0 : undefined}
            aria-label={clickable ? `Burrow ${b + 1}` : undefined}
            onClick={clickable ? () => onPick(b) : undefined}
            onKeyDown={clickable ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onPick(b)) : undefined}
          >
            <circle cx={x} cy={y} r={R} />
            {showCritter && <Critter x={x} y={y} found={tapped && last!.hit} />}
            {cnt > 0 && !showCritter && (
              <text x={x} y={y + 6} className="count">
                {cnt}
              </text>
            )}
          </g>
        );
      })}
      {Array.from({ length: n }, (_, i) => {
        const s = start + i;
        const st = s <= finds ? 'got' : s === finds + 1 ? (lost ? 'bad' : 'next') : 'idle';
        const x = 200 + (i - (n - 1) / 2) * 78;
        return (
          <g key={s} className={'step ' + st}>
            <rect x={x - 35} y={318} width={70} height={46} rx={6} />
            <text className="stepn" x={x} y={336}>{`Find ${s}`}</text>
            <text className="stepv" x={x} y={355}>{compact(value(m, s))}</text>
          </g>
        );
      })}
      {Array.from({ length: BURROWS }, (_, i) => (
        <circle key={i} className={'pip' + (i < m ? ' on' : '')} cx={200 + (i - 3) * 26} cy={394} r={7} />
      ))}
      <text className="small" x={200} y={424}>
        {`${m} of 7 burrows hide a critter`}
      </text>
      <text className="small" x={200} y={446}>
        They re-hide before every dig
      </text>
      <text className="small" x={200} y={466}>
        {counts ? 'Number: planned digs there' : 'Green steps: finds so far'}
      </text>
    </svg>
  );
}
