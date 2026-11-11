// Playing cards and hands for the baccarat table. Pure presentation:
// the deal itself is decided in math.ts before any card is drawn here.

import { RANK_LABEL, SUIT_LABEL, SUIT_NAME, isRed, totalOf, type Card } from './math';

/** One card: a flat light face with rank and suit as text. `up` turns it face up; `side` lays it sideways (a third card). */
export function PlayingCard({ card, up, side, from }: { card: Card; up: boolean; side?: boolean; from: 'left' | 'right' }) {
  const red = isRed(card);
  const rank = RANK_LABEL[card.rank];
  const suit = SUIT_LABEL[card.suit];
  return (
    <div className={'bc-slot' + (side ? ' side' : '')}>
      <div className={'bc-card ' + from + (up ? ' up' : '')} aria-label={up ? `${rank} of ${SUIT_NAME[card.suit]}` : 'Face-down card'}>
        <div className="bc-card-inner">
          <div className={'bc-face' + (red ? ' red' : '')}>
            <span className="bc-rank">{rank}</span>
            <span className="bc-suit">{suit}</span>
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
  bet,
}: {
  who: 'player' | 'banker';
  /** The cards on this side of the table so far (placed, maybe face down). */
  cards: Card[];
  /** How many of them are face up. */
  flipped: number;
  /** How many of them have finished turning (the total counts these). */
  revealed: number;
  state: 'idle' | 'live' | 'win' | 'lose' | 'tie';
  /** The player has chips on this side: its name takes the accent. */
  bet: boolean;
}) {
  const shown = cards.slice(0, revealed);
  const total = shown.length ? totalOf(shown) : null;
  return (
    <div className={`bc-hand ${who} ${state}` + (bet ? ' bet' : '')}>
      <div className="bc-hand-head">
        <span className="bc-hand-name">{who === 'player' ? 'Player' : 'Banker'}</span>
        <span className={'bc-total' + (total === null ? ' none' : '')}>{total ?? '–'}</span>
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

/** 0.5 → "0.5", 12.5 → "12.5", 2500 → "2.5K". */
export function fmtChip(v: number): string {
  if (v >= 1e6) return `${Number((v / 1e6).toFixed(1))}M`;
  if (v >= 1000) return `${Number((v / 1000).toFixed(v >= 1e4 ? 0 : 1))}K`;
  if (v >= 100) return String(Math.round(v));
  if (v >= 10) return String(Number(v.toFixed(1)));
  return String(Number(v.toFixed(2)));
}
