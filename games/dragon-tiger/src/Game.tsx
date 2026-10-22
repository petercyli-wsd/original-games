import { formatAmount } from '@originals/game-sdk';
import { useBalance, useHost } from '@originals/game-sdk/react';
import {
  ActionButton,
  AutoBetControls,
  Board,
  GameLayout,
  InfoModal,
  InfoSection,
  InstantResult,
  Label,
  ModeTabs,
  PanelFoot,
  StageTop,
  VolBadge,
  fmtChance,
  fmtMult,
  useAutoBet,
  useBetInput,
  useHistory,
  useHotkeys,
  useTicket,
  useTimers,
  useTurbo,
  type BetInput,
} from '@originals/game-sdk/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Felt, OddsSplit, Road, Table, type DealView, type RoadItem, type Timing } from './Board';
import {
  BETS,
  BET_BY_ID,
  MAX_MULTIPLIER,
  P_SUITED,
  P_TIE,
  RTP,
  SIDE_KINDS,
  SIDE_NAME,
  SIDE_RULE,
  betStats,
  cardLabel,
  deal as dealCards,
  isSuitedTie,
  layoutStats,
  placedIds,
  returnOf,
  scaleLayout,
  settle,
  totalOf,
  volatilityOf,
  winnerOf,
  type Card,
  type Layout,
  type Winner,
} from './math';

const ACCENT = '#f97316';
const CHIP_VALUES = [0.1, 1, 5, 25, 100];
const KEY_OF: Record<string, string> = { d: 'dragon', t: 'tiger', e: 'tie', s: 'suited' };

const cents = (x: number) => Math.round(x * 100) / 100;
const money = (x: number) => formatAmount(x, 2);
const pct = (x: number) => `${(x * 100).toFixed(2)}%`;

interface Last {
  id: number;
  dragon: Card;
  tiger: Card;
  winner: Winner;
  suited: boolean;
  layout: Layout;
  winners: string[];
  paid: number;
  multiplier: number;
  stake: number;
}

function typing(e: KeyboardEvent) {
  const t = e.composedPath()[0] as HTMLElement | undefined;
  if (!t || !t.tagName) return false;
  if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return true;
  return t.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes((t as HTMLInputElement).type);
}

const timingFor = (turbo: boolean): Timing => {
  const k = turbo ? 0.25 : 1;
  return { deal: 300 * k, flip: 340 * k, tigerAt: 300 * k, dragonFlipAt: 680 * k, tigerFlipAt: 1060 * k };
};

const describeDeal = (l: Last) =>
  l.winner === 'tie'
    ? `${l.suited ? 'Suited tie' : 'Tie'} · ${cardLabel(l.dragon)} and ${cardLabel(l.tiger)}`
    : l.winner === 'dragon'
      ? `Dragon wins · ${cardLabel(l.dragon)} beats ${cardLabel(l.tiger)}`
      : `Tiger wins · ${cardLabel(l.tiger)} beats ${cardLabel(l.dragon)}`;

export default function Game() {
  const { rng } = useHost();
  const balance = useBalance();
  const chip = useBetInput(1);
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);

  const [layout, setLayoutState] = useState<Layout>({});
  const [undoStack, setUndoStack] = useState<Layout[]>([]);
  const [rebetLayout, setRebetLayout] = useState<Layout | null>(null);
  const [dealing, setDealing] = useState(false);
  const [dealView, setDealView] = useState<DealView | null>(null);
  const [last, setLast] = useState<Last | null>(null);
  const [road, setRoad] = useState<RoadItem[]>([]);
  const [hover, setHover] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const seq = useRef(0);

  // The layout auto-bet scales (on win / on loss), and the one the player built.
  const layoutRef = useRef(layout);
  const baseRef = useRef(layout);

  const resolved = useRef(0);
  const ticket = useTicket(() => (dealing ? resolved.current : 0));

  const total = totalOf(layout);
  const stats = useMemo(() => layoutStats(layout), [layout]);
  const timing = timingFor(turbo.turbo);
  const roundMs = timing.tigerFlipAt + timing.flip + (turbo.turbo ? 20 : 80);

  // ---------- Layout editing ----------
  /** Any change to the chips after a round clears the cards and the result off the table. */
  function clearBoard() {
    setLast(null);
    setDealView(null);
  }
  function commit(next: Layout) {
    setUndoStack((u) => [...u.slice(-79), layoutRef.current]);
    layoutRef.current = next;
    baseRef.current = next;
    setLayoutState(next);
    clearBoard();
  }
  const addChip = (id: string) => {
    if (!(chip.value > 0)) return;
    commit({ ...layoutRef.current, [id]: cents((layoutRef.current[id] ?? 0) + chip.value) });
  };
  const removeChip = (id: string) => {
    const cur = layoutRef.current[id] ?? 0;
    if (cur <= 0) return;
    const next = { ...layoutRef.current };
    const v = cents(cur - chip.value);
    if (v > 0) next[id] = v;
    else delete next[id];
    commit(next);
  };
  const scaleAll = (f: number) => {
    const cur = layoutRef.current;
    if (totalOf(cur) <= 0) return;
    const next: Layout = {};
    for (const id of placedIds(cur)) next[id] = Math.max(0.01, cents(cur[id] * f));
    commit(next);
  };
  const clearAll = () => {
    if (totalOf(layoutRef.current) > 0) commit({});
  };
  const rebet = () => {
    if (rebetLayout && totalOf(rebetLayout) > 0) commit({ ...rebetLayout });
  };
  const undo = () => {
    if (!undoStack.length) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack((u) => u.slice(0, -1));
    layoutRef.current = prev;
    baseRef.current = prev;
    setLayoutState(prev);
    clearBoard();
  };

  // ---------- One deal ----------
  async function playOnce(stake: number): Promise<number | null> {
    let lay = layoutRef.current;
    if (Math.abs(totalOf(lay) - stake) > 0.005) {
      lay = scaleLayout(baseRef.current, stake);
      layoutRef.current = lay;
      setLayoutState(lay);
    }
    const t = totalOf(lay);
    if (!(t > 0)) return null;
    if (!(await ticket.place(t))) return null;

    // The cards are drawn the moment the bet is placed; the deal only shows them.
    const { dragon, tiger } = dealCards(rng.next(), rng.next());
    const res = settle(lay, dragon, tiger);
    resolved.current = res.multiplier;
    const id = ++seq.current;

    setLast(null);
    setDealing(true);
    setDealView({ id, dragon, tiger });
    await timers.wait(roundMs);
    ticket.settle(res.multiplier);
    const winner = winnerOf(dragon, tiger);
    const suited = isSuitedTie(dragon, tiger);
    const result: Last = { id, dragon, tiger, winner, suited, layout: lay, winners: res.winners, paid: res.paid, multiplier: res.multiplier, stake: t };
    setRebetLayout(lay);
    setLast(result);
    setRoad((r) => [{ id, winner, suited, label: describeDeal(result) }, ...r].slice(0, 96));
    pushHistory(res.multiplier);
    setDealing(false);
    return res.multiplier;
  }

  // Auto-bet scales the whole layout: its "bet" is the layout's total.
  const layoutBet: BetInput = {
    text: money(total),
    value: total,
    blocked: !(total > 0) ? 'Place chips on the table first' : total > balance + 1e-9 ? 'Not enough balance' : undefined,
    setText: (text: string) => {
      const v = Number(text);
      if (!(v > 0)) return;
      const next = scaleLayout(baseRef.current, v);
      layoutRef.current = next;
      setLayoutState(next);
    },
    half: () => scaleAll(0.5),
    double: () => scaleAll(2),
    normalize: () => {},
  };
  const auto = useAutoBet({ bet: layoutBet, play: playOnce, turbo: turbo.turbo });
  const busy = dealing || auto.running;
  const canBet = !busy && !layoutBet.blocked;

  const bet = () => {
    if (auto.mode === 'manual' && canBet) void playOnce(total);
  };
  useHotkeys({ space: bet }, !infoOpen);

  // Letter shortcuts: D/T/E/S add a chip (Shift removes), Z undo, X clear, [ ] halve / double, R rebet, 1–5 chip value.
  const keys = useRef({ addChip, removeChip, undo, clearAll, scaleAll, rebet, busy, setChip: (v: number) => chip.setText(money(v)) });
  keys.current = { addChip, removeChip, undo, clearAll, scaleAll, rebet, busy, setChip: (v: number) => chip.setText(money(v)) };
  useEffect(() => {
    if (infoOpen) return;
    const onDown = (e: KeyboardEvent) => {
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const h = keys.current;
      if (h.busy) return;
      const key = e.key.toLowerCase();
      const id = KEY_OF[key];
      if (id) e.shiftKey ? h.removeChip(id) : h.addChip(id);
      else if (key === 'z' || e.key === 'Backspace') h.undo();
      else if (key === 'x') h.clearAll();
      else if (e.key === ']') h.scaleAll(2);
      else if (e.key === '[') h.scaleAll(0.5);
      else if (key === 'r') h.rebet();
      else if (/^[1-5]$/.test(e.key)) h.setChip(CHIP_VALUES[Number(e.key) - 1]);
    };
    window.addEventListener('keydown', onDown);
    return () => window.removeEventListener('keydown', onDown);
  }, [infoOpen]);

  // ---------- Derived display ----------
  const revealed = !!last && !dealing && dealView?.id === last.id;
  const shown = last?.layout ?? layout;
  const hits = useMemo(() => {
    if (!revealed || !last) return null;
    return new Set(BETS.filter((b) => returnOf(b, last.dragon, last.tiger) > 0).map((b) => b.id));
  }, [revealed, last]);
  const halves = useMemo(() => (revealed && last?.winner === 'tie' ? new Set(['dragon', 'tiger']) : null), [revealed, last]);
  const paidBy = useMemo(() => {
    const out: Record<string, number> = {};
    if (last) for (const id of last.winners) out[id] = cents(last.layout[id] * returnOf(BET_BY_ID[id], last.dragon, last.tiger));
    return out;
  }, [last]);

  const vol = volatilityOf(stats.sd);
  const status = dealing ? 'Dealing…' : last ? describeDeal(last) : total > 0 ? `Total bet ${money(total)} · press Bet` : 'Place chips on Dragon, Tiger or Tie';

  const hb = hover ? BET_BY_ID[hover] : null;
  const hs = hb ? betStats(hb.id) : null;
  const hoverNote = (id: string) => {
    const b = BET_BY_ID[id];
    if (b.kind === 'main') return ` · a tie (${pct(P_TIE)}) returns half your chip`;
    if (b.kind === 'tie') return ' · any two cards of equal rank';
    if (b.kind === 'suited') return ' · same rank and same suit';
    return ` · ${SIDE_RULE[b.kind as keyof typeof SIDE_RULE]} on the ${b.side === 'dragon' ? 'Dragon' : 'Tiger'} card, a 7 loses`;
  };

  return (
    <GameLayout
      name="Dragon Tiger"
      accent={ACCENT}
      className="dt-game"
      panel={
        <>
          <ModeTabs auto={auto} disabled={dealing} />

          <Label hint={`Balance ${money(balance)}`}>Chip value</Label>
          <div className="og-bet-row">
            <input value={chip.text} inputMode="decimal" aria-label="Chip value" disabled={busy} onChange={(e) => chip.setText(e.target.value)} onBlur={chip.normalize} />
            <button type="button" disabled={busy} onClick={chip.half} aria-label="Halve chip">
              ½
            </button>
            <button type="button" disabled={busy} onClick={chip.double} aria-label="Double chip">
              2×
            </button>
          </div>
          <div className="dt-denoms" role="group" aria-label="Chip presets">
            {CHIP_VALUES.map((v, i) => (
              <button
                key={v}
                type="button"
                className={`dt-denom t${i + 1}` + (Math.abs(chip.value - v) < 1e-9 ? ' on' : '')}
                disabled={busy}
                onClick={() => chip.setText(money(v))}
                title={`Chip ${money(v)} (key ${i + 1})`}
              >
                {v < 1 ? v.toFixed(1) : v}
              </button>
            ))}
          </div>

          <Label hint={total > 0 ? <VolBadge level={vol} /> : undefined}>Your chips</Label>
          <div className="dt-tools">
            <button type="button" className="og-ghost" disabled={busy || !undoStack.length} onClick={undo} title="Undo (Z)">
              Undo
            </button>
            <button type="button" className="og-ghost" disabled={busy || !rebetLayout || total > 0} onClick={rebet} title="Put back the last round's chips (R)">
              Rebet
            </button>
            <button type="button" className="og-ghost" disabled={busy || total <= 0} onClick={() => scaleAll(0.5)} title="Halve every chip ([)">
              ½
            </button>
            <button type="button" className="og-ghost" disabled={busy || total <= 0} onClick={() => scaleAll(2)} title="Double every chip (])">
              2×
            </button>
            <button type="button" className="og-ghost" disabled={busy || total <= 0} onClick={clearAll} title="Clear the table (X)">
              Clear
            </button>
          </div>
          <dl className="og-stats">
            <dt>Total bet</dt>
            <dd>{money(total)}</dd>
            <dt>Chance to win</dt>
            <dd>{total > 0 ? fmtChance(stats.pProfit) : '–'}</dd>
            <dt>Best payout</dt>
            <dd>{total > 0 ? money(stats.maxMult * total) : '–'}</dd>
            <dt>Layout RTP</dt>
            <dd>{total > 0 ? pct(stats.rtp) : '–'}</dd>
          </dl>

          {auto.mode === 'manual' ? (
            <ActionButton disabled={!canBet} onClick={bet}>
              {dealing ? 'Dealing…' : total > 0 ? `Bet ${money(total)}` : 'Bet'}
            </ActionButton>
          ) : (
            <AutoBetControls auto={auto} disabled={!!layoutBet.blocked || dealing}>
              <p className="dt-auto-note">
                {total > 0 ? (
                  <>
                    Each auto bet deals again with your chips:{' '}
                    {placedIds(layout)
                      .slice(0, 5)
                      .map((id) => `${BET_BY_ID[id].name} ${money(layout[id])}`)
                      .join(' · ')}
                    {placedIds(layout).length > 5 ? ` · +${placedIds(layout).length - 5} more` : ''}. On win / on loss scale the whole layout.
                  </>
                ) : (
                  'Place chips on the table first; every auto bet repeats that layout.'
                )}
              </p>
            </AutoBetControls>
          )}
          {layoutBet.blocked && !busy && <p className={'dt-blocked' + (total > 0 ? ' err' : '')}>{layoutBet.blocked}</p>}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={dealing ? 'live' : last ? (last.multiplier >= 1 ? 'won' : 'lost') : 'idle'} history={history} />

      <Board className="dt-board">
        <InstantResult multiplier={revealed ? last!.multiplier : null} stake={last?.stake ?? 0} id={last?.id ?? 0} />
        <Felt deal={dealView} timing={timing} revealed={revealed} winner={revealed ? last!.winner : null} suited={revealed && !!last?.suited} />
        <OddsSplit winner={revealed ? last!.winner : null} suited={revealed && !!last?.suited} />
      </Board>

      <Table layout={shown} hits={hits} halves={halves} paid={paidBy} disabled={busy} onAdd={addChip} onRemove={removeChip} onHover={setHover} money={money} />

      <div className="dt-info" aria-live="polite">
        {hb && hs ? (
          <>
            <p>
              <b>{hb.name}</b> pays {hb.pays}:1{hoverNote(hb.id)} · wins <b>{pct(hs.chance)}</b> · RTP {pct(hs.rtp)}
            </p>
            <div className="dt-cover">
              <i style={{ width: `${hs.chance * 100}%` }} />
              {hs.partial > 0 && <i className="part" style={{ left: `${hs.chance * 100}%`, width: `${hs.partial * 100}%` }} />}
            </div>
          </>
        ) : total > 0 ? (
          <>
            <p>
              Your chips return something on <b>{pct(stats.pHit)}</b> of deals and profit on <b>{pct(stats.pProfit)}</b> · layout RTP {pct(stats.rtp)}
            </p>
            <div className="dt-cover">
              <i style={{ width: `${stats.pHit * 100}%` }} />
              <i className="profit" style={{ width: `${stats.pProfit * 100}%` }} />
            </div>
          </>
        ) : (
          <>
            <p>Click a spot to place a chip; right-click or Shift-click removes one. The bar along each spot's foot is its exact chance.</p>
            <div className="dt-cover empty" />
          </>
        )}
      </div>

      <Road items={road} />

      {infoOpen && (
        <InfoModal title="Dragon Tiger" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              One card is dealt to Dragon and one to Tiger. The higher card wins; aces are low (A = 1 … K = 13) and suits don't rank. Back the side you think wins, the tie,
              or a side bet on either card.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick a chip value (or a preset, keys 1–5), then click spots on the table. Click again to stack more; right-click or Shift-click takes one off.</li>
              <li>Mix as many bets as you like on the same deal. Undo, ½, 2× and Clear edit the whole layout; Rebet puts back last round's chips.</li>
              <li>Press Bet (or Space). Your chips stay down, so Space again deals the same layout. Auto repeats it with your stop rules.</li>
            </ol>
            <p>
              Keys: <b>Space</b> bet · <b>D</b> Dragon · <b>T</b> Tiger · <b>E</b> Tie · <b>S</b> Suited tie (Shift removes) · <b>Z</b> undo · <b>[</b> <b>]</b> halve / double · <b>X</b> clear ·{' '}
              <b>R</b> rebet · <b>1–5</b> chip value.
            </p>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The bar under the cards is split at the exact chances of the three endings: Dragon {pct(192 / 415)}, Tie {pct(P_TIE)} (the gold sliver is the suited tie,{' '}
              {pct(P_SUITED)}), Tiger {pct(192 / 415)}. Every spot on the table carries a thin bar along its foot whose share of the spot's width is its chance; hover a
              spot to read it out. The bead road keeps the last results, but every deal comes from a fresh shoe, so past results never change the next one.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Each round deals two cards from a freshly shuffled 8-deck shoe of 416 cards, so all 416 × 415 ordered pairs are equally likely. Tiger's card matches Dragon's
              rank when it is one of the 31 other cards of that rank: P(tie) = 31/415. It is the very same card (rank and suit) for 7 of them: P(suited tie) = 7/415. By
              symmetry the rest splits evenly, P(Dragon) = P(Tiger) = 192/415. Each card alone is uniform over the 52 kinds, so a side bet that covers 24 kinds wins with
              24/52 = 6/13.
            </p>
            <p>
              Dragon returns (2 × 192 + ½ × 31) / 415 = 399.5/415 = {pct(RTP)}. Chips on different spots are independent bets on the same deal, so by linearity of
              expectation a layout returns the stake-weighted average of its bets' RTPs.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <table className="dt-paytable">
              <thead>
                <tr>
                  <th>Bet</th>
                  <th>Pays</th>
                  <th>Chance</th>
                  <th>RTP</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ['Dragon / Tiger', 'dragon', '1:1, tie ½ back'],
                    ['Tie', 'tie', '8:1'],
                    ['Suited tie', 'suited', '50:1'],
                    ...SIDE_KINDS.map((k) => [`${SIDE_NAME[k]} (${SIDE_RULE[k]})`, `dragon-${k}`, '1:1']),
                  ] as [string, string, string][]
                ).map(([name, id, pays]) => {
                  const s = betStats(id);
                  return (
                    <tr key={id}>
                      <td>{name}</td>
                      <td>{pays}</td>
                      <td>{pct(s.chance)}</td>
                      <td>{pct(s.rtp)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p>
              Payouts are "to one": a win also returns your chip. Side bets are on one card (Dragon's or Tiger's) and a 7 loses all of them. The best bets are Dragon and Tiger
              at {pct(RTP)}; the top payout is a suited tie at {fmtMult(MAX_MULTIPLIER)} your chip. Both cards are drawn the moment you bet; the deal only shows them.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
