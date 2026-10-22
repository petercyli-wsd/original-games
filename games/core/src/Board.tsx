import { core as coreOf, left, redSquares, right, risk, type Interval } from './math';

// Geometry (viewBox units). The number line and the endpoint square share
// the same x scale, so the core's ends l and r drop straight down onto the
// edges of the two red corner squares.
const X0 = 54;
const W = 252;
const ROWS_TOP = 12;
const STACK_H = 128;
const LINE_Y = 160;
const SQ_TOP = 190;
const SQ_BOTTOM = SQ_TOP + W;
const VB_W = 360;
const VB_H = SQ_BOTTOM + 44;

const X = (t: number) => X0 + t * W;
const SY = (t: number) => SQ_BOTTOM - t * W;
const f2 = (x: number) => x.toFixed(2);
const pct = (x: number) => (x * 100).toFixed(x < 0.1 ? 2 : 1) + '%';

export type Mode = 'idle' | 'live' | 'over';

export interface BoardProps {
  target: number;
  /** Intervals that kept the core. */
  intervals: Interval[];
  /** The interval dropping right now (already decided), shown landing. */
  pending: Interval | null;
  /** The interval that missed the core, if the round busted. */
  bust: Interval | null;
  mode: Mode;
  /** All intervals landed: the round completed. */
  complete: boolean;
  dropMs: number;
}

export default function Board({ target, intervals, pending, bust, mode, complete, dropMs }: BoardProps) {
  const c = coreOf(intervals);
  const q = risk(c);
  const [s1, s2] = redSquares(c);
  const n = intervals.length;
  const has = n > 0;
  const rowH = STACK_H / target;
  const barW = Math.min(9, rowH * 0.5);
  const rowY = (i: number) => ROWS_TOP + (i + 0.5) * rowH;
  const showRisk = mode !== 'idle' || has;

  // Labels for l and r under the line, pushed apart if the core is narrow.
  const lx = Math.min(X(c.l) - 4, X(c.r) - 34);
  const rx = Math.max(X(c.r) + 4, X(c.l) + 34);

  const bar = (iv: Interval, i: number, cls: string, animate = false) => (
    <g key={`${cls}-${i}`} className={'bar ' + cls + (animate ? ' grow' : '')} style={animate ? { animationDuration: `${dropMs}ms` } : undefined}>
      <line x1={X(left(iv))} x2={X(right(iv))} y1={rowY(i)} y2={rowY(i)} strokeWidth={barW} />
      <circle cx={X(left(iv))} cy={rowY(i)} r={barW * 0.42} className="end" />
      <circle cx={X(right(iv))} cy={rowY(i)} r={barW * 0.42} className="end" />
    </g>
  );

  const dot = (iv: Interval, key: string, cls: string, animate = false) => (
    <circle
      key={key}
      cx={X(iv.u)}
      cy={SY(iv.v)}
      r={cls.includes('last') || cls.includes('busted') || cls.includes('landing') ? 6 : 4}
      className={'dot ' + cls + (animate ? ' drop' : '')}
      style={animate ? { animationDuration: `${dropMs}ms` } : undefined}
    />
  );

  let formula: string;
  if (mode === 'idle' && !has) formula = 'Each interval is a dot here: (first end, second end)';
  else if (!has) formula = 'First interval: no core yet, nothing can miss';
  else formula = `red area = l² + (1 − r)² = ${f2(c.l)}² + ${f2(1 - c.r)}² = ${pct(q)}`;

  return (
    <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="core-board" role="img" aria-label={`Core ${f2(c.l)} to ${f2(c.r)}, ${pct(q)} chance the next interval misses`}>
      {/* Interval slots: one row per interval to land. */}
      {Array.from({ length: target }, (_, i) => (
        <g key={`slot-${i}`} className={'slot' + (i < n ? ' filled' : '')}>
          <text x={X0 - 12} y={rowY(i) + 4} className="row-label end">
            {i + 1}
          </text>
          <line x1={X(0)} x2={X(1)} y1={rowY(i)} y2={rowY(i)} />
        </g>
      ))}

      {/* The core: the common part of every interval so far. */}
      {has && (
        <>
          <rect x={X(c.l)} y={ROWS_TOP - 4} width={Math.max(1.5, X(c.r) - X(c.l))} height={LINE_Y - ROWS_TOP + 4} className={'core-band' + (complete ? ' won' : '')} />
          <line x1={X(c.l)} x2={X(c.l)} y1={ROWS_TOP - 4} y2={SQ_BOTTOM} className="core-edge" />
          <line x1={X(c.r)} x2={X(c.r)} y1={ROWS_TOP - 4} y2={SQ_BOTTOM} className="core-edge" />
        </>
      )}

      {intervals.map((iv, i) => bar(iv, i, i === n - 1 ? 'last' : 'kept'))}
      {pending && bar(pending, n, 'landing', true)}
      {bust && bar(bust, n, 'busted')}

      {/* The unit segment and the core on it. */}
      <line x1={X(0)} x2={X(1)} y1={LINE_Y} y2={LINE_Y} className="axis" />
      <line x1={X(0)} x2={X(0)} y1={LINE_Y - 5} y2={LINE_Y + 5} className="axis" />
      <line x1={X(1)} x2={X(1)} y1={LINE_Y - 5} y2={LINE_Y + 5} className="axis" />
      <text x={X(0) - 9} y={LINE_Y + 4} className="tick end">
        0
      </text>
      <text x={X(1) + 9} y={LINE_Y + 4} className="tick start">
        1
      </text>
      {has ? (
        <>
          <line x1={X(c.l)} x2={X(c.r)} y1={LINE_Y} y2={LINE_Y} className={'core-seg' + (complete ? ' won' : '')} />
          <text x={lx} y={LINE_Y + 17} className="lr end">
            l {f2(c.l)}
          </text>
          <text x={rx} y={LINE_Y + 17} className="lr start">
            r {f2(c.r)}
          </text>
        </>
      ) : (
        <text x={X(0.5)} y={LINE_Y + 17} className="lr">
          core = the whole segment
        </text>
      )}

      {/* The endpoint square: a dot in a red corner misses the core. */}
      <rect x={X0} y={SQ_TOP} width={W} height={W} className={'sq' + (showRisk ? ' live' : '')} />
      <line x1={X(0)} y1={SY(0)} x2={X(1)} y2={SY(1)} className="diag" />
      {has && (
        <>
          <rect x={X(s1.x)} y={SY(s1.y + s1.side)} width={s1.side * W} height={s1.side * W} className="red" />
          <rect x={X(s2.x)} y={SY(s2.y + s2.side)} width={s2.side * W} height={s2.side * W} className="red" />
          {s1.side * W > 34 && (
            <text x={X(s1.side / 2)} y={SY(s1.side / 2) + 4} className="red-label">
              l²
            </text>
          )}
          {s1.side * W > 50 && (
            <text x={X(s1.side / 2)} y={SY(s1.side / 2) + 18} className="red-sub">
              {pct(s1.side ** 2)}
            </text>
          )}
          {s2.side * W > 34 && (
            <text x={X(s2.x + s2.side / 2)} y={SY(s2.y + s2.side / 2) + 4} className="red-label">
              (1−r)²
            </text>
          )}
          {s2.side * W > 50 && (
            <text x={X(s2.x + s2.side / 2)} y={SY(s2.y + s2.side / 2) + 18} className="red-sub">
              {pct(s2.side ** 2)}
            </text>
          )}
        </>
      )}
      <rect x={X0} y={SQ_TOP} width={W} height={W} className="sq-edge" />
      <text x={X0 - 10} y={SY(0.5)} className="axis-label" transform={`rotate(-90 ${X0 - 10} ${SY(0.5)})`}>
        second end →
      </text>
      <text x={X0 - 8} y={SQ_BOTTOM + 4} className="tick end">
        0
      </text>
      <text x={X0 - 8} y={SQ_TOP + 8} className="tick end">
        1
      </text>

      {intervals.map((iv, i) => dot(iv, `d${i}`, i === n - 1 ? 'last' : 'kept'))}
      {pending && dot(pending, 'pending', 'landing', true)}
      {bust && dot(bust, 'bust', 'busted')}

      <text x={X(0.5)} y={SQ_BOTTOM + 16} className="axis-label">
        first end →
      </text>
      <text x={X(0.5)} y={SQ_BOTTOM + 36} className={'formula' + (has ? ' risky' : '')}>
        {formula}
      </text>
    </svg>
  );
}
