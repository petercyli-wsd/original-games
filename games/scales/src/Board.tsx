import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { WEIGHTS, finalLaw, wins, type Bead, type Bet, type Forecast } from './math';

// Geometry (viewBox units).
const W = 600;
const CX = 300;
/** The beam's pivot. */
const PY = 78;
/** Half the beam. */
const HL = 155;
/** Strings from the beam end down to the pan. */
const SL = 104;
const PAN_W = 112;
const TOWER_W = 40;
const TOWER_MAX = 80;
const MAX_TILT = 14;

// The strip of the final difference.
const STRIP_L = 18;
const STRIP_R = W - 18;

/** Below this rendered width the board switches to the compact (phone) layout. */
const COMPACT_BELOW = 560;

export interface Falling {
  id: number;
  bead: Bead;
  ms: number;
}

export interface BoardProps {
  n: number;
  beads: Bead[];
  bet: Bet;
  /** The bead in the air (not yet counted in `beads`). */
  falling: Falling | null;
  /** What each next bead would do to the chance (null hides the forecast). */
  forecast: Forecast | null;
  chance: number;
  /** Axis half-width of the strip, in weight units. */
  range: number;
  /** Transition time for the tilt. */
  tiltMs: number;
}

/** Tilt in degrees; positive = left pan down. The tilt is the lead. */
export const tiltOf = (D: number) => Math.max(-MAX_TILT, Math.min(MAX_TILT, D * 0.7));

function hookOf(side: 'L' | 'R', deg: number) {
  const a = (deg * Math.PI) / 180;
  const sx = side === 'L' ? -1 : 1;
  return { x: CX + sx * HL * Math.cos(a), y: PY - sx * HL * Math.sin(a) };
}

/** A short label for a chance inside a forecast cell. */
function cell(p: number): string {
  if (p >= 1) return 'win';
  if (p <= 0) return 'lose';
  if (p >= 0.995) return '>99%';
  if (p < 0.005) return '<0.5%';
  return (p * 100).toFixed(1) + '%';
}

/** Whether the board is rendered narrow (phones), measured from its container. */
function useCompact() {
  const ref = useRef<SVGSVGElement>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const host = ref.current?.parentElement;
    if (!host || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setCompact(e.contentRect.width < COMPACT_BELOW));
    ro.observe(host);
    return () => ro.disconnect();
  }, []);
  return [ref, compact] as const;
}

export default function Field({ n, beads, bet, falling, forecast, chance, range, tiltMs }: BoardProps) {
  const [ref, compact] = useCompact();
  const totL = beads.reduce((t, b) => t + (b.side === 'L' ? b.w : 0), 0);
  const totR = beads.reduce((t, b) => t + (b.side === 'R' ? b.w : 0), 0);
  const D = totL - totR;
  const left = n - beads.length;
  const deg = tiltOf(D);
  const unit = Math.min(6, TOWER_MAX / Math.max(totL, totR, 1));

  const hooks = { L: hookOf('L', deg), R: hookOf('R', deg) };
  const ease = { transitionDuration: `${tiltMs}ms` };

  // Vertical layout: the compact layout stacks the forecast in two full-width rows.
  const FC_Y = 262;
  const oy = compact ? 64 : 0;
  const BAR_TOP = 350 + oy;
  const BAR_BASE = 410 + oy;
  const H = 440 + oy;

  // ----- the strip: the law of the final difference -----
  const pts = finalLaw(D, left);
  const R = range;
  const bw = (STRIP_R - STRIP_L) / (2 * R + 1);
  // Left heavier sits on the left, under the left pan.
  const xOf = (d: number) => CX - d * bw;
  const shown = pts.filter((x) => Math.abs(x.d) <= R);
  const pmax = Math.max(...shown.map((x) => x.p), 1e-12);
  const tailL = pts.filter((x) => x.d > R).reduce((a, x) => a + x.p, 0);
  const tailR = pts.filter((x) => x.d < -R).reduce((a, x) => a + x.p, 0);

  // The winning region as an interval [lo, hi] of final differences.
  const [lo, hi] = bet.kind === 'L' ? [1, R] : bet.kind === 'R' ? [-R, -1] : bet.kind === 'B' ? [-1, 1] : [Math.min(bet.k, R + 1), R];
  const bandX = xOf(hi) - bw / 2;
  const bandW = Math.max(0, xOf(lo) + bw / 2 - bandX);

  // ----- the bead in flight -----
  let fallStyle: CSSProperties | undefined;
  if (falling) {
    const h = falling.bead.w * unit;
    const hook = hooks[falling.bead.side];
    const top = hook.y + SL - (falling.bead.side === 'L' ? totL : totR) * unit - h;
    fallStyle = {
      ['--dx' as string]: `${hook.x - CX}px`,
      ['--dy' as string]: `${top - 10}px`,
      animationDuration: `${falling.ms}ms`,
    };
  }

  const tower = (side: 'L' | 'R') => {
    let y = SL;
    return beads
      .map((b, i) => ({ b, i }))
      .filter(({ b }) => b.side === side)
      .map(({ b, i }) => {
        const h = b.w * unit;
        y -= h;
        const last = i === beads.length - 1;
        return (
          <g key={i} className={'bead' + (last ? ' last' : '')}>
            <rect x={-TOWER_W / 2} y={y} width={TOWER_W} height={Math.max(1, h - 1)} rx={2} />
            {h >= 11 && (
              <text x={0} y={y + h / 2 + 4} className="bead-w">
                {b.w}
              </text>
            )}
          </g>
        );
      });
  };

  const pan = (side: 'L' | 'R') => {
    const hook = hooks[side];
    const tot = side === 'L' ? totL : totR;
    return (
      <g className={`pan ${side.toLowerCase()}`} style={{ transform: `translate(${hook.x}px, ${hook.y}px)`, ...ease }}>
        <line x1={0} y1={0} x2={-PAN_W / 2 + 6} y2={SL} className="string" />
        <line x1={0} y1={0} x2={PAN_W / 2 - 6} y2={SL} className="string" />
        {tower(side)}
        <path d={`M ${-PAN_W / 2} ${SL} L ${PAN_W / 2} ${SL} L ${PAN_W / 2 - 12} ${SL + 9} L ${-PAN_W / 2 + 12} ${SL + 9} Z`} className="tray" />
        <circle cx={0} cy={0} r={4} className="hook" />
        <text x={0} y={SL + 32} className="tot">
          {side === 'L' ? 'L' : 'R'} {tot}
        </text>
      </g>
    );
  };

  /** One forecast cell: the chance after a bead of weight w lands on `side`. */
  const fcCell = (side: 'L' | 'R', i: number, v: number, x: number, y: number, cw: number, ch: number, span: number) => {
    const dlt = v - chance;
    const tone = Math.abs(dlt) < 1e-9 ? 'flat' : dlt > 0 ? 'up' : 'down';
    const alpha = 0.12 + 0.5 * Math.min(1, Math.abs(dlt) / span);
    const isHit = !!falling && falling.bead.side === side && falling.bead.w === WEIGHTS[i];
    return (
      <g key={side + i} transform={`translate(${x}, ${y})`} className={falling ? (isHit ? 'hit' : 'miss') : undefined}>
        <rect width={cw} height={ch} rx={5} className={`fc-cell ${tone}`} style={{ fillOpacity: tone === 'flat' ? 1 : alpha }} />
        <text x={cw / 2} y={ch * 0.36} className="fc-w">
          {side === 'L' ? 'L+' : 'R+'}
          {WEIGHTS[i]}
        </text>
        <text x={cw / 2} y={ch * 0.8} className={`fc-p ${tone}`}>
          {cell(v)}
        </text>
      </g>
    );
  };

  const forecastView = () => {
    if (!forecast) return null;
    const span = Math.max(...[...forecast.L, ...forecast.R].map((v) => Math.abs(v - chance)), 1e-9);
    if (compact) {
      const cw = (W - 36 - 5 * 6) / 6;
      return (
        <g className="fc">
          <text x={CX} y={FC_Y + 4} className="fc-head">
            your chance after the next bead · each 1 in 12
          </text>
          {(['L', 'R'] as const).map((side, r) =>
            (side === 'L' ? forecast.L : forecast.R).map((v, i) => fcCell(side, i, v, 18 + i * (cw + 6), FC_Y + 14 + r * 52, cw, 46, span)),
          )}
        </g>
      );
    }
    const cw = 40;
    const gap = 4;
    return (
      <g className="fc">
        {(['L', 'R'] as const).map((side) => {
          const cx = side === 'L' ? 145 : 455;
          const x0 = cx - (6 * cw + 5 * gap) / 2;
          return (
            <g key={side}>
              <text x={cx} y={FC_Y + 8} className="fc-head">
                next bead {side === 'L' ? 'left' : 'right'} → your chance
              </text>
              {(side === 'L' ? forecast.L : forecast.R).map((v, i) => fcCell(side, i, v, x0 + i * (cw + gap), FC_Y + 16, cw, 38, span))}
            </g>
          );
        })}
        <text x={CX} y={FC_Y + 32} className="fc-mid">
          each
        </text>
        <text x={CX} y={FC_Y + 46} className="fc-mid">
          1 in 12
        </text>
      </g>
    );
  };

  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${W} ${H}`}
      className={'scales' + (compact ? ' compact' : '')}
      role="img"
      aria-label={`Left ${totL}, right ${totR}; your chance ${(chance * 100).toFixed(1)}%`}
    >
      {/* Hopper */}
      <path d={`M ${CX - 22} 4 L ${CX + 22} 4 L ${CX + 7} 22 L ${CX - 7} 22 Z`} className="hopper" />

      {/* Fulcrum and beam */}
      <path d={`M ${CX} ${PY} L ${CX + 24} ${PY + 44} L ${CX - 24} ${PY + 44} Z`} className="fulcrum" />
      <line x1={CX - 46} y1={PY + 44} x2={CX + 46} y2={PY + 44} className="base" />
      <g className="beam" style={{ transform: `rotate(${-deg}deg)`, ...ease }}>
        <rect x={CX - HL - 4} y={PY - 4} width={2 * HL + 8} height={8} rx={4} />
        <line x1={CX} y1={PY - 18} x2={CX} y2={PY} className="needle" />
      </g>
      <circle cx={CX} cy={PY} r={6} className="pivot" />

      {pan('L')}
      {pan('R')}

      {falling && (
        <g key={falling.id} className={`falling ${falling.bead.side.toLowerCase()}`} style={fallStyle}>
          <rect x={CX - TOWER_W / 2} y={10} width={TOWER_W} height={Math.max(4, falling.bead.w * unit - 1)} rx={2} />
        </g>
      )}

      {/* The lead */}
      <text x={CX} y={PY + 82} className={'lead ' + (D > 0 ? 'l' : D < 0 ? 'r' : '')}>
        {D === 0 ? '0' : `+${Math.abs(D)}`}
      </text>
      <text x={CX} y={PY + 102} className="lead-sub">
        {D > 0 ? 'left leads' : D < 0 ? 'right leads' : 'level'}
      </text>
      <text x={CX} y={PY + 120} className="lead-sub dim">
        {left === 0 ? 'final' : left === n ? `${n} beads to drop` : `${left} to drop`}
      </text>

      {/* What each next bead would do */}
      {forecastView()}

      {/* The final difference: winning mass shaded */}
      <text x={STRIP_L} y={BAR_TOP - 12} className="strip-title">
        {left === 0 ? 'Final difference' : 'Where the difference ends'}
      </text>
      <text x={STRIP_R} y={BAR_TOP - 12} className="strip-odds">
        shaded = your chance {(chance * 100).toFixed(chance < 0.1 && chance > 0 ? 2 : 1)}%
      </text>
      <rect x={STRIP_L} y={BAR_TOP - 4} width={STRIP_R - STRIP_L} height={BAR_BASE - BAR_TOP + 4} rx={4} className="strip-bg" />
      {bandW > 0 && <rect x={bandX} y={BAR_TOP - 4} width={bandW} height={BAR_BASE - BAR_TOP + 4} className="band" />}
      {shown.map(({ d, p }) => {
        const h = Math.max(1, (p / pmax) * (BAR_BASE - BAR_TOP - 4));
        return <rect key={d} x={xOf(d) - bw * 0.42} y={BAR_BASE - h} width={bw * 0.84} height={h} className={'bar' + (wins(bet, d) ? ' win' : '')} />;
      })}
      <line x1={xOf(0)} y1={BAR_TOP - 4} x2={xOf(0)} y2={BAR_BASE} className="zero" />
      {bet.kind === 'K' && bet.k <= R && <line x1={xOf(bet.k) + bw / 2} y1={BAR_TOP - 4} x2={xOf(bet.k) + bw / 2} y2={BAR_BASE} className="kline" />}
      {tailL > 5e-4 && (
        <text x={STRIP_L + 4} y={BAR_TOP + 10} className="tail s">
          ‹ {(tailL * 100).toFixed(1)}%
        </text>
      )}
      {tailR > 5e-4 && (
        <text x={STRIP_R - 4} y={BAR_TOP + 10} className="tail e">
          {(tailR * 100).toFixed(1)}% ›
        </text>
      )}
      {/* Where it stands now */}
      <g className="now" style={{ transform: `translateX(${xOf(Math.max(-R, Math.min(R, D)))}px)`, ...ease }}>
        <path d={`M 0 ${BAR_BASE + 2} L 6 ${BAR_BASE + 11} L -6 ${BAR_BASE + 11} Z`} />
      </g>
      <text x={STRIP_L} y={BAR_BASE + 25} className="axis l">
        ← left by {R}
      </text>
      <text x={xOf(0)} y={BAR_BASE + 25} className="axis">
        level
      </text>
      {bet.kind === 'K' && bet.k <= R && bet.k / R > 0.25 && bet.k / R < 0.75 && (
        <text x={xOf(bet.k)} y={BAR_BASE + 25} className="axis k">
          k = {bet.k}
        </text>
      )}
      <text x={STRIP_R} y={BAR_BASE + 25} className="axis r">
        right by {R} →
      </text>
    </svg>
  );
}
