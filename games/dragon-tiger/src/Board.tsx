import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import {
  BET_BY_ID,
  P_SIDE_WIN,
  P_SUITED,
  P_TIE,
  RANK_LABEL,
  SIDE_KINDS,
  SIDE_NAME,
  SIDE_RULE,
  SUIT_LABEL,
  SUIT_NAME,
  betStats,
  isRed,
  paysLabel,
  type BetDef,
  type Card,
  type Layout,
  type Side,
  type Winner,
} from './math';

// ---------- Emblems (geometric, our own) ----------

/** Dragon: a hexagonal scale with a chevron crest. Tiger: a disc with three stripes. */
export function Emblem({ side, size = 22 }: { side: Side; size?: number }) {
  return side === 'dragon' ? (
    <svg className="dt-emblem dragon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 1.8 21 7v10l-9 5.2L3 17V7z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M7 9.5 12 13l5-3.5M7 13.5l5 3.5 5-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg className="dt-emblem tiger" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M6.5 8.5l4 2M5.5 13l5 0.5M7 17.5l4-2.5M17.5 8.5l-4 2M18.5 13l-5 0.5M17 17.5l-4-2.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

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
          <span className="dt-corner tl">
            <b>{rank}</b>
            <i>{suit}</i>
          </span>
          <span className="dt-pip">{suit}</span>
          <span className="dt-corner br">
            <b>{rank}</b>
            <i>{suit}</i>
          </span>
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
      <div className="dt-seat-head">
        <Emblem side={side} size={20} />
        <span>{side === 'dragon' ? 'Dragon' : 'Tiger'}</span>
      </div>
      <div className="dt-slot">
        <div className="dt-slot-outline">
          <Emblem side={side} size={34} />
        </div>
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

/** The felt: the shoe, the Dragon and Tiger seats and the centre medallion. */
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
    <div className={'dt-felt' + (revealed ? ' revealed' : '') + (revealed && winner ? ` res-${winner}` : '') + (suited && revealed ? ' suited' : '')}>
      <div className="dt-shoe" aria-hidden="true">
        <div className="dt-shoe-card" />
        <span>8 decks</span>
      </div>
      <Slot side="dragon" deal={deal} timing={timing} state={stateOf('dragon')} revealed={revealed} />
      <div className="dt-medal" aria-hidden="true">
        {revealed && winner ? (
          <span key={deal?.id} className={`dt-medal-res ${winner}` + (suited ? ' suited' : '')}>
            {winner === 'tie' ? (suited ? 'Suited tie' : 'Tie') : winner === 'dragon' ? 'Dragon wins' : 'Tiger wins'}
          </span>
        ) : (
          <span className="dt-vs">VS</span>
        )}
      </div>
      <Slot side="tiger" deal={deal} timing={timing} state={stateOf('tiger')} revealed={revealed} />
    </div>
  );
}

/** The three ways a deal can end, drawn at their exact sizes: 192 : 31 : 192 out of 415. */
export function OddsSplit({ winner, suited }: { winner: Winner | null; suited: boolean }) {
  const pct = (p: number) => `${(p * 100).toFixed(2)}%`;
  return (
    <div className={'dt-split' + (winner ? ` res-${winner}` : '')} aria-label="Exact chances: Dragon 46.27%, Tie 7.47%, Tiger 46.27%">
      <div className="dt-split-bar">
        <i className="d" style={{ width: pct(P_SIDE_WIN) }} />
        <i className="t" style={{ width: pct(P_TIE) }}>
          <em className={suited ? 'on' : ''} style={{ width: `${(P_SUITED / P_TIE) * 100}%` }} />
        </i>
        <i className="g" style={{ width: pct(P_SIDE_WIN) }} />
      </div>
      <div className="dt-split-legend">
        <span className="d">
          Dragon <b>{pct(P_SIDE_WIN)}</b>
        </span>
        <span className="t">
          Tie <b>{pct(P_TIE)}</b>
          <small> · suited {pct(P_SUITED)}</small>
        </span>
        <span className="g">
          Tiger <b>{pct(P_SIDE_WIN)}</b>
        </span>
      </div>
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
  onHover(id: string | null): void;
  money(x: number): string;
}

const KEY_HINT: Record<string, string> = { dragon: 'D', tiger: 'T', tie: 'E', suited: 'S' };

export function Table({ layout, hits, halves, paid, disabled, onAdd, onRemove, onHover, money }: TableProps) {
  const cell = (bet: BetDef, body: ReactNode, extra = '') => {
    const amt = layout[bet.id] ?? 0;
    const hit = !!hits?.has(bet.id);
    const half = !!halves?.has(bet.id);
    const won = hit && amt > 0 && !half;
    const lost = !!hits && amt > 0 && !hit;
    const s = betStats(bet.id);
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
          (bet.side ? ` s-${bet.side}` : '') +
          extra +
          (amt > 0 ? ' placed' : '') +
          (hit && !half ? ' hit' : '') +
          (half ? ' half' : '') +
          (won ? ' won' : '') +
          (lost ? ' lost' : '')
        }
        disabled={disabled}
        aria-label={`${bet.name}, pays ${paysLabel(bet)}, wins ${(s.chance * 100).toFixed(2)}%${amt > 0 ? `, ${money(amt)} placed` : ''}`}
        onClick={(e) => (e.shiftKey ? remove(e) : onAdd(bet.id))}
        onContextMenu={remove}
        onMouseEnter={() => onHover(bet.id)}
        onFocus={() => onHover(bet.id)}
      >
        {body}
        {KEY_HINT[bet.id] && <kbd className="dt-key">{KEY_HINT[bet.id]}</kbd>}
        <i className="dt-odds" style={{ width: `${s.chance * 100}%` }} aria-hidden="true" />
        {amt > 0 && (
          <span key={amt} className={`dt-chip ${chipTier(amt)}`}>
            {chipText(amt)}
          </span>
        )}
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
        <Emblem side={side} size={26} />
        <b className="dt-main-word">{b.name}</b>
        <span className="dt-sub">
          pays 1:1 <em>tie ½ back</em>
        </span>
        <span className="dt-pct">{(betStats(side).chance * 100).toFixed(2)}%</span>
      </span>,
      ' main',
    );
  };

  const sides = (side: Side) => (
    <div className={`dt-sides ${side}`} role="group" aria-label={`${side === 'dragon' ? 'Dragon' : 'Tiger'} card side bets`}>
      <div className="dt-sides-head">
        <Emblem side={side} size={13} />
        {side === 'dragon' ? 'Dragon card' : 'Tiger card'}
      </div>
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
    <div className={'dt-table' + (hits ? ' resolved' : '')} onMouseLeave={() => onHover(null)}>
      <div className="dt-mains">
        {main('dragon')}
        <div className="dt-ties">
          {cell(
            BET_BY_ID.tie,
            <span className="dt-tie-body">
              <b className="dt-tie-word">Tie</b>
              <span className="dt-sub">pays 8:1</span>
              <span className="dt-pct">{(betStats('tie').chance * 100).toFixed(2)}%</span>
            </span>,
          )}
          {cell(
            BET_BY_ID.suited,
            <span className="dt-tie-body">
              <b className="dt-tie-word suited">Suited tie</b>
              <span className="dt-sub">pays 50:1</span>
              <span className="dt-pct">{(betStats('suited').chance * 100).toFixed(2)}%</span>
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

// ---------- Road ----------

export interface RoadItem {
  id: number;
  winner: Winner;
  suited: boolean;
  label: string;
}

const ROWS = 6;

/** A bead plate: results fill columns of six, oldest on the left. */
export function Road({ items }: { items: RoadItem[] }) {
  // Each deal keeps its place: column and row come from its sequence number, so columns shift whole.
  const byCol = new Map<number, RoadItem[]>();
  for (const r of [...items].reverse()) {
    const c = Math.floor((r.id - 1) / ROWS);
    byCol.set(c, [...(byCol.get(c) ?? []), r]);
  }
  const cols = [...byCol.entries()];
  const counts = { dragon: 0, tiger: 0, tie: 0 };
  for (const r of items) counts[r.winner]++;
  return (
    <div className="dt-road">
      <div className="dt-road-head">
        <span>Bead road</span>
        <div className="dt-road-counts" title={`Last ${items.length} deals`}>
          <span className="d">
            <i />D {counts.dragon}
          </span>
          <span className="g">
            <i />T {counts.tiger}
          </span>
          <span className="t">
            <i />
            Tie {counts.tie}
          </span>
        </div>
      </div>
      <div className="dt-beads" aria-label="Recent results, oldest first">
        {items.length === 0 && <span className="dt-none">No deals yet: results collect here in columns of six.</span>}
        {cols.map(([ci, c]) => (
          <div key={ci} className="dt-bead-col">
            {c.map((r) => (
              <span key={r.id} className={`dt-bead ${r.winner}` + (r.suited ? ' suited' : '')} title={r.label} style={{ gridRow: ((r.id - 1) % ROWS) + 1 }}>
                {r.winner === 'dragon' ? 'D' : r.winner === 'tiger' ? 'T' : '='}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
