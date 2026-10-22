import { fmtChance } from '@originals/game-sdk/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { HOME_LABEL, contours, dist, homeChance, profile, stepArcs, upShare, type Home, type Pt, type StepArc } from './math';

const C = 200;
/** Arena radius in px. */
const R = 186;
const TAU = 2 * Math.PI;

export type BoardOutcome = 'home' | 'sure' | 'missed' | 'reach' | 'cashed';

export interface Move {
  id: number;
  to: Pt;
  /** Step direction, radians (0 = right, clockwise on screen). */
  angle: number;
}

export interface BoardProps {
  home: Home;
  steps: number;
  /** Steps left at the last committed position. */
  left: number;
  /** Committed positions; path[0] is the centre. */
  path: Pt[];
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

const pctLabel = (p: number) => (p >= 0.1 ? `${Math.round(p * 100)}%` : p >= 0.01 ? `${+(p * 100).toFixed(1)}%` : `${+(p * 100).toFixed(2)}%`);

export default function Board({ home, steps, left, path, move, moveMs, zoomMs, view, live, outcome }: BoardProps) {
  const W = useTween(view, zoomMs);
  const s = R / W;
  const px = (p: Pt) => ({ x: C + p.x * s, y: C + p.y * s });

  const u = useProgress(move?.id ?? null, moveMs);
  const from = path[path.length - 1];
  const spinU = move ? Math.min(1, u / 0.5) : 1;
  const glideU = move ? Math.max(0, (u - 0.5) / 0.5) : 0;

  // The needle rests where it last pointed and spins at least one full turn to the new direction.
  const rest = useRef(-Math.PI / 2);
  const spinFrom = useRef(rest.current);
  const lastId = useRef<number | null>(null);
  if (move && move.id !== lastId.current) {
    lastId.current = move.id;
    spinFrom.current = rest.current;
    rest.current = move.angle;
  }
  let spinTo = move ? move.angle : rest.current;
  if (move) while (spinTo < spinFrom.current + TAU) spinTo += TAU;
  const needle = move ? spinFrom.current + (spinTo - spinFrom.current) * easeOut(spinU) : rest.current;

  const walker: Pt = move ? { x: from.x + (move.to.x - from.x) * ease(glideU), y: from.y + (move.to.y - from.y) * ease(glideU) } : from;
  const r = dist(from);
  const over = outcome !== null;
  const idle = !live && !over;

  // The odds field for the committed state (it updates when the step lands).
  const showField = !over && left > 0;
  const fieldMax = view + 0.6;
  const field = useMemo(() => (showField ? profile(left, home, fieldMax, 72) : []), [showField, left, home, fieldMax]);
  const peak = useMemo(() => Math.max(1e-12, ...field.map((f) => f.p)), [field]);
  // On the last step the green arc is the exact odds, so the rings step aside.
  const rings = useMemo(() => (showField && left > 1 ? contours(left, home, fieldMax) : []), [showField, left, home, fieldMax]);
  const arcs: StepArc[] | null = useMemo(() => (showField ? stepArcs(left, from, home) : null), [showField, left, from, home]);
  const chanceNow = showField ? homeChance(left, r, home) : 0;

  // Where home is out of reach with `left` steps to go (kept after an out-of-reach loss, to show why).
  const showReach = showField || outcome === 'reach';
  const reachOuter = left >= 1 ? left + home : null;
  const reachInner = left === 1 && home < 1 ? 1 - home : null;

  const w = px(walker);
  const home0 = px({ x: 0, y: 0 });
  const homeR = home * s;
  const stepR = s;
  const showStepCircle = (idle || (live && spinU < 1) || (live && !move)) && left > 0 && !over;

  // The odds tag sits on the walker's own ring, on the far side from the walker.
  const tag = (() => {
    if (r * s < 60) return { x: w.x, y: w.y + (idle ? 30 : -30) };
    const a = Math.atan2(from.y, from.x) + Math.PI;
    return { x: Math.min(362, Math.max(38, C + r * s * Math.cos(a))), y: Math.min(386, Math.max(14, C + r * s * Math.sin(a))) };
  })();

  const taken = path.length - 1;
  const walkerTone = outcome === 'home' || outcome === 'sure' ? 'win' : outcome === 'missed' || outcome === 'reach' ? 'lose' : outcome === 'cashed' ? 'cash' : '';

  // Label for the step circle: the literal odds on the last step.
  const lastStep = left === 1 && arcs !== null && !move;
  const greenArc = lastStep ? arcs!.find((a) => a.up) : undefined;

  // Greedy label layout: fixed marks first, then each ring label at the first free spot.
  type Box = { x: number; y: number; hw: number; hh: number };
  const boxes: Box[] = [{ x: w.x, y: w.y, hw: 12, hh: 12 }, { x: 10 + steps * 6 + 14, y: 14, hw: steps * 6 + 18, hh: 10 }];
  const isFree = (b: Box) =>
    b.x - b.hw > 2 && b.x + b.hw < 398 && b.y - b.hh > 2 && b.y + b.hh < 398 && boxes.every((o) => Math.abs(o.x - b.x) > o.hw + b.hw + 3 || Math.abs(o.y - b.y) > o.hh + b.hh + 2);
  const textBox = (x: number, y: number, chars: number, size = 11.5): Box => ({ x, y, hw: chars * size * 0.33 + 4, hh: size * 0.62 + 2 });
  const showTag = showField && !move;
  if (showTag) boxes.push({ x: tag.x, y: tag.y, hw: 38, hh: 13 });
  let arcLabel: { x: number; y: number; text: string } | null = null;
  if (greenArc) {
    const text = `${fmtChance(upShare(arcs!))} of directions`;
    const mid = (greenArc.from + greenArc.to) / 2;
    for (const [dr, da] of [[18, 0], [30, 0], [18, 0.5], [18, -0.5], [44, 0], [-16, 0]]) {
      const x = w.x + (stepR + dr) * Math.cos(mid + da);
      const y = w.y + (stepR + dr) * Math.sin(mid + da);
      const b = textBox(x, y, text.length, 12);
      if (isFree(b) || dr === -16) {
        boxes.push(b);
        arcLabel = { x, y, text };
        break;
      }
    }
  }
  const reachLabel = showReach && reachOuter !== null && reachOuter * s < R - 6 ? { x: C, y: C + reachOuter * s + 11 } : null;
  if (reachLabel) boxes.push(textBox(reachLabel.x, reachLabel.y, 12, 11));
  const idleLabels = idle ? { home: C + Math.max(homeR, stepR) + 12, hint: C - stepR - 13 } : null;
  if (idleLabels) boxes.push(textBox(C, idleLabels.home, 20, 11), textBox(C, idleLabels.hint, 22, 11));
  const ringLabels: { x: number; y: number; text: string }[] = [];
  const ANGLES = [-45, -135, 45, 135, -65, -115, 65, 115, -25, -155, 25, 155].map((d) => (d * Math.PI) / 180);
  for (const c of rings) {
    const rr = c.radius * s;
    if (rr < 22 || rr > R - 8) continue;
    const text = pctLabel(c.level);
    for (const a of ANGLES) {
      const b = textBox(C + rr * Math.cos(a), C + rr * Math.sin(a), text.length);
      if (isFree(b)) {
        boxes.push(b);
        ringLabels.push({ x: b.x, y: b.y, text });
        break;
      }
    }
  }

  return (
    <svg viewBox="0 0 400 400" className="pearson" role="img" aria-label={`Walker ${r.toFixed(2)} steps from home, ${left} steps left`}>
      <defs>
        <clipPath id="pw-arena">
          <circle cx={C} cy={C} r={R} />
        </clipPath>
        <radialGradient id="pw-field" gradientUnits="userSpaceOnUse" cx={C} cy={C} r={fieldMax * s}>
          {field.map((f, i) => (
            <stop key={i} offset={f.r / fieldMax} stopColor="var(--accent)" stopOpacity={0.03 + 0.55 * Math.pow(f.p / peak, 1.6)} />
          ))}
        </radialGradient>
      </defs>

      <circle cx={C} cy={C} r={R} className="arena" />
      <g clipPath="url(#pw-arena)">
        {showField && <circle cx={C} cy={C} r={fieldMax * s} fill="url(#pw-field)" className="field" />}

        {/* Faint polar grid: circles one step apart and 12 spokes. */}
        {Array.from({ length: Math.ceil(W) + 1 }, (_, i) => i + 1).map((i) => (
          <circle key={`g${i}`} cx={C} cy={C} r={i * s} className="grid" />
        ))}
        {Array.from({ length: 12 }, (_, i) => (
          <line key={`s${i}`} x1={C} y1={C} x2={C + R * Math.cos((i * TAU) / 12)} y2={C + R * Math.sin((i * TAU) / 12)} className="grid" />
        ))}

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

        {/* Iso-odds rings for the current number of steps left. */}
        {rings.map((c, i) => (
          <circle key={`c${i}`} cx={C} cy={C} r={c.radius * s} className="ring" />
        ))}

        {/* Home. */}
        <circle cx={home0.x} cy={home0.y} r={homeR} className={'home' + (walkerTone === 'win' ? ' won' : '')} />

        {/* The walker's own ring: every point on it has the walker's odds. */}
        {showField && r > 0.05 && !move && <circle cx={C} cy={C} r={r * s} className="own-ring" />}

        {/* Trail. */}
        <polyline points={[...path.map(px), w].map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} className="trail" />
        {path.slice(1).map((p, i) => {
          const q = px(p);
          return <circle key={`t${i}`} cx={q.x} cy={q.y} r={3} className="trail-dot" />;
        })}
        <circle cx={home0.x} cy={home0.y} r={4} className="origin" />

        {/* The step circle: where the next step can land. */}
        {showStepCircle && (
          <g className={'step-circle' + (move ? ' spinning' : '')}>
            <circle cx={w.x} cy={w.y} r={stepR} className="step-base" />
            {arcs?.map((a, i) => <path key={i} d={arcD(w.x, w.y, stepR, a.from, a.to)} className={a.up ? 'arc-up' : 'arc-down'} />)}
          </g>
        )}

        {outcome === 'sure' && <circle cx={w.x} cy={w.y} r={stepR} className="arc-up" />}

        {/* Needle: spins to the drawn direction, then the walker follows it. */}
        {move && (
          <g className="needle" style={{ opacity: glideU > 0 ? 0.6 : 1 }}>
            <line x1={px(from).x} y1={px(from).y} x2={px(from).x + stepR * Math.cos(needle)} y2={px(from).y + stepR * Math.sin(needle)} />
            {glideU === 0 && <circle cx={px(from).x + stepR * Math.cos(needle)} cy={px(from).y + stepR * Math.sin(needle)} r={6} />}
          </g>
        )}
      </g>

      {/* Labels sit above the clip so they stay readable. */}
      {ringLabels.map((l, i) => (
        <text key={`l${i}`} x={l.x} y={l.y + 4} className="ring-label">
          {l.text}
        </text>
      ))}
      {reachLabel && (
        <text x={reachLabel.x} y={reachLabel.y + 4} className="reach-label">
          out of reach
        </text>
      )}
      {idleLabels && (
        <>
          <text x={C} y={idleLabels.home + 4} className="home-label">
            home · radius {HOME_LABEL[home]}
          </text>
          <text x={C} y={idleLabels.hint + 4} className="hint-label">
            first step lands here
          </text>
        </>
      )}

      <circle cx={w.x} cy={w.y} r={8} className={'walker ' + walkerTone} />

      {/* The walker's odds, on its own ring. */}
      {showTag && (
        <g className="tag" transform={`translate(${tag.x.toFixed(1)} ${tag.y.toFixed(1)})`}>
          <rect x={-36} y={-12} width={72} height={23} rx={11.5} />
          <text y={4.5}>{fmtChance(chanceNow)}</text>
        </g>
      )}

      {arcLabel && (
        <text x={arcLabel.x} y={arcLabel.y + 4} className="arc-label">
          {arcLabel.text}
        </text>
      )}

      {/* Steps taken, as pips. */}
      <g className="pips" transform="translate(10 14)">
        {Array.from({ length: steps }, (_, i) => (
          <circle key={i} cx={i * 12} cy={0} r={4} className={i < taken ? 'done' : i === taken && move ? 'now' : ''} />
        ))}
        <text x={steps * 12 + 2} y={4} className="pip-count">
          {taken}/{steps}
        </text>
      </g>
    </svg>
  );
}
