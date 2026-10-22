import { formatAmount, type Volatility } from '@originals/game-sdk';
import { useBalance, useHost } from '@originals/game-sdk/react';
import {
  ActionButton,
  AutoBetControls,
  BetField,
  Board,
  Caption,
  ChanceBar,
  Chips,
  GameLayout,
  InfoModal,
  InfoSection,
  Label,
  ModeTabs,
  PanelFoot,
  Readouts,
  RoundOver,
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
  type Ticket,
} from '@originals/game-sdk/ui';
import { useEffect, useRef, useState } from 'react';
import Chart from './Chart';
import {
  ACCENT,
  DEALER_BUST_ANY,
  INSURANCE_RTP,
  MAX_MULTIPLIER,
  PAIRS_PAYS,
  PAIRS_RTP,
  RTP,
  SIDE_SIZES,
  TRIPS_PAYS,
  TRIPS_RTP,
  act,
  actionValues,
  basicValue,
  begin,
  bestAction,
  cardOf,
  ctxOf,
  deal,
  dealerBlackjack,
  dealerDist,
  dealerPeeks,
  dealerPlay,
  expectedHandReturn,
  handResult,
  handTotal,
  isBlackjack,
  legal,
  offersInsurance,
  pairsKind,
  pairsMult,
  playerDone,
  standOdds,
  totalLabel,
  tripsKind,
  tripsMult,
  valueOf,
  type Action,
  type SideSize,
  type Table as TableState,
} from './math';
import Table, { type HandView, type TableView } from './Table';

type Phase = 'idle' | 'dealing' | 'insurance' | 'player' | 'acting' | 'dealer' | 'over';
type Slot = 'main' | 'double0' | 'split' | 'double1' | 'insurance' | 'pairs' | 'trips';
const SLOTS: Slot[] = ['main', 'double0', 'split', 'double1', 'insurance', 'pairs', 'trips'];

interface Round extends TableView {
  phase: Phase;
  peeked: boolean;
  insured: boolean | null;
  /** Money staked and returned this round (final once over). */
  wagered: number;
  returned: number;
  note: string | null;
  title: string;
}

const ACTION_LABEL: Record<Action, string> = { hit: 'Hit', stand: 'Stand', double: 'Double', split: 'Split' };
const ACTION_KEY: Record<Action, string> = { hit: 'H', stand: 'S', double: 'D', split: 'P' };
const SIZE_LABEL = (s: SideSize) => (s === 0 ? 'Off' : s === 0.25 ? '¼×' : s === 0.5 ? '½×' : '1×');
const cents = (x: number) => Math.round(x * 100) / 100;

function volatilityOf(pairs: number, trips: number): Volatility {
  const s = pairs + trips;
  return s === 0 ? 'low' : s <= 0.5 ? 'medium' : s <= 1 ? 'high' : 'extreme';
}

function titleFor(r: Round): string {
  const res = r.results ?? [];
  if (res.length === 2) {
    const wins = res.filter((h) => h.mult > 1).length;
    const pushes = res.filter((h) => h.mult === 1).length;
    return wins === 2 ? 'Both hands win' : wins === 1 ? (pushes ? 'Split · win and push' : 'Split · one each') : pushes === 2 ? 'Both push' : pushes ? 'Split · push and loss' : 'Both hands lose';
  }
  const h = res[0];
  if (!h) return 'Round over';
  const dealer = r.t.dealer.slice(0, r.dealerShown);
  const dBust = handTotal(dealer).hard > 21;
  const dBJ = dealerBlackjack(r.t);
  switch (h.result) {
    case 'blackjack':
      return 'Blackjack!';
    case 'win':
      return dBust ? 'Dealer busts' : 'You win';
    case 'push':
      return 'Push';
    case 'bust':
      return 'Bust';
    default:
      return dBJ ? 'Dealer blackjack' : 'Dealer wins';
  }
}

export default function Game() {
  const { rng } = useHost();
  const balance = useBalance();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);

  const [pairsSize, setPairsSize] = useState<SideSize>(0);
  const [tripsSize, setTripsSize] = useState<SideSize>(0);
  const [hints, setHints] = useState(true);
  const [round, setRound] = useState<Round | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  // The round's source of truth for async flows; React state mirrors it.
  const cur = useRef<Round | null>(null);
  const seq = useRef(0);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  // One wallet ticket per stake: main hand, its double, the split hand, its
  // double, insurance and the two side bets. Each settles at its own result;
  // `value` is set the moment that result is decided (before any animation),
  // so leaving mid-animation pays the true result. Unresolved hands settle at
  // their exact expected return under hit/stand basic strategy.
  const slots = useRef<Record<Slot, { amount: number; value: number | null }>>(Object.fromEntries(SLOTS.map((s) => [s, { amount: 0, value: null }])) as never);
  const fair = (s: Slot) => () => {
    const st = slots.current[s];
    if (st.value !== null) return st.value;
    const r = cur.current;
    if (s === 'main' && r) return expectedHandReturn(r.t, r.peeked);
    return 0;
  };
  const tk: Record<Slot, Ticket> = {
    main: useTicket(fair('main')),
    double0: useTicket(fair('double0')),
    split: useTicket(fair('split')),
    double1: useTicket(fair('double1')),
    insurance: useTicket(fair('insurance')),
    pairs: useTicket(fair('pairs')),
    trips: useTicket(fair('trips')),
  };

  const T = turbo.turbo;
  const dealMs = T ? 70 : 240;
  const flipMs = T ? 110 : 380;
  const dealerMs = T ? 140 : 520;
  const peekMs = T ? 160 : 650;

  const commit = (r: Round) => {
    cur.current = r;
    setRound(r);
  };
  const patch = (p: Partial<Round>) => cur.current && commit({ ...cur.current, ...p });
  const draw = () => cardOf(rng.int(52));
  const wait = async (ms: number) => alive.current && (await timers.wait(ms));

  async function placeSlot(s: Slot, amount: number) {
    if (!(await tk[s].place(amount))) return false;
    slots.current[s] = { amount, value: null };
    return true;
  }
  function settleSlot(s: Slot) {
    const st = slots.current[s];
    if (st.amount > 0 && st.value !== null) tk[s].settle(st.value);
  }

  const phase: Phase = round?.phase ?? 'idle';
  const busy = phase === 'dealing' || phase === 'acting' || phase === 'dealer';
  const live = phase !== 'idle' && phase !== 'over';

  const sideStakes = (base: number) => ({ pairs: cents(base * pairsSize), trips: cents(base * tripsSize) });
  const totalStake = (base: number) => {
    const s = sideStakes(base);
    return base + s.pairs + s.trips;
  };
  const blocked = bet.blocked ?? (totalStake(bet.value) > balance + 1e-9 ? 'Not enough balance for the side bets' : undefined);

  // ------------------------------------------------------------ round flow

  /** Decides every hand's result now (before the reveal), so the tickets hold the true values. */
  function resolveHands(t: TableState): HandView[] {
    const results = t.hands.map((h) => handResult(h, t.dealer));
    const [h0, h1] = results;
    slots.current.main.value = h0.mult;
    slots.current.double0.value = h0.mult;
    if (h1) {
      slots.current.split.value = h1.mult;
      slots.current.double1.value = h1.mult;
    }
    return results;
  }

  function finish(results: HandView[]) {
    for (const s of SLOTS) settleSlot(s);
    let wagered = 0;
    let returned = 0;
    for (const s of SLOTS) {
      wagered += slots.current[s].amount;
      returned += slots.current[s].amount * (slots.current[s].value ?? 0);
    }
    const r = { ...cur.current!, results, wagered, returned, phase: 'over' as Phase, note: null };
    r.title = titleFor(r);
    commit(r);
    pushHistory(wagered > 0 ? returned / wagered : 0);
  }

  async function revealDealer(t: TableState) {
    patch({ phase: 'dealer', holeUp: true, t, note: null });
    await wait(flipMs + 120);
    for (let i = 3; i <= t.dealer.length; i++) {
      patch({ dealerShown: i });
      await wait(dealerMs);
    }
  }

  async function start(base = bet.value): Promise<boolean> {
    if (live || cur.current?.phase === 'dealing') return false;
    const { pairs, trips } = sideStakes(base);
    if (!(base > 0) || base + pairs + trips > balance + 1e-9) return false;
    timers.clearAll();
    for (const s of SLOTS) slots.current[s] = { amount: 0, value: null };
    if (!(await placeSlot('main', base))) return false;
    for (const [s, amt] of [['pairs', pairs], ['trips', trips]] as const) {
      if (amt > 0 && !(await placeSlot(s, amt))) {
        // Refund whatever was placed and give up on this round.
        for (const x of SLOTS) if (slots.current[x].amount > 0) tk[x].settle(1);
        return false;
      }
    }
    const t = deal(draw);
    const [p1, p2] = t.hands[0].cards;
    const up = t.dealer[0];
    if (pairs > 0) slots.current.pairs.value = pairsMult(p1, p2);
    if (trips > 0) slots.current.trips.value = tripsMult(p1, p2, up);
    commit({
      id: ++seq.current,
      t,
      dealerShown: 2,
      holeUp: false,
      base,
      pairs,
      trips,
      pairsWin: pairs > 0 ? pairsKind(p1, p2) : null,
      tripsWin: trips > 0 ? tripsKind(p1, p2, up) : null,
      sidesShown: false,
      results: null,
      live: true,
      phase: 'dealing',
      peeked: false,
      insured: null,
      wagered: base + pairs + trips,
      returned: 0,
      note: null,
      title: '',
    });
    await wait(dealMs * 3 + flipMs + 80);
    settleSlot('pairs');
    settleSlot('trips');
    patch({ sidesShown: true });
    if (offersInsurance(t)) {
      patch({ phase: 'insurance' });
      return true;
    }
    await afterInsurance();
    return true;
  }

  async function insurance(take: boolean) {
    const r = cur.current;
    if (!r || r.phase !== 'insurance') return;
    patch({ phase: 'dealing' });
    let insured = false;
    const amount = r.base / 2;
    if (take && amount <= balance + 1e-9 && (await placeSlot('insurance', amount))) {
      slots.current.insurance.value = dealerBlackjack(r.t) ? 3 : 0;
      insured = true;
    }
    patch({ insured, wagered: r.wagered + (insured ? amount : 0) });
    await afterInsurance();
  }

  /** The peek, then blackjacks, then the player's turn. */
  async function afterInsurance() {
    const r = cur.current!;
    const t = r.t;
    if (dealerPeeks(t)) {
      patch({ phase: 'dealing', note: 'Dealer checks for blackjack…' });
      const dealerBJ = dealerBlackjack(t);
      if (dealerBJ) {
        const results = resolveHands(t);
        await wait(peekMs);
        settleSlot('insurance');
        await revealDealer(t);
        return finish(results);
      }
      await wait(peekMs);
      settleSlot('insurance');
    }
    if (isBlackjack(t.hands[0])) {
      const results = resolveHands(t);
      patch({ peeked: true });
      await revealDealer(t);
      return finish(results);
    }
    patch({ peeked: true, phase: 'player', note: null, t: begin(t, draw) });
  }

  /** One player decision. Resolves false if the extra stake couldn't be placed. */
  async function action(a: Action): Promise<boolean> {
    const r = cur.current;
    if (!r || r.phase !== 'player' || !legal(r.t)[a]) return false;
    let wagered = r.wagered;
    if (a === 'double' || a === 'split') {
      const slot: Slot = a === 'split' ? 'split' : r.t.active === 0 ? 'double0' : 'double1';
      patch({ phase: 'acting' });
      if (r.base > balance + 1e-9 || !(await placeSlot(slot, r.base))) {
        patch({ phase: 'player', note: `Not enough balance to ${a}` });
        return false;
      }
      wagered += r.base;
    }
    const t = act(r.t, a, draw);
    if (playerDone(t)) {
      const final = dealerPlay(t, draw);
      const results = resolveHands(final);
      patch({ t: final, wagered, phase: 'acting', note: null });
      if (a !== 'stand') await wait(dealMs + flipMs);
      await revealDealer(final);
      finish(results);
    } else {
      patch({ t, wagered, phase: 'acting', note: null });
      await wait(dealMs + flipMs + (a === 'split' ? dealMs : 0));
      patch({ phase: 'player' });
    }
    return true;
  }

  async function playAuto(stake: number): Promise<number | null> {
    if (!(await start(stake))) return null;
    while (alive.current && cur.current && cur.current.phase !== 'over') {
      const r = cur.current;
      if (r.phase === 'insurance') await insurance(false);
      else if (r.phase === 'player') {
        const ctx = ctxOf(r.t)!;
        const a = bestAction(ctx);
        if (!(await action(a))) {
          const v = actionValues(ctx);
          await action(v.hit > v.stand ? 'hit' : 'stand');
        }
      } else if (!(await wait(30))) break;
    }
    const r = cur.current;
    if (!r || r.phase !== 'over') return null;
    return 1 + (r.returned - r.wagered) / stake;
  }

  const auto = useAutoBet({ bet, play: playAuto, turbo: T });
  const locked = live || auto.running;

  function clear() {
    if (live || auto.running) return;
    timers.clearAll();
    cur.current = null;
    setRound(null);
  }

  // Changing a setting after a round clears the finished board.
  const change = (apply: () => void) => {
    apply();
    if (phase === 'over') clear();
  };

  const canBet = !locked && !blocked;
  const betNow = () => {
    if (canBet && auto.mode === 'manual') void start();
  };

  useHotkeys({ space: () => (phase === 'idle' || phase === 'over' ? betNow() : undefined) }, !infoOpen);

  // Table keys: H S D P during your turn, I / N at the insurance prompt.
  const keyRef = useRef<(k: string) => void>(() => {});
  keyRef.current = (k: string) => {
    if (auto.running) return;
    if (phase === 'insurance') {
      if (k === 'i' || k === 'y') void insurance(true);
      if (k === 'n') void insurance(false);
      return;
    }
    if (phase !== 'player') return;
    const a = ({ h: 'hit', s: 'stand', d: 'double', p: 'split' } as Record<string, Action>)[k];
    if (a) void action(a);
  };
  useEffect(() => {
    if (infoOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.composedPath()[0] as HTMLElement | undefined;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && (el as HTMLInputElement).type !== 'checkbox') return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      keyRef.current(e.key.toLowerCase());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [infoOpen]);

  // ------------------------------------------------------------ what to show

  const t = round?.t ?? null;
  const ctx = phase === 'player' && t ? ctxOf(t) : null;
  const L = phase === 'player' && t ? legal(t) : null;
  const hint = hints && ctx ? bestAction(ctx) : null;
  const values = ctx ? actionValues(ctx) : null;
  const upVisible = t && round ? valueOf(t.dealer[0]) : null;
  const dist = upVisible ? dealerDist(upVisible, round!.peeked) : null;
  const standNow = ctx && dist ? standOdds(ctx.total, dist) : null;
  const canAfford = (x: number) => x <= balance + 1e-9;

  const stake = round?.base ?? bet.value;
  const sides = round ? { pairs: round.pairs, trips: round.trips } : sideStakes(bet.value);
  const inPlay = round ? round.wagered : stake + sides.pairs + sides.trips;
  const vol = volatilityOf(pairsSize, tripsSize);

  let status = 'Place your bet · blackjack pays 3:2';
  let tone: 'idle' | 'live' | 'won' | 'lost' = 'idle';
  if (round) {
    tone = phase === 'over' ? (round.returned > round.wagered + 1e-9 ? 'won' : round.returned < round.wagered - 1e-9 ? 'lost' : 'idle') : 'live';
    if (phase === 'dealing') status = round.note ?? 'Dealing…';
    else if (phase === 'insurance') status = 'Dealer shows an ace · insurance?';
    else if (phase === 'player' || phase === 'acting')
      status = t && t.hands.length > 1 && t.active < t.hands.length ? `Split · hand ${t.active + 1} of 2` : t ? `Your hand · ${totalLabel(t.hands[Math.min(t.active, t.hands.length - 1)].cards)}` : '';
    else if (phase === 'dealer') status = 'Dealer plays…';
    else status = round.title;
  }

  const readouts = [
    {
      label: 'Dealer busts',
      value: upVisible && dist ? fmtChance(dist[5]) : fmtChance(DEALER_BUST_ANY),
      sub: upVisible ? `showing ${upVisible === 1 ? 'an ace' : upVisible === 10 ? 'a ten' : `a ${upVisible}`}` : 'from any up card',
      tone: 'chance' as const,
    },
    {
      label: 'In play',
      value: formatAmount(inPlay, 2),
      sub: round && round.wagered > round.base + round.pairs + round.trips + 1e-9 ? 'incl. extra bets' : sides.pairs + sides.trips > 0 ? 'main + side bets' : 'main bet',
      tone: 'cash' as const,
    },
    phase === 'over' && round
      ? {
          label: 'Returned',
          value: fmtMult(round.wagered ? round.returned / round.wagered : 0),
          sub: `${formatAmount(round.returned, 2)} of ${formatAmount(round.wagered, 2)}`,
          tone: round.returned > round.wagered + 1e-9 ? ('prize' as const) : ('neutral' as const),
        }
      : hint && values
        ? {
            label: 'Basic strategy',
            value: ACTION_LABEL[hint],
            sub: `worth ${(values[hint]! >= 0 ? '+' : '−') + Math.abs(values[hint]!).toFixed(3)}× bet`,
            tone: 'prize' as const,
          }
        : { label: 'Blackjack pays', value: '2.50×', sub: '3 to 2 · win pays 2×', tone: 'prize' as const },
  ];

  const tableView: TableView | null = round ? { ...round, live: phase === 'player' || phase === 'acting' } : null;

  const mid =
    phase === 'over' && round ? (
      <RoundOver
        key={round.id}
        title={round.title}
        multiplier={round.wagered ? round.returned / round.wagered : 0}
        stake={round.wagered}
        nextBet={totalStake(bet.value)}
        blocked={auto.running ? 'Autobet running' : blocked}
        onBetAgain={() => void start()}
        onClear={clear}
        placement="center"
      />
    ) : phase === 'insurance' && round ? (
      <div className="bj-banner" role="status">
        <b>Insurance?</b>
        <span>
          The dealer shows an ace. Insure for {formatAmount(round.base / 2, 2)}; it pays 2:1 if the dealer has blackjack ({fmtChance(4 / 13)}).
        </span>
      </div>
    ) : round?.note && phase !== 'dealing' ? (
      <div className="bj-banner warn" role="status">
        <span>{round.note}</span>
      </div>
    ) : null;

  const actionBtn = (a: Action) => {
    const extra = a === 'double' || a === 'split';
    const ok = !!L?.[a] && !busy && (!extra || canAfford(round?.base ?? 0));
    return (
      <ActionButton
        key={a}
        kind={a === 'hit' ? 'bet' : 'secondary'}
        className={'bj-act' + (hint === a ? ' hinted' : '')}
        disabled={!ok || auto.running}
        onClick={() => void action(a)}
      >
        {ACTION_LABEL[a]}
        <kbd>{ACTION_KEY[a]}</kbd>
      </ActionButton>
    );
  };

  return (
    <GameLayout
      name="Blackjack"
      accent={ACCENT}
      className="bj-game"
      panel={
        <>
          <ModeTabs auto={auto} disabled={live} />
          <BetField bet={bet} disabled={locked} />

          <Label hint={<VolBadge level={vol} />}>Side bets</Label>
          <div className="bj-side-row">
            <span>Pairs</span>
            <Chips
              label="Pairs side bet"
              options={SIDE_SIZES.map((s) => ({ value: s, label: SIZE_LABEL(s), title: s ? `${s * 100}% of your bet` : 'No side bet' }))}
              value={pairsSize}
              disabled={locked}
              onChange={(v) => change(() => setPairsSize(v))}
            />
          </div>
          <div className="bj-side-row">
            <span>21+3</span>
            <Chips
              label="21+3 side bet"
              options={SIDE_SIZES.map((s) => ({ value: s, label: SIZE_LABEL(s), title: s ? `${s * 100}% of your bet` : 'No side bet' }))}
              value={tripsSize}
              disabled={locked}
              onChange={(v) => change(() => setTripsSize(v))}
            />
          </div>

          <dl className="og-stats">
            <dt>Total stake</dt>
            <dd>{formatAmount(totalStake(bet.value), 2)}</dd>
            <dt>Main bet RTP</dt>
            <dd>{(RTP * 100).toFixed(2)}%</dd>
            <dt>Side bets pay up to</dt>
            <dd>
              {PAIRS_PAYS.perfect + 1}× · {TRIPS_PAYS['suited-trips'] + 1}×
            </dd>
          </dl>

          {auto.mode === 'manual' ? (
            phase === 'insurance' ? (
              <div className="bj-actions two">
                <ActionButton kind="secondary" disabled={!canAfford((round?.base ?? 0) / 2)} onClick={() => void insurance(true)}>
                  Insure <kbd>I</kbd>
                </ActionButton>
                <ActionButton className={hints ? 'hinted' : ''} onClick={() => void insurance(false)}>
                  Decline <kbd>N</kbd>
                </ActionButton>
              </div>
            ) : phase === 'player' || phase === 'acting' ? (
              <div className="bj-actions">{(['hit', 'stand', 'double', 'split'] as Action[]).map(actionBtn)}</div>
            ) : (
              <ActionButton disabled={!canBet} onClick={betNow}>
                {phase === 'dealing' || phase === 'dealer' ? 'Dealing…' : phase === 'over' ? 'Bet again' : 'Bet'}
              </ActionButton>
            )
          ) : (
            <AutoBetControls auto={auto} disabled={!!blocked || live}>
              <p className="bj-auto-note">Auto plays exact basic strategy (the chart in How to play): it never takes insurance. Side bets repeat each round.</p>
            </AutoBetControls>
          )}
          {blocked && !live && <p className="bj-blocked">{blocked}</p>}

          <label className="og-toggle bj-hint-toggle">
            <input type="checkbox" checked={hints} onChange={(e) => setHints(e.target.checked)} />
            <span>Strategy hints</span>
          </label>

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />
      <Readouts items={readouts} />

      <Board className="bj-board">
        <Table view={tableView} preview={{ base: bet.value, ...sideStakes(bet.value) }} hint={hint} dealMs={dealMs} flipMs={flipMs} mid={mid} />
      </Board>

      <div className="bj-foot">
      {standNow && ctx ? (
        <ChanceBar
          p={standNow.win}
          label={`Standing on ${ctx.total} wins`}
          note={`Push ${fmtChance(standNow.push)} · lose ${fmtChance(standNow.lose)}. Exact, against the dealer's ${upVisible === 1 ? 'ace' : upVisible} after the peek.`}
        />
      ) : (
        <Caption>
          Infinite deck · dealer stands on soft 17 and peeks for blackjack · double any two cards, also after a split · split once · RTP {(RTP * 100).toFixed(2)}% with
          basic strategy.
        </Caption>
      )}
      </div>

      {infoOpen && (
        <InfoModal title="Blackjack" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>Beat the dealer: finish closer to 21 than the dealer without going over. An ace and a ten-value card as your first two cards is blackjack and pays 3 to 2.</p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Set your bet and, if you like, the Pairs and 21+3 side bets (a share of your bet). Press Bet (Space).</li>
              <li>
                <b>Hit</b> (H) takes a card, <b>Stand</b> (S) keeps your total, <b>Double</b> (D) doubles your bet for exactly one more card, <b>Split</b> (P)
                turns two cards of the same value into two hands, each with its own bet.
              </li>
              <li>When the dealer shows an ace you are offered insurance (I to insure, N to decline). Any 21 stands automatically.</li>
              <li>The dealer then reveals the hole card and draws to 17, standing on soft 17. Space bets again, Esc clears the table.</li>
              <li>Auto plays basic strategy for you with your own stop rules.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The readouts are exact. <b>Dealer busts</b> is the chance the dealer goes over 21 from the card showing. The bar shows what standing on your total
              would do right now. With hints on, the suggested play is the one with the highest exact value; it follows this chart:
            </p>
            <Chart />
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Cards come from an infinite deck: each card is a fresh, uniform draw, so the dealer's final total depends only on the up card. A short recursion
              gives its exact distribution, standing on t is worth P(win) − P(lose), and dynamic programming over every hit, double and split gives the exact value
              of each play. Always taking the best play is basic strategy, and it returns <b>{(RTP * 100).toFixed(3)}%</b> of the original bet
              ({(basicValue().rtpPerWagered * 100).toFixed(3)}% of all money wagered, since doubles and splits add stakes).
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <ul>
              <li>Win 1:1 (2×), blackjack 3:2 (2.5×), push returns your bet. A dealer blackjack only takes your original bet.</li>
              <li>Insurance costs half your bet and pays 2:1. The dealer has blackjack under an ace 4/13 of the time, so it returns {(INSURANCE_RTP * 100).toFixed(2)}%.</li>
              <li>
                Pairs: perfect pair {PAIRS_PAYS.perfect}:1, coloured pair {PAIRS_PAYS.coloured}:1, mixed pair {PAIRS_PAYS.mixed}:1. RTP 51/52 ={' '}
                {(PAIRS_RTP * 100).toFixed(2)}%.
              </li>
              <li>
                21+3 (your two cards with the dealer's up card): suited trips {TRIPS_PAYS['suited-trips']}:1, straight flush {TRIPS_PAYS['straight-flush']}:1,
                three of a kind {TRIPS_PAYS.trips}:1, straight {TRIPS_PAYS.straight}:1, flush {TRIPS_PAYS.flush}:1. RTP {(TRIPS_RTP * 100).toFixed(2)}%.
              </li>
              <li>
                The most a round can return is {MAX_MULTIPLIER}× your main bet. If you leave mid-hand, your open hands are settled at their exact expected value.
              </li>
            </ul>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
