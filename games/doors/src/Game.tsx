import { useHost } from '@originals/game-sdk/react';
import {
  ActionButton,
  BetField,
  Board,
  Caption,
  ChanceBar,
  Chips,
  GameLayout,
  InfoModal,
  InfoSection,
  Label,
  PanelFoot,
  Readouts,
  RoundOver,
  StageTop,
  VolBadge,
  fmtChance,
  fmtMult,
  useBetInput,
  useHistory,
  useHotkeys,
  useTicket,
  useTimers,
  useTurbo,
} from '@originals/game-sdk/ui';
import { formatAmount } from '@originals/game-sdk';
import { useRef, useState } from 'react';
import Field, { type Result } from './Board';
import {
  DOOR_COUNTS,
  PLANS,
  RTP,
  canOpen,
  cashValue,
  closedCount,
  closedDoors,
  hostPick,
  lockedPrize,
  newState,
  openDoor,
  otherDoor,
  planChance,
  planPrize,
  posterior,
  prizeOf,
  switchTo,
  volatilityOf,
  winChance,
  type DoorCount,
  type DoorsState,
  type Plan,
} from './math';

const ACCENT = '#bdb2ff';

type Phase = 'idle' | 'opening' | 'checkpoint' | 'revealing' | 'over';

interface Round {
  doors: DoorCount;
  plan: Plan;
  stake: number;
  /** Decided at bet time; the board only shows it once the round is over. */
  prizeDoor: number;
  state: DoorsState;
  /** Value at the end of the round. */
  cash: number;
  result: Result | null;
  revealed: number[];
  /** The door the plan switched you to at the final two, if it did. */
  autoDoor: number | null;
}

const RESULT_TITLE: Record<Result, string> = { won: 'Prize found', lost: 'Empty door', cashed: 'Cashed out' };
const PLAN_LABEL: Record<Plan, string> = { stay: 'Stay', switch: 'Switch' };

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [doors, setDoors] = useState<DoorCount>(5);
  const [plan, setPlan] = useState<Plan>('stay');
  const [pick, setPick] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [opening, setOpening] = useState<number | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  // A step's outcome is decided the moment it starts, so leaving mid-animation
  // settles at its real result, never at the pre-step value.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'opening' || phase === 'revealing' ? resolved.current : round ? cashValue(round.state) : 0));

  const swingMs = turbo.turbo ? 160 : 600;
  const flowMs = turbo.turbo ? 160 : 650;
  const live = phase === 'opening' || phase === 'checkpoint' || phase === 'revealing';

  function finish(r: Round, result: Result, cash: number, revealed: number[]) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, result, cash, revealed });
    setOpening(null);
    setPhase('over');
  }

  /** The host opens one empty door you don't hold; the bars then flow. */
  function step(r: Round) {
    const z = hostPick(r.state, r.prizeDoor, rng);
    let next = openDoor(r.state, z);
    let autoDoor: number | null = null;
    if (!canOpen(next) && r.plan === 'switch') {
      next = switchTo(next, otherDoor(next));
      autoDoor = next.held;
    }
    resolved.current = cashValue(next);
    setPhase('opening');
    setOpening(z);
    timers.after(swingMs, () => {
      setRound({ ...r, state: next, autoDoor });
      setOpening(null);
      timers.after(flowMs, () => {
        setPhase('checkpoint');
        track({ type: 'checkpoint', multiplier: cashValue(next), winChance: winChance(next) });
      });
    });
  }

  /** Both final doors open: the prize locked on your door, or nothing. */
  function reveal(r: Round) {
    const s = r.state;
    const won = s.held === r.prizeDoor;
    const cash = won ? lockedPrize(s) : 0;
    resolved.current = cash;
    setPhase('revealing');
    setRound({ ...r, revealed: closedDoors(s) });
    timers.after(swingMs + 250, () => finish(r, won ? 'won' : 'lost', cash, closedDoors(s)));
  }

  function advance() {
    if (phase !== 'checkpoint' || !round) return;
    if (canOpen(round.state)) step(round);
    else reveal(round);
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const held = Math.min(pick, doors - 1);
    const r: Round = {
      doors,
      plan,
      stake: bet.value,
      prizeDoor: rng.int(doors),
      state: newState(doors, held),
      cash: RTP,
      result: null,
      revealed: [],
      autoDoor: null,
    };
    setRound(r);
    step(r);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', cashValue(round.state), []);
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    setRound(null);
    setOpening(null);
    setPhase('idle');
  }

  /** Clicking a door: pick it before the bet, or switch to it at a checkpoint (value unchanged). */
  function onPick(door: number) {
    if (phase === 'idle') return setPick(door);
    if (phase === 'checkpoint' && round) setRound({ ...round, state: switchTo(round.state, door) });
  }

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    if (live) return;
    apply();
    if (phase === 'over') clear();
  };

  useHotkeys({ space: () => (phase === 'checkpoint' ? advance() : !live ? void start() : undefined), cashOut }, !infoOpen);

  // What the board shows: the live or finished round, else a preview of the settings.
  const n = round?.doors ?? doors;
  const s = round?.state ?? newState(doors, Math.min(pick, doors - 1));
  const post = posterior(s);
  const prizes = post.map((p, i) => (p > 0 ? prizeOf(s, i) : 0));
  const p = winChance(s);
  const value = cashValue(s);
  const prize = lockedPrize(s);
  const closed = closedCount(s);
  const final = !canOpen(s);
  const stake = round?.stake ?? bet.value;
  const headP = planChance(doors, plan);

  let status = `Ready · ${n} doors · holding door ${s.held + 1}`;
  if (phase === 'opening') status = `The host opens door ${(opening ?? 0) + 1}`;
  if (phase === 'checkpoint')
    status = final
      ? round?.autoDoor === s.held
        ? `Final two · plan switched you to door ${s.held + 1}`
        : `Final two · reveal, switch or cash out`
      : `Checkpoint · ${closed} of ${n} doors closed`;
  if (phase === 'revealing') status = 'Revealing the final two';
  if (phase === 'over' && round?.result) status = `${RESULT_TITLE[round.result]} · prize was behind door ${round.prizeDoor + 1}`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  return (
    <GameLayout
      name="Doors"
      accent={ACCENT}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={volatilityOf(doors, plan)} />}>Doors</Label>
          <Chips
            label="Doors"
            options={DOOR_COUNTS.map((v) => ({ value: v, label: v }))}
            value={doors}
            disabled={live}
            onChange={(v) => change(() => setDoors(v))}
          />

          <Label hint="value is the same either way">At the final two</Label>
          <Chips
            label="At the final two"
            options={PLANS.map((v) => ({ value: v, label: PLAN_LABEL[v] }))}
            value={plan}
            disabled={live}
            onChange={(v) => change(() => setPlan(v))}
          />
          <dl className="og-stats">
            <dt>Chance to win</dt>
            <dd>{fmtChance(headP)}</dd>
            <dt>Prize</dt>
            <dd>{fmtMult(planPrize(doors, plan))}</dd>
          </dl>

          {phase === 'checkpoint' ? (
            <>
              <ActionButton kind="cash" onClick={cashOut}>
                Cash out <span>{formatAmount(stake * value, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" onClick={advance}>
                {final ? `Reveal · ${fmtChance(p)} to win` : `Open a door · ${closed - 2} more to go`}
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
              {phase === 'opening' ? 'Opening…' : phase === 'revealing' ? 'Revealing…' : phase === 'over' ? 'Bet again' : 'Bet'}
            </ActionButton>
          )}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />

      <Readouts
        items={[
          {
            label: phase === 'idle' ? 'Chance to win' : 'Your door has it',
            value: fmtChance(phase === 'idle' ? headP : round?.result === 'won' ? 1 : round?.result === 'lost' ? 0 : p),
            sub: phase === 'idle' ? (plan === 'stay' ? 'hold to the end' : 'switch at the final two') : round?.result === 'won' || round?.result === 'lost' ? `door ${s.held + 1} · was ${fmtChance(p)}` : `door ${s.held + 1} · ${closed} closed`,
            tone: 'chance',
          },
          {
            label: 'Cash out now',
            value: live ? fmtMult(value) : phase === 'over' ? fmtMult(round?.cash ?? 0) : '—',
            sub: live ? formatAmount(stake * value, 2) : phase === 'over' ? formatAmount(stake * (round?.cash ?? 0), 2) : 'after each door',
            tone: 'cash',
          },
          {
            label: phase === 'idle' ? 'Prize' : 'Prize on your door',
            value: fmtMult(phase === 'idle' ? planPrize(doors, plan) : prize),
            sub: formatAmount(stake * (phase === 'idle' ? planPrize(doors, plan) : prize), 2),
            tone: 'prize',
          },
        ]}
      />

      <Board className="doors-board">
        <Field
          n={n}
          post={post}
          held={s.held}
          prizes={prizes}
          opening={opening}
          revealed={round?.revealed ?? []}
          prizeDoor={phase === 'over' ? round?.prizeDoor ?? null : phase === 'revealing' ? round?.prizeDoor ?? null : null}
          result={phase === 'over' ? round?.result ?? null : null}
          pickable={phase === 'idle' || phase === 'checkpoint'}
          onPick={onPick}
          swingMs={swingMs}
          flowMs={flowMs}
        />
        {phase === 'over' && round?.result && (
          <RoundOver
            key={history[0]?.id}
            title={RESULT_TITLE[round.result]}
            multiplier={round.cash}
            stake={round.stake}
            nextBet={bet.value}
            blocked={bet.blocked}
            onBetAgain={() => void start()}
            onClear={clear}
            placement="inline"
          />
        )}
      </Board>

      {live ? (
        <ChanceBar
          p={p}
          label={`Door ${s.held + 1} hides the prize`}
          note="Your bar's height is this chance. Click another closed door to switch: the cash-out stays the same and the prize relocks at cash-out ÷ that door's chance."
        />
      ) : (
        <Caption>
          One prize behind {n} doors. The host opens empty doors one by one; Bayes moves the chance into the doors you don't hold. Hold your first door: {fmtChance(1 / n)}
          {' '}to win {fmtMult(RTP * n)}. Switch at the end: {fmtChance((n - 1) / n)} to win {fmtMult((RTP * n) / (n - 1))}. RTP {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Doors" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              One prize hides behind one of the doors. Hold the door that has it when the last two doors open, or cash out along the way at the fair value of
              what you know.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Choose how many doors, and whether to stay or switch when two are left. Click a door to hold it, then bet.</li>
              <li>The host, who knows where the prize is, opens one empty door you are not holding. Then you can cash out (C) or let him open another (Space).</li>
              <li>At any checkpoint, click another closed door to switch to it. Your cash-out does not change; the prize on your door does.</li>
              <li>When two doors are left, your plan applies (Switch flips your hold to the other door; you can flip back). Reveal opens both.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The <b style={{ color: ACCENT }}>bar above each door</b> is the exact chance the prize is behind it; the dashed tick marks where every door
              started (1 in {n}). The strip under the doors splits 100% over the closed doors, your door first. Under each door is the prize you would hold
              there: chance × prize is the same for every closed door, and it is your cash-out.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Bayes' rule. With c doors closed, the host can open any of the c − 1 doors you don't hold if the prize is yours, but only c − 2 if it is
              elsewhere. So each opening multiplies the weight of your door by (c − 2)/(c − 1) relative to the others, and the opened door's chance flows
              into the doors you are not holding. Hold one door throughout and the factors telescope: it keeps its 1 in {n} while the other final door ends at
              {' '}({n} − 1)/{n}. That is Monty Hall, {n} doors deep.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              The prize starts at {fmtMult(RTP * n)} (RTP × doors) and the cash-out is prize × P(your door). P(your door) is a posterior probability, so
              the cash-out is a martingale starting at {(RTP * 100).toFixed(0)}%: every way of playing, cashing out or switching returns exactly{' '}
              {(RTP * 100).toFixed(0)}%. Switching relocks the prize at cash-out ÷ P(new door), so a switch changes how much and how likely, never the value.
              The prize can never exceed RTP × doors ({fmtMult(RTP * 12)} with 12 doors).
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
