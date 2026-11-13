import { formatAmount } from '@originals/game-sdk';
import { useHost } from '@originals/game-sdk/react';
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
import Grid, { type Outcome } from './Board';
import manifest from './manifest';
import {
  FUSES,
  RTP,
  TARGETS,
  apply,
  
  cardName,
  cashOutFor,
  deckOf,
  drawCard,
  glowOf,
  laidCount,
  newlyDead,
  prizeFor,
  startChance,
  startState,
  verdict,
  volatilityOf,
  winChance,
  type State,
  type Target,
} from './math';

type Phase = 'idle' | 'drawing' | 'checkpoint' | 'over';

interface Round {
  k: Target;
  stake: number;
  state: State;
  /** The card turned last; stays marked until the next card lands. */
  last: number | null;
  lastLaid: boolean;
  /** Slots that turned grey because of the last burn. */
  greyed: number;
  /** The last burned card was already grey. */
  wasGrey: boolean;
  outcome: Outcome | null;
  paid: number;
}

interface Last {
  id: number;
  multiplier: number;
  stake: number;
}

const RULE = manifest.revision!.note;
const ACCENT = manifest.accent;
const AUTO_TARGETS = [0, 1.5, 2, 3, 5, 10];
const OUTCOME_TITLE: Record<Outcome, string> = { won: 'All laid', lost: 'Third fuse', cashed: 'Cashed out' };

const cardsWord = (n: number) => `${n} ${n === 1 ? 'card' : 'cards'}`;
const newRound = (k: Target, stake: number): Round => ({ k, stake, state: startState(), last: null, lastLaid: false, greyed: 0, wasGrey: false, outcome: null, paid: 0 });

/** The slots the draw passes over: a fixed stride through the deck, ending on the drawn card. */
function hopPath(left: readonly number[], card: number, hops: number): number[] {
  const m = left.length;
  if (m <= 1) return [card];
  const stride = [5, 7, 3, 1].find((s) => s % m !== 0 && gcd(s, m) === 1) ?? 1;
  const end = left.indexOf(card);
  return Array.from({ length: hops }, (_, i) => left[(((end - (hops - 1 - i) * stride) % m) + m) % m]);
}
const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);

  const [k, setK] = useState<Target>(3);
  const [target, setTarget] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [hop, setHop] = useState<number | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const [last, setLast] = useState<Last | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const seq = useRef(0);

  // Each card is drawn the moment its draw starts, so leaving mid-draw settles
  // at its real result, never at the value before it.
  const resolved = useRef(0);
  const ticket = useTicket(() =>
    phase === 'drawing' || autoBusy ? resolved.current : phase === 'checkpoint' && round ? cashOutFor(round.k, round.state) : 0,
  );

  const isAutoRef = useRef(false);
  const fast = turbo.turbo;
  // Slow on purpose: about 1.3 s per card in Manual, so every card can be followed.
  const drawMs = () => (isAutoRef.current ? (fast ? 150 : 700) : eventMs(fast) * 2.2);
  const hops = () => (fast ? 4 : 10);
  const live = phase === 'drawing' || phase === 'checkpoint';

  /** Draws one card and plays the draw. Resolves to the new round, or null if cancelled. */
  async function turnOnce(r: Round): Promise<Round | null> {
    const card = drawCard(rng.next(), r.state);
    const wasGrey = glowOf(r.state).dead.includes(card);
    const greyed = newlyDead(r.state, card).length;
    const { state, laid } = apply(r.state, card);
    const v = verdict(r.k, state);
    resolved.current = v === 'won' ? prizeFor(r.k) : v === 'lost' ? 0 : cashOutFor(r.k, state);

    // The draw slows down as it passes over the deck and lands on the drawn slot.
    const path = hopPath(deckOf(r.state), card, hops());
    const weights = path.map((_, i) => 1 + i * 0.35);
    const total = weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < path.length; i++) {
      setHop(path[i]);
      if (!(await timers.wait((drawMs() * weights[i]) / total))) return null;
    }
    setHop(null);
    const next: Round = { ...r, state, last: card, lastLaid: laid, greyed: laid ? 0 : greyed, wasGrey: !laid && wasGrey };
    setRound(next);
    return next;
  }

  /** Turns one card; a round ends only on the k-th laid card or the third fuse. */
  async function advance(r: Round): Promise<Round | null> {
    const next = await turnOnce(r);
    if (!next) return null;
    const v = verdict(next.k, next.state);
    if (v === 'won') return { ...next, outcome: 'won', paid: prizeFor(next.k) };
    if (v === 'lost') return { ...next, outcome: 'lost', paid: 0 };
    return next;
  }

  // ---------- Manual round ----------

  function finish(r: Round) {
    ticket.settle(r.paid);
    pushHistory(r.paid);
    setRound(r);
    setPhase('over');
  }

  async function play(r: Round) {
    setPhase('drawing');
    const next = await advance(r);
    if (!next) return;
    if (next.outcome) return finish(next);
    setRound(next);
    setPhase('checkpoint');
    track({ type: 'checkpoint', multiplier: cashOutFor(next.k, next.state), winChance: winChance(next.k, next.state) });
  }

  async function start() {
    if (live || autoBusy || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    setLast(null);
    resolved.current = RTP;
    const r = newRound(k, bet.value);
    setRound(r);
    void play(r);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    finish({ ...round, outcome: 'cashed', paid: cashOutFor(round.k, round.state) });
  }

  function clear() {
    if (live || autoBusy) return;
    timers.clearAll();
    setRound(null);
    setHop(null);
    setLast(null);
    setPhase('idle');
  }

  // ---------- Auto ----------

  async function playAuto(stake: number): Promise<number | null> {
    const kk = k;
    const tgt = target;
    if (!(await ticket.place(stake))) return null;
    setAutoBusy(true);
    setLast(null);
    resolved.current = RTP;
    let r = newRound(kk, stake);
    setRound(r);
    setPhase('drawing');
    for (;;) {
      const next = await advance(r);
      if (!next) return null;
      r = next;
      if (r.outcome) break;
      const cash = cashOutFor(kk, r.state);
      if (tgt > 0 && cash >= tgt - 1e-12) {
        r = { ...r, outcome: 'cashed', paid: cash };
        break;
      }
      if (!(await timers.wait(fast ? 60 : 300))) return null;
    }
    ticket.settle(r.paid);
    pushHistory(r.paid);
    setRound(r);
    setPhase('over');
    setLast({ id: ++seq.current, multiplier: r.paid, stake });
    setAutoBusy(false);
    return r.paid;
  }

  const auto = useAutoBet({ bet, play: playAuto, turbo: turbo.turbo });
  const isAuto = auto.mode === 'auto';
  isAutoRef.current = isAuto;
  const busy = live || autoBusy || auto.running;

  // Switching Manual / Auto starts from a clean board.
  useEffect(() => {
    timers.clearAll();
    setRound(null);
    setLast(null);
    setHop(null);
    setPhase('idle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto.mode]);

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    if (busy) return;
    apply();
    if (phase === 'over') clear();
  };

  useHotkeys(
    {
      space: () => {
        if (isAuto) {
          if (auto.running) auto.stop();
          else if (!autoBusy && !bet.blocked) auto.start();
          return;
        }
        if (phase === 'checkpoint' && round) void play(round);
        else if (phase === 'idle' || phase === 'over') void start();
      },
      cashOut: () => (!isAuto ? cashOut() : undefined),
    },
    !infoOpen,
  );

  // ---------- What the board shows ----------

  const r: Round = round ?? newRound(k, bet.value);
  const outcome = phase === 'over' ? r.outcome : null;
  const undecided = live || (autoBusy && !outcome);
  const p = outcome === 'won' ? 1 : outcome === 'lost' ? 0 : winChance(r.k, r.state);
  const prize = prizeFor(r.k);
  const cash = outcome ? r.paid : prize * p;
  const stake = r.stake;
  const glow = glowOf(r.state);
  const laid = laidCount(r.state);

  const p0 = startChance(k);
  const prize0 = prizeFor(k);
  const vol = volatilityOf(k);

  // One short plain line per card: what happened and why the chance moved.
  const name = r.last !== null ? cardName(r.last) : '';
  const landed = r.lastLaid ? `${name} laid, chance up` : r.wasGrey ? `${name} was grey: fuse lost, chance down` : r.greyed > 0 ? `${name} burned: beyond turns grey, chance down` : `${name} burned: fuse lost, chance down`;
  let status = `Ready: lay ${cardsWord(k)}`;
  let tone: StatusTone = 'idle';
  if (phase === 'drawing' && r.last === null) {
    status = 'Turning a card…';
    tone = 'live';
  } else if (phase === 'drawing' || phase === 'checkpoint') {
    status = phase === 'drawing' ? 'Turning a card…' : landed;
    tone = 'live';
  } else if (phase === 'over' && outcome) {
    status = outcome === 'won' ? `${name} laid: all ${k} laid` : outcome === 'cashed' ? `Cashed out with ${laid} of ${k} laid` : `${name} burned: third fuse`;
    tone = r.paid > 0 ? 'won' : 'lost';
  } else if (isAuto && auto.running) {
    status = `Autobet${auto.remaining !== null ? ` · ${auto.remaining} left` : ''}`;
    tone = 'live';
  }
  if (undecided && phase === 'drawing' && r.last !== null) status = 'Turning a card…';

  return (
    <GameLayout
      name="Fan Out"
      accent={ACCENT}
      panel={
        <>
          <ModeTabs auto={auto} disabled={live || autoBusy} />
          <BetField bet={bet} disabled={busy} />

          <Label hint={<VolBadge level={vol} />}>Cards to lay</Label>
          <Chips
            label="Cards to lay"
            options={TARGETS.map((v) => ({ value: v, label: v, title: `${fmtChance(startChance(v))} to win` }))}
            value={k}
            disabled={busy}
            onChange={(v) => change(() => setK(v))}
          />

          {!isAuto ? (
            <>
              {phase === 'checkpoint' && round ? (
                <>
                  <ActionButton kind="cash" onClick={cashOut}>
                    Cash out <span>{formatAmount(stake * cash, 2)}</span>
                  </ActionButton>
                  <ActionButton kind="secondary" onClick={() => void play(round)}>
                    {`Turn next: ${glow.lay.length} of ${glow.left} lay`}
                  </ActionButton>
                </>
              ) : (
                <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
                  {phase === 'drawing' ? 'Turning…' : phase === 'over' ? 'Bet again' : 'Bet'}
                </ActionButton>
              )}
            </>
          ) : (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || autoBusy}>
              <Label hint={target > 0 && target >= prize0 ? 'above the prize: plays to the end' : undefined}>Cash out at</Label>
              <Chips
                label="Auto cash-out"
                options={AUTO_TARGETS.map((t) => ({ value: t, label: t === 0 ? 'End' : `${t}×` }))}
                value={target}
                disabled={busy}
                onChange={(t) => {
                  setTarget(t);
                  if (phase === 'over' && !busy) clear();
                }}
              />
            </AutoBetControls>
          )}
          {bet.blocked && <p className="fanout-note">{bet.blocked}</p>}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />
      <ChanceBar p={round ? p : p0} label={outcome ? 'Win chance (round over)' : 'Win chance'} />
      <Readouts items={[{ label: 'Prize', value: fmtMult(prize), tone: 'prize' }]} />

      <Board className={'fanout-board' + (isAuto ? ' auto' : '')}>
        {isAuto && <InstantResult multiplier={last && !autoBusy ? last.multiplier : null} stake={last?.stake ?? 0} id={last?.id ?? 0} />}
        <Grid k={r.k} state={r.state} last={r.last} hop={hop} p={p} />
      </Board>

      {!isAuto && phase === 'over' && round?.outcome && (
        <RoundOver
          key={history[0]?.id}
          title={OUTCOME_TITLE[round.outcome]}
          multiplier={round.paid}
          stake={round.stake}
          nextBet={bet.value}
          blocked={bet.blocked}
          onBetAgain={() => void start()}
          onClear={clear}
          placement="inline"
        />
      )}
      <Caption>Lay cards next to the row ends before three fuses burn.</Caption>

      {infoOpen && (
        <InfoModal title="Fan Out" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>{RULE}</p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>The grid is Sevens cut down: 4 suits, ranks 1 to 7. The four 4s start laid, and the other 24 cards are the deck. An empty slot is a card still in the deck.</li>
              <li>Pick how many cards to lay (1, 2, 3, 5 or 8), then Bet. A card is turned at random.</li>
              <li>A card next to the end of its suit's laid row is laid. Any other card burns a fuse. Three fuses burn and the round is lost.</li>
              <li>A burned card can never be laid, so every empty slot beyond it on that row turns grey: it burns a fuse whenever it is turned.</li>
              <li>After every card you can cash out (C) or turn the next card (Space). Lay your target number and the prize is paid at once.</li>
              <li>Auto plays whole rounds and cashes out once the round is worth your target (or plays to the end with End).</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The green slots are the cards that would be laid now. The next card is equally likely to be any empty slot, so green over empty slots is
              exactly the chance the next card lays. A laid card opens a new green slot and thins the deck, so the win chance rises. A burned card costs a fuse and
              greys the slots beyond it, so the win chance falls. The bar above the board is the chance of the whole bet.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              The win chance is an exact recursion over each row side: with t cards to lay, f fuses left and m cards in the deck, P(t, f) = (1/m) · (sum over
              green cards of P(t − 1, f) + sum over every other card of P(t, f − 1)), P = 1 at t = 0 and P = 0 at f = 0. At the start:{' '}
              {TARGETS.map((v) => `${fmtChance(startChance(v))} for ${v}`).join(', ')} cards.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Prize = {(RTP * 100).toFixed(0)}% ÷ your chance at the start. Cash-out = prize × your chance now. The recursion says your chance now is the
              average of your chance after the next card, so every card is a fair bet and any cash-out rule returns {(RTP * 100).toFixed(0)}% in the long run.
              No round ends before a card is turned and shown. The largest prize is {fmtMult(prizeFor(8))} for 8 cards, with {FUSES} fuses.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
