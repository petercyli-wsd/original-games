import { fmtChance } from '@originals/game-sdk/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { HOME_LABEL, dist, homeChance, stepArcs, upShare, type Home, type Pt, type StepArc } from './math';

const C = 200;
/** Arena radius in px. */
const R = 186;
const TAU = 2 * Math.PI;
/**
 * The walker always rests on this ray from the centre (straight up). The walk
 * has no preferred direction, so after each step the board turns to put the
 * walker back on it: only the distance from the centre is ever shown changing.
 */
const RAY = -Math.PI / 2;

export type BoardOutcome = 'home' | 'sure' | 'missed' | 'reach' | 'cashed';

export interface Move {
  id: number;
  /** Distance the step starts from (on the ray). */
  from: number;
  /** Step direction, radians (0 = right, clockwise on screen). */
  angle: number;
  /** Landing point, before the board turns. */
  to: Pt;
}

export interface BoardProps {
  home: Home;
  steps: number;
  /** Steps left at the committed position. */
  left: number;
  /** The walker's committed distance from the centre. */
  r: number;
  /** The step in flight, if any. */
  move: Move | null;
  moveMs: number;
  zoomMs: number;
  /** View radius to show, in step lengths. */
  view: number;
  live: boolean;
  outcome: BoardOutcome | null;
}

const ease = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
const easeOut = (u: number) => 1 - (1 - u) ** 3;
const clamp01 = (u: number) => Math.min(1, Math.max(0, u));
const rot = (p: Pt, a: number): Pt => ({ x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) });
const onRay = (r: number): Pt => ({ x: r * Math.cos(RAY), y: r * Math.sin(RAY) });

/** The turn that puts p back on the ray, in (−π, π]. */
function turnFor(p: Pt) {
  if (dist(p) < 1e-9) return 0;
  let a = RAY - Math.atan2(p.y, p.x);
  while (a > Math.PI) a -= TAU;
  while (a <= -Math.PI) a += TAU;
  return a;
}

/** Tweens a number towards its target over ms (requestAnimationFrame). */
function useTween(target: number, ms: number) {
  const [, force] = useState(0);
  const st = useRef({ from: target, to: target, v: target, t0: 0 });
  useEffect(() => {
    const s = st.current;
    if (s.to === target) return;
    s.from = s.v;
    s.to = target;
    s.t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const u = Math.min(1, (now - s.t0) / Math.max(1, ms));
      s.v = s.from + (s.to - s.from) * easeOut(u);
      force((n) => n + 1);
      if (u < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return st.current.v;
}

/** 0 → 1 over ms each time a new move id arrives; 1 when idle. */
function useProgress(id: number | null, ms: number) {
  const [st, setSt] = useState<{ id: number | null; u: number }>({ id: null, u: 1 });
  useEffect(() => {
    if (id === null) return;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const u = Math.min(1, (now - t0) / Math.max(1, ms));
      setSt({ id, u });
      if (u < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [id, ms]);
  if (id === null) return 1;
  return st.id === id ? st.u : 0;
}

function arcD(cx: number, cy: number, r: number, a0: number, a1: number) {
  const span = Math.min(a1 - a0, TAU - 1e-4);
  const x0 = cx + r * Math.cos(a0);
  const y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a0 + span);
  const y1 = cy + r * Math.sin(a0 + span);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r.toFixed(2)} ${r.toFixed(2)} 0 ${span > Math.PI ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

export default function Board({ home, steps, left, r, move, moveMs, zoomMs, view, live, outcome }: BoardProps) {
  const W = useTween(view, zoomMs);
  const s = R / W;
  const px = (p: Pt) => ({ x: C + p.x * s, y: C + p.y * s });

  // A step plays in three beats: the needle spins to the drawn direction, the
  // walker glides one step along it, then the board turns the walker back onto the ray.
  const u = useProgress(move?.id ?? null, moveMs);
  const spinU = move ? clamp01(u / 0.4) : 1;
  const glideU = move ? clamp01((u - 0.4) / 0.32) : 0;
  const turnU = move ? clamp01((u - 0.72) / 0.28) : 0;

  const start = onRay(move ? move.from : r);
  const turn = move ? turnFor(move.to) : 0;
  const turned = turn * ease(turnU);

  // The needle rests where it last pointed and spins at least one full turn to the new direction.
  const rest = useRef(RAY);
  const spinFrom = useRef(rest.current);
  const lastId = useRef<number | null>(null);
  if (move && move.id !== lastId.current) {
    lastId.current = move.id;
    spinFrom.current = rest.current;
    rest.current = move.angle + turn;
  }
  let spinTo = move ? move.angle : rest.current;
  if (move) while (spinTo < spinFrom.current + TAU) spinTo += TAU;
  const needle = move ? spinFrom.current + (spinTo - spinFrom.current) * easeOut(spinU) : rest.current;

  const glided: Pt = move ? { x: start.x + (move.to.x - start.x) * ease(glideU), y: start.y + (move.to.y - start.y) * ease(glideU) } : start;
  const walker = rot(glided, turned);
  const over = outcome !== null;
  const idle = !live && !over;

  // The odds pictures for the committed state (they update when the step lands).
  const showOdds = !over && left > 0;
  const arcs: StepArc[] | null = useMemo(() => (showOdds ? stepArcs(left, onRay(r), home) : null), [showOdds, left, r, home]);
  const chanceNow = showOdds ? homeChance(left, r, home) : 0;

  // Where home is out of reach with `left` steps to go (kept after an out-of-reach loss, to show why).
  const showReach = showOdds || outcome === 'reach';
  const reachOuter = left >= 1 ? left + home : null;
  const reachInner = left === 1 && home < 1 ? 1 - home : null;

  const w = px(walker);
  const homeR = home * s;
  const stepR = s;
  const resting = !move;
  const showStepCircle = showOdds && (resting || spinU < 1);
  const taken = steps - left;
  const walkerTone = outcome === 'home' || outcome === 'sure' ? 'win' : outcome === 'missed' || outcome === 'reach' ? 'lose' : outcome === 'cashed' ? 'cash' : '';

  // Labels: home under the disc, out-of-reach under its ring, the chance tag
  // beside the walker, and on the last step the green arc's share.
  const homeLabelY = C + homeR + 15;
  const reachLabel = showReach && reachOuter !== null && reachOuter * s < R - 8 ? C + reachOuter * s + 12 : null;
  const tag = { x: w.x + Math.max(stepR, 14) + 44, y: w.y };
  let arcLabel: { y: number; text: string } | null = null;
  if (left === 1 && arcs && resting && !over) {
    let y = w.y + stepR + 17;
    if (Math.abs(y - homeLabelY) < 15) y = homeLabelY + 16;
    arcLabel = { y, text: `${fmtChance(upShare(arcs))} of directions land home` };
  }

  // Pips for the steps taken, kept clear of the arena's rim.
  const pipGap = steps > 9 ? 10 : 12;

  const stepLine = move && glideU > 0 ? { a: px(rot(start, turned)), b: w } : null;
  const needleAt = px(start);

  return (
    <svg
      viewBox="0 0 400 400"
      className="pearson"
      role="img"
      aria-label={`Walker ${r.toFixed(2)} steps from the centre of home, ${left} step${left === 1 ? '' : 's'} left`}
    >
      <defs>
        <clipPath id="pw-arena">
          <circle cx={C} cy={C} r={R} />
        </clipPath>
      </defs>

      <circle cx={C} cy={C} r={R} className="arena" />
      <g clipPath="url(#pw-arena)">
        {/* Distance scale: circles one step apart. */}
        {Array.from({ length: Math.ceil(W) + 1 }, (_, i) => i + 1).map((i) => (
          <circle key={`g${i}`} cx={C} cy={C} r={i * s} className="grid" />
        ))}
        {/* The ray the walker lives on. */}
        <line x1={C} y1={C} x2={C + R * Math.cos(RAY)} y2={C + R * Math.sin(RAY)} className="ray" />

        {/* Out of reach: no remaining walk can get home from here. */}
        {showReach && reachOuter !== null && reachOuter * s < R + 40 && (
          <>
            <path
              d={`M ${C - R - 50} ${C} a ${R + 50} ${R + 50} 0 1 0 ${2 * (R + 50)} 0 a ${R + 50} ${R + 50} 0 1 0 ${-2 * (R + 50)} 0 M ${C - reachOuter * s} ${C} a ${reachOuter * s} ${reachOuter * s} 0 1 1 ${2 * reachOuter * s} 0 a ${reachOuter * s} ${reachOuter * s} 0 1 1 ${-2 * reachOuter * s} 0`}
              className="dead"
              fillRule="evenodd"
            />
            <circle cx={C} cy={C} r={reachOuter * s} className="reach" />
          </>
        )}

        {showReach && reachInner !== null && (
          <>
            <circle cx={C} cy={C} r={reachInner * s} className="dead" />
            {Math.abs(reachInner - home) > 0.05 && <circle cx={C} cy={C} r={reachInner * s} className="reach" />}
          </>
        )}

        {/* Home. */}
        <circle cx={C} cy={C} r={homeR} className={'home' + (walkerTone === 'win' ? ' won' : '')} />
        <circle cx={C} cy={C} r={3.5} className="origin" />

        {/* The step circle: where the next step can land. */}
        {showStepCircle && (
          <g className={'step-circle' + (move ? ' spinning' : '')}>
            <circle cx={w.x} cy={w.y} r={stepR} className="step-base" />
            {arcs?.map((a, i) => <path key={i} d={arcD(w.x, w.y, stepR, a.from, a.to)} className={a.up ? 'arc-up' : 'arc-down'} />)}
          </g>
        )}
        {outcome === 'sure' && <circle cx={w.x} cy={w.y} r={stepR} className="arc-up" />}

        {/* The step being taken: it turns with the board as the walker returns to the ray. */}
        {stepLine && <line x1={stepLine.a.x} y1={stepLine.a.y} x2={stepLine.b.x} y2={stepLine.b.y} className="step-line" />}

        {/* Needle: spins to the drawn direction, then the walker follows it. */}
        {move && glideU === 0 && (
          <g className="needle">
            <line x1={needleAt.x} y1={needleAt.y} x2={needleAt.x + stepR * Math.cos(needle)} y2={needleAt.y + stepR * Math.sin(needle)} />
            <circle cx={needleAt.x + stepR * Math.cos(needle)} cy={needleAt.y + stepR * Math.sin(needle)} r={6} />
          </g>
        )}
      </g>

      {/* Labels sit above the clip so they stay readable. */}
      {/* (Hidden once the round is over: the result card sits there.) */}
      {!over && homeLabelY < 392 && (
        <text x={C} y={homeLabelY + 4} className="home-label">
          home · radius {HOME_LABEL[home]}
        </text>
      )}
      {reachLabel !== null && Math.abs(reachLabel - homeLabelY) > 14 && (
        <text x={C} y={reachLabel + 4} className="reach-label">
          out of reach
        </text>
      )}

      <circle cx={w.x} cy={w.y} r={8} className={'walker ' + walkerTone} />

      {/* The walker's chance, beside it. */}
      {showOdds && resting && (
        <g className="tag" transform={`translate(${tag.x.toFixed(1)} ${tag.y.toFixed(1)})`}>
          <rect x={-36} y={-12} width={72} height={23} rx={11.5} />
          <text y={4.5}>{fmtChance(chanceNow)}</text>
        </g>
      )}
      {idle && (
        <text x={tag.x} y={tag.y + 27} className="hint-label">
          start
        </text>
      )}

      {arcLabel && (
        <text x={C} y={arcLabel.y + 4} className="arc-label">
          {arcLabel.text}
        </text>
      )}

      {/* Steps taken, as pips. */}
      <g className="pips" transform="translate(10 11)">
        {Array.from({ length: steps }, (_, i) => (
          <circle key={i} cx={i * pipGap} cy={0} r={4} className={i < taken ? 'done' : i === taken && move ? 'now' : ''} />
        ))}
        <text x={(steps - 1) * pipGap + 10} y={4} className="pip-count">
          {taken}/{steps}
        </text>
      </g>
    </svg>
  );
}
