import { fmtChance } from '@originals/game-sdk/ui';
import type { CSSProperties } from 'react';
import { COIN_NAME, HEADS_GOLD, bayesBox, ratio, type Coin, type Face, type Separation } from './math';

const VIEW_W = 520;
const VIEW_H = 452;
const MID = VIEW_W / 2;

/** The Bayes box, in view units. */
const BOX = { x: 40, y: 250, w: 440, h: 146 };
const COIN_Y = 70;
const TAPE_Y = 168;

/** The kit's chance format, but never rounding a live chance up to 100%. */
export const fmtP = (p: number) => (p > 0.999 && p < 1 ? '>99.9%' : fmtChance(p));

/** A wedge of a disc, from the top, clockwise, covering `share` of it. */
function wedge(cx: number, cy: number, r: number, share: number) {
  const a = share * 2 * Math.PI;
  const x = cx + r * Math.sin(a);
  const y = cy - r * Math.cos(a);
  return `M ${cx} ${cy} L ${cx} ${cy - r} A ${r} ${r} 0 ${share > 0.5 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)} Z`;
}

export type CoinView =
  /** Face down: the coin before its first flip. */
  | { kind: 'hidden' }
  /** In the air. */
  | { kind: 'spinning' }
  /** Landed on a face. */
  | { kind: 'face'; face: Face }
  /** Turned over: the truth. */
  | { kind: 'truth'; coin: Coin };

export interface BoardProps {
  side: Coin;
  sep: Separation;
  flips: number;
  /** Faces on the tape so far. */
  faces: Face[];
  /** The Gold column's width: P(Gold | what the box has absorbed). */
  pGold: number;
  /** While a face trims the columns to their likelihoods. */
  cut: Face | null;
  /** P(Gold) after a head and after a tail, for the next-flip ticks. */
  next: { h: number; t: number } | null;
  coin: CoinView;
  /** Transition and spin duration for the current stage, in ms. */
  ms: number;
  /** Bumped for each new spin so the CSS animation restarts. */
  spinKey: number;
  /** A revealed round's verdict: true = your coin. Null before a reveal and after a cash-out. */
  won: boolean | null;
}

/** One of the two coin types, its heads chance drawn as a wedge. */
function LegendCoin({ coin, sep, x, align }: { coin: Coin; sep: Separation; x: number; align: 'start' | 'end' }) {
  const heads = coin === 'gold' ? HEADS_GOLD[sep] : 1 - HEADS_GOLD[sep];
  const r = 32;
  const tx = align === 'start' ? x + r + 10 : x - r - 10;
  // Letters sit in the middle of their wedges.
  const at = (mid: number) => ({ x: x + r * 0.56 * Math.sin(mid * 2 * Math.PI), y: COIN_Y - r * 0.56 * Math.cos(mid * 2 * Math.PI) + 5 });
  const h = at(heads / 2);
  const t = at(heads + (1 - heads) / 2);
  return (
    <g className={`legend ${coin}`}>
      <circle cx={x} cy={COIN_Y} r={r} className="tails-part" />
      <path d={wedge(x, COIN_Y, r, heads)} className="heads-part" />
      <circle cx={x} cy={COIN_Y} r={r} className="rim" />
      <text x={h.x} y={h.y} className="legend-h">
        H
      </text>
      <text x={t.x} y={t.y} className="legend-t">
        T
      </text>
      <text x={tx} y={COIN_Y - 5} className={`legend-name ${align}`}>
        {COIN_NAME[coin]}
      </text>
      <text x={tx} y={COIN_Y + 17} className={`legend-sub ${align}`}>
        heads {Math.round(heads * 100)}%
      </text>
    </g>
  );
}

/** The hidden coin: face down, in the air, on a face, or turned over. */
function MysteryCoin({ view, ms, spinKey, won }: { view: CoinView; ms: number; spinKey: number; won: boolean | null }) {
  const r = 48;
  const truth = view.kind === 'truth' ? view.coin : null;
  const style = { '--spin': `${ms}ms` } as CSSProperties;
  return (
    <g className={'mystery' + (view.kind === 'spinning' ? ' spinning' : '')} style={style}>
      <g key={spinKey} className="toss">
        <g className="flip">
          <circle cx={MID} cy={COIN_Y} r={r} className={'disc' + (truth ? ` truth ${truth}` : view.kind === 'face' ? ' landed' : '')} />
          <circle cx={MID} cy={COIN_Y} r={r - 8} className="inner-rim" />
          {view.kind === 'hidden' && (
            <text x={MID} y={COIN_Y + 16} className="glyph q">
              ?
            </text>
          )}
          {view.kind === 'face' && (
            <text x={MID} y={COIN_Y + 17} className="glyph">
              {view.face}
            </text>
          )}
          {truth && (
            <text x={MID} y={COIN_Y + 7} className="glyph truth-name">
              {COIN_NAME[truth].toUpperCase()}
            </text>
          )}
        </g>
      </g>
      {truth && won !== null && <circle cx={MID} cy={COIN_Y} r={r + 7} className={'halo ' + (won ? 'won' : 'lost')} />}
    </g>
  );
}

/** One bead per flip: gold for heads (evidence for Gold), silver for tails. */
function Tape({ flips, faces, sep }: { flips: number; faces: Face[]; sep: Separation }) {
  const span = BOX.w;
  const gap = Math.min(56, span / Math.max(1, flips - 1));
  const r = Math.min(18, gap * 0.42);
  const x0 = MID - (gap * (flips - 1)) / 2;
  const lr = ratio(sep).toFixed(2);
  return (
    <g className="tape">
      {Array.from({ length: flips }, (_, i) => {
        const f = faces[i];
        const x = x0 + i * gap;
        return (
          <g key={i} className={'bead' + (f ? ` ${f === 'H' ? 'h' : 't'}` : '') + (i === faces.length - 1 ? ' last' : '')}>
            <circle cx={x} cy={TAPE_Y} r={r} />
            {f && (
              <text x={x} y={TAPE_Y + r * 0.38} style={{ fontSize: `${(r * 1.05).toFixed(1)}px` }}>
                {f}
              </text>
            )}
          </g>
        );
      })}
      <text x={MID} y={TAPE_Y + 40} className="tape-legend">
        <tspan className="h">H</tspan> Gold odds ×{lr} · <tspan className="t">T</tspan> Silver odds ×{lr}
      </text>
    </g>
  );
}

export default function Board({ side, sep, flips, faces, pGold, cut, next, coin, ms, spinKey, won }: BoardProps) {
  const box = bayesBox(pGold, sep, cut);
  const style = { '--t': `${ms}ms` } as CSSProperties;
  const columns = (['gold', 'silver'] as const).map((c) => {
    const col = box[c];
    const x = BOX.x + col.x * BOX.w;
    const w = Math.max(0, col.width * BOX.w);
    const h = col.height * BOX.h;
    return { c, col, x, w, h, cx: x + w / 2, mine: c === side };
  });
  const barY = BOX.y + BOX.h + 9;

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="bayes"
      style={style}
      role="img"
      aria-label={`Bayes box: Gold ${fmtP(pGold)}, Silver ${fmtP(1 - pGold)}. You back ${COIN_NAME[side]}.`}
    >
      <defs>
        <pattern id="bayes-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="8" className="hatch-line" />
        </pattern>
        <clipPath id="bayes-box-clip">
          <rect x={BOX.x} y={BOX.y} width={BOX.w} height={BOX.h} rx={8} />
        </clipPath>
      </defs>

      <LegendCoin coin="gold" sep={sep} x={48} align="start" />
      <LegendCoin coin="silver" sep={sep} x={VIEW_W - 48} align="end" />
      <MysteryCoin view={coin} ms={ms} spinKey={spinKey} won={won} />

      <Tape flips={flips} faces={faces} sep={sep} />

      {/* The Bayes box: what a flip rules out (hatched) behind, the kept parts in front. */}
      <rect x={BOX.x} y={BOX.y} width={BOX.w} height={BOX.h} rx={8} className="box-bg" />
      <g clipPath="url(#bayes-box-clip)">
        {columns.map(({ c, x, w }) => (
          <rect key={`ghost-${c}`} x={x} y={BOX.y} width={w} height={BOX.h} className={`ghost ${c}` + (cut ? ' on' : '')} />
        ))}
        {columns.map(({ c, x, w, h }) => (
          <rect key={`col-${c}`} x={x} y={BOX.y + BOX.h - h} width={w} height={h} className={`col ${c}`} />
        ))}
      </g>
      {columns
        .filter((k) => k.mine)
        .map(({ c, x, w, h }) => (
          <rect key={`mine-${c}`} x={x + 1.5} y={BOX.y + BOX.h - h + 1.5} width={Math.max(0, w - 3)} height={Math.max(0, h - 3)} rx={6} className="mine" />
        ))}

      {/* Column labels ride with the columns. */}
      {columns.map(({ c, w, h, mine, cx, col }) => {
        // Name + big number, a compact number, or nothing (the bar labels below always carry it).
        const size = w >= 100 ? 'roomy' : w >= 50 ? 'compact' : 'hide';
        const wide = w >= 128;
        const top = BOX.y + BOX.h - h;
        const tall = h >= 64;
        const cy = cut ? top + Math.max(h / 2, 16) : BOX.y + BOX.h / 2;
        if (size === 'hide') return null;
        return (
          <g key={`lab-${c}`} className={`col-label ${c} ${size}`} style={{ transform: `translate(${cx}px, ${cy}px)` }}>
            {cut ? (
              <>
                <text y={wide && tall ? 0 : 8} className="lab-big">
                  ×{col.height.toFixed(2)}
                </text>
                {wide && tall && (
                  <text y={21} className="lab-small">
                    {`P(${cut === 'H' ? 'heads' : 'tails'} | ${COIN_NAME[c]})`}
                  </text>
                )}
              </>
            ) : (
              <>
                <text y={size === 'roomy' ? -8 : -6} className="lab-small">
                  {size === 'compact' ? COIN_NAME[c][0] : mine && wide ? `${COIN_NAME[c]} · yours` : COIN_NAME[c]}
                </text>
                <text y={size === 'roomy' ? 22 : 16} className="lab-big">
                  {fmtP(col.width)}
                </text>
              </>
            )}
          </g>
        );
      })}

      {/* Where the divider goes on the next flip. It always sits at their probability-weighted mean. */}
      {next && (
        <g className="ticks">
          <line x1={BOX.x + pGold * BOX.w} x2={BOX.x + pGold * BOX.w} y1={BOX.y - 15} y2={BOX.y} className="now" />
          {(
            [
              ['T', next.t, 'end'],
              ['H', next.h, 'start'],
            ] as const
          ).map(([f, p, anchor]) => {
            const x = BOX.x + p * BOX.w;
            return (
              <g key={f} className={`tick ${f === 'H' ? 'h' : 't'}`}>
                <path d={`M ${x - 6} ${BOX.y - 15} L ${x + 6} ${BOX.y - 15} L ${x} ${BOX.y - 4} Z`} />
                <text x={x + (anchor === 'start' ? 9 : -9)} y={BOX.y - 6} className={anchor}>
                  {f === 'H' ? 'if H' : 'if T'}
                </text>
              </g>
            );
          })}
        </g>
      )}

      {/* The literal win chance: green under your coin's column, red under the other, on a percent ruler. */}
      {columns.map(({ c, x, w, mine }) => (
        <rect key={`bar-${c}`} x={x} y={barY} width={w} height={9} className={'winbar ' + (mine ? 'win' : 'lose')} />
      ))}
      {[0, 0.25, 0.5, 0.75, 1].map((q) => (
        <line key={q} x1={BOX.x + q * BOX.w} x2={BOX.x + q * BOX.w} y1={barY + 9} y2={barY + 15} className="ruler" />
      ))}
      <text x={BOX.x} y={barY + 37} className={'bar-label start ' + (side === 'gold' ? 'win' : 'lose')}>
        {side === 'gold' ? 'You win' : 'You lose'} <tspan className="v">{fmtP(pGold)}</tspan>
      </text>
      <text x={BOX.x + BOX.w} y={barY + 37} className={'bar-label end ' + (side === 'silver' ? 'win' : 'lose')}>
        {side === 'silver' ? 'You win' : 'You lose'} <tspan className="v">{fmtP(1 - pGold)}</tspan>
      </text>
      <text x={MID} y={barY + 37} className="bar-mid">
        width = chance
      </text>
    </svg>
  );
}
