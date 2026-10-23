import type { CSSProperties } from 'react';

// Board geometry, in viewBox units.
const W = 560;
const H = 412;
const PIP_Y = 10;
const BAR_TOP = 74;
const BAR_BOT = 176;
const BAR_H = BAR_BOT - BAR_TOP;
const NUM_Y = 196;
const CY = 252;
const PRIZE_Y = 318;
const CHIP_Y = 352;

const pct = (p: number) => (p >= 0.9995 ? '100%' : p <= 0 ? '0%' : p < 0.001 ? '<0.1%' : p < 0.1 ? `${(p * 100).toFixed(1)}%` : `${Math.round(p * 100)}%`);
const mult = (m: number) => (m >= 100 ? `×${Math.round(m)}` : m >= 10 ? `×${m.toFixed(1)}` : `×${m.toFixed(2)}`);

export interface Anim {
  id: number;
  pair: number;
  blind: boolean;
  ms: number;
}

export interface BoardProps {
  cups: number;
  /** Where the ball is now (belief per slot). */
  belief: number[];
  /** The chance the ball ends under each slot. */
  chances: number[];
  slot: number;
  /** Label under each cup: the prize backing it would lock (null = not allowed). */
  prizes: (number | null)[];
  /** Your chance after each possible next move (one per neighbouring pair), or null to hide. */
  next: number[] | null;
  sched: boolean[];
  done: number;
  anim: Anim | null;
  /** The real ball, once revealed. */
  reveal: number | null;
  won: boolean | null;
  pickable: boolean;
  onPick(slot: number): void;
}

/** A pie of size p, centred at (0, 0): how much of the ball is here right now. */
function pie(p: number, r: number) {
  if (p <= 1e-9) return null;
  if (p >= 1 - 1e-9) return <circle r={r} className="pie" />;
  const a = p * 2 * Math.PI;
  const x = r * Math.sin(a);
  const y = -r * Math.cos(a);
  return <path d={`M 0 0 L 0 ${-r} A ${r} ${r} 0 ${p > 0.5 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)} Z`} className="pie" />;
}

export default function Board(props: BoardProps) {
  const { cups, belief, chances, slot, prizes, next, sched, done, anim, reveal, won, pickable, onPick } = props;
  const gap = cups === 3 ? 156 : cups === 4 ? 128 : 104;
  const r = cups === 5 ? 36 : 40;
  const xs = Array.from({ length: cups }, (_, i) => W / 2 + (i - (cups - 1) / 2) * gap);
  const barW = Math.min(52, gap * 0.42);
  const pipW = 46;
  const pipGap = 10;
  const pip0 = W / 2 - (sched.length * pipW + (sched.length - 1) * pipGap) / 2;
  const nowP = chances[slot];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="shells" role="img" aria-label={`Cup ${slot + 1} ends with the ball ${pct(nowP)} of the time`}>
      {/* The shuffle: solid pips swap in plain sight, dashed pips are blind. */}
      <g className="pips">
        {sched.map((blind, t) => {
          const x = pip0 + t * (pipW + pipGap);
          const state = t < done ? 'done' : t === done && reveal === null ? 'next' : 'todo';
          return (
            <g key={t} className={`pip ${blind ? 'blind' : 'seen'} ${state}`}>
              <rect x={x} y={PIP_Y} width={pipW} height={22} rx={11} />
              <text x={x + pipW / 2} y={PIP_Y + 15.5}>
                {blind ? '?' : '⇄'}
              </text>
            </g>
          );
        })}
      </g>

      {/* Each cup's chance to end with the ball: the bar height is the probability. */}
      <text x={2} y={BAR_TOP - 31} className="axis" style={{ textAnchor: 'start' }}>
        chance it ends here
      </text>
      {xs.map((x, i) => {
        const q = chances[i];
        const mine = i === slot;
        return (
          <g key={i} className={'bar' + (mine ? ' mine' : '') + (reveal === i ? ' found' : '')}>
            <rect x={x - barW / 2} y={BAR_TOP} width={barW} height={BAR_H} rx={6} className="track" />
            <rect
              x={x - barW / 2}
              y={BAR_TOP}
              width={barW}
              height={BAR_H}
              rx={6}
              className="fill"
              style={{ transform: `scaleY(${Math.max(0, Math.min(1, q))})` }}
            />
            <text x={x} y={BAR_TOP - 7} className={'pct' + (q === 0 ? ' zero' : '')}>
              {pct(q)}
            </text>
            <text x={x} y={NUM_Y} className="num">
              {i + 1}
            </text>
          </g>
        );
      })}

      {/* Your slot marker, under the cups. */}
      <path
        d={`M ${xs[slot] - 11} ${CY + r + 22} L ${xs[slot]} ${CY + r + 10} L ${xs[slot] + 11} ${CY + r + 22} Z`}
        className={'you' + (won === true ? ' won' : won === false ? ' lost' : '')}
      />


      {/* The cups. During a move the pair hops past each other (or hides under a cover). */}
      {xs.map((x, i) => {
        let cls = '';
        let dx = 0;
        if (anim && !anim.blind && (i === anim.pair || i === anim.pair + 1)) {
          cls = i === anim.pair ? ' hop-r' : ' hop-l';
          dx = i === anim.pair ? gap : -gap;
        } else if (anim && anim.blind && (i === anim.pair || i === anim.pair + 1)) {
          cls = ' jiggle';
        }
        const mine = i === slot;
        return (
          <g key={i} transform={`translate(${x} ${CY})`}>
            <g
              key={anim ? anim.id : 'still'}
              className={'cup' + cls + (mine ? ' mine' : '') + (reveal !== null ? ' lifted' : '') + (pickable ? ' pickable' : '')}
              style={{ '--dx': `${dx}px`, animationDuration: anim ? `${anim.ms}ms` : undefined } as CSSProperties}
              onClick={pickable ? () => onPick(i) : undefined}
              role={pickable ? 'button' : undefined}
              aria-label={pickable ? `Back cup ${i + 1}` : undefined}
            >
              <circle r={r + 6} className="hit" />
              <circle r={r} className="rim" />
              {pie(belief[i], r - 9)}
              <circle r={r - 9} className="inner" />
            </g>
          </g>
        );
      })}

      {/* The real ball, once the cups are lifted. */}
      {reveal !== null && <circle cx={xs[reveal]} cy={CY} r={16} className="ball" />}

      {/* A blind move: the pair goes under a cover. */}
      {anim?.blind && (
        <g key={anim.id} className="cover" style={{ animationDuration: `${anim.ms}ms` }}>
          <rect x={xs[anim.pair] - r - 14} y={CY - r - 14} width={gap + 2 * r + 28} height={2 * r + 28} rx={24} />
          <text x={(xs[anim.pair] + xs[anim.pair + 1]) / 2} y={CY + 2}>
            ?
          </text>
          <text x={(xs[anim.pair] + xs[anim.pair + 1]) / 2} y={CY + 24} className="sub">
            swap or not, 50/50
          </text>
        </g>
      )}

      {/* What backing each cup pays (or would relock to, if you switched now). */}
      {xs.map((x, i) => (
        <text key={i} x={x} y={PRIZE_Y + 14} className={'prize' + (i === slot ? ' mine' : '') + (prizes[i] === null ? ' off' : '')}>
          {prizes[i] === null ? '—' : mult(prizes[i]!)}
        </text>
      ))}

      {/* What each possible next move would do to your chance; they average to your chance now. */}
      {next && (
        <g className="chips">
          {next.map((q, a) => {
            const x = (xs[a] + xs[a + 1]) / 2;
            const tone = q > nowP + 1e-9 ? 'up' : q < nowP - 1e-9 ? 'down' : 'flat';
            return (
              <g key={a} className={`chip ${tone}`}>
                <rect x={x - 40} y={CHIP_Y} width={80} height={30} rx={15} />
                <text x={x} y={CHIP_Y + 21}>
                  {pct(q)}
                </text>
              </g>
            );
          })}
          <text x={W / 2} y={CHIP_Y + 52} className="legend">
            your chance if that pair {sched[done] ? 'is blind-swapped' : 'swaps'} next (each pair equally likely)
          </text>
        </g>
      )}
    </svg>
  );
}
