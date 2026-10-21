import { formatAmount, formatMultiplier, type BetTicket } from '@originals/game-sdk';
import { RoundOver, useBalance, useHost, useSettings } from '@originals/game-sdk/react';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import InfoModal from './components/InfoModal';
import Sparkline from './components/Sparkline';
import Urn from './components/Urn';
import { currentCash, drawsLeft, initialState, reducer, startingBalls, type Outcome, type Round } from './game';
import { PACES, PRESETS, PRESET_IDS, RTP, blueNeeded, prize, winProbability, type Pace, type PresetId } from './math';

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
  clinched: 'Blue clinched it',
  lost: 'Red wins',
  sealed: 'Red sealed it',
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function outcomeText(outcome: Outcome, r: Round, mult: number) {
  const score = `${r.blue} to ${r.red}`;
  const spare = plural(drawsLeft(r), 'draw');
  switch (outcome) {
    case 'cashed':
      return `Cashed out at ${formatMultiplier(mult)}.`;
    case 'won':
      return `Blue holds the majority, ${score}. Paid ${formatMultiplier(mult)}.`;
    case 'clinched':
      return `Blue's majority is locked in with ${spare} to spare. Paid ${formatMultiplier(mult)}.`;
    case 'lost':
      return `Red holds the majority, ${score}.`;
    case 'sealed':
      return `Red can't be caught with ${spare} left. Round over.`;
  }
}

/** A preview round for the selected settings, shown before the first bet. */
function previewRound(preset: PresetId, draws: number): Round {
  const { blue, red } = PRESETS[preset];
  return {
    preset,
    draws,
    bet: 0,
    prize: prize(preset, draws),
    balls: startingBalls(preset),
    blue,
    red,
    history: [],
    probs: [winProbability(blue, red, draws)],
  };
}

export default function App() {
  const { wallet, rng, track } = useHost();
  const balance = useBalance();
  const host = useSettings();
  const [localTurbo, setLocalTurbo] = useState(false);
  const turbo = host.turbo || localTurbo;

  const [preset, setPreset] = useState<PresetId>('wild');
  const [pace, setPace] = useState<Pace>(21);
  const [betText, setBetText] = useState('1.00');
  const [infoOpen, setInfoOpen] = useState(false);
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const ticket = useRef<BetTicket | null>(null);
  const placing = useRef(false);
  const [error, setError] = useState('');

  const { phase, round, picked, burst, result } = state;
  const inRound = phase === 'drawing' || phase === 'checkpoint';

  // Animate a draw in two beats: lift a random ball out, then drop its twin in.
  useEffect(() => {
    if (phase !== 'drawing' || !round) return;
    const fast = turbo || burst > 1;
    const delay = picked === null ? (turbo ? 40 : fast ? 70 : 160) : turbo ? 120 : fast ? 240 : 560;
    const t = setTimeout(
      () => dispatch(picked === null ? { type: 'pick', index: rng.int(round.balls.length) } : { type: 'apply' }),
      delay,
    );
    return () => clearTimeout(t);
    // Re-run per beat: a new pick, or a new draw applied.
  }, [phase, picked, round?.history.length]);

  // Settle when a round ends.
  useEffect(() => {
    if (phase !== 'over' || !result || !ticket.current) return;
    void ticket.current.settle(result.mult);
    ticket.current = null;
  }, [phase, result]);

  // Every pause between draws is a checkpoint.
  useEffect(() => {
    if (phase === 'checkpoint' && round) {
      track({ type: 'checkpoint', multiplier: currentCash(round), winChance: round.probs[round.probs.length - 1] });
    }
  }, [phase, round?.history.length]);

  // Leaving mid-round cashes out at the current fair value, prize × P_t.
  const latest = useRef(state);
  latest.current = state;
  useEffect(
    () => () => {
      const r = latest.current.round;
      if (ticket.current && r) void ticket.current.settle(currentCash(r));
    },
    [],
  );

  const bet = parseFloat(betText) || 0;
  const betInvalid = !(bet > 0) || bet > balance;

  const start = useCallback(async () => {
    if (placing.current || ticket.current) return;
    placing.current = true;
    try {
      ticket.current = await wallet.placeBet(bet);
      setError('');
      dispatch({ type: 'start', bet, preset, draws: pace });
    } catch {
      setError(bet > balance ? 'Not enough balance.' : 'Enter a valid bet.');
    } finally {
      placing.current = false;
    }
  }, [wallet, bet, balance, preset, pace]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.composedPath()[0] as HTMLElement;
      if (infoOpen || target.tagName === 'INPUT' || target.tagName === 'BUTTON') return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (phase === 'checkpoint') dispatch({ type: 'draw', count: 1 });
        else if ((phase === 'idle' || phase === 'over') && !betInvalid) void start();
      } else if (e.key.toLowerCase() === 'c') {
        dispatch({ type: 'cashOut' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, start, infoOpen, betInvalid]);

  // Changing settings after a round clears the finished board.
  const change = (apply: () => void) => {
    apply();
    dispatch({ type: 'clear' });
  };

  const view = round ?? previewRound(preset, pace);
  const p = view.probs[view.probs.length - 1];
  const left = drawsLeft(view);
  const total = view.blue + view.red;
  const share = view.blue / total;
  const cash = currentCash(view);
  const stake = round?.bet ?? bet;
  const finalSize = view.balls.length - view.history.length + view.draws;
  const need = blueNeeded(view.blue, view.red, left);

  let message: { text: string; tone: 'neutral' | 'win' | 'lose' } = {
    text: `You are blue. Hold a strict majority of the ${finalSize} balls after ${view.draws} draws.`,
    tone: 'neutral',
  };
  if (phase === 'drawing') message = { text: burst > 1 ? `Drawing ${plural(state.pending, 'ball')}…` : 'Drawing…', tone: 'neutral' };
  if (phase === 'checkpoint') message = { text: `Blue needs ${need} of the last ${plural(left, 'draw')}. Cash out or draw on.`, tone: 'neutral' };
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
            Urn <span className="hint">blue : red at the start</span>
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
                  <span className="preset-prize">{formatMultiplier(prize(id, pace))}</span>
                </button>
              );
            })}
          </div>
          <span className="blurb">{PRESETS[preset].blurb}</span>
        </div>

        <div className="field">
          <span className="label">
            Draws <span className="hint">more = longer round</span>
          </span>
          <div className="segmented">
            {PACES.map((n) => (
              <button key={n} className={n === pace ? 'on' : ''} disabled={inRound} onClick={() => change(() => setPace(n))}>
                {n}
              </button>
            ))}
          </div>
        </div>

        {phase === 'checkpoint' && round ? (
          <button key="cash" className="primary cash" onClick={() => dispatch({ type: 'cashOut' })}>
            Cash out {formatAmount(round.bet * cash, 2)}
            <small>{formatMultiplier(cash)}</small>
          </button>
        ) : (
          <button key="bet" className="primary" disabled={phase === 'drawing' || betInvalid} onClick={() => void start()}>
            {phase === 'drawing' ? 'Drawing…' : phase === 'over' ? 'Bet again' : 'Bet'}
          </button>
        )}
        <div className="draws">
          {[1, 5].map((n) => (
            <button key={n} className="secondary" disabled={phase !== 'checkpoint'} onClick={() => dispatch({ type: 'draw', count: n })}>
              Draw {phase === 'checkpoint' ? Math.min(n, left) : n}
            </button>
          ))}
          <button className="secondary" disabled={phase !== 'checkpoint'} onClick={() => dispatch({ type: 'draw', count: left })}>
            Draw all
          </button>
        </div>

        <dl className="stats">
          <div>
            <dt>Prize if blue wins</dt>
            <dd>{formatMultiplier(view.prize)}</dd>
          </div>
          <div>
            <dt>Starting win chance</dt>
            <dd>{chance(view.probs[0])}</dd>
          </div>
          <div>
            <dt>Balance</dt>
            <dd>{formatAmount(balance, 2)}</dd>
          </div>
        </dl>

        <div className="panel-foot">
          <label className="toggle">
            <input type="checkbox" checked={turbo} disabled={host.turbo} onChange={(e) => setLocalTurbo(e.target.checked)} />
            Turbo
          </label>
          <button className="ghost" onClick={() => setInfoOpen(true)}>
            <span className="i">i</span> How to play
          </button>
        </div>
      </aside>

      <section className="stage">
        <div className="readout">
          <div className="tile win-tile">
            <span className="tile-label">Win chance</span>
            <b className="big" aria-live="polite">
              {chance(p)}
            </b>
            <span className="meter" aria-hidden="true">
              <i style={{ width: `${p * 100}%` }} />
            </span>
          </div>
          <div className="tile">
            <span className="tile-label">Cash out now</span>
            <b className="mid">{phase === 'checkpoint' ? formatMultiplier(cash) : '–'}</b>
            <span className="sub">{phase === 'checkpoint' ? formatAmount(stake * cash, 2) : 'after each draw'}</span>
          </div>
          <div className="tile">
            <span className="tile-label">Prize</span>
            <b className="mid">{formatMultiplier(view.prize)}</b>
            <span className="sub">{formatAmount(stake * view.prize, 2)}</span>
          </div>
        </div>

        <div className="share">
          <div className="share-head">
            <span className="t-blue">
              <b>{view.blue}</b> blue · {(share * 100).toFixed(0)}%
            </span>
            <span className="share-goal">majority</span>
            <span className="t-red">
              {((1 - share) * 100).toFixed(0)}% · <b>{view.red}</b> red
            </span>
          </div>
          <div className="share-bar" role="img" aria-label={`Blue holds ${(share * 100).toFixed(0)}% of the urn`}>
            <i className="share-blue" style={{ width: `${share * 100}%` }} />
            <span className="share-line" />
          </div>
        </div>

        <div className="board">
          <div className="urn-wrap">
            <Urn balls={view.balls} initial={total - view.history.length} capacity={finalSize} picked={picked} />
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

          <div className="side">
            <div className="card">
              <div className="card-head">
                <span>Win chance by draw</span>
                <span className="muted">fair at every step</span>
              </div>
              <Sparkline probs={view.probs} draws={view.draws} />
            </div>
            <div className="card">
              <div className="card-head">
                <span>Draws</span>
                <span className="muted">
                  {view.history.length} / {view.draws}
                </span>
              </div>
              <ol className="strip" aria-label="Draw history">
                {Array.from({ length: view.draws }, (_, i) => (
                  <li key={i} className={view.history[i] ?? (i === view.history.length && inRound ? 'next' : '')} />
                ))}
              </ol>
            </div>
          </div>
        </div>

        <div className="foot">
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
      </section>

      {infoOpen && <InfoModal rtp={RTP} onClose={() => setInfoOpen(false)} />}
    </div>
  );
}
