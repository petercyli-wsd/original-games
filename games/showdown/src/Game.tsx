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
import Field, { type FlipView } from './Board';
import {
  CASH_AT,
  HOUSE,
  N,
  RTP,
  START,
  TARGETS,
  YOU,
  autoRound,
  beats,
  chanceOf,
  drawPair,
  houseNeeds,
  play,
  prizeFor,
  reasonFor,
  reasonText,
  ruleFor,
  settled,
  volatilityOf,
  type CashAt,
  type Flip,
  type State,
  type Target,
} from './math';

type Phase = 'idle' | 'flipping' | 'checkpoint' | 'over';
type Outcome = 'win' | 'lose' | 'cashed';

interface Round {
  k: Target;
  prize: number;
  stake: number;
  s: State;
  cash: number;
  outcome: Outcome | null;
}

interface AutoView {
  k: Target;
  s: State;
}

interface Last {
  id: number;
  multiplier: number;
  stake: number;
}

const ACCENT = ACCENTS.blue;

// A word joiner after the dash keeps a score like 2–2 on one line when text wraps.
const score = (s: State) => `${s.wins}–\u2060${s.losses}`;

/**
 * What ended the series. When the cards left settle it before the tally does,
 * the round stops there and the long title says which cards make it certain.
 */
function overTitle(outcome: Outcome, k: number, s: State, long = false): string {
  if (outcome === 'cashed') return 'Cashed out';
  const word = outcome === 'win' ? 'Won' : 'Lost';
  const why = reasonFor(s, k);
  if (why) return long ? `${word}: ${reasonText(why)}` : `${word} at ${score(s)}: the cards left settle it`;
  return outcome === 'win' ? `You took ${k} rounds` : `The house took ${houseNeeds(k)}`;
}

const tally = (s: State) => `You ${score(s)} House`;

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);

  const [k, setK] = useState<Target>(4);
  const [cashAt, setCashAt] = useState<CashAt>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [flip, setFlip] = useState<FlipView | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  const [autoView, setAutoView] = useState<AutoView | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  // A flip is on screen but not yet applied to the board (Auto).
  const [animFlip, setAnimFlip] = useState(false);
  const [last, setLast] = useState<Last | null>(null);
  const seq = useRef(0);

  // A flip is decided the moment it starts, so leaving mid-flip settles at
  // its real result, never at the pre-flip value.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'flipping' || autoBusy ? resolved.current : round && !round.outcome ? round.cash : 0));

  const flipMs = eventMs(turbo.turbo);
  const autoFlipMs = turbo.turbo ? 90 : 360;
  const live = phase === 'flipping' || phase === 'checkpoint';

  // ---------- Manual ----------

  function finish(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setPhase('over');
  }

  /** Shows one Auto flip, then applies it. Resolves false if the board was cleared meanwhile. */
  async function showFlip(f: Flip, ms: number, apply: (s: State) => void) {
    const id = ++seq.current;
    const win = beats(f.i, f.j);
    setAnimFlip(true);
    setFlip({ i: f.i, j: f.j, win, revealed: false, id });
    if (!(await timers.wait(ms * 0.35))) return false;
    setFlip({ i: f.i, j: f.j, win, revealed: true, id });
    if (!(await timers.wait(ms * 0.65))) return false;
    setAnimFlip(false);
    apply(f.s);
    return true;
  }

  function flipNext(r: Round) {
    const { i, j } = drawPair(r.s, rng.next(), rng.next());
    const s = play(r.s, i, j);
    const res = settled(s, r.k);
    const cash = res ? (res === 'win' ? r.prize : 0) : r.prize * chanceOf(s, r.k);
    resolved.current = cash;
    const id = ++seq.current;
    const win = beats(i, j);
    setFlip({ i, j, win, revealed: false, id });
    setPhase('flipping');
    timers.after(flipMs * 0.4, () => setFlip({ i, j, win, revealed: true, id }));
    timers.after(flipMs, () => {
      const next = { ...r, s, cash };
      // Settled by the tally or by the cards left: either way the round ends here.
      if (res) return finish(next, res, cash);
      setRound(next);
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: cash, winChance: chanceOf(s, r.k) });
    });
  }

  async function start() {
    if (live || autoBusy || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    setAutoView(null);
    setLast(null);
    const r: Round = { k, prize: prizeFor(k), stake: bet.value, s: START, cash: RTP, outcome: null };
    setRound(r);
    flipNext(r);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', round.cash);
  }

  function clear() {
    if (live || autoBusy) return;
    timers.clearAll();
    setRound(null);
    setFlip(null);
    setAutoView(null);
    setLast(null);
    setPhase('idle');
  }

  // Changing a setting after a round clears the finished board to a preview.
  function change(apply: () => void) {
    apply();
    if (phase === 'over' || autoView || last) clear();
  }

  // ---------- Auto ----------

  async function playAuto(stake: number): Promise<number | null> {
    const target = k;
    if (!(await ticket.place(stake))) return null;
    const res = autoRound(target, cashAt, () => rng.next());
    resolved.current = res.multiplier;
    setAutoBusy(true);
    setRound(null);
    setPhase('idle');
    setLast(null);
    setAutoView({ k: target, s: START });
    for (const f of res.flips) {
      if (!(await showFlip(f, autoFlipMs, (s) => setAutoView({ k: target, s })))) break;
    }
    setAnimFlip(false);
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
    setAutoView(null);
    setFlip(null);
    setLast(null);
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
        if (phase === 'checkpoint' && round) flipNext(round);
        else if (phase === 'idle' || phase === 'over') void start();
      },
      cashOut,
    },
    !infoOpen,
  );

  // ---------- What the board shows ----------

  const shownK = isAuto ? (autoView?.k ?? k) : (round?.k ?? k);
  const s = isAuto ? (autoView?.s ?? START) : (round?.s ?? START);
  const flipping = phase === 'flipping' || animFlip;
  const over = isAuto ? !!last && !autoBusy : phase === 'over';
  const prize = isAuto ? prizeFor(shownK) : (round?.prize ?? prizeFor(k));
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  // The bar: the live chance; when cashed, the chance you sold at.
  const chance = chanceOf(s, shownK);
  const barP = !isAuto && phase === 'over' && round ? (round.outcome === 'cashed' ? round.cash / round.prize : round.outcome === 'win' ? 1 : 0) : chance;
  // A manual series the cards left settled: its end card names those cards, so it
  // sits under the board instead of over it, keeping the hands it talks about in view.
  const early = !isAuto && phase === 'over' && !!round && !!reasonFor(s, round.k);
  const endCard = !isAuto && phase === 'over' && round?.outcome && (
    <RoundOver
      key={history[0]?.id}
      title={overTitle(round.outcome, round.k, s, true)}
      multiplier={round.cash}
      stake={round.stake}
      nextBet={bet.value}
      blocked={bet.blocked}
      onBetAgain={() => void start()}
      onClear={clear}
      placement={early ? 'inline' : 'center'}
    />
  );
  const vol = volatilityOf(k);
  const played = s.wins + s.losses;

  let status = `Ready · take ${k} of ${N} rounds`;
  let tone: StatusTone = 'idle';
  if (isAuto) {
    if (autoBusy || auto.running) {
      status = `Autobet${auto.remaining !== null ? ` · ${auto.remaining} left` : ''} · ${tally(s)}`;
      tone = 'live';
    } else if (last) {
      status = `${last.multiplier > 0 ? 'Won' : 'Lost'} ${fmtMult(last.multiplier)} · ${tally(s)}`;
      tone = last.multiplier > 0 ? 'won' : 'lost';
    } else status = `Auto · take ${k} of ${N}, ${cashAt === null ? 'play to the end' : `cash out at ${fmtMult(cashAt)}`}`;
  } else if (phase === 'flipping') {
    status = `Round ${played + 1} of ${N} · flipping…`;
    tone = 'live';
  } else if (phase === 'checkpoint') {
    status = `Round ${played} done · ${tally(s)}`;
    tone = 'live';
  } else if (phase === 'over' && round?.outcome) {
    status = reasonFor(s, round.k)
      ? `${round.outcome === 'win' ? 'Won' : 'Lost'} early · ${tally(s)}`
      : `${overTitle(round.outcome, round.k, s)} · ${tally(s)}`;
    tone = round.cash > 0 ? 'won' : 'lost';
  }

  return (
    <GameLayout
      name="Showdown"
      accent={ACCENT}
      className="sd-game"
      panel={
        <>
          <ModeTabs auto={auto} disabled={live || autoBusy} />
          <BetField bet={bet} disabled={locked} />

          <Label hint={<VolBadge level={vol} />}>Rounds to take</Label>
          <Chips
            label="Rounds to take"
            options={TARGETS.map((v) => ({ value: v, label: `${v} of 7`, title: `pays ${fmtMult(prizeFor(v))}` }))}
            value={k}
            disabled={locked}
            onChange={(v) => change(() => setK(v))}
          />

          {!isAuto ? (
            <>
              {phase === 'checkpoint' ? (
                <>
                  <ActionButton kind="cash" onClick={cashOut}>
                    Cash out <span>{formatAmount(stake * cash, 2)}</span>
                  </ActionButton>
                  <ActionButton kind="secondary" onClick={() => round && flipNext(round)}>
                    Flip next
                  </ActionButton>
                </>
              ) : (
                <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
                  {phase === 'flipping' ? 'Flipping…' : phase === 'over' ? 'Bet again' : 'Bet'}
                </ActionButton>
              )}
            </>
          ) : (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || autoBusy}>
              <Label hint={cashAt === null ? 'until the series settles' : `once it reaches ${fmtMult(cashAt)}`}>Cash out at</Label>
              <Chips
                label="Auto cash-out"
                options={CASH_AT.map((v) => ({ value: v ?? 0, label: v === null ? 'End' : `${v}×` }))}
                value={cashAt ?? 0}
                disabled={autoBusy || auto.running}
                onChange={(v) => change(() => setCashAt(v === 0 ? null : (v as CashAt)))}
              />
            </AutoBetControls>
          )}
          {bet.blocked && <p className="sd-blocked">{bet.blocked}</p>}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />

      <Readouts
        items={[
          {
            label: 'Chance to win',
            value: fmtChance(over ? barP : chance),
            tone: 'chance',
          },
          {
            label: 'Prize',
            value: fmtMult(prize),
            tone: 'prize',
          },
        ]}
      />

      <Board className={'sd-board' + (isAuto ? ' auto' : '')}>
        {isAuto && <InstantResult multiplier={last && !autoBusy ? last.multiplier : null} stake={last?.stake ?? 0} id={last?.id ?? 0} />}
        <Field
          s={s}
          k={shownK}
          flip={flip}
          flipping={flipping}
          over={over}
          p={barP}
          overTitle={
            isAuto
              ? last
                ? overTitle(last.multiplier >= prize - 1e-12 ? 'win' : last.multiplier > 0 ? 'cashed' : 'lose', shownK, s)
                : undefined
              : round?.outcome
                ? overTitle(round.outcome, round.k, s)
                : undefined
          }
        />
        {!early && endCard}
      </Board>

      {early && endCard}
      <Caption>{`Take ${shownK} of the 7 rounds; the higher card wins each round.`}</Caption>

      {infoOpen && (
        <InfoModal title="Showdown" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              {ruleFor(shownK)} Your face-down pile holds the even cards {YOU.join(', ')}; the house's holds the odd cards {HOUSE.join(', ')}, so there are
              never ties. A played card is gone for the rest of the series.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>
                Choose how many of the 7 rounds you need to take ({TARGETS[0]} to {TARGETS[TARGETS.length - 1]}), then press Bet. The first round is flipped
                straight away.
              </li>
              <li>After every round you can cash out (C) or flip the next round (Space). Nobody chooses a card: both piles are shuffled and face down.</li>
              <li>
                The series ends as soon as it is certain: when you reach your target, when the house has taken too many, or when the cards left can only go one
                way. In that last case no more cards are flipped, and the result names the cards that make it certain (for example, the house's 13 and 11 beat
                every card you have left).              </li>
              <li>Auto plays whole series with the bet and stop rules you set, cashing out when the cash-out reaches your target (or playing to the end).</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The two rows under the piles are both hands, every card placed at its value on one line, so a card beats everything to its left in the other
              row. Played cards stay as grey outlines, and the last pair is outlined green or red. That is the whole cause of your odds: winning a round with your 14 takes the round but spends your
              best card, so your chance to win the series can drop even after a win. Losing your 2 to the house's 13 costs you a round but strips the house's
              best card.
            </p>
            <p>
              The bar on the board and the chance above it are your exact chance to win the whole series from the cards left. Each of your cards left is
              equally likely to meet each of the house's, so your chance to take the next round is the share of those pairings where your card is higher.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Exchangeability of a random matching: flipping both piles to the end pairs your cards with the house's by a uniformly random bijection, whatever
              order the pairs come out in. So from any position the chance W(A, H, r) that the cards left (A yours, H the house's) give you r more rounds is
              computed exactly by fixing one of your cards a and averaging over its partner: W(A, H, r) = (1/|A|) Σ<sub>b∈H</sub> W(A − a, H − b, r − [a &gt; b]).
              From the start that gives {TARGETS.map((v) => `${fmtChance(chanceOf(START, v))} for ${v}`).join(', ')}.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Needing a target with chance P pays {(RTP * 100).toFixed(0)}% ÷ P. The cash-out is the prize × your chance now. Your chance now is the average of
              your chance after each of the next round's equally likely pairings, so the cash-out is a martingale: cashing out at any point, or playing to the
              end, returns exactly {(RTP * 100).toFixed(0)}% in the long run. The biggest prize is {fmtMult(prizeFor(6))}.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
