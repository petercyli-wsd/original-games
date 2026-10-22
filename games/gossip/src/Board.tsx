import { fmtChance } from '@originals/game-sdk/ui';
import { finishShares, phaseOf, type Call } from './math';

export type Phase = 'idle' | 'spreading' | 'checkpoint' | 'over';
export type Outcome = 'all' | 'cashed' | 'out';

export const VIEW = { w: 400, h: 478 };
const C = { x: 200, y: 146 };
const RING = 116;
const X0 = 22;
const X1 = 388;
const TRACK_Y = 292;
const TRACK_H = 24;
const HIST_TOP = 348;
const HIST_H = 62;
const AXIS_Y = 426;
const STRIP = { y: 444, h: 14 };

const unit = (x: number, y: number) => {
  const l = Math.hypot(x, y) || 1;
  return { x: x / l, y: y / l };
};
const nodeR = (n: number) => (n <= 8 ? 14 : n <= 12 ? 12 : n <= 16 ? 10.5 : n <= 24 ? 8.5 : 7);
const nodePos = (j: number, n: number) => {
  const a = (j / n) * 2 * Math.PI;
  return { x: C.x + RING * Math.sin(a), y: C.y - RING * Math.cos(a) };
};

export interface BoardProps {
  n: number;
  R: number;
  /** Rounds completed (shown on the board). */
  t: number;
  /** Informed count shown (the pre-round count while calls are in flight). */
  count: number;
  informed: readonly boolean[];
  /** Informed count after each completed round (index 0 = round 1). */
  counts: readonly number[];
  /** The calls of the round on show (animating or just finished). */
  calls: readonly Call[];
  /** Nodes that learned it in the round on show. */
  fresh: ReadonlySet<number>;
  phase: Phase;
  outcome: Outcome | null;
  /** Changes every round, so the call animation restarts. */
  roundKey: number;
  callMs: number;
}

export default function Board({ n, R, t, count, informed, counts, calls, fresh, phase, outcome, roundKey, callMs }: BoardProps) {
  const i = count;
  const left = R - t;
  const nr = nodeR(n);
  const H = R + 3;
  const cols = H + 1; // rounds 1..H, then "later"
  const cw = (X1 - X0) / cols;
  const colX = (s: number) => X0 + (s - 1) * cw;

  // Finish-time shares, in absolute rounds. After the round is over nothing moves.
  const rel = finishShares(n, i, Math.max(0, H - t));
  const abs = new Array<number>(cols + 1).fill(0); // abs[s] = P(last node hears it in round s), abs[cols] = later
  if (i >= n) abs[Math.max(1, t)] = 1;
  else if (outcome === 'out') abs[cols] = 1;
  else {
    for (let s = 1; s <= H - t; s++) abs[t + s] = rel[s];
    abs[cols] = rel[H - t + 1];
  }
  const win = i >= n ? 1 : outcome === 'out' ? 0 : abs.slice(1, R + 1).reduce((a, b) => a + b, 0);
  const peak = Math.max(0.05, ...abs);
  const live = phase === 'spreading' || phase === 'checkpoint';
  const ph = phaseOf(n, i);
  const done = i >= n;

  const phaseText = done ? 'everyone knows' : outcome === 'out' ? 'too late' : ph === 'doubling' ? 'doubling phase' : 'mop-up phase';

  return (
    <svg viewBox={`0 0 ${VIEW.w} ${VIEW.h}`} className={`gossip ${phase}${outcome ? ' ' + outcome : ''}`} role="img" aria-label={`${i} of ${n} know the rumour after ${t} of ${R} rounds`}>
      {/* The network: everyone can call everyone. */}
      <circle cx={C.x} cy={C.y} r={RING} className="ring" />

      <g key={roundKey}>
        {calls.map((c, k) => {
          // Curve each call through a control point just outside the ring at the
          // middle angle, so calls hug the rim and keep clear of the centre readout.
          const turn = (j: number) => j / n;
          let da = turn(c.to) - turn(c.from);
          if (da > 0.5) da -= 1;
          if (da < -0.5) da += 1;
          const mid = turn(c.from) + da / 2;
          const ctrl = { x: C.x + RING * 1.1 * Math.sin(mid * 2 * Math.PI), y: C.y - RING * 1.1 * Math.cos(mid * 2 * Math.PI) };
          const a = nodePos(c.from, n);
          const b = nodePos(c.to, n);
          const ua = unit(ctrl.x - a.x, ctrl.y - a.y);
          const ub = unit(ctrl.x - b.x, ctrl.y - b.y);
          const sx = a.x + ua.x * (nr + 1);
          const sy = a.y + ua.y * (nr + 1);
          const ex = b.x + ub.x * (nr + 3);
          const ey = b.y + ub.y * (nr + 3);
          const d = `M ${sx.toFixed(1)} ${sy.toFixed(1)} Q ${ctrl.x.toFixed(1)} ${ctrl.y.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`;
          return (
            <g key={k} className={'call ' + (c.fresh ? 'new' : 'waste')}>
              <path d={d} pathLength={1} style={{ animationDuration: `${callMs}ms` }} />
              <circle cx={ex} cy={ey} r={c.fresh ? 3.5 : 2.5} style={{ animationDelay: `${Math.round(callMs * 0.8)}ms` }} />
            </g>
          );
        })}
      </g>

      {informed.map((on, j) => {
        const p = nodePos(j, n);
        const isNew = fresh.has(j);
        return (
          <circle
            key={`${roundKey}-${j}`}
            cx={p.x}
            cy={p.y}
            r={nr}
            className={'node' + (on ? ' on' : '') + (isNew ? ' fresh' : '') + (j === 0 ? ' seed' : '')}
            style={isNew ? { animationDelay: `${Math.round(callMs * 0.85)}ms` } : undefined}
          />
        );
      })}

      <circle cx={C.x} cy={C.y} r={62} className="hub" />
      <text x={C.x} y={C.y - 8} className="big">
        {i}
        <tspan className="of"> / {n}</tspan>
      </text>
      <text x={C.x} y={C.y + 14} className="small">
        know the rumour
      </text>
      <text x={C.x} y={C.y + 36} className={'phase ' + (done ? 'done' : outcome === 'out' ? 'late' : ph)}>
        {phaseText}
      </text>

      {/* Rounds: the informed count after each one. */}
      <text x={X0} y={TRACK_Y - 8} className="cap left">
        Informed after each round
      </text>
      <text x={X1} y={TRACK_Y - 8} className="cap right">
        {live || phase === 'over' ? `${Math.max(0, left)} of ${R} left` : `budget ${R} rounds`}
      </text>
      {Array.from({ length: R }, (_, k) => {
        const s = k + 1;
        const c = counts[k];
        const played = c !== undefined;
        const next = live && s === t + 1;
        return (
          <g key={`t${s}`}>
            <rect
              x={colX(s) + 2}
              y={TRACK_Y}
              width={cw - 4}
              height={TRACK_H}
              rx={5}
              className={'cell' + (played ? ' played' : '') + (played && c >= n ? ' full' : '') + (next ? ' next' : '')}
              style={played ? { fillOpacity: 0.25 + 0.75 * (c / n) } : undefined}
            />
            <text x={colX(s) + cw / 2} y={TRACK_Y + 16} className={'cell-t' + (played ? ' played' : '')}>
              {played ? c : next ? '?' : ''}
            </text>
          </g>
        );
      })}

      {/* When the last node hears it: one column per round, green inside the budget. */}
      <text x={X0} y={HIST_TOP - 12} className="cap left">
        When the last one hears it
      </text>
      <text x={X1} y={HIST_TOP - 12} className={'cap right ' + (win > 0 ? 'win-t' : 'lose-t')}>
        by round {R}: {fmtChance(win)}
      </text>
      <line x1={X0} x2={X1} y1={HIST_TOP + HIST_H} y2={HIST_TOP + HIST_H} className="axis" />
      {abs.slice(1).map((p, k) => {
        const s = k + 1;
        const h = (p / peak) * HIST_H;
        const inBudget = s <= R;
        return (
          <g key={`h${s}`}>
            {s > t || s === cols || (done && s === t) ? <rect x={colX(s) + 3} y={HIST_TOP + HIST_H - h} width={cw - 6} height={Math.max(0, h)} rx={2} className={'bar ' + (inBudget ? 'g' : 'r')} /> : null}
            <text x={colX(s) + cw / 2} y={AXIS_Y} className={'tick' + (s <= t ? ' past' : '') + (inBudget ? '' : ' over')}>
              {s === cols ? 'later' : s}
            </text>
          </g>
        );
      })}
      <line x1={colX(R + 1)} x2={colX(R + 1)} y1={TRACK_Y - 2} y2={AXIS_Y + 4} className="budget-line" />

      {/* The same split as a strip: its green length is the win chance. */}
      <clipPath id="gs-strip">
        <rect x={X0} y={STRIP.y} width={X1 - X0} height={STRIP.h} rx={STRIP.h / 2} />
      </clipPath>
      <g clipPath="url(#gs-strip)">
        <rect x={X0} y={STRIP.y} width={X1 - X0} height={STRIP.h} className="strip-r" />
        <rect x={X0} y={STRIP.y} width={(X1 - X0) * win} height={STRIP.h} className="strip-g" />
      </g>
      <text x={X0} y={STRIP.y + STRIP.h + 15} className="cap left win-t">
        green = everyone by round {R}
      </text>
      <text x={X1} y={STRIP.y + STRIP.h + 15} className="cap right lose-t">
        red = too late
      </text>
    </svg>
  );
}
