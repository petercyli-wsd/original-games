import { CELL, TILES, factorAt, ways, type Difficulty } from './math';

// A 4×4 frame of 12 tiles (Start, then dice totals 2-12) round a centre panel holding the dice and the value.
const CS = 90; // cell size
const GAP = 6;
const M = (400 - (4 * CS + 3 * GAP)) / 2;
const at = (j: number) => {
  const [c, r] = CELL[j];
  return { x: M + c * (CS + GAP), y: M + r * (CS + GAP) };
};

// Pip layout for a die face, on a 3×3 grid (0 = left/top, 2 = right/bottom).
const PIPS: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};

function Die({ x, y, face }: { x: number; y: number; face: number }) {
  const S = 50;
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width={S} height={S} rx={6} className="die-body" />
      {PIPS[face].map(([c, r], i) => (
        <circle key={i} cx={12 + c * 13} cy={12 + r * 13} r={4.6} className="pip" />
      ))}
    </g>
  );
}

export type BoardMode = 'idle' | 'live' | 'bitten' | 'cashed' | 'returned';

export interface BoardProps {
  d: Difficulty;
  /** Where the token is drawn (moves square by square while rolling). */
  token: number;
  mode: BoardMode;
  hopMs: number;
  dice: [number, number];
  /** The square last landed on; it stays marked until the next round. */
  landed: { square: number; id: number } | null;
  value: number;
  valueLabel: string;
  footer: string;
}

const fmtFactor = (f: number) => f.toFixed(2) + '×';

export default function Board({ d, token, mode, hopMs, dice, landed, value, valueLabel, footer }: BoardProps) {
  const t = at(token);
  const centre = M + CS + GAP;
  const centreSize = 2 * CS + GAP;

  return (
    <svg viewBox="0 0 400 400" className={`snk mode-${mode}`} role="img" aria-label={`Dice ring, token on tile ${token}`}>
      {Array.from({ length: TILES }, (_, j) => {
        const { x, y } = at(j);
        const f = factorAt(d, j);
        const pit = j > 0 && f === 0;
        const tone = j === 0 ? 'start' : pit ? 'pit' : f >= 1 ? 'up' : 'down';
        const isLanded = landed?.square === j;
        const w = j === 0 ? 0 : ways(j + 1);
        return (
          <g key={j} className={`sq ${tone}` + (isLanded ? ' landed' : '')}>
            <rect x={x} y={y} width={CS} height={CS} rx={8} className="sq-bg" />
            <text x={x + 8} y={y + 17} className="start">
              {j === 0 ? 'Start' : j + 1}
            </text>
            {j > 0 && (
              <text x={x + CS / 2} y={y + CS / 2 + 8} className="factor">
                {pit ? 'Pit' : fmtFactor(f)}
              </text>
            )}
            {/* Dots: how many of the 36 dice pairs make this total. */}
            {Array.from({ length: w }, (_, i) => (
              <circle key={i} cx={x + CS / 2 + (i - (w - 1) / 2) * 9} cy={y + CS - 16} r={3} className="way" />
            ))}
            {isLanded && <rect x={x} y={y} width={CS} height={CS} rx={8} className="mark" />}
          </g>
        );
      })}

      {/* The centre: value, dice and the unit key. */}
      <rect x={centre} y={centre} width={centreSize} height={centreSize} rx={8} className="centre" />
      <text x={200} y={centre + 26} className="c-label">
        {valueLabel}
      </text>
      <text x={200} y={centre + 60} className="c-value">
        {value >= 1000 ? Math.round(value).toLocaleString('en-US') : value.toFixed(2)}×
      </text>
      <Die x={200 - 56} y={centre + 76} face={dice[0]} />
      <Die x={200 + 6} y={centre + 76} face={dice[1]} />
      <text x={200} y={centre + 150} className="c-foot">
        Dots: ways out of 36
      </text>
      <text x={200} y={centre + 168} className="c-foot">
        {footer}
      </text>

      {/* The token: an accent dot that moves cell to cell. */}
      <g className="token" style={{ transform: `translate(${t.x}px, ${t.y}px)`, transitionDuration: `${Math.round(hopMs * 0.85)}ms` }}>
        <circle cx={CS - 16} cy={16} r={8} className="token-puck" />
      </g>
    </svg>
  );
}
