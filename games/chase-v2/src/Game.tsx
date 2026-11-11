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
  ACCENTS,
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
import { useEffect, useMemo, useRef, useState } from 'react';
import Field from './Board';
import {
  AUTO_TARGETS,
  RTP,
  STARTS,
  START_HINT,
  START_LABEL,
  autoChance,
  autoStops,
  board,
  heatMap,
  hunterReach,
  hunterSteps,
  nextSteps,
  playTurn,
  prizeFor,
  startChance,
  startState,
  volatilityOf,
  winChance,
  type Start,
  type State,
} from './math';

type Phase = 'idle' | 'moving' | 'live' | 'over';
type Outcome = 'escaped' | 'caught' | 'cashed';

interface Round {
  start: Start;
  stake: number;
  prize: number;
  /** The logical state (updated when a turn finishes). */
  state: State;
  /** Where the pieces are drawn (moves ahead of `state` during a turn's animation). */
  runner: number;
  hunter: number;
  turn: number;
  cash: number;
  trail: number[];
  hunterTrail: number[];
  /** The hunter's reply, shown after the runner's step and before the hunter moves. */
  hunterNext: number[] | null;
  /**
   * Mid-turn escape chance: after the runner's step, before the hunter's reply
   * (the average over its equally likely replies). Null at a checkpoint.
   */
  mid: number | null;
  outcome: Outcome | null;
}

interface Last {
  id: number;
  multiplier: number;
  stake: number;
}

const OUTCOME_TITLE: Record<Outcome, string> = { escaped: 'Escaped', caught: 'Caught', cashed: 'Cashed out' };
const RULE = 'Reach the exit before the hunter catches the runner.';
const INTRO =
  'The runner moves by itself, one random step at a time. The hunter steps one square closer every turn. Reach the exit before the hunter reaches you. Cash out any time.';

function newRound(start: Start, stake: number): Round {
  const s = startState(start);
  return {
    start,
    stake,
    prize: prizeFor(start),
    state: s,
    runner: s.runner,
    hunter: s.hunter,
    turn: 0,
    cash: RTP,
    trail: [s.runner],
    hunterTrail: [s.hunter],
    hunterNext: null,
    mid: null,
    outcome: null,
  };
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);

  const [start, setStart] = useState<Start>('far');
  const [target, setTarget] = useState<number | null>(1.5);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [last, setLast] = useState<Last | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const seq = useRef(0);

  // A turn is decided the moment it starts, so leaving mid-move settles at
  // its real result, never at the pre-turn value.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'moving' || autoBusy ? resolved.current : phase === 'live' && round ? round.cash : 0));

  // A turn is three parts (runner steps, hunter's reply shown, hunter moves) of
  // 400 ms each, about 1.2 s in all.
  const moveMs = eventMs(turbo.turbo, 400);
  // How long the hunter's reply is shown before it moves.
  const showMs = eventMs(turbo.turbo, 400);
  const autoMs = turbo.turbo ? 70 : 200;
  const live = phase === 'moving' || phase === 'live';

  // ---------- Manual ----------

  function finish(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setPhase('over');
  }

  function step(r: Round) {
    const turn = playTurn(r.state, rng);
    const next: State = { runner: turn.runner, hunter: turn.hunter };
    const p = turn.end === 'escaped' ? 1 : turn.end === 'caught' ? 0 : winChance(next);
    const cash = r.prize * p;
    resolved.current = cash;
    setPhase('moving');
    // The runner steps first; then the hunter's reply is shown (the square, or
    // equally close squares, one step closer); then the hunter moves.
    const mid = nextSteps(r.state).find((m) => m.cell === turn.runner)!.p;
    const moved: Round = { ...r, runner: turn.runner, trail: [...r.trail, turn.runner], hunterNext: null, mid };
    setRound(moved);
    const done: Round = {
      ...moved,
      state: next,
      hunter: turn.hunter,
      hunterTrail: turn.hunterMoved ? [...r.hunterTrail, turn.hunter] : r.hunterTrail,
      turn: r.turn + 1,
      cash,
      mid: null,
    };
    timers.after(moveMs, () => {
      if (!turn.hunterMoved) {
        finish(done, turn.end!, cash);
        return;
      }
      setRound({ ...moved, hunterNext: hunterSteps(board(), r.state.hunter, turn.runner) });
      timers.after(showMs, () => {
        setRound(done);
        timers.after(moveMs, () => {
          if (turn.end) finish(done, turn.end, cash);
          else {
            setPhase('live');
            track({ type: 'checkpoint', multiplier: cash, winChance: p });
          }
        });
      });
    });
  }

  async function begin() {
    if (live || autoBusy || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    setLast(null);
    // Pause at the start: the first checkpoint is the starting position, worth RTP.
    setRound(newRound(start, bet.value));
    setPhase('live');
    track({ type: 'checkpoint', multiplier: RTP, winChance: startChance(start) });
  }

  function cashOut() {
    if (phase !== 'live' || !round) return;
    finish(round, 'cashed', round.cash);
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
    const st = start;
    const tgt = target;
    if (!(await ticket.place(stake))) return null;
    // Until the first turn is drawn the round is worth its starting value (RTP),
    // never the previous round's result.
    resolved.current = RTP;
    setAutoBusy(true);
    setLast(null);
    setPhase('idle');
    let r = newRound(st, stake);
    setRound(r);
    await timers.wait(60);
    let mult = 0;
    let outcome: Outcome = 'caught';
    for (;;) {
      const turn = playTurn(r.state, rng);
      const next: State = { runner: turn.runner, hunter: turn.hunter };
      const p = turn.end === 'escaped' ? 1 : turn.end === 'caught' ? 0 : winChance(next);
      const cash = r.prize * p;
      const stop = turn.end !== null || autoStops(cash, tgt);
      resolved.current = cash;
      r = {
        ...r,
        state: next,
        runner: turn.runner,
        hunter: turn.hunter,
        trail: [...r.trail, turn.runner],
        hunterTrail: turn.hunterMoved ? [...r.hunterTrail, turn.hunter] : r.hunterTrail,
        turn: r.turn + 1,
        cash,
      };
      setRound(r);
      if (!(await timers.wait(autoMs))) {
        // Cancelled (the game is closing): settle at the fair value of where the round stands.
        mult = cash;
        outcome = turn.end ?? 'cashed';
        break;
      }
      if (stop) {
        mult = cash;
        outcome = turn.end ?? 'cashed';
        break;
      }
    }
    ticket.settle(mult);
    pushHistory(mult);
    setRound({ ...r, outcome, cash: mult });
    setLast({ id: ++seq.current, multiplier: mult, stake });
    setAutoBusy(false);
    return mult;
  }

  const auto = useAutoBet({ bet, play: playAuto, turbo: turbo.turbo });
  const isAuto = auto.mode === 'auto';
  const locked = live || autoBusy || auto.running;

  // Switching Manual / Auto starts from a clean board.
  useEffect(() => {
    timers.clearAll();
    setRound(null);
    setLast(null);
    setPhase('idle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto.mode]);

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    if (locked) return;
    apply();
    if (phase === 'over' || round) clear();
  };

  useHotkeys(
    {
      space: () => {
        if (isAuto) {
          if (auto.running) auto.stop();
          else if (!autoBusy && !bet.blocked) auto.start();
          return;
        }
        if (phase === 'live' && round) step(round);
        else if (phase === 'idle' || phase === 'over') void begin();
      },
      cashOut,
    },
    !infoOpen,
  );

  // ---------- What the board shows ----------

  const grid = board();
  const shown = round?.start ?? start;
  const state = round?.state ?? startState(shown);
  const heat = useMemo(() => heatMap(state.hunter), [state.hunter]);
  const end = round?.outcome === 'escaped' || round?.outcome === 'caught' ? round.outcome : null;
  const p = end === 'escaped' ? 1 : end === 'caught' ? 0 : (round?.mid ?? winChance(state));
  const atCheckpoint = !isAuto && (phase === 'live' || (phase === 'idle' && !round));
  const steps = atCheckpoint && !end ? nextSteps(state) : null;
  const k = steps?.length ?? 0;
  const fatal = steps?.filter((m) => m.fate === 'caught').length ?? 0;
  const reach = steps ? hunterReach(grid, state.hunter) : null;
  // The pieces as they are drawn (they move ahead of the logical state mid-turn).
  const drawnRunner = round?.runner ?? state.runner;
  const drawnHunter = round?.hunter ?? state.hunter;
  const prize = round?.prize ?? prizeFor(start);
  const cash = round?.mid != null ? round.prize * round.mid : (round?.cash ?? RTP);
  const stake = round?.stake ?? bet.value;
  const p0 = startChance(start);
  const vol = volatilityOf(start);

  let status = `Ready · hunter starts ${START_HINT[shown]}`;
  let tone: StatusTone = 'idle';
  if (isAuto) {
    if (auto.running || autoBusy) {
      status = `Autobet${auto.remaining !== null ? ` · ${auto.remaining} left` : ' · running'}${round ? ` · turn ${round.turn}` : ''}`;
      tone = 'live';
    } else if (last && round?.outcome) {
      status = `${OUTCOME_TITLE[round.outcome]} · ${fmtMult(last.multiplier)}`;
      tone = last.multiplier > 0 ? 'won' : 'lost';
    } else status = target === null ? 'Auto · play every round to the end' : `Auto · cash out at ${fmtMult(target)}`;
  } else if (phase === 'moving') {
    const n = round?.hunterNext?.length ?? 0;
    status = `Turn ${(round?.turn ?? 0) + 1} · ${n === 0 ? 'runner steps…' : n === 1 ? 'hunter steps closer…' : `hunter picks 1 of ${n} closer squares…`}`;
    tone = 'live';
  } else if (phase === 'live' && round) {
    const at = round.turn === 0 ? 'Start' : `Turn ${round.turn}`;
    status = fatal ? `${at} · ${fatal} of ${k} steps red` : `${at} · no red step`;
    tone = 'live';
  } else if (phase === 'over' && round?.outcome) {
    status = `${OUTCOME_TITLE[round.outcome]} · ${round.turn} ${round.turn === 1 ? 'turn' : 'turns'}`;
    tone = round.cash > 0 ? 'won' : 'lost';
  }

  const readouts: ReadoutItem[] = [
    {
      label: 'Escape chance',
      value: fmtChance(isAuto ? (round && (autoBusy || round.outcome) ? p : p0) : p),
      tone: 'chance',
    },
    { label: 'Escape pays', value: fmtMult(prize), tone: 'prize' },
  ];

  const autoTargets = AUTO_TARGETS.filter((v) => v === null || v < prizeFor(start));

  return (
    <GameLayout
      name="Chase"
      accent={ACCENTS.pink}
      className="ch-game"
      panel={
        <>
          <ModeTabs auto={auto} disabled={live || autoBusy} />
          <BetField bet={bet} disabled={locked} />
          <Label hint={<VolBadge level={vol} />}>Hunter starts</Label>
          <Chips
            label="Hunter starts"
            options={STARTS.map((s) => ({ value: s, label: START_LABEL[s], title: `Hunter starts ${START_HINT[s]}` }))}
            value={start}
            disabled={locked}
            onChange={(v) => change(() => setStart(v))}
          />

          {!isAuto ? (
            <>
              {live ? (
                <>
                  <ActionButton kind="cash" disabled={phase !== 'live'} onClick={cashOut}>
                    Cash out <span>{formatAmount(stake * cash, 2)}</span>
                  </ActionButton>
                  <ActionButton kind="secondary" disabled={phase !== 'live'} onClick={() => round && step(round)}>
                    {phase === 'moving' ? 'Stepping…' : 'Next step'}
                  </ActionButton>
                </>
              ) : (
                <ActionButton disabled={!!bet.blocked} onClick={() => void begin()}>
                  {phase === 'over' ? 'Bet again' : 'Bet'}
                </ActionButton>
              )}
            </>
          ) : (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || autoBusy}>
              <Label hint={target === null ? 'or escape / caught' : `pays ≥ ${fmtMult(target)}`}>Cash out at</Label>
              <Chips
                label="Auto cash-out target"
                wrap
                options={autoTargets.map((v) => ({ value: v ?? 0, label: v === null ? 'End' : fmtMult(v) }))}
                value={target ?? 0}
                disabled={auto.running || autoBusy}
                onChange={(v) => change(() => setTarget(v === 0 ? null : v))}
              />
              <dl className="og-stats">
                <dt>{target === null ? 'Chance to escape' : `Chance to reach ${fmtMult(target)}`}</dt>
                <dd>{fmtChance(autoChance(start, target !== null && target < prizeFor(start) ? target : null))}</dd>
              </dl>
            </AutoBetControls>
          )}
          {bet.blocked && <p className="ch-blocked">{bet.blocked}</p>}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />
      <Readouts items={readouts} />

      <Board className="ch-board">
        {isAuto && <InstantResult multiplier={last && !autoBusy ? last.multiplier : null} stake={last?.stake ?? 0} id={last?.id ?? 0} />}
        <Field
          grid={grid}
          heat={heat}
          runner={drawnRunner}
          hunter={drawnHunter}
          trail={round?.trail ?? []}
          hunterTrail={round?.hunterTrail ?? []}
          steps={phase === 'moving' ? null : steps}
          reach={phase === 'moving' ? null : reach}
          hunterNext={round?.hunterNext ?? null}
          p={p}
          end={end}
          moveMs={isAuto ? autoMs : moveMs}
        />
      </Board>

      <ChanceBar p={p} label="Escape chance" />
      <p className="ch-legend">Red: squares the hunter can reach next. Bigger green square: safer.</p>

      {!isAuto && phase === 'over' && round?.outcome && (
        <RoundOver
          key={history[0]?.id}
          title={OUTCOME_TITLE[round.outcome]}
          multiplier={round.cash}
          stake={round.stake}
          nextBet={bet.value}
          blocked={bet.blocked}
          onBetAgain={() => void begin()}
          onClear={clear}
          placement="inline"
        />
      )}
      <Caption>{RULE}</Caption>

      {infoOpen && (
        <InfoModal title="Chase" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>{INTRO} If the runner (the dot) reaches the exit (the outlined green square) you win the prize.</p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick where the hunter (the red diamond) starts, then press Bet. Nothing moves yet: you can cash out your stake × {fmtMult(RTP)} or take the first step.</li>
              <li>Each step, the runner moves to one of its open neighbours (up, down, left or right) at random. You do not steer it.</li>
              <li>
                Then the hunter moves one square closer to the runner along a shortest path. Its arrow shows where it goes before it moves; if two squares are
                equally close, it picks one of them at random (1 in 2).
              </li>
              <li>The runner is caught if it steps onto the hunter or the hunter steps onto it. Reaching the exit pays the prize.</li>
              <li>After every step you can cash out (C) or take the next step (Space).</li>
              <li>Auto plays whole rounds and cashes out as soon as the cash-out reaches your target, or plays to the end.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The bar under the board is your escape chance and moves after every step. Each square holds a green square whose area is the chance of escaping
              if the runner stood there now: bigger is safer. Squares tinted red are the ones the hunter can reach next.
            </p>
            <p>
              The arrows are the runner's possible next steps. Each is equally likely, 1 in the number of arrows. A red arrow lands in the hunter's reach (its
              square and the squares next to it, tinted red), so the hunter steps onto the runner this turn; a green arrow reaches the exit. The share of red
              arrows is exactly the chance of being caught on the next step.
            </p>
            <p>
              The escape chance moves twice a turn: when the runner steps (to the average over the hunter's possible replies), and again when the hunter
              moves, but only if it had two equally close squares to pick between. A forced hunter move never changes the odds.
            </p>
            <p>
              A short walk to the exit and a long one for the hunter make the escape chance higher; the chance also counts every random detour, and it is the
              escape chance that prices your cash-out.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              The game is an absorbing Markov chain on the pair (runner square, hunter square). The escape chance V solves V(s) = the average over the runner's
              steps n of Q(s, n), where Q is 1 at the exit, 0 on the hunter, and otherwise the average of V over the hunter's equally good replies (0 if it lands
              on the runner). This linear system is solved exactly (to machine precision) once.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Escaping pays {(RTP * 100).toFixed(0)}% ÷ the starting chance. Cashing out pays that prize × your current chance. The chance is a martingale (each
              step is a fair bet), so by the optional stopping theorem every way of playing, including Auto targets, returns exactly {(RTP * 100).toFixed(0)}%.
              Prizes run from {fmtMult(prizeFor('far'))} (hunter far) to {fmtMult(prizeFor('block'))} (hunter blocking).
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
