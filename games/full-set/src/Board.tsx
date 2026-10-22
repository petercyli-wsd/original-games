import type { CSSProperties } from 'react';
import { fmtChance } from '@originals/game-sdk/ui';
import { darkCount, endShares, litOf, segmentArc, sparesOf, type Draw } from './math';

export type Phase = 'idle' | 'drawing' | 'checkpoint' | 'over';
export type Outcome = 'full' | 'cashed' | 'short';

export const VIEW = { w: 400, h: 462 };
const C = { x: 200, y: 174 };
const R_OUT = 152;
const R_IN = 110;
const R_MID = (R_OUT + R_IN) / 2;
/** The budget ring of draw cells, inside the segment ring. */
const B_OUT = 100;
const B_IN = 89;
const LEGEND_Y = 372;
const STRIP = { x: 16, y: 410, w: 368, h: 24 };

const polar = (turn: number, r: number) => {
  const a = turn * 2 * Math.PI;
  return { x: C.x + r * Math.sin(a), y: C.y - r * Math.cos(a) };
};
const pt = (p: { x: number; y: number }) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`;

/** An annular sector from turn a to turn b, inset by a constant gap (in px) on both sides. */
function sector(a: number, b: number, rOut: number, rIn: number, gap: number) {
  const go = gap / (2 * Math.PI * rOut);
  const gi = gap / (2 * Math.PI * rIn);
  const large = b - a - 2 * go > 0.5 ? 1 : 0;
  return [
    `M ${pt(polar(a + go, rOut))}`,
    `A ${rOut} ${rOut} 0 ${large} 1 ${pt(polar(b - go, rOut))}`,
    `L ${pt(polar(b - gi, rIn))}`,
    `A ${rIn} ${rIn} 0 ${large} 0 ${pt(polar(a + gi, rIn))}`,
    'Z',
  ].join(' ');
}

export interface BoardProps {
  k: number;
  D: number;
  /** The draws that have landed on the board. */
  draws: readonly Draw[];
  phase: Phase;
  outcome: Outcome | null;
  /** Turns the pointer has travelled, and how long one hop takes. */
  spin: number;
  travelMs: number;
  /** Changes every round, so per-round animations restart. */
  roundId: number;
  /** Small frames get larger type. */
  narrow?: boolean;
  svgRef?: (el: SVGSVGElement | null) => void;
}

const SHORT_TONES = ['win', 'short1', 'short2', 'short3'];
const sliceName = (j: number) => (j === 0 ? 'full set' : j === 3 ? '3+ short' : `${j} short`);
const draws_ = (n: number) => `${n} draw${n === 1 ? '' : 's'}`;

export default function Board({ k, D, draws, phase, outcome, spin, travelMs, roundId, narrow, svgRef }: BoardProps) {
  const lit = litOf(k, draws);
  const m = darkCount(lit);
  const used = draws.length;
  const d = D - used;
  const spares = Math.max(0, sparesOf(m, d));
  const live = phase === 'drawing' || phase === 'checkpoint';
  const idle = phase === 'idle';
  const hits = new Array<number>(k).fill(0);
  for (const dr of draws) hits[dr.seg]++;
  const last = draws.length ? draws[draws.length - 1] : null;
  // With no spare, a lit segment is exactly where the next draw ends the round.
  const noSpare = live && spares === 0 && m > 0 && m < k;
  const aiming = phase === 'drawing' ? used : -1;

  // How the round ends from here: the full set, or stopped 1, 2, 3+ segments short.
  const raw = outcome === 'full' ? endShares(k, 0, d) : endShares(k, m, d);
  const shares = [raw[0], raw[1], raw[2], raw.slice(3).reduce((a, b) => a + b, 0)];
  let x0 = STRIP.x;
  const slices = shares
    .map((p, j) => {
      const s = { j, p, x: x0, w: p * STRIP.w };
      x0 += s.w;
      return s;
    })
    .filter((s) => s.p > 1e-9);
  const lastSlice = slices[slices.length - 1]?.j;

  // The budget ring: used draws, then one cell per dark segment, then the spares.
  const cellGap = D > 40 ? 1.1 : D > 20 ? 1.6 : 2.2;
  const cellClass = (i: number) => {
    if (i < used) return draws[i].fresh ? 'cell used fresh' : 'cell used repeat';
    const aim = i === aiming ? ' aim' : '';
    if (outcome === 'short' || outcome === 'cashed') return 'cell unused';
    if (i < used + m) return 'cell need' + aim;
    return 'cell spare' + aim;
  };

  let cap = 'next draw new';
  let big = fmtChance(m / k);
  let bigClass = 'big new';
  let sub = `${m} of ${k} segments dark`;
  if (idle) {
    cap = 'draw budget';
    big = String(D);
    bigClass = 'big';
    sub = `draws for ${k} segments`;
  } else if (outcome === 'full') {
    cap = 'full set';
    big = `${k}/${k}`;
    bigClass = 'big won';
    sub = `lit in ${draws_(used)}`;
  } else if (outcome === 'short') {
    cap = d === 0 ? 'out of draws' : 'out of reach';
    big = `${k - m}/${k}`;
    bigClass = 'big lost';
    sub = d === 0 ? `lit · ${m} dark, no draws left` : `lit · ${m} dark, only ${draws_(d)} left`;
  } else if (outcome === 'cashed') {
    cap = 'cashed out';
    big = `${k - m}/${k}`;
    bigClass = 'big cashed';
    sub = `lit · ${draws_(d)} left`;
  }

  let stripCap = 'HOW THE ROUND ENDS';
  if (outcome === 'cashed') stripCap = 'IF YOU HAD PLAYED ON';
  if (outcome === 'full' || outcome === 'short') stripCap = 'HOW IT ENDED';

  // Legend: the two shares of the ring, which are the next draw's two outcomes.
  const newShare = m / k;
  const legendLit = noSpare ? 'ends the round' : 'repeat';

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${VIEW.w} ${VIEW.h}`}
      className={'fset' + (outcome ? ` over ${outcome}` : '') + (noSpare ? ' no-spare' : '') + (narrow ? ' narrow' : '')}
      role="img"
      aria-label={`${k - m} of ${k} segments lit, ${d} draws left`}
    >
      {/* The ring: lit segments glow, dark ones wait. The dark share is the chance of a new segment. */}
      {lit.map((on, i) => {
        const { start, length } = segmentArc(i, k);
        return <path key={`s${k}-${i}`} d={sector(start, start + length, R_OUT, R_IN, 2.5)} className={'seg ' + (on ? 'lit' : 'dark')} />;
      })}
      {lit.map((on, i) => {
        if (!on || hits[i] < 2) return null;
        const { start, length } = segmentArc(i, k);
        const p = polar(start + length / 2, R_MID);
        return (
          <text key={`h${i}`} x={p.x} y={p.y + 4.5} className="hits">
            ×{hits[i]}
          </text>
        );
      })}

      {/* The newest landing flashes its segment. */}
      {last && (
        <path
          key={`f${roundId}-${used}`}
          d={sector(segmentArc(last.seg, k).start, segmentArc(last.seg, k).start + 1 / k, R_OUT, R_IN, 2.5)}
          className={'flash ' + (last.fresh ? 'fresh' : 'repeat')}
        />
      )}

      {/* Every landing point so far, on the rim: uniform points on a circle. */}
      {draws.map((dr, i) => {
        const p = polar(dr.pos, R_OUT + 7);
        return <circle key={`p${roundId}-${i}`} cx={p.x} cy={p.y} r={i === used - 1 ? 3.4 : 2.3} className={'land ' + (dr.fresh ? 'fresh' : 'repeat')} />;
      })}

      {/* The budget ring: one cell per draw, clockwise from the top. */}
      {Array.from({ length: D }, (_, i) => (
        <path key={`c${D}-${i}`} d={sector(i / D, (i + 1) / D, B_OUT, B_IN, cellGap)} className={cellClass(i)} />
      ))}

      {/* The pointer travels round the ring to where each draw lands. */}
      {!idle && (
        <g className="pointer" style={{ transform: `rotate(${spin * 360}deg)`, transitionDuration: `${travelMs}ms` } as CSSProperties}>
          <line x1={C.x} y1={C.y - R_IN + 3} x2={C.x} y2={C.y - R_OUT - 3} />
          <path d={`M ${C.x - 8} ${C.y - R_OUT - 20} L ${C.x + 8} ${C.y - R_OUT - 20} L ${C.x} ${C.y - R_OUT - 7} Z`} />
        </g>
      )}

      {/* Centre readout. */}
      <text x={C.x} y={C.y - 34} className="cap">
        {cap.toUpperCase()}
      </text>
      <text x={C.x} y={C.y + 8} className={bigClass}>
        {big}
      </text>
      <text x={C.x} y={C.y + 29} className="sub">
        {sub}
      </text>
      {(idle || live) && (
        <text x={C.x} y={C.y + 52} className="budget-note">
          {noSpare ? (
            <tspan className="warn">no spare draws</tspan>
          ) : (
            <>
              <tspan className="need-t">{idle ? `${k} to light` : `${draws_(d)} left`}</tspan>
              <tspan className="spare-t"> · {idle ? D - k : spares} spare</tspan>
            </>
          )}
        </text>
      )}

      {/* Legend: what the next draw does, as the two shares of the ring. */}
      {!outcome && (
        <g className="legend">
          <text x={C.x - 12} y={LEGEND_Y} className="key-t left">
            <tspan className="new">dark</tspan> = new <tspan className="new">{fmtChance(newShare)}</tspan>
          </text>
          <circle cx={C.x} cy={LEGEND_Y - 4} r={2} className="key-dot" />
          <text x={C.x + 12} y={LEGEND_Y} className="key-t right">
            <tspan className={noSpare ? 'bust' : 'litc'}>lit</tspan> = {legendLit}{' '}
            <tspan className={noSpare ? 'bust' : 'litc'}>{fmtChance(1 - newShare)}</tspan>
          </text>
        </g>
      )}

      {/* How the round ends if you play on: the green share is the win chance. */}
      <g className="strip">
        <text x={STRIP.x} y={STRIP.y - 9} className="strip-cap">
          {stripCap}
        </text>
        <text x={STRIP.x + STRIP.w} y={STRIP.y - 9} className="strip-win">
          full set {fmtChance(shares[0])}
        </text>
        <rect x={STRIP.x} y={STRIP.y} width={STRIP.w} height={STRIP.h} rx={6} className="strip-bg" />
        {slices.map((s) => {
          const w = Math.max(0, s.w - (s.j === lastSlice ? 0 : 1.5));
          return (
            <rect
              key={s.j}
              x={s.x}
              y={STRIP.y}
              width={w}
              height={STRIP.h}
              className={'slice ' + SHORT_TONES[s.j]}
              style={{ x: s.x, width: w } as CSSProperties}
            />
          );
        })}
        {slices.map((s) =>
          s.w >= 44 ? (
            <text key={`t${s.j}`} x={s.x + s.w / 2} y={STRIP.y + 16.5} className={'slice-pct' + (s.j === 0 ? ' on-win' : '')}>
              {fmtChance(s.p)}
            </text>
          ) : null,
        )}
        {slices.map((s) =>
          s.w >= 56 ? (
            <text key={`n${s.j}`} x={s.x + s.w / 2} y={STRIP.y + STRIP.h + 17} className={'slice-name' + (s.j === 0 ? ' win' : '')}>
              {sliceName(s.j)}
            </text>
          ) : null,
        )}
      </g>
    </svg>
  );
}
