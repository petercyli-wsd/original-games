// Playing cards, hands and chips for the baccarat table. Pure presentation:
// the deal itself is decided in math.ts before any card is drawn here.

import type { CSSProperties } from 'react';
import { RANK_LABEL, SUIT_LABEL, SUIT_NAME, isRed, totalOf, type Card } from './math';

/** One card. `up` turns it face up (a 3D flip); `side` lays it sideways (a third card). */
export function PlayingCard({ card, up, side, from }: { card: Card; up: boolean; side?: boolean; from: 'left' | 'right' }) {
  const red = isRed(card);
  const rank = RANK_LABEL[card.rank];
  const suit = SUIT_LABEL[card.suit];
  return (
    <div className={'bc-slot' + (side ? ' side' : '')}>
      <div className={'bc-card ' + from + (up ? ' up' : '')} aria-label={up ? `${rank} of ${SUIT_NAME[card.suit]}` : 'Face-down card'}>
        <div className="bc-card-inner">
          <div className={'bc-face' + (red ? ' red' : '')}>
            <span className="bc-corner tl">
              <b>{rank}</b>
              <i>{suit}</i>
            </span>
            <span className="bc-pip">{suit}</span>
            <span className="bc-corner br">
              <b>{rank}</b>
              <i>{suit}</i>
            </span>
          </div>
          <div className="bc-back" />
        </div>
      </div>
    </div>
  );
}

export function EmptySlot({ side }: { side?: boolean }) {
  return <div className={'bc-slot empty' + (side ? ' side' : '')} />;
}

export function Hand({
  who,
  cards,
  flipped,
  revealed,
  state,
}: {
  who: 'player' | 'banker';
  /** The cards on this side of the table so far (placed, maybe face down). */
  cards: Card[];
  /** How many of them are face up. */
  flipped: number;
  /** How many have finished turning (the total counts these). */
  revealed: number;
  state: 'idle' | 'live' | 'win' | 'lose' | 'tie';
}) {
  const shown = cards.slice(0, revealed);
  const total = shown.length ? totalOf(shown) : null;
  return (
    <div className={`bc-hand ${who} ${state}`}>
      <div className="bc-hand-head">
        <span className="bc-hand-name">{who === 'player' ? 'Player' : 'Banker'}</span>
        <span className={'bc-total' + (total === null ? ' none' : '')} key={total ?? 'none'}>
          {total ?? '–'}
        </span>
      </div>
      <div className="bc-cards">
        {cards.length === 0 ? (
          <>
            <EmptySlot />
            <EmptySlot />
          </>
        ) : (
          cards.map((c, i) => <PlayingCard key={i} card={c} up={i < flipped} side={i === 2} from={who === 'player' ? 'left' : 'right'} />)
        )}
      </div>
    </div>
  );
}

// ---------- Chips ----------

const CHIP_COLOURS: [number, string][] = [
  [0.5, '#64748b'],
  [1, '#0ea5e9'],
  [5, '#22c55e'],
  [10, '#ef4444'],
  [25, '#f59e0b'],
  [100, '#8b5cf6'],
  [500, '#111827'],
  [Infinity, '#db2777'],
];
export const chipColour = (v: number) => CHIP_COLOURS.find(([lim]) => v < lim - 1e-9)![1];

/** 0.5 → "0.5", 12.5 → "12.5", 2500 → "2.5K". */
export function fmtChip(v: number): string {
  if (v >= 1e6) return `${Number((v / 1e6).toFixed(1))}M`;
  if (v >= 1000) return `${Number((v / 1000).toFixed(v >= 1e4 ? 0 : 1))}K`;
  if (v >= 100) return String(Math.round(v));
  if (v >= 10) return String(Number(v.toFixed(1)));
  return String(Number(v.toFixed(2)));
}

export function ChipDisc({ value, r = 13 }: { value: number; r?: number }) {
  const label = fmtChip(value);
  const fs = label.length <= 2 ? r * 0.8 : label.length === 3 ? r * 0.66 : r * 0.54;
  const e = r - 1.6;
  return (
    <g className="bc-chip">
      <circle r={r} fill={chipColour(value)} />
      <circle r={e} className="edge" strokeDasharray={`${(e * Math.PI) / 6} ${(e * Math.PI) / 6}`} />
      <circle r={r * 0.66} className="face" fill={chipColour(value)} />
      <text dy="0.36em" fontSize={fs}>
        {label}
      </text>
    </g>
  );
}

/** A small stack of chips (up to 3 discs drawn) showing the amount on a spot. */
export function ChipStack({ amount, style }: { amount: number; style?: CSSProperties }) {
  const n = amount >= 25 ? 3 : amount >= 5 ? 2 : 1;
  return (
    <svg className="bc-stack" viewBox="-16 -22 32 38" style={style} aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <g key={i} transform={`translate(0 ${-i * 3})`}>
          <ChipDisc value={amount} r={14} />
        </g>
      ))}
    </svg>
  );
}
