import type { CSSProperties, KeyboardEvent } from 'react';
import { fmtChance } from '@originals/game-sdk/ui';
import { bag, finishGroups, isOpen, tally, type BetDef, type Draw, type FinishGroup, type Placed } from './math';

export type Phase = 'idle' | 'drawing' | 'checkpoint' | 'over';
export type Outcome = 'won' | 'lost' | 'cashed';

/** Two layouts: wide (wheel left, finish strip right) and narrow (strip under the wheel). */
export const VIEWS = {
  wide: { w: 880, h: 560, cx: 280, cy: 280 },
  narrow: { w: 600, h: 690, cx: 300, cy: 268 },
} as const;
export type LayoutName = keyof typeof VIEWS;

const RING = 200;
const BAG_IN = 58;
const BAG_OUT = 116;
const socketR = (n: number) => (n <= 5 ? 46 : n <= 8 ? 40 : 31);

/** Slot (and token) i's colour: n hues evenly round the colour wheel. */
export const slotColour = (i: number, n: number) => `oklch(0.8 0.135 ${(352 + (i * 360) / n) % 360})`;

const rad = (deg: number) => (deg * Math.PI) / 180;
const vars = (v: Record<string, string | number>) => v as CSSProperties;

export interface Anim {
  draw: Draw;
  stage: 'spin' | 'fly';
}

export interface Landed {
  draw: Draw;
  /** The board just before this draw. */
  before: Placed;
  seq: number;
}

export interface BoardProps {
  layout: LayoutName;
  n: number;
  /** Committed tokens: placed[slot] = token or null. */
  placed: Placed;
  bet: BetDef;
  phase: Phase;
  /** The slot the next draw goes into (hovered, or the next one clockwise). */
  target: number | null;
  anim: Anim | null;
  /** The bag pointer's rotation in degrees (cumulative, so it always spins forwards). */
  pointer: number;
  spinMs: number;
  flyMs: number;
  /** The draw that landed last, for its pop and the "can't match now" link. */
  landed: Landed | null;
  pickable: boolean;
  onPick(slot: number): void;
  onHover(slot: number | null): void;
  svgRef?: (el: SVGSVGElement | null) => void;
}

/** Spreads labels so they keep `gap` apart inside [lo, hi], staying as close as possible to where they want to be. */
function spread(want: number[], gap: number, lo: number, hi: number): number[] {
  const out = want.map((v) => Math.min(hi, Math.max(lo, v)));
  for (let i = 1; i < out.length; i++) out[i] = Math.max(out[i], out[i - 1] + gap);
  if (out.length && out[out.length - 1] > hi) {
    out[out.length - 1] = hi;
    for (let i = out.length - 2; i >= 0; i--) out[i] = Math.min(out[i], out[i + 1] - gap);
  }
  return out;
}

const matchWord = (label: string) => (label === '1' ? 'match' : 'matches');

export default function Board(props: BoardProps) {
  const { layout, n, placed, bet, phase, target, anim, pointer, spinMs, flyMs, landed, pickable, onPick, onHover, svgRef } = props;
  const V = VIEWS[layout];
  const { cx, cy } = V;
  const narrow = layout === 'narrow';
  const sr = socketR(n);
  const t = tally(placed);
  const tokens = bag(placed);
  const groups = finishGroups(bet, t);
  const winShare = groups.filter((g) => g.win).reduce((s, g) => s + g.p, 0);

  const at = (deg: number, r: number) => ({ x: cx + r * Math.sin(rad(deg)), y: cy - r * Math.cos(rad(deg)) });
  const slotAt = (i: number) => at((i * 360) / n, RING);

  // The bag: r equal sectors, one per token, in colour-wheel order. Each is one chance in r.
  const step = 360 / Math.max(1, tokens.length);
  const sectorPath = (k: number, lift = 0) => {
    const a0 = (k - 0.5) * step;
    const a1 = (k + 0.5) * step;
    const o = (deg: number, r: number) => {
      const mid = (k * step * Math.PI) / 180;
      const p = at(deg, r);
      return { x: p.x + lift * Math.sin(mid), y: p.y - lift * Math.cos(mid) };
    };
    const large = a1 - a0 > 180 ? 1 : 0;
    const p0 = o(a0, BAG_OUT);
    const p1 = o(a1, BAG_OUT);
    const p2 = o(a1, BAG_IN);
    const p3 = o(a0, BAG_IN);
    const f = (v: number) => v.toFixed(2);
    return `M ${f(p0.x)} ${f(p0.y)} A ${BAG_OUT} ${BAG_OUT} 0 ${large} 1 ${f(p1.x)} ${f(p1.y)} L ${f(p2.x)} ${f(p2.y)} A ${BAG_IN} ${BAG_IN} 0 ${large} 0 ${f(p3.x)} ${f(p3.y)} Z`;
  };

  const flying = anim?.stage === 'fly' ? anim.draw : null;
  const drawingSector = anim ? anim.draw.sector : -1;
  const targetEmpty = target !== null && placed[target] === null;
  const targetOpen = targetEmpty && isOpen(placed, target!);
  // The bag sector that would match the target slot: its own token, if still in the bag.
  const matchSector = targetOpen ? tokens.indexOf(target!) : -1;

  // The token that just landed can make its own slot unable to match: draw that link briefly.
  const link =
    landed && landed.draw.token !== landed.draw.slot && landed.before[landed.draw.token] === null && placed[landed.draw.token] === null
      ? { from: slotAt(landed.draw.slot), to: slotAt(landed.draw.token) }
      : null;

  const arcPath = (frac: number, r: number) => {
    const f = Math.min(frac, 0.9999);
    const a = (f * 2 * Math.PI) as number;
    return `M 0 ${-r} A ${r} ${r} 0 ${f > 0.5 ? 1 : 0} 1 ${(r * Math.sin(a)).toFixed(2)} ${(-r * Math.cos(a)).toFixed(2)}`;
  };

  const key = (slot: number) => (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onPick(slot);
    }
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${V.w} ${V.h}`}
      className={`mm ${layout} ${phase}`}
      role="img"
      aria-label={`${t.m} matches so far; ${t.r} tokens left, ${t.a} slots can still match; ${fmtChance(winShare)} to win`}
      style={vars({ '--spin': `${spinMs}ms`, '--fly': `${flyMs}ms` })}
    >
      {/* The ring the slots sit on. */}
      <circle cx={cx} cy={cy} r={RING} className="track" />

      {link && (
        <line key={`link-${landed!.seq}`} x1={link.from.x} y1={link.from.y} x2={link.to.x} y2={link.to.y} className="link" />
      )}

      {/* Slots. */}
      {placed.map((tok, i) => {
        const p = slotAt(i);
        const col = slotColour(i, n);
        const empty = tok === null;
        const open = empty && isOpen(placed, i);
        const match = tok === i;
        const isTarget = target === i && empty;
        const fresh = landed && landed.draw.slot === i && !empty ? landed.seq : null;
        const lab = at((i * 360) / n, RING + sr + (narrow ? 22 : 17));
        const cls = ['sock', empty ? (open ? 'open' : 'dead') : 'full', match ? 'match' : '', isTarget ? 'target' : '', pickable && empty ? 'pick' : '']
          .filter(Boolean)
          .join(' ');
        const label = empty
          ? `Slot ${i + 1}: ${open ? `its token is in the bag, 1 in ${t.r} to match` : 'its token is already placed, cannot match'}`
          : `Slot ${i + 1}: token ${tok + 1}${match ? ', a match' : ''}`;
        return (
          <g key={i}>
            <text x={lab.x} y={lab.y} className="slot-no" dominantBaseline="central">
              {i + 1}
            </text>
            <g
              className={cls}
              transform={`translate(${p.x.toFixed(2)} ${p.y.toFixed(2)})`}
              style={vars({ '--c': col })}
              role={pickable && empty ? 'button' : undefined}
              tabIndex={pickable && empty ? 0 : undefined}
              aria-label={label}
              onClick={pickable && empty ? () => onPick(i) : undefined}
              onKeyDown={pickable && empty ? key(i) : undefined}
              onMouseEnter={pickable && empty ? () => onHover(i) : undefined}
              onMouseLeave={pickable && empty ? () => onHover(null) : undefined}
            >
              <title>{label}</title>
              {isTarget && <circle r={sr + 8} className="aim" />}
              {match && <circle r={sr + 6} className="halo" key={`halo-${fresh ?? 'x'}`} />}
              <circle r={sr} className="well" />
              <circle r={sr - 3} className="rim" />
              {open && <path d={arcPath(1 / t.r, sr - 3)} className="chance" />}
              {empty && (
                <text className="num" dominantBaseline="central">
                  {i + 1}
                </text>
              )}
              {!empty && (
                <g className={'token' + (fresh !== null ? ' pop' : '')} key={`tok-${fresh ?? 'x'}`}>
                  <circle r={sr - 11} style={{ fill: slotColour(tok, n) }} />
                  <text className="tnum" dominantBaseline="central">
                    {tok + 1}
                  </text>
                </g>
              )}
            </g>
          </g>
        );
      })}

      {/* The bag: every token left, as equal sectors. The pointer picks one uniformly. */}
      <g className="bag">
        {tokens.length === 1 ? (
          <circle
            cx={cx}
            cy={cy}
            r={(BAG_IN + BAG_OUT) / 2}
            className={'sector ring' + (placed[tokens[0]] === null ? '' : ' dud') + (drawingSector === 0 && flying ? ' taken' : '')}
            style={vars({ '--c': slotColour(tokens[0], n), strokeWidth: BAG_OUT - BAG_IN })}
          />
        ) : (
          tokens.map((tok, k) => {
            const hot = k === matchSector;
            const taken = flying && k === drawingSector;
            return (
              <path
                key={tok}
                d={sectorPath(k, hot ? 7 : 0)}
                className={'sector' + (placed[tok] === null ? '' : ' dud') + (hot ? ' hot' : '') + (taken ? ' taken' : '')}
                style={vars({ '--c': slotColour(tok, n) })}
              />
            );
          })
        )}
        <g className="pointer" style={{ transform: `rotate(${pointer}deg)`, transformOrigin: `${cx}px ${cy}px` }}>
          <path d={`M ${cx} ${cy - BAG_OUT - 3} L ${cx - 9} ${cy - BAG_OUT - 21} L ${cx + 9} ${cy - BAG_OUT - 21} Z`} />
        </g>
      </g>

      {/* Centre: the next draw's match chance, or the final count. */}
      <g className="centre">
        {phase === 'over' || target === null || !targetEmpty ? (
          <>
            <text x={cx} y={cy - 6} className="big" dominantBaseline="central">
              {t.m}
            </text>
            <text x={cx} y={cy + 26} className="small" dominantBaseline="central">
              {t.m === 1 ? 'match' : 'matches'}
            </text>
          </>
        ) : (
          <>
            <text x={cx} y={cy - 28} className="cap" dominantBaseline="central">
              SLOT {target + 1}
            </text>
            <text x={cx} y={cy + 2} className={'big' + (targetOpen ? '' : ' none')} dominantBaseline="central">
              {targetOpen ? `1/${t.r}` : '0'}
            </text>
            <text x={cx} y={cy + 30} className="small" dominantBaseline="central">
              {targetOpen ? 'to match' : "can't match"}
            </text>
          </>
        )}
      </g>

      {/* The token in flight, from its sector to the slot. */}
      {flying &&
        (() => {
          const from = at(flying.sector * (360 / flying.of), (BAG_IN + BAG_OUT) / 2);
          const to = slotAt(flying.slot);
          return (
            <g transform={`translate(${to.x.toFixed(2)} ${to.y.toFixed(2)})`}>
              <g className="fly" style={vars({ '--dx': `${(from.x - to.x).toFixed(1)}px`, '--dy': `${(from.y - to.y).toFixed(1)}px` })}>
                <circle r={sr - 11} style={{ fill: slotColour(flying.token, n) }} />
                <text className="tnum" dominantBaseline="central">
                  {flying.token + 1}
                </text>
              </g>
            </g>
          );
        })()}

      <FinishStrip layout={layout} groups={groups} winShare={winShare} m={t.m} r={t.r} a={t.a} />
    </svg>
  );
}

function FinishStrip({ layout, groups, winShare, m, r, a }: { layout: LayoutName; groups: FinishGroup[]; winShare: number; m: number; r: number; a: number }) {
  if (layout === 'wide') {
    const x0 = 628;
    const w = 30;
    const y0 = 96;
    const h = 290;
    let y = y0;
    const segs = groups.map((g) => {
      const s = { g, y, h: g.p * h };
      y += g.p * h;
      return s;
    });
    const labelY = spread(
      segs.map((s) => s.y + s.h / 2),
      25,
      y0 + 8,
      y0 + h - 8,
    );
    return (
      <g className="strip wide">
        <text x={x0} y={46} className="cap">
          WHERE YOU FINISH
        </text>
        <text x={x0} y={68} className="sub">
          final matches, dealing out from here
        </text>
        <rect x={x0 - 1} y={y0 - 1} width={w + 2} height={h + 2} rx={5} className="frame" />
        {segs.map(({ g, y: sy, h: sh }) => (
          <rect key={g.label} x={x0} y={sy} width={w} height={Math.max(0, sh)} className={'seg' + (g.win ? ' win' : ' lose')} />
        ))}
        {segs.map(({ g, y: sy, h: sh }, i) => {
          const ly = labelY[i];
          const my = sy + sh / 2;
          return (
            <g key={g.label} className={'seg-label' + (g.win ? ' win' : '')}>
              <path d={`M ${x0 + w + 3} ${my.toFixed(1)} L ${x0 + w + 12} ${my.toFixed(1)} L ${x0 + w + 24} ${ly.toFixed(1)} L ${x0 + w + 30} ${ly.toFixed(1)}`} className="leader" />
              <text x={x0 + w + 36} y={ly} dominantBaseline="central" className="count">
                {g.label} {matchWord(g.label)}
              </text>
              <text x={866} y={ly} dominantBaseline="central" className="pct">
                {fmtChance(g.p)}
              </text>
            </g>
          );
        })}
        <text x={x0} y={y0 + h + 30} className="share" dominantBaseline="central">
          <tspan className="win">■</tspan> you win {fmtChance(winShare)}
        </text>

        {/* Key. */}
        <g className="key" transform={`translate(${x0 + 14} ${y0 + h + 72})`}>
          <g>
            <circle r={11} className="k-rim" />
            <path d="M 0 -11 A 11 11 0 0 1 9.5 -5.5" className="k-arc" />
            <text x={26} dominantBaseline="central">
              {a > 0 ? `arc = 1 in ${r} to match (${a} slot${a === 1 ? '' : 's'})` : 'arc: no slot left can match'}
            </text>
          </g>
          <g transform="translate(0 30)">
            <circle r={11} className="k-dead" />
            <text x={26} dominantBaseline="central">
              dashed: token gone, can't match
            </text>
          </g>
          <g transform="translate(0 60)">
            <circle r={13} className="k-halo" />
            <circle r={7} className="k-tok" />
            <text x={26} dominantBaseline="central">
              glow: a match ({m} so far)
            </text>
          </g>
        </g>
      </g>
    );
  }

  // Narrow: a horizontal strip under the wheel, labels below it.
  const x0 = 36;
  const w = 528;
  const y0 = 590;
  const h = 28;
  let x = x0;
  const segs = groups.map((g) => {
    const s = { g, x, w: g.p * w };
    x += g.p * w;
    return s;
  });
  const labelX = spread(
    segs.map((s) => s.x + s.w / 2),
    92,
    x0 + 34,
    x0 + w - 34,
  );
  return (
    <g className="strip narrow">
      <text x={x0} y={572} className="cap">
        WHERE YOU FINISH
      </text>
      <text x={x0 + w} y={572} className="share end">
        you win {fmtChance(winShare)}
      </text>
      <rect x={x0 - 1} y={y0 - 1} width={w + 2} height={h + 2} rx={5} className="frame" />
      {segs.map(({ g, x: sx, w: sw }) => (
        <rect key={g.label} x={sx} y={y0} width={Math.max(0, sw)} height={h} className={'seg' + (g.win ? ' win' : ' lose')} />
      ))}
      {segs.map(({ g, x: sx, w: sw }, i) => {
        const lx = labelX[i];
        const mx = sx + sw / 2;
        return (
          <g key={g.label} className={'seg-label' + (g.win ? ' win' : '')}>
            <path d={`M ${mx.toFixed(1)} ${y0 + h + 3} L ${mx.toFixed(1)} ${y0 + h + 9} L ${lx.toFixed(1)} ${y0 + h + 17} L ${lx.toFixed(1)} ${y0 + h + 20}`} className="leader" />
            <text x={lx} y={y0 + h + 38} className="count mid" dominantBaseline="central">
              {g.label}
            </text>
            <text x={lx} y={y0 + h + 62} className="pct mid" dominantBaseline="central">
              {fmtChance(g.p)}
            </text>
          </g>
        );
      })}
    </g>
  );
}
