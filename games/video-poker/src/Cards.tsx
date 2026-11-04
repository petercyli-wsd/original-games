import { type CSSProperties } from 'react';
import { RANK_LABEL, SUIT_GLYPH, cardName, isRed, rankOf, suitOf, type Card, type Paytable } from './math';

/** One of the five positions on the table. `v` changes whenever a new card lands, which replays the flip. */
export interface Slot {
  card: Card | null;
  v: number;
  /** Flip delay in ms (for the staggered deal). */
  delay: number;
}

/** A flat playing card: light face with the rank and suit as text. Null = face down. */
export function PlayingCard({ slot, ms }: { slot: Slot; ms: number }) {
  const c = slot.card;
  if (c === null) {
    return (
      <div className="vp-card down" aria-label="Face-down card">
        <div className="vp-face back" />
      </div>
    );
  }
  return (
    <div
      key={slot.v}
      className={'vp-card deal' + (isRed(c) ? ' red' : '')}
      style={{ '--d': `${slot.delay}ms`, '--ms': `${ms}ms` } as CSSProperties}
      aria-label={cardName(c)}
    >
      <div className="vp-flip">
        <div className="vp-face front">
          <b>{RANK_LABEL[rankOf(c)]}</b>
          <i>{SUIT_GLYPH[suitOf(c)]}</i>
        </div>
        <div className="vp-face back" />
      </div>
    </div>
  );
}

/**
 * The paytable, as a plain table: hand and pay. `made` marks the hand already
 * in the dealt cards (neutral), `hit` the final paying hand (win).
 */
export function Paytable({ table, made, hit }: { table: Paytable; made: number | null; hit: number | null }) {
  const rows = table.rows.map((row, i) => ({
    i,
    row,
    pays: table.pays[row.cats[0]],
    made: made !== null && row.cats.includes(made),
    hit: hit !== null && row.cats.includes(hit),
  }));
  const half = Math.ceil(rows.length / 2);
  const cols = [rows.slice(0, half), rows.slice(half)];
  return (
    <div className="vp-pay" role="table" aria-label={`${table.name} paytable`}>
      {cols.map((col, k) => (
        <div className="vp-pay-col" key={k} role="rowgroup">
          <div className="vp-pay-row head" role="row">
            <span role="columnheader">Hand</span>
            <b role="columnheader">Pays</b>
          </div>
          {col.map((r) => (
            <div key={r.i} role="row" className={'vp-pay-row' + (r.made ? ' made' : '') + (r.hit ? ' hit' : '')}>
              <span role="cell" title={r.row.label}>
                <i className="full">{r.row.label}</i>
                <i className="short">{r.row.short ?? r.row.label}</i>
              </span>
              <b role="cell">{r.pays}×</b>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
