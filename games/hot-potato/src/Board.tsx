import type { CSSProperties } from 'react';
import { H, mod } from './math';

const C = 200;
const R_SEAT = 116;
const R_HEAT = 163;
const HEAT_W = 26;
const R_DIAL = 84;

const f = (v: number) => v.toFixed(2);

/** A point at `deg` degrees clockwise from the top. */
const polar = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return { x: C + r * Math.sin(a), y: C - r * Math.cos(a) };
};

/** Clockwise arc from a0 to a1 (degrees). */
function arcPath(a0: number, a1: number, r: number) {
  const span = Math.min(a1 - a0, 359.99);
  const p = polar(a0, r);
  const q = polar(a0 + span, r);
  return `M ${f(p.x)} ${f(p.y)} A ${r} ${r} 0 ${span > 180 ? 1 : 0} 1 ${f(q.x)} ${f(q.y)}`;
}

/** A pie slice from a0 to a1 (degrees clockwise from the top). */
function slicePath(a0: number, a1: number, r: number) {
  const p = polar(a0, r);
  const q = polar(a1, r);
  return `M ${C} ${C} L ${f(p.x)} ${f(p.y)} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${f(q.x)} ${f(q.y)} Z`;
}

/** A chevron on the seat ring at `deg`, pointing clockwise (1) or anticlockwise (−1). */
function chevron(deg: number, r: number, dir: 1 | -1, size: number) {
  const a = (deg * Math.PI) / 180;
  const t = { x: Math.cos(a) * dir, y: Math.sin(a) * dir };
  const o = { x: Math.sin(a), y: -Math.cos(a) };
  const p = polar(deg, r);
  const tip = { x: p.x + t.x * size * 0.6, y: p.y + t.y * size * 0.6 };
  const b1 = { x: p.x - t.x * size * 0.6 + o.x * size, y: p.y - t.y * size * 0.6 + o.y * size };
  const b2 = { x: p.x - t.x * size * 0.6 - o.x * size, y: p.y - t.y * size * 0.6 - o.y * size };
  return `M ${f(b1.x)} ${f(b1.y)} L ${f(tip.x)} ${f(tip.y)} L ${f(b2.x)} ${f(b2.y)}`;
}

export type Outcome = 'won' | 'lost' | 'cashed';

export interface BoardProps {
  n: number;
  picks: readonly number[];
  /** The bomb's position, unwrapped (seat = x mod n), so it never turns the long way round. */
  bombX: number;
  /** Hops so far (re-runs the hop bounce). */
  hops: number;
  /** Spins so far. */
  spins: number;
  /** Every seat's chance to be where it blows. */
  heat: readonly number[];
  /** Where the fuse needle points, degrees clockwise from the bomb's side (cumulative); null before the first spin. */
  needle: number | null;
  /** Your chance to win if the bomb hops to each neighbour, to tint the hop arrows (null: hide them). */
  passOdds: { cw: number; ccw: number; now: number } | null;
  blewAt: number | null;
  spinMs: number;
  hopMs: number;
  live: boolean;
}

const pctOf = (p: number) => `${Math.round(p * 100)}%`;

export default function Board({ n, picks, bombX, hops, spins, heat, needle, passOdds, blewAt, spinMs, hopMs, live }: BoardProps) {
  const deg = 360 / n;
  const seat = mod(bombX, n);
  const seatR = Math.min(16, ((Math.PI * R_SEAT) / n) * 0.52);
  const gap = Math.min(2.4, deg * 0.08);
  const hmax = Math.max(...heat);
  const mine = (s: number) => picks.includes(s);
  const blown = blewAt !== null;
  const turn = bombX * deg;
  const red = H * 180;

  // Text inside the dial turns with it, so each label is turned back to stay upright.
  const upright = (rel: number, r: number, lines: { text: string; cls: string }[]) => {
    const p = polar(rel, r);
    const top = -((lines.length - 1) * 12) / 2;
    return (
      <g className="upright" style={{ transform: `rotate(${-turn}deg)`, transitionDuration: `${hopMs}ms` }}>
        {lines.map((l, i) => (
          <text key={i} x={f(p.x)} y={f(p.y + top + i * 12 + 4)} className={l.cls}>
            {l.text}
          </text>
        ))}
      </g>
    );
  };

  return (
    <svg viewBox="0 0 400 400" className={'hp-ring' + (live && !blown ? ' lit' : '')} role="img" aria-label="Heat ring, seats and fuse dial" style={{ '--hop': `${hopMs}ms` } as CSSProperties}>
      {/* The heat ring: each seat's chance to be where the bomb blows. Green is yours, red is not. */}
      <g className="heat">
        {heat.map((p, s) => {
          const a0 = s * deg - deg / 2 + gap / 2;
          const a1 = s * deg + deg / 2 - gap / 2;
          const lvl = hmax > 0 ? p / hmax : 0;
          return (
            <g key={s} className={'cell' + (mine(s) ? ' good' : ' bad') + (blown && s === blewAt ? ' blast' : '')}>
              <path d={arcPath(a0, a1, R_HEAT)} className="cell-bg" strokeWidth={HEAT_W} />
              <path d={arcPath(a0, a1, R_HEAT)} className="cell-heat" strokeWidth={HEAT_W} style={{ opacity: 0.08 + 0.92 * lvl }} />
              {mine(s) && <path d={arcPath(a0, a1, R_HEAT + HEAT_W / 2 + 3)} className="cell-mine" />}
            </g>
          );
        })}
      </g>

      {/* The table. */}
      <circle cx={C} cy={C} r={R_SEAT} className="table" />

      {/* Where a green spin can send it: an arrow towards each neighbour, tinted by what it does to your odds. */}
      {passOdds && !blown && (
        <g className="next">
          {([-1, 1] as const).map((dir) => {
            const after = dir === 1 ? passOdds.cw : passOdds.ccw;
            const tone = after > passOdds.now + 1e-12 ? 'up' : after < passOdds.now - 1e-12 ? 'down' : 'flat';
            return <path key={dir} d={chevron((bombX + dir / 2) * deg, R_SEAT, dir, 6)} className={'chev ' + tone} />;
          })}
        </g>
      )}

      {/* Seats. */}
      {Array.from({ length: n }, (_, s) => {
        const p = polar(s * deg, R_SEAT);
        const cls = 'seat' + (mine(s) ? ' pick' : '') + (blown && s === blewAt ? (mine(s) ? ' boom-win' : ' boom-lose') : '');
        return (
          <g key={s}>
            <circle cx={f(p.x)} cy={f(p.y)} r={seatR} className={cls} />
            <text x={f(p.x)} y={f(p.y + 4)} className={'seat-n' + (mine(s) ? ' pick' : '')} style={{ fontSize: Math.min(12, seatR * 0.85) }}>
              {s}
            </text>
          </g>
        );
      })}

      {/* The blast. */}
      {blown && (
        <g key={`blast-${spins}`} className={'blast ' + (mine(blewAt) ? 'win' : 'lose')}>
          {[0, 1, 2].map((i) => {
            const p = polar(blewAt * deg, R_SEAT);
            return <circle key={i} cx={f(p.x)} cy={f(p.y)} r={seatR + 4} className={`ring r${i}`} />;
          })}
        </g>
      )}

      {/* The bomb. Its rotation is unwrapped so each hop is one seat. */}
      {!blown && (
        <g className="bomb turn" style={{ transform: `rotate(${turn}deg)`, transitionDuration: `${hopMs}ms` }}>
          <g key={hops} className={'bomb-body' + (hops > 0 ? ' hop' : '')}>
            <circle cx={C} cy={C - R_SEAT} r={seatR + 5} className="bomb-halo" />
            <circle cx={C} cy={C - R_SEAT} r={seatR - 1} className="bomb-core" />
            <path d={`M ${C + seatR * 0.45} ${C - R_SEAT - seatR * 0.6} q 5 -7 10 -5`} className="fuse" />
            <circle cx={C + seatR * 0.45 + 10} cy={C - R_SEAT - seatR * 0.6 - 5} r={3} className="spark" />
          </g>
        </g>
      )}

      {/* The fuse dial: each spin is one needle landing. The red slice faces the bomb (it blows where it
          sits), the green slices face its neighbours (it hops there). Slice width = chance. */}
      <g className="dial turn" style={{ transform: `rotate(${turn}deg)`, transitionDuration: `${hopMs}ms` }}>
        <path d={slicePath(-red, red, R_DIAL)} className={'slice boom' + (mine(seat) ? ' mine' : '')} />
        <path d={slicePath(red, 180, R_DIAL)} className="slice pass" />
        <path d={slicePath(180, 360 - red, R_DIAL)} className="slice pass alt" />
        {needle !== null && (
          <g className="needle" style={{ transform: `rotate(${needle}deg)`, transitionDuration: `${spinMs}ms` }}>
            <line x1={C} y1={C + 10} x2={C} y2={C - R_DIAL + 6} />
            <path d={`M ${C - 6} ${C - R_DIAL + 16} L ${C} ${C - R_DIAL + 3} L ${C + 6} ${C - R_DIAL + 16} Z`} />
          </g>
        )}
        {upright(0, R_DIAL * 0.6, [
          { text: 'BOOM', cls: 'dl-head' },
          { text: pctOf(H), cls: 'dl-pct' },
          { text: mine(seat) ? 'you win' : 'you lose', cls: 'dl-sub ' + (mine(seat) ? 'win' : 'lose') },
        ])}
        {upright(90 + red / 2, R_DIAL * 0.58, [
          { text: `to ${mod(seat + 1, n)}`, cls: 'dl-head' },
          { text: pctOf((1 - H) / 2), cls: 'dl-pct' },
        ])}
        {upright(270 - red / 2, R_DIAL * 0.58, [
          { text: `to ${mod(seat - 1, n)}`, cls: 'dl-head' },
          { text: pctOf((1 - H) / 2), cls: 'dl-pct' },
        ])}
        <circle cx={C} cy={C} r={7} className="hub" />
      </g>

      {/* Legend. */}
      <g className="legend">
        <rect x={4} y={362} width={11} height={11} rx={2} className="key good" />
        <text x={21} y={371.5}>blows here: you win</text>
        <rect x={4} y={381} width={11} height={11} rx={2} className="key bad" />
        <text x={21} y={390.5}>blows here: you lose</text>
        <text x={396} y={371.5} className="end">
          {spins > 0 ? `spin ${spins}` : 'starts on seat 0'}
        </text>
        <text x={396} y={390.5} className="end">
          shade = chance it blows there
        </text>
      </g>
    </svg>
  );
}
