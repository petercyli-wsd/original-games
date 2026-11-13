import { formatAmount } from '@originals/game-sdk';
import { useHost } from '@originals/game-sdk/react';
import {
  ACCENTS,
  ActionButton,
  BetField,
  Board,
  Caption,
  Chips,
  GameLayout,
  InfoModal,
  InfoSection,
  Label,
  PanelFoot,
  Readouts,
  RoundOver,
  Slider,
  StageTop,
  VolBadge,
  fmtChance,
  fmtMult,
  useBetInput,
  useHotkeys,
  useTicket,
  useTurbo,
  type ReadoutItem,
} from '@originals/game-sdk/ui';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import Field from './components/Field';
import { fmtMultShort } from './format';
import { initialState, position, reducer, type Action, type GameState, type Outcome } from './round';
import {
  BURSTS,
  RTP,
  TRACKS,
  cashMultiplier,
  expectedSteps,
  prizeMultiplier,
  rescaleStart,
  startPresets,
  step,
  volatilityOf,
  type AutoRules,
  type Burst,
  type Track,
} from './math';

const OUTCOME_TEXT: Record<Outcome, string> = {
  win: 'Green wall',
  lose: 'Red wall',
  'cash-out': 'Cashed out',
  'take-profit': 'Take profit',
  'stop-loss': 'Stop loss',
};

const STEP_MS = { normal: 90, turbo: 24 };

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const [state, dispatchState] = useReducer(reducer, undefined, initialState);
  // A synchronous mirror of the reducer state: every dispatch applies the same
  // pure reducer here at once. The open ticket reads only `resolved`, which is
  // refreshed in the same step, so leaving mid-round settles at the cash-out
  // the player could have taken, never at a stale render's value.
  const latest = useRef<GameState>(state);
  const resolved = useRef(0);
  const dispatch = useCallback((a: Action) => {
    latest.current = reducer(latest.current, a);
    const r = latest.current.round;
    if (r && latest.current.phase !== 'over') resolved.current = cashMultiplier(position(r), r.x0);
    dispatchState(a);
  }, []);
  const ticket = useTicket(() => resolved.current);
  const placing = useRef(false);

  const [W, setW] = useState<Track>(20);
  const [x0, setX0] = useState(5);
  const [burst, setBurst] = useState<Burst>(10);
  const [takeProfit, setTakeProfit] = useState<number | null>(null);
  const [stopLoss, setStopLoss] = useState<number | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const stepMs = turbo.turbo ? STEP_MS.turbo : STEP_MS.normal;

  const { phase, round } = state;
  const inRound = phase === 'running' || phase === 'paused';

  // Walk the dot while running. Each step's +-1 comes from the host RNG.
  useEffect(() => {
    if (phase !== 'running') return;
    const t = setTimeout(() => dispatch({ type: 'step', dx: step(0, rng) as 1 | -1 }), stepMs);
    return () => clearTimeout(t);
  }, [phase, round?.path.length, stepMs, rng]);

  // Settle exactly once when the round ends.
  useEffect(() => {
    if (phase !== 'over' || !round) return;
    ticket.settle(round.mult);
  }, [phase, round]);

  // Each pause is a checkpoint: the player can cash out at the current value.
  useEffect(() => {
    if (phase !== 'paused' || !round) return;
    const x = position(round);
    track({ type: 'checkpoint', multiplier: cashMultiplier(x, round.x0), winChance: x / round.W });
  }, [phase, round?.checkpoints.length]);

  const start = useCallback(async () => {
    if (placing.current || ticket.active() || bet.blocked) return;
    placing.current = true;
    try {
      if (!(await ticket.place(bet.value))) return;
      resolved.current = cashMultiplier(x0, x0);
      dispatch({ type: 'start', bet: bet.value, W, x0, burst, rules: { takeProfit, stopLoss } });
    } finally {
      placing.current = false;
    }
  }, [ticket, bet.blocked, bet.value, W, x0, burst, takeProfit, stopLoss]);

  const proceed = () => {
    if (phase === 'running') dispatch({ type: 'pause' });
    else if (phase === 'paused') dispatch({ type: 'continue', burst });
    else void start();
  };
  const cashOut = () => dispatch({ type: 'cashOut' });

  useHotkeys({ space: proceed, cashOut }, !infoOpen);

  // Changing a setting after a round clears the finished board back to a preview.
  const change = (apply: () => void) => {
    apply();
    dispatch({ type: 'clear' });
  };
  const changeStart = (next: number, nextW: number = W) => {
    setX0(next);
    // Auto levels are relative to the start, so drop any that no longer make sense.
    setTakeProfit((tp) => (tp !== null && tp > next && tp < nextW ? tp : null));
    setStopLoss((sl) => (sl !== null && sl < next && sl > 0 ? sl : null));
  };

  // What the board shows: the live or finished round, otherwise a preview of the settings.
  const shown = round ?? null;
  const vW = shown ? shown.W : W;
  const vx0 = shown ? shown.x0 : x0;
  const path = shown ? shown.path : [x0];
  const rules: AutoRules = shown ? shown.rules : { takeProfit, stopLoss };
  const x = path[path.length - 1];
  const stake = shown ? shown.bet : bet.value;
  const prize = prizeMultiplier(vW, vx0);
  const cash = cashMultiplier(x, vx0);
  const steps = path.length - 1;
  const last = state.history[0];
  const vol = volatilityOf(x0, W);
  const history = state.history.map((h) => ({ id: h.id, multiplier: h.mult }));

  let status = `Ready · about ${expectedSteps(x0, W)} steps to a wall`;
  let tone: 'idle' | 'live' | 'won' | 'lost' = 'idle';
  if (phase === 'running') {
    status = `Drifting · step ${steps}`;
    tone = 'live';
  }
  if (phase === 'paused') {
    status = `Checkpoint · step ${steps}`;
    tone = 'live';
  }
  if (phase === 'over' && shown?.outcome) {
    status = `${OUTCOME_TEXT[shown.outcome]} · ${steps} steps`;
    tone = shown.mult >= 1 ? 'won' : shown.mult > 0 ? 'idle' : 'lost';
  }

  const readouts: ReadoutItem[] = [
    { label: 'Win chance', value: fmtChance(x / vW), tone: 'chance' },
    { label: 'Prize at green', value: fmtMult(prize), tone: 'prize' },
  ];

  const tpText = takeProfit === null ? 'Off' : fmtMult(cashMultiplier(takeProfit, x0));
  const slText = stopLoss === null ? 'Off' : fmtMult(cashMultiplier(stopLoss, x0));

  return (
    <GameLayout
      name="Drift"
      accent={ACCENTS.sky}
      panel={
        <>
          <BetField bet={bet} disabled={inRound} />

          <Label hint={<VolBadge level={vol} />}>Start position</Label>
          <Slider
            label="Start position"
            min={1}
            max={W - 1}
            value={x0}
            disabled={inRound}
            onChange={(v) => change(() => changeStart(v))}
          />
          <Chips
            label="Start presets"
            options={startPresets(W).map((p) => ({ value: p, label: fmtMultShort(prizeMultiplier(W, p)) }))}
            value={x0}
            disabled={inRound}
            onChange={(p) => change(() => changeStart(p))}
          />

          <Label hint="longer is slower">Track length</Label>
          <Chips
            label="Track length"
            options={TRACKS.map((t) => ({ value: t, label: t }))}
            value={W}
            disabled={inRound}
            onChange={(t) =>
              change(() => {
                setW(t);
                changeStart(rescaleStart(x0, W, t), t);
              })
            }
          />

          <Label hint="then pause to decide">Steps per burst</Label>
          <Chips
            label="Steps per burst"
            options={BURSTS.map((b) => ({ value: b, label: b || '∞', title: b ? `${b} steps` : 'Run until paused' }))}
            value={burst}
            onChange={(b) => setBurst(b)}
          />

          <Label hint={tpText}>Auto cash-out above</Label>
          <Slider
            label="Take profit"
            min={x0 + 1}
            max={W}
            value={takeProfit ?? W}
            disabled={inRound}
            onChange={(v) => change(() => setTakeProfit(v >= W ? null : v))}
          />
          <Label hint={slText}>Auto cash-out below</Label>
          <Slider
            label="Stop loss"
            min={0}
            max={Math.max(0, x0 - 1)}
            value={stopLoss ?? 0}
            disabled={inRound || x0 <= 1}
            onChange={(v) => change(() => setStopLoss(v <= 0 ? null : v))}
          />

          {/* Cash out first, then the next-step button: the kit swaps them so Continue/Pause sits above Cash out. */}
          {inRound ? (
            <>
              <ActionButton kind="cash" onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" onClick={proceed}>
                {phase === 'paused' ? `Continue · ${burst ? `${burst} step${burst > 1 ? 's' : ''}` : 'run'}` : 'Pause'}
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={!!bet.blocked} onClick={() => void start()}>
              {phase === 'over' ? 'Bet again' : 'Bet'}
            </ActionButton>
          )}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />
      <Readouts items={readouts} />

      <Board className="drift-board">
        <Field
          W={vW}
          x0={vx0}
          path={path}
          checkpoints={shown?.checkpoints ?? []}
          rules={rules}
          phase={phase}
          outcome={shown?.outcome ?? null}
          stepMs={stepMs}
        />
      </Board>

      {phase === 'over' && shown?.outcome && last && (
        <RoundOver
          key={last.id}
          placement="inline"
          title={OUTCOME_TEXT[shown.outcome]}
          multiplier={shown.mult}
          stake={shown.bet}
          nextBet={bet.value}
          blocked={bet.blocked}
          onBetAgain={() => void start()}
          onClear={() => dispatch({ type: 'clear' })}
        />
      )}
      <Caption>Win by drifting to the green wall before the red one.</Caption>

      {infoOpen && (
        <InfoModal title="Drift" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              A dot drifts one step left or right at a time, 50/50, between a red wall and a green wall. Reach green and you win the prize. Touch red and you
              lose your bet.
            </p>
          </InfoSection>
          <InfoSection title="Position is probability">
            <p>
              The dot's position along the track is exactly its chance of reaching green first. Halfway along is 50%; one step off the red wall on a 100-step
              track is 1%. The labels above the track read it out.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Start position sets the risk. Start near red for a big prize, near green for a likely small one. The prize is {(RTP * 100).toFixed(0)}% × track length ÷ start.</li>
              <li>Cash out whenever the dot is paused or running. You get the prize × the current win chance, shown under the needle. It goes up and down as the dot drifts.</li>
              <li>Steps per burst sets how often the round pauses at a checkpoint for you to decide. ∞ runs until you press Pause.</li>
              <li>Track length sets the pace. Longer tracks give longer, smoother rounds.</li>
              <li>Auto cash-out banks the value for you when the dot reaches your take-profit or stop-loss line.</li>
              <li>Keys: Space bets, pauses or continues, C cashes out, Esc clears a finished board.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Fairness">
            <p>
              Every move is a fair coin flip, so no cash-out timing beats any other: holding to a wall, cashing early, take-profit and stop-loss all return{' '}
              {(RTP * 100).toFixed(0)}% on average.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
