import type { CSSProperties } from 'react';
import { DIGITS, benford, hasDigit, sectorStart, type DigitSet, type Landing } from './math';

const C = 250;
const HUB_R = 56;
/** "×f" labels for the next landings, then the landing dots themselves. */
const FACTOR_R = 70;
const LAND_R = 90;
const PIE_R = 10;
/** The sweep of the last multiplication. */
const SWEEP_R = 106;
/** The log scale: one sector per leading digit. */
const RING_IN = 113;
const RING_OUT = 150;
/** Live odds bars start outside the ring; length = chance × BAR_SCALE (the largest live chance, 5/8, reaches 72). */
const BAR0 = 166;
const BAR_SCALE = 116;
const BAR_MAX = 76;
const BAR_W = 15;
/**
 * Each percentage sits just past its bar (or its Benford tick, if that is further out),
 * far enough along the bar's direction that the label's box clears the tip.
 */
const pctGap = (turn: number, text: string) => {
  const a = turn * 2 * Math.PI;
  const halfW = text.length * 4.3;
  return 6 + Math.abs(Math.sin(a)) * halfW + Math.abs(Math.cos(a)) * 8;
};

const polar = (turn: number, r: number) => {
  const a = turn * 2 * Math.PI;
  return { x: C + r * Math.sin(a), y: C - r * Math.cos(a) };
};
const f2 = (n: number) => n.toFixed(2);

/** A ring sector from turn a to turn b between radii r0 and r1. */
function annulus(a: number, b: number, r0: number, r1: number) {
  const large = b - a > 0.5 ? 1 : 0;
  const p = polar(a, r1);
  const q = polar(b, r1);
  const s = polar(b, r0);
  const t = polar(a, r0);
  return `M ${f2(p.x)} ${f2(p.y)} A ${r1} ${r1} 0 ${large} 1 ${f2(q.x)} ${f2(q.y)} L ${f2(s.x)} ${f2(s.y)} A ${r0} ${r0} 0 ${large} 0 ${f2(t.x)} ${f2(t.y)} Z`;
}

/** An open arc clockwise from turn a, `len` turns long. */
function arc(a: number, len: number, r: number) {
  const l = Math.min(len, 0.9999);
  const p = polar(a, r);
  const q = polar(a + l, r);
  return `M ${f2(p.x)} ${f2(p.y)} A ${r} ${r} 0 ${l > 0.5 ? 1 : 0} 1 ${f2(q.x)} ${f2(q.y)}`;
}

/** A pie wedge of fraction p (clockwise from the top) in a small circle at (x, y). */
function wedge(x: number, y: number, r: number, p: number) {
  if (p <= 0) return '';
  if (p >= 1) return `M ${f2(x)} ${f2(y - r)} A ${r} ${r} 0 1 1 ${f2(x - 0.001)} ${f2(y - r)} Z`;
  const a = p * 2 * Math.PI;
  const ex = x + r * Math.sin(a);
  const ey = y - r * Math.cos(a);
  return `M ${f2(x)} ${f2(y)} L ${f2(x)} ${f2(y - r)} A ${r} ${r} 0 ${p > 0.5 ? 1 : 0} 1 ${f2(ex)} ${f2(ey)} Z`;
}

/** Slide-rule graduations: every 0.1 up to 4, every 0.5 above; integers are the sector lines. */
const GRADUATIONS: { v: number; len: number }[] = [];
for (let i = 11; i < 100; i++) {
  if (i % 10 === 0) continue;
  const v = i / 10;
  if (i % 5 === 0) GRADUATIONS.push({ v, len: 7 });
  else if (v < 4) GRADUATIONS.push({ v, len: 4 });
}

const fmtPct = (p: number) => (p <= 0 ? '0%' : p >= 1 ? '100%' : p < 0.1 ? `${(p * 100).toFixed(1)}%` : `${Math.round(p * 100)}%`);

export interface MoveArc {
  /** Where the cursor started (fraction of a turn). */
  from: number;
  /** How far it turns: log₁₀ of the factor. */
  turn: number;
  factor: number;
  /** Restarts the sweep animation for each multiplication. */
  key: number;
}

export interface DialProps {
  digits: DigitSet;
  /** Factors drawn so far. */
  chain: number[];
  /** The current product (1 before the first factor). */
  product: number;
  /** Factors still to come. */
  left: number;
  /** Turns the cursor has travelled (whole turns + log₁₀ product), for the animation. */
  spin: number;
  spinMs: number;
  spinning: boolean;
  /** Bar and dot transitions (shorter in turbo). */
  easeMs: number;
  /** Live chance of each final leading digit (index d), or null once the product is final. */
  odds: number[] | null;
  /** Where the next factor can land, or null when no factor is coming. */
  landings: Landing[] | null;
  /** The multiplication in flight or just made. */
  move: MoveArc | null;
  /** The finished round's verdict. */
  result: 'win' | 'lose' | null;
  /** Overrides the hub's last line (e.g. "out of reach"). */
  note?: string | null;
  /** Lets the player toggle digits by tapping their sectors (idle only). */
  onToggle?: (d: number) => void;
}

export default function Dial({ digits, chain, product, left, spin, spinMs, spinning, easeMs, odds, landings, move, result, note, onToggle }: DialProps) {
  const lead = Number(String(product)[0]);
  const binary = left === 1;
  const compact = chain.length > 3;
  const sep = compact ? '×' : ' × ';
  let chainText = 'start at 1';
  if (chain.length === 0 && spinning) chainText = '1 × ?';
  else if (chain.length === 1) chainText = spinning ? `${chain[0]} × ?` : `1 × ${chain[0]} =`;
  else if (chain.length > 1) chainText = chain.join(sep) + (spinning ? `${sep}?` : ' =');
  const productText = product.toLocaleString('en-US');
  const productSize = productText.length > 6 ? 25 : productText.length > 4 ? 30 : 36;
  const winOdds = odds ? DIGITS.reduce((a, d) => a + (hasDigit(digits, d) ? odds[d] : 0), 0) : 0;
  const lit = landings?.filter((l) => l.chance >= 1).length ?? 0;

  let sub = '';
  if (note) sub = note;
  else if (result) sub = `leads with ${lead}`;
  else if (spinning) sub = 'multiplying…';
  else if (binary && landings) sub = `${lit} of 8 win`;
  else if (left > 0) sub = `${left} factor${left > 1 ? 's' : ''} left`;

  return (
    <svg
      viewBox="0 0 500 500"
      className={'sr-dial' + (spinning ? ' spinning' : '') + (onToggle ? ' interactive' : '')}
      style={{ '--sr-ease': `${easeMs}ms` } as CSSProperties}
      role="img"
      aria-label={`Product ${productText}, leading digit ${lead}. Chance the final product leads with your digits: ${fmtPct(winOdds)}.`}
    >
      {/* Live odds: one bar per digit, its length the chance; Benford's limit marked across it. */}
      {odds && DIGITS.map((d) => {
        const mid = (sectorStart(d) + sectorStart(d + 1)) / 2;
        const p = odds[d];
        const len = Math.min(BAR_MAX, p * BAR_SCALE);
        const bLen = benford(d) * BAR_SCALE;
        const pct = fmtPct(p);
        const label = polar(mid, BAR0 + Math.max(len, bLen) + pctGap(mid, pct));
        const on = hasDigit(digits, d);
        return (
          <g key={d} className={'odds' + (on ? ' on' : '')}>
            <g transform={`rotate(${f2(mid * 360)} ${C} ${C})`}>
              <line x1={C} x2={C} y1={C - BAR0 + 2} y2={f2(C - BAR0 - bLen)} className="axis" />
              <rect
                x={C - BAR_W / 2}
                y={C - BAR0 - BAR_MAX}
                width={BAR_W}
                height={BAR_MAX}
                rx={3}
                className="bar"
                style={{ transform: `scaleY(${f2(len / BAR_MAX)})` }}
              />
              <line x1={C - BAR_W / 2 - 4} x2={C + BAR_W / 2 + 4} y1={f2(C - BAR0 - bLen)} y2={f2(C - BAR0 - bLen)} className="benford" />
            </g>
            <text className="pct" style={{ transform: `translate(${f2(label.x)}px, ${f2(label.y + 5)}px)` }}>
              {pct}
            </text>
          </g>
        );
      })}

      {/* The log scale: each digit owns log₁₀(d + 1) − log₁₀ d of the turn (Benford's law). */}
      {DIGITS.map((d) => {
        const a = sectorStart(d);
        const b = sectorStart(d + 1);
        const mid = polar((a + b) / 2, (RING_IN + RING_OUT) / 2 + 2);
        const on = hasDigit(digits, d);
        const here = !spinning && !result && chain.length > 0 && lead === d;
        const final = result && left === 0 && lead === d ? ` final ${result}` : '';
        return (
          <g
            key={d}
            className={'sector' + (on ? ' on' : '') + (here ? ' here' : '') + final}
            onClick={onToggle ? () => onToggle(d) : undefined}
          >
            <path d={annulus(a + 0.002, b - 0.002, RING_IN, RING_OUT)} />
            <text x={f2(mid.x)} y={f2(mid.y + 6)}>
              {d}
            </text>
          </g>
        );
      })}
      {GRADUATIONS.map(({ v, len }) => {
        const t = Math.log10(v);
        const p = polar(t, RING_IN);
        const q = polar(t, RING_IN + len);
        return <line key={v} x1={f2(p.x)} y1={f2(p.y)} x2={f2(q.x)} y2={f2(q.y)} className="grad" />;
      })}

      {/* The last multiplication, as the turn it made: log₁₀ f of the dial. */}
      {move && (
        <path
          key={move.key}
          d={arc(move.from, move.turn, SWEEP_R)}
          pathLength={1}
          className="sweep"
          style={{ animationDuration: `${spinMs}ms` }}
        />
      )}

      {/* Where the next factor can send the cursor: 8 dots, 1 in 8 each. The fill is your chance from there. */}
      {landings?.map((l) => {
        const p = polar(l.at, LAND_R);
        const t = polar(l.at, FACTOR_R);
        const tone = l.chance >= 1 ? ' win' : l.chance <= 0 ? ' dead' : '';
        return (
          <g key={`${product}-${l.factor}`} className={'land' + tone + (binary ? ' binary' : '')}>
            <circle cx={f2(p.x)} cy={f2(p.y)} r={PIE_R} className="disc" />
            <path d={wedge(p.x, p.y, PIE_R, l.chance)} className="fill" />
            <text x={f2(t.x)} y={f2(t.y + 3.5)}>×{l.factor}</text>
          </g>
        );
      })}

      {/* The cursor: total rotation is log₁₀ of the product, so multiplying is turning. */}
      <g className={'cursor' + (result ? ` ${result}` : '')} style={{ transform: `rotate(${(spin * 360).toFixed(3)}deg)`, transitionDuration: `${spinMs}ms` }}>
        <rect x={C - 9} y={C - RING_OUT - 5} width={18} height={RING_OUT - RING_IN + 13} rx={4} className="glass" />
        <line x1={C} y1={C - HUB_R} x2={C} y2={C - RING_OUT - 5} className="hair" />
        <path d={`M ${C} ${C - RING_OUT - 6} L ${C - 6} ${C - RING_OUT - 15} L ${C + 6} ${C - RING_OUT - 15} Z`} className="tip" />
      </g>

      <circle cx={C} cy={C} r={HUB_R} className={'hub' + (result ? ` ${result}` : '')} />
      <text x={C} y={C - 21} className="chain">
        {chainText}
      </text>
      <text x={C} y={C + 11} className={'product' + (spinning ? ' dim' : '') + (result ? ` ${result}` : '')} style={{ fontSize: productSize }}>
        {productText}
      </text>
      <text x={C} y={C + 32} className={'sub' + (result ? ` ${result}` : '')}>
        {sub}
      </text>
    </svg>
  );
}
