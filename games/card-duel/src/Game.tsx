import { formatAmount } from '@originals/game-sdk';
import { useHost } from '@originals/game-sdk/react';
import {
  ACCENTS,
  ActionButton,
  AutoBetControls,
  BetField,
  Board,
  Caption,
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
  VolBadge,
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
  type StatusTone,
} from '@originals/game-sdk/ui';
import { useEffect, useRef, useState } from 'react';
import Field, { type Spin } from './Board';
import {
  CASH_AT,
  RTP,
  SIZES,
  autoRound,
  duel,
  front,
  isYours,
  prizeFor,
  start as startCards,
  volatilityOf,
  winChance,
  winner,
  type Cards,
  type CashAt,
} from './math';

type Phase = 'idle' | 'spinning' | 'checkpoint' | 'over';
type Outcome = 'win' | 'lose' | 'cashed';

interface Round {
  n: number;
  prize: number;
  stake: number;
  cards: Cards;
  cash: number;
  outcome: Outcome | null;
}

interface Last {
  id: number;
  multiplier: number;
  stake: number;
}

const RULE = 'Knock out every house card before your cards run out.';

/** One short plain line saying what the last duel changed (always under 9 tokens). */
function duelLine(a: number, b: number, you: boolean): string {
  return you ? `Your ${a} beat ${b}: chance up` : `House ${b} beat your ${a}: chance down`;
}

function overTitle(r: Round): string {
  if (r.outcome === 'cashed') return 'Cashed out';
  return r.outcome === 'win' ? 'House row knocked out' : 'Your row ran out';
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);

  const [n, setN] = useState<number>(5);
  const [cashAt, setCashAt] = useState<CashAt>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [spin, setSpin] = useState<Spin | null>(null);
  const [line, setLine] = useState('');
  const [infoOpen, setInfoOpen] = useState(false);

  const [autoCards, setAutoCards] = useState<Cards | null>(null);
  const [autoN, setAutoN] = useState<number | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const [last, setLast] = useState<Last | null>(null);
  const seq = useRef(0);
  const restU = useRef(0);

  // The ticket reads only this ref, set synchronously at every transition (a
  // duel is decided the moment it is spun), never rendered state.
  const resolved = useRef(0);
  const ticket = useTicket(() => resolved.current);

  // Manual: the pointer spins for about 600 ms, then the cards slide for about
  // 400 ms; Turbo about 25% of that (docs/STYLE.md).
  const spinMs = eventMs(turbo.turbo, 700);
  const slideMs = turbo.turbo ? 120 : 450;
  const autoSpinMs = turbo.turbo ? 70 : 260;
  const live = phase === 'spinning' || phase === 'checkpoint';

  // ---------- Manual ----------

  function finish(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setPhase('over');
  }

  function nextDuel(r: Round) {
    const { a, b } = front(r.cards);
    const u = rng.next();
    const you = isYours(u, a, b);
    const cards = duel(r.cards, you);
    const w = winner(cards);
    const cash = w ? (w === 'you' ? r.prize : 0) : r.prize * winChance(cards);
    resolved.current = cash;
    const id = ++seq.current;
    const from = restU.current;
    restU.current = u;
    setSpin({ id, u, from, a, b, you, ms: spinMs, landed: false });
    setPhase('spinning');
    // The cards change only when the pointer stops, then slide to their places.
    timers.after(spinMs, () => {
      setSpin({ id, u, from, a, b, you, ms: spinMs, landed: true });
      const next = { ...r, cards, cash };
      setRound(next);
      timers.after(slideMs + 100, () => {
        if (w) {
          setLine('');
          return finish(next, w === 'you' ? 'win' : 'lose', cash);
        }
        setLine(duelLine(a, b, you));
        setPhase('checkpoint');
        track({ type: 'checkpoint', multiplier: cash, winChance: winChance(cards) });
      });
    });
  }

  async function startRound() {
    if (live || autoBusy || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    resolved.current = RTP;
    timers.clearAll();
    setAutoCards(null);
    setAutoN(null);
    setLast(null);
    const r: Round = { n, prize: prizeFor(n), stake: bet.value, cards: startCards(n), cash: RTP, outcome: null };
    setRound(r);
    nextDuel(r);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', round.cash);
  }

  function clear() {
    if (live || autoBusy) return;
    timers.clearAll();
    setRound(null);
    setSpin(null);
    setAutoCards(null);
    setAutoN(null);
    setLast(null);
    setLine('');
    restU.current = 0;
    setPhase('idle');
  }

  // Changing a setting after a round clears the finished board to a preview.
  function change(apply: () => void) {
    apply();
    if (phase === 'over' || autoCards || last) clear();
  }

  // ---------- Auto ----------

  async function playAuto(stake: number): Promise<number | null> {
    const size = n;
    if (!(await ticket.place(stake))) return null;
    const res = autoRound(size, cashAt, () => rng.next());
    resolved.current = res.multiplier;
    setAutoBusy(true);
    setRound(null);
    setPhase('idle');
    setLast(null);
    setAutoN(size);
    setAutoCards(startCards(size));
    for (const st of res.steps) {
      const id = ++seq.current;
      const from = restU.current;
      restU.current = st.u;
      setSpin({ id, u: st.u, from, a: st.a, b: st.b, you: st.you, ms: autoSpinMs, landed: false });
      if (!(await timers.wait(autoSpinMs))) break;
      setSpin({ id, u: st.u, from, a: st.a, b: st.b, you: st.you, ms: autoSpinMs, landed: true });
      setAutoCards(st.after);
      if (!(await timers.wait(autoSpinMs * 0.5))) break;
    }
    ticket.settle(res.multiplier);
    pushHistory(res.multiplier);
    setLast({ id: ++seq.current, multiplier: res.multiplier, stake });
    setAutoBusy(false);
    return res.multiplier;
  }

  const auto = useAutoBet({ bet, play: playAuto, turbo: turbo.turbo });
  const isAuto = auto.mode === 'auto';
  const locked = live || autoBusy || auto.running;

  // Switching Manual / Auto starts from a clean board.
  useEffect(() => {
    timers.clearAll();
    setRound(null);
    setAutoCards(null);
    setAutoN(null);
    setSpin(null);
    setLast(null);
    setLine('');
    restU.current = 0;
    setPhase('idle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto.mode]);

  useHotkeys(
    {
      space: () => {
        if (isAuto) {
          if (auto.running) auto.stop();
          else if (!autoBusy && !bet.blocked) auto.start();
          return;
        }
        if (phase === 'checkpoint' && round) nextDuel(round);
        else if (phase === 'idle' || phase === 'over') void startRound();
      },
      cashOut,
    },
    !infoOpen,
  );

  // ---------- What the board shows ----------

  const shownN = isAuto ? (autoN ?? n) : (round?.n ?? n);
  const cards = isAuto ? (autoCards ?? startCards(shownN)) : (round?.cards ?? startCards(shownN));
  const chance = winChance(cards);
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const over = isAuto ? !!last && !autoBusy : phase === 'over';
  const decided = winner(cards) !== null;
  const vol = volatilityOf(n);

  let status = 'Knock out the house row';
  let tone: StatusTone = 'idle';
  if (isAuto) {
    if (autoBusy || auto.running) {
      status = `Autobet${auto.remaining !== null ? ` · ${auto.remaining} left` : ''}`;
      tone = 'live';
    } else if (last) {
      status = `${last.multiplier > 0 ? 'Won' : 'Lost'} ${fmtMult(last.multiplier)}`;
      tone = last.multiplier > 0 ? 'won' : 'lost';
    }
  } else if (phase === 'spinning') {
    status = 'Spinning the duel…';
    tone = 'live';
  } else if (phase === 'checkpoint') {
    status = line;
    tone = 'live';
  } else if (phase === 'over' && round) {
    status = overTitle(round);
    tone = round.cash > 0 ? 'won' : 'lost';
  }

  return (
    <GameLayout
      name="Card Duel"
      accent={ACCENTS.violet}
      className="cd-game"
      panel={
        <>
          <ModeTabs auto={auto} disabled={live || autoBusy} />
          <BetField bet={bet} disabled={locked} />

          <Label hint={<VolBadge level={vol} />}>House cards</Label>
          <Chips
            label="House row size"
            options={SIZES.map((v) => ({ value: v, label: String(v), title: `The house has ${v} cards` }))}
            value={n}
            disabled={locked}
            onChange={(v) => change(() => setN(v))}
          />

          {!isAuto ? (
            phase === 'checkpoint' ? (
              <>
                <ActionButton kind="cash" onClick={cashOut}>
                  Cash out <span>{formatAmount(stake * cash, 2)}</span>
                </ActionButton>
                <ActionButton kind="secondary" onClick={() => round && nextDuel(round)}>
                  Next duel
                </ActionButton>
              </>
            ) : (
              <ActionButton disabled={live || !!bet.blocked} onClick={() => void startRound()}>
                {phase === 'spinning' ? 'Duelling…' : phase === 'over' ? 'Bet again' : 'Bet'}
              </ActionButton>
            )
          ) : (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || autoBusy}>
              <Label hint={cashAt === null ? 'until the round is decided' : `if it gets to ${fmtMult(cashAt)}`}>Cash out at</Label>
              <Chips
                label="Auto cash-out"
                options={CASH_AT.map((v) => ({ value: v ?? 0, label: v === null ? 'End' : `${v}×` }))}
                value={cashAt ?? 0}
                disabled={autoBusy || auto.running}
                onChange={(v) => change(() => setCashAt(v === 0 ? null : (v as CashAt)))}
              />
            </AutoBetControls>
          )}
          {bet.blocked && <p className="cd-blocked">{bet.blocked}</p>}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />

      <Readouts
        items={[
          { label: 'Win the round', value: fmtChance(chance), tone: 'chance' },
          { label: 'Prize', value: fmtMult(prizeFor(shownN)), tone: 'prize' },
        ]}
      />

      <Board className="cd-board">
        {isAuto && <InstantResult multiplier={last && !autoBusy ? last.multiplier : null} stake={last?.stake ?? 0} id={last?.id ?? 0} />}
        <Field
          cards={cards}
          chance={chance}
          spin={!isAuto && phase === 'idle' ? null : spin}
          first={front(startCards(shownN))}
          done={decided && over}
          slideMs={isAuto ? autoSpinMs : slideMs}
        />
        {!isAuto && phase === 'over' && round?.outcome && (
          <RoundOver
            key={history[0]?.id}
            title={overTitle(round)}
            multiplier={round.cash}
            stake={round.stake}
            nextBet={bet.value}
            blocked={bet.blocked}
            onBetAgain={() => void startRound()}
            onClear={clear}
            placement="center"
          />
        )}
      </Board>

      <Caption>{RULE}</Caption>

      {infoOpen && (
        <InfoModal title="Card Duel" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>Knock out every card in the house row before your own row runs out.</p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick how many cards the house has (3 to 10), then press Bet. Your cards are 2, 4, 6, 8, 10; the house's are 1, 3, 5, and so on.</li>
              <li>The two front cards duel on the spinner. The loser is out and the winner goes to the back of its row.</li>
              <li>After every duel you can cash out (C) or start the next duel (Space).</li>
              <li>Auto plays whole rounds with the bet and stop rules you set.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The spinner's green arc is your front card's share of the duel. The bottom bar is your chance to win the whole round; it rises when you win a
              duel (a house card is out) and falls when you lose one. The bar above it compares the sums of each side's card numbers and moves the same
              way on every duel, though your exact chance also depends on which cards are left. The order of the cards in a row does not change your
              chance.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              A duel between your a and their b goes your way with chance a / (a + b). Because that is a race of two exponential clocks, the chance to win the
              round depends only on which cards are left: W(S, H) = a/(a+b) · W(S, H without b) + b/(a+b) · W(S without a, H), with W(S, ∅) = 1 and W(∅, H)
              = 0, computed exactly. With the cards now on the board you win with {fmtChance(chance)}.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              A win pays {(RTP * 100).toFixed(0)}% ÷ P(win). The cash-out is the prize × your chance now, a martingale, so cashing out at any point or
              playing to the end both return exactly {(RTP * 100).toFixed(0)}% in the long run.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
