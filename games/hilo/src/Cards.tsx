import { fmtChance, fmtMult } from '@originals/game-sdk/ui';
import { useEffect, useRef, type CSSProperties } from 'react';
import { RANKS, RANK_LABEL, SUIT_GLYPH, guessLabel, isRed, mainPair, winningRanks, type Card, type Guess } from './math';

export interface Shown {
  id: number;
  card: Card;
}

/** A playing card: geometric face, house back. `deal` slides it in from the deck and flips it. */
export function PlayingCard({ card, deal, ms, mini }: { card: Card; deal?: boolean; ms?: number; mini?: boolean }) {
  const rank = RANK_LABEL[card.rank];
  const suit = SUIT_GLYPH[card.suit];
  return (
    <div
      className={'hl-card' + (deal ? ' deal' : '') + (isRed(card.suit) ? ' red' : '') + (mini ? ' mini' : '')}
      style={{ '--deal-ms': `${ms ?? 400}ms` } as CSSProperties}
      aria-label={`${rank} of ${['spades', 'hearts', 'diamonds', 'clubs'][card.suit]}`}
    >
      <div className="hl-flip">
        <div className="hl-face front">
          <span className="hl-corner tl">
            <b>{rank}</b>
            <i>{suit}</i>
          </span>
          <span className="hl-pip">{suit}</span>
          {!mini && <span className="hl-big">{rank}</span>}
          {!mini && (
            <span className="hl-corner br">
              <b>{rank}</b>
              <i>{suit}</i>
            </span>
          )}
        </div>
        <div className="hl-face back" />
      </div>
    </div>
  );
}

/** The face-down deck the next card is dealt from (skipping lives in the panel). */
export function Deck() {
  return (
    <div className="hl-deck" aria-hidden="true">
      <span className="hl-back b3" />
      <span className="hl-back b2" />
      <span className="hl-back b1" />
    </div>
  );
}

/**
 * The rank scale, K at the top and A at the bottom. The left column lights
 * the ranks that win the top call, the right column the ranks that win the
 * bottom call: lit cells ÷ 13 is exactly each call's chance.
 */
export function Ladder({ rank, show }: { rank: number; show: boolean }) {
  const [up, down] = mainPair(rank);
  const upSet = new Set(winningRanks(up, rank));
  const downSet = new Set(winningRanks(down, rank));
  const rows = Array.from({ length: RANKS }, (_, i) => RANKS - i);
  return (
    <div className="hl-ladder" aria-label={`${guessLabel(up, rank)} wins on ${upSet.size} of 13 ranks; ${guessLabel(down, rank)} on ${downSet.size}`}>
      <div className="hl-lad-head up">
        <b>▲</b> {upSet.size}/13
      </div>
      <div className="hl-lad-rows">
        {rows.map((r) => (
          <div key={r} className={'hl-lad-row' + (r === rank && show ? ' cur' : '')}>
            <i className={'u' + (show && upSet.has(r) ? ' on' : '')} />
            <span>{RANK_LABEL[r]}</span>
            <i className={'d' + (show && downSet.has(r) ? ' on' : '')} />
          </div>
        ))}
      </div>
      <div className="hl-lad-head down">
        <b>▼</b> {downSet.size}/13
      </div>
    </div>
  );
}

export interface TrailItem {
  id: number;
  card: Card;
  action: Guess | 'skip' | 'start';
  won: boolean | null;
  cash: number;
}

const ACTION_ICON: Record<TrailItem['action'], string> = { start: 'Start', skip: '↷ Skip', higher: '▲', lower: '▼', same: '=', red: '●', black: '●' };

/** The round's cards in order, with the call that drew each and the cash-out after it. */
export function Trail({ items }: { items: TrailItem[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTo({ left: el.scrollWidth, behavior: 'smooth' });
  }, [items.length]);
  return (
    <div className="hl-trail" ref={ref} aria-label="Cards this round">
      {items.length === 0 && <span className="hl-trail-empty">Cards you draw this round line up here.</span>}
      {items.map((it, i) => {
        const from = i > 0 ? items[i - 1].card.rank : it.card.rank;
        const tone = it.won === null ? 'n' : it.won ? 'w' : 'l';
        return (
          <div key={it.id} className={`hl-trail-item ${tone}`}>
            <span className={`hl-trail-act ${it.action}`} title={it.action === 'start' || it.action === 'skip' ? undefined : guessLabel(it.action, from)}>
              {ACTION_ICON[it.action]}
            </span>
            <PlayingCard card={it.card} mini />
            <span className="hl-trail-cash">{it.won === false ? '✕' : it.action === 'skip' || it.action === 'start' ? (i === 0 ? fmtMult(it.cash) : '—') : fmtMult(it.cash)}</span>
          </div>
        );
      })}
    </div>
  );
}

/** A call button: arrow, label, chance and payout. `compact` for the extended row. */
export function CallButton({
  dir,
  guess,
  rank,
  pays,
  p,
  disabled,
  keyHint,
  onClick,
  title,
  compact,
}: {
  dir: 'up' | 'down' | 'same' | 'red' | 'black';
  guess: Guess;
  rank: number;
  pays: number;
  p: number;
  disabled: boolean;
  keyHint: string;
  onClick(): void;
  title?: string;
  compact?: boolean;
}) {
  const icon = dir === 'up' ? '▲' : dir === 'down' ? '▼' : dir === 'same' ? '=' : '●';
  return (
    <button type="button" className={`hl-call ${dir}` + (compact ? ' compact' : '')} disabled={disabled} onClick={onClick} title={title ?? `${guessLabel(guess, rank)} (${keyHint})`}>
      <span className="hl-call-ico">{icon}</span>
      <span className="hl-call-text">
        <b>{guessLabel(guess, rank)}</b>
        <small>{compact ? fmtMult(pays) : fmtChance(p)}</small>
      </span>
      {!compact && <span className="hl-call-pay">{fmtMult(pays)}</span>}
      {!compact && <kbd>{keyHint}</kbd>}
    </button>
  );
}
