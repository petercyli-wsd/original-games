import type { CSSProperties } from 'react';
import { H, mod } from './math';

const C = 200;
const R_SEAT = 116;
const R_DOT = 150;
const R_DIAL = 84;

const f = (v: number) => v.toFixed(2);

/** A point at `deg` degrees clockwise from the top. */
const polar = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return { x: C + r * Math.sin(a), y: C - r * Math.cos(a) };
};

/** A pie slice from a0 to a1 (degrees clockwise from the top). */
function slicePath(a0: number, a1: number, r: number) {
  const p = polar(a0, r);
  const q = polar(a1, r);
  return `M ${C} ${C} L ${f(p.x)} ${f(p.y)} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${f(q.x)} ${f(q.y)} Z`;
}

export type Outcome = 'won' | 'lost' | 'cashed';

export interface BoardProps {
  n: number;
  picks: readonly number[];
  /** The dot's position, unwrapped (seat = x mod n), so it never turns the long way round. */
  bombX: number;
  /** Where the fuse needle points, degrees clockwise from the dot's side (cumulative); null before the first spin. */
  needle: number | null;
  /** The seat where it blew, once it has. */
  blewAt: number | null;
  spinMs: number;
  hopMs: number;
}

export default function Board({ n, picks, bombX, needle, blewAt, spinMs, hopMs }: BoardProps) {
  const deg = 360 / n;
  const seat = mod(bombX, n);
  const seatR = Math.min(16, ((Math.PI * R_SEAT) / n) * 0.52);
  const mine = (s: number) => picks.includes(s);
  const blown = blewAt !== null;
  const turn = bombX * deg;
  const red = H * 180;

  // Text inside the dial turns with it, so each label is turned back to stay upright.
  const upright = (rel: number, r: number, text: string, cls: string) => {
    const p = polar(rel, r);
    return (
      <g className="upright" style={{ transform: `rotate(${-turn}deg)`, transitionDuration: `${hopMs}ms` }}>
        <text x={f(p.x)} y={f(p.y + 4)} className={cls}>
          {text}
        </text>
      </g>
    );
  };

  return (
    <svg viewBox="0 0 400 400" className="hp-ring" role="img" aria-label="Ring of seats with a dot and a fuse dial" style={{ '--hop': `${hopMs}ms` } as CSSProperties}>
      <circle cx={C} cy={C} r={R_SEAT} className="table" />

      {/* Seats. Yours are the accent; the seat where it blows turns win or lose and stays that way. */}
      {Array.from({ length: n }, (_, s) => {
        const p = polar(s * deg, R_SEAT);
        const cls = 'seat' + (mine(s) ? ' pick' : '') + (blown && s === blewAt ? (mine(s) ? ' boom-win' : ' boom-lose') : '');
        const ink = mine(s) || (blown && s === blewAt);
        return (
          <g key={s}>
            <circle cx={f(p.x)} cy={f(p.y)} r={seatR} className={cls} />
            <text x={f(p.x)} y={f(p.y + 5)} className={'seat-n' + (ink ? ' ink' : '')}>
              {s}
            </text>
          </g>
        );
      })}

      {/* The dot, passed from seat to seat. Its rotation is unwrapped so each hop is one seat. */}
      {!blown && (
        <g className="dot turn" style={{ transform: `rotate(${turn}deg)`, transitionDuration: `${hopMs}ms` }}>
          <circle cx={C} cy={C - R_DOT} r={8} className="dot-core" />
        </g>
      )}

      {/* The fuse dial: each spin is one needle landing. The wide slice faces the dot (it blows where it
          sits), the others face its neighbours (it hops there). Slice width = chance. */}
      <g className="dial turn" style={{ transform: `rotate(${turn}deg)`, transitionDuration: `${hopMs}ms` }}>
        <path d={slicePath(-red, red, R_DIAL)} className={'slice boom ' + (mine(seat) ? 'win' : 'lose')} />
        <path d={slicePath(red, 180, R_DIAL)} className="slice pass" />
        <path d={slicePath(180, 360 - red, R_DIAL)} className="slice pass" />
        {needle !== null && (
          <g className="needle" style={{ transform: `rotate(${needle}deg)`, transitionDuration: `${spinMs}ms` }}>
            <line x1={C} y1={C + 10} x2={C} y2={C - R_DIAL + 6} />
            <path d={`M ${C - 6} ${C - R_DIAL + 16} L ${C} ${C - R_DIAL + 3} L ${C + 6} ${C - R_DIAL + 16} Z`} />
          </g>
        )}
        {upright(0, R_DIAL * 0.6, 'blows', 'dl dl-boom')}
        {upright(90 + red / 2, R_DIAL * 0.58, `to ${mod(seat + 1, n)}`, 'dl')}
        {upright(270 - red / 2, R_DIAL * 0.58, `to ${mod(seat - 1, n)}`, 'dl')}
        <circle cx={C} cy={C} r={6} className="hub" />
      </g>
    </svg>
  );
}
