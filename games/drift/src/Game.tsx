import { type BetTicket } from '@originals/game-sdk';
import { RoundOver, useBalance, useHost, useSettings } from '@originals/game-sdk/react';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import Field from './components/Field';
import InfoModal from './components/InfoModal';
import { fmtAmt, fmtChance, fmtMult, fmtMultShort, fmtPct } from './format';
import { initialState, position, reducer, type Outcome } from './round';
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
  const { wallet, rng, track } = useHost();
  const balance = useBalance();
  const host = useSettings();
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const ticket = useRef<BetTicket | null>(null);
  const placing = useRef(false);

  const [betText, setBetText] = useState('1.00');
  const [W, setW] = useState<Track>(20);
  const [x0, setX0] = useState(5);
  const [burst, setBurst] = useState<Burst>(10);
  const [takeProfit, setTakeProfit] = useState<number | null>(null);
  const [stopLoss, setStopLoss] = useState<number | null>(null);
  const [localTurbo, setLocalTurbo] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const turbo = localTurbo || host.turbo;
  const stepMs = turbo ? STEP_MS.turbo : STEP_MS.normal;

  const { phase, round } = state;
  const inRound = phase === 'running' || phase === 'paused';
  const bet = parseFloat(betText) || 0;
  const betInvalid = !(bet > 0) || bet > balance;

  // Walk the dot while running. Each step's ±1 comes from the host RNG.
  useEffect(() => {
    if (phase !== 'running') return;
    const t = setTimeout(() => dispatch({ type: 'step', dx: step(0, rng) as 1 | -1 }), stepMs);
    return () => clearTimeout(t);
  }, [phase, round?.path.length, stepMs, rng]);

  // Settle exactly once when the round ends.
  useEffect(() => {
    if (phase !== 'over' || !round || !ticket.current) return;
    void ticket.current.settle(round.mult);
    ticket.current = null;
  }, [phase, round]);

  // Each pause is a checkpoint: the player can cash out at the current value.
  useEffect(() => {
    if (phase !== 'paused' || !round) return;
    const x = position(round);
    track({ type: 'checkpoint', multiplier: cashMultiplier(x, round.x0), winChance: x / round.W });
  }, [phase, round?.checkpoints.length]);

  // Leaving mid-round cashes out at the current value, which is fair at any step.
  const latest = useRef(state);
  latest.current = state;
  useEffect(
    () => () => {
      const r = latest.current.round;
      if (ticket.current && r) void ticket.current.settle(cashMultiplier(position(r), r.x0));
    },
    [],
  );

  const start = useCallback(async () => {
    if (placing.current || ticket.current || betInvalid) return;
    placing.current = true;
    try {
      ticket.current = await wallet.placeBet(bet);
      dispatch({ type: 'start', bet, W, x0, burst, rules: { takeProfit, stopLoss } });
    } catch {
      /* rejected (e.g. insufficient funds): the button is already disabled for that */
    } finally {
      placing.current = false;
    }
  }, [wallet, bet, betInvalid, W, x0, burst, takeProfit, stopLoss]);

  const proceed = useCallback(() => {
    if (phase === 'running') dispatch({ type: 'pause' });
    else if (phase === 'paused') dispatch({ type: 'continue', burst });
    else void start();
  }, [phase, burst, start]);

  useEffect(() => {
    const typing = (e: KeyboardEvent) => {
      const t = e.composedPath()[0] as HTMLElement;
      return t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'range');
    };
    const onDown = (e: KeyboardEvent) => {
      if (infoOpen || typing(e)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) proceed();
      } else if (e.key.toLowerCase() === 'c') dispatch({ type: 'cashOut' });
    };
    // Stops a focused button from also "clicking" on Space.
    const onUp = (e: KeyboardEvent) => e.code === 'Space' && !typing(e) && e.preventDefault();
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, [proceed, infoOpen]);

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
  const stake = shown ? shown.bet : bet;
  const prize = prizeMultiplier(vW, vx0);
  const cash = cashMultiplier(x, vx0);
  const prev = path.length > 1 ? cashMultiplier(path[path.length - 2], vx0) : cash;
  const steps = path.length - 1;
  const last = state.history[0];
  const vol = volatilityOf(x0, W);

  let status = `Ready · about ${expectedSteps(x0, W)} steps to a wall`;
  if (phase === 'running') status = `Drifting · step ${steps}`;
  if (phase === 'paused') status = `Checkpoint · step ${steps}`;
  if (phase === 'over' && shown?.outcome) status = `${OUTCOME_TEXT[shown.outcome]} · ${steps} steps`;

  return (
    <div className="drift">
      <aside className="panel">
        <div className="label">
          <span>Bet amount</span>
          <span className="hint">Balance {fmtAmt(balance)}</span>
        </div>
        <div className="bet-row">
          <input
            value={betText}
            inputMode="decimal"
            aria-label="Bet amount"
            disabled={inRound}
            onChange={(e) => setBetText(e.target.value)}
            onBlur={() => setBetText(fmtAmt(bet))}
          />
          <button disabled={inRound} onClick={() => setBetText(fmtAmt(bet / 2))}>
            ½
          </button>
          <button disabled={inRound} onClick={() => setBetText(fmtAmt(Math.min(balance, bet * 2)))}>
            2×
          </button>
        </div>

        <div className="label">
          <span>Start position</span>
          <span className={`vol ${vol}`}>{vol}</span>
        </div>
        <input
          type="range"
          className="start-range"
          min={1}
          max={W - 1}
          value={x0}
          disabled={inRound}
          aria-label="Start position"
          onChange={(e) => change(() => changeStart(Number(e.target.value)))}
        />
        <div className="start-readout">
          <span>
            Win <b>{fmtChance(x0, W)}</b>
          </span>
          <span>
            Prize <b className="t-green">{fmtMult(prizeMultiplier(W, x0))}</b>
          </span>
        </div>
        <div className="chips">
          {startPresets(W).map((p) => (
            <button key={p} className={'chip' + (p === x0 ? ' on' : '')} disabled={inRound} onClick={() => change(() => changeStart(p))}>
              {fmtMultShort(prizeMultiplier(W, p))}
            </button>
          ))}
        </div>

        <div className="label">
          <span>Track length</span>
          <span className="hint">longer = slower, smoother</span>
        </div>
        <div className="chips">
          {TRACKS.map((t) => (
            <button
              key={t}
              className={'chip' + (t === W ? ' on' : '')}
              disabled={inRound}
              onClick={() =>
                change(() => {
                  setW(t);
                  changeStart(rescaleStart(x0, W, t), t);
                })
              }
            >
              {t}
            </button>
          ))}
        </div>

        <div className="label">
          <span>Steps per burst</span>
          <span className="hint">then pause to decide</span>
        </div>
        <div className="chips">
          {BURSTS.map((b) => (
            <button key={b} className={'chip' + (b === burst ? ' on' : '')} onClick={() => setBurst(b)} aria-label={b ? `${b} steps` : 'Run until paused'}>
              {b || '∞'}
            </button>
          ))}
        </div>

        <details className="auto">
          <summary>
            Auto cash-out
            <span className="hint">
              {takeProfit !== null || stopLoss !== null
                ? [takeProfit !== null && `≥ ${fmtMult(cashMultiplier(takeProfit, x0))}`, stopLoss !== null && `≤ ${fmtMult(cashMultiplier(stopLoss, x0))}`]
                    .filter(Boolean)
                    .join(' · ')
                : 'off'}
            </span>
          </summary>
          <label className="auto-row tp">
            <span>
              Take profit <b>{takeProfit === null ? 'Off' : fmtMult(cashMultiplier(takeProfit, x0))}</b>
            </span>
            <input
              type="range"
              min={x0 + 1}
              max={W}
              value={takeProfit ?? W}
              disabled={inRound}
              onChange={(e) => change(() => setTakeProfit(Number(e.target.value) >= W ? null : Number(e.target.value)))}
            />
          </label>
          <label className="auto-row sl">
            <span>
              Stop loss <b>{stopLoss === null ? 'Off' : fmtMult(cashMultiplier(stopLoss, x0))}</b>
            </span>
            <input
              type="range"
              min={0}
              max={Math.max(0, x0 - 1)}
              value={stopLoss ?? 0}
              disabled={inRound || x0 <= 1}
              onChange={(e) => change(() => setStopLoss(Number(e.target.value) <= 0 ? null : Number(e.target.value)))}
            />
          </label>
        </details>

        {inRound ? (
          <button key="cash" className="primary cash" onClick={() => dispatch({ type: 'cashOut' })}>
            Cash out <span className="amt">{fmtAmt(stake * cash)}</span>
          </button>
        ) : (
          <button key="bet" className="primary" disabled={betInvalid} onClick={() => void start()}>
            {phase === 'over' ? 'Bet again' : 'Bet'}
          </button>
        )}
        <button className="secondary" disabled={!inRound} onClick={proceed}>
          {phase === 'paused' ? `Continue · ${burst ? `${burst} step${burst > 1 ? 's' : ''}` : 'run'}` : 'Pause'}
        </button>

        <div className="panel-foot">
          <label className="toggle">
            <input type="checkbox" checked={turbo} disabled={host.turbo} onChange={(e) => setLocalTurbo(e.target.checked)} />
            <span>Turbo</span>
          </label>
          <button className="ghost info-btn" onClick={() => setInfoOpen(true)}>
            <span className="i">i</span> How to play
          </button>
        </div>
      </aside>

      <section className="stage">
        <div className="stage-top">
          <span className={`status ${phase} ${phase === 'over' && shown ? (shown.mult >= 1 ? 'won' : 'lost') : ''}`} aria-live="polite">
            {status}
          </span>
          <div className="history">
            {state.history.map((h) => (
              <span key={h.id} className={'hist ' + (h.mult >= 1 ? 'w' : h.mult > 0 ? 'p' : 'l')}>
                {fmtMult(h.mult)}
              </span>
            ))}
          </div>
        </div>

        <div className="readouts">
          <div className={`readout chance ${x <= 0 ? 'at-red' : x >= vW ? 'at-green' : ''}`}>
            <span>Win chance</span>
            <b>{fmtChance(x, vW)}</b>
            <small>
              {x} of {vW} steps from red
            </small>
          </div>
          <div className={`readout cashout ${!shown || steps === 0 ? '' : cash >= 1 ? 'up' : 'down'}`}>
            <span>Cash out now</span>
            <b>
              {fmtMult(cash)}
              {inRound && cash !== prev && <i className={cash > prev ? 'arrow up' : 'arrow down'}>{cash > prev ? '▲' : '▼'}</i>}
            </b>
            <small>{fmtAmt(stake * cash)}</small>
          </div>
          <div className="readout prize">
            <span>Prize at green</span>
            <b>{fmtMult(prize)}</b>
            <small>{fmtAmt(stake * prize)}</small>
          </div>
        </div>

        <div className="field-wrap">
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
          {phase === 'over' && shown?.outcome && last && (
            <RoundOver
              key={last.id}
              title={OUTCOME_TEXT[shown.outcome]}
              multiplier={shown.mult}
              stake={shown.bet}
              nextBet={bet}
              blocked={bet > balance ? 'Not enough balance' : !(bet > 0) ? 'Enter a valid bet' : undefined}
              onBetAgain={() => void start()}
              onClear={() => dispatch({ type: 'clear' })}
            />
          )}
        </div>

        <p className="caption">
          {inRound
            ? `About ${expectedSteps(x, vW)} more steps to a wall on average. Cash-out = prize × win chance.`
            : `Fair 50/50 steps: from any point the chance of reaching green is exactly the position. RTP ${fmtPct(RTP, 0)}.`}
        </p>
      </section>

      {infoOpen && <InfoModal rtp={RTP} onClose={() => setInfoOpen(false)} />}
    </div>
  );
}
