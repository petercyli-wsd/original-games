import { FUSES, ROOM, WAIT, inRoom, waiting, type State } from './math';

/** A token that is being moved: the board draws it on top, lifted and then walking. */
export interface Mover {
  id: number;
  /** Where it was picked up: [zone, place]. */
  from: readonly [number, number];
  phase: 'lift' | 'walk';
}

export interface BoardProps {
  s: State;
  /** The token most recently moved: stays ringed until the next pick. */
  last: number | null;
  mover: Mover | null;
  /** How long a lift and a walk take, in ms. */
  liftMs: number;
  walkMs: number;
  /** Your chance to get the target in from here. */
  chance: number;
  /** Whether the round is decided. */
  done: boolean;
}

const BAR = { x: 20, y: 352, w: 600, h: 24 };
const BOX = { y: 28, h: 160 };
const EXIT_X = [495, 545, 595];
const EXIT_Y = 108;

/** The centre of place `slot` in a zone. */
export function pos(zone: number, slot: number) {
  if (zone === WAIT) return { x: 47 + (slot % 4) * 38, y: 55 + Math.floor(slot / 4) * 38 };
  if (zone === ROOM) return { x: 254 + (slot % 5) * 36, y: 55 + Math.floor(slot / 5) * 38 };
  return { x: EXIT_X[slot], y: EXIT_Y };
}

function Token({ id, s, mover, last, walkMs }: { id: number; s: State; mover: Mover | null; last: boolean; walkMs: number }) {
  const zone = s.z[id];
  const { x, y } = pos(zone, s.sl[id]);
  const kind = zone === WAIT ? 'green' : 'red';
  const hidden = mover?.id === id;
  return (
    <g className={'tok ' + kind + (last ? ' last' : '') + (hidden ? ' away' : '')} style={{ transform: `translate(${x}px, ${y}px)`, transitionDuration: `${walkMs}ms` }}>
      <circle r={12} className="disc" />
      {last && <circle r={17} className="ring" />}
    </g>
  );
}

export default function Board({ s, last, mover, liftMs, walkMs, chance, done }: BoardProps) {
  const w = waiting(s);
  const y = inRoom(s);
  const t = w + y;
  const won = s.a >= s.k;
  const to = mover ? pos(s.z[mover.id], s.sl[mover.id]) : { x: 0, y: 0 };
  const fr = mover ? pos(mover.from[0], mover.from[1]) : { x: 0, y: 0 };
  const at = mover?.phase === 'walk' ? to : fr;
  const moverKind = mover && (mover.from[0] === ROOM || mover.phase === 'walk') ? 'red' : 'green';
  return (
    <svg viewBox="0 0 640 410" className="lk" role="img" aria-label={`Arrivals ${s.a} of ${s.k}, fuses ${s.f} of ${FUSES}`}>
      <text x={20} y={18} className="head">
        Waiting
      </text>
      <text x={230} y={18} className="head">
        Your room
      </text>
      <text x={470} y={18} className="head">
        Exit: 3 fuses
      </text>
      <rect x={20} y={BOX.y} width={170} height={BOX.h} rx={8} className="box" />
      <rect x={230} y={BOX.y} width={190} height={BOX.h} rx={8} className="box mine" />
      <rect x={470} y={BOX.y} width={150} height={BOX.h} rx={8} className="box" />
      <path d="M196 108 H222 M214 100 L222 108 L214 116" className="arrow" />
      <path d="M426 108 H462 M454 100 L462 108 L454 116" className="arrow" />

      {/* The exit is the fuse track: each token that leaves fills the next slot. */}
      {EXIT_X.map((cx, n) => (
        <circle key={n} cx={cx} cy={EXIT_Y} r={20} className={'fuse' + (n < s.f ? ' used' : '')} />
      ))}

      {s.z.map((_, id) => (
        <Token key={id} id={id} s={s} mover={mover} last={last === id && !mover} walkMs={walkMs} />
      ))}

      {mover && (
        <g className={'tok mover ' + moverKind} style={{ transform: `translate(${at.x}px, ${at.y}px)`, transitionDuration: `${walkMs}ms` }}>
          <g className={'carry ' + mover.phase} style={{ animationDuration: `${mover.phase === 'lift' ? liftMs : walkMs}ms` }}>
            <circle r={12} className="disc" />
            <circle r={17} className="ring" />
          </g>
        </g>
      )}

      <text x={20} y={212} className="head">
        Arrivals
      </text>
      <text x={620} y={212} className="head end">
        {`${s.a} of ${s.k} entered`}
      </text>
      {Array.from({ length: s.k }, (_, n) => (
        <rect key={n} x={20 + n * 34} y={226} width={24} height={24} rx={4} className={'slot' + (n < s.a ? ' full' : '')} />
      ))}

      <text x={20} y={282} className="count">
        {done ? (won ? 'Your target is in' : 'The third token left') : `Enters: ${w} of ${t}. Leaves: ${y} of ${t}`}
      </text>
      <text x={20} y={306} className="key">
        Green enters your room. Red leaves it.
      </text>
      <text x={20} y={328} className="key">
        Ring: last token moved
      </text>

      {/* The odds bar: the exact chance you get the target in before the third fuse. */}
      <rect x={BAR.x} y={BAR.y} width={BAR.w} height={BAR.h} rx={6} className="bar-bg" />
      <rect x={BAR.x} y={BAR.y} width={chance * BAR.w} height={BAR.h} rx={6} className="bar-win" />
      <text x={BAR.x} y={BAR.y + BAR.h + 22} className="bar-label">
        Target gets in
      </text>
      <text x={BAR.x + BAR.w} y={BAR.y + BAR.h + 22} className="bar-label end">
        Three leave
      </text>
    </svg>
  );
}
