import { CHIPS, GREENS, LIMIT, boils, inBag, redCount, type State } from './math';

export interface BoardProps {
  s: State;
  /** The slot most recently drawn: stays marked until the next one is drawn. */
  last: number | null;
  /** The slot the draw marker is on while a chip is being drawn. */
  scan: number | null;
  /** Your chance to fill the potion from here. */
  chance: number;
  /** Whether the round is decided. */
  done: boolean;
}

const BAR = { x: 20, y: 400, w: 600, h: 24 };
const NOTCH = { x: 20, y: 28, h: 36 };
const PITCH = 58;

/** Where chip slot i sits: greens in the first row, whites in the second. */
function place(i: number) {
  const white = i >= GREENS;
  const col = white ? i - GREENS : i;
  return { x: 20 + 29 + col * PITCH, y: white ? 258 : 198 };
}

export default function Board({ s, last, scan, chance, done }: BoardProps) {
  const boiled = s.heat > LIMIT;
  const lit = Math.min(s.heat, LIMIT);
  const total = inBag(s);
  const red = redCount(s);
  return (
    <svg viewBox="0 0 640 470" className="bw" role="img" aria-label={`Heat ${s.heat}, potion ${s.filled} of ${s.k}`}>
      {/* The heat: 7 numbered notches, a red line after the 7th. */}
      <text x={20} y={16} className="head">
        Heat
      </text>
      {Array.from({ length: LIMIT }, (_, n) => (
        <g key={n} className={'notch' + (n < lit ? (boiled ? ' hot' : ' lit') : '')}>
          <rect x={NOTCH.x + n * 78} y={NOTCH.y} width={70} height={NOTCH.h} rx={6} />
          <text x={NOTCH.x + n * 78 + 35} y={NOTCH.y + 25}>
            {n + 1}
          </text>
        </g>
      ))}
      <line x1={20 + 7 * 78 - 4} y1={NOTCH.y - 6} x2={20 + 7 * 78 - 4} y2={NOTCH.y + NOTCH.h + 6} className="redline" />
      <text x={620} y={16} className="head end">
        Past 7 boils over
      </text>

      {/* The potion: one slot per green chip you need. */}
      <text x={20} y={100} className="head">
        Potion
      </text>
      {Array.from({ length: s.k }, (_, n) => (
        <circle key={n} cx={20 + 15 + n * 34} cy={122} r={12} className={'slot' + (n < s.filled ? ' full' : '')} />
      ))}
      <text x={620} y={100} className="head end">
        {`${s.filled} of ${s.k} filled`}
      </text>

      {/* The bag: every chip, face up. A drawn chip leaves its place; the last one stays marked. */}
      <text x={20} y={164} className="head">
        Bag
      </text>
      <text x={620} y={164} className="head end">
        {`${total} chips left`}
      </text>
      {CHIPS.map((v, i) => {
        const { x, y } = place(i);
        const there = s.bag[i];
        const isLast = last === i;
        const red = there && boils(s.heat, v);
        const redLast = isLast && v > 0 && boiled;
        const shown = there || isLast;
        const kind = v === 0 ? 'green' : red || redLast ? 'red' : 'white';
        return (
          <g key={i} className={'chip ' + (shown ? kind : 'gone') + (isLast ? ' last' : '') + (scan === i ? ' scan' : '')}>
            <circle cx={x} cy={y} r={24} className="disc" />
            {v > 0 && shown && (
              <text x={x} y={y + 8} className="num">
                {v}
              </text>
            )}
            {isLast && <circle cx={x} cy={y} r={29} className="ring" />}
            {scan === i && <circle cx={x} cy={y} r={29} className="scanring" />}
          </g>
        );
      })}

      <text x={20} y={330} className="count">
        {done ? (boiled ? 'It boiled over' : 'Potion full') : `Next chip boils over: ${red} of ${total}`}
      </text>
      <text x={20} y={356} className="key">
        White chips add their number
      </text>
      <text x={20} y={378} className="key">
        Red boils it over. Ring: last chip
      </text>

      {/* The odds bar: the exact chance you fill the potion. */}
      <rect x={BAR.x} y={BAR.y} width={BAR.w} height={BAR.h} rx={6} className="bar-bg" />
      <rect x={BAR.x} y={BAR.y} width={chance * BAR.w} height={BAR.h} rx={6} className="bar-win" />
      <text x={BAR.x} y={BAR.y + BAR.h + 22} className="bar-label">
        Fill the potion
      </text>
      <text x={BAR.x + BAR.w} y={BAR.y + BAR.h + 22} className="bar-label end">
        Boils over
      </text>
    </svg>
  );
}
