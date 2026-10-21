import { type Arc, type Window } from './math';

const C = 200;
const R = 150;

const polar = (turn: number, r = R) => {
  const a = turn * 2 * Math.PI;
  return { x: C + r * Math.sin(a), y: C - r * Math.cos(a) };
};

/** SVG path along the ring for an arc (clockwise from the top). */
function arcPath({ start, length }: Arc, r = R) {
  const len = Math.min(length, 0.99999);
  const a = polar(start, r);
  const b = polar(start + len, r);
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${r} ${r} 0 ${len > 0.5 ? 1 : 0} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

export interface BoardProps {
  window: Window;
  points: number[];
  /** The covering arc of the points. */
  spanArc: Arc | null;
  /** Where the next point would bust. */
  bustArc: Arc | null;
  /** The point being dropped right now, and where it lands. */
  dropping: number | null;
  /** Turns the spinner has travelled (for the animation). */
  spin: number;
  spinMs: number;
  /** The point that broke the window, if the round busted. */
  bustPoint: number | null;
  q: number;
  live: boolean;
}

export default function Board({ window, points, spanArc, bustArc, dropping, spin, spinMs, bustPoint, q, live }: BoardProps) {
  const spanDeg = spanArc ? Math.round(spanArc.length * 360) : 0;
  const preview: Arc = { start: -window / 720, length: window / 360 };

  return (
    <svg viewBox="0 0 400 400" className="moon" role="img" aria-label={`Points span ${spanDeg} of ${window} degrees`}>
      <circle cx={C} cy={C} r={R} className="track" />
      {/* Before the first drop: show the window itself. */}
      {points.length === 0 && <path d={arcPath(preview)} className="window-preview" />}
      {spanArc && spanArc.length > 0 && <path d={arcPath(spanArc)} className="span" />}
      {bustArc && live && (
        <>
          <path d={arcPath(bustArc)} className="bust-zone" />
          <path d={arcPath(bustArc, R - 26)} className="bust-guide" />
        </>
      )}

      {points.map((p, i) => {
        const { x, y } = polar(p);
        const last = i === points.length - 1;
        return <circle key={`${i}-${p}`} cx={x} cy={y} r={last ? 9 : 7} className={'pt' + (last ? ' last' : '')} />;
      })}
      {bustPoint !== null && (
        <circle cx={polar(bustPoint).x} cy={polar(bustPoint).y} r={11} className="pt busted" />
      )}

      {/* The spinner sweeps round to where the next point lands. */}
      <g className="spinner" style={{ transform: `rotate(${spin * 360}deg)`, transitionDuration: `${spinMs}ms` }}>
        <line x1={C} y1={C} x2={C} y2={C - R + 16} />
        <circle cx={C} cy={C - R} r={dropping !== null ? 8 : 0} className="comet" />
      </g>
      <circle cx={C} cy={C} r={7} className="hub" />

      <text x={C} y={C - 26} className="big">
        {points.length === 0 ? `${window}°` : `${spanDeg}°`}
      </text>
      <text x={C} y={C + 2} className="small">
        {points.length === 0 ? 'window' : `of ${window}° used`}
      </text>
      {live && points.length > 0 && (
        <text x={C} y={C + 44} className={'risk' + (q === 0 ? ' free' : '')}>
          {q === 0 ? 'free drop' : `${(q * 100).toFixed(1)}% bust zone`}
        </text>
      )}
    </svg>
  );
}
