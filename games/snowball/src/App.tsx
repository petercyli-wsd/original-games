import { formatAmount, formatMultiplier } from '@originals/game-sdk';
import { RoundOver, useBalance, useHost, useSettings } from '@originals/game-sdk/react';
import { eventMs, useTicket } from '@originals/game-sdk/ui';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import InfoModal from './components/InfoModal';
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
import { DRAWS, MAJORITY, PRESETS, PRESET_IDS, RTP, prize, type PresetId } from './math';

// Readable win chance: never shows 0% or 100% while the round is still open.
function chance(p: number) {
  if (p === 0 || p === 1) return `${p * 100}%`;
  if (p < 0.001) return '<0.1%';
  if (p > 0.999) return '>99.9%';
  return `${(p * 100).toFixed(1)}%`;
}

const OUTCOME_TITLE: Record<Outcome, string> = {
  cashed: 'Cashed out',
  won: 'Blue wins',
  lost: 'Red wins',
};

function outcomeText(outcome: Outcome, r: Round, mult: number) {
  const { blue, red } = drawnCounts(r);
  switch (outcome) {
    case 'cashed':
      return `Cashed out at ${formatMultiplier(mult)}.`;
    case 'won':
      return `Blue reached ${MAJORITY} first, ${blue} to ${red}.`;
    case 'lost':
      return `Red reached ${MAJORITY} first, ${red} to ${blue}.`;
  }
}

export default function App() {
  const { rng, track } = useHost();
  const balance = useBalance();
  const host = useSettings();
  const [localTurbo, setLocalTurbo] = useState(false);
  const turbo = host.turbo || localTurbo;

  const [preset, setPreset] = useState<PresetId>('wild');
  const [betText, setBetText] = useState('1.00');
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
  const [error, setError] = useState('');

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

  const bet = parseFloat(betText) || 0;
  const betInvalid = !(bet > 0) || bet > balance;

  const start = useCallback(async () => {
    if (ticket.active()) return;
    if (!(await ticket.place(bet))) {
      setError(bet > balance ? 'Not enough balance.' : 'Enter a valid bet.');
      return;
    }
    // Before the first draw the round is worth exactly RTP (M × P0).
    resolved.current = RTP;
    setError('');
    dispatch({ type: 'start', bet, preset });
  }, [ticket, bet, balance, preset]);

  const draw = useCallback(() => {
    if (phase !== 'live' || !round) return;
    const action = { type: 'draw', index: rng.int(round.balls.length) } as const;
    // The ball is decided now: leaving mid-draw settles at its result.
    resolved.current = settledValue(reducer(state, action));
    dispatch(action);
  }, [phase, round, rng, state]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.composedPath()[0] as HTMLElement;
      if (infoOpen || target.tagName === 'INPUT' || target.tagName === 'BUTTON') return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (phase === 'live') draw();
        else if ((phase === 'idle' || phase === 'over') && !betInvalid) void start();
      } else if (e.key.toLowerCase() === 'c') {
        dispatch({ type: 'cashOut' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, start, draw, infoOpen, betInvalid]);

  // Changing settings after a round clears the finished board.
  const change = (apply: () => void) => {
    apply();
    dispatch({ type: 'clear' });
  };

  const view = round ?? newRound(preset, bet);
  const p = currentChance(view);
  const cash = currentCash(view);
  const stake = round?.bet ?? bet;
  const drawn = drawnCounts(view);
  const canCash = phase === 'live' && view.history.length > 0;
  const initial = view.balls.length - view.history.length;

  let message: { text: string; tone: 'neutral' | 'win' | 'lose' } = { text: 'You are blue. Pick an urn, then Bet.', tone: 'neutral' };
  if (phase === 'live') {
    message = { text: view.history.length === 0 ? 'Bet placed. Press Draw ball.' : 'Cash out, or draw the next ball.', tone: 'neutral' };
  }
  if (phase === 'drawing') message = { text: 'Drawing…', tone: 'neutral' };
  // A cash-out below 1× is a partial refund: neither a win nor a loss.
  const tone = !result ? 'neutral' : result.mult >= 1 ? 'win' : result.mult > 0 ? 'neutral' : 'lose';
  if (phase === 'over' && result && round) message = { text: outcomeText(result.outcome, round, result.mult), tone };
  if (error && !inRound) message = { text: error, tone: 'lose' };

  return (
    <div className="sb">
      <aside className="panel">
        <div className="field">
          <span className="label">Bet amount</span>
          <div className="bet-row">
            <input
              value={betText}
              inputMode="decimal"
              aria-label="Bet amount"
              disabled={inRound}
              onChange={(e) => setBetText(e.target.value)}
              onBlur={() => setBetText((v) => formatAmount(parseFloat(v) || 0, 2))}
            />
            <button disabled={inRound} onClick={() => setBetText(formatAmount(bet / 2, 2))}>
              ½
            </button>
            <button disabled={inRound} onClick={() => setBetText(formatAmount(Math.min(balance, bet * 2), 2))}>
              2×
            </button>
          </div>
        </div>

        <div className="field">
          <span className="label">
            Starting urn <span className="hint">blue : red · prize</span>
          </span>
          <div className="presets" role="radiogroup" aria-label="Starting urn">
            {PRESET_IDS.map((id) => {
              const s = PRESETS[id];
              return (
                <button
                  key={id}
                  role="radio"
                  aria-checked={id === preset}
                  className={'preset' + (id === preset ? ' on' : '')}
                  disabled={inRound}
                  title={s.blurb}
                  onClick={() => change(() => setPreset(id))}
                >
                  <span className="preset-name">{s.name}</span>
                  <span className="ratio">
                    <b className="t-blue">{s.blue}</b>:<b className="t-red">{s.red}</b>
                  </span>
                  <span className="preset-prize">{formatMultiplier(prize(id))}</span>
                </button>
              );
            })}
          </div>
          <span className="blurb">{PRESETS[preset].blurb}</span>
        </div>

        {inRound ? (
          <div className="actions">
            <button key="draw" className="primary secondary" disabled={phase !== 'live'} onClick={draw}>
              {phase === 'drawing' ? 'Drawing…' : 'Draw ball'}
            </button>
            <button key="cash" className="primary cash" disabled={!canCash} onClick={() => dispatch({ type: 'cashOut' })}>
              {canCash ? (
                <>Cash out {formatAmount(stake * cash, 2)}</>
              ) : (
                'Cash out after a draw'
              )}
            </button>
          </div>
        ) : (
          <button key="bet" className="primary" disabled={betInvalid} onClick={() => void start()}>
            {phase === 'over' ? 'Bet again' : 'Bet'}
          </button>
        )}

        <div className="panel-foot">
          <label className="toggle">
            <input type="checkbox" checked={turbo} disabled={host.turbo} onChange={(e) => setLocalTurbo(e.target.checked)} />
            Turbo
          </label>
          <button className="ghost" onClick={() => setInfoOpen(true)}>
            How to play
          </button>
        </div>
      </aside>

      <section className="stage">
        <div className="stage-top">
          <p className={'message ' + message.tone} aria-live="polite">
            {message.text}
          </p>
          <div className="recent" aria-label="Recent results">
            {state.recent.map((r) => (
              <span key={r.id} className={r.mult >= 1 ? 'w' : r.mult > 0 ? 'p' : 'l'}>
                {formatMultiplier(r.mult)}
              </span>
            ))}
          </div>
        </div>

        <div className="readout">
          <div>
            <span className="tile-label">Blue wins</span>
            <b className="mid" aria-live="polite">
              {chance(p)}
            </b>
          </div>
          <div>
            <span className="tile-label">Prize</span>
            <b className="mid">{formatMultiplier(view.prize)}</b>
          </div>
        </div>

        <Tally blue={drawn.blue} red={drawn.red} live={phase === 'live'} />

        <div className="board">
          <div className="urn-wrap">
            <Urn
              balls={view.balls}
              initial={initial}
              capacity={initial + DRAWS}
              drawing={drawing}
              lastDrawn={round ? state.lastDrawn : null}
            />
            {phase === 'over' && result && round && (
              <RoundOver
                key={state.recent[0]?.id}
                placement="top"
                title={OUTCOME_TITLE[result.outcome]}
                multiplier={result.mult}
                stake={round.bet}
                nextBet={bet}
                blocked={bet > balance ? 'Not enough balance' : !(bet > 0) ? 'Enter a valid bet' : undefined}
                onBetAgain={() => void start()}
                onClear={() => dispatch({ type: 'clear' })}
              />
            )}
          </div>

        </div>

        <p className="og-caption">Blue wins by drawing {MAJORITY} blue balls before red draws {MAJORITY}.</p>
      </section>

      {infoOpen && <InfoModal rtp={RTP} onClose={() => setInfoOpen(false)} />}
    </div>
  );
}
