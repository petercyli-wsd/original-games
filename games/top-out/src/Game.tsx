import { formatAmount } from '@originals/game-sdk';
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
  VolBadge,
  eventMs,
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
import Walls, { type View } from './Board';
import {
  RTP,
  WALLS,
  activeWall,
  decided,
  drawSlips,
  initState,
  markOf,
  prizeOf,
  reach,
  startChance,
  volatilityOf,
  winChance,
  type State,
} from './math';

const RULE = 'Climbers take turns until each hits a hidden slip; the highest climb wins.';
const KEY = 'One hidden slip per wall. Highest climb wins.';
const AUTO_TARGETS = [0, 1.2, 2, 5, 20];

type Phase = 'idle' | 'running' | 'checkpoint' | 'over';
type Outcome = 'won' | 'lost' | 'cashed';

interface Round {
  me: number;
  stake: number;
  prize: number;
  /** Hidden final height of every wall, drawn after place(). */
  F: number[];
  s: State;
  steps: number;
  outcome: Outcome | null;
  cash: number;
}

const blankView = (_me?: number): View => ({
  heights: WALLS.map(() => 0),
  slips: WALLS.map(() => null),
  active: -1,
  reaching: null,
  moveMs: 0,
});

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);

  const [pick, setPick] = useState(3);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [view, setView] = useState<View>(() => blankView(3));
  const [msg, setMsg] = useState<string | null>(null);
  const [chance, setChance] = useState(startChance(3));
  const [infoOpen, setInfoOpen] = useState(false);
  const [target, setTarget] = useState(0);
  const [autoBusy, setAutoBusy] = useState(false);
  const [last, setLast] = useState<{ id: number; multiplier: number; stake: number; won: boolean } | null>(null);
  const seq = useRef(0);
  const busyRef = useRef(false);

  // The reach in flight is decided the moment it starts, so leaving mid-animation settles at its real result.
  const resolved = useRef(0);
  const ticket = useTicket(() => {
    if (phase === 'running' || autoBusy) return resolved.current;
    if (phase === 'checkpoint' && round) return round.prize * winChance(round.s, round.me);
    return 0;
  });

  const ms = autoBusy || turbo.turbo ? eventMs(true) : eventMs(false);
  const live = phase === 'running' || phase === 'checkpoint';

  /** One watched reach. Returns the new round, or null if the board was cleared meanwhile. */
  async function playReach(r: Round, step: number, handover: boolean): Promise<{ next: Round; end: 'won' | 'lost' | null } | null> {
    const ev = reach(r.s, r.F);
    const end = decided(ev.next, r.me);
    const N = WALLS[ev.wall];
    resolved.current = end ? (end === 'won' ? r.prize : 0) : r.prize * winChance(ev.next, r.me);
    setView((v) => ({
      ...v,
      active: ev.wall,
      reaching: { wall: ev.wall, hold: ev.hold },
      moveMs: step,
      heights: v.heights.map((x, j) => (j === ev.wall ? ev.to : x)),
    }));
    setMsg(`Wall ${N} reaching hold ${ev.hold}`);
    if (!(await timers.wait(step))) return null;
    setView((v) => ({ ...v, reaching: null, slips: v.slips.map((x, j) => (j === ev.wall && ev.slipHold ? ev.slipHold : x)) }));
    const stopped = ev.kind !== 'reach';
    let line = ev.kind === 'slip' ? `Wall ${N} slipped at ${ev.from}` : ev.kind === 'topped' ? `Wall ${N} topped out at ${ev.to}` : `Wall ${N} reached hold ${ev.to}`;
    if (end === 'lost') line = ev.wall === r.me ? `Wall ${N} slipped at ${ev.from}: lost` : `Wall ${N} passed you: lost`;
    if (end === 'won') line = ev.wall === r.me ? `You passed ${markOf(r.s)}: win` : 'Nobody passed you: win';
    setMsg(line);
    if (stopped && !(await timers.wait(Math.round((450 * step) / 600)))) return null;
    const next: Round = { ...r, s: ev.next, steps: r.steps + 1 };
    if (end) {
      setView((v) => ({ ...v, active: -1 }));
    } else if (stopped) {
      const w = activeWall(ev.next);
      setView((v) => ({ ...v, active: w }));
      const m = markOf(ev.next);
      setMsg(m > 0 ? `Pass ${m} to lead` : `Wall ${WALLS[w]} climbs next`);
      if (handover && !(await timers.wait(Math.round((400 * step) / 600)))) return null;
    }
    setChance(end ? (end === 'won' ? 1 : 0) : winChance(ev.next, r.me));
    return { next, end };
  }

  function finish(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setView((v) => ({ ...v, active: -1 }));
    setPhase('over');
    busyRef.current = false;
  }

  async function runStep(r: Round) {
    if (busyRef.current && phase === 'running') return;
    busyRef.current = true;
    setPhase('running');
    const res = await playReach(r, ms, false);
    if (!res) return;
    const { next, end } = res;
    if (end) return finish(next, end, end === 'won' ? r.prize : 0);
    busyRef.current = false;
    setRound(next);
    setPhase('checkpoint');
    track({ type: 'checkpoint', multiplier: r.prize * winChance(next.s, next.me), winChance: winChance(next.s, next.me) });
  }

  async function start() {
    if (busyRef.current || live || autoBusy || bet.blocked) return;
    busyRef.current = true;
    if (!(await ticket.place(bet.value))) {
      busyRef.current = false;
      return;
    }
    timers.clearAll();
    resolved.current = RTP;
    const r: Round = { me: pick, stake: bet.value, prize: prizeOf(pick), F: drawSlips(rng.int), s: initState(), steps: 0, outcome: null, cash: RTP };
    setRound(r);
    setLast(null);
    setView({ ...blankView(pick), active: 0 });
    setMsg(null);
    setChance(startChance(pick));
    setPhase('running');
    busyRef.current = false;
    await timers.wait(30);
    void runStep(r);
  }

  function nextReach() {
    if (phase === 'checkpoint' && round && !busyRef.current) void runStep(round);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round || busyRef.current) return;
    finish(round, 'cashed', round.prize * winChance(round.s, round.me));
  }

  function clear() {
    if (live || autoBusy) return;
    timers.clearAll();
    setRound(null);
    setLast(null);
    setPhase('idle');
    setView(blankView(pick));
    setMsg(null);
    setChance(startChance(pick));
  }

  // ---------- Auto ----------

  async function playAuto(stake: number): Promise<number | null> {
    const me = pick;
    const goal = target;
    if (!(await ticket.place(stake))) return null;
    setAutoBusy(true);
    setRound(null);
    setPhase('idle');
    setLast(null);
    let r: Round = { me, stake, prize: prizeOf(me), F: drawSlips(rng.int), s: initState(), steps: 0, outcome: null, cash: RTP };
    resolved.current = RTP;
    setView({ ...blankView(me), active: 0 });
    setChance(startChance(me));
    await timers.wait(40);
    const step = eventMs(true);
    let mult = 0;
    for (;;) {
      const res = await playReach(r, step, true);
      if (!res) return null;
      r = res.next;
      if (res.end) {
        mult = res.end === 'won' ? r.prize : 0;
        break;
      }
      const value = r.prize * winChance(r.s, me);
      if (goal > 0 && value >= goal) {
        mult = value;
        setView((v) => ({ ...v, active: -1 }));
        setMsg(`Cashed out at ${fmtMult(value)}`);
        break;
      }
    }
    ticket.settle(mult);
    pushHistory(mult);
    setLast({ id: ++seq.current, multiplier: mult, stake, won: mult > 0 });
    setAutoBusy(false);
    return mult;
  }

  const auto = useAutoBet({ bet, play: playAuto, turbo: turbo.turbo });
  const isAuto = auto.mode === 'auto';
  const autoLocked = auto.running || autoBusy;

  // Changing the backed wall clears a finished board to a preview of the new settings.
  function changePick(p: number) {
    if (live || autoLocked || p === pick) return;
    timers.clearAll();
    setPick(p);
    setRound(null);
    setLast(null);
    setPhase('idle');
    setView(blankView(p));
    setMsg(null);
    setChance(startChance(p));
    if (target > prizeOf(p)) setTarget(0);
  }

  function changeMode() {
    timers.clearAll();
    setRound(null);
    setLast(null);
    setPhase('idle');
    setView(blankView(pick));
    setMsg(null);
    setChance(startChance(pick));
  }
  useEffect(() => {
    changeMode();
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
        if (phase === 'checkpoint') nextReach();
        else if (phase === 'idle' || phase === 'over') void start();
      },
      cashOut,
    },
    !infoOpen,
  );

  // ---------- What the board shows ----------

  const me = round?.me ?? pick;
  const prize = round?.prize ?? prizeOf(pick);
  const stake = round?.stake ?? bet.value;
  const boardLive = live || autoBusy;
  const over = (!isAuto && phase === 'over') || (isAuto && !!last && !autoBusy);
  const myChance = round && phase === 'checkpoint' ? winChance(round.s, round.me) : boardLive || over ? chance : startChance(pick);
  const cashNow = round ? round.prize * winChance(round.s, round.me) : RTP;
  const vol = volatilityOf(startChance(pick));

  let status = `Ready: you back wall ${WALLS[pick]}`;
  let tone: StatusTone = 'idle';
  if (isAuto && !boardLive && !over) status = `Auto: wall ${WALLS[pick]}${target ? `, cash at ${fmtMult(target)}` : ''}`;
  if (msg && (boardLive || over)) status = msg;
  if (boardLive) tone = 'live';
  if (over) tone = (isAuto ? last?.won : round && round.cash > 0) ? 'won' : 'lost';
  if (!isAuto && over && round?.outcome === 'cashed') status = `Cashed out at ${fmtMult(round.cash)}`;

  const title = round?.outcome === 'won' ? `Wall ${WALLS[me]} wins` : round?.outcome === 'cashed' ? 'Cashed out' : 'Top out lost';

  return (
    <GameLayout
      name="Top Out"
      accent={ACCENTS.amber}
      panel={
        <>
          <ModeTabs auto={auto} disabled={live || autoBusy} />
          <BetField bet={bet} disabled={live || autoLocked} />

          <Label hint={<VolBadge level={vol} />}>Back a wall</Label>
          <Chips
            label="Back a wall"
            options={WALLS.map((N, i) => ({ value: i, label: N, title: `${N} holds` }))}
            value={live ? me : pick}
            disabled={live || autoLocked}
            onChange={changePick}
          />

          {!isAuto ? (
            phase === 'checkpoint' ? (
              <>
                <ActionButton kind="secondary" onClick={nextReach}>
                  Next reach
                </ActionButton>
                <ActionButton kind="cash" onClick={cashOut}>
                  Cash out <span>{formatAmount(stake * cashNow, 2)}</span>
                </ActionButton>
              </>
            ) : (
              <ActionButton disabled={phase === 'running' || !!bet.blocked} onClick={() => void start()}>
                {phase === 'running' ? 'Climbing…' : phase === 'over' ? 'Bet again' : 'Bet'}
              </ActionButton>
            )
          ) : (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || autoBusy}>
              <Label hint="checked after every reach">Cash out at</Label>
              <Chips
                label="Auto cash-out"
                wrap
                options={AUTO_TARGETS.map((v) => ({ value: v, label: v === 0 ? 'The end' : fmtMult(v), disabled: v > prizeOf(pick) }))}
                value={target}
                disabled={autoLocked}
                onChange={(v) => setTarget(Number(v))}
              />
            </AutoBetControls>
          )}
          {bet.blocked && <p className="to-blocked">{bet.blocked}</p>}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />
      <Readouts
        items={[
          { label: 'Win chance', value: `${(myChance * 100).toFixed(myChance < 0.1 && myChance > 0 ? 2 : 1)}%`, tone: 'chance' },
          { label: `If wall ${WALLS[me]} wins`, value: fmtMult(prize), tone: 'prize' },
        ]}
      />

      <Board>
        {isAuto && <InstantResult multiplier={last && !autoBusy ? last.multiplier : null} stake={last?.stake ?? 0} id={last?.id ?? 0} />}
        <div className="to-wrap">
          <Walls view={view} me={me} />
          <p className="to-key">{KEY}</p>
        </div>
      </Board>

      {!isAuto && phase === 'over' && round?.outcome ? (
        <RoundOver
          key={history[0]?.id}
          title={title}
          multiplier={round.cash}
          stake={round.stake}
          nextBet={bet.value}
          blocked={bet.blocked}
          onBetAgain={() => void start()}
          onClear={clear}
          placement="inline"
        />
      ) : boardLive ? (
        <ChanceBar p={myChance} label={`Wall ${WALLS[me]} wins`} />
      ) : (
        <Caption>{RULE}</Caption>
      )}

      {infoOpen && (
        <InfoModal title="Top Out" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>{RULE} Back one of four walls (2, 4, 8 or 16 holds). If your climber ends highest, you win the prize.</p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick a wall and bet. The walls climb in order, shortest first, one reach at a time.</li>
              <li>Each wall hides one slip hold. A reach is safe unless it is the slip. A slipped climber stays where it was.</li>
              <li>After each reach, take Next reach (Space) or Cash out (C). Your wall is fixed for the round.</li>
              <li>A tie goes to the earlier climber: a later climber must pass the mark, not reach it. The round stops the moment it is decided.</li>
              <li>Auto: pick a wall and a cash-out target (or ride to the end), then start. Turbo speeds every reach up.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              Holds are dots. The slip is one of the dots still above a climber, all equally likely, so a climber with k dots above slips on the next reach with
              chance 1 in k. When one dot is left it must be the slip, so that climb stops there. The line marked Mark is the best height so far. The bar is your
              exact chance to win from here. A safe reach by your own climber raises it; a safe reach by a rival lowers it.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Each wall's final height is uniform from 0 to N−1, independent of the others, and after a safe reach it is uniform over the heights still possible.
              Your wall k wins if its height beats every earlier wall and matches or beats every later wall. That is an exact count over at most 1,024 equally
              likely slip layouts. Win chances for walls 2, 4, 8, 16: 0.88%, 5.27%, 24.02%, 69.82%.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              A win pays {(RTP * 100).toFixed(0)}% ÷ its chance: {WALLS.map((N, i) => `${N}: ${fmtMult(prizeOf(i))}`).join(', ')}. Cash out is the prize times your
              current exact chance, a martingale, so by the optional stopping theorem no way of cashing out changes the {(RTP * 100).toFixed(0)}% return.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
