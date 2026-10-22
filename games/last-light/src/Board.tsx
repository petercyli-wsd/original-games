import type { CSSProperties } from 'react';
import { ends, isLit, litCount, mod, owners, type Walk } from './math';

const C = 200;
const R_LAMP = 126;
const R_BAND = 174;
const BAND_W = 18;

const f = (v: number) => v.toFixed(2);
const pct = (p: number) => `${(p * 100).toFixed(p < 0.1 ? 1 : 0)}%`;

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

/** A small chevron on the band at `deg`, pointing clockwise (dir 1) or anticlockwise (−1). */
function chevron(deg: number, r: number, dir: 1 | -1, size: number) {
  const a = (deg * Math.PI) / 180;
  const t = { x: Math.cos(a) * dir, y: Math.sin(a) * dir }; // along the ring
  const o = { x: Math.sin(a), y: -Math.cos(a) }; // outward
  const p = polar(deg, r);
  const tip = { x: p.x + t.x * size * 0.6, y: p.y + t.y * size * 0.6 };
  const b1 = { x: p.x - t.x * size * 0.6 + o.x * size, y: p.y - t.y * size * 0.6 + o.y * size };
  const b2 = { x: p.x - t.x * size * 0.6 - o.x * size, y: p.y - t.y * size * 0.6 - o.y * size };
  return `M ${f(b1.x)} ${f(b1.y)} L ${f(tip.x)} ${f(tip.y)} L ${f(b2.x)} ${f(b2.y)}`;
}

export type Outcome = 'won' | 'lost' | 'cashed';

export interface BoardProps {
  walk: Walk;
  picks: readonly number[];
  /** A round is on: the walker and the light's flow are shown. */
  live: boolean;
  outcome: Outcome | null;
  /** Where the walker is drawn (unwrapped, fractional while it moves between lamps). */
  walkerX: number;
  /** How long a lamp's flash lasts. */
  popMs: number;
  /** Lamps can be tapped to move your picks. */
  editable: boolean;
  onPick(lamp: number): void;
  /** Chance the next lamp to light is one of yours, the chance that ends the round, and whether either can happen at all. */
  risk: number;
  bust: number;
  exposed: boolean;
}

export default function Board({ walk, walkerX, picks, live, outcome, popMs, editable, onPick, risk, bust, exposed }: BoardProps) {
  const { n } = walk;
  const deg = 360 / n;
  const own = owners(walk);
  const e = ends(walk);
  const total = n - 1;
  const mine = own.filter((o) => o !== null && picks.includes(o)).length;
  const lampR = Math.min(15, ((Math.PI * R_LAMP) / n) * 0.7);
  const gap = Math.min(2.2, deg * 0.2);
  const over = outcome !== null;
  const chev = Math.min(5, ((Math.PI * R_BAND) / n) * 0.22);

  // Where each lit lamp sits on the unwrapped line, so its slot knows which way it flows.
  const unwrapped = (j: number) => walk.lo + mod(j - walk.lo, n);

  return (
    <svg
      viewBox="0 0 400 400"
      className="ll-ring"
      role="img"
      aria-label={`${mine} of ${total} slots point to your lamps`}
      style={{ '--pop': `${popMs}ms` } as CSSProperties}
    >
      {/* The odds: one slot per lamp except the walker's, coloured by the dark lamp it would make last. */}
      <g className="slots">
        {own.map((o, j) => {
          const a0 = j * deg - deg / 2 + gap / 2;
          const a1 = j * deg + deg / 2 - gap / 2;
          if (o === null) return <path key={j} d={arcPath(a0, a1, R_BAND)} className="slot walker-slot" strokeWidth={BAND_W} />;
          const yours = picks.includes(o);
          const lit = o !== j;
          const dir = unwrapped(j) > walk.x ? 1 : -1;
          return (
            <g key={j} className={'slot-g' + (yours ? ' mine' : '') + (lit ? ' flow' : '')}>
              <path d={arcPath(a0, a1, R_BAND)} className="slot" strokeWidth={BAND_W} />
              {lit && <path d={chevron(j * deg, R_BAND, dir, chev)} className="chev" />}
            </g>
          );
        })}
      </g>

      {/* The wire, and the light so far. */}
      <circle cx={C} cy={C} r={R_LAMP} className="wire" />
      {litCount(walk) > 1 && <path d={arcPath(walk.lo * deg, walk.hi * deg, R_LAMP)} className="light" />}

      {Array.from({ length: n }, (_, j) => {
        const p = polar(j * deg, R_LAMP);
        const lit = isLit(walk, j);
        const pick = picks.includes(j);
        const end = !lit && (j === e.right || j === e.left);
        const cls =
          'lamp' +
          (lit ? ' lit' : '') +
          (pick ? ' pick' : '') +
          (pick && lit ? ' lost' : '') +
          (pick && !lit && outcome === 'won' ? ' won' : '') +
          (end && live && !over ? ' end' : '');
        return (
          <g key={j}>
            {pick && !lit && exposed && end && live && !over && <circle cx={p.x} cy={p.y} r={lampR + 6} className="danger" />}
            <circle cx={p.x} cy={p.y} r={lampR} className={cls} />
            {pick && lit && <path d={`M ${f(p.x - lampR * 0.45)} ${f(p.y - lampR * 0.45)} L ${f(p.x + lampR * 0.45)} ${f(p.y + lampR * 0.45)} M ${f(p.x + lampR * 0.45)} ${f(p.y - lampR * 0.45)} L ${f(p.x - lampR * 0.45)} ${f(p.y + lampR * 0.45)}`} className="cross" />}
          </g>
        );
      })}

      {/* Your lamps: a pin just outside each one. */}
      {picks.map((j) => {
        const a = j * deg;
        const tip = polar(a, R_LAMP + lampR + 3);
        const l = polar(a - Math.min(4.5, deg * 0.3), R_LAMP + lampR + 12);
        const r = polar(a + Math.min(4.5, deg * 0.3), R_LAMP + lampR + 12);
        return (
          <path
            key={`pin-${j}`}
            d={`M ${f(tip.x)} ${f(tip.y)} L ${f(l.x)} ${f(l.y)} L ${f(r.x)} ${f(r.y)} Z`}
            className={'pin' + (isLit(walk, j) ? ' lost' : '')}
          />
        );
      })}

      {/* Start marker. */}
      <text x={C} y={C - R_LAMP + lampR + 14} className="start">
        start
      </text>

      {/* The walker. Its rotation is unwrapped, so it never spins the long way round. */}
      {outcome !== 'lost' && (
        <g className="walker" style={{ transform: `rotate(${walkerX * deg}deg)` }}>
          <circle cx={C} cy={C - R_LAMP} r={lampR + 4} className="walker-halo" />
          <circle cx={C} cy={C - R_LAMP} r={Math.max(4, lampR * 0.5)} className="walker-dot" />
        </g>
      )}

      {/* Tap targets for moving your picks. */}
      {editable &&
        Array.from({ length: n - 1 }, (_, i) => {
          const j = i + 1;
          const p = polar(j * deg, R_LAMP);
          return (
            <circle key={`hit-${j}`} cx={p.x} cy={p.y} r={Math.max(lampR + 5, 13)} className="hit" data-lamp={j} onClick={() => onPick(j)}>
              <title>{picks.includes(j) ? `Lamp ${j} (yours)` : `Back lamp ${j}`}</title>
            </circle>
          );
        })}

      {!over && (
        <>
          <text x={C} y={C - 8} className={'big' + (mine === 0 ? ' none' : '')}>
            {mine}
            <tspan className="of">/{total}</tspan>
          </text>
          <text x={C} y={C + 16} className="small">
            {mine === 1 ? 'slot is yours' : 'slots are yours'}
          </text>
          {live ? (
            <>
              <text x={C} y={C + 46} className={'risk' + (!exposed ? ' free' : bust > 0 ? '' : ' soft')}>
                {exposed ? `next light yours: ${pct(risk)}` : 'free walk: none of yours next'}
              </text>
              {exposed && (
                <text x={C} y={C + 66} className="small">
                  {bust > 0 ? (picks.length > 1 ? 'it would be your last lamp' : 'that ends the round') : "it won't be your last lamp"}
                </text>
              )}
            </>
          ) : (
            <text x={C} y={C + 46} className="hint">
              {editable ? 'tap a lamp to back it' : ''}
            </text>
          )}
        </>
      )}
      {outcome === 'won' && (
        <text x={C} y={C + 6} className="verdict won">
          last light is yours
        </text>
      )}
      {outcome === 'lost' && (
        <text x={C} y={C + 6} className="verdict lost">
          {picks.length > 1 ? 'all your lamps lit' : 'your lamp lit'}
        </text>
      )}
      {outcome === 'cashed' && (
        <text x={C} y={C + 6} className="verdict cashed">
          cashed at {mine}/{total}
        </text>
      )}

      {/* Legend for the odds band. */}
      <g className="legend">
        <rect x={4} y={360} width={11} height={11} rx={2} className="key mine" />
        <text x={21} y={369.5}>your slots</text>
        <rect x={4} y={380} width={11} height={11} rx={2} className="key" />
        <text x={21} y={389.5}>other lamps</text>
        <text x={396} y={369.5} className="end-text">
          1 slot = 1/{total}
        </text>
        <text x={396} y={389.5} className="end-text">
          lit slots flow to a dark end
        </text>
      </g>
    </svg>
  );
}
