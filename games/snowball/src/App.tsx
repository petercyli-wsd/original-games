import { formatAmount, formatMultiplier, formatPercent } from '@originals/game-sdk';
import { useHost } from '@originals/game-sdk/react';
import {
  ACCENTS,
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
  eventMs,
  fmtMult,
  useBetInput,
  useHotkeys,
  useTicket,
  useTurbo,
  type HistoryItem,
} from '@originals/game-sdk/ui';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import Tally from './components/Tally';
import Urn from './components/Urn';
import {
  currentCash,
  currentChance,
  drawnCounts,
  initialState,
  newRound,
  reducer,
  settledValue,
  type Outcome,
  type Round,
} from './game';
import { DRAWS, MAJORITY, PRESETS, PRESET_IDS, RTP, type PresetId } from './math';

const OUTCOME_TITLE: Record<Outcome, string> = {
  cashed: 'Cashed out',
  won: 'Blue wins',
  lost: 'Red wins',
};

function outcomeText(outcome: Outcome, r: Round, mult: number) {
  const { blue, red } = drawnCounts(r);
  switch (outcome) {
    case 'cashed':
      return `Cashed out at ${formatMultiplier(mult)}`;
    case 'won':
      return `Blue reached ${MAJORITY} first, ${blue} to ${red}`;
    case 'lost':
      return `Red reached ${MAJORITY} first, ${red} to ${blue}`;
  }
}

export default function App() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turboState = useTurbo();
  const turbo = turboState.turbo;

  const [preset, setPreset] = useState<PresetId>('wild');
  const [infoOpen, setInfoOpen] = useState(false);
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  // `resolved` is the open bet's value right now, set synchronously at every
  // transition (RTP once the stake is accepted, the drawn result the moment a
  // ball is chosen). The ticket reads only this ref, so leaving the game
  // settles at the true value even before the next render: never at the last
  // round's result just after Bet again, nor at the pre-draw cash-out just
  // after Draw ball.
  const resolved = useRef(0);
  const ticket = useTicket(() => resolved.current);

  const { phase, round, drawing, result } = state;
  const inRound = phase === 'live' || phase === 'drawing';

  // A draw plays in two beats: the ball out on its own, then with its twin,
  // then both go into the urn. The ball was chosen when Draw was pressed.
  useEffect(() => {
    if (phase !== 'drawing' || !drawing) return;
    const t = setTimeout(() => dispatch({ type: drawing.twin ? 'apply' : 'twin' }), eventMs(turbo));
    return () => clearTimeout(t);
  }, [phase, drawing?.twin, turbo]);

  // Settle when a round ends.
  useEffect(() => {
    if (phase !== 'over' || !result) return;
    resolved.current = result.mult;
    ticket.settle(result.mult);
  }, [phase, result]);

  // Every pause after a draw is a checkpoint.
  useEffect(() => {
    if (phase === 'live' && round && round.history.length > 0) {
      track({ type: 'checkpoint', multiplier: currentCash(round), winChance: currentChance(round) });
    }
  }, [phase, round?.history.length]);

  const start = useCallback(async () => {
    if (ticket.active() || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    // Before the first draw the round is worth exactly RTP (M × P0).
    resolved.current = RTP;
    dispatch({ type: 'start', bet: bet.value, preset });
  }, [ticket, bet.value, bet.blocked, preset]);

  const draw = useCallback(() => {
    if (phase !== 'live' || !round) return;
    const action = { type: 'draw', index: rng.int(round.balls.length) } as const;
    // The ball is decided now: leaving mid-draw settles at its result.
    resolved.current = settledValue(reducer(state, action));
    dispatch(action);
  }, [phase, round, rng, state]);

  const view = round ?? newRound(preset, bet.value);
  const p = currentChance(view);
  const cash = currentCash(view);
  const stake = round?.bet ?? bet.value;
  const drawn = drawnCounts(view);
  const canCash = phase === 'live' && view.history.length > 0;
  const initial = view.balls.length - view.history.length;

  useHotkeys(
    {
      space: () => {
        if (infoOpen) return;
        if (phase === 'live') draw();
        else if (phase === 'idle' || phase === 'over') void start();
      },
      cashOut: () => {
        if (!infoOpen && canCash) dispatch({ type: 'cashOut' });
      },
    },
    !infoOpen,
  );

  // Changing settings after a round clears the finished board.
  const changePreset = (id: PresetId) => {
    setPreset(id);
    dispatch({ type: 'clear' });
  };

  let status = 'You are blue · pick an urn';
  let tone: 'idle' | 'live' | 'won' | 'lost' = 'idle';
  if (phase === 'live') {
    status = view.history.length === 0 ? 'Press Draw ball' : 'Cash out or draw again';
    tone = 'live';
  } else if (phase === 'drawing') {
    status = 'Drawing…';
    tone = 'live';
  } else if (phase === 'over' && result && round) {
    status = outcomeText(result.outcome, round, result.mult);
    // A cash-out below 1× is a partial refund: neither a win nor a loss.
    tone = result.mult >= 1 ? 'won' : result.mult > 0 ? 'idle' : 'lost';
  }

  const history: HistoryItem[] = state.recent.map((r) => ({ id: r.id, multiplier: r.mult }));
  const sel = PRESETS[preset];

  return (
    <GameLayout
      name="Snowball"
      accent={ACCENTS.sky}
      panel={
        <>
          <BetField bet={bet} disabled={inRound} />
          <Label hint={<VolBadge level={sel.volatility} />}>Starting urn</Label>
          <Chips
            label="Starting urn"
            wrap
            options={PRESET_IDS.map((id) => ({ value: id, label: PRESETS[id].name, title: PRESETS[id].blurb }))}
            value={preset}
            disabled={inRound}
            onChange={changePreset}
          />
          <dl className="og-stats">
            <dt>Start</dt>
            <dd>
              {sel.blue} blue : {sel.red} red
            </dd>
          </dl>

          {inRound ? (
            <>
              <ActionButton kind="secondary" disabled={phase !== 'live'} onClick={draw}>
                Draw ball
              </ActionButton>
              <ActionButton kind="cash" disabled={!canCash} onClick={() => dispatch({ type: 'cashOut' })}>
                Cash out <span>{formatAmount(canCash ? stake * cash : 0, 2)}</span>
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={!!bet.blocked} onClick={() => void start()}>
              {phase === 'over' ? 'Bet again' : 'Bet'}
            </ActionButton>
          )}
          {bet.blocked && !inRound && <p className="sb-blocked">{bet.blocked}</p>}

          <PanelFoot turbo={turboState} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />
      <ChanceBar p={p} label="Blue wins" />
      <Readouts items={[{ label: 'Prize', value: fmtMult(view.prize), tone: 'prize' }]} />

      <Tally blue={drawn.blue} red={drawn.red} live={phase === 'live'} />

      <Board className="sb-board">
        <div className="urn-wrap">
          <Urn
            balls={view.balls}
            initial={initial}
            capacity={initial + DRAWS}
            drawing={drawing}
            lastDrawn={round ? state.lastDrawn : null}
          />
        </div>
      </Board>

      {phase === 'over' && result && round && (
        <RoundOver
          key={state.recent[0]?.id}
          placement="inline"
          title={OUTCOME_TITLE[result.outcome]}
          multiplier={result.mult}
          stake={round.bet}
          nextBet={bet.value}
          blocked={bet.blocked}
          onBetAgain={() => void start()}
          onClear={() => dispatch({ type: 'clear' })}
        />
      )}

      <Caption>Blue wins by drawing {MAJORITY} blue balls before red draws {MAJORITY}.</Caption>

      {infoOpen && (
        <InfoModal title="Snowball" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              You are blue. Out of {DRAWS} draws from the urn, blue wins if at least {MAJORITY} are blue: the first colour to {MAJORITY} draws wins.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick a starting urn and press Bet. Nothing is drawn yet.</li>
              <li>
                Press Draw ball. A ball comes out at random, then goes back in with a twin of the same colour. The urn grows by one ball per draw, so
                whichever colour is drawn more gets likelier still: it snowballs.
              </li>
              <li>After any draw you can cash out, or keep drawing. The round ends as soon as one colour has {MAJORITY} draws.</li>
              <li>Keys: Space bets or draws, C cashes out, Esc clears a finished board.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The draw tally is the whole bet: blue fills from the left, red from the right, and whoever reaches the centre slot first wins. The gaps
              to the centre are the draws each side still needs. "Blue wins" is the exact chance blue gets there first. The next ball is blue with the
              chance of the share of blue balls in the urn. The ringed pair is the ball just drawn and its twin.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              This is Pólya's urn. From an urn with b blue and r red, the number of blue balls among the next n draws follows the beta-binomial law:
              P(k blue) = C(n, k) · B(b + k, r + n − k) / B(b, r). Blue's win chance is the sum of that over every k at least the number blue still
              needs.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              A win pays prize = {formatPercent(RTP, 0)} ÷ starting win chance. Cash out pays prize × the current win chance. That value moves with
              every draw but its expected next value is always where it is now (a martingale), so every way of playing returns {formatPercent(RTP, 0)}{' '}
              on average.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
