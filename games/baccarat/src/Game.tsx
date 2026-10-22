import { formatAmount } from '@originals/game-sdk';
import { useBalance, useHost } from '@originals/game-sdk/react';
import {
  ActionButton,
  AutoBetControls,
  Board,
  Chips,
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
  useAutoBet,
  useBetInput,
  useHistory,
  useHotkeys,
  useTicket,
  useTimers,
  useTurbo,
  type BetInput,
} from '@originals/game-sdk/ui';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ChipDisc, Hand } from './Cards';
import { Felt, type SpotState } from './Felt';
import {
  BET_IDS,
  BET_NAME,
  RTP,
  VARIANT_NAME,
  addTo,
  betRtp,
  betWinChance,
  betsOf,
  deal,
  layoutStats,
  paysLabel,
  resultOf,
  returnOf,
  scaleLayout,
  settle,
  stakeOf,
  takeFrom,
  volatilityOf,
  type BetId,
  type Card,
  type Deal,
  type Layout,
  type Result,
  type Variant,
} from './math';
import { Road, ROAD_COLS, ROAD_ROWS, type Bead } from './Road';

const ACCENT = '#8b5cf6';
const CHIP_VALUES = [0.1, 0.5, 1, 5, 10, 25, 100, 500];

const cents = (x: number) => Math.round(x * 100) / 100;
const money = (x: number) => formatAmount(x, 2);
const pct = (x: number) => (x * 100).toFixed(2) + '%';
const sameLayout = (a: Layout, b: Layout) => {
  const ka = betsOf(a);
  const kb = betsOf(b);
  return ka.length === kb.length && ka.every((k) => Math.abs((b[k] ?? 0) - (a[k] ?? 0)) < 0.005);
};

interface TableView {
  player: Card[];
  banker: Card[];
  /** Face-up counts per hand. */
  pf: number;
  bf: number;
  /** Counted (finished turning) per hand. */
  pr: number;
  br: number;
}

interface Last {
  id: number;
  deal: Deal;
  result: Result;
  layout: Layout;
  variant: Variant;
  multiplier: number;
  stake: number;
}

function typing(e: KeyboardEvent) {
  const t = e.composedPath()[0] as HTMLElement | undefined;
  if (!t || !t.tagName) return false;
  if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return true;
  return t.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes((t as HTMLInputElement).type);
}

function winnerLine(d: Deal) {
  if (d.winner === 'tie') return `Tie · ${d.pTotal} – ${d.bTotal}`;
  return `${d.winner === 'player' ? 'Player' : 'Banker'} wins · ${d.pTotal} – ${d.bTotal}`;
}

export default function Game() {
  const { rng } = useHost();
  const balance = useBalance();
  const chip = useBetInput(1);
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);

  const [variant, setVariant] = useState<Variant>('classic');
  const [layout, setLayoutState] = useState<Layout>({});
  const [undoStack, setUndoStack] = useState<Layout[]>([]);
  const [lastDealt, setLastDealt] = useState<Layout | null>(null);
  const [dealing, setDealing] = useState(false);
  const [table, setTable] = useState<TableView | null>(null);
  const [last, setLast] = useState<Last | null>(null);
  const [beads, setBeads] = useState<Bead[]>([]);
  const [infoOpen, setInfoOpen] = useState(false);
  const seq = useRef(0);

  // The layout auto-bet scales (on win / on loss) and the layout the player built.
  const layoutRef = useRef(layout);
  const baseRef = useRef(layout);
  const variantRef = useRef(variant);
  variantRef.current = variant;

  // The deal is decided when the bet is placed; leaving mid-deal settles at it.
  const resolved = useRef(0);
  const ticket = useTicket(() => (dealing ? resolved.current : 0));

  const total = stakeOf(layout);
  const stats = useMemo(() => layoutStats(layout, variant), [layout, variant]);
  const step = turbo.turbo ? 150 : 520;

  // ---------- Layout editing (any change clears the last result off the board) ----------
  const clearBoard = useCallback(() => {
    setLast(null);
    setTable(null);
  }, []);
  const commit = useCallback(
    (next: Layout) => {
      setUndoStack((u) => [...u.slice(-79), layoutRef.current]);
      layoutRef.current = next;
      baseRef.current = next;
      setLayoutState(next);
      clearBoard();
    },
    [clearBoard],
  );
  const room = () => balance - stakeOf(layoutRef.current) + 1e-9;
  const add = (id: BetId) => {
    if (!(chip.value > 0) || chip.value > room()) return;
    commit(addTo(layoutRef.current, id, chip.value));
  };
  const remove = (id: BetId) => {
    const cur = layoutRef.current[id] ?? 0;
    if (!cur) return;
    commit(takeFrom(layoutRef.current, id, chip.value > 0 ? Math.min(chip.value, cur) : cur));
  };
  const scaleAll = (f: number) => {
    const t = stakeOf(layoutRef.current);
    if (!(t > 0) || (f > 1 && t * f > balance + 1e-9)) return;
    const next: Layout = {};
    for (const id of betsOf(layoutRef.current)) next[id] = Math.max(0.01, cents((layoutRef.current[id] ?? 0) * f));
    commit(next);
  };
  const clearAll = () => {
    if (stakeOf(layoutRef.current) > 0) commit({});
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
  const canRebet = !!lastDealt && !sameLayout(lastDealt, layout) && stakeOf(lastDealt) <= balance + 1e-9;
  const rebet = () => {
    if (canRebet && lastDealt) commit({ ...lastDealt });
  };
  const changeVariant = (v: Variant) => {
    if (v === variant) return;
    setVariant(v);
    clearBoard();
  };

  // ---------- One deal ----------
  async function playOnce(stake: number): Promise<number | null> {
    let lay = layoutRef.current;
    if (Math.abs(stakeOf(lay) - stake) > 0.005) {
      lay = scaleLayout(baseRef.current, stake);
      layoutRef.current = lay;
      setLayoutState(lay);
    }
    const t = stakeOf(lay);
    if (!(t > 0)) return null;
    if (!(await ticket.place(t))) return null;

    const v = variantRef.current;
    const d = deal(() => rng.next());
    const result = resultOf(d);
    const s = settle(lay, result, v);
    resolved.current = s.multiplier;
    setLast(null);
    setDealing(true);

    const view: TableView = { player: [], banker: [], pf: 0, bf: 0, pr: 0, br: 0 };
    setTable({ ...view });
    let pi = 0;
    let bi = 0;
    for (let k = 0; k < d.order.length; k++) {
      if (k === 4 && !(await timers.wait(step * 0.6))) return null; // a beat before a third card
      const toPlayer = d.order[k] === 'P';
      if (toPlayer) view.player = [...view.player, d.player[pi++]];
      else view.banker = [...view.banker, d.banker[bi++]];
      setTable({ ...view });
      if (!(await timers.wait(step * 0.42))) return null;
      if (toPlayer) view.pf++;
      else view.bf++;
      setTable({ ...view });
      if (!(await timers.wait(step * 0.58))) return null;
      if (toPlayer) view.pr++;
      else view.br++;
      setTable({ ...view });
    }
    if (!(await timers.wait(turbo.turbo ? 60 : 220))) return null;

    ticket.settle(s.multiplier);
    const id = ++seq.current;
    setLast({ id, deal: d, result, layout: lay, variant: v, multiplier: s.multiplier, stake: t });
    setLastDealt(lay);
    setBeads((b) => [...b, { id, win: result.win, total: result.win === 'P' ? d.pTotal : d.bTotal, pp: result.pp, bp: result.bp }].slice(-ROAD_ROWS * ROAD_COLS * 3));
    pushHistory(s.multiplier);
    setDealing(false);
    return s.multiplier;
  }

  // Auto-bet scales the whole layout: its "bet" is the layout's total.
  const layoutBet: BetInput = {
    text: money(total),
    value: total,
    blocked: !(total > 0) ? 'Place chips on the table first' : total > balance + 1e-9 ? 'Not enough balance' : undefined,
    setText: (text: string) => {
      const val = Number(text);
      if (!(val > 0)) return;
      const next = scaleLayout(baseRef.current, val);
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

  // Letter shortcuts: P / B / T place a chip, Z undo, X clear, D double, H halve, R rebet, 1–8 chip value.
  const keys = useRef({ undo, clearAll, scaleAll, rebet, add, busy, setChip: (val: number) => chip.setText(money(val)) });
  keys.current = { undo, clearAll, scaleAll, rebet, add, busy, setChip: (val: number) => chip.setText(money(val)) };
  useEffect(() => {
    if (infoOpen) return;
    const onDown = (e: KeyboardEvent) => {
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const h = keys.current;
      if (h.busy) return;
      const key = e.key.toLowerCase();
      if (key === 'p') h.add('player');
      else if (key === 'b') h.add('banker');
      else if (key === 't') h.add('tie');
      else if (key === 'z' || e.key === 'Backspace') h.undo();
      else if (key === 'x') h.clearAll();
      else if (key === 'd') h.scaleAll(2);
      else if (key === 'h') h.scaleAll(0.5);
      else if (key === 'r') h.rebet();
      else if (/^[1-8]$/.test(e.key)) h.setChip(CHIP_VALUES[Number(e.key) - 1]);
    };
    window.addEventListener('keydown', onDown);
    return () => window.removeEventListener('keydown', onDown);
  }, [infoOpen]);

  // ---------- Derived view ----------
  const shownLayout = last && !busy ? last.layout : layout;
  const spotStates = useMemo(() => {
    if (!last || dealing) return null;
    const out: Partial<Record<BetId, SpotState>> = {};
    for (const id of BET_IDS) {
      const f = returnOf(id, last.result, last.variant);
      out[id] = f > 1 ? 'won' : f === 1 ? 'push' : 'lost';
    }
    return out;
  }, [last, dealing]);
  const gains = useMemo(() => {
    const out: Partial<Record<BetId, number>> = {};
    if (!last) return out;
    for (const id of betsOf(last.layout)) out[id] = (last.layout[id] ?? 0) * (returnOf(id, last.result, last.variant) - 1);
    return out;
  }, [last]);

  const d = last?.deal ?? null;
  const handState = (who: 'player' | 'banker') => {
    if (dealing) return 'live' as const;
    if (!d) return 'idle' as const;
    if (d.winner === 'tie') return 'tie' as const;
    return d.winner === who ? ('win' as const) : ('lose' as const);
  };
  const vol = volatilityOf(stats.sd);

  const status = dealing
    ? 'Dealing…'
    : last
      ? winnerLine(last.deal)
      : total > 0
        ? `Total bet ${money(total)} · press Bet`
        : 'Place your chips on the table';

  let banner: { cls: string; title: string; sub: string } = {
    cls: 'idle',
    title: total > 0 ? 'Ready to deal' : 'Place your bets',
    sub: '8-deck shoe · reshuffled every round',
  };
  if (dealing) banner = { cls: 'live', title: 'No more bets', sub: 'Dealing from the shoe' };
  else if (d) {
    const natural = d.natural ? `Natural ${Math.max(d.pTotal, d.bTotal)}` : `${d.player.length + d.banker.length} cards`;
    banner =
      d.winner === 'tie'
        ? { cls: 'T', title: 'Tie', sub: `${d.pTotal} – ${d.bTotal} · ${natural}` }
        : { cls: d.winner === 'player' ? 'P' : 'B', title: `${d.winner === 'player' ? 'Player' : 'Banker'} wins`, sub: `${d.pTotal} – ${d.bTotal} · ${natural}` };
  }

  return (
    <GameLayout
      name="Baccarat"
      accent={ACCENT}
      className="bc-game"
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
          <div className="bc-denoms" role="group" aria-label="Chip presets">
            {CHIP_VALUES.map((val, i) => (
              <button
                key={val}
                type="button"
                className={'bc-denom' + (Math.abs(chip.value - val) < 1e-9 ? ' on' : '')}
                disabled={busy}
                onClick={() => chip.setText(money(val))}
                title={`Chip ${money(val)} (key ${i + 1})`}
                aria-label={`Chip ${money(val)}`}
              >
                <svg viewBox="-15 -15 30 30" aria-hidden="true">
                  <ChipDisc value={val} r={14} />
                </svg>
              </button>
            ))}
          </div>

          <Label hint={variant === 'classic' ? 'Banker pays 0.95:1' : 'Banker 1:1, a winning 6 pays ½'}>Table rules</Label>
          <Chips
            label="Table rules"
            value={variant}
            disabled={busy}
            onChange={changeVariant}
            options={(['classic', 'nocomm'] as const).map((v) => ({
              value: v,
              label: VARIANT_NAME[v],
              title: `Banker returns ${pct(betRtp('banker', v))}`,
            }))}
          />

          <Label hint={total > 0 ? <VolBadge level={vol} /> : undefined}>Your bets</Label>
          <div className="bc-tools">
            <button type="button" className="og-ghost" disabled={busy || !undoStack.length} onClick={undo} title="Undo (Z)">
              Undo
            </button>
            <button type="button" className="og-ghost" disabled={busy || !canRebet} onClick={rebet} title="Repeat the last deal's chips (R)">
              Rebet
            </button>
            <button type="button" className="og-ghost" disabled={busy || total <= 0 || total * 2 > balance + 1e-9} onClick={() => scaleAll(2)} title="Double every chip (D)">
              2×
            </button>
            <button type="button" className="og-ghost" disabled={busy || total <= 0} onClick={clearAll} title="Clear the table (X)">
              Clear
            </button>
          </div>
          <dl className="og-stats">
            <dt>Total bet</dt>
            <dd>{money(total)}</dd>
            <dt>Return to player</dt>
            <dd>{total > 0 ? pct(stats.rtp) : '–'}</dd>
            <dt>Chance of profit</dt>
            <dd>{total > 0 ? fmtChance(stats.pProfit) : '–'}</dd>
            <dt>Best payout</dt>
            <dd>{total > 0 ? money(stats.maxMult * total) : '–'}</dd>
          </dl>

          {auto.mode === 'manual' ? (
            <ActionButton disabled={!canBet} onClick={bet}>
              {dealing ? 'Dealing…' : total > 0 ? `Bet ${money(total)}` : 'Bet'}
            </ActionButton>
          ) : (
            <AutoBetControls auto={auto} disabled={!!layoutBet.blocked || dealing}>
              <p className="bc-note">
                {total > 0
                  ? `Each auto bet deals a round on the chips on the table (${betsOf(layout).map((id) => BET_NAME[id]).join(', ')}: ${money(total)}). On win / on loss scale the whole layout.`
                  : 'Place chips on the table first; every auto bet repeats that layout.'}
              </p>
            </AutoBetControls>
          )}
          {layoutBet.blocked && !busy && <p className={'bc-note center' + (total > 0 ? ' err' : '')}>{layoutBet.blocked}</p>}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={dealing ? 'live' : last ? (last.multiplier >= 1 ? 'won' : 'lost') : 'idle'} history={history} />

      <Board className="bc-board">
        <InstantResult multiplier={last && !dealing ? last.multiplier : null} stake={last?.stake ?? 0} id={last?.id ?? 0} />
        <div className="bc-table" style={{ '--step': `${step}ms` } as CSSProperties}>
          <Hand who="player" cards={table?.player ?? []} flipped={table?.pf ?? 0} revealed={table?.pr ?? 0} state={handState('player')} />
          <div className="bc-vs" aria-hidden="true">
            <span>vs</span>
          </div>
          <Hand who="banker" cards={table?.banker ?? []} flipped={table?.bf ?? 0} revealed={table?.br ?? 0} state={handState('banker')} />
        </div>
        <div className={`bc-banner ${banner.cls}`} key={last?.id ?? (dealing ? 'deal' : 'idle')} aria-live="polite">
          <b>{banner.title}</b>
          <span>{banner.sub}</span>
        </div>
      </Board>

      <Felt layout={shownLayout} variant={variant} states={spotStates} gains={gains} disabled={busy} onAdd={add} onRemove={remove} />

      <Road beads={beads} />

      {infoOpen && (
        <InfoModal title="Baccarat" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              Two hands are dealt, Player and Banker. The hand whose total is closer to 9 wins. Bet on Player, Banker or a Tie, and optionally on the pair side bets.
              You never play a hand yourself: the drawing rules are fixed.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick a chip value (a preset, or type one), then click spots on the felt to place chips. Right-click or Shift-click a spot to take a chip off.</li>
              <li>Choose the table rules: Classic (Banker pays 0.95:1) or No commission (Banker pays 1:1, but only half when it wins with a 6).</li>
              <li>Press Bet (or Space). Chips stay on the felt, so Space deals the same layout again. Auto repeats your layout with your stop rules.</li>
            </ol>
            <p>
              Keys: <b>Space</b> deal · <b>P</b> / <b>B</b> / <b>T</b> chip on Player / Banker / Tie · <b>Z</b> undo · <b>X</b> clear · <b>D</b> double · <b>H</b>{' '}
              halve · <b>R</b> rebet · <b>1–8</b> chip value.
            </p>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              Each spot on the felt shows its payout and its exact chance to win. The panel shows your whole layout's return, its chance of a profit and the most it
              can pay. The bead road under the felt records every round: P blue, B red, T green, with a corner dot for a Player pair (top left) or a Banker pair
              (bottom right). Every round is dealt from a fresh shoe, so past beads never change the next round's odds.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Cards count A = 1, 2–9 at face value, 10 and pictures 0; a total is the sum's last digit. With a natural (8 or 9 on two cards) both hands stand.
              Otherwise Player draws on 0–5. If Player stood, Banker draws on 0–5; if Player drew a card worth x, Banker draws on 0–2, on 3 unless x = 8, on 4 if x is
              2–7, on 5 if x is 4–7, on 6 if x is 6–7, never on 7.
            </p>
            <p>
              The odds are computed exactly, not simulated: every ordered deal from the 416-card shoe is enumerated (first four cards by rank, third cards by value) with
              its exact weight. Banker wins 45.860%, Player 44.625%, Tie 9.516%. A pair needs the second card to match the first card's rank: 31 of the 415 cards left,
              so 7.470%. A perfect pair needs the very same card: 7 of 415.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <table className="bc-paytable">
              <thead>
                <tr>
                  <th>Bet</th>
                  <th>Pays</th>
                  <th>Chance</th>
                  <th>RTP</th>
                </tr>
              </thead>
              <tbody>
                {BET_IDS.map((id) => (
                  <tr key={id}>
                    <td>{BET_NAME[id]}</td>
                    <td>{id === 'banker' ? '0.95:1 / no comm.' : paysLabel(id, 'classic')}</td>
                    <td>{fmtChance(betWinChance(id, 'classic'))}</td>
                    <td>{id === 'banker' ? `${pct(betRtp('banker', 'classic'))} / ${pct(betRtp('banker', 'nocomm'))}` : pct(betRtp(id, 'classic'))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              On a tie, Player and Banker bets push (the chip comes back). A layout returns the stake-weighted average of its bets. The main bet, Banker under the
              Classic rules, returns {pct(RTP)}. The round is decided the moment you bet; the cards only show it. The largest possible win is 201× (a perfect pair in
              both hands).
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
