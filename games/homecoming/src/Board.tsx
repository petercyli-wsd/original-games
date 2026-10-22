import { fmtChance } from '@originals/game-sdk/ui';
import { l1, movesOf, type Dim, type Side } from './math';

// Three panels, top to bottom:
//   1. one number line per coordinate (the walk projected onto x, y, z), with
//      the home column at 0 and each coordinate's distance from home marked;
//   2. the distance from home over time, with the out-of-reach wedge where
//      the walk is further from home than it has steps left;
//   3. the 2d equally likely next moves as bars: each bar is your chance after
//      that move, and their average (the dashed line) is your chance now.

const W = 400;
const X0 = 52;
const X1 = 384;
const AXES = ['x', 'y', 'z'];

const TRACK_Y: Record<Dim, number[]> = { 1: [78], 2: [58, 102], 3: [42, 80, 118] };
const BAND_TOP = 18;
const BAND_BOT = 138;

const CH_TOP = 178;
const CH_BOT = 278;

const BAR_TOP = 326;
const BAR_BOT = 388;

export type BoardOutcome = 'came-home' | 'too-far' | 'stayed-away' | 'caught' | 'cashed';

export interface BoardProps {
  dim: Dim;
  budget: number;
  side: Side;
  /** Positions visited, starting at the origin. */
  path: number[][];
  /** Chance of the backed side now. */
  chance: number;
  /** Chance after each next move (movesOf order), or null when the round is settled. */
  bars: number[] | null;
  stepMs: number;
  outcome: BoardOutcome | null;
}

export default function Board({ dim, budget, side, path, chance, bars, stepMs, outcome }: BoardProps) {
  const R = budget / 2;
  const unit = (X1 - X0) / (2 * R);
  const cx = (X0 + X1) / 2;
  const xOf = (v: number) => cx + Math.max(-R - 0.6, Math.min(R + 0.6, v)) * unit;
  const pos = path[path.length - 1];
  const taken = path.length - 1;
  const left = budget - taken;
  const dist = l1(pos);
  const homeGood = side === 'home';
  const homeCls = homeGood ? 'good' : 'bad';
  const reachCls = homeGood ? 'bad' : 'good';
  const t = { transitionDuration: `${stepMs}ms` };

  // Distance chart.
  const sx = (s: number) => X0 + (s / budget) * (X1 - X0);
  const dy = (d: number) => CH_BOT - (Math.min(d, R + 0.5) / R) * (CH_BOT - CH_TOP);
  const trail = path.map((p, i) => `${sx(i).toFixed(1)},${dy(l1(p)).toFixed(1)}`).join(' ');
  const wedge = `${sx(budget - R)},${dy(R)} ${sx(budget)},${dy(0)} ${sx(budget)},${dy(R)}`;

  // Move bars.
  const moves = movesOf(dim);
  const bx0 = 104;
  const slot = (X1 - bx0) / moves.length;
  const bw = Math.min(46, slot * 0.62);
  const by = (p: number) => BAR_BOT - p * (BAR_BOT - BAR_TOP);
  const avgY = by(chance);

  return (
    <svg viewBox={`0 0 ${W} 412`} className="homecoming" textAnchor="middle" role="img" aria-label={`Walk is ${dist} steps from home with ${left} steps left`}>
      {/* 1. Coordinates */}
      <rect x={cx - Math.max(5, unit * 0.45)} y={BAND_TOP} width={2 * Math.max(5, unit * 0.45)} height={BAND_BOT - BAND_TOP} rx={4} className={`home-col ${homeCls}${outcome === 'came-home' || outcome === 'caught' ? ' hit' : ''}`} />
      <text x={cx} y={BAND_TOP - 6} className={`home-label ${homeCls}`}>
        home {homeGood ? '· you win' : '· you lose'}
      </text>
      {TRACK_Y[dim].map((y, i) => {
        const v = pos[i];
        return (
          <g key={i}>
            <text x={X0 - 22} y={y + 4} className="axis">
              {AXES[i]}
            </text>
            <line x1={X0} x2={X1} y1={y} y2={y} className="track" />
            {Array.from({ length: 2 * R + 1 }, (_, k) => k - R).map((k) => (
              <line key={k} x1={xOf(k)} x2={xOf(k)} y1={y - (k % 5 === 0 ? 5 : 3)} y2={y + (k % 5 === 0 ? 5 : 3)} className={'tick' + (k % 5 === 0 ? ' major' : '')} />
            ))}
            <text x={X0} y={y + 18} className="tick-label">
              −{R}
            </text>
            <text x={X1} y={y + 18} className="tick-label">
              +{R}
            </text>
            {v !== 0 && <line x1={xOf(0)} x2={xOf(v)} y1={y} y2={y} className="gap" />}
            <circle cx={0} cy={y} r={7} className="coord" style={{ ...t, transform: `translateX(${xOf(v)}px)` }} />
          </g>
        );
      })}

      {/* 2. Distance from home over time */}
      <text x={X0 - 4} y={CH_TOP - 14} className="title" textAnchor="start">
        Steps from home: <tspan className="num">{dist}</tspan>
      </text>
      <text x={X1} y={CH_TOP - 14} className="title" textAnchor="end">
        Steps left: <tspan className="num">{left}</tspan> of {budget}
      </text>
      <rect x={X0} y={CH_TOP} width={X1 - X0} height={CH_BOT - CH_TOP} className="chart-bg" />
      <polygon points={wedge} className={`wedge ${reachCls}`} />
      <text x={sx(budget) - 6} y={dy(R) + 14} className={`wedge-label ${reachCls}`} textAnchor="end">
        out of reach
      </text>
      <line x1={X0} x2={X1} y1={dy(0)} y2={dy(0)} className={`home-line ${homeCls}`} />
      <text x={X0 - 6} y={dy(0) + 4} className={`side-label ${homeCls}`} textAnchor="end">
        home
      </text>
      <text x={X0 - 6} y={dy(R) + 4} className="side-label" textAnchor="end">
        {R}
      </text>
      {path.length > 1 && <polyline points={trail} className="trail" />}
      <circle cx={sx(taken)} cy={dy(dist)} r={5} className="now-dot" />

      {/* 3. Next move bars */}
      {bars ? (
        <g>
          <text x={X0 - 4} y={BAR_TOP - 24} className="title" textAnchor="start">
            Next step: {moves.length} moves, each 1 in {moves.length}. Bar = your chance after it
          </text>
          {moves.map((m, i) => {
            const p = bars[i];
            const x = bx0 + slot * (i + 0.5) - bw / 2;
            const up = p >= chance - 1e-12;
            return (
              <g key={i}>
                <rect x={x} y={BAR_TOP} width={bw} height={BAR_BOT - BAR_TOP} rx={3} className="bar-bg" />
                <rect x={x} y={by(p)} width={bw} height={Math.max(0, BAR_BOT - by(p))} rx={3} className={'bar ' + (up ? 'up' : 'down')} />
                <text x={x + bw / 2} y={BAR_BOT + 14} className="bar-label">
                  {m.sign > 0 ? '+' : '−'}
                  {AXES[m.axis]}
                </text>
                <text x={x + bw / 2} y={BAR_TOP - 5} className={'bar-val' + (p >= 1 ? ' good' : p <= 0 ? ' bad' : '')}>
                  {p >= 1 ? '100%' : p <= 0 ? '0%' : `${(p * 100).toFixed(1)}%`}
                </text>
              </g>
            );
          })}
          <line x1={bx0 - 6} x2={X1} y1={avgY} y2={avgY} className="avg" />
          <text x={bx0 - 10} y={avgY - 3} className="avg-label" textAnchor="end">
            average
          </text>
          <text x={bx0 - 10} y={avgY + 11} className="avg-num" textAnchor="end">
            {fmtChance(chance)}
          </text>
        </g>
      ) : null}
    </svg>
  );
}
