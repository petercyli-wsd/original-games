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
import { useEffect, useMemo, useRef, useState } from 'react';
import Field from './Board';
import {
  AUTO_TARGETS,
  BOARD_IDS,
  GAPS,
  GAP_LABEL,
  RTP,
  SPEEDS,
  SPEED_HINT,
  SPEED_LABEL,
  autoChance,
  autoStops,
  board,
  chasePath,
  heatMap,
  hunterMovesNow,
  moveOdds,
  playTurn,
  prizeFor,
  startChance,
  startState,
  table,
  volatilityOf,
  winChance,
  type BoardId,
  type Gap,
  type Settings,
  type Speed,
  type State,
} from './math';

type Phase = 'idle' | 'moving' | 'live' | 'over';
type Outcome = 'escaped' | 'caught' | 'cashed';

interface Round {
  settings: Settings;
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
  outcome: Outcome | null;
}

interface Last {
  id: number;
  multiplier: number;
  stake: number;
}

const OUTCOME_TITLE: Record<Outcome, string> = { escaped: 'Escaped', caught: 'Caught', cashed: 'Cashed out' };
const RULE = 'Reach the exit before the hunter catches you.';
const steps = (n: number) => `${n} ${n === 1 ? 'step' : 'steps'}`;

function newRound(settings: Settings, stake: number): Round {
  const s = startState(settings.board, settings.gap);
  return {
    settings,
    stake,
    prize: prizeFor(settings),
    state: s,
    runner: s.runner,
    hunter: s.hunter,
    turn: 0,
    cash: RTP,
    trail: [s.runner],
    hunterTrail: [s.hunter],
    outcome: null,
  };
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);

  const [boardId, setBoardId] = useState<BoardId>('yard');
  const [gap, setGap] = useState<Gap>('big');
  const [speed, setSpeed] = useState<Speed>('steady');
  const [target, setTarget] = useState<number | null>(2);
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

  const settings: Settings = { board: boardId, gap, speed };
  const moveMs = turbo.turbo ? 90 : 340;
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
    const t = table(r.settings.board, r.settings.speed);
    const turn = playTurn(t, r.state, rng);
    const next: State = { runner: turn.runner, hunter: turn.hunter, phase: turn.phase };
    const p = turn.end === 'escaped' ? 1 : turn.end === 'caught' ? 0 : winChance(t, next);
    const cash = r.prize * p;
    resolved.current = cash;
    setPhase('moving');
    // The runner steps first; the hunter replies.
    const moved: Round = { ...r, runner: turn.runner, trail: [...r.trail, turn.runner] };
    setRound(moved);
    timers.after(moveMs, () => {
      if (turn.end) {
        const done = { ...moved, state: next, turn: r.turn + 1 };
        if (turn.hunterMoved) {
          const caught = { ...done, hunter: turn.hunter, hunterTrail: [...r.hunterTrail, turn.hunter] };
          setRound(caught);
          timers.after(moveMs, () => finish(caught, turn.end!, cash));
        } else finish(done, turn.end, cash);
        return;
      }
      const settle = () => {
        const after: Round = {
          ...moved,
          state: next,
          hunter: turn.hunter,
          hunterTrail: turn.hunterMoved ? [...r.hunterTrail, turn.hunter] : r.hunterTrail,
          turn: r.turn + 1,
          cash,
        };
        setRound(after);
        setPhase('live');
        track({ type: 'checkpoint', multiplier: cash, winChance: p });
      };
      if (turn.hunterMoved) {
        setRound({ ...moved, hunter: turn.hunter, hunterTrail: [...r.hunterTrail, turn.hunter] });
        timers.after(moveMs, settle);
      } else settle();
    });
  }

  async function start() {
    if (live || autoBusy || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    setLast(null);
    const r = newRound(settings, bet.value);
    setRound(r);
    step(r);
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
    const s = { ...settings };
    const tgt = target;
    if (!(await ticket.place(stake))) return null;
    setAutoBusy(true);
    setLast(null);
    setPhase('idle');
    const t = table(s.board, s.speed);
    let r = newRound(s, stake);
    setRound(r);
    await timers.wait(60);
    let mult = 0;
    let outcome: Outcome = 'caught';
    for (;;) {
      const turn = playTurn(t, r.state, rng);
      const next: State = { runner: turn.runner, hunter: turn.hunter, phase: turn.phase };
      const p = turn.end === 'escaped' ? 1 : turn.end === 'caught' ? 0 : winChance(t, next);
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
        else if (phase === 'idle' || phase === 'over') void start();
      },
      cashOut,
    },
    !infoOpen,
  );

  // ---------- What the board shows ----------

  const shown = round?.settings ?? settings;
  const t = table(shown.board, shown.speed);
  const grid = board(shown.board);
  const state = round?.state ?? startState(shown.board, shown.gap);
  const heat = useMemo(() => heatMap(t, state.hunter, state.phase), [t, state.hunter, state.phase]);
  const end = round?.outcome === 'escaped' || round?.outcome === 'caught' ? round.outcome : null;
  const p = end === 'escaped' ? 1 : end === 'caught' ? 0 : winChance(t, state);
  const atCheckpoint = !isAuto && (phase === 'live' || (phase === 'idle' && !round));
  const moves = atCheckpoint && !end ? moveOdds(t, state) : null;
  const prize = round?.prize ?? prizeFor(settings);
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const p0 = startChance(settings);
  const vol = volatilityOf(settings);
  const hunterGap = grid.dist[round?.hunter ?? state.hunter][round?.runner ?? state.runner];
  const exitGap = grid.dist[round?.runner ?? state.runner][grid.exit];
  const movesNow = hunterMovesNow(state.phase, shown.speed);
  const period = t.period;
  const turnsToMove = period - 1 - state.phase;
  const fatal = moves?.filter((m) => m.p === 0).length ?? 0;
  const path = phase === 'moving' || end ? [] : chasePath(grid, round?.hunter ?? state.hunter, round?.runner ?? state.runner);

  let status = `Ready · ${grid.name}, ${SPEED_LABEL[shown.speed].toLowerCase()} hunter`;
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
    status = `Turn ${(round?.turn ?? 0) + 1} · moving…`;
    tone = 'live';
  } else if (phase === 'live' && round) {
    status = `Checkpoint · turn ${round.turn}`;
    tone = 'live';
  } else if (phase === 'over' && round?.outcome) {
    status = `${OUTCOME_TITLE[round.outcome]} · ${round.turn} ${round.turn === 1 ? 'turn' : 'turns'}`;
    tone = round.cash > 0 ? 'won' : 'lost';
  }

  const readouts: ReadoutItem[] = isAuto
    ? [
        {
          label: 'Escape chance',
          value: round && (autoBusy || round.outcome) ? fmtChance(p) : fmtChance(p0),
          sub: round && (autoBusy || round.outcome) ? `turn ${round.turn}` : 'from the start',
          tone: 'chance',
        },
        {
          label: 'Cash out now',
          value: round && (autoBusy || round.outcome) ? fmtMult(round.cash) : '—',
          sub: target === null ? 'Auto plays to the end' : `Auto cashes at ${fmtMult(target)}`,
          tone: 'cash',
        },
        { label: 'Escape pays', value: fmtMult(prize), sub: formatAmount(bet.value * prize, 2), tone: 'prize' },
      ]
    : [
        { label: 'Escape chance', value: fmtChance(p), sub: live ? 'under the runner' : phase === 'over' ? 'final' : 'from the start', tone: 'chance' },
        {
          label: 'Cash out now',
          value: live || phase === 'over' ? fmtMult(cash) : '—',
          sub: live || phase === 'over' ? formatAmount(stake * cash, 2) : 'after each turn',
          tone: 'cash',
        },
        { label: 'Escape pays', value: fmtMult(prize), sub: formatAmount(stake * prize, 2), tone: 'prize' },
      ];

  const autoTargets = AUTO_TARGETS.filter((v) => v === null || v < prizeFor(settings));

  const settingsPanel = (
    <>
      <Label hint={<VolBadge level={vol} />}>Board</Label>
      <Chips
        label="Board"
        options={BOARD_IDS.map((id) => ({ value: id, label: board(id).name }))}
        value={boardId}
        disabled={locked}
        onChange={(v) => change(() => setBoardId(v))}
      />
      <Label hint={`hunter ${steps(board(boardId).dist[board(boardId).runner][board(boardId).hunters[gap]])} away`}>Head start</Label>
      <Chips label="Head start" options={GAPS.map((g) => ({ value: g, label: GAP_LABEL[g] }))} value={gap} disabled={locked} onChange={(v) => change(() => setGap(v))} />
      <Label hint={SPEED_HINT[speed]}>Hunter speed</Label>
      <Chips
        label="Hunter speed"
        options={SPEEDS.map((s) => ({ value: s, label: SPEED_LABEL[s] }))}
        value={speed}
        disabled={locked}
        onChange={(v) => change(() => setSpeed(v))}
      />
    </>
  );

  return (
    <GameLayout
      name="Chase"
      accent="#e63946"
      className="ch-game"
      panel={
        <>
          <ModeTabs auto={auto} disabled={live || autoBusy} />
          <BetField bet={bet} disabled={locked} />
          {settingsPanel}

          {!isAuto ? (
            <>
              <dl className="og-stats">
                <dt>Chance to escape</dt>
                <dd>{fmtChance(p0)}</dd>
                <dt>Escape pays</dt>
                <dd>{fmtMult(prizeFor(settings))}</dd>
              </dl>
              {phase === 'live' || phase === 'moving' ? (
                <>
                  <ActionButton kind="cash" disabled={phase !== 'live'} onClick={cashOut}>
                    Cash out <span>{formatAmount(stake * cash, 2)}</span>
                  </ActionButton>
                  <ActionButton kind="secondary" disabled={phase !== 'live'} onClick={() => round && step(round)}>
                    {phase === 'moving' ? 'Moving…' : `Step · ${movesNow ? 'hunter moves' : 'hunter waits'}`}
                  </ActionButton>
                </>
              ) : (
                <ActionButton disabled={!!bet.blocked} onClick={() => void start()}>
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
                <dd>{fmtChance(autoChance(settings, target !== null && target < prizeFor(settings) ? target : null))}</dd>
                <dt>Escape pays</dt>
                <dd>{fmtMult(prizeFor(settings))}</dd>
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
          runner={round?.runner ?? state.runner}
          hunter={round?.hunter ?? state.hunter}
          trail={round?.trail ?? []}
          hunterTrail={round?.hunterTrail ?? []}
          moves={phase === 'moving' ? null : moves}
          p={p}
          path={path}
          rhythm={[state.phase, period]}
          end={end}
          moveMs={isAuto ? autoMs : moveMs}
          showAll={!live && !autoBusy}
        />
        <div className="ch-strip" aria-label="Distances">
          <span className="ex">
            <i />
            Exit <b>{steps(exitGap)}</b>
          </span>
          <span className="hu">
            <i />
            Hunter <b>{steps(hunterGap)}</b> away
          </span>
          <span className="rh">
            {end
              ? end === 'escaped'
                ? 'Runner got out'
                : 'Runner caught'
              : period === 1
                ? 'Hunter moves every turn'
                : movesNow
                  ? 'Hunter moves this turn'
                  : `Hunter rests · moves on turn ${(round?.turn ?? 0) + 1 + turnsToMove}`}
          </span>
        </div>
      </Board>

      {!isAuto && phase === 'over' && round?.outcome ? (
        <RoundOver
          key={history[0]?.id}
          title={OUTCOME_TITLE[round.outcome]}
          multiplier={round.cash}
          stake={round.stake}
          nextBet={bet.value}
          blocked={bet.blocked}
          onBetAgain={() => void start()}
          onClear={clear}
          placement="inline"
        />
      ) : !isAuto && live ? (
        <ChanceBar
          p={p}
          label="Escape chance"
          note={
            moves
              ? `The runner takes one of these ${moves.length} steps at random, 1 in ${moves.length} each; their odds average to this.${fatal ? ` ${fatal} of them ${fatal === 1 ? 'walks' : 'walk'} into the hunter.` : ''}`
              : 'Moving…'
          }
        />
      ) : (
        <Caption>
          <b className="ch-rule">{RULE}</b> The runner steps at random; the red hunter chases it and {SPEED_HINT[shown.speed]}. Each square's green area is your
          escape chance if the runner stood there.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Chase" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>{RULE} The white runner wanders the board at random; the red hunter chases it. If the runner reaches the green exit you win the prize.</p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick a board, a head start and the hunter's speed, then press Bet. The first turn plays at once.</li>
              <li>Each turn the runner steps to a random open neighbour (up, down, left or right), then the hunter, on its turns, steps one square closer along a shortest path.</li>
              <li>The runner is caught if it steps onto the hunter or the hunter steps onto it. Reaching the exit pays the prize.</li>
              <li>After every turn you can cash out (C) or play the next turn (Space).</li>
              <li>Auto plays whole rounds and cashes out as soon as the cash-out reaches your target, or plays to the end.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              Each square holds a <b style={{ color: 'var(--green)' }}>green square</b> whose area is the chance of escaping if the runner stood there now, with
              the hunter where it is. The one under the runner is your live chance. At a checkpoint the runner's possible steps carry badges with the chance each
              would leave you (after the hunter's reply); the runner picks one of them at random, so they average to your chance. The dashed red line is the
              hunter's shortest route to the runner, and the pips under the hunter count down to its next move.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              The game is an absorbing Markov chain on the joint state (runner, hunter, turn in the hunter's rhythm). The escape chance V solves V(s) = the
              average over the runner's steps n of Q(s, n), where Q is 1 at the exit, 0 on the hunter, and otherwise the average of V over the hunter's equally
              good replies. This linear system is solved exactly (to machine precision) once per board and speed.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Escaping pays {(RTP * 100).toFixed(0)}% ÷ the starting chance. Cashing out pays that prize × your current chance. The chance is a martingale (each
              turn is a fair bet), so by the optional stopping theorem every way of playing, including Auto targets, returns exactly {(RTP * 100).toFixed(0)}%.
              The largest prize is {fmtMult(prizeFor({ board: 'hall', gap: 'small', speed: 'fast' }))} (Hall, small head start,
              fast hunter).
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
