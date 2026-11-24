import { CELLS, SIDE, arrows, count, has, houseNeed, type State } from './math';

export interface BoardProps {
  s: State;
  /** Cells filled last (the tick's cell and any pocket captured with it): they keep an outline. */
  last: readonly number[];
  /** The arrow (index into arrows(s)) the light is on while a tick is being picked. */
  scan: number | null;
  /** The round is over: the arrows are gone, the result stays. */
  done: boolean;
}

const CELL = 90;
const X0 = 20;
const Y0 = 40;
const KEY_Y = 424;

const cx = (i: number) => X0 + (i % SIDE) * CELL;
const cy = (i: number) => Y0 + Math.floor(i / SIDE) * CELL;

/** A triangle that starts on the border between two cells and points into the empty one. */
function arrowPath(from: number, to: number): string {
  const dx = (to % SIDE) - (from % SIDE);
  const dy = Math.floor(to / SIDE) - Math.floor(from / SIDE);
  const mx = cx(from) + CELL / 2 + (dx * CELL) / 2;
  const my = cy(from) + CELL / 2 + (dy * CELL) / 2;
  const L = 22;
  const W = 11;
  const px = -dy;
  const py = dx;
  return `M ${mx + px * W} ${my + py * W} L ${mx - px * W} ${my - py * W} L ${mx + dx * L} ${my + dy * L} Z`;
}

export default function Board({ s, last, scan, done }: BoardProps) {
  const list = done ? [] : arrows(s);
  // A wall-off can carry a paint past its target, so the labels stop at the target.
  const you = Math.min(count(s.you), s.k);
  const house = Math.min(count(s.house), houseNeed(s.k));
  return (
    <svg viewBox="0 0 400 440" className="tf" role="img" aria-label={`You ${you} of ${s.k}, house ${house} of ${houseNeed(s.k)}`}>
      <text x={X0} y={26} className="count you">{`You ${you} of ${s.k}`}</text>
      <text x={X0 + 4 * CELL} y={26} className="count house end">{`House ${house} of ${houseNeed(s.k)}`}</text>

      {Array.from({ length: CELLS }, (_, i) => (
        <rect key={i} x={cx(i)} y={cy(i)} width={CELL} height={CELL} className={'cell ' + (has(s.you, i) ? 'you' : has(s.house, i) ? 'house' : 'empty')} />
      ))}

      {list.map((a, n) => (
        <path key={`${a.from}-${a.to}`} d={arrowPath(a.from, a.to)} className={'arrow ' + a.paint + (scan === n ? ' scan' : '')} />
      ))}

      {/* The cell (and captured pocket) filled last keeps a plain outline. */}
      {last.map((i) => (
        <rect key={i} x={cx(i) + 2} y={cy(i) + 2} width={CELL - 4} height={CELL - 4} className="last" />
      ))}

      <text x={X0} y={KEY_Y + 4} className="key">
        Each tick picks one arrow at random
      </text>
    </svg>
  );
}
