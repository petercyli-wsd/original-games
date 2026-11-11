import { formatAmount } from '@originals/game-sdk';
import { useHost } from '@originals/game-sdk/react';
import {
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
  type ReadoutItem,
  type StatusTone,
} from '@originals/game-sdk/ui';
import { useEffect, useRef, useState } from 'react';
import Grid, { cardName, type Outcome } from './Board';
import manifest from './manifest';
import {
  RTP,
  TURNS,
  bit,
  cashOutFor,
  drawCard,
  nextCards,
  onCross,
  prizeFor,
  remaining,
  safeShare,
  startChance,
  turnsLeft,
  volatilityOf,
  winChance,
  type Turns,
} from './math';

type Phase = 'idle' | 'drawing' | 'checkpoint' | 'over';

interface Round {
  k: Turns;
  stake: number;
  /** Cards turned, in order; the last one is the current card. */
  order: number[];
  /** The card that landed on the cross and ended the round. */
  hit: number | null;
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
const OUTCOME_TITLE: Record<Outcome, string> = { won: 'Survived', lost: 'Crossed', cashed: 'Cashed out', dead: 'Dead end' };

const maskOf = (order: readonly number[]) => order.reduce((a, c) => a | bit(c), 0);
const turnsWord = (n: number) => `${n} ${n === 1 ? 'turn' : 'turns'}`;
const newRound = (k: Turns, stake: number): Round => ({ k, stake, order: [], hit: null, outcome: null, paid: 0 });

/** The cells the draw passes over: a fixed stride through the cards left, ending on the drawn card. */
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

  const [k, setK] = useState<Turns>(3);
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
    phase === 'drawing' || autoBusy ? resolved.current : phase === 'checkpoint' && round ? cashOutFor(round.k, round.order) : 0,
  );

  const isAutoRef = useRef(false);
  const fast = turbo.turbo;
  const drawMs = () => (isAutoRef.current ? (fast ? 130 : 520) : eventMs(fast));
  const hops = () => (fast ? 4 : 9);
  const live = phase === 'drawing' || phase === 'checkpoint';

  /** Draws one card and plays the draw. Resolves to the new round, or null if cancelled. */
  async function turnOnce(r: Round): Promise<Round | null> {
    const mask = maskOf(r.order);
    const card = drawCard(rng.next(), mask);
    const first = r.order.length === 0;
    const killer = !first && onCross(r.order[r.order.length - 1], card);
    const order = killer ? r.order : [...r.order, card];
    resolved.current = killer ? 0 : order.length - 1 >= r.k ? prizeFor(r.k) : cashOutFor(r.k, order);

    // The draw slows down as it passes over the cards left and lands on the drawn one.
    // The free first card only sets the first cross, so its draw is quicker.
    const ms = first ? drawMs() * 0.45 : drawMs();
    const path = hopPath(remaining(mask), card, first ? Math.ceil(hops() / 2) : hops());
    const weights = path.map((_, i) => 1 + i * 0.35);
    const total = weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < path.length; i++) {
      setHop(path[i]);
      if (!(await timers.wait((ms * weights[i]) / total))) return null;
    }
    setHop(null);
    const next: Round = { ...r, order, hit: killer ? card : null };
    setRound(next);
    return next;
  }

  /** Turns cards until the next checkpoint or the end of the round. */
  async function advance(r: Round): Promise<Round | null> {
    let cur = r;
    for (;;) {
      const next = await turnOnce(cur);
      if (!next) return null;
      if (next.hit !== null) return { ...next, outcome: 'lost', paid: 0 };
      const done = next.order.length - 1;
      if (done >= next.k) return { ...next, outcome: 'won', paid: prizeFor(next.k) };
      const p = winChance(next.k, next.order);
      if (p <= 0) return { ...next, outcome: 'dead', paid: 0 };
      // A checkpoint after every survived turn, unless the rest is certain.
      if (done >= 1 && p < 1 - 1e-12) return next;
      if (!(await timers.wait(fast ? 50 : 160))) return null;
      cur = next;
    }
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
    track({ type: 'checkpoint', multiplier: cashOutFor(next.k, next.order), winChance: winChance(next.k, next.order) });
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
    finish({ ...round, outcome: 'cashed', paid: cashOutFor(round.k, round.order) });
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
      const cash = cashOutFor(kk, r.order);
      if (tgt > 0 && cash >= tgt - 1e-12) {
        r = { ...r, outcome: 'cashed', paid: cash };
        break;
      }
      if (!(await timers.wait(fast ? 60 : 200))) return null;
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
  const started = r.order.length > 0;
  const undecided = live || (autoBusy && !outcome);
  const p = outcome === 'won' ? 1 : outcome === 'lost' || outcome === 'dead' ? 0 : winChance(r.k, r.order);
  const prize = prizeFor(r.k);
  const cash = outcome ? r.paid : prize * p;
  const stake = r.stake;
  const options = undecided && started ? nextCards(r.k, r.order) : null;
  const share = started ? safeShare(r.order) : null;
  const toGo = started ? turnsLeft(r.k, r.order.length) : r.k;
  const survived = Math.max(0, r.order.length - 1);

  const p0 = startChance(k);
  const prize0 = prizeFor(k);
  const vol = volatilityOf(k);

  let status = `Ready · survive ${turnsWord(k)}`;
  let tone: StatusTone = 'idle';
  if (phase === 'drawing') {
    status = `${isAuto ? 'Autobet · ' : ''}${started ? `Turn ${survived + 1} of ${r.k}…` : 'Turning the first card…'}`;
    tone = 'live';
  } else if (phase === 'checkpoint') {
    status = `Survived ${survived} of ${r.k} · ${turnsWord(toGo)} to go`;
    tone = 'live';
  } else if (phase === 'over' && outcome) {
    const hitName = r.hit !== null ? cardName(r.hit) : '';
    status =
      outcome === 'won'
        ? r.k === 1
          ? 'Survived the turn'
          : `Survived all ${r.k} turns`
        : outcome === 'cashed'
          ? `Cashed out after ${turnsWord(survived)}`
          : outcome === 'dead'
            ? `Dead end after ${turnsWord(survived)}`
            : `Crossed on turn ${survived + 1} · ${hitName}`;
    tone = r.paid > 0 ? 'won' : 'lost';
  } else if (isAuto && auto.running) {
    status = `Autobet${auto.remaining !== null ? ` · ${auto.remaining} left` : ''}`;
    tone = 'live';
  }

  const readouts: ReadoutItem[] = [
    { label: 'Win chance', value: fmtChance(round ? p : p0), tone: 'chance' },
    { label: 'Prize', value: fmtMult(prize), tone: 'prize' },
  ];

  const nextLabel = share ? (share.safe === share.left ? 'free' : `${share.safe} of ${share.left} safe`) : '';

  return (
    <GameLayout
      name="Cross"
      accent={ACCENT}
      panel={
        <>
          <ModeTabs auto={auto} disabled={live || autoBusy} />
          <BetField bet={bet} disabled={busy} />

          <Label hint={<VolBadge level={vol} />}>Turns to survive</Label>
          <Chips
            label="Turns to survive"
            options={TURNS.map((v) => ({ value: v, label: v, title: `${fmtChance(startChance(v))} to win` }))}
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
                    Turn next · {nextLabel}
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
          {bet.blocked && <p className="cross-note">{bet.blocked}</p>}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />
      <Readouts items={readouts} />

      <Board className={'cross-board' + (isAuto ? ' auto' : '')}>
        {isAuto && <InstantResult multiplier={last && !autoBusy ? last.multiplier : null} stake={last?.stake ?? 0} id={last?.id ?? 0} />}
        <Grid k={r.k} order={r.order} hit={r.hit} hop={hop} options={options} p={p} outcome={outcome} />
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
      <Caption>Win if every card turned misses the last card’s colour and shape.</Caption>

      {infoOpen && (
        <InfoModal title="Cross" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>{RULE}</p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>The grid is the whole deck: 12 cards, one per colour (row: light, grey or outline) and shape (column).</li>
              <li>Pick how many turns to survive (1, 2, 3, 5 or 8), then Bet. The first card is turned for free, then turn 1 follows at once.</li>
              <li>Each turned card leaves the grid. The next card must not share the last card's colour or shape, or the round is lost.</li>
              <li>After every survived turn you can cash out (C) or turn the next card (Space). Survive every turn and the prize is paid at once.</li>
              <li>Auto plays whole rounds and cashes out once the round is worth your target (or plays to the end with End).</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The cross is the last card's row and column. Cards in it, outlined red, end the round; the cards outlined green are safe. The next card
              is equally likely to be any card left, so green over cards left is exactly the chance the next turn is safe.
            </p>
            <p>
              A card whose own row and column are nearly used up makes a small cross, so it raises your chance; a card with a full row and column makes
              a big one. The win chance is the average over all the cards left, red ones counting 0.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              The win chance is an exact recursion over the cards turned and the current card: with t turns to go and m cards left,
              P(t) = (1/m) · Σ P(t − 1 | that card next), over the green cards, and P(0) = 1. By the grid's symmetry the start does not depend on the first
              card: {TURNS.map((v) => `${fmtChance(startChance(v))} for ${v}`).join(', ')} turns.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Prize = {(RTP * 100).toFixed(0)}% ÷ your chance at the start. Cash-out = prize × your chance now. The recursion says your chance now is the
              average of your chance after the next card, so every turn is a fair bet and any cash-out rule returns {(RTP * 100).toFixed(0)}% in the long
              run. If a safe card leaves no order of the remaining cards that can survive, the round ends there (dead end): its card showed 0% before it
              was turned. The largest prize is {fmtMult(prizeFor(8))} with 8 turns.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
