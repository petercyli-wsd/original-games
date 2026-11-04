import { type BetTicket } from '@originals/game-sdk';
import { useBalance, useHost, useSettings } from '@originals/game-sdk/react';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import Croc from './components/Croc';
import CustomiseDrawer from './components/CustomiseDrawer';
import InfoModal from './components/InfoModal';
import Tip from './components/Tip';
import { colorVars, loadConfig, saveConfig, withFixedMaths, type CrocConfig } from './config';
import { fairValue, initialState, reducer } from './game';
import { BITE, buildLadder, cardValue, fmtAmt, fmtMult, fmtPct, ladderStats, pickTraps, winChance } from './math';

const RULE = 'Take turns pressing teeth with the House. Press the bad tooth and you lose; if the House presses it, you win. Cash out between rounds.';

const pick = (options: number[], want: number) => (options.includes(want) ? want : options[0]);

export default function App() {
  const { wallet, rng, track } = useHost();
  const balance = useBalance();
  const hostSettings = useSettings();
  const [config, setConfig] = useState<CrocConfig>(loadConfig);
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  // The open bet. `placing` blocks double-starts while the wallet responds.
  const ticket = useRef<BetTicket | null>(null);
  const placing = useRef(false);
  // The tooth the House has picked this turn (its outcome is fixed from then on).
  const housePick = useRef<number | null>(null);
  const N = config.teeth;
  const [k, setK] = useState(() => pick(config.badTeethOptions, config.defaultBadTeeth));
  const [betText, setBetText] = useState('1.00000000');
  const [localTurbo, setTurbo] = useState(false);
  const turbo = localTurbo || hostSettings.turbo;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const closeInfo = useCallback(() => setInfoOpen(false), []);

  const { phase, round } = state;
  const inPlay = phase === 'you' || phase === 'house';

  useEffect(() => saveConfig(config), [config]);
  const vars = useMemo(() => colorVars(config.colors), [config.colors]);

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

  // Keep the selected setting valid when the config's options change.
  useEffect(() => {
    setK((x) => pick(config.badTeethOptions, x));
  }, [config.badTeethOptions]);

  const validK = k < N ? k : Math.max(1, ...config.badTeethOptions.filter((x) => x < N));
  const preview = useMemo(() => buildLadder(N, validK, BITE, config.rtp), [N, validK, config.rtp]);
  const previewStats = useMemo(() => ladderStats(preview), [preview]);
  const ladder = inPlay && round ? round.ladder : preview;

  // Each survived round is a checkpoint.
  useEffect(() => {
    if (phase === 'you' && round && round.r > 0) {
      const left = round.pressed.filter((p) => !p).length;
      track({ type: 'checkpoint', multiplier: round.cashMult, winChance: winChance(left, round.k, 'you') });
    }
  }, [phase, round?.r]);

  // The House's turn: pick a tooth (fixing the outcome), look at it, press it.
  useEffect(() => {
    if (phase !== 'house' || !round) return;
    const free = round.pressed.flatMap((p, i) => (p ? [] : [i]));
    const target = free[rng.int(free.length)];
    housePick.current = target;
    const delay = turbo ? config.turboHouseDelay : config.houseDelay;
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
  }, [phase, round?.r]);

  const bet = parseFloat(betText) || 0;

  // Changing the board after a game clears the old result.
  const changeSetting = (apply: () => void) => {
    apply();
    dispatch({ type: 'clear' });
  };

  const startBet = useCallback(async () => {
    if (placing.current || ticket.current) return;
    placing.current = true;
    try {
      ticket.current = await wallet.placeBet(bet);
      dispatch({ type: 'start', bet, N, k: validK, rtp: config.rtp, traps: pickTraps(N, validK, rng) });
    } catch {
      /* rejected (e.g. insufficient funds): the button is already disabled for that */
    } finally {
      placing.current = false;
    }
  }, [wallet, rng, bet, N, validK, config.rtp]);

  const pressRandom = useCallback(() => {
    if (phase !== 'you' || !round) return;
    const free = round.pressed.flatMap((p, i) => (p ? [] : [i]));
    dispatch({ type: 'pressYou', i: free[rng.int(free.length)] });
  }, [phase, round, rng]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.composedPath()[0] as HTMLElement;
      if (drawerOpen || infoOpen || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (phase === 'idle' || phase === 'over') void startBet();
        else pressRandom();
      } else if (e.key.toLowerCase() === 'c') {
        dispatch({ type: 'cashOut' });
      } else if (e.key === 'Escape') {
        dispatch({ type: 'clear' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, startBet, pressRandom, drawerOpen, infoOpen]);

  // Show the live/finished round, unless the player has since picked a different board.
  const shown = round && (inPlay || (phase === 'over' && round.N === N && round.k === validK)) ? round : null;
  const shownN = shown ? shown.N : N;
  const shownK = shown ? shown.k : validK;
  const remaining = shown ? shown.pressed.filter((p) => !p).length : shownN;
  // Bad teeth still unpressed (all k while the game runs; one fewer after a bite).
  const badLeft = shown ? shown.traps.filter((t) => !shown.pressed[t]).length : shownK;
  const rung = inPlay && round ? round.ladder[round.r] : preview[0];
  const canCash = phase === 'you' && !!round && round.r > 0;
  const betInvalid = !(bet > 0) || bet > balance;
  const last = state.history[0];

  // Live chance of winning this game if you play to the end.
  const liveChance =
    phase === 'over' && shown && last ? (last.win ? 1 : 0) : winChance(remaining, shownK, phase === 'house' ? 'house' : 'you');

  let mainLabel = phase === 'over' ? 'Bet Again' : 'Bet';
  if (phase === 'you') mainLabel = canCash && round ? `Cash Out · ${fmtAmt(round.bet * round.cashMult)}` : 'Press a random tooth';
  if (phase === 'house') mainLabel = 'House is pressing…';
  const onMain = () => {
    if (canCash) dispatch({ type: 'cashOut' });
    else if (phase === 'you') pressRandom();
    else void startBet();
  };

  let riskLabel = 'Bite odds on your first press';
  if (phase === 'you') riskLabel = 'Your bite odds on this press';
  if (phase === 'house') riskLabel = "House's bite odds on this press";
  if (phase === 'over') riskLabel = 'Bad teeth left unpressed';

  return (
    <div className="croc-root" style={vars}>
      <main className="shell">
        <aside className="panel">
          <div className="field-label">
            <span>Bet Amount</span>
          </div>
          <div className="bet-row">
            <input type="number" min="0" step="0.00000001" value={betText} disabled={inPlay} onChange={(e) => setBetText(e.target.value)} />
            <button disabled={inPlay} onClick={() => setBetText(fmtAmt(bet / 2))}>
              ½
            </button>
            <button disabled={inPlay} onClick={() => setBetText(fmtAmt(Math.min(balance, bet * 2)))}>
              2×
            </button>
          </div>

          <div className="field-label">
            <span>
              Bad Teeth <Tip text={`How many of the ${N} teeth bite. More bad teeth: a lower chance to win and bigger payouts.`} />
            </span>
            <span className="hint">of {N} · more = riskier</span>
          </div>
          <div className="chips knob">
            {config.badTeethOptions.map((x) => (
              <button key={x} className={'chip' + (x === validK ? ' on' : '')} disabled={inPlay || x >= N} onClick={() => changeSetting(() => setK(x))}>
                {x}
              </button>
            ))}
          </div>
          <dl className="setting-stats">
            <div>
              <dt>Chance to win</dt>
              <dd>{fmtPct(previewStats.winChance)}</dd>
            </div>
            <div>
              <dt>Top prize</dt>
              <dd>{fmtMult(previewStats.max)}</dd>
            </div>
          </dl>

          <button
            className={'primary' + (canCash ? ' cash' : '')}
            disabled={phase === 'house' || (!inPlay && betInvalid)}
            onClick={onMain}
          >
            {mainLabel}
          </button>
          {inPlay && round && round.r > 0 && (
            <button className="secondary" disabled={phase !== 'you'} onClick={pressRandom}>
              Press a random tooth
            </button>
          )}

          <label className="toggle">
            <input type="checkbox" checked={turbo} onChange={(e) => setTurbo(e.target.checked)} /> <span>Turbo</span>
            <Tip text="Makes the House take its turn almost instantly. The odds don't change." />
          </label>
          <div className="panel-links">
            <button className="ghost info-btn" onClick={() => setInfoOpen(true)}>
              <span className="i">i</span> How to play
            </button>
            <button className="ghost" onClick={() => setDrawerOpen(true)}>
              ⚙ Customise
            </button>
          </div>
        </aside>

        <section className="stage">
          <div className="stage-top">
            <div className="turns">
              <span className={'turn you' + (phase === 'you' ? ' on' : '')}>YOU</span>
              <span className="vs">vs</span>
              <span className={'turn house' + (phase === 'house' ? ' on' : '')}>HOUSE</span>
              {phase !== 'over' && rung && (
                <span className="house-pays">
                  House bitten pays <b>{fmtMult(rung.bite)}</b>
                </span>
              )}
            </div>
            <div className="history">
              {state.history.map((h, i) => (
                <span key={state.history.length - i} className={'hist ' + (h.win ? 'w' : 'l')}>
                  {fmtMult(h.mult)}
                </span>
              ))}
            </div>
          </div>

          <div className="croc-wrap">
            <Croc
              N={shownN}
              pressed={shown ? shown.pressed : Array(shownN).fill(null)}
              revealed={phase === 'over' && shown ? shown.traps : []}
              playable={phase === 'you'}
              onPress={(i) => dispatch({ type: 'pressYou', i })}
              houseTarget={phase === 'house' ? state.houseTarget : null}
              fx={state.fx}
              danger={0}
              focused={phase === 'house'}
              open={inPlay}
              steady
            />
            {phase === 'over' && round && shown && last && (
              <div className={'result ' + (last.win ? 'w' : 'l')} key={state.history.length}>
                <span className="result-title">{last.win ? fmtMult(last.mult) : 'Bitten'}</span>
                <span className="result-amt">
                  {last.win ? '+' : '−'}
                  {fmtAmt(Math.abs(round.bet * last.mult - round.bet))}
                </span>
                <div className="result-actions">
                  <button className="primary" disabled={betInvalid} onClick={() => void startBet()}>
                    Bet Again
                  </button>
                  <button className="ghost" onClick={() => dispatch({ type: 'clear' })}>
                    Clear Board
                  </button>
                </div>
              </div>
            )}
          </div>

          <p className="rule">{RULE}</p>
          <div className={'message' + (state.message.tone === 'win' ? ' w' : state.message.tone === 'lose' ? ' l' : '')}>{state.message.text}</div>

          <div className="bars">
            <div className="risk">
              <div className="risk-label">
                <span>{riskLabel}</span>
                <span className="risk-text">
                  {badLeft} bad of {remaining} · {fmtPct(badLeft / remaining)}
                </span>
              </div>
              <div className="risk-bar">
                {Array.from({ length: remaining }, (_, i) => (
                  <i key={i} className={i < badLeft ? 'bad' : ''} />
                ))}
              </div>
            </div>

            <div className="risk">
              <div className="risk-label">
                <span>Win chance if you play to the end</span>
                <span className="risk-text win">{fmtPct(liveChance)}</span>
              </div>
              <div className="win-bar">
                <i style={{ width: `${(liveChance * 100).toFixed(2)}%` }} />
              </div>
            </div>
          </div>

          <div className="ladder-head">Cash-out after each round</div>
          <div className="ladder wrap">
            {ladder.map((r, i) => {
              const now = inPlay && round?.r === i;
              const done = inPlay && !!round && i < round.r;
              return (
                <div key={i} className={'rung' + (now ? ' now' : '') + (done ? ' done' : '')}>
                  Round {i + 1}
                  <b>{fmtMult(cardValue(r))}</b>
                </div>
              );
            })}
          </div>
        </section>
      </main>

      {infoOpen && <InfoModal rtp={config.rtp} teeth={N} onClose={closeInfo} />}
      {drawerOpen && <CustomiseDrawer config={config} onChange={(c) => setConfig(withFixedMaths(c))} onClose={() => setDrawerOpen(false)} />}
    </div>
  );
}
