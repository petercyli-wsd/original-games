import { useHost } from '@originals/game-sdk/react';
import {
  ACCENTS,
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
  InstantResult,
  Label,
  ModeTabs,
  PanelFoot,
  Readouts,
  RoundOver,
  StageTop,
  eventMs,
  fmtChance,
  fmtMult,
  useAutoBet,
  useBetInput,
  useHistory,
  useHotkeys,
  useTicket,
  useTimers,
  useTurbo,
} from '@originals/game-sdk/ui';
import { formatAmount } from '@originals/game-sdk';
import { useRef, useState } from 'react';
import Pack from './Board';
import { CARDS, MAX_MULTIPLIER, MEAN_CARD, RTP, TABLE, TIERS, chanceReturnsBet, drawCard, packValue, probAtLeast, sumCents, type Card } from './math';

type Phase = 'idle' | 'opening' | 'checkpoint' | 'over';
type Outcome = 'sold' | 'full';

interface Round {
  stake: number;
  cards: Card[];
  /** How many of the drawn cards are face up (the newest is face down while it flips). */
  shown: number;
  outcome: Outcome | null;
  cash: number;
}

const STOPS = [
  { value: -1, label: 'Off' },
  { value: 2, label: 'Rare' },
  { value: 3, label: 'Epic' },
  { value: 4, label: 'Leg.' },
  { value: 5, label: 'Prime' },
];

const fmtCents = (c: number) => fmtMult(c / 100);
const ONE_IN = (p: number) => (p >= 0.1 ? '' : `1 in ${Math.round(1 / p).toLocaleString('en-US')}`);

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [stopRank, setStopRank] = useState(-1);
  const [autoLast, setAutoLast] = useState<{ id: number; mult: number; stake: number } | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  // The ticket's value right now, set synchronously where the stake is placed
  // and where each card is drawn (never from rendered state, which lags a render).
  const resolved = useRef(0);
  const ticket = useTicket(() => resolved.current);
  const roundRef = useRef<Round | null>(null);
  const busyRef = useRef(false);
  const openAll = useRef(false);
  const seq = useRef(0);
  const animRef = useRef(eventMs(turbo.turbo));

  const live = phase === 'opening' || phase === 'checkpoint';

  function put(r: Round) {
    roundRef.current = r;
    setRound(r);
  }

  function finish(r: Round, outcome: Outcome, cash: number) {
    openAll.current = false;
    busyRef.current = false;
    ticket.settle(cash);
    pushHistory(cash);
    put({ ...r, outcome, cash });
    setPhase('over');
  }

  /** Draws the next card now, shows it face up after one event. */
  function openNext(r: Round) {
    const cards = [...r.cards, drawCard(rng)];
    resolved.current = packValue(cards);
    put({ ...r, cards, shown: r.cards.length });
    setPhase('opening');
    timers.after(animRef.current, () => {
      const cur = { ...(roundRef.current as Round), shown: cards.length };
      if (cards.length >= CARDS) return finish(cur, 'full', packValue(cards));
      put({ ...cur, cash: packValue(cards) });
      if (openAll.current) return openNext(roundRef.current as Round);
      busyRef.current = false;
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: packValue(cards), winChance: chanceReturnsBet(cards) });
    });
  }

  async function start() {
    if (busyRef.current || live || bet.blocked || auto.running) return;
    busyRef.current = true;
    if (!(await ticket.place(bet.value))) {
      busyRef.current = false;
      return;
    }
    resolved.current = RTP;
    timers.clearAll();
    setAutoLast(null);
    openAll.current = false;
    openNext({ stake: bet.value, cards: [], shown: 0, outcome: null, cash: RTP });
  }

  function next() {
    if (phase !== 'checkpoint' || busyRef.current || !roundRef.current) return;
    busyRef.current = true;
    openNext(roundRef.current);
  }

  function all() {
    if (phase !== 'checkpoint' || busyRef.current || !roundRef.current) return;
    busyRef.current = true;
    openAll.current = true;
    openNext(roundRef.current);
  }

  function sell() {
    if (phase !== 'checkpoint' || busyRef.current || !roundRef.current) return;
    busyRef.current = true;
    finish(roundRef.current, 'sold', packValue(roundRef.current.cards));
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    roundRef.current = null;
    setRound(null);
    setAutoLast(null);
    setPhase('idle');
  }

  // Auto: one whole pack per bet, always opened in full.
  async function playOnce(stake: number): Promise<number | null> {
    if (busyRef.current) return null;
    busyRef.current = true;
    if (!(await ticket.place(stake))) {
      busyRef.current = false;
      return null;
    }
    const cards = Array.from({ length: CARDS }, () => drawCard(rng));
    const mult = sumCents(cards) / 100;
    resolved.current = mult;
    setPhase('opening');
    put({ stake, cards, shown: 0, outcome: null, cash: mult });
    await timers.wait(animRef.current);
    ticket.settle(mult);
    pushHistory(mult);
    put({ stake, cards, shown: CARDS, outcome: 'full', cash: mult });
    setAutoLast({ id: ++seq.current, mult, stake });
    setPhase('idle');
    busyRef.current = false;
    if (stopRank >= 0 && cards.some((c) => c.rank >= stopRank)) autoRef.current?.stop();
    return mult;
  }

  const auto = useAutoBet({ bet, play: playOnce, turbo: turbo.turbo });
  const autoRef = useRef(auto);
  autoRef.current = auto;
  animRef.current = eventMs(turbo.turbo || auto.running);

  useHotkeys(
    {
      space: () => (phase === 'checkpoint' ? next() : auto.mode === 'manual' && !live ? void start() : undefined),
      cashOut: sell,
    },
    !infoOpen,
  );

  const cards = round?.cards ?? [];
  const shown = round ? round.shown : 0;
  const opened = cards.slice(0, shown);
  const total = sumCents(opened);
  const chance = chanceReturnsBet(opened);
  const cash = round ? packValue(opened) : RTP;
  const stake = round?.stake ?? bet.value;

  let status = 'Open five cards, win their sum';
  if (phase === 'opening') status = auto.running ? 'Auto opening pack' : `Opening card ${cards.length} of ${CARDS}`;
  if (phase === 'checkpoint') status = `${opened.length} of ${CARDS} cards open`;
  if (phase === 'over' && round?.outcome === 'full') status = `Pack total ${fmtCents(total)}`;
  if (phase === 'over' && round?.outcome === 'sold') status = `Sold after ${opened.length} cards`;
  if (phase === 'idle' && autoLast) status = `Pack total ${fmtMult(autoLast.mult)}`;
  const tone = phase === 'over' ? (round && round.cash >= 1 ? 'won' : 'lost') : live ? 'live' : phase === 'idle' && autoLast ? (autoLast.mult >= 1 ? 'won' : 'lost') : 'idle';

  const tierRange = TIERS.map((_, i) => {
    const m = TABLE.filter((c) => c.rank === i).map((c) => c.cents);
    const lo = fmtCents(Math.min(...m));
    const hi = fmtCents(Math.max(...m));
    return lo === hi ? lo : `${lo}–${hi}`;
  });
  const left = CARDS - opened.length;
  const each = fmtMult(MEAN_CARD);
  let note = 'Win your bet times the cards total';
  if (phase === 'checkpoint') note = `Sell price: cards plus ${each} per unopened card`;
  if (phase === 'over' && round?.outcome === 'sold') note = `Paid cards plus ${each} for ${left} unopened`;
  if (phase === 'over' && round?.outcome === 'full') note = 'Paid your bet times the cards total';

  const busy = live || auto.running;
  const tierP = TIERS.map((_, i) => TABLE.filter((c) => c.rank === i).reduce((s, c) => s + c.p, 0));

  return (
    <GameLayout
      name="Booster"
      accent={ACCENTS.amber}
      panel={
        <>
          <ModeTabs auto={auto} disabled={live} />
          <BetField bet={bet} disabled={busy} />

          {auto.mode === 'manual' ? (
            phase === 'checkpoint' ? (
              <>
                <ActionButton kind="cash" onClick={sell}>
                  Sell the rest <span>{formatAmount(stake * cash, 2)}</span>
                </ActionButton>
                <ActionButton kind="secondary" onClick={next}>
                  Open next
                </ActionButton>
                <ActionButton kind="secondary" onClick={all}>
                  Open all
                </ActionButton>
              </>
            ) : (
              <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
                {phase === 'opening' ? 'Opening…' : phase === 'over' ? 'Bet again' : 'Bet'}
              </ActionButton>
            )
          ) : (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || live}>
              <Label hint="this tier or higher">Stop on card</Label>
              <Chips label="Stop on card tier" options={STOPS} value={stopRank} disabled={auto.running} onChange={(v) => setStopRank(Number(v))} />
            </AutoBetControls>
          )}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />

      <ChanceBar p={chance} label="Pack pays at least your bet" />

      <Readouts
        items={
          phase === 'idle' && !round
            ? [{ label: 'Best pack: 5 top cards', value: fmtMult(MAX_MULTIPLIER), tone: 'prize' }]
            : phase === 'checkpoint'
              ? [
                  { label: 'Cards total', value: fmtCents(total), tone: 'prize' },
                  { label: 'Sell price', value: fmtMult(cash) },
                ]
              : phase === 'over' && round?.outcome === 'sold'
                ? [
                    { label: 'Cards total', value: fmtCents(total) },
                    { label: 'Paid', value: fmtMult(round.cash), tone: 'prize' },
                  ]
                : [{ label: 'Cards total', value: fmtCents(total), tone: 'prize' }]
        }
      />

      <Board>
        <Pack cards={cards} shown={shown} opening={phase === 'opening'} ms={animRef.current} done={phase === 'over' || (phase === 'idle' && !!autoLast)} />
        {phase === 'idle' && auto.mode === 'auto' && autoLast && <InstantResult multiplier={autoLast.mult} stake={autoLast.stake} id={autoLast.id} />}
      </Board>

      <div className="pack-tiers" aria-label="Card tiers: multiplier and chance per card">
        {TIERS.map((n, i) => (
          <span key={n}>
            <b>{n}</b> {tierRange[i]} <em>{fmtChance(tierP[i])}</em>
          </span>
        ))}
      </div>
      <div className="pack-key">Each card: multiplier range, then chance</div>
      <div className="pack-key">{note}</div>

      {phase === 'over' && round?.outcome && (
        <RoundOver
          key={history[0]?.id}
          title={round.outcome === 'sold' ? 'Sold' : 'Pack opened'}
          multiplier={round.cash}
          stake={round.stake}
          nextBet={bet.value}
          blocked={bet.blocked}
          onBetAgain={() => void start()}
          onClear={clear}
          placement="inline"
        />
      )}
      <Caption>Bet times the sum of five cards.</Caption>

      {infoOpen && (
        <InfoModal title="Booster" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>Open a pack of five cards. Each card has a multiplier; you win your bet times the sum of all five.</p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Set your bet and press Bet. The first card opens.</li>
              <li>After each card, open the next, open all the rest, or sell the unopened cards for their fair value.</li>
              <li>Auto opens whole packs and can stop on a card tier, a profit or a loss. Auto and Turbo only change speed, never the odds.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The bar is the exact chance that the finished pack pays at least your bet ({fmtChance(probAtLeast(CARDS, 100))} before the first card). It
              updates after every card. Card chances, per card:
            </p>
            <table className="pack-odds">
              <tbody>
                {TABLE.map((c) => (
                  <tr key={c.cents}>
                    <td>{fmtCents(c.cents)}</td>
                    <td>{c.tier}</td>
                    <td>{fmtChance(c.p)}</td>
                    <td>{ONE_IN(c.p)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              Tiers: {TIERS.map((t, i) => `${t} ${fmtChance(tierP[i])}`).join(', ')}.
            </p>
          </InfoSection>
          <InfoSection title="Sell price and best pack">
            <p>
              Selling pays the cards already open plus {each} for each unopened card, because {each} is what one card pays on average. So the sell price can sit
              above the cards total. Best pack: five {fmtMult(MAX_MULTIPLIER / 5)} cards, {fmtMult(MAX_MULTIPLIER)}.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Cards are independent, so the pack's mean is five times a card's: 5 × {MEAN_CARD.toFixed(3)}× = {RTP.toFixed(2)}×. After k cards with sum S, the
              unopened cards are worth exactly their mean: sell value = S + (5 − k) × {MEAN_CARD.toFixed(3)}×. That value is a martingale.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Every way of opening and selling returns {(RTP * 100).toFixed(0)}% of stakes in the long run. Best possible pack: {fmtMult(MAX_MULTIPLIER)}.
              Packs often pay under your bet; about one in {(1 / probAtLeast(CARDS, 100)).toFixed(1)} pays at least that.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
