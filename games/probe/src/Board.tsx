// The ring of slots. Each slot is 1/m of the ring, so the red slots (where a
// landing ball would bust) are literally the bust chance.

const C = 200;
/** Inner and outer radius of the slot ring. */
const R1 = 134;
const R2 = 172;
/** The outer track, where the dropping ball rides. */
const RT = 187;
/** The inner progress ring (one segment per ball to place). */
const RP = 116;

const polar = (turn: number, r: number) => {
  const a = turn * 2 * Math.PI;
  return { x: C + r * Math.sin(a), y: C - r * Math.cos(a) };
};
const f2 = (v: number) => v.toFixed(2);

/** An annular sector from turn t0 to t1 (clockwise from the top). */
function sector(t0: number, t1: number, r1: number, r2: number) {
  const a = polar(t0, r2);
  const b = polar(t1, r2);
  const c = polar(t1, r1);
  const d = polar(t0, r1);
  const large = t1 - t0 > 0.5 ? 1 : 0;
  return `M ${f2(a.x)} ${f2(a.y)} A ${r2} ${r2} 0 ${large} 1 ${f2(b.x)} ${f2(b.y)} L ${f2(c.x)} ${f2(c.y)} A ${r1} ${r1} 0 ${large} 0 ${f2(d.x)} ${f2(d.y)} Z`;
}

/** An open arc along radius r from turn t0 to t1. */
function arc(t0: number, t1: number, r: number) {
  const len = Math.min(t1 - t0, 0.99999);
  const a = polar(t0, r);
  const b = polar(t0 + len, r);
  return `M ${f2(a.x)} ${f2(a.y)} A ${r} ${r} 0 ${len > 0.5 ? 1 : 0} 1 ${f2(b.x)} ${f2(b.y)}`;
}

export interface Flight {
  /** The slot the ball landed on. */
  home: number;
  /** Slots slid past the landing slot so far. */
  hop: number;
  /** Whether the ball has reached its landing slot (the slide window shows from then). */
  arrived: boolean;
  /** Whether the ball fits (decided when it was dropped). */
  safe: boolean;
  /** Whether the animation has finished. */
  done: boolean;
  /** How far the nearest empty slot was (for drawing a bust). */
  need: number;
}

export interface TokenPos {
  /** Turns travelled, cumulative (the CSS rotation). */
  turn: number;
  ms: number;
  ease: 'spin' | 'hop';
}

export interface BoardProps {
  m: number;
  limit: number;
  target: number;
  table: readonly boolean[];
  red: readonly boolean[];
  placed: number;
  newest: number | null;
  flight: Flight | null;
  token: TokenPos;
  /** Live round (or finished one) rather than the idle preview. */
  started: boolean;
  /** Whether to show the live risk line (the round is still going). */
  live: boolean;
  redCount: number;
  /** Lets the game measure the board (narrow boards get the result card inline). */
  svgRef?: (el: SVGSVGElement | null) => void;
}

const pct = (p: number) => {
  const v = p * 100;
  if (v <= 0) return '0%';
  if (v >= 100) return '100%';
  return (v < 10 ? v.toFixed(1) : v.toFixed(0)) + '%';
};

export default function Board(props: BoardProps) {
  const { m, limit, target, table, red, placed, newest, flight, token, started, live, redCount, svgRef } = props;
  const gap = 0.0026;
  const busted = !!flight && flight.done && !flight.safe;
  const ballR = m <= 16 ? 9 : m <= 24 ? 8 : 6.5;

  // Slots the current ball has passed over: landing slot .. landing + hop.
  const probed = new Set<number>();
  if (flight?.arrived) for (let i = 0; i <= flight.hop; i++) probed.add((flight.home + i) % m);

  // The slide window (landing slot + max slide) shows while the ball slides, and stays red on a bust.
  const windowArc = flight?.arrived && (!flight.done || busted) ? arc(flight.home / m + gap, (flight.home + limit + 1) / m - gap, RT) : null;
  // On a bust: how far the empty slot really was, beyond the window.
  const need = busted && flight ? flight.need : 0;
  const reach = busted && flight ? arc((flight.home + limit + 1) / m + gap, (flight.home + need + 0.5) / m, RT) : null;
  const miss = busted && flight ? polar((flight.home + need + 0.5) / m, RT) : null;
  const showNew = !flight || (flight.done && !busted);

  return (
    <svg ref={svgRef} viewBox="0 0 400 400" className="probe" role="img" aria-label={`${placed} of ${target} balls placed in ${m} slots; ${redCount} red slots`}>
      {/* Outer track and the current ball's slide window. */}
      <circle cx={C} cy={C} r={RT} className="track" />
      {windowArc && <path d={windowArc} className={'window' + (busted ? ' bust' : '')} />}

      {/* The slots, each with its ball if full. */}
      {table.map((full, i) => {
        const t0 = i / m + gap;
        const t1 = (i + 1) / m - gap;
        const cls = ['slot', full ? 'full' : 'empty', red[i] ? 'red' : '', showNew && i === newest ? 'new' : '', probed.has(i) ? (busted ? 'overflow' : 'probed') : '']
          .filter(Boolean)
          .join(' ');
        const mid = polar((i + 0.5) / m, (R1 + R2) / 2);
        return (
          <g key={i}>
            <path d={sector(t0, t1, R1, R2)} className={cls} />
            {full && <circle cx={mid.x} cy={mid.y} r={ballR} className={'ball' + (red[i] ? ' red' : '')} />}
          </g>
        );
      })}

      {/* Bust: the empty slot it needed lay beyond the window. */}
      {reach && miss && (
        <>
          <path d={reach} className="reach" />
          <g className="miss" transform={`translate(${f2(miss.x)} ${f2(miss.y)})`}>
            <circle r={8} />
            <path d="M -3.6 -3.6 L 3.6 3.6 M 3.6 -3.6 L -3.6 3.6" />
          </g>
        </>
      )}

      {/* Slots passed over, along the track. */}
      {flight?.arrived &&
        [...probed].map((s) => {
          const p = polar((s + 0.5) / m, RT);
          return <circle key={`p${s}`} cx={p.x} cy={p.y} r={3.2} className={'probe-dot' + (busted ? ' bust' : '')} />;
        })}

      {/* Where the ball landed. */}
      {flight?.arrived && (
        <path
          d={(() => {
            const tip = polar((flight.home + 0.5) / m, R1 - 4);
            const l = polar((flight.home + 0.5) / m - 0.012, R1 - 15);
            const r = polar((flight.home + 0.5) / m + 0.012, R1 - 15);
            return `M ${f2(tip.x)} ${f2(tip.y)} L ${f2(l.x)} ${f2(l.y)} L ${f2(r.x)} ${f2(r.y)} Z`;
          })()}
          className={'home-mark' + (busted ? ' bust' : '')}
        />
      )}

      {/* The dropping ball rides the track. */}
      {flight && (
        <g
          className={`token ${token.ease}`}
          style={{ transform: `rotate(${token.turn * 360}deg)`, transitionDuration: `${token.ms}ms` }}
        >
          <circle cx={C} cy={C - RT} r={busted ? 9 : 7.5} className={'drop-token' + (busted ? ' bust' : flight.done ? ' placed' : '')} />
        </g>
      )}

      {/* Progress: one segment per ball to place. */}
      {Array.from({ length: target }, (_, k) => {
        const g = Math.min(0.006, 0.18 / target);
        return <path key={`k${k}`} d={arc(k / target + g, (k + 1) / target - g, RP)} className={'goal' + (k < placed ? ' on' : '')} />;
      })}

      {/* Centre readout. */}
      {started ? (
        <>
          <text x={C} y={C - 22} className="big">
            {placed}
            <tspan className="of">/{target}</tspan>
          </text>
          <text x={C} y={C + 2} className="small">
            balls placed
          </text>
          {live && (
            <>
              <text x={C} y={C + 32} className={'risk' + (redCount === 0 ? ' free' : '')}>
                {redCount === 0 ? 'No red slots · can’t bust' : `${redCount} red of ${m} · ${pct(redCount / m)} bust`}
              </text>
              <g transform={`translate(${C} ${C + 58})`}>
                <rect x={-76} y={-6} width={12} height={12} rx={2} className="legend-red" />
                <text x={-58} y={0} className="small legend">
                  red = landing here busts
                </text>
              </g>
            </>
          )}
        </>
      ) : (
        <>
          <text x={C} y={C - 30} className="big">
            {target}
            <tspan className="of"> balls</tspan>
          </text>
          <text x={C} y={C - 6} className="small">
            into {m} slots
          </text>
          {/* The rule in miniature: a ball lands on a full slot and slides on to the next. */}
          {(() => {
            const w = 22;
            const g = 6;
            const n = limit + 1;
            const x0 = C - (n * w + (n - 1) * g) / 2;
            const y = C + 22;
            return (
              <>
                {Array.from({ length: n }, (_, i) => (
                  <rect key={`w${i}`} x={x0 + i * (w + g)} y={y} width={w} height={w} rx={4} className={'mini' + (i < n - 1 ? ' full' : '')} />
                ))}
                {Array.from({ length: n - 1 }, (_, i) => (
                  <circle key={`b${i}`} cx={x0 + i * (w + g) + w / 2} cy={y + w / 2} r={5} className="mini-ball" />
                ))}
                <path
                  d={`M ${x0 + w / 2} ${y - 5} Q ${x0 + (n - 1) * (w + g) / 2 + w / 2} ${y - 18} ${x0 + (n - 1) * (w + g) + w / 2} ${y - 5}`}
                  className="mini-arrow"
                  markerEnd="url(#probe-arrow)"
                />
                <defs>
                  <marker id="probe-arrow" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="6" markerHeight="6" orient="auto">
                    <path d="M 0 0 L 8 4 L 0 8 Z" className="mini-head" />
                  </marker>
                </defs>
              </>
            );
          })()}
          <text x={C} y={C + 66} className="small">
            lands on a full slot? it slides on
          </text>
          <text x={C} y={C + 84} className="small">
            max slide: {limit} slot{limit === 1 ? '' : 's'}
          </text>
        </>
      )}
    </svg>
  );
}
