import type { CSSProperties } from 'react';
import { needServer, needYou, type Score } from './math';

/** One spin of the point spinner. `from` is where the pointer rested before. */
export interface Spin {
  id: number;
  u: number;
  from: number;
  you: boolean;
  /** Spin time in ms. */
  ms: number;
  /** True once the pointer has stopped. */
  landed: boolean;
}

export interface BoardProps {
  x: Score;
  /** The server's share of points. */
  p: number;
  chance: number;
  spin: Spin | null;
  /** Whether the game is decided (the last point is then the deciding one). */
  done: boolean;
}

const C = { x: 170, y: 262, r: 92 };
const BAR = { x: 20, y: 388, w: 600, h: 24 };
const SLOTS = 5;

function Row({ name, y, points, need, mine, mark }: { name: string; y: number; points: number; need: number; mine: boolean; mark: 'win' | 'lose' | null }) {
  return (
    <g className={'row' + (mine ? ' mine' : '') + (mark ? ` mark-${mark}` : '')}>
      <rect x={8} y={y - 22} width={624} height={44} rx={8} className="row-bg" />
      <text x={24} y={y + 7} className="name">
        {name}
      </text>
      <text x={186} y={y + 9} className="score">
        {points}
      </text>
      {Array.from({ length: SLOTS }, (_, i) =>
        i < need ? <rect key={i} x={310 + i * 34} y={y - 12} width={24} height={24} rx={4} className="slot" /> : null,
      )}
      <text x={620} y={y + 6} className="need">
        {`needs ${need}`}
      </text>
    </g>
  );
}

export default function Board({ x, p, chance, spin, done }: BoardProps) {
  const q = 1 - p;
  const nY = needYou(x);
  const nS = needServer(x);
  const mark = spin?.landed ? (spin.you ? 'win' : 'lose') : null;
  const pct = Math.round(p * 100);
  const style = spin
    ? ({
        '--from': `${spin.from * 360}deg`,
        '--to': `${720 + spin.u * 360}deg`,
        animationDuration: `${spin.ms}ms`,
      } as CSSProperties)
    : undefined;
  return (
    <svg viewBox="0 0 640 430" className="bp" role="img" aria-label={`You ${x.r}, server ${x.s}`}>
      {/* The score as plain counts, and the fewest points each side still needs. */}
      <text x={186} y={12} className="head">
        points
      </text>
      <text x={310} y={12} className="head start">
        still to win
      </text>
      <text x={620} y={12} className="head end">
        first to 4, two clear
      </text>
      <Row name="You" y={44} points={x.r} need={nY} mine mark={mark === 'win' ? 'win' : null} />
      <Row name="Server" y={100} points={x.s} need={nS} mine={false} mark={mark === 'lose' ? 'lose' : null} />

      {/* The point spinner: green is your point, red is the server's. */}
      <g className="spinner">
        <circle cx={C.x} cy={C.y} r={C.r} pathLength={100} className="arc you" strokeDasharray={`${q * 100} ${p * 100}`} transform={`rotate(-90 ${C.x} ${C.y})`} />
        <circle
          cx={C.x}
          cy={C.y}
          r={C.r}
          pathLength={100}
          className="arc server"
          strokeDasharray={`${p * 100} ${q * 100}`}
          strokeDashoffset={-q * 100}
          transform={`rotate(-90 ${C.x} ${C.y})`}
        />
        <circle cx={C.x} cy={C.y} r={C.r - 22} className="hub" />
        <text x={C.x} y={C.y - 4} className="hub-t">
          Server
        </text>
        <text x={C.x} y={C.y + 22} className="hub-n">
          {`${pct}%`}
        </text>
        {spin && (
          <g key={spin.id} className={'pointer' + (spin.landed ? ' landed' : '')} style={style}>
            <line x1={C.x} y1={C.y - C.r + 22} x2={C.x} y2={C.y - C.r - 12} className="needle" />
            <circle cx={C.x} cy={C.y - C.r - 12} r={7} className={'tip' + (spin.landed ? (spin.you ? ' you' : ' server') : '')} />
          </g>
        )}
      </g>

      <text x={330} y={236} className="key">
        {"Green: your point, red: server's"}
      </text>
      <text x={330} y={264} className="key">
        Need: fewest points left to win
      </text>
      {done && (
        <text x={330} y={300} className={'verdict ' + (nY === 0 ? 'you' : 'server')}>
          {nY === 0 ? 'You win the game' : 'Server wins the game'}
        </text>
      )}

      {/* The odds bar: the exact chance you win the game. */}
      <rect x={BAR.x} y={BAR.y} width={BAR.w} height={BAR.h} rx={6} className="bar-bg" />
      <rect x={BAR.x} y={BAR.y} width={chance * BAR.w} height={BAR.h} rx={6} className="bar-win" />
      <text x={BAR.x} y={BAR.y + BAR.h + 22} className="bar-label">
        Win the game
      </text>
      <text x={BAR.x + BAR.w} y={BAR.y + BAR.h + 22} className="bar-label end">
        Server wins it
      </text>
    </svg>
  );
}
