import type { CSSProperties } from 'react';
import { duelShare, sum, type Cards } from './math';

/** One spin of the duel spinner. `from` is where the pointer rested before. */
export interface Spin {
  id: number;
  u: number;
  from: number;
  /** The two front cards that duelled. */
  a: number;
  b: number;
  you: boolean;
  /** Spin time in ms. */
  ms: number;
  /** True once the pointer has stopped. */
  landed: boolean;
}

export interface BoardProps {
  cards: Cards;
  /** Your exact chance to win the round (the bottom bar). */
  chance: number;
  spin: Spin | null;
  /** The first duel, shown on the spinner before any spin. */
  first: { a: number; b: number };
  done: boolean;
  /** Animation time for the cards sliding to the back, in ms. */
  slideMs: number;
}

const C = { x: 120, y: 262, r: 70 };
const W = 56;
const SLOT_OUT = 10;
const STRENGTH = { x: 20, y: 372, w: 600, h: 18 };
const BAR = { x: 20, y: 428, w: 600, h: 24 };

function Card({ v, i, mine, front, mark }: { v: number; i: number; mine: boolean; front: boolean; mark: 'win' | 'lose' | null }) {
  return (
    <g className={'card' + (mine ? ' mine' : '') + (front ? ' front' : '') + (mark ? ` mark-${mark}` : '')} style={{ transform: `translate(${8 + i * W}px, 0px)` }}>
      <rect width={48} height={48} rx={6} className="card-bg" />
      <text x={24} y={31} className="card-n">
        {v}
      </text>
    </g>
  );
}

export default function Board({ cards, chance, spin, first, done, slideMs }: BoardProps) {
  const landed = spin?.landed ? spin : null;
  const mark = landed ? (landed.you ? 'win' : 'lose') : null;
  const shown = spin ?? { ...first, you: true, u: 0, from: 0, id: 0, ms: 0, landed: false };
  const share = duelShare(shown.a, shown.b);
  const q = share;
  const p = 1 - share;
  const sy = sum(cards.y);
  const sh = sum(cards.h);
  const sShare = sy / (sy + sh || 1);
  const style = spin
    ? ({
        '--from': `${spin.from * 360}deg`,
        '--to': `${720 + spin.u * 360}deg`,
        animationDuration: `${spin.ms}ms`,
      } as CSSProperties)
    : undefined;
  // The winner of the last duel went to the back of its row.
  const winnerBack = (mine: boolean) => (landed && landed.you === mine ? (mine ? cards.y.length : cards.h.length) - 1 : -1);
  const row = (mine: boolean, y: number, label: string, list: number[]) => (
    <g className="row" style={{ ['--slide' as string]: `${slideMs}ms` } as CSSProperties}>
      <text x={8} y={y - 8} className="head start">
        {label}
      </text>
      <g transform={`translate(0 ${y})`}>
        {list.map((v, i) => (
          <Card key={v} v={v} i={i} mine={mine} front={i === 0} mark={i === winnerBack(mine) ? mark : null} />
        ))}
        {landed && landed.you !== mine && (
          <g className={'card ghost mark-' + mark} style={{ transform: `translate(${8 + SLOT_OUT * W}px, 0px)` }}>
            <rect width={48} height={48} rx={6} className="card-bg" />
            <text x={24} y={31} className="card-n">
              {mine ? landed.a : landed.b}
            </text>
          </g>
        )}
      </g>
      <text x={8 + SLOT_OUT * W + 24} y={y + 66} className="head">
        {landed && landed.you !== mine ? 'out' : ''}
      </text>
    </g>
  );
  return (
    <svg viewBox="0 0 640 480" className="cd" role="img" aria-label={`Your ${cards.y.length} cards, house ${cards.h.length}`}>
      {row(true, 30, 'You', cards.y)}
      {row(false, 108, 'House', cards.h)}

      {/* The duel spinner: green is your card's share, red the house card's. */}
      <g className="spinner">
        <circle cx={C.x} cy={C.y} r={C.r} pathLength={100} className="arc you" strokeDasharray={`${q * 100} ${p * 100}`} transform={`rotate(-90 ${C.x} ${C.y})`} />
        <circle
          cx={C.x}
          cy={C.y}
          r={C.r}
          pathLength={100}
          className="arc house"
          strokeDasharray={`${p * 100} ${q * 100}`}
          strokeDashoffset={-q * 100}
          transform={`rotate(-90 ${C.x} ${C.y})`}
        />
        <circle cx={C.x} cy={C.y} r={C.r - 20} className="hub" />
        <text x={C.x} y={C.y + 8} className="hub-n">
          {`${shown.a} vs ${shown.b}`}
        </text>
        {spin && (
          <g key={spin.id} className={'pointer' + (spin.landed ? ' landed' : '')} style={style}>
            <line x1={C.x} y1={C.y - C.r + 20} x2={C.x} y2={C.y - C.r - 12} className="needle" />
            <circle cx={C.x} cy={C.y - C.r - 12} r={7} className={'tip' + (spin.landed ? (spin.you ? ' you' : ' house') : '')} />
          </g>
        )}
      </g>

      <text x={250} y={236} className="key">
        Front cards duel, green is your share
      </text>
      <text x={250} y={264} className="key">
        Loser out, winner to the back
      </text>
      {done && (
        <text x={250} y={308} className={'verdict ' + (cards.h.length === 0 ? 'you' : 'house')}>
          {cards.h.length === 0 ? 'House row is empty' : 'Your row is empty'}
        </text>
      )}

      {/* The strength bar: the sum of each side's card numbers. It moves the same way as the chance. */}
      <rect x={STRENGTH.x} y={STRENGTH.y} width={STRENGTH.w} height={STRENGTH.h} rx={6} className="bar-bg" />
      <rect x={STRENGTH.x} y={STRENGTH.y} width={sShare * STRENGTH.w} height={STRENGTH.h} rx={6} className="bar-win" />
      <text x={STRENGTH.x} y={STRENGTH.y + STRENGTH.h + 20} className="bar-label">
        {`Your sum ${sy}`}
      </text>
      <text x={STRENGTH.x + STRENGTH.w} y={STRENGTH.y + STRENGTH.h + 20} className="bar-label end">
        {`House sum ${sh}`}
      </text>

      {/* The odds bar: the exact chance you knock out the house row. */}
      <rect x={BAR.x} y={BAR.y} width={BAR.w} height={BAR.h} rx={6} className="bar-bg" />
      <rect x={BAR.x} y={BAR.y} width={chance * BAR.w} height={BAR.h} rx={6} className="bar-win" />
      <text x={BAR.x} y={BAR.y + BAR.h + 22} className="bar-label">
        Win the round
      </text>
      <text x={BAR.x + BAR.w} y={BAR.y + BAR.h + 22} className="bar-label end">
        House wins it
      </text>
    </svg>
  );
}
