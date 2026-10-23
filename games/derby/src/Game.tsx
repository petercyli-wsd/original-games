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
import Field, { fmtChance } from './Board';
import {
  FIELD,
  GAITS,
  LEG,
  MAX_WIN,
  RTP,
  TRACKS,
  TRACK_NAME,
  leg,
  legOutcomes,
  payout,
  startChances,
  startPrize,
  switchPrize,
  volatilityOf,
  winChances,
  type Tick,
  type Track,
} from './math';

const ACCENT = '#2a9d8f';
const RULE = 'Back a runner; first past the line wins, and you can switch horses at fair value.';
const AUTO_TARGETS = [0, 1.5, 2, 3, 5, 10];

type Phase = 'idle' | 'running' | 'checkpoint' | 'over';
type Outcome = 'won' | 'heat' | 'lost' | 'cashed' | 'out' | 'sure';

interface Round {
  L: Track;
  me: number;
  stake: number;
  /** Paid if your runner wins outright (split in a dead heat). */
  prize: number;
  /** True positions (all short of the line while the race is live). */
  pos: number[];
  legs: number;
  switches: number;
  outcome: Outcome | null;
  cash: number;
  winners: number[] | null;
  crossed: { runner: number; at: number }[];
}

interface Display {
  pos: number[];
  chances: number[];
  moveMs: number;
  /** Chances before the latest tick, so the board can flash which way each moved. */
  prev?: number[];
}

interface Last {
  id: number;
  multiplier: number;
  stake: number;
}

const name = (i: number) => `#${i + 1} ${GAITS[FIELD[i].gait].name}`;
const zeros = () => FIELD.map(() => 0);

function title(r: Round): string {
  switch (r.outcome) {
    case 'won':
      return `${name(r.me)} wins!`;
    case 'heat':
      return `Dead heat · ${name(r.me)}`;
    case 'lost':
      return r.winners && r.winners.length > 1 ? 'Dead heat, not yours' : `${r.winners ? name(r.winners[0]) : 'Another runner'} won`;
    case 'cashed':
      return 'Cashed out';
    case 'out':
      return `${name(r.me)} can't catch up`;
    case 'sure':
      return `${name(r.me)} can't be caught`;
    default:
      return '';
  }
}

function overNote(r: Round): string {
  if (r.outcome === 'cashed') return `Cashed out after leg ${r.legs} at ${fmtMult(r.cash)}`;
  if (r.outcome === 'out') return `${name(r.me)} could no longer win: settled at 0×`;
  if (r.outcome === 'sure') return `Nobody can catch ${name(r.me)}: settled at ${fmtMult(r.cash)}`;
  return '';
}

/** Narrow boards get a compact lane layout with bigger type. */
function useNarrow(threshold: number) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setNarrow(e.contentRect.width < threshold));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, threshold]);
  return [narrow, setEl] as const;
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);
  const [narrow, wrapRef] = useNarrow(540);

  const [L, setL] = useState<Track>(30);
  const [pick, setPick] = useState(1);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [display, setDisplay] = useState<Display>(() => ({ pos: zeros(), chances: startChances(30), moveMs: 0 }));
  const [infoOpen, setInfoOpen] = useState(false);

  const [target, setTarget] = useState(2);
  const [autoBusy, setAutoBusy] = useState(false);
  const [autoRound, setAutoRound] = useState<Round | null>(null);
  const [last, setLast] = useState<Last | null>(null);
  const seq = useRef(0);

  // Every leg is decided the moment it starts, so leaving mid-animation
  // settles at its real result, never at the pre-leg value.
  const resolved = useRef(0);
  const ticket = useTicket(() => {
    if (phase === 'running' || autoBusy) return resolved.current;
    if (phase === 'checkpoint' && round) return round.prize * winChances(round.pos, round.L)[round.me];
    return 0;
  });

  const tickMs = turbo.turbo ? 90 : 340;
  const autoTickMs = turbo.turbo ? 28 : 110;
  const live = phase === 'running' || phase === 'checkpoint';

  // ---------- The race ----------

  /** Plays the ticks of one leg on the board; false if the board was cleared meanwhile. */
  async function animate(ticks: Tick[], L: number, ms: number): Promise<boolean> {
    for (let k = 0; k < ticks.length; k++) {
      const t = ticks[k];
      const chances = t.winners ? FIELD.map((_, i) => (t.winners!.includes(i) ? 1 / t.winners!.length : 0)) : winChances(t.pos, L);
      setDisplay((d) => ({ pos: t.pos, chances, moveMs: ms, prev: d.chances }));
      if (!(await timers.wait(ms + (t.winners ? ms : 0)))) return false;
    }
    return true;
  }

  function finish(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setPhase('over');
  }

  async function runLeg(r: Round) {
    const ticks = leg(r.pos, r.L, rng.next);
    const end = ticks[ticks.length - 1];
    const P = end.winners ? null : winChances(end.pos, r.L);
    resolved.current = end.winners ? payout(r.prize, r.me, end.winners) : r.prize * P![r.me];
    setPhase('running');
    if (!(await animate(ticks, r.L, tickMs))) return;
    const next: Round = { ...r, pos: end.pos, legs: r.legs + 1, winners: end.winners, crossed: end.crossed };
    if (end.winners) {
      const mult = payout(r.prize, r.me, end.winners);
      return finish(next, mult > 0 ? (end.winners.length > 1 ? 'heat' : 'won') : 'lost', mult);
    }
    const value = r.prize * P![r.me];
    if (P![r.me] <= 0) return finish(next, 'out', 0);
    if (P![r.me] >= 1 - 1e-12) return finish(next, 'sure', value);
    setRound(next);
    setPhase('checkpoint');
    track({ type: 'checkpoint', multiplier: value, winChance: P![r.me] });
  }

  async function start() {
    if (live || autoBusy || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    setLast(null);
    setAutoRound(null);
    const r: Round = {
      L,
      me: pick,
      stake: bet.value,
      prize: startPrize(L, pick),
      pos: zeros(),
      legs: 0,
      switches: 0,
      outcome: null,
      cash: RTP,
      winners: null,
      crossed: [],
    };
    setRound(r);
    setDisplay({ pos: zeros(), chances: startChances(L), moveMs: 0 });
    // From here the ticket is worth RTP until the first leg is decided.
    resolved.current = RTP;
    setPhase('running');
    await timers.wait(30);
    void runLeg(r);
  }

  function nextLeg() {
    if (phase === 'checkpoint' && round) void runLeg(round);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', round.prize * winChances(round.pos, round.L)[round.me]);
  }

  /** Moves your whole cash-out value onto runner j: the prize relocks at value / P(j). */
  function switchTo(j: number) {
    if (phase !== 'checkpoint' || !round || j === round.me) return;
    const P = winChances(round.pos, round.L);
    const prize = switchPrize(round.prize * P[round.me], P[j]);
    if (prize === null) return;
    setRound({ ...round, me: j, prize, switches: round.switches + 1 });
  }

  function clear() {
    if (live || autoBusy) return;
    timers.clearAll();
    setRound(null);
    setAutoRound(null);
    setLast(null);
    setPhase('idle');
    setDisplay({ pos: zeros(), chances: startChances(L), moveMs: 0 });
  }

  // ---------- Auto ----------

  async function playAuto(stake: number): Promise<number | null> {
    const T = L;
    const me = pick;
    const goal = target;
    if (!(await ticket.place(stake))) return null;
    setAutoBusy(true);
    setRound(null);
    setPhase('idle');
    setLast(null);
    let r: Round = { L: T, me, stake, prize: startPrize(T, me), pos: zeros(), legs: 0, switches: 0, outcome: null, cash: RTP, winners: null, crossed: [] };
    setAutoRound(r);
    setDisplay({ pos: zeros(), chances: startChances(T), moveMs: 0 });
    resolved.current = RTP;
    await timers.wait(40);
    let mult = 0;
    for (;;) {
      const ticks = leg(r.pos, T, rng.next);
      const end = ticks[ticks.length - 1];
      const P = end.winners ? null : winChances(end.pos, T);
      const value = end.winners ? payout(r.prize, me, end.winners) : r.prize * P![me];
      resolved.current = value;
      if (!(await animate(ticks, T, autoTickMs))) {
        // The game was left mid-race; the ticket settles at the decided value.
        return null;
      }
      r = { ...r, pos: end.pos, legs: r.legs + 1, winners: end.winners, crossed: end.crossed };
      if (end.winners) {
        mult = value;
        r.outcome = value > 0 ? (end.winners.length > 1 ? 'heat' : 'won') : 'lost';
        break;
      }
      setAutoRound(r);
      if (P![me] <= 0 || P![me] >= 1 - 1e-12 || (goal > 0 && value >= goal)) {
        mult = value;
        r.outcome = P![me] <= 0 ? 'out' : P![me] >= 1 - 1e-12 ? 'sure' : 'cashed';
        break;
      }
    }
    r.cash = mult;
    setAutoRound(r);
    ticket.settle(mult);
    pushHistory(mult);
    setLast({ id: ++seq.current, multiplier: mult, stake });
    setAutoBusy(false);
    return mult;
  }

  const auto = useAutoBet({ bet, play: playAuto, turbo: turbo.turbo });
  const isAuto = auto.mode === 'auto';
  const autoLocked = auto.running || autoBusy;

  // Switching Manual / Auto starts from a clean board.
  useEffect(() => {
    timers.clearAll();
    setRound(null);
    setAutoRound(null);
    setLast(null);
    setPhase('idle');
    setDisplay({ pos: zeros(), chances: startChances(L), moveMs: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto.mode]);

  // Changing a setting clears a finished board to a preview of the new settings.
  function changeTrack(t: Track) {
    if (live || autoLocked || t === L) return;
    setL(t);
    timers.clearAll();
    setRound(null);
    setAutoRound(null);
    setLast(null);
    setPhase('idle');
    setDisplay({ pos: zeros(), chances: startChances(t), moveMs: 0 });
  }

  function choose(i: number) {
    if (autoLocked) return;
    if (phase === 'checkpoint') return switchTo(i);
    if (live) return;
    setPick(i);
    if (phase === 'over' || autoRound || last) {
      timers.clearAll();
      setRound(null);
      setAutoRound(null);
      setLast(null);
      setPhase('idle');
      setDisplay({ pos: zeros(), chances: startChances(L), moveMs: 0 });
    }
  }

  useHotkeys(
    {
      space: () => {
        if (isAuto) {
          if (auto.running) auto.stop();
          else if (!autoBusy && !bet.blocked) auto.start();
          return;
        }
        if (phase === 'checkpoint') nextLeg();
        else if (phase === 'idle' || phase === 'over') void start();
      },
      cashOut,
    },
    !infoOpen,
  );

  // Keys 1–6 pick a runner (or switch to it at a checkpoint).
  const chooseRef = useRef(choose);
  chooseRef.current = choose;
  useEffect(() => {
    if (infoOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.composedPath()[0] as HTMLElement | undefined;
      if (t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const d = Number(e.key);
      if (Number.isInteger(d) && d >= 1 && d <= FIELD.length) chooseRef.current(d - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [infoOpen]);

  // ---------- What the board shows ----------

  const shown = isAuto ? autoRound : round;
  const T = shown?.L ?? L;
  const me = shown?.me ?? pick;
  const boardPhase: 'idle' | 'live' | 'over' = shown?.outcome ? 'over' : live || (isAuto && autoBusy) ? 'live' : 'idle';
  const truePos = shown?.pos ?? zeros();
  const P = useMemo(() => (shown && !shown.outcome ? winChances(shown.pos, shown.L) : startChances(T)), [shown, T]);
  const running = phase === 'running' || (isAuto && autoBusy);
  const myChance = running || boardPhase === 'over' ? display.chances[me] : P[me];
  const value = shown && !shown.outcome ? shown.prize * myChance : shown?.cash ?? RTP;
  const prize = shown?.prize ?? startPrize(L, pick);
  const outcomes = useMemo(
    () => (shown?.outcome ? null : legOutcomes(truePos, T, me)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shown, T, me],
  );
  const stake = shown?.stake ?? bet.value;
  const startP = startChances(L)[pick];
  const vol = volatilityOf(startP);
  const switchable = (j: number) => {
    if (!round || phase !== 'checkpoint' || j === round.me) return false;
    return switchPrize(round.prize * myChance, P[j]) !== null;
  };

  let status = `Ready · ${name(pick)} at ${fmtChance(startP)} · ${TRACK_NAME[L]} ${L}`;
  let tone: StatusTone = 'idle';
  if (isAuto) {
    if (auto.running || autoBusy) {
      status = `Autobet · ${name(me)}${auto.remaining !== null ? ` · ${auto.remaining} left` : ''}`;
      tone = 'live';
    } else if (last && autoRound) {
      status = `${title(autoRound)} · ${fmtMult(last.multiplier)}`;
      tone = last.multiplier > 0 ? 'won' : 'lost';
    } else status = `Auto · ${name(pick)} · ${target ? `cash out at ${fmtMult(target)}` : 'ride to the line'}`;
  } else if (phase === 'running') {
    status = `Leg ${(round?.legs ?? 0) + 1} · they're running`;
    tone = 'live';
  } else if (phase === 'checkpoint' && round) {
    status = `Checkpoint after leg ${round.legs} · cash out, switch or run on`;
    tone = 'live';
  } else if (phase === 'over' && round?.outcome) {
    status = `${title(round)} · leg ${round.legs}`;
    tone = round.cash > 0 ? 'won' : 'lost';
  }

  const readouts: ReadoutItem[] = [
    {
      label: `${name(me)} wins`,
      value: fmtChance(myChance),
      sub: boardPhase === 'idle' ? `${TRACK_NAME[T]} · ${T} long` : boardPhase === 'over' ? 'race over' : 'its share on the tote',
      tone: 'chance',
    },
    {
      label: boardPhase === 'over' ? 'Paid' : running ? 'Worth now' : 'Cash out now',
      value: boardPhase !== 'idle' ? fmtMult(value) : '—',
      sub: running && boardPhase === 'live' ? (isAuto ? `live · auto ${target ? `cashes at ${fmtMult(target)}` : 'rides to the line'}` : 'live · cash out after the leg') : boardPhase !== 'idle' ? formatAmount(stake * value, 2) : 'after each leg',
      tone: 'cash',
    },
    {
      label: `If #${me + 1} wins`,
      value: fmtMult(prize),
      sub: shown?.switches ? `relocked ${shown.switches}× by switching` : `pays ${formatAmount(stake * prize, 2)}`,
      tone: 'prize',
    },
  ];

  const pickerChances = phase === 'checkpoint' || phase === 'running' ? P : startChances(L);
  const picker = (
    <>
      <Label hint={phase === 'checkpoint' ? 'chance → new prize' : <VolBadge level={vol} />}>{phase === 'checkpoint' ? 'Switch runner' : 'Back a runner'}</Label>
      <div className="dby-pick" role="radiogroup" aria-label="Runner">
        {FIELD.map((r, i) => {
          const on = i === (phase === 'checkpoint' || phase === 'running' ? round?.me ?? pick : pick);
          const disabled = autoLocked || phase === 'running' || (phase === 'checkpoint' && !on && !switchable(i));
          const np = phase === 'checkpoint' && round && !on ? switchPrize(round.prize * myChance, P[i]) : null;
          return (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={on}
              className={'dby-runner' + (on ? ' on' : '')}
              disabled={disabled || (phase === 'checkpoint' && on)}
              title={np !== null ? `Switch: prize relocks at ${fmtMult(np)}` : GAITS[r.gait].detail}
              onClick={() => choose(i)}
            >
              <i style={{ background: r.colour }}>{i + 1}</i>
              <span>{GAITS[r.gait].name}</span>
              <b>{np !== null ? `${fmtChance(pickerChances[i])} → ${fmtMult(np)}` : fmtChance(pickerChances[i])}</b>
            </button>
          );
        })}
      </div>
    </>
  );

  return (
    <GameLayout
      name="Derby"
      accent={ACCENT}
      className="dby-game"
      panel={
        <>
          <ModeTabs auto={auto} disabled={live || autoBusy} />
          <BetField bet={bet} disabled={live || autoLocked} />

          <Label hint={`${L} to the line`}>Track</Label>
          <Chips
            label="Track"
            options={TRACKS.map((t) => ({ value: t, label: TRACK_NAME[t] }))}
            value={L}
            disabled={live || autoLocked}
            onChange={changeTrack}
          />
          {picker}

          {!isAuto ? (
            <>
              <dl className="og-stats">
                <dt>Chance to win</dt>
                <dd>{fmtChance(phase === 'checkpoint' ? myChance : startP)}</dd>
                <dt>Prize</dt>
                <dd>{fmtMult(phase === 'checkpoint' || phase === 'running' ? prize : startPrize(L, pick))}</dd>
              </dl>
              {phase === 'checkpoint' ? (
                <>
                  <ActionButton kind="cash" onClick={cashOut}>
                    Cash out <span>{formatAmount(stake * value, 2)}</span>
                  </ActionButton>
                  <ActionButton kind="secondary" onClick={nextLeg}>
                    Run next leg · {LEG} ticks
                  </ActionButton>
                </>
              ) : (
                <ActionButton disabled={phase === 'running' || !!bet.blocked} onClick={() => void start()}>
                  {phase === 'running' ? 'Running…' : phase === 'over' ? 'Bet again' : 'Bet'}
                </ActionButton>
              )}
            </>
          ) : (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || autoBusy}>
              <Label hint="checked after every leg">Cash out at</Label>
              <Chips
                label="Auto cash-out"
                wrap
                options={AUTO_TARGETS.map((v) => ({ value: v, label: v === 0 ? 'The line' : fmtMult(v) }))}
                value={target}
                disabled={autoLocked}
                onChange={(v) => {
                  setTarget(v);
                  if (!autoLocked) {
                    setAutoRound(null);
                    setLast(null);
                    setDisplay({ pos: zeros(), chances: startChances(L), moveMs: 0 });
                  }
                }}
              />
              <dl className="og-stats">
                <dt>Chance to win</dt>
                <dd>{fmtChance(startP)}</dd>
                <dt>Prize at the line</dt>
                <dd>{fmtMult(startPrize(L, pick))}</dd>
              </dl>
            </AutoBetControls>
          )}
          {bet.blocked && <p className="dby-blocked">{bet.blocked}</p>}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />
      <Readouts items={readouts} />

      <Board className="dby-board">
        {isAuto && <InstantResult multiplier={last && !autoBusy ? last.multiplier : null} stake={last?.stake ?? 0} id={last?.id ?? 0} />}
        <div className="dby-wrap" ref={wrapRef}>
          <Field
            L={T}
            pos={boardPhase === 'idle' && !shown ? zeros() : display.pos}
            chances={boardPhase === 'idle' && !shown ? P : display.chances}
            prev={running && boardPhase === 'live' ? display.prev ?? null : null}
            me={me}
            outcomes={outcomes}
            winners={shown?.outcome ? shown.winners : null}
            crossed={shown?.crossed ?? []}
            moveMs={display.moveMs}
            narrow={narrow}
            phase={boardPhase}
            running={running}
            legNow={P[me]}
            pickable={(i) => (phase === 'checkpoint' ? switchable(i) : !live && !autoLocked && i !== pick)}
            onPick={choose}
            note={shown?.outcome && (isAuto || !shown.winners) ? (isAuto ? title(shown) : overNote(shown)) : null}
            photo={!isAuto}
          />
        </div>
      </Board>

      {!isAuto && phase === 'over' && round?.outcome ? (
        <RoundOver
          key={history[0]?.id}
          title={title(round)}
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
          p={myChance}
          label={`${name(me)} wins`}
          note={
            phase === 'checkpoint'
              ? 'Click a lane or press 1–6 to switch at fair value. Space runs the next leg, C cashes out.'
              : 'The tote above the lanes is every runner’s exact chance; it moves with every stride.'
          }
        />
      ) : (
        <Caption>
          <b className="dby-rule">{RULE}</b>
          <br />
          {isAuto
            ? `Each bet backs ${name(pick)} and ${target ? `cashes out once the value reaches ${fmtMult(target)}` : 'rides to the line'}. RTP ${(RTP * 100).toFixed(0)}%.`
            : `Same average speed, different gaits: the tote shows each runner's exact chance. Pick a lane, then Bet. RTP ${(RTP * 100).toFixed(0)}%.`}
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Derby" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>{RULE} Six runners race along a track; your runner pays its prize if it is the first across the finish line.</p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Choose a track (Sprint 20, Mile 30, Marathon 40) and back a runner. A long shot pays more and wins less often.</li>
              <li>Press Bet. The race runs in legs of {LEG} ticks; every tick each runner strides a random distance from its own gait.</li>
              <li>After each leg: cash out (C), run the next leg (Space), or switch to another runner (click its lane or press 1–6).</li>
              <li>Switching moves your whole cash-out value onto the new runner: its prize relocks at value ÷ its chance.</li>
              <li>Auto: pick a runner and a cash-out target (or ride to the line), then Start autobet. Turbo speeds every race up.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The <b>tote</b> bar above the lanes is split into every runner's exact chance to win; the shares always add up to 100%. The lane bars on the right show
              the same numbers. Under the track, <b>Next leg</b> splits the coming leg by how far your runner goes: each bar's width is how likely that distance is,
              its height the chance you would have afterwards. The bars average exactly to your chance now (the dashed line). Ticks on your lane mark where those
              distances would land you.
            </p>
            <ul>
              {FIELD.map((r, i) => (
                <li key={i}>
                  <b style={{ color: r.colour }}>
                    #{i + 1} {GAITS[r.gait].name}
                  </b>
                  : {GAITS[r.gait].detail}.
                </li>
              ))}
            </ul>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              The runners are independent, so each one's finishing time T<sub>i</sub> has its own distribution, computed exactly from its position by dynamic
              programming over its gait. Then P(i first) = Σ<sub>t</sub> P(T<sub>i</sub> = t) · Π<sub>j≠i</sub> P(T<sub>j</sub> &gt; t), with exact dead heats
              split evenly. A runner crosses part-way through a tick in proportion to its stride, so the one that is first past the line wins.
            </p>
            <p>
              Steady (1 or 2) and Erratic (0 or 3) have the same average stride, yet Erratic wins far more often: a race is won by the <i>minimum</i> finishing
              time, and spread helps the minimum.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Backing a runner with chance p pays {(RTP * 100).toFixed(0)}% ÷ p if it wins. The cash-out is always prize × its current chance, a martingale, so by
              the optional stopping theorem no timing of cash-outs or switches changes the expected return of {(RTP * 100).toFixed(0)}%. Switching keeps the value
              and relocks the prize at value ÷ the new chance; a switch that would lock a prize over {fmtMult(MAX_WIN)} is not offered.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
