import { fmtChance } from '@originals/game-sdk/ui';
import { BINS, BIN_LEFT, BIN_NAME, HEIGHT, SHARE } from './math';

// Board geometry (viewBox units).
const FX = 20;
const FW = 360;
const BAR_Y = 24;
const BAR_H = 22;
export const RAIL_Y = 64;
const WALL_TOP = 86;
const FLOOR = 246;
const BLOCK = 40;
const FINISH = FLOOR - HEIGHT * BLOCK;

/** Where the ball comes to rest on a stack that already holds `count` blocks (centre of the new block). */
export const restY = (count: number) => FLOOR - count * BLOCK - BLOCK / 2;

const binX = (j: number) => FX + BIN_LEFT[j] * FW;
const binW = (j: number) => SHARE[j] * FW;

export interface BoardProps {
  stacks: readonly number[];
  mine: number;
  /** Each bin's chance to stack 3 first: the title bar. */
  chances: readonly number[];
  /** The ball in flight: u = position along the floor (0–1), y in board units. */
  ball: { u: number; y: number } | null;
  /** The bin the last ball fell into. */
  landed: number | null;
  /** The bin that stacked 3 first, once the round is decided. */
  winner: number | null;
  editable: boolean;
  onBin(i: number): void;
}

export default function Board({ stacks, mine, chances, ball, landed, winner, editable, onBin }: BoardProps) {
  const now = chances[mine];
  let cum = 0;
  const pieces = chances.map((p, j) => {
    const x = FX + cum * FW;
    cum += p;
    return { j, x, w: p * FW };
  });
  const click = (j: number) => (editable ? { onClick: () => onBin(j), style: { cursor: 'pointer' } } : {});

  return (
    <svg viewBox="0 0 400 272" className="tally" role="img" aria-label={`Your ${BIN_NAME[mine]} bin: ${fmtChance(now)} to stack ${HEIGHT} first`}>
      {/* Title bar: each bin's share is its chance to stack 3 first. Yours is the accent. */}
      <text x={FX} y={15} className="bar-head">
        Who stacks {HEIGHT} first
      </text>
      <rect x={FX} y={BAR_Y} width={FW} height={BAR_H} rx={4} className="bar-bg" />
      {pieces.map(({ j, x, w }) => (
        <rect key={j} x={x} y={BAR_Y} width={Math.max(0, w)} height={BAR_H} className={`piece${j % 2 ? ' alt' : ''}` + (j === mine ? ' mine' : '')} />
      ))}

      {/* The bins: each one's width is its share of the floor, so its chance to catch the next ball. */}
      {Array.from({ length: BINS }, (_, j) => (
        <rect
          key={j}
          x={binX(j)}
          y={WALL_TOP}
          width={binW(j)}
          height={FLOOR - WALL_TOP}
          className={'bin' + (landed === j ? ' landed' : '')}
          {...click(j)}
        >
          <title>{`${BIN_NAME[j]} bin${j === mine ? ' (yours)' : ''}: catches ${BIN_NAME[j]} of balls`}</title>
        </rect>
      ))}

      {/* Stacks. */}
      {stacks.map((n, j) =>
        Array.from({ length: n }, (_, k) => (
          <rect
            key={`${j}-${k}`}
            x={binX(j) + 3}
            y={FLOOR - (k + 1) * BLOCK + 3}
            width={binW(j) - 6}
            height={BLOCK - 6}
            rx={3}
            className={
              'block' +
              (j === mine ? ' mine' : '') +
              (winner === j && k === n - 1 ? (j === mine ? ' champ' : ' beat') : '')
            }
          />
        )),
      )}

      {/* Walls and floor. */}
      {Array.from({ length: BINS + 1 }, (_, j) => {
        const x = j === BINS ? FX + FW : binX(j);
        return <line key={j} x1={x} y1={WALL_TOP} x2={x} y2={FLOOR} className="wall" />;
      })}
      <line x1={FX - 4} y1={FLOOR} x2={FX + FW + 4} y2={FLOOR} className="floor" />

      {/* Finish line. */}
      <line x1={FX} y1={FINISH} x2={FX + FW} y2={FINISH} className="finish" />
      <text x={FX + 6} y={FINISH - 6} className="finish-label">
        {HEIGHT} to win
      </text>

      {/* Your bin. */}
      <rect x={binX(mine) + 1} y={WALL_TOP + 1} width={binW(mine) - 2} height={FLOOR - WALL_TOP - 2} rx={3} className="mine-outline" />

      {/* Width labels: the literal share of the floor. */}
      {Array.from({ length: BINS }, (_, j) => (
        <text key={j} x={binX(j) + binW(j) / 2} y={FLOOR + 17} className={'width' + (j === mine ? ' mine' : '')}>
          {BIN_NAME[j]}
        </text>
      ))}

      {/* The drop marker: slides to a uniform point on the floor, then falls into the bin under it. */}
      {ball && (
        <>
          <line x1={FX} y1={RAIL_Y} x2={FX + FW} y2={RAIL_Y} className="rail" />
          <circle cx={FX + ball.u * FW} cy={ball.y} r={7} className="ball" />
        </>
      )}
    </svg>
  );
}
