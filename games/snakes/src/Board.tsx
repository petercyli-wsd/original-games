import { CELL, SQUARES, factorAt, landingWays, type Difficulty } from './math';

// A 4×4 frame of 12 squares round a centre panel holding the dice and the value.
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

function Die({ x, y, face, tumbling, flip }: { x: number; y: number; face: number; tumbling: boolean; flip: boolean }) {
  const S = 50;
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className={'die' + (tumbling ? ' tumbling' + (flip ? ' flip' : '') : '')}>
        <rect width={S} height={S} rx={11} className="die-body" />
        {PIPS[face].map(([c, r], i) => (
          <circle key={i} cx={12 + c * 13} cy={12 + r * 13} r={4.6} className="pip" />
        ))}
      </g>
    </g>
  );
}

/** A geometric snake: an S-curve body with a head. */
function SnakeGlyph({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g transform={`translate(${cx} ${cy})`} className="snake-glyph">
      <path d="M -26 10 C -18 -10, -8 -10, -2 2 S 12 14, 18 -2" className="body" />
      <circle cx={21} cy={-6} r={7} className="head" />
      <circle cx={23} cy={-8} r={1.8} className="eye" />
      <path d="M 27 -9 l 6 -3 M 27 -9 l 6 1" className="tongue" />
    </g>
  );
}

export type BoardMode = 'idle' | 'live' | 'bitten' | 'cashed';

export interface BoardProps {
  d: Difficulty;
  /** Where the token is drawn (moves square by square while rolling). */
  token: number;
  /** The square the landing odds are measured from (where the next roll starts). */
  from: number;
  showOdds: boolean;
  mode: BoardMode;
  hopMs: number;
  dice: [number, number];
  tumbling: boolean;
  /** Bumps every tumble frame, for alternate wobble directions. */
  frame: number;
  /** The square just landed on, for the flash. */
  landed: { square: number; id: number } | null;
  value: number;
  valueLabel: string;
  footer: string;
}

const fmtFactor = (f: number) => f.toFixed(2) + '×';

export default function Board({ d, token, from, showOdds, mode, hopMs, dice, tumbling, frame, landed, value, valueLabel, footer }: BoardProps) {
  const t = at(token);
  const centre = M + CS + GAP;
  const centreSize = 2 * CS + GAP;

  return (
    <svg viewBox="0 0 400 400" className={`snk mode-${mode}`} role="img" aria-label={`Snakes board, token on square ${token}`}>
      {Array.from({ length: SQUARES }, (_, j) => {
        const { x, y } = at(j);
        const f = factorAt(d, j);
        const tone = f === 0 ? 'snake' : f >= 2 ? 'hot' : f >= 1 ? 'up' : 'down';
        const w = landingWays(from, j);
        const isLanded = landed?.square === j;
        return (
          <g key={j} className={`sq ${tone}` + (isLanded ? ' landed' : '')}>
            <rect x={x} y={y} width={CS} height={CS} rx={13} className="sq-bg" />
            {j === 0 && (
              <text x={x + 10} y={y + 17} className="start">
                START
              </text>
            )}
            {f === 0 ? (
              <SnakeGlyph cx={x + CS / 2 - 4} cy={y + CS / 2 - 3} />
            ) : (
              <text x={x + CS / 2} y={y + CS / 2 + 4} className="factor">
                {fmtFactor(f)}
              </text>
            )}
            {showOdds && (
              <g className="ways" aria-label={`${w} of 36 rolls land here`}>
                {Array.from({ length: 6 }, (_, i) => (
                  <circle key={i} cx={x + CS / 2 - 22.5 + i * 9} cy={y + CS - 13} r={2.8} className={i < w ? 'on' : ''} />
                ))}
              </g>
            )}
            {isLanded && <rect key={landed!.id} x={x} y={y} width={CS} height={CS} rx={13} className="flash" />}
            {isLanded && f > 0 && (
              <text key={`p${landed!.id}`} x={x + CS / 2} y={y + 22} className="pop">
                {fmtFactor(f)}
              </text>
            )}
          </g>
        );
      })}

      {/* The centre: value, dice and a line of context. */}
      <rect x={centre} y={centre} width={centreSize} height={centreSize} rx={18} className="centre" />
      <text x={200} y={centre + 30} className="c-label">
        {valueLabel}
      </text>
      <text x={200} y={centre + 66} className="c-value">
        {value >= 1000 ? Math.round(value).toLocaleString('en-US') : value.toFixed(2)}×
      </text>
      <Die x={200 - 56} y={centre + 88} face={dice[0]} tumbling={tumbling} flip={frame % 2 === 0} />
      <Die x={200 + 6} y={centre + 88} face={dice[1]} tumbling={tumbling} flip={frame % 2 === 1} />
      <text x={200} y={centre + 166} className="c-foot">
        {footer}
      </text>

      {/* The token: a frame that hops round the loop. */}
      <g className="token" style={{ transform: `translate(${t.x}px, ${t.y}px)`, transitionDuration: `${Math.round(hopMs * 0.85)}ms` }}>
        <rect x={-4} y={-4} width={CS + 8} height={CS + 8} rx={16} className="token-frame" />
        <circle cx={CS - 2} cy={2} r={8} className="token-puck" />
      </g>
    </svg>
  );
}
