import type { CSSProperties, ReactNode } from 'react';
import { formatAmount } from '@originals/game-sdk';
import {
  PAIRS_NAME,
  RANK_LABEL,
  SUIT_LABEL,
  TRIPS_NAME,
  handTotal,
  isBlackjack,
  isRed,
  totalLabel,
  type Action,
  type Card,
  type HandResult,
  type PairsKind,
  type Table as TableState,
  type TripsKind,
} from './math';

export function PlayingCard({ card, faceUp, dealtUp, delay, from }: { card: Card; faceUp: boolean; dealtUp: boolean; delay: number; from: 'dealer' | 'player' }) {
  const red = isRed(card.suit);
  const rank = RANK_LABEL[card.rank];
  const suit = SUIT_LABEL[card.suit];
  return (
    <div
      className={`bj-card ${from} ${faceUp ? 'up' : 'down'}${dealtUp ? ' flip-in' : ''}`}
      style={{ '--d': `${delay}ms` } as CSSProperties}
      aria-label={faceUp ? `${rank}${suit}` : 'face-down card'}
      data-hidden={faceUp ? undefined : ''}
    >
      <div className="bj-card-inner">
        {/* A face-down card carries no face at all, so the hole card can't be read from the page. */}
        <div className={'bj-face' + (red && faceUp ? ' red' : '')}>
          {faceUp && (
            <>
              <span className="bj-corner tl">
                <b>{rank}</b>
                <i>{suit}</i>
              </span>
              <span className="bj-pip">{suit}</span>
              <span className="bj-corner br">
                <b>{rank}</b>
                <i>{suit}</i>
              </span>
            </>
          )}
        </div>
        <div className="bj-back" />
      </div>
    </div>
  );
}

export interface HandView {
  result: HandResult;
  mult: number;
}

export interface TableView {
  id: number;
  t: TableState;
  dealerShown: number;
  holeUp: boolean;
  base: number;
  pairs: number;
  trips: number;
  pairsWin: PairsKind | null;
  tripsWin: TripsKind | null;
  sidesShown: boolean;
  results: HandView[] | null;
  live: boolean;
}

const RESULT_LABEL: Record<HandResult, string> = { blackjack: 'Blackjack', win: 'Win', push: 'Push', lose: 'Lose', bust: 'Bust' };

/** Deal order of the first four cards: player, dealer up, player, dealer hole. */
const DEAL_ORDER = { p0: 0, d0: 1, p1: 2, d1: 3 } as Record<string, number>;

export default function Table({
  view,
  preview,
  hint,
  dealMs,
  flipMs,
  mid,
}: {
  view: TableView | null;
  preview: { base: number; pairs: number; trips: number };
  hint: Action | null;
  dealMs: number;
  flipMs: number;
  mid: ReactNode;
}) {
  const style = { '--deal-ms': `${dealMs}ms`, '--flip-ms': `${flipMs}ms` } as CSSProperties;
  const t = view?.t;
  const dealerCards = t ? t.dealer.slice(0, view!.dealerShown) : [];
  // Soft totals read "7/17" while a hand can still draw; a finished hand shows its one total.
  const dealerTotal = !t ? null : view!.results ? String(handTotal(dealerCards).total) : view!.holeUp ? totalLabel(dealerCards) : totalLabel([t.dealer[0]]);
  const dealerBJ = !!t && view!.holeUp && dealerCards.length === 2 && handTotal(dealerCards).total === 21;
  const dealerBust = !!t && view!.holeUp && handTotal(dealerCards).hard > 21;
  const stakes = view ?? preview;

  return (
    <div className="bj-table" style={style}>
      <div className="bj-shoe" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>

      <div className="bj-zone dealer" aria-label="Dealer">
        <span className="bj-zone-label">Dealer</span>
        <div className="bj-hand">
          <div className="bj-cards">
            {t ? (
              dealerCards.map((c, i) => (
                <PlayingCard
                  key={`${view!.id}-d${i}`}
                  card={c}
                  from="dealer"
                  faceUp={i !== 1 || view!.holeUp}
                  dealtUp={i !== 1}
                  delay={i < 2 ? DEAL_ORDER[`d${i}`] * dealMs : 0}
                />
              ))
            ) : (
              <>
                <div className="bj-slot" />
                <div className="bj-slot" />
              </>
            )}
            {dealerTotal && (
              <span className={'bj-total' + (dealerBJ ? ' bj' : dealerBust ? ' bust' : '')} key={view!.holeUp ? 'open' : 'up'}>
                {dealerBJ ? 'BJ' : dealerTotal}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="bj-mid">
        <svg viewBox="0 0 600 110" className="bj-arc" aria-hidden="true">
          <path id="bj-arc-a" d="M 60 18 Q 300 108 540 18" fill="none" />
          <path id="bj-arc-b" d="M 40 40 Q 300 134 560 40" fill="none" />
          <path d="M 30 6 Q 300 112 570 6" className="bj-arc-line" />
          <text className="bj-arc-big">
            <textPath href="#bj-arc-a" startOffset="50%">
              BLACKJACK PAYS 3 TO 2
            </textPath>
          </text>
          <text className="bj-arc-small">
            <textPath href="#bj-arc-b" startOffset="50%">
              DEALER STANDS ON SOFT 17 · INSURANCE PAYS 2 TO 1
            </textPath>
          </text>
        </svg>
        {mid}
      </div>

      <div className="bj-zone player" aria-label="Your hands">
        <div className={'bj-hands' + ((t?.hands.length ?? 1) > 1 ? ' split' : '')}>
          {t ? (
            t.hands.map((h, hi) => {
              const res = view!.results?.[hi];
              const active = view!.live && hi === t.active && !h.done;
              const tot = h.done || res ? String(handTotal(h.cards).total) : totalLabel(h.cards);
              const bust = handTotal(h.cards).hard > 21;
              const bj = isBlackjack(h);
              const units = h.doubled ? 2 : 1;
              return (
                <div key={hi} className={'bj-hand' + (active ? ' active' : '') + (res ? ` r-${res.result}` : '')}>
                  <div className="bj-cards">
                    {h.cards.map((c, ci) => (
                      <PlayingCard
                        key={`${view!.id}-h${hi}-${ci}-${c.rank}-${c.suit}`}
                        card={c}
                        from="player"
                        faceUp
                        dealtUp
                        delay={t.hands.length === 1 && ci < 2 ? DEAL_ORDER[`p${ci}`] * dealMs : 0}
                      />
                    ))}
                    <span className={'bj-total' + (bj ? ' bj' : bust ? ' bust' : tot === '21' ? ' good' : '')}>{bj ? 'BJ' : tot}</span>
                    {h.doubled && <span className="bj-doubled">2×</span>}
                  </div>
                  <div className="bj-hand-foot">
                    <span className="bj-chip" title="Stake on this hand">
                      {formatAmount(view!.base * units, 2)}
                    </span>
                    {res ? (
                      <span className={`bj-result ${res.result}`}>
                        {RESULT_LABEL[res.result]}
                        {res.mult > 0 && <b> {res.mult}×</b>}
                      </span>
                    ) : active && hint ? (
                      <span className="bj-hint">
                        Strategy: <b>{hint === 'split' ? 'Split' : hint[0].toUpperCase() + hint.slice(1)}</b>
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="bj-hand">
              <div className="bj-cards">
                <div className="bj-slot" />
                <div className="bj-slot" />
              </div>
              <div className="bj-hand-foot">
                <span className="bj-chip">{formatAmount(preview.base, 2)}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="bj-sides">
        <SideSpot
          name="Pairs"
          amount={stakes.pairs}
          win={view && view.sidesShown && view.pairs > 0 ? (view.pairsWin ? PAIRS_NAME[view.pairsWin] : null) : undefined}
          mult={view?.pairsWin ? { perfect: 26, coloured: 13, mixed: 6 }[view.pairsWin] : 0}
        />
        <SideSpot
          name="21+3"
          amount={stakes.trips}
          win={view && view.sidesShown && view.trips > 0 ? (view.tripsWin ? TRIPS_NAME[view.tripsWin] : null) : undefined}
          mult={view?.tripsWin ? { 'suited-trips': 101, 'straight-flush': 41, trips: 31, straight: 11, flush: 6 }[view.tripsWin] : 0}
        />
      </div>
    </div>
  );
}

/** A side-bet spot: its stake, then won (with the hand) or lost once the cards are out. */
function SideSpot({ name, amount, win, mult }: { name: string; amount: number; win: string | null | undefined; mult: number }) {
  const state = amount <= 0 ? 'off' : win === undefined ? 'on' : win ? 'won' : 'lost';
  return (
    <div className={`bj-side ${state}`}>
      <span className="bj-side-ring">{name}</span>
      <span className="bj-side-text">
        {state === 'off' ? 'No bet' : state === 'won' ? `${win} · ${mult}×` : state === 'lost' ? 'No win' : formatAmount(amount, 2)}
      </span>
    </div>
  );
}
