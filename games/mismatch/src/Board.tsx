import type { CSSProperties } from 'react';
import { fmtChance } from '@originals/game-sdk/ui';
import { bag, isOpen, matchEffect, tally, winChance, type BetDef, type Draw, type Placed } from './math';

export type Phase = 'idle' | 'drawing' | 'checkpoint' | 'over';
export type Outcome = 'won' | 'lost' | 'cashed';
export type LayoutName = 'wide' | 'narrow';

/** One square-ish view: the ring of slots, the bag in the middle, the rule underneath. */
export const VIEW = { w: 664, h: 668, cx: 332, cy: 298 } as const;

const RING = 206;
const BAG_IN = 62;
const BAG_OUT = 124;
const SR = 44;

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
  /** The slot the next draw goes into, or null when the round is over. */
  target: number | null;
  anim: Anim | null;
  /** The bag pointer's rotation in degrees (cumulative, so it always spins forwards). */
  pointer: number;
  spinMs: number;
  flyMs: number;
  /** The draw that landed last, for its pop and the "can't match now" link. */
  landed: Landed | null;
  svgRef?: (el: SVGSVGElement | null) => void;
}

export default function Board(props: BoardProps) {
  const { layout, n, placed, bet, phase, target, anim, pointer, spinMs, flyMs, landed, svgRef } = props;
  const { cx, cy } = VIEW;
  const t = tally(placed);
  const tokens = bag(placed);

  const at = (deg: number, r: number) => ({ x: cx + r * Math.sin(rad(deg)), y: cy - r * Math.cos(rad(deg)) });
  const slotAt = (i: number) => at((i * 360) / n, RING);

  // The bag: r equal slices, one per token left. Each is one chance in r.
  const step = 360 / Math.max(1, tokens.length);
  const sectorPath = (k: number, lift = 0) => {
    const a0 = (k - 0.5) * step;
    const a1 = (k + 0.5) * step;
    const mid = rad(k * step);
    const o = (deg: number, r: number) => {
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
  // The slice that would match the next slot: its own token, if still in the bag.
  const matchSector = targetOpen ? tokens.indexOf(target!) : -1;
  // Green if a match helps the bet, red if it hurts.
  const effect = matchEffect(bet, t);
  const tone = effect === 'up' ? 'good' : effect === 'down' ? 'bad' : '';

  // The token that just landed can make its own slot unable to match: draw that link briefly.
  const link =
    landed && landed.draw.token !== landed.draw.slot && landed.before[landed.draw.token] === null && placed[landed.draw.token] === null
      ? { from: slotAt(landed.draw.slot), to: slotAt(landed.draw.token) }
      : null;

  const ruleY = cy + RING + SR + 64;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${VIEW.w} ${VIEW.h}`}
      className={`mm ${layout} ${phase}`}
      role="img"
      aria-label={`${t.m} matches so far; ${t.r} tokens left, ${t.a} empty slots can still match; ${fmtChance(winChance(bet, t))} to win`}
      style={vars({ '--spin': `${spinMs}ms`, '--fly': `${flyMs}ms` })}
    >
      {/* The ring the slots sit on. */}
      <circle cx={cx} cy={cy} r={RING} className="track" />

      {link && <line key={`link-${landed!.seq}`} x1={link.from.x} y1={link.from.y} x2={link.to.x} y2={link.to.y} className="link" />}

      {/* Slots. */}
      {placed.map((tok, i) => {
        const p = slotAt(i);
        const col = slotColour(i, n);
        const empty = tok === null;
        const open = empty && isOpen(placed, i);
        const match = tok === i;
        const isTarget = target === i && empty;
        const fresh = landed && landed.draw.slot === i && !empty ? landed.seq : null;
        // Outside label: pushed out by its own half-width sideways and half-height vertically, so it clears the halo.
        const deg = (i * 360) / n;
        const lab = at(deg, RING + SR + 14 + (match ? 32 : 7) * Math.abs(Math.sin(rad(deg))) + 10 * Math.abs(Math.cos(rad(deg))));
        const cls = ['sock', empty ? (open ? 'open' : 'dead') : 'full', match ? 'match' : '', isTarget ? 'target' : ''].filter(Boolean).join(' ');
        const label = empty
          ? `Slot ${i + 1}: ${open ? `empty, token ${i + 1} is still in the bag` : `empty, token ${i + 1} is already in another slot, so it can't match`}`
          : `Slot ${i + 1}: token ${tok + 1}${match ? ', a match' : ''}`;
        return (
          <g key={i}>
            <text x={lab.x} y={lab.y} className={'slot-no' + (match ? ' hit' : '')} dominantBaseline="central">
              {match ? 'MATCH' : i + 1}
            </text>
            <g className={cls} transform={`translate(${p.x.toFixed(2)} ${p.y.toFixed(2)})`} style={vars({ '--c': col })} aria-label={label}>
              <title>{label}</title>
              {isTarget && <circle r={SR + 8} className={'aim ' + (targetOpen ? tone : 'safe')} />}
              {match && <circle r={SR + 6} className="halo" key={`halo-${fresh ?? 'x'}`} />}
              <circle r={SR} className="well" />
              {empty && open && (
                <text className="num" dominantBaseline="central">
                  {i + 1}
                </text>
              )}
              {empty && !open && (
                <g className="cant">
                  <text y={-9} dominantBaseline="central">
                    can't
                  </text>
                  <text y={10} dominantBaseline="central">
                    match
                  </text>
                </g>
              )}
              {!empty && (
                <g className={'token' + (fresh !== null ? ' pop' : '')} key={`tok-${fresh ?? 'x'}`}>
                  <circle r={SR - 10} style={{ fill: slotColour(tok, n) }} />
                  <text className="tnum" dominantBaseline="central">
                    {tok + 1}
                  </text>
                </g>
              )}
            </g>
          </g>
        );
      })}

      {/* The bag: every token left, as equal slices. The pointer picks one uniformly. */}
      <g className="bag">
        {tokens.length === 1 ? (
          <>
            <circle
              cx={cx}
              cy={cy}
              r={(BAG_IN + BAG_OUT) / 2}
              className={'sector ring' + (matchSector === 0 ? ' hot ' + tone : '') + (drawingSector === 0 && flying ? ' taken' : '')}
              style={vars({ '--c': slotColour(tokens[0], n), strokeWidth: BAG_OUT - BAG_IN })}
            />
            <text x={cx} y={cy - (BAG_IN + BAG_OUT) / 2} className="snum" dominantBaseline="central">
              {tokens[0] + 1}
            </text>
          </>
        ) : (
          tokens.map((tok, k) => {
            const hot = k === matchSector;
            const taken = flying && k === drawingSector;
            const c = at(k * step, (BAG_IN + BAG_OUT) / 2 + (hot ? 7 : 0));
            return (
              <g key={tok} className={'slice' + (taken ? ' taken' : '')}>
                <path d={sectorPath(k, hot ? 7 : 0)} className={'sector' + (hot ? ' hot ' + tone : '')} style={vars({ '--c': slotColour(tok, n) })} />
                <text x={c.x} y={c.y} className={'snum' + (hot ? ' hot' : '')} dominantBaseline="central">
                  {tok + 1}
                </text>
              </g>
            );
          })
        )}
        <circle cx={cx} cy={cy} r={BAG_IN - 1} className="hole" />
        <g className="pointer" style={{ transform: `rotate(${pointer}deg)`, transformOrigin: `${cx}px ${cy}px` }}>
          <path d={`M ${cx} ${cy - BAG_OUT - 3} L ${cx - 10} ${cy - BAG_OUT - 22} L ${cx + 10} ${cy - BAG_OUT - 22} Z`} />
        </g>
      </g>

      {/* Centre: the next draw's match chance, or the final count. */}
      <g className="centre">
        {phase === 'over' || target === null || !targetEmpty ? (
          <>
            <text x={cx} y={cy - 8} className="big" dominantBaseline="central">
              {t.m}
            </text>
            <text x={cx} y={cy + 24} className="small" dominantBaseline="central">
              {t.m === 1 ? 'match' : 'matches'}
            </text>
          </>
        ) : (
          <>
            <text x={cx} y={cy - 30} className="cap" dominantBaseline="central">
              SLOT {target + 1}
            </text>
            <text x={cx} y={cy} className={'big ' + (targetOpen ? tone : 'none')} dominantBaseline="central">
              {targetOpen ? `1 in ${t.r}` : '0'}
            </text>
            <text x={cx} y={cy + 29} className="small" dominantBaseline="central">
              {targetOpen ? 'to match' : "can't match"}
            </text>
          </>
        )}
      </g>

      {/* The token in flight, from its slice to the slot. */}
      {flying &&
        (() => {
          const from = at(flying.sector * (360 / flying.of), (BAG_IN + BAG_OUT) / 2);
          const to = slotAt(flying.slot);
          return (
            <g transform={`translate(${to.x.toFixed(2)} ${to.y.toFixed(2)})`}>
              <g className="fly" style={vars({ '--dx': `${(from.x - to.x).toFixed(1)}px`, '--dy': `${(from.y - to.y).toFixed(1)}px` })}>
                <circle r={SR - 10} style={{ fill: slotColour(flying.token, n) }} />
                <text className="tnum" dominantBaseline="central">
                  {flying.token + 1}
                </text>
              </g>
            </g>
          );
        })()}

      {/* The rule, in short lines under the ring. */}
      <text x={cx} y={ruleY} className="rule win" dominantBaseline="central">
        Win with {bet.name.toLowerCase()}
      </text>
      <text x={cx} y={ruleY + 34} className="rule" dominantBaseline="central">
        Match = a token in its own slot
      </text>
    </svg>
  );
}
