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
  const current = needles[needles.length - 1];
  const previous = needles.slice(0, -1);
  const r = h * S;
  const rimWidth = Math.max(3, Math.min(9, r * 0.2));

  const zone = { x: px(0), y: px(0), s: S };
  const sideWord = side === 'cross' ? 'cross' : 'miss';

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className={'nd-floor ' + floor} role="img" aria-label={`Floor of ${floor}, needle length ${length.toFixed(2)}`}>
      <defs>
        <clipPath id="nd-clip">
          <rect x={0} y={0} width={SIZE} height={SIZE} rx={8} />
        </clipPath>
      </defs>

      <g clipPath="url(#nd-clip)">
        <rect x={0} y={0} width={SIZE} height={SIZE} className="nd-floor-bg" />
        {/* The cell the centre lands in, uniformly. */}
        <rect x={zone.x} y={zone.y} width={zone.s} height={zone.s} className="nd-zone" />

        {/* Reach bands: only a centre this close to a line can touch it. */}
        <g className={'nd-reach ' + side}>
          <rect x={zone.x} y={zone.y} width={zone.s} height={r} />
          <rect x={zone.x} y={zone.y + zone.s - r} width={zone.s} height={r} />
          {floor === 'grid' && (
            <>
              <rect x={zone.x} y={zone.y} width={r} height={zone.s} />
              <rect x={zone.x + zone.s - r} y={zone.y} width={r} height={zone.s} />
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

export function Dial({ side, win, lose, average, share, needle, needleKey, spinMs, spinning, waiting }: DialProps) {
  const sideText = side === 'cross' ? 'cross a line' : 'miss every line';
  const tone = needle?.win == null ? '' : needle.win ? ' win' : ' lose';

  return (
    <svg viewBox={`0 0 ${DW} 206`} className={'nd-dial' + (average ? ' average' : '')} role="img" aria-label={`${fmtChance(share)} of directions ${sideText}`}>
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
      <line x1={HX - R - BAND / 2} x2={HX + R + BAND / 2} y1={HY} y2={HY} className="nd-dial-base" />
      <text x={HX + R} y={HY + 18} className="nd-label mid">
        0°
      </text>
      <text x={HX - R} y={HY + 18} className="nd-label mid">
        180°
      </text>

      {needle && needle.theta !== null && (
        <g clipPath="url(#nd-dial-clip)">
          <Pointer key={needleKey} spinDeg={needle.spinDeg} spinMs={spinMs} spinning={spinning} tone={tone} />
        </g>
      )}
      <circle cx={HX} cy={HY} r={7} className="nd-hub" />
    </svg>
  );
}

// ---------- Needle tally ----------

export function Tally({ needles, count }: { needles: NeedleRec[]; count: number }) {
  return (
    <div className="nd-tally">
      <div className="nd-tally-row" aria-label="Needles">
        {Array.from({ length: count }, (_, i) => {
          const n = needles[i];
          const state = !n ? 'pending' : n.win === null ? 'current' : n.win ? 'won' : 'lost';
          return (
            <span key={i} className={'nd-pip ' + state} title={`Needle ${i + 1}: ${state}`}>
              {i + 1}
            </span>
          );
        })}
      </div>
    </div>
  );
}
