import { fmtChance } from '@originals/game-sdk/ui';
import type { CSSProperties } from 'react';
import { columnsFor, shelfOf, winsAt, type Bet, type Deal, type Ghost } from './math';

// Rows are card values (high at the top), columns are piles. Every value sits
// in exactly one row, so a dealt card slides along its own empty row from the
// deck strip on the left to the pile it lands on. Pile tops are the lowest
// card in each column and rise from left to right; the top of the rightmost
// pile is the "top shelf". Cards still in the deck above it open a new pile.

const VW = 440;
const VH = 468;
const LABEL_W = 58;
const GRID_TOP = 48;

export interface Moving {
  card: number;
  pile: number;
  ms: number;
  key: number;
}

export interface BoardProps {
  bet: Bet;
  deal: Deal;
  /** Every card left, where it would land (null hides them). */
  ghosts: Ghost[] | null;
  /** Chance the deal ends on each column (null hides the forecast and crops the board). */
  bars: number[] | null;
  /** A longest rising run, one card per pile, drawn when the round is over. */
  run: number[] | null;
  /** Show the new-pile zone, the shelf and the deck count. */
  showZone: boolean;
  moving: Moving | null;
  last: number | null;
  finalCard: { card: number; tone: 'win' | 'lose' } | null;
  winP: number;
}

function pie(cx: number, cy: number, r: number, p: number) {
  const a = p * 2 * Math.PI;
  const ex = cx + r * Math.sin(a);
  const ey = cy - r * Math.cos(a);
  return `M ${cx} ${cy} L ${cx} ${(cy - r).toFixed(2)} A ${r} ${r} 0 ${p > 0.5 ? 1 : 0} 1 ${ex.toFixed(2)} ${ey.toFixed(2)} Z`;
}

const pct = (p: number) => (p <= 0 ? '0%' : p >= 1 ? '100%' : p < 0.01 ? '<1%' : p > 0.99 ? '>99%' : `${Math.round(p * 100)}%`);

export default function Board({ bet, deal, ghosts, bars, run, showZone, moving, last, finalCard, winP }: BoardProps) {
  const n = deal.n;
  const s = Math.min(34, 300 / n);
  const cols = columnsFor(bet);
  // Columns are as wide as the board allows (up to a landscape tile), deck included.
  const cw = Math.max(s + 2, Math.min(s * 1.6, (VW - LABEL_W - 42) / (cols + 1) - 6));
  const pitch = cw + 6;
  const contentW = cw + 18 + cols * pitch - 4;
  const x0 = (VW - LABEL_W - contentW) / 2 + LABEL_W;
  const gridLeft = x0 + cw + 18;
  const colX = (j: number) => gridLeft + j * pitch;
  const rowY = (v: number) => GRID_TOP + (n - v) * s;
  const gridBottom = GRID_TOP + n * s;
  const midX = (j: number) => colX(j) + cw / 2;
  const deckMid = x0 + cw / 2;
  const fs = Math.round(s * 0.47);

  const shelf = shelfOf(deal);
  const shelfY = rowY(shelf);
  const zoneCol = deal.piles.length;
  const fit = bet.mode === 'fit';
  const limitCol = fit ? bet.k : bet.k - 1; // the overflow column (fit) or the goal column (reach)
  const zoneTone = zoneCol === limitCol ? (fit ? 'lose' : 'win') : 'open';
  const remaining = new Set(deal.remaining);
  const lit = deal.remaining.filter((c) => c > shelf).length;
  const movingCard = moving?.card ?? null;

  const FB = gridBottom + 24 + 56; // forecast baseline
  const FH = 56;

  const tile = (card: number, pile: number, cls: string, style?: CSSProperties, key?: string | number) => (
    <g key={key ?? card} className={cls} style={style}>
      <rect x={colX(pile) + 2} y={rowY(card) + 1.5} width={cw - 4} height={s - 3} rx={4} />
      <text x={midX(pile)} y={rowY(card) + s / 2} dy="0.35em" fontSize={fs}>
        {card}
      </text>
    </g>
  );

  return (
    <svg
      viewBox={`0 0 ${VW} ${bars ? VH : gridBottom + 34}`}
      className="pat"
      role="img"
      aria-label={`${deal.piles.length} piles, ${deal.remaining.length} cards left`}
    >
      <defs>
        <pattern id="pat-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="8" height="8" className="hatch-bg" />
          <line x1="0" y1="0" x2="0" y2="8" className="hatch-line" />
        </pattern>
      </defs>

      {/* Headers */}
      <text x={deckMid} y={GRID_TOP - 26} className="hdr">
        deck
      </text>
      {Array.from({ length: cols }, (_, j) => {
        const special = j === limitCol;
        return (
          <g key={j}>
            {special && (
              <text x={midX(j)} y={GRID_TOP - 26} className={'hdr ' + (fit ? 'lose' : 'win')}>
                {fit ? 'bust' : 'goal'}
              </text>
            )}
            <text
              x={midX(j)}
              y={GRID_TOP - 9}
              className={'colno' + (special ? (fit ? ' lose' : ' win') : '') + (j < deal.piles.length ? ' used' : '')}
            >
              {j + 1}
            </text>
          </g>
        );
      })}

      {/* Columns */}
      {Array.from({ length: cols }, (_, j) => (
        <rect
          key={j}
          x={colX(j)}
          y={GRID_TOP}
          width={cw}
          height={n * s}
          rx={6}
          className={'col' + (j === limitCol ? (fit ? ' overflow' : ' goal') : '')}
          fill={j === limitCol && fit ? 'url(#pat-hatch)' : undefined}
        />
      ))}
      {/* Row guides */}
      {Array.from({ length: n - 1 }, (_, i) => (
        <line key={i} x1={x0} x2={colX(cols - 1) + cw} y1={GRID_TOP + (i + 1) * s} y2={GRID_TOP + (i + 1) * s} className="rowline" />
      ))}
      {fit && <line x1={colX(limitCol) - 3} x2={colX(limitCol) - 3} y1={GRID_TOP - 4} y2={gridBottom + 4} className="limit" />}

      {/* The new-pile zone: rows above the top shelf in the next column. */}
      {showZone && zoneCol < cols && shelf < n && (
        <rect x={colX(zoneCol)} y={GRID_TOP} width={cw} height={shelfY - GRID_TOP} rx={6} className={`zone ${zoneTone}`} />
      )}
      {showZone && shelf > 0 && (
        <line x1={x0 - 4} x2={colX(Math.min(zoneCol, cols - 1)) + cw + 4} y1={shelfY} y2={shelfY} className={`shelf ${zoneTone}`} />
      )}

      {/* Deck strip: one slot per value. */}
      {Array.from({ length: n }, (_, i) => {
        const v = i + 1;
        const inDeck = remaining.has(v) && v !== movingCard;
        const opens = showZone && inDeck && v > shelf;
        return (
          <g key={v} className={'slot' + (inDeck ? ' in' : ' out') + (opens ? ` opens ${zoneTone}` : '')}>
            <rect x={x0 + 2} y={rowY(v) + 1.5} width={cw - 4} height={s - 3} rx={4} />
            <text x={deckMid} y={rowY(v) + s / 2} dy="0.35em" fontSize={fs}>
              {v}
            </text>
          </g>
        );
      })}

      {/* Deck count: cards above the shelf over cards left. */}
      {showZone && deal.remaining.length > 0 && (
        <g className={`count ${zoneTone}`}>
          {shelf < n && <path d={`M ${x0 - 6} ${GRID_TOP + 3} h -5 V ${shelfY - 3} h 5`} className="bracket" />}
          <text x={x0 - 14} y={GRID_TOP + Math.max(14, (Math.min(shelfY, gridBottom) - GRID_TOP) / 2) - 4} className="count-big">
            {lit}/{deal.remaining.length}
          </text>
          <text x={x0 - 14} y={GRID_TOP + Math.max(14, (Math.min(shelfY, gridBottom) - GRID_TOP) / 2) + 11} className="count-small">
            new pile
          </text>
        </g>
      )}

      {/* Piles: a spine through each, covered cards dim, the top bright. */}
      {deal.piles.map((p, j) =>
        p.length > 1 ? (
          <line key={`sp${j}`} x1={midX(j)} x2={midX(j)} y1={rowY(p[0]) + s / 2} y2={rowY(p[p.length - 1]) + s / 2} className="spine" />
        ) : null,
      )}
      {run && run.length > 1 && <polyline points={run.map((c, j) => `${midX(j)},${rowY(c) + s / 2}`).join(' ')} className="run" />}
      {deal.piles.flatMap((p, j) =>
        p.map((card, i) => {
          const top = i === p.length - 1;
          const fin = finalCard?.card === card ? ` final ${finalCard.tone}` : '';
          const inRun = run?.[j] === card ? ' in-run' : '';
          return tile(card, j, 'card' + (top ? ' top' : ' covered') + (card === last ? ' last' : '') + inRun + fin);
        }),
      )}
      {run && run.length > 0 && (
        <text x={(x0 + colX(cols - 1) + cw) / 2} y={gridBottom + 24} className="run-caption">
          Longest rising run {run.join('→')} = {run.length} {run.length === 1 ? 'pile' : 'piles'}
        </text>
      )}

      {/* Where each card left would land, and the win chance if it comes next. */}
      {ghosts?.map((g) => {
        const cx = midX(g.pile);
        const cy = rowY(g.card) + s / 2;
        const r = Math.min(s * 0.33, cw * 0.3);
        return (
          <g key={`g${g.card}`} className="ghost">
            <title>{`Card ${g.card} → pile ${g.pile + 1}${g.opens ? ' (new)' : ''} · win ${pct(g.chance)} if it comes next`}</title>
            <circle cx={cx} cy={cy} r={r} className="ghost-bg" />
            {g.chance >= 1 ? (
              <circle cx={cx} cy={cy} r={r} className="ghost-win" />
            ) : g.chance > 0 ? (
              <path d={pie(cx, cy, r, g.chance)} className="ghost-win" />
            ) : null}
            <circle cx={cx} cy={cy} r={r} className="ghost-ring" />
          </g>
        );
      })}

      {/* The card in flight slides along its row from the deck. */}
      {moving &&
        tile(
          moving.card,
          moving.pile,
          'card top moving' + (moving.pile === limitCol ? (fit ? ' final lose' : ' final win') : ''),
          {
            '--dx': `${deckMid - midX(moving.pile)}px`,
            animationDuration: `${moving.ms}ms`,
          } as CSSProperties,
          `m${moving.key}`,
        )}

      {/* Forecast: chance the deal ends with each column as its last pile. */}
      {bars && (
        <>
          <line x1={gridLeft - 4} x2={colX(cols - 1) + cw + 4} y1={FB} y2={FB} className="base" />
          {bars.map((p, j) => {
            const win = winsAt(bet, j + 1);
            return (
              <g key={`b${j}`}>
                <rect x={colX(j) + 4} y={FB - FH} width={cw - 8} height={FH} rx={3} className="bar-track" />
                <rect
                  x={colX(j) + 4}
                  y={FB - FH}
                  width={cw - 8}
                  height={FH}
                  rx={3}
                  className={'bar ' + (win ? 'win' : 'lose')}
                  style={{ transform: `scaleY(${p})` }}
                />
                <text x={midX(j)} y={FB - Math.max(p * FH, 0) - 5} className={'bar-pct ' + (win ? 'win' : 'lose')}>
                  {p > 0 ? pct(p) : ''}
                </text>
              </g>
            );
          })}
          <text x={x0 + cw / 2} y={FB - FH / 2 - 4} className="bar-label">
            ends
          </text>
          <text x={x0 + cw / 2} y={FB - FH / 2 + 9} className="bar-label">
            here
          </text>
          <text x={(x0 + colX(cols - 1) + cw) / 2} y={FB + 20} className="bar-caption">
            Chance the deal ends on each pile · <tspan className="win">green = win {fmtChance(winP)}</tspan>
          </text>
        </>
      )}
    </svg>
  );
}
