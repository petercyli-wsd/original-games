import { type CSSProperties } from 'react';
import { RANK_LABEL, SUIT_GLYPH, cardName, isRed, rankOf, suitOf, type Card, type Paytable } from './math';

/** One of the five positions on the felt. `v` changes whenever a new card lands, which replays the flip. */
export interface Slot {
  card: Card | null;
  v: number;
  /** Flip delay in ms (for the staggered deal). */
  delay: number;
}

const FACE = new Set([9, 10, 11]);

/** A playing card in the house style: geometric face, indigo lattice back. Null = face down. */
export function PlayingCard({ slot, ms }: { slot: Slot; ms: number }) {
  const c = slot.card;
  if (c === null) {
    return (
      <div className="vp-card down" aria-label="Face-down card">
        <div className="vp-face back" />
      </div>
    );
  }
  const r = rankOf(c);
  const rank = RANK_LABEL[r];
  const suit = SUIT_GLYPH[suitOf(c)];
  return (
    <div
      key={slot.v}
      className={'vp-card deal' + (isRed(c) ? ' red' : '')}
      style={{ '--d': `${slot.delay}ms`, '--ms': `${ms}ms` } as CSSProperties}
      aria-label={cardName(c)}
    >
      <div className="vp-flip">
        <div className="vp-face front">
          <span className="vp-corner tl">
            <b>{rank}</b>
            <i>{suit}</i>
          </span>
          {FACE.has(r) ? (
            <span className="vp-court">
              <span className="vp-court-frame" />
              <b>{rank}</b>
              <i>{suit}</i>
            </span>
          ) : (
            <span className={'vp-pip' + (r === 12 ? ' ace' : '')}>{suit}</span>
          )}
          <span className="vp-corner br">
            <b>{rank}</b>
            <i>{suit}</i>
          </span>
        </div>
        <div className="vp-face back" />
      </div>
    </div>
  );
}

/** Small probabilities read better as "1 in N". */
export function fmtOdds(p: number): string {
  if (!(p > 1e-12)) return '—';
  if (p >= 0.01) return (p * 100).toFixed(p >= 0.1 ? 1 : 2) + '%';
  return `1 in ${Math.round(1 / p).toLocaleString('en-US')}`;
}

/**
 * The paytable, as on every machine: hand, pay, and an odds column that is
 * the exact chance of each hand (best play before the deal; the cards you
 * hold once dealt). `made` marks the hand already in the dealt cards, `hit`
 * the final hand.
 */
export function Paytable({
  table,
  dist,
  oddsLabel,
  made,
  hit,
}: {
  table: Paytable;
  dist: readonly number[];
  oddsLabel: string;
  made: number | null;
  hit: number | null;
}) {
  const rows = table.rows.map((row, i) => ({
    i,
    row,
    pays: table.pays[row.cats[0]],
    p: row.cats.reduce((s, c) => s + dist[c], 0),
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
            <em role="columnheader">{oddsLabel}</em>
          </div>
          {col.map((r) => (
            <div
              key={r.i}
              role="row"
              className={'vp-pay-row' + (r.i === 0 ? ' royal' : '') + (r.made ? ' made' : '') + (r.hit ? ' hit' : '')}
            >
              <span role="cell" title={r.row.label}>
                <i className="full">{r.row.label}</i>
                <i className="short">{r.row.short ?? r.row.label}</i>
              </span>
              <b role="cell">{r.pays}×</b>
              <em role="cell">{fmtOdds(r.p)}</em>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
