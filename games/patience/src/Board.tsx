import type { CSSProperties } from 'react';
import { catchBands, shelfOf, type Deal } from './math';

// Rows are card values (high at the top), columns are piles. Every value sits
// in exactly one row, so a dealt card slides along its own row from the deck
// strip on the left to the pile it lands on. Pile tops are the lowest card in
// each column and rise from left to right. Under each top hangs that pile's
// catch band: the rows between the previous pile's top and its own, the
// values that fit under it and nowhere earlier. Above the last top (the
// shelf) is the red new-pile band in the next column. The bands tile the rows,
// so every row meets exactly one band and a card drops into the band on its
// row. Columns 1..k are the piles allowed; column k+1 is the red bust column.

const VW = 440;
const LABEL_W = 62;
const GRID_TOP = 50;

export interface Moving {
  card: number;
  pile: number;
  ms: number;
  key: number;
}

export interface BoardProps {
  k: number;
  deal: Deal;
  /** Show the catch bands, the shelf and the count of cards that would open a pile. */
  showZone: boolean;
  moving: Moving | null;
  last: number | null;
  /** The card that opened the bust pile, drawn in red when the round is over. */
  bustCard: number | null;
}

export default function Board({ k, deal, showZone, moving, last, bustCard }: BoardProps) {
  const n = deal.n;
  const s = Math.min(34, 300 / n);
  const cols = k + 1;
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
  const bustNext = zoneCol === k;
  const remaining = new Set(deal.remaining);
  const lit = deal.remaining.filter((c) => c > shelf).length;
  const movingCard = moving?.card ?? null;
  const zone = showZone && zoneCol > 0 && zoneCol < cols;

  const bands = catchBands(deal);
  /** A band's rows lo..hi as a rect; an empty band is a zero-height rect just under its top, so it can grow. */
  const bandBox = (lo: number, hi: number) => ({ y: GRID_TOP + (n - hi) * s, height: Math.max(0, hi - lo + 1) * s });

  const tile = (card: number, pile: number, cls: string, style?: CSSProperties, key?: string | number) => (
    <g key={key ?? card} className={cls} style={style}>
      <rect x={colX(pile) + 2} y={rowY(card) + 1.5} width={cw - 4} height={s - 3} rx={4} />
      <text x={midX(pile)} y={rowY(card) + s / 2} dy="0.35em" fontSize={fs}>
        {card}
      </text>
    </g>
  );

  const countY = GRID_TOP + Math.max(16, (Math.min(shelfY, gridBottom) - GRID_TOP) / 2);

  return (
    <svg viewBox={`0 0 ${VW} ${gridBottom + 12}`} className="pat" role="img" aria-label={`${deal.piles.length} piles, ${deal.remaining.length} cards left`}>
      <defs>
        <pattern id="pat-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="8" height="8" className="hatch-bg" />
          <line x1="0" y1="0" x2="0" y2="8" className="hatch-line" />
        </pattern>
      </defs>

      {/* Headers: the deck, the k piles allowed, the bust pile. */}
      <text x={deckMid} y={GRID_TOP - 28} className="hdr">
        deck
      </text>
      <text x={(colX(0) + colX(k - 1) + cw) / 2} y={GRID_TOP - 28} className="hdr win">
        {k * pitch >= 150 ? `${k} piles allowed` : `${k} allowed`}
      </text>
      <text x={midX(k)} y={GRID_TOP - 28} className="hdr lose">
        bust
      </text>
      {Array.from({ length: cols }, (_, j) => (
        <text key={j} x={midX(j)} y={GRID_TOP - 10} className={'colno' + (j === k ? ' lose' : j < deal.piles.length ? ' used' : '')}>
          {j + 1}
        </text>
      ))}

      {/* Columns */}
      {Array.from({ length: cols }, (_, j) => (
        <rect
          key={j}
          x={colX(j)}
          y={GRID_TOP}
          width={cw}
          height={n * s}
          rx={6}
          className={'col' + (j === k ? ' overflow' : '')}
          fill={j === k ? 'url(#pat-hatch)' : undefined}
        />
      ))}
      {/* Catch bands: under each pile's top, the values it takes. They shrink as a lower card covers the top. */}
      {zone &&
        bands.slice(0, -1).map((b) => {
          const box = bandBox(b.lo, b.hi);
          return (
            <rect
              key={`b${b.pile}`}
              x={colX(b.pile) + 1}
              width={cw - 2}
              {...box}
              style={box as CSSProperties}
              rx={5}
              className={'band' + (moving?.pile === b.pile ? ' hit' : '')}
            />
          );
        })}
      {Array.from({ length: n - 1 }, (_, i) => (
        <line key={i} x1={x0} x2={colX(cols - 1) + cw} y1={GRID_TOP + (i + 1) * s} y2={GRID_TOP + (i + 1) * s} className="rowline" />
      ))}
      <line x1={colX(k) - 3} x2={colX(k) - 3} y1={GRID_TOP - 4} y2={gridBottom + 4} className="limit" />

      {/* The red new-pile band: a card higher than every top opens the next column. */}
      {zone && (
        <g className={'zone' + (bustNext ? ' lose' : '') + (moving?.pile === zoneCol ? ' hit' : '')}>
          <rect x={colX(zoneCol)} width={cw} {...bandBox(shelf + 1, n)} style={bandBox(shelf + 1, n) as CSSProperties} rx={6} />
          {!bustNext && shelfY - GRID_TOP >= 2 * s && (
            <>
              <text x={midX(zoneCol)} y={GRID_TOP + (shelfY - GRID_TOP) / 2 - 7} dy="0.35em" className="zone-label">
                new
              </text>
              <text x={midX(zoneCol)} y={GRID_TOP + (shelfY - GRID_TOP) / 2 + 7} dy="0.35em" className="zone-label">
                pile
              </text>
            </>
          )}
        </g>
      )}
      {zone && (
        <line
          x1={x0 - 4}
          x2={colX(zoneCol) + cw + 4}
          y1={0}
          y2={0}
          style={{ transform: `translateY(${shelfY}px)` }}
          className={'shelf' + (bustNext ? ' lose' : '')}
        />
      )}

      {/* Deck strip: one slot per value; cards above the shelf would open a pile. */}
      {Array.from({ length: n }, (_, i) => {
        const v = i + 1;
        const inDeck = remaining.has(v) && v !== movingCard;
        const opens = zone && inDeck && v > shelf;
        return (
          <g key={v} className={'slot' + (inDeck ? ' in' : ' out') + (opens ? ' opens' + (bustNext ? ' lose' : '') : '')}>
            <rect x={x0 + 2} y={rowY(v) + 1.5} width={cw - 4} height={s - 3} rx={4} />
            <text x={deckMid} y={rowY(v) + s / 2} dy="0.35em" fontSize={fs}>
              {v}
            </text>
          </g>
        );
      })}

      {/* Count: deck cards above the shelf over cards left. */}
      {zone && deal.remaining.length > 0 && (
        <g className={'count' + (bustNext ? ' lose' : '')}>
          <text x={x0 - 8} y={countY - 4} className="count-big">
            {lit} of {deal.remaining.length}
          </text>
          <text x={x0 - 8} y={countY + 11} className="count-small">
            {bustNext ? 'would' : 'open a'}
          </text>
          <text x={x0 - 8} y={countY + 25} className="count-small">
            {bustNext ? 'bust' : 'new pile'}
          </text>
        </g>
      )}

      {/* Piles: a spine through each, covered cards dim, the top bright. */}
      {deal.piles.map((p, j) =>
        p.length > 1 ? <line key={`sp${j}`} x1={midX(j)} x2={midX(j)} y1={rowY(p[0]) + s / 2} y2={rowY(p[p.length - 1]) + s / 2} className="spine" /> : null,
      )}
      {deal.piles.flatMap((p, j) =>
        p.map((card, i) =>
          tile(card, j, 'card' + (i === p.length - 1 ? ' top' : ' covered') + (card === last ? ' last' : '') + (card === bustCard ? ' final lose' : '')),
        ),
      )}

      {/* The card in flight slides along its row from the deck. */}
      {moving &&
        tile(
          moving.card,
          moving.pile,
          'card top moving' + (moving.pile === k ? ' final lose' : moving.pile === deal.piles.length ? ' opening' : ''),
          { '--dx': `${deckMid - midX(moving.pile)}px`, animationDuration: `${moving.ms}ms` } as CSSProperties,
          `m${moving.key}`,
        )}
    </svg>
  );
}
