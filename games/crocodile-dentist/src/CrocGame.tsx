import { type BetTicket, formatAmount } from '@originals/game-sdk';
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
  eventMs,
  fmtMult,
  useBetInput,
  useHotkeys,
  useTurbo,
  type HistoryItem,
  type ReadoutItem,
} from '@originals/game-sdk/ui';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import Croc from './components/Croc';
import { loadConfig, saveConfig, type CrocConfig } from './config';
import { fairValue, initialState, reducer } from './game';
import { BITE, buildLadder, cardValue, pickTraps, winChance } from './math';

const RULE = "Don't press the bad tooth; if the House does, you win.";

const pick = (options: number[], want: number) => (options.includes(want) ? want : options[0]);

export default function CrocGame() {
  const { wallet, rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  // Fixed maths (loadConfig applies withFixedMaths).
  const [config] = useState<CrocConfig>(loadConfig);
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  // The open bet. `placing` blocks double-starts while the wallet responds.
  const ticket = useRef<BetTicket | null>(null);
  const placing = useRef(false);
  // The tooth the House has picked this turn (its outcome is fixed from then on).
  const housePick = useRef<number | null>(null);
  const N = config.teeth;
  const [k, setK] = useState(() => pick(config.badTeethOptions, config.defaultBadTeeth));
  const [infoOpen, setInfoOpen] = useState(false);

  const { phase, round } = state;
  const inPlay = phase === 'you' || phase === 'house';

  useEffect(() => saveConfig(config), [config]);

  // Settle the bet when a round ends. history[0] is the round just finished.
  useEffect(() => {
    if (phase !== 'over' || !ticket.current) return;
    void ticket.current.settle(state.history[0].mult);
    ticket.current = null;
  }, [phase, state.history]);

  // Leaving mid-round settles at the bet's fair value right now.
  const latest = useRef(state);
  latest.current = state;
  useEffect(
    () => () => {
      if (ticket.current) void ticket.current.settle(fairValue(latest.current, housePick.current));
    },
    [],
  );

  const validK = k < N ? k : Math.max(1, ...config.badTeethOptions.filter((x) => x < N));
  const preview = useMemo(() => buildLadder(N, validK, BITE, config.rtp), [N, validK, config.rtp]);
  const ladder = inPlay && round ? round.ladder : preview;

  // Each survived round is a checkpoint.
  useEffect(() => {
    if (phase === 'you' && round && round.r > 0) {
      const left = round.pressed.filter((p) => !p).length;
      track({ type: 'checkpoint', multiplier: round.cashMult, winChance: winChance(left, round.k, 'you') });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, round?.r]);

  // The House's turn: pick a tooth (fixing the outcome), look at it, press it.
  useEffect(() => {
    if (phase !== 'house' || !round) return;
    const free = round.pressed.flatMap((p, i) => (p ? [] : [i]));
    const target = free[rng.int(free.length)];
    housePick.current = target;
    const delay = eventMs(turbo.turbo);
    const t1 = setTimeout(() => dispatch({ type: 'houseTarget', i: target }), delay * 0.3);
    const t2 = setTimeout(() => {
      housePick.current = null;
      dispatch({ type: 'pressHouse', i: target });
    }, delay);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
    // Re-run only when a new House turn starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, round?.r]);

  // Changing the board after a game clears the old result.
  const changeSetting = (x: number) => {
    setK(x);
    dispatch({ type: 'clear' });
  };

  const startBet = useCallback(async () => {
    if (placing.current || ticket.current || bet.blocked) return;
    placing.current = true;
    try {
      ticket.current = await wallet.placeBet(bet.value);
      dispatch({ type: 'start', bet: bet.value, N, k: validK, rtp: config.rtp, traps: pickTraps(N, validK, rng) });
    } catch {
      /* rejected (e.g. insufficient funds): the button is already disabled for that */
    } finally {
      placing.current = false;
    }
  }, [wallet, rng, bet.value, bet.blocked, N, validK, config.rtp]);

  const pressRandom = useCallback(() => {
    if (phase !== 'you' || !round) return;
    const free = round.pressed.flatMap((p, i) => (p ? [] : [i]));
    dispatch({ type: 'pressYou', i: free[rng.int(free.length)] });
  }, [phase, round, rng]);

  const cashOut = () => dispatch({ type: 'cashOut' });

  useHotkeys(
    {
      space: () => {
        if (phase === 'idle' || phase === 'over') void startBet();
        else pressRandom();
      },
      cashOut,
    },
    !infoOpen,
  );

  // Show the live/finished round, unless the player has since picked a different board.
  const shown = round && (inPlay || (phase === 'over' && round.N === N && round.k === validK)) ? round : null;
  const shownN = shown ? shown.N : N;
  const shownK = shown ? shown.k : validK;
  const remaining = shown ? shown.pressed.filter((p) => !p).length : shownN;
  // Bad teeth still unpressed (all k while the game runs; one fewer after a bite): the next press's risk, as a count.
  const badLeft = shown ? shown.traps.filter((t) => !shown.pressed[t]).length : shownK;
  const rung = inPlay && round ? round.ladder[round.r] : preview[0];
  const canCash = phase === 'you' && !!round && round.r > 0;
  const last = state.history[0];

  // Live chance of winning this game if you play to the end.
  const liveChance =
    phase === 'over' && shown && last ? (last.win ? 1 : 0) : winChance(remaining, shownK, phase === 'house' ? 'house' : 'you');

  const history: HistoryItem[] = state.history.map((h, i) => ({ id: state.history.length - i, multiplier: h.mult }));
  const tone = state.message.tone === 'win' ? 'won' : state.message.tone === 'lose' ? 'lost' : phase === 'idle' ? 'idle' : 'live';

  const readouts: ReadoutItem[] = phase !== 'over' && rung ? [{ label: 'House bitten pays', value: fmtMult(rung.bite), tone: 'prize' }] : [];

  return (
    <GameLayout
      name="Croc Dentist"
      accent={ACCENTS.sky}
      panel={
        <>
          <BetField bet={bet} disabled={inPlay} />
          <Label hint={`of ${N}`}>Bad teeth</Label>
          <Chips
            label="Bad teeth"
            options={config.badTeethOptions.map((x) => ({ value: x, label: x, disabled: x >= N }))}
            value={validK}
            disabled={inPlay}
            onChange={changeSetting}
          />

          {/* From round 2 the main button turns into Cash out; the random press then sits above it, where the first
              press was, so pressing the same spot keeps the game going. */}
          {canCash && round ? (
            <>
              <ActionButton kind="secondary" disabled={phase !== 'you'} onClick={pressRandom}>
                Press random tooth
              </ActionButton>
              <ActionButton kind="cash" onClick={cashOut}>
                Cash out <span>{formatAmount(round.bet * round.cashMult, 2)}</span>
              </ActionButton>
            </>
          ) : inPlay ? (
            <ActionButton disabled={phase !== 'you'} onClick={pressRandom}>
              Press random tooth
            </ActionButton>
          ) : (
            <ActionButton disabled={!!bet.blocked} onClick={() => void startBet()}>
              {phase === 'over' ? 'Bet again' : 'Bet'}
            </ActionButton>
          )}
          {bet.blocked && !inPlay && <p className="croc-blocked">{bet.blocked}</p>}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={state.message.text} tone={tone} history={history} />
      <Readouts items={readouts} />
      <ChanceBar p={liveChance} />

      {/* What the next press risks: one dot per unpressed tooth, the bad ones red (STYLE.md §6 unit key). */}
      <div className="teeth-left" aria-label={`${badLeft} bad of ${remaining} unpressed teeth`}>
        <span>{`${badLeft} bad ${badLeft === 1 ? 'tooth' : 'teeth'} among ${remaining} unpressed`}</span>
        <div className="teeth-dots">
          {Array.from({ length: remaining }, (_, i) => (
            <i key={i} className={i < badLeft ? 'bad' : ''} />
          ))}
        </div>
      </div>

      <Board className="croc-board">
        <Croc
          N={shownN}
          pressed={shown ? shown.pressed : Array(shownN).fill(null)}
          revealed={phase === 'over' && shown ? shown.traps : []}
          playable={phase === 'you'}
          onPress={(i) => dispatch({ type: 'pressYou', i })}
          houseTarget={phase === 'house' ? state.houseTarget : null}
        />
      </Board>

      {phase === 'over' && round && shown && last && (
        <RoundOver
          key={state.history.length}
          placement="inline"
          title={last.win ? 'You win' : 'Bitten'}
          multiplier={last.mult}
          stake={round.bet}
          nextBet={bet.value}
          blocked={bet.blocked}
          onBetAgain={() => void startBet()}
          onClear={() => dispatch({ type: 'clear' })}
        />
      )}
      <Caption>{RULE}</Caption>

      {infoOpen && (
        <InfoModal title="Croc Dentist" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              Take turns pressing teeth with the House. The jaw has {N} teeth and some are bad. Press a bad tooth and you lose; if the House presses one, you win.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick how many bad teeth and press Bet. More bad teeth: lower chance, bigger payouts.</li>
              <li>You press a tooth, or use Press random tooth. A bad tooth loses your bet.</li>
              <li>Then the House presses one. If it is bad, you win the House bitten payout.</li>
              <li>Both safe? Your cash-out moves to the next value. Cash out to bank it, or press on.</li>
              <li>Keys: Space bets or presses a random tooth, C cashes out, Esc clears a finished round.</li>
            </ol>
            <p>
              A filled dot marks a tooth you pressed, a ring one the House pressed, and red the bad teeth, shown when the round ends. If all the good teeth
              are used up, you are cashed out automatically.
            </p>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              Win chance is your chance of winning this game if you play to the end. It moves after every press. Cash-out after each round both survive:{' '}
              {ladder.map((r) => fmtMult(cardValue(r))).join(', ')}.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Drawing without replacement. With n teeth left and k bad, your press bites with chance k/n; if it doesn't, the House's bites with chance k/(n-1).
              A House bite pays {BITE}× the round's value. Each value is set so that cash = P(House bitten)·{BITE}·value + P(both safe)·value, which makes the
              cash-out a fair martingale.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Cashing out at any checkpoint or playing to the end returns {(config.rtp * 100).toFixed(1)}% on average. The House presses at random and never
              knows where the bad teeth are. Turbo only makes the House quicker.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
