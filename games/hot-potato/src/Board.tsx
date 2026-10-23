import type { CSSProperties } from 'react';
import { mod, type NextEvent, type Side } from './math';

const C = 200;
const R_SEAT = 116;
const R_HEAT = 163;
const HEAT_W = 26;
const R_DONUT = 56;
const DONUT_W = 14;

const f = (v: number) => v.toFixed(2);
const pct = (p: number) => (p >= 0.995 ? '100%' : p < 0.0995 ? `${(p * 100).toFixed(1)}%` : `${Math.round(p * 100)}%`);

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
  side: Side;
  /** The bomb's position, unwrapped (seat = x mod n), so it never spins the long way round. */
  bombX: number;
  /** Hops so far (re-runs the hop bounce). */
  hops: number;
  /** Every seat's chance to be where it blows. */
  heat: readonly number[];
  /** Your chance to win now. */
  win: number;
  /** The next hop's outcomes (shown at a checkpoint). */
  events: readonly NextEvent[] | null;
  fusePct: number;
  outcome: Outcome | null;
  blewAt: number | null;
  hopMs: number;
  live: boolean;
  editable: boolean;
  onSeat(seat: number): void;
}

export default function Board({ n, picks, side, bombX, hops, heat, win, events, fusePct, outcome, blewAt, hopMs, live, editable, onSeat }: BoardProps) {
  const deg = 360 / n;
  const seat = mod(bombX, n);
  const seatR = Math.min(16, ((Math.PI * R_SEAT) / n) * 0.52);
  const gap = Math.min(2.4, deg * 0.08);
  const hmax = Math.max(...heat);
  const winsHere = (s: number) => picks.includes(s) === (side === 'on');
  const blown = blewAt !== null;
  const labelSize = n >= 16 ? 10 : 11;

  // The verdict shows the moment it blows, not only once the round settles.
  const verdict: Outcome | null = outcome ?? (blown ? (winsHere(blewAt) ? 'won' : 'lost') : null);

  // The donut: the green arc is your chance, literally.
  const winDeg = Math.max(0, Math.min(1, win)) * 360;

  return (
    <svg viewBox="0 0 400 400" className={'hp-ring' + (live && !blown ? ' lit' : '')} role="img" aria-label={`Win chance ${pct(win)}: your share of the heat ring`} style={{ '--hop': `${hopMs}ms` } as CSSProperties}>
      {/* The heat ring: each seat's chance to be where the bomb blows. Green wins for you, red loses. */}
      <g className="heat">
        {heat.map((p, s) => {
          const a0 = s * deg - deg / 2 + gap / 2;
          const a1 = s * deg + deg / 2 - gap / 2;
          const good = winsHere(s);
          const lvl = hmax > 0 ? p / hmax : 0;
          const lp = polar(s * deg, R_HEAT);
          return (
            <g key={s} className={'cell' + (good ? ' good' : ' bad') + (blown && s === blewAt ? ' blast' : '')}>
              <path d={arcPath(a0, a1, R_HEAT)} className="cell-bg" strokeWidth={HEAT_W} />
              <path d={arcPath(a0, a1, R_HEAT)} className="cell-heat" strokeWidth={HEAT_W} style={{ opacity: 0.1 + 0.9 * lvl }} />
              <text x={f(lp.x)} y={f(lp.y + labelSize * 0.36)} className={'cell-pct' + (lvl > 0.55 ? ' hot' : '')} style={{ fontSize: labelSize }}>
                {p > 0 ? pct(p) : ''}
              </text>
            </g>
          );
        })}
      </g>

      {/* The table. */}
      <circle cx={C} cy={C} r={R_SEAT} className="table" />

      {/* Where the next hop can go: a chevron towards each neighbour. */}
      {events && live && (
        <g className="next">
          {([-1, 1] as const).map((dir) => {
            const pass = events.find((e) => e.dir === dir && !e.blows)!;
            const to = (seat + dir / 2) * deg;
            const lab = polar((seat + dir) * deg, R_SEAT - seatR - 17);
            const tone = pass.win > win + 1e-12 ? 'up' : pass.win < win - 1e-12 ? 'down' : 'flat';
            return (
              <g key={dir} className={tone}>
                <path d={chevron(to, R_SEAT, dir, 6)} className="chev" />
                <text x={f(lab.x)} y={f(lab.y + 4)} className="next-pct">
                  {pct(pass.win)}
                </text>
              </g>
            );
          })}
        </g>
      )}

      {/* Danger: the two seats the next hop can blow on (each at half the fuse chance). */}
      {events && live && !blown && (
        <g className="danger">
          {([-1, 1] as const).map((dir) => {
            const s = mod(seat + dir, n);
            const p = polar(s * deg, R_SEAT);
            return <circle key={`${hops}:${dir}`} cx={f(p.x)} cy={f(p.y)} r={seatR + 5} className={'zone ' + (winsHere(s) ? 'good' : 'bad')} />;
          })}
        </g>
      )}

      {/* Seats. */}
      {Array.from({ length: n }, (_, s) => {
        const p = polar(s * deg, R_SEAT);
        const pick = picks.includes(s);
        const cls = 'seat' + (pick ? ' pick' : '') + (blown && s === blewAt ? (winsHere(s) ? ' boom-win' : ' boom-lose') : '');
        return (
          <g key={s}>
            <circle cx={f(p.x)} cy={f(p.y)} r={seatR} className={cls} />
            <text x={f(p.x)} y={f(p.y + 4)} className={'seat-n' + (pick ? ' pick' : '')} style={{ fontSize: Math.min(12, seatR * 0.85) }}>
              {s}
            </text>
          </g>
        );
      })}

      {/* The blast. */}
      {blown && (
        <g key={`blast-${hops}`} className={'blast ' + (winsHere(blewAt) ? 'win' : 'lose')}>
          {[0, 1, 2].map((i) => {
            const p = polar(blewAt * deg, R_SEAT);
            return <circle key={i} cx={f(p.x)} cy={f(p.y)} r={seatR + 4} className={`ring r${i}`} />;
          })}
        </g>
      )}

      {/* The bomb. Its rotation is unwrapped so each hop is one seat. */}
      {!blown && (
        <g className="bomb" style={{ transform: `rotate(${bombX * deg}deg)`, transitionDuration: `${hopMs}ms` }}>
          <g key={hops} className={'bomb-body' + (hops > 0 ? ' hop' : '')}>
            <circle cx={C} cy={C - R_SEAT} r={seatR + 5} className="bomb-halo" />
            <circle cx={C} cy={C - R_SEAT} r={seatR - 1} className="bomb-core" />
            <path d={`M ${C + seatR * 0.45} ${C - R_SEAT - seatR * 0.6} q 5 -7 10 -5`} className="fuse" />
            <circle cx={C + seatR * 0.45 + 10} cy={C - R_SEAT - seatR * 0.6 - 5} r={3} className="spark" />
          </g>
        </g>
      )}

      {/* Seat tap targets. */}
      {editable &&
        Array.from({ length: n }, (_, s) => {
          const p = polar(s * deg, R_SEAT);
          return (
            <circle key={`hit-${s}`} cx={f(p.x)} cy={f(p.y)} r={Math.max(seatR + 5, 15)} className="hit" data-seat={s} onClick={() => onSeat(s)}>
              <title>{picks.includes(s) ? `Seat ${s} (yours)` : `Back seat ${s}`}</title>
            </circle>
          );
        })}

      {/* The donut: your share of the heat. */}
      <circle cx={C} cy={C} r={R_DONUT} className="donut-bg" strokeWidth={DONUT_W} />
      {winDeg > 0.5 && <path d={arcPath(0, winDeg, R_DONUT)} className="donut-win" strokeWidth={DONUT_W} />}
      {verdict === null ? (
        <>
          <text x={C} y={C + 4} className="big">
            {(win * 100).toFixed(1)}%
          </text>
          <text x={C} y={C + 24} className="small">
            to win
          </text>
          <text x={C} y={C - 22} className="tiny">
            fuse {fusePct}% a hop
          </text>
        </>
      ) : (
        <>
          <text x={C} y={C - 4} className={'verdict ' + verdict}>
            {verdict === 'won' ? 'you win' : verdict === 'lost' ? 'boom' : 'cashed'}
          </text>
          <text x={C} y={C + 18} className="small">
            {blown ? `on seat ${blewAt}` : `at ${pct(win)}`}
          </text>
        </>
      )}

      {/* Legend. */}
      <g className="legend">
        <rect x={4} y={362} width={11} height={11} rx={2} className="key good" />
        <text x={21} y={371.5}>blows here: you win</text>
        <rect x={4} y={381} width={11} height={11} rx={2} className="key bad" />
        <text x={21} y={390.5}>blows here: you lose</text>
        <text x={396} y={371.5} className="end">
          ring = where it blows
        </text>
        <text x={396} y={390.5} className="end">
          {hops > 0 ? `hop ${hops}` : 'starts on seat 0'}
        </text>
      </g>
    </svg>
  );
}
