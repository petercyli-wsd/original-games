import { useLayoutEffect, useRef } from 'react';
import { fmtChance } from '@originals/game-sdk/ui';
import { HALF_TURN, type Centre, type DirArc, type Drop, type Side } from './math';

// ---------- Shared geometry ----------

const f2 = (x: number) => x.toFixed(2);

/** Point at angle a (radians, counter-clockwise from +x, on screen) on a circle. */
const at = (cx: number, cy: number, r: number, a: number) => ({ x: cx + r * Math.cos(a), y: cy - r * Math.sin(a) });

/** Arc along a circle from angle a to b (b > a), counter-clockwise on screen. */
function arcD(cx: number, cy: number, r: number, a: number, b: number) {
  const p = at(cx, cy, r, a);
  const q = at(cx, cy, r, Math.min(b, a + 2 * Math.PI - 1e-4));
  return `M ${f2(p.x)} ${f2(p.y)} A ${r} ${r} 0 ${b - a > Math.PI ? 1 : 0} 0 ${f2(q.x)} ${f2(q.y)}`;
}

/** A filled sector (wedge) from the centre. */
function wedgeD(cx: number, cy: number, r: number, a: number, b: number) {
  const p = at(cx, cy, r, a);
  const q = at(cx, cy, r, Math.min(b, a + 2 * Math.PI - 1e-4));
  return `M ${f2(cx)} ${f2(cy)} L ${f2(p.x)} ${f2(p.y)} A ${r} ${r} 0 ${b - a > Math.PI ? 1 : 0} 0 ${f2(q.x)} ${f2(q.y)} Z`;
}

/** Both halves of a bow-tie: an arc of directions and its opposite. */
const bowTie = (arcs: DirArc[]) => arcs.flatMap((a) => [a, { start: a.start + HALF_TURN, end: a.end + HALF_TURN }]);

/**
 * Spins an element from 0 to its final rotation when it mounts (the final
 * rotation is also its static style, so it stays there afterwards).
 */
function useSpinIn(toDeg: number, ms: number, animate: boolean) {
  const ref = useRef<SVGGElement>(null);
  useLayoutEffect(() => {
    if (!animate || !ref.current || typeof ref.current.animate !== 'function') return;
    const anim = ref.current.animate([{ transform: 'rotate(0deg)' }, { transform: `rotate(${-toDeg}deg)` }], {
      duration: ms,
      easing: 'cubic-bezier(0.12, 0.6, 0.15, 1)',
    });
    return () => anim.cancel();
    // Runs once per mounted needle.
  }, []);
  return ref;
}

// ---------- Floor ----------

/** Floor units shown beyond the drop cell on every side (a needle reaches at most ½). */
const MARGIN = 0.53;
const SIZE = 400;
const S = SIZE / (1 + 2 * MARGIN);
const px = (unit: number) => (unit + MARGIN) * S;

export interface NeedleRec {
  centre: Centre;
  /** Final direction θ ∈ [0, π), once spun. */
  theta: number | null;
  /** Total rotation of the spin animation, degrees (θ plus whole half-turns). */
  spinDeg: number;
  /** Whether it landed on the backed side, once the spin has finished. */
  win: boolean | null;
}

/** Where the needle touches the lines (cell units), for the spark marks. */
function touchPoints(floor: Drop['floor'], length: number, c: Centre, theta: number) {
  const h = length / 2;
  const ex = h * Math.cos(theta);
  const ey = -h * Math.sin(theta);
  const a = { x: c.u - ex, y: c.v - ey };
  const b = { x: c.u + ex, y: c.v + ey };
  const out: { x: number; y: number }[] = [];
  for (const k of [0, 1]) {
    if ((a.y - k) * (b.y - k) <= 0 && a.y !== b.y) {
      const t = (k - a.y) / (b.y - a.y);
      out.push({ x: a.x + t * (b.x - a.x), y: k });
    }
    if (floor === 'grid' && (a.x - k) * (b.x - k) <= 0 && a.x !== b.x) {
      const t = (k - a.x) / (b.x - a.x);
      out.push({ x: k, y: a.y + t * (b.y - a.y) });
    }
  }
  return out;
}

function Needle({
  rec,
  length,
  floor,
  spinMs,
  animate,
  faded,
}: {
  rec: NeedleRec;
  length: number;
  floor: Drop['floor'];
  spinMs: number;
  animate: boolean;
  faded?: boolean;
}) {
  const cx = px(rec.centre.u);
  const cy = px(rec.centre.v);
  const half = (length / 2) * S;
  const ref = useSpinIn(rec.spinDeg, spinMs, animate);
  const tone = rec.win === null ? '' : rec.win ? ' win' : ' lose';
  return (
    <g className={'nd-needle' + tone + (faded ? ' faded' : '')}>
      <g ref={ref} style={{ transform: `rotate(${-rec.spinDeg}deg)`, transformOrigin: `${f2(cx)}px ${f2(cy)}px`, transformBox: 'view-box' }}>
        <line x1={cx - half} y1={cy} x2={cx + half} y2={cy} className="nd-needle-body" />
        <circle cx={cx + half} cy={cy} r={2.6} className="nd-needle-tip" />
        <circle cx={cx - half} cy={cy} r={2.6} className="nd-needle-tip" />
      </g>
      {rec.win !== null &&
        rec.theta !== null &&
        touchPoints(floor, length, rec.centre, rec.theta).map((p, i) => (
          <circle key={i} cx={px(p.x)} cy={px(p.y)} r={7} className="nd-touch" />
        ))}
      <circle cx={cx} cy={cy} r={3.2} className="nd-needle-pin" />
    </g>
  );
}

export interface FloorProps {
  drop: Drop;
  needles: NeedleRec[];
  /** Changes every round, so a new round's first needle animates afresh. */
  roundKey: number;
  /** The current needle's centre has landed (its direction circle is shown). */
  landed: boolean;
  /** Win directions for the current needle (when landed). */
  win: DirArc[];
  lose: DirArc[];
  dropMs: number;
  spinMs: number;
  /** Animate the current needle's spin (false when re-rendering a finished board). */
  spinning: boolean;
  idle: boolean;
}

export function Floor({ drop, needles, roundKey, landed, win, lose, dropMs, spinMs, spinning, idle }: FloorProps) {
  const { floor, side, length } = drop;
  const h = length / 2;
  const reachColour = side === 'cross' ? 'var(--green)' : 'var(--red)';
  const current = needles[needles.length - 1];
  const previous = needles.slice(0, -1);
  const r = h * S;
  const rimWidth = Math.max(3, Math.min(9, r * 0.2));

  // Reach shading in iso-odds steps: a centre at distance t·h from a line
  // touches it with chance (2/π)·arccos(t), so each step is shaded by the
  // chance at its middle. Darker means likelier to reach the line.
  const STEPS = 5;
  const grad = (id: string, x2: number, y2: number) => (
    <linearGradient id={id} x1={0} y1={0} x2={x2} y2={y2}>
      {Array.from({ length: STEPS }, (_, k) => {
        const o = 0.5 * (2 / Math.PI) * Math.acos((k + 0.5) / STEPS);
        return [
          <stop key={`a${k}`} offset={k / STEPS} style={{ stopColor: reachColour, stopOpacity: o }} />,
          <stop key={`b${k}`} offset={(k + 1) / STEPS} style={{ stopColor: reachColour, stopOpacity: o }} />,
        ];
      })}
    </linearGradient>
  );

  const zone = { x: px(0), y: px(0), s: S };
  const sideWord = side === 'cross' ? 'cross' : 'miss';

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className={'nd-floor ' + floor} role="img" aria-label={`Floor of ${floor}, needle length ${length.toFixed(2)}`}>
      <defs>
        <clipPath id="nd-clip">
          <rect x={0} y={0} width={SIZE} height={SIZE} rx={16} />
        </clipPath>
        {grad('nd-reach-down', 0, 1)}
        {grad('nd-reach-right', 1, 0)}
      </defs>

      <g clipPath="url(#nd-clip)">
        <rect x={0} y={0} width={SIZE} height={SIZE} className="nd-floor-bg" />
        {/* The cell the centre lands in, uniformly. */}
        <rect x={zone.x} y={zone.y} width={zone.s} height={zone.s} className="nd-zone" />

        {/* Reach bands: only a centre this close to a line can touch it. */}
        <g className={'nd-reach' + (idle ? '' : ' dim')}>
          <rect x={zone.x} y={zone.y} width={zone.s} height={r} fill="url(#nd-reach-down)" />
          <rect x={zone.x} y={zone.y + zone.s - r} width={zone.s} height={r} fill="url(#nd-reach-down)" transform={`rotate(180 ${zone.x + zone.s / 2} ${zone.y + zone.s - r / 2})`} />
          {floor === 'grid' && (
            <>
              <rect x={zone.x} y={zone.y} width={r} height={zone.s} fill="url(#nd-reach-right)" />
              <rect x={zone.x + zone.s - r} y={zone.y} width={r} height={zone.s} fill="url(#nd-reach-right)" transform={`rotate(180 ${zone.x + zone.s - r / 2} ${zone.y + zone.s / 2})`} />
            </>
          )}
        </g>

        {/* The ruled lines, 1 apart. */}
        {[0, 1].map((k) => (
          <line key={`h${k}`} x1={0} x2={SIZE} y1={px(k)} y2={px(k)} className="nd-line" />
        ))}
        {floor === 'grid' && [0, 1].map((k) => <line key={`v${k}`} y1={0} y2={SIZE} x1={px(k)} x2={px(k)} className="nd-line" />)}
      </g>

      {/* Spacing marker: the lines are 1 apart. */}
      <g className="nd-dim">
        <line x1={SIZE - 22} x2={SIZE - 22} y1={px(0) + 4} y2={px(1) - 4} />
        <path d={`M ${SIZE - 27} ${px(0) + 10} L ${SIZE - 22} ${px(0) + 4} L ${SIZE - 17} ${px(0) + 10} M ${SIZE - 27} ${px(1) - 10} L ${SIZE - 22} ${px(1) - 4} L ${SIZE - 17} ${px(1) - 10}`} />
        <text x={SIZE - 32} y={px(0.5) + 5} className="nd-dim-text">
          1
        </text>
      </g>
      {idle && (
        <>
          <text x={SIZE / 2} y={zone.y - 14} className="nd-label mid">
            centre lands in this cell
          </text>
          <text x={SIZE / 2} y={zone.y + zone.s + 26} className="nd-label mid reach">
            shading = chance to reach a line from there
          </text>
        </>
      )}

      {/* Idle: a sample needle to scale, and its reach. */}
      {idle && (
        <g className="nd-ghost">
          <line x1={px(0.5) - r * Math.cos(Math.PI / 6)} y1={px(0.5) + r * Math.sin(Math.PI / 6)} x2={px(0.5) + r * Math.cos(Math.PI / 6)} y2={px(0.5) - r * Math.sin(Math.PI / 6)} />
          <circle cx={px(0.5)} cy={px(0.5)} r={r} className="nd-ghost-ring" />
          <text x={px(0.5)} y={px(0.5) - r - 8} className="nd-label mid ghost">
            ℓ = {length.toFixed(2)}
          </text>
        </g>
      )}

      {previous.map((n, i) => (
        <Needle key={i} rec={n} length={length} floor={floor} spinMs={spinMs} animate={false} faded />
      ))}

      {current && (
        <g key={`cur-${roundKey}-${needles.length}`}>
          {/* The direction circle: its shaded rim is this needle's odds. */}
          {landed && (
            <g className="nd-compass">
              {bowTie(lose).map((a, i) => (
                <path key={`lw${i}`} d={wedgeD(px(current.centre.u), px(current.centre.v), r, a.start, a.end)} className="nd-wedge lose" />
              ))}
              {bowTie(win).map((a, i) => (
                <path key={`ww${i}`} d={wedgeD(px(current.centre.u), px(current.centre.v), r, a.start, a.end)} className="nd-wedge win" />
              ))}
              {bowTie(lose).map((a, i) => (
                <path key={`l${i}`} d={arcD(px(current.centre.u), px(current.centre.v), r, a.start, a.end)} className="nd-rim lose" style={{ strokeWidth: rimWidth }} />
              ))}
              {bowTie(win).map((a, i) => (
                <path key={`w${i}`} d={arcD(px(current.centre.u), px(current.centre.v), r, a.start, a.end)} className="nd-rim win" style={{ strokeWidth: rimWidth }} />
              ))}
            </g>
          )}
          {current.theta === null ? (
            <g className="nd-drop" style={{ animationDuration: `${dropMs}ms` }}>
              <circle cx={px(current.centre.u)} cy={px(current.centre.v)} r={5} className="nd-centre" />
            </g>
          ) : (
            <Needle rec={current} length={length} floor={floor} spinMs={spinMs} animate={spinning} />
          )}
          <circle cx={px(current.centre.u)} cy={px(current.centre.v)} r={4} className="nd-ripple" style={{ animationDelay: `${dropMs * 0.8}ms`, animationDuration: `${Math.max(250, dropMs)}ms` }} />
        </g>
      )}
      <title>{`Back ${sideWord}`}</title>
    </svg>
  );
}

// ---------- Direction dial ----------

const DW = 400;
const HX = 200;
const HY = 178;
const R = 156;
const BAND = 24;

export interface DialProps {
  side: Side;
  /** Shaded arcs: the current needle's (exact) or, before a centre lands, the average. */
  win: DirArc[];
  lose: DirArc[];
  /** True when the arcs are the cell average (idle / before the next centre lands). */
  average: boolean;
  /** The share of directions that win, as shown. */
  share: number;
  needle: NeedleRec | null;
  /** Which needle of which round it is (a new spin animates once per needle). */
  needleKey: string;
  spinMs: number;
  spinning: boolean;
  floor: Drop['floor'];
  waiting: boolean;
}

function Pointer({ spinDeg, spinMs, spinning, tone }: { spinDeg: number; spinMs: number; spinning: boolean; tone: string }) {
  const ref = useSpinIn(spinDeg, spinMs, spinning);
  return (
    <g ref={ref} className={'nd-pointer' + tone} style={{ transform: `rotate(${-spinDeg}deg)`, transformOrigin: `${HX}px ${HY}px`, transformBox: 'view-box' }}>
      <line x1={HX - R - 14} y1={HY} x2={HX + R + 14} y2={HY} />
    </g>
  );
}

export function Dial({ side, win, lose, average, share, needle, needleKey, spinMs, spinning, floor, waiting }: DialProps) {
  const sideText = side === 'cross' ? 'cross a line' : 'miss every line';
  const ticks = Array.from({ length: 13 }, (_, i) => (i * Math.PI) / 12);
  const formula = floor === 'lines' ? '2ℓ/π' : '(4ℓ − ℓ²)/π';
  const tone = needle?.win == null ? '' : needle.win ? ' win' : ' lose';

  return (
    <svg viewBox={`0 0 ${DW} 262`} className={'nd-dial' + (average ? ' average' : '')} role="img" aria-label={`${fmtChance(share)} of directions ${sideText}`}>
      <defs>
        <clipPath id="nd-dial-clip">
          <rect x={0} y={0} width={DW} height={HY + 1} />
        </clipPath>
      </defs>
      <path d={arcD(HX, HY, R, 0, Math.PI)} className="nd-dial-track" style={{ strokeWidth: BAND }} />
      {!waiting && (
        <g className="nd-dial-arcs">
          {lose.map((a, i) => (
            <path key={`lw${i}`} d={wedgeD(HX, HY, R - BAND / 2, a.start, a.end)} className="nd-wedge lose" />
          ))}
          {win.map((a, i) => (
            <path key={`ww${i}`} d={wedgeD(HX, HY, R - BAND / 2, a.start, a.end)} className="nd-wedge win" />
          ))}
          {lose.map((a, i) => (
            <path key={`l${i}`} d={arcD(HX, HY, R, a.start, a.end)} className="nd-dial-arc lose" style={{ strokeWidth: BAND }} />
          ))}
          {win.map((a, i) => (
            <path key={`w${i}`} d={arcD(HX, HY, R, a.start, a.end)} className="nd-dial-arc win" style={{ strokeWidth: BAND }} />
          ))}
        </g>
      )}
      {ticks.map((t, i) => {
        const p = at(HX, HY, R - BAND / 2 - 2, t);
        const q = at(HX, HY, R - BAND / 2 - (i % 3 === 0 ? 12 : 7), t);
        return <line key={i} x1={p.x} y1={p.y} x2={q.x} y2={q.y} className="nd-tick" />;
      })}
      <line x1={HX - R - BAND / 2} x2={HX + R + BAND / 2} y1={HY} y2={HY} className="nd-dial-base" />
      <text x={HX + R} y={HY + 18} className="nd-label mid">
        0°
      </text>
      <text x={HX - R} y={HY + 18} className="nd-label mid">
        180°
      </text>
      <text x={HX} y={HY - R + BAND / 2 + 28} className="nd-label mid">
        90°
      </text>

      {needle && needle.theta !== null && (
        <g clipPath="url(#nd-dial-clip)">
          <Pointer key={needleKey} spinDeg={needle.spinDeg} spinMs={spinMs} spinning={spinning} tone={tone} />
        </g>
      )}
      <circle cx={HX} cy={HY} r={7} className="nd-hub" />

      {waiting ? (
        <>
          <text x={HX} y={HY + 46} className="nd-big muted">
            …
          </text>
          <text x={HX} y={HY + 70} className="nd-label mid">
            the centre is landing
          </text>
        </>
      ) : (
        <>
          <text x={HX} y={HY + 48} className={'nd-big ' + (share > 0 ? 'win' : 'lose')}>
            {fmtChance(share)}
          </text>
          <text x={HX} y={HY + 72} className="nd-label mid">
            {average
              ? `of directions ${side === 'cross' ? 'cross' : 'miss'} on average · ${side === 'cross' ? formula : `1 − ${formula}`}`
              : `of directions ${sideText}`}
          </text>
        </>
      )}
    </svg>
  );
}

// ---------- Needle tally ----------

export function Tally({ needles, count, side }: { needles: NeedleRec[]; count: number; side: Side }) {
  return (
    <div className="nd-tally">
      <div className="nd-tally-row" aria-label="Needles">
        {Array.from({ length: count }, (_, i) => {
          const n = needles[i];
          const state = !n ? 'pending' : n.win === null ? 'current' : n.win ? 'won' : 'lost';
          return (
            <span key={i} className={'nd-pip ' + state} title={`Needle ${i + 1}: ${state}`}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <line x1={5} y1={19} x2={19} y2={5} />
              </svg>
              {state === 'won' ? '✓' : state === 'lost' ? '✕' : i + 1}
            </span>
          );
        })}
      </div>
      <div className="nd-legend">
        <span>
          <i className="win" /> directions that win ({side === 'cross' ? 'touch a line' : 'touch none'})
        </span>
        <span>
          <i className="lose" /> directions that lose
        </span>
      </div>
    </div>
  );
}
