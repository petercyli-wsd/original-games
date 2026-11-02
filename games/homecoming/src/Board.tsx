import { BUDGET, l1, reachOn, slotsOf, type Dim, type Side } from './math';

// The board, top to bottom:
//   1. one track per axis, folded to the distance from home (0 at the home
//      column, further out to the right). The dot on each track is that
//      axis's distance; home is every dot in the home column at once. The
//      shaded end of each track is out of reach: a dot there is further from
//      home than the steps left can cover (it closes in as steps are used);
//   2. the steps left, one pip per step;
//   3. the next step: the 2d equally likely moves as equal slots, closer moves
//      first. While a step plays, the slot it drew lights up.

const W = 400;
const H = 300;
const L = 22;
const X0 = 54;
const X1 = 384;
const R = BUDGET / 2;
const AXES = ['x', 'y', 'z'];

const TRACK_Y: Record<Dim, number[]> = { 1: [100], 2: [78, 122], 3: [60, 100, 140] };
const COL_TOP = 38;
const COL_BOT = 162;

const PIP_LABEL_Y = 188;
const PIP_Y = 196;
const PIP_H = 10;

const NEXT_LABEL_Y = 234;
const SLOT_Y = 244;
const SLOT_H = 46;

export type BoardOutcome = 'came-home' | 'too-far' | 'stayed-away' | 'caught' | 'cashed';

export interface BoardProps {
  dim: Dim;
  side: Side;
  /** Where the walk is now (signed coordinates). */
  pos: number[];
  /** Steps left. */
  left: number;
  /** The position the next-step slots are drawn for (the pre-step position while a step plays). */
  slotsFrom: number[] | null;
  /** The slot the current step drew, while it plays. */
  drawn: number | null;
  stepMs: number;
  outcome: BoardOutcome | null;
}

export default function Board({ dim, side, pos, left, slotsFrom, drawn, stepMs, outcome }: BoardProps) {
  const unit = (X1 - X0) / (R + 1);
  const xOf = (v: number) => X0 + Math.min(R + 1, v) * unit;
  const dist = l1(pos);
  const homeGood = side === 'home';
  const good = (closer: boolean) => (closer === homeGood ? 'good' : 'bad');
  const homeCls = homeGood ? 'good' : 'bad';
  const reachCls = homeGood ? 'bad' : 'good';
  const t = { transitionDuration: `${stepMs}ms` };
  const hit = outcome === 'came-home' || outcome === 'caught';

  const slots = slotsFrom ? slotsOf(dim, slotsFrom) : null;
  const nCloser = slots ? slots.filter((s) => s.closer).length : 0;
  const gap = 5;
  const slotW = (X1 - L - gap * (2 * dim - 1)) / (2 * dim);
  const pipStep = (X1 - L) / BUDGET;
  // Label the out-of-reach stretch once, on the first track with room for it.
  const labelOn = TRACK_Y[dim].findIndex((_, i) => X1 - xOf(Math.max(0, reachOn(pos, i, left) + 0.5)) > 78);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="homecoming" textAnchor="middle" role="img" aria-label={`The walk is ${dist} steps from home with ${left} steps left`}>
      {/* 1. Tracks */}
      <text x={X0 - 12} y={24} className={`home-label ${homeCls}`} textAnchor="start">
        home · {homeGood ? 'win' : 'lose'} if it returns
      </text>
      <text x={X1} y={24} className="dir-label" textAnchor="end">
        distance from home →
      </text>
      <rect x={X0 - 12} y={COL_TOP} width={24} height={COL_BOT - COL_TOP} rx={6} className={`home-col ${homeCls}${hit ? ' hit' : ''}`} />
      {TRACK_Y[dim].map((y, i) => {
        const v = Math.abs(pos[i]);
        const reach = reachOn(pos, i, left);
        const shadeFrom = Math.max(0, reach + 0.5);
        const shaded = shadeFrom < R + 1;
        return (
          <g key={i}>
            <text x={L} y={y + 5} className="axis">
              {AXES[i]}
            </text>
            <line x1={X0} x2={X1} y1={y} y2={y} className="track" />
            {shaded && (
              <g className="reach">
                <rect x={xOf(shadeFrom)} y={y - 13} width={X1 + 6 - xOf(shadeFrom)} height={26} rx={5} className={`out ${reachCls}`} style={t} />
                {i === labelOn && (
                  <text x={X1 - 2} y={y - 16} className={`out-label ${reachCls}`} textAnchor="end">
                    out of reach
                  </text>
                )}
              </g>
            )}
            {Array.from({ length: R + 2 }, (_, k) => k).map((k) => (
              <line key={k} x1={xOf(k)} x2={xOf(k)} y1={y - (k % 5 === 0 ? 6 : 3)} y2={y + (k % 5 === 0 ? 6 : 3)} className={'tick' + (k % 5 === 0 ? ' major' : '')} />
            ))}
            {v > 0 && <line x1={xOf(0)} x2={xOf(v)} y1={y} y2={y} className="gap" style={t} />}
            <g className="coord" style={{ ...t, transform: `translateX(${xOf(v)}px)` }}>
              <circle cx={0} cy={y} r={10} />
              <text x={0} y={y + 4} className="coord-num">
                {v}
              </text>
            </g>
          </g>
        );
      })}
      {[5, 10, 15].map((k) => (
        <text key={k} x={xOf(k)} y={COL_BOT + 12} className="tick-label">
          {k}
        </text>
      ))}

      {/* 2. Steps left */}
      <text x={L} y={PIP_LABEL_Y} className="title" textAnchor="start">
        Steps left: <tspan className="num">{left}</tspan> of {BUDGET}
      </text>
      <text x={X1} y={PIP_LABEL_Y} className="title" textAnchor="end">
        {dist === 0 ? 'at home' : `${dist} from home`}
      </text>
      {Array.from({ length: BUDGET }, (_, k) => (
        <rect key={k} x={L + k * pipStep + 1} y={PIP_Y} width={pipStep - 3} height={PIP_H} rx={2.5} className={'pip' + (k < BUDGET - left ? ' used' : '')} />
      ))}

      {/* 3. Next step */}
      {slots && (
        <g>
          <text x={L} y={NEXT_LABEL_Y} className="title" textAnchor="start">
            Next step: {2 * dim} equally likely moves
          </text>
          <text x={X1} y={NEXT_LABEL_Y} className="title" textAnchor="end">
            <tspan className={good(true)}>{nCloser} closer</tspan> · <tspan className={good(false)}>{2 * dim - nCloser} further</tspan>
          </text>
          {slots.map((s, i) => {
            const x = L + i * (slotW + gap);
            const cls = `slot ${good(s.closer)}${drawn === null ? '' : drawn === i ? ' drawn' : ' dim'}`;
            return (
              <g key={i} className={cls}>
                <rect x={x} y={SLOT_Y} width={slotW} height={SLOT_H} rx={6} />
                <text x={x + slotW / 2} y={SLOT_Y + 21} className="slot-arrow">
                  {s.closer ? '←' : '→'} {AXES[s.axis]}
                </text>
                <text x={x + slotW / 2} y={SLOT_Y + 37} className="slot-word">
                  {s.closer ? 'closer' : 'further'}
                </text>
              </g>
            );
          })}
        </g>
      )}
    </svg>
  );
}
