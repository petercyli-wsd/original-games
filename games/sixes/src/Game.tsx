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
import Dice, { type Outcome } from './Board';
import { DICE, ROLLS, RTP, cashOutFor, dieChance, face, nextRoll, prizeFor, startChance, volatilityOf, winChance, type DiceCount, type NextRollOutcome } from './math';

type Phase = 'idle' | 'rolling' | 'checkpoint' | 'over';

interface Round {
  n: DiceCount;
  stake: number;
  faces: (number | null)[];
  /** Rolls used so far. */
  rolls: number;
  outcome: Outcome | null;
  paid: number;
}

interface Last {
  id: number;
  multiplier: number;
  stake: number;
}

const RULE = 'Roll your dice up to three times; sixes stay put, and you win if every die shows a six.';
const AUTO_TARGETS = [0, 1.5, 2, 3, 5, 10];
const OUTCOME_TITLE: Record<Outcome, string> = { won: 'All sixes', lost: 'Out of rolls', cashed: 'Cashed out' };

const freeOf = (faces: readonly (number | null)[]) => faces.filter((f) => f !== 6).length;
const dice = (k: number) => `${k} ${k === 1 ? 'die' : 'dice'}`;
const sixes = (k: number) => `${k} ${k === 1 ? 'six' : 'sixes'}`;

/** What the next roll can do: each count of new sixes, its chance, and the win chance it leaves. */
function NextRoll({ outs, now, last }: { outs: readonly NextRollOutcome[]; now: number; last: boolean }) {
  return (
    <div className="sixes-next" aria-label="Next roll outcomes">
      <p className="sixes-next-head">{last ? 'Last roll' : 'Next roll'}: new sixes · their chance → your win chance after</p>
      {outs.map((o) => (
        <div key={o.sixes} className={'sixes-ev' + (o.win > now + 1e-12 ? ' up' : ' down')}>
          <span>
            {sixes(o.sixes)} · {fmtChance(o.prob)}
          </span>
          <b>{o.win >= 1 ? 'win' : o.win <= 0 ? (last ? 'lose' : '0%') : `→ ${fmtChance(o.win)}`}</b>
        </div>
      ))}
    </div>
  );
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);

  const [n, setN] = useState<DiceCount>(3);
  const [target, setTarget] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [tick, setTick] = useState(0);
  const [tumbling, setTumbling] = useState(false);
  const [autoBusy, setAutoBusy] = useState(false);
  const [last, setLast] = useState<Last | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const seq = useRef(0);

  // A roll is decided the moment it starts, so leaving mid-roll settles at its
  // real result, never at the pre-roll value. `resolved` is the open ticket's
  // value right now, set synchronously at every transition: RTP when the
  // stake is placed, and the post-roll value (prize, 0 or prize · P) the
  // moment a roll is drawn. The ticket reads only this ref: a value derived
  // from rendered state can be one render stale (the pre-roll cash-out just
  // after Roll, or 0 just after Bet) if the game unmounts before the next render.
  const resolved = useRef(0);
  const ticket = useTicket(() => resolved.current);
  /** The round waiting at a checkpoint: the only one that can be rolled on or cashed (null while rolling or over). */
  const waiting = useRef<Round | null>(null);

  const isAutoRef = useRef(false);
  const fast = turbo.turbo;
  const rollMs = () => (isAutoRef.current ? (fast ? 150 : 480) : fast ? 200 : 800);
  const live = phase === 'rolling' || phase === 'checkpoint';

  function cashOf(r: Round) {
    return cashOutFor(r.n, freeOf(r.faces), ROLLS - r.rolls);
  }

  // The tumbling faces are only a visual; the result is already drawn.
  useEffect(() => {
    if (!tumbling) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 70);
    return () => window.clearInterval(id);
  }, [tumbling]);

  /** Draws one roll of the free dice and plays its animation. Resolves to the new round, or null if cancelled. */
  async function rollOnce(r: Round): Promise<Round | null> {
    const faces = r.faces.map((f) => (f === 6 ? 6 : face(rng.next())));
    const next: Round = { ...r, faces, rolls: r.rolls + 1 };
    const free = freeOf(faces);
    const left = ROLLS - next.rolls;
    resolved.current = free === 0 ? prizeFor(r.n) : left === 0 ? 0 : cashOf(next);
    setTumbling(true);
    const ok = await timers.wait(rollMs());
    setTumbling(false);
    if (!ok) return null;
    setRound(next);
    return next;
  }

  // ---------- Manual round ----------

  function finish(r: Round, outcome: Outcome, paid: number) {
    waiting.current = null;
    ticket.settle(paid);
    pushHistory(paid);
    setRound({ ...r, outcome, paid });
    setPhase('over');
  }

  /** Rolls the round on show: the first roll right after Bet, or a further roll from its checkpoint (once). */
  async function roll(r: Round, first = false) {
    if (!first && waiting.current !== r) return;
    waiting.current = null;
    setPhase('rolling');
    const next = await rollOnce(r);
    if (!next) return;
    const free = freeOf(next.faces);
    if (free === 0) return finish(next, 'won', prizeFor(next.n));
    if (next.rolls >= ROLLS) return finish(next, 'lost', 0);
    waiting.current = next;
    setPhase('checkpoint');
    track({ type: 'checkpoint', multiplier: cashOf(next), winChance: winChance(free, ROLLS - next.rolls) });
  }

  async function start() {
    if (live || autoBusy || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    resolved.current = RTP;
    timers.clearAll();
    setLast(null);
    const r: Round = { n, stake: bet.value, faces: Array(n).fill(null), rolls: 0, outcome: null, paid: 0 };
    setRound(r);
    void roll(r, true);
  }

  function cashOut() {
    const r = waiting.current;
    if (!r) return;
    finish(r, 'cashed', cashOf(r));
  }

  function clear() {
    if (live || autoBusy) return;
    timers.clearAll();
    setRound(null);
    setLast(null);
    setPhase('idle');
  }

  // ---------- Auto ----------

  async function playAuto(stake: number): Promise<number | null> {
    const nn = n;
    const tgt = target;
    if (!(await ticket.place(stake))) return null;
    resolved.current = RTP;
    waiting.current = null;
    setAutoBusy(true);
    setLast(null);
    let r: Round = { n: nn, stake, faces: Array(nn).fill(null), rolls: 0, outcome: null, paid: 0 };
    setRound(r);
    setPhase('rolling');
    let outcome: Outcome = 'lost';
    let paid = 0;
    for (;;) {
      const next = await rollOnce(r);
      if (!next) return null;
      r = next;
      const free = freeOf(r.faces);
      if (free === 0) {
        outcome = 'won';
        paid = prizeFor(nn);
        break;
      }
      if (r.rolls >= ROLLS) break;
      const cash = cashOf(r);
      if (tgt > 0 && cash >= tgt - 1e-12) {
        outcome = 'cashed';
        paid = cash;
        break;
      }
      if (!(await timers.wait(fast ? 60 : 220))) return null;
    }
    ticket.settle(paid);
    pushHistory(paid);
    setRound({ ...r, outcome, paid });
    setPhase('over');
    setLast({ id: ++seq.current, multiplier: paid, stake });
    setAutoBusy(false);
    return paid;
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
    setTumbling(false);
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
        if (phase === 'checkpoint' && round) void roll(round);
        else if (phase === 'idle' || phase === 'over') void start();
      },
      cashOut: () => (!isAuto ? cashOut() : undefined),
    },
    !infoOpen,
  );

  // ---------- What the board shows ----------

  const r: Round = round ?? { n, stake: bet.value, faces: Array(n).fill(null), rolls: 0, outcome: null, paid: 0 };
  const outcome = phase === 'over' ? r.outcome : null;
  const free = freeOf(r.faces);
  // During a roll the bars still show the state before it: that roll is one of the rolls left.
  const rollsLeft = ROLLS - r.rolls;
  const winNow = outcome === 'won' ? 1 : outcome === 'lost' ? 0 : winChance(free, rollsLeft);
  const prize = prizeFor(r.n);
  const cash = prize * winNow;
  const stake = r.stake;
  const outs = phase === 'checkpoint' && !isAuto ? nextRoll(free, rollsLeft) : null;
  const tumble = tumbling ? r.faces.map((_, i) => ((tick * 5 + i * 3) % 6) + 1) : null;

  const p0 = startChance(n);
  const prize0 = prizeFor(n);
  const vol = volatilityOf(n);

  let status = `Ready · roll ${dice(n)} for ${n === 1 ? 'a six' : `${n} sixes`}`;
  let tone: StatusTone = 'idle';
  if (phase === 'rolling') {
    status = `${isAuto ? 'Autobet · ' : ''}Roll ${r.rolls + 1} of ${ROLLS}…`;
    tone = 'live';
  } else if (phase === 'checkpoint') {
    status = `${dice(free)} still ${free === 1 ? 'needs' : 'need'} a six · ${rollsLeft} ${rollsLeft === 1 ? 'roll' : 'rolls'} left`;
    tone = 'live';
  } else if (phase === 'over' && outcome) {
    status =
      outcome === 'won'
        ? `All sixes on roll ${r.rolls}`
        : outcome === 'cashed'
          ? `Cashed out after roll ${r.rolls}`
          : `Out of rolls · ${dice(free)} short`;
    tone = r.paid > 0 ? 'won' : 'lost';
  } else if (isAuto && auto.running) {
    status = `Autobet${auto.remaining !== null ? ` · ${auto.remaining} left` : ''}`;
    tone = 'live';
  }

  const showCash = live || phase === 'over';
  const readouts: ReadoutItem[] = [
    {
      label: 'Win chance',
      value: fmtChance(round ? winNow : p0),
      sub: round && outcome === null ? `${dice(free)} ${free === 1 ? 'needs' : 'need'} a six` : `${r.n === 1 ? 'the die' : `all ${r.n} dice`} on six`,
      tone: 'chance',
    },
    {
      label: phase === 'over' ? 'Paid' : isAuto && !round ? 'Auto cashes at' : 'Cash out now',
      value: phase === 'over' ? fmtMult(r.paid) : showCash ? fmtMult(cash) : isAuto ? (target > 0 ? fmtMult(target) : 'the end') : '—',
      sub: phase === 'over' ? formatAmount(stake * r.paid, 2) : showCash ? formatAmount(stake * cash, 2) : isAuto ? (target > 0 ? 'or on all sixes' : 'plays every roll') : 'after the first roll',
      tone: 'cash',
    },
    { label: 'Prize', value: fmtMult(prize), sub: `pays ${formatAmount(stake * prize, 2)}`, tone: 'prize' },
  ];

  const nextLabel = rollsLeft === 1 ? 'last roll' : `${rollsLeft} rolls left`;

  return (
    <GameLayout
      name="Sixes"
      accent="#a5b4fc"
      panel={
        <>
          <ModeTabs auto={auto} disabled={live || autoBusy} />
          <BetField bet={bet} disabled={busy} />

          <Label hint={<VolBadge level={vol} />}>Dice</Label>
          <Chips
            label="Number of dice"
            options={DICE.map((v) => ({ value: v, label: v, title: `${fmtChance(startChance(v))} to win` }))}
            value={n}
            disabled={busy}
            onChange={(v) => change(() => setN(v))}
          />

          {!isAuto ? (
            <>
              {phase !== 'checkpoint' && (
                <dl className="og-stats">
                  <dt>Chance to win</dt>
                  <dd>{fmtChance(p0)}</dd>
                  <dt>Prize</dt>
                  <dd>{fmtMult(prize0)}</dd>
                </dl>
              )}
              {phase === 'checkpoint' && round ? (
                <>
                  <ActionButton kind="cash" onClick={cashOut}>
                    Cash out <span>{formatAmount(stake * cash, 2)}</span>
                  </ActionButton>
                  <ActionButton kind="secondary" onClick={() => void roll(round)}>
                    Roll {dice(free)} · {nextLabel}
                  </ActionButton>
                </>
              ) : (
                <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
                  {phase === 'rolling' ? 'Rolling…' : phase === 'over' ? 'Bet again' : 'Bet'}
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
              <dl className="og-stats">
                <dt>Chance to win</dt>
                <dd>{fmtChance(p0)}</dd>
                <dt>Prize</dt>
                <dd>{fmtMult(prize0)}</dd>
              </dl>
            </AutoBetControls>
          )}
          {bet.blocked && <p className="sixes-note">{bet.blocked}</p>}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />
      <Readouts items={readouts} />

      <Board>
        {isAuto && <InstantResult multiplier={last && !autoBusy ? last.multiplier : null} stake={last?.stake ?? 0} id={last?.id ?? 0} />}
        <Dice faces={r.faces} tumble={tumble} rollsLeft={outcome === 'lost' ? 0 : rollsLeft} outcome={outcome} />
      </Board>

      {!isAuto && phase === 'over' && round?.outcome ? (
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
      ) : !isAuto && phase === 'checkpoint' && outs ? (
        <ChanceBar
          p={winNow}
          label="Win chance: every die shows six"
          note={<NextRoll outs={outs} now={winNow} last={rollsLeft === 1} />}
        />
      ) : live || (isAuto && round && (autoBusy || auto.running)) ? (
        <ChanceBar
          p={winNow}
          label="Win chance: every die shows six"
          note={
            phase === 'rolling'
              ? `Rolling ${dice(free)}: each has a 1 in 6 chance of a six.`
              : target > 0 && target < prize
                ? `Worth ${fmtMult(cash)} now · Auto cashes at ${fmtMult(target)}, or wins ${fmtMult(prize)} on all sixes`
                : `Worth ${fmtMult(cash)} now · Auto plays to all sixes for ${fmtMult(prize)}`
          }
        />
      ) : (
        <Caption>
          <b className="sixes-rule">{RULE}</b>
          <br />
          {isAuto
            ? `Each bet plays a whole round${target > 0 ? ` and cashes out once it is worth ${fmtMult(target)}` : ' to the last roll'}. RTP ${(RTP * 100).toFixed(0)}%.`
            : `More dice: a smaller chance and a bigger prize. RTP ${(RTP * 100).toFixed(0)}%.`}
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Sixes" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>{RULE}</p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick how many dice to roll (1 to 5), then Bet. The first roll happens straight away.</li>
              <li>Every die that shows a six turns gold and stays put. The others are rolled again on the next roll.</li>
              <li>After roll 1 and roll 2 you can cash out (C) or roll the dice that still need a six (Space).</li>
              <li>If every die shows a six, you win the prize at once. If any die is not a six after roll 3, the round is lost.</li>
              <li>Auto plays whole rounds and cashes out once the round is worth your target (or plays to the end with End).</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The bar under each die is that die's chance of showing a six in the rolls you have left. Its bright bottom piece is the next roll, exactly 1 in 6;
              the paler pieces above are the rolls after it (5/36, then 25/216). A gold die is already a six, so its bar is full.
            </p>
            <p>
              The dice are independent, so your win chance is the bars multiplied together, shown under them and in the green bar. At each checkpoint the boxes
              under the green bar list what the next roll can do: how many new sixes it might give, how likely that is, and your win chance after it.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Each die runs its own race to a six. A die with r rolls left misses only if all r rolls miss, so it gets a six with chance
              p<sub>r</sub> = 1 − (5/6)<sup>r</sup> (the geometric distribution): 91/216 = {fmtChance(dieChance(3))} with 3 rolls, 11/36 with 2, 1/6 with 1. By the
              product rule for independent events, f dice that still need a six all get one with chance p<sub>r</sub>
              <sup>f</sup>. With n dice at the start that is (91/216)<sup>n</sup>: {DICE.map((d) => fmtChance(startChance(d))).join(', ')} for 1 to 5 dice.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Prize = {(RTP * 100).toFixed(0)}% ÷ your chance at the start. Cash-out = prize × your chance now. Averaged over what the next roll can do, your
              chance after it equals your chance now (1/6 + 5/6 · p<sub>r−1</sub> = p<sub>r</sub> for every die), so every roll is a fair bet and any cash-out
              rule returns {(RTP * 100).toFixed(0)}% in the long run. The largest prize is {fmtMult(prizeFor(5))} with 5 dice.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
