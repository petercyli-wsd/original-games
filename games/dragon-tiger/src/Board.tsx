import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import {
  BET_BY_ID,
  RANK_LABEL,
  SIDE_KINDS,
  SIDE_NAME,
  SIDE_RULE,
  SUIT_LABEL,
  SUIT_NAME,
  isRed,
  paysLabel,
  type BetDef,
  type Card,
  type Layout,
  type Side,
  type Winner,
} from './math';

// ---------- Cards ----------

export interface DealView {
  id: number;
  dragon: Card;
  tiger: Card;
}

export interface Timing {
  deal: number;
  flip: number;
  /** Start of Tiger's deal, Dragon's flip and Tiger's flip. */
  tigerAt: number;
  dragonFlipAt: number;
  tigerFlipAt: number;
}

function PlayingCard({ card, side, dealAt, flipAt, t }: { card: Card; side: Side; dealAt: number; flipAt: number; t: Timing }) {
  const red = isRed(card);
  const rank = RANK_LABEL[card.rank];
  const suit = SUIT_LABEL[card.suit];
  return (
    <div
      className={`dt-card ${side}` + (red ? ' red' : '')}
      style={{ '--d': `${dealAt}ms`, '--fd': `${flipAt}ms`, '--deal': `${t.deal}ms`, '--flip': `${t.flip}ms` } as CSSProperties}
      role="img"
      aria-label={`${side === 'dragon' ? 'Dragon' : 'Tiger'}: ${rank} of ${SUIT_NAME[card.suit]}`}
    >
      <div className="dt-card-inner">
        <div className="dt-face">
          <span className="dt-rank-text">{rank}</span>
          <span className="dt-suit-text">{suit}</span>
        </div>
        <div className="dt-back" />
      </div>
    </div>
  );
}

function Slot({ side, deal, timing, state, revealed }: { side: Side; deal: DealView | null; timing: Timing; state: string; revealed: boolean }) {
  const card = deal ? deal[side] : null;
  return (
    <div className={`dt-seat ${side} ${state}`}>
      <div className="dt-seat-head">{side === 'dragon' ? 'Dragon' : 'Tiger'}</div>
      <div className="dt-slot">
        <div className="dt-slot-outline" />
        {deal && card && (
          <PlayingCard
            key={deal.id}
            card={card}
            side={side}
            t={timing}
            dealAt={side === 'dragon' ? 0 : timing.tigerAt}
            flipAt={side === 'dragon' ? timing.dragonFlipAt : timing.tigerFlipAt}
          />
        )}
      </div>
      <div className={'dt-rank' + (card && revealed ? ' on' : '')}>
        {card && revealed ? (
          <>
            <b>{RANK_LABEL[card.rank]}</b>
            <span>= {card.rank}</span>
          </>
        ) : (
          <span>{deal ? 'Dealing…' : 'A low · K high'}</span>
        )}
      </div>
    </div>
  );
}

/** The felt: the Dragon and Tiger seats with the verdict between them. */
export function Felt({
  deal,
  timing,
  revealed,
  winner,
  suited,
}: {
  deal: DealView | null;
  timing: Timing;
  /** Both cards are face up and the round is settled. */
  revealed: boolean;
  winner: Winner | null;
  suited: boolean;
}) {
  const stateOf = (s: Side) => (!revealed || !winner ? '' : winner === 'tie' ? 'tied' : winner === s ? 'winner' : 'loser');
  return (
    <div className={'dt-felt' + (revealed ? ' revealed' : '') + (revealed && winner ? ` res-${winner}` : '')}>
      <Slot side="dragon" deal={deal} timing={timing} state={stateOf('dragon')} revealed={revealed} />
      <div className="dt-medal" aria-hidden="true">
        {revealed && winner ? (
          <span key={deal?.id} className="dt-medal-res">
            {winner === 'tie' ? (suited ? 'Suited tie' : 'Tie') : winner === 'dragon' ? 'Dragon wins' : 'Tiger wins'}
          </span>
        ) : (
          <span className="dt-vs">vs</span>
        )}
      </div>
      <Slot side="tiger" deal={deal} timing={timing} state={stateOf('tiger')} revealed={revealed} />
    </div>
  );
}

// ---------- Betting table ----------

const CHIP_STEPS = [0.1, 1, 5, 25, 100];
export const chipTier = (amt: number) => {
  let t = 1;
  CHIP_STEPS.forEach((v, i) => {
    if (amt >= v - 1e-9) t = i + 1;
  });
  return `t${t}`;
};
export const chipText = (amt: number) =>
  amt >= 1e6 ? `${+(amt / 1e6).toFixed(1)}M` : amt >= 1e3 ? `${+(amt / 1e3).toFixed(1)}k` : amt >= 100 ? amt.toFixed(0) : amt >= 10 ? `${+amt.toFixed(1)}` : `${+amt.toFixed(2)}`;

interface TableProps {
  layout: Layout;
  /** Bets that paid this round (null while no result is shown). */
  hits: Set<string> | null;
  /** Bets that came back as half (Dragon / Tiger on a tie). */
  halves: Set<string> | null;
  paid: Record<string, number>;
  disabled: boolean;
  onAdd(id: string): void;
  onRemove(id: string): void;
  money(x: number): string;
}

export function Table({ layout, hits, halves, paid, disabled, onAdd, onRemove, money }: TableProps) {
  const cell = (bet: BetDef, body: ReactNode, extra = '') => {
    const amt = layout[bet.id] ?? 0;
    const hit = !!hits?.has(bet.id);
    const half = !!halves?.has(bet.id);
    const won = hit && amt > 0 && !half;
    const lost = !!hits && amt > 0 && !hit;
    const remove = (e: MouseEvent) => {
      e.preventDefault();
      if (!disabled) onRemove(bet.id);
    };
    return (
      <button
        key={bet.id}
        type="button"
        data-bet={bet.id}
        className={
          `dt-cell k-${bet.kind}` +
          extra +
          (amt > 0 ? ' placed' : '') +
          (hit && !half ? ' hit' : '') +
          (half ? ' half' : '') +
          (won ? ' won' : '') +
          (lost ? ' lost' : '')
        }
        disabled={disabled}
        aria-label={`${bet.name}, pays ${paysLabel(bet)}${amt > 0 ? `, ${money(amt)} placed` : ''}`}
        onClick={(e) => (e.shiftKey ? remove(e) : onAdd(bet.id))}
        onContextMenu={remove}
      >
        {body}
        {amt > 0 && <span className="dt-chip">{chipText(amt)}</span>}
        {won && <span className="dt-paid">+{money(Math.max(0, (paid[bet.id] ?? 0) - amt))}</span>}
        {half && amt > 0 && <span className="dt-paid half">{money(paid[bet.id] ?? 0)} back</span>}
      </button>
    );
  };

  const main = (side: Side) => {
    const b = BET_BY_ID[side];
    return cell(
      b,
      <span className="dt-main-body">
        <b className="dt-main-word">{b.name}</b>
        <span className="dt-sub">pays 1:1</span>
      </span>,
      ' main',
    );
  };

  const sides = (side: Side) => (
    <div className={`dt-sides ${side}`} role="group" aria-label={`${side === 'dragon' ? 'Dragon' : 'Tiger'} card side bets`}>
      <div className="dt-sides-head">{side === 'dragon' ? 'Dragon card' : 'Tiger card'}</div>
      <div className="dt-sides-grid">
        {SIDE_KINDS.map((k) =>
          cell(
            BET_BY_ID[`${side}-${k}`],
            <span className="dt-side-body">
              <b className={`dt-side-word k-${k}`}>{SIDE_NAME[k]}</b>
              <span className="dt-sub">{SIDE_RULE[k]}</span>
            </span>,
          ),
        )}
      </div>
    </div>
  );

  return (
    <div className={'dt-table' + (hits ? ' resolved' : '')}>
      <div className="dt-mains">
        {main('dragon')}
        <div className="dt-ties">
          {cell(
            BET_BY_ID.tie,
            <span className="dt-tie-body">
              <b className="dt-tie-word">Tie</b>
              <span className="dt-sub">pays 8:1</span>
            </span>,
          )}
          {cell(
            BET_BY_ID.suited,
            <span className="dt-tie-body">
              <b className="dt-tie-word">Suited tie</b>
              <span className="dt-sub">pays 50:1</span>
            </span>,
          )}
        </div>
        {main('tiger')}
      </div>
      <div className="dt-side-row">
        {sides('dragon')}
        <div className="dt-seven" title="A 7 on that card loses every side bet">
          <b>7</b>
          <span>loses side bets</span>
        </div>
        {sides('tiger')}
      </div>
    </div>
  );
}
