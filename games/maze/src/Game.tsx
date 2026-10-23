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
import Field from './Board';
import {
  AUTO_TARGETS,
  MAX_MULTIPLIER,
  MAZE_IDS,
  ROLL,
  RTP,
  autoChance,
  autoStops,
  endOf,
  maze,
  move,
  moveOdds,
  prizeFor,
  roll,
  rollOutlook,
  selectable,
  startChance,
  volatilityOf,
  type MazeId,
  type Settings,
} from './math';

type Phase = 'idle' | 'moving' | 'live' | 'over';
type Outcome = 'exit' | 'trap' | 'cashed';

interface Round {
  settings: Settings;
  stake: number;
  prize: number;
  /** Where the ball is (drawn and logical; a roll walks it cell by cell). */
  ball: number;
  trail: number[];
  moves: number;
  cash: number;
  outcome: Outcome | null;
}

interface Last {
  id: number;
  multiplier: number;
  stake: number;
}

const ACCENT = '#4cc9f0';
const RULE = 'A ball wanders the maze; green exit wins, red trap loses.';
const OUTCOME_TITLE: Record<Outcome, string> = { exit: 'Out the exit', trap: 'Trapped', cashed: 'Cashed out' };
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const pctLabel = (p: number) => (p < 0.1 ? `${(p * 100).toFixed(1)}%` : `${Math.round(p * 100)}%`);

function newRound(settings: Settings, stake: number): Round {
  return { settings, stake, prize: prizeFor(settings), ball: settings.start, trail: [settings.start], moves: 0, cash: RTP, outcome: null };
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);

  const [mazeId, setMazeId] = useState<MazeId>('garden');
  const [start, setStart] = useState<number>(() => maze('garden').presets[1]);
  const [target, setTarget] = useState<number | null>(2);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [last, setLast] = useState<Last | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const seq = useRef(0);

  // A roll is decided the moment it starts, so leaving mid-roll settles at
  // its real result, never at the pre-roll value.
  const resolved = useRef(0);
  /** True while a decided roll or Auto round is in flight: the ticket settles at `resolved`. */
  const pinned = useRef(false);
  const ticket = useTicket(() => (phase === 'moving' || pinned.current ? resolved.current : phase === 'live' && round ? round.cash : 0));

  const settings: Settings = { maze: mazeId, start };
  const moveMs = turbo.turbo ? 70 : 200;
  const autoMs = turbo.turbo ? 35 : 120;
  const live = phase === 'moving' || phase === 'live';

  // ---------- Manual ----------

  function finish(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setPhase('over');
  }

  /** Plays `n` moves (fewer if the ball reaches the exit or a trap), one cell at a time. */
  function play(r: Round, n: number) {
    const m = maze(r.settings.maze);
    const path = roll(m, r.ball, n, rng);
    const endCell = path[path.length - 1];
    const end = endOf(m, endCell);
    const cash = end === 'exit' ? r.prize : end === 'trap' ? 0 : r.prize * m.odds[endCell];
    resolved.current = cash;
    pinned.current = true;
    setPhase('moving');
    let cur = r;
    path.forEach((cell, k) => {
      timers.after(k * moveMs, () => {
        // The cash-out readout ticks with the ball (the button stays locked until the roll ends).
        const e = endOf(m, cell);
        const now = e === 'exit' ? cur.prize : e === 'trap' ? 0 : cur.prize * m.odds[cell];
        cur = { ...cur, ball: cell, trail: [...cur.trail, cell], moves: cur.moves + 1, cash: now };
        setRound(cur);
      });
    });
    timers.after(path.length * moveMs, () => {
      pinned.current = false;
      if (end) return finish(cur, end, cash);
      const after = { ...cur, cash };
      setRound(after);
      setPhase('live');
      track({ type: 'checkpoint', multiplier: cash, winChance: m.odds[endCell] });
    });
  }

  async function startRound() {
    if (live || autoBusy || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    setLast(null);
    const r = newRound(settings, bet.value);
    setRound(r);
    play(r, ROLL);
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
    const tgt = target !== null && target < prizeFor(s) ? target : null;
    // Fair value before the first move is RTP; never the previous round's result.
    resolved.current = RTP;
    pinned.current = true;
    if (!(await ticket.place(stake))) {
      pinned.current = false;
      return null;
    }
    setAutoBusy(true);
    setLast(null);
    setPhase('idle');
    const m = maze(s.maze);
    let r = newRound(s, stake);
    setRound(r);
    await timers.wait(60);
    let mult = 0;
    let outcome: Outcome = 'trap';
    for (;;) {
      const cell = move(m, r.ball, rng);
      const end = endOf(m, cell);
      const cash = end === 'exit' ? r.prize : end === 'trap' ? 0 : r.prize * m.odds[cell];
      const stop = end !== null || autoStops(cash, tgt);
      resolved.current = cash;
      r = { ...r, ball: cell, trail: [...r.trail, cell], moves: r.moves + 1, cash };
      setRound(r);
      const alive = await timers.wait(autoMs);
      if (!alive || stop) {
        // Stopped by the rule, the round's end, or the game closing: settle at the fair value where the ball is.
        mult = cash;
        outcome = end ?? 'cashed';
        break;
      }
    }
    ticket.settle(mult);
    pinned.current = false;
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

  function pickMaze(id: MazeId) {
    const prev = maze(mazeId);
    const k = prev.presets.indexOf(start);
    setMazeId(id);
    setStart(maze(id).presets[k >= 0 ? k : 1]);
  }

  useHotkeys(
    {
      space: () => {
        if (isAuto) {
          if (auto.running) auto.stop();
          else if (!autoBusy && !bet.blocked) auto.start();
          return;
        }
        if (phase === 'live' && round) play(round, ROLL);
        else if (phase === 'idle' || phase === 'over') void startRound();
      },
      cashOut,
    },
    !infoOpen,
  );

  // ---------- What the board shows ----------

  const shown = round?.settings ?? settings;
  const m = maze(shown.maze);
  const ball = round?.ball ?? shown.start;
  const end = round?.outcome === 'exit' || round?.outcome === 'trap' ? round.outcome : null;
  const p = end === 'exit' ? 1 : end === 'trap' ? 0 : m.odds[ball];
  const moves = !isAuto && phase === 'live' && !end ? moveOdds(m, ball) : null;
  const outlook = moves ? rollOutlook(m, ball, ROLL) : null;
  const prize = round?.prize ?? prizeFor(settings);
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const p0 = startChance(settings);
  const vol = volatilityOf(settings);
  const traps = moves?.filter((mv) => mv.p === 0).length ?? 0;
  const exits = moves?.filter((mv) => mv.p === 1).length ?? 0;
  const busy = locked;
  const pickable = busy ? null : (c: number) => selectable(maze(mazeId), c);
  const presets = maze(mazeId).presets;

  let status = `Ready · ${m.name}`;
  let tone: StatusTone = 'idle';
  if (isAuto) {
    if (auto.running || autoBusy) {
      status = `Autobet${auto.remaining !== null ? ` · ${auto.remaining} left` : ' · running'}${round ? ` · move ${round.moves}` : ''}`;
      tone = 'live';
    } else if (last && round?.outcome) {
      status = `${OUTCOME_TITLE[round.outcome]} · ${fmtMult(last.multiplier)}`;
      tone = last.multiplier > 0 ? 'won' : 'lost';
    } else status = target === null ? 'Auto · play every round to the end' : `Auto · cash out at ${fmtMult(target)}`;
  } else if (phase === 'moving') {
    status = `Rolling · move ${round?.moves ?? 0}`;
    tone = 'live';
  } else if (phase === 'live' && round) {
    status = `Checkpoint · after ${plural(round.moves, 'move')}${traps ? ' · trap next door' : exits ? ' · exit next door' : ''}`;
    tone = 'live';
  } else if (phase === 'over' && round?.outcome) {
    status = `${OUTCOME_TITLE[round.outcome]} · ${plural(round.moves, 'move')}`;
    tone = round.cash > 0 ? 'won' : 'lost';
  }

  const showRound = !!round && (isAuto ? autoBusy || !!round.outcome : true);
  const readouts: ReadoutItem[] = [
    {
      label: 'Win chance',
      value: fmtChance(showRound ? p : p0),
      sub: !showRound ? 'from the start' : end || round?.outcome ? 'final' : 'under the ball',
      tone: 'chance',
    },
    {
      label: 'Cash out now',
      value: showRound && (live || autoBusy || round?.outcome) ? fmtMult(cash) : '—',
      sub: isAuto ? (target === null ? 'Auto plays to the end' : `Auto cashes at ${fmtMult(target)}`) : showRound ? formatAmount(stake * cash, 2) : 'after each roll',
      tone: 'cash',
    },
    { label: 'Exit pays', value: fmtMult(prize), sub: formatAmount((isAuto ? bet.value : stake) * prize, 2), tone: 'prize' },
  ];

  const autoTargets = AUTO_TARGETS.filter((v) => v === null || v < prizeFor(settings));
  const autoTarget = target !== null && target < prizeFor(settings) ? target : null;
  const startOptions = presets.map((c) => ({ value: c, label: pctLabel(maze(mazeId).odds[c]) }));
  if (!presets.includes(start)) startOptions.push({ value: start, label: `◎ ${pctLabel(maze(mazeId).odds[start])}` });

  const settingsPanel = (
    <>
      <Label hint={<VolBadge level={vol} />}>Maze</Label>
      <Chips
        label="Maze"
        options={MAZE_IDS.map((id) => ({ value: id, label: maze(id).short, title: maze(id).name }))}
        value={mazeId}
        disabled={locked}
        onChange={(v) => change(() => pickMaze(v))}
      />
      <Label hint="or tap any cell">Start · win chance</Label>
      <Chips label="Start cell" wrap options={startOptions} value={start} disabled={locked} onChange={(v) => change(() => setStart(v))} />
    </>
  );

  return (
    <GameLayout
      name="Maze"
      accent={ACCENT}
      className="mz-game"
      panel={
        <>
          <ModeTabs auto={auto} disabled={live || autoBusy} />
          <BetField bet={bet} disabled={locked} />
          {settingsPanel}

          {!isAuto ? (
            <>
              <dl className="og-stats">
                <dt>Chance to win</dt>
                <dd>{fmtChance(p0)}</dd>
                <dt>Exit pays</dt>
                <dd>{fmtMult(prizeFor(settings))}</dd>
              </dl>
              {live ? (
                <>
                  <ActionButton kind="cash" disabled={phase !== 'live'} onClick={cashOut}>
                    Cash out <span>{formatAmount(stake * cash, 2)}</span>
                  </ActionButton>
                  <div className="mz-go">
                    <ActionButton kind="secondary" disabled={phase !== 'live'} onClick={() => round && play(round, 1)}>
                      Step · 1 move
                    </ActionButton>
                    <ActionButton kind="secondary" disabled={phase !== 'live'} onClick={() => round && play(round, ROLL)}>
                      {phase === 'moving' ? 'Rolling…' : `Roll · ${ROLL} moves`}
                    </ActionButton>
                  </div>
                </>
              ) : (
                <ActionButton disabled={!!bet.blocked} onClick={() => void startRound()}>
                  {phase === 'over' ? 'Bet again' : 'Bet'}
                </ActionButton>
              )}
            </>
          ) : (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || autoBusy}>
              <Label hint={autoTarget === null ? 'or exit / trap' : `pays ≥ ${fmtMult(autoTarget)}`}>Cash out at</Label>
              <Chips
                label="Auto cash-out target"
                wrap
                options={autoTargets.map((v) => ({ value: v ?? 0, label: v === null ? 'End' : fmtMult(v) }))}
                value={autoTarget ?? 0}
                disabled={auto.running || autoBusy}
                onChange={(v) => change(() => setTarget(v === 0 ? null : v))}
              />
              <dl className="og-stats">
                <dt>{autoTarget === null ? 'Chance to win' : `Chance to reach ${fmtMult(autoTarget)}`}</dt>
                <dd>{fmtChance(autoChance(settings, autoTarget))}</dd>
                <dt>Exit pays</dt>
                <dd>{fmtMult(prizeFor(settings))}</dd>
              </dl>
            </AutoBetControls>
          )}
          {bet.blocked && <p className="mz-blocked">{bet.blocked}</p>}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />
      <Readouts items={readouts} />

      <Board className="mz-board">
        {isAuto && <InstantResult multiplier={last && !autoBusy ? last.multiplier : null} stake={last?.stake ?? 0} id={last?.id ?? 0} />}
        <Field
          maze={m}
          ball={ball}
          start={round?.settings.start ?? start}
          trail={round?.trail ?? []}
          moves={moves}
          p={p}
          end={end}
          moveMs={isAuto ? autoMs : moveMs}
          pickable={pickable}
          onPick={(c) => change(() => setStart(c))}
        />
        <div className="mz-strip" aria-label="Distances">
          <span className="ex">
            <i />
            Exit {end === 'exit' ? <b>reached</b> : <><b>{plural(m.toExit[ball], 'move')}</b> away</>}
          </span>
          <span className="tr">
            <i />
            Trap {end === 'trap' ? <b>fell in</b> : <><b>{plural(m.toTrap[ball], 'move')}</b> away</>}
          </span>
          <span className="mv">
            {round ? `${plural(round.moves, 'move')} played` : 'No moves yet'}
            {!end && <> · about <b>{Math.round(m.moves[ball])}</b> to go</>}
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
          onBetAgain={() => void startRound()}
          onClear={clear}
          placement="inline"
        />
      ) : !isAuto && live ? (
        <ChanceBar
          p={p}
          label="Win chance"
          note={
            moves && outlook ? (
              <>
                The ball takes one of these {moves.length} gaps, 1 in {moves.length} each; their odds average to this
                {traps ? `, and ${traps === 1 ? 'one leads' : `${traps} lead`} into a trap` : exits ? ', and one leads out' : ''}. Next roll of {ROLL}:{' '}
                <b className="g">{fmtChance(outlook.exit)} exit</b> · <b className="r">{fmtChance(outlook.trap)} trap</b>.
              </>
            ) : (
              'Rolling…'
            )
          }
        />
      ) : (
        <Caption>
          <b className="mz-rule">{RULE}</b> Each cell's colour and number are your chance of escaping from there. Tap a cell to start the ball on it; lower
          odds pay more.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Maze" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>{RULE} If the ball rolls onto the green exit you win the prize; if it rolls into a red trap you lose the bet.</p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick a maze and a start cell (a preset, or tap any cell), then press Bet. The first roll plays at once.</li>
              <li>Each move the ball rolls through a random gap in the walls to a neighbouring cell, every gap equally likely.</li>
              <li>After each roll of {ROLL} moves you can cash out (C), roll again (Space) or take a single step.</li>
              <li>Auto plays whole rounds and cashes out as soon as the cash-out reaches your target, or plays to the end.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              Every cell is shaded from red to green and labelled with the exact chance of reaching the exit before a trap if the ball stood there; the thin bar
              at the bottom of each cell fills to the same chance. The number on the ball is your live chance. At a checkpoint the cells the ball can roll to
              next carry badges with the chance each would leave you; the ball picks one at random, so they average to your chance. Along a corridor the odds
              change in even steps, and a dead end has the same odds as its mouth.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              The chance h is the harmonic function on the maze graph: h(exit) = 1, h(trap) = 0, and every other cell's h is the average of its open
              neighbours' h (the discrete Dirichlet problem; it is also the voltage when the exit is held at 1 V, the traps at 0 V and every gap is a 1 Ω
              resistor). The game solves this linear system exactly for each maze, cell by cell.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Reaching the exit pays {(RTP * 100).toFixed(0)}% ÷ the chance of your start cell. Cashing out pays that prize × the chance under the ball. That
              chance is a martingale (each move is a fair bet: the neighbours average to it), so by the optional stopping theorem every way of playing,
              including Auto targets and single steps, returns exactly {(RTP * 100).toFixed(0)}%. Start cells run from 1% to 95%, so the largest prize is under{' '}
              {MAX_MULTIPLIER}×.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
