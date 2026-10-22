// The hash table as a ring of slots. Each slot is 1/m of the ring, so the
// red slots (homes whose key would overflow) are literally the bust chance.

const C = 200;
/** Inner and outer radius of the slot ring. */
const R1 = 134;
const R2 = 172;
/** The probe track, where the probing key rides. */
const RT = 187;
/** The inner progress ring (one segment per key to store). */
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
  /** The slot the key hashed to. */
  home: number;
  /** Slots probed past home so far. */
  hop: number;
  /** Whether the key has reached its home (the probe window shows from then). */
  arrived: boolean;
  /** Whether the key fits (decided when it was hashed). */
  safe: boolean;
  /** Whether the animation has finished. */
  done: boolean;
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
  dist: readonly number[];
  stored: number;
  newest: number | null;
  flight: Flight | null;
  token: TokenPos;
  /** Live round (or finished one) rather than the idle preview. */
  started: boolean;
  /** Whether to show the live risk line (the round is still going). */
  live: boolean;
  redCount: number;
  fillNow: number;
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
  const { m, limit, target, table, red, dist, stored, newest, flight, token, started, live, redCount, fillNow, svgRef } = props;
  const gap = 0.0026;
  const numSize = m <= 16 ? 15 : m <= 24 ? 13.5 : 12;
  const busted = !!flight && flight.done && !flight.safe;

  // Slots the current key has looked at: home .. home + hop.
  const probed = new Set<number>();
  if (flight?.arrived) for (let i = 0; i <= flight.hop; i++) probed.add((flight.home + i) % m);

  // The probe window (home + limit slots) shows while the key probes, and stays red on an overflow.
  const windowArc = flight?.arrived && (!flight.done || busted) ? arc(flight.home / m + gap, (flight.home + limit + 1) / m - gap, RT) : null;
  // On an overflow: how far the free slot really was, beyond the window.
  const need = busted && flight ? dist[flight.home] : 0;
  const reach = busted && flight ? arc((flight.home + limit + 1) / m + gap, (flight.home + need + 0.5) / m, RT) : null;
  const miss = busted && flight ? polar((flight.home + need + 0.5) / m, RT) : null;
  const showNew = !flight || (flight.done && !busted);

  return (
    <svg ref={svgRef} viewBox="0 0 400 400" className="probe" role="img" aria-label={`${stored} of ${target} keys stored in ${m} slots; ${redCount} red slots`}>
      {/* Probe track and the current key's probe window (home + limit slots). */}
      <circle cx={C} cy={C} r={RT} className="track" />
      {windowArc && <path d={windowArc} className={'window' + (busted ? ' bust' : '')} />}

      {/* The slots. */}
      {table.map((full, i) => {
        const t0 = i / m + gap;
        const t1 = (i + 1) / m - gap;
        const cls = ['slot', full ? 'key' : 'empty', red[i] ? 'red' : '', showNew && i === newest ? 'new' : '', probed.has(i) ? (busted ? 'overflow' : 'probed') : '']
          .filter(Boolean)
          .join(' ');
        const mid = polar((i + 0.5) / m, (R1 + R2) / 2);
        return (
          <g key={i}>
            <path d={sector(t0, t1, R1, R2)} className={cls} />
            {full && (
              <text x={mid.x} y={mid.y} className={'num' + (red[i] ? ' red' : '')} style={{ fontSize: numSize }}>
                {dist[i]}
              </text>
            )}
          </g>
        );
      })}

      {/* Overflow: the free slot it needed lay beyond the window. */}
      {reach && miss && (
        <>
          <path d={reach} className="reach" />
          <g className="miss" transform={`translate(${f2(miss.x)} ${f2(miss.y)})`}>
            <circle r={8} />
            <path d="M -3.6 -3.6 L 3.6 3.6 M 3.6 -3.6 L -3.6 3.6" />
          </g>
        </>
      )}

      {/* Probed slots along the track. */}
      {flight?.arrived &&
        [...probed].map((s) => {
          const p = polar((s + 0.5) / m, RT);
          return <circle key={`p${s}`} cx={p.x} cy={p.y} r={3.2} className={'probe-dot' + (busted ? ' bust' : '')} />;
        })}

      {/* Where the key hashed to. */}
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

      {/* The key being probed rides the track. */}
      {flight && (
        <g
          className={`token ${token.ease}`}
          style={{ transform: `rotate(${token.turn * 360}deg)`, transitionDuration: `${token.ms}ms` }}
        >
          <circle cx={C} cy={C - RT} r={busted ? 9 : 7.5} className={'key-token' + (busted ? ' bust' : flight.done ? ' placed' : '')} />
        </g>
      )}

      {/* Progress: one segment per key to store. */}
      {Array.from({ length: target }, (_, k) => {
        const g = Math.min(0.006, 0.18 / target);
        return <path key={`k${k}`} d={arc(k / target + g, (k + 1) / target - g, RP)} className={'goal' + (k < stored ? ' on' : '')} />;
      })}

      {/* Centre readout. */}
      {started ? (
        <>
          <text x={C} y={C - 14} className="big">
            {stored}
            <tspan className="of">/{target}</tspan>
          </text>
          <text x={C} y={C + 10} className="small">
            keys stored
          </text>
          {live && (
            <>
              <text x={C} y={C + 40} className={'risk' + (redCount === 0 ? ' free' : '')}>
                {redCount === 0 ? 'no red slots · free key' : `${redCount} red of ${m} · ${pct(redCount / m)} bust`}
              </text>
              <text x={C} y={C + 62} className="small">
                fill chance from here {pct(fillNow)}
              </text>
            </>
          )}
        </>
      ) : (
        <>
          <text x={C} y={C - 14} className="big">
            {target}
            <tspan className="of"> keys</tspan>
          </text>
          <text x={C} y={C + 10} className="small">
            into {m} slots
          </text>
          {/* The probe window in miniature: home plus `limit` more slots. */}
          {Array.from({ length: limit + 1 }, (_, i) => {
            const w = 15;
            const g = 4;
            const x0 = C - ((limit + 1) * w + limit * g) / 2;
            return <rect key={`w${i}`} x={x0 + i * (w + g)} y={C + 30} width={w} height={w} rx={3} className={'mini' + (i === 0 ? ' home' : '')} />;
          })}
          <text x={C} y={C + 66} className="small">
            home + {limit} probe{limit === 1 ? '' : 's'} max
          </text>
        </>
      )}
    </svg>
  );
}
