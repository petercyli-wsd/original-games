import { type BetTicket } from '@originals/game-sdk';
import { useBalance, useHost, useSettings } from '@originals/game-sdk/react';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import Croc from './components/Croc';
import CustomiseDrawer from './components/CustomiseDrawer';
import InfoModal from './components/InfoModal';
import Tip from './components/Tip';
import { colorVars, loadConfig, saveConfig, type CrocConfig } from './config';
import { initialState, reducer } from './game';
import { buildLadder, fmtAmt, fmtMult, fmtPct, ladderStats, pickTraps } from './math';

const SEEN_INFO_KEY = 'croc.seenInfo';

function firstVisit() {
  try {
    return !localStorage.getItem(SEEN_INFO_KEY);
  } catch {
    return false;
  }
}

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
  const [N, setN] = useState(() => pick(config.teethOptions, config.defaultTeeth));
  const [k, setK] = useState(() => pick(config.badTeethOptions, config.defaultBadTeeth));
  const [J, setJ] = useState(config.defaultBiteBonus);
  const [betText, setBetText] = useState('1.00000000');
  const [localTurbo, setTurbo] = useState(false);
  const turbo = localTurbo || hostSettings.turbo;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(firstVisit);
  const closeInfo = useCallback(() => {
    setInfoOpen(false);
    try {
      localStorage.setItem(SEEN_INFO_KEY, '1');
    } catch {
      /* storage unavailable */
    }
  }, []);

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

  // Each survived round is a checkpoint.
  useEffect(() => {
    if (phase === 'you' && round && round.r > 0) track({ type: 'checkpoint', multiplier: round.cashMult, winChance: stats.winChance });
  }, [phase, round?.r]);

  // Leaving mid-round cashes out whatever has been banked (0 before the first checkpoint).
  const latest = useRef(state);
  latest.current = state;
  useEffect(
    () => () => {
      if (ticket.current) void ticket.current.settle(latest.current.round?.cashMult ?? 0);
    },
    [],
  );

  // Keep the selected settings valid when the config's options change.
  useEffect(() => {
    setN((n) => pick(config.teethOptions, n));
    setK((x) => pick(config.badTeethOptions, x));
    setJ((j) => Math.min(config.biteBonusMax, Math.max(config.biteBonusMin, j)));
  }, [config.teethOptions, config.badTeethOptions, config.biteBonusMin, config.biteBonusMax]);

  const validK = k < N ? k : Math.max(1, ...config.badTeethOptions.filter((x) => x < N));
  const preview = useMemo(() => buildLadder(N, validK, J, config.rtp), [N, validK, J, config.rtp]);
  const ladder = inPlay && round ? round.ladder : preview;
  const stats = useMemo(() => ladderStats(ladder), [ladder]);

  // The House's turn: look at a tooth, then press it.
  useEffect(() => {
    if (phase !== 'house' || !round) return;
    const free = round.pressed.flatMap((p, i) => (p ? [] : [i]));
    const target = free[rng.int(free.length)];
    const delay = turbo ? config.turboHouseDelay : config.houseDelay;
    const t1 = setTimeout(() => dispatch({ type: 'houseTarget', i: target }), delay * 0.3);
    const t2 = setTimeout(() => dispatch({ type: 'pressHouse', i: target }), delay);
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
      dispatch({ type: 'start', bet, N, k: validK, J, rtp: config.rtp, traps: pickTraps(N, validK, rng) });
    } catch {
      /* rejected (e.g. insufficient funds): the button is already disabled for that */
    } finally {
      placing.current = false;
    }
  }, [wallet, rng, bet, N, validK, J, config.rtp]);

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
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, startBet, pressRandom, drawerOpen, infoOpen]);

  // Show the live/finished round, unless the player has since picked a different board.
  const shown = round && (inPlay || (phase === 'over' && round.N === N && round.k === validK)) ? round : null;
  const shownN = shown ? shown.N : N;
  const shownK = shown ? shown.k : validK;
  const remaining = inPlay && round ? round.N - round.pressed.filter(Boolean).length : shownN;
  const rung = inPlay && round ? round.ladder[round.r] : preview[0];
  const canCash = phase === 'you' && !!round && round.r > 0;
  const betInvalid = !(bet > 0) || bet > balance;
  const last = state.history[0];

  let mainLabel = phase === 'over' ? 'Bet Again' : 'Bet';
  if (phase === 'you') mainLabel = canCash && round ? `Cash Out · ${fmtAmt(round.bet * round.cashMult)}` : 'Pick a tooth…';
  if (phase === 'house') mainLabel = 'House is pressing…';

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
              Teeth <Tip text="How many teeth the croc has. More teeth make for longer games and a higher top multiplier." />
            </span>
            <span className="hint">more = longer game</span>
          </div>
          <div className="chips">
            {config.teethOptions.map((n) => (
              <button key={n} className={'chip' + (n === N ? ' on' : '')} disabled={inPlay} onClick={() => changeSetting(() => setN(n))}>
                {n}
              </button>
            ))}
          </div>

          <div className="field-label">
            <span>
              Bad Teeth <Tip text="How many teeth bite. More bad teeth make each press riskier and the wins bigger." />
            </span>
            <span className="hint">more = riskier, bigger wins</span>
          </div>
          <div className="chips">
            {config.badTeethOptions.map((x) => (
              <button key={x} className={'chip' + (x === validK ? ' on' : '')} disabled={inPlay || x >= N} onClick={() => changeSetting(() => setK(x))}>
                {x}
              </button>
            ))}
          </div>

          <div className="field-label">
            <span>
              Bite Bonus <Tip text="Ladder: cash-out climbs faster. Duel: the House getting bitten pays more. Same RTP either way." />
            </span>
            <span className="hint">{J.toFixed(1)}×</span>
          </div>
          <input
            type="range"
            min={config.biteBonusMin}
            max={config.biteBonusMax}
            step={0.1}
            value={J}
            disabled={inPlay}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              changeSetting(() => setJ(v));
            }}
          />
          <div className="range-ends">
            <span>Ladder</span>
            <span>Duel</span>
          </div>

          <button
            className={'primary' + (canCash ? ' cash' : '')}
            disabled={phase === 'house' || (phase === 'you' && !canCash) || (!inPlay && betInvalid)}
            onClick={() => (canCash ? dispatch({ type: 'cashOut' }) : void startBet())}
          >
            {mainLabel}
          </button>
          <button className="secondary" disabled={phase !== 'you'} onClick={pressRandom}>
            Pick Random Tooth
          </button>

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
            danger={inPlay ? shownK / remaining : 0}
            focused={phase === 'house'}
            open={inPlay}
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
                  Play Again
                </button>
                <button className="ghost" onClick={() => dispatch({ type: 'clear' })}>
                  New Board
                </button>
              </div>
            </div>
          )}
          </div>

          <div className={'message' + (state.message.tone === 'win' ? ' w' : state.message.tone === 'lose' ? ' l' : '')}>{state.message.text}</div>

          <div className="risk">
            <div className="risk-label">
              <span>{phase === 'house' ? "House's bite odds" : 'Your bite odds on the next press'}</span>
              <span className="risk-text">
                {shownK} in {remaining} · {fmtPct(shownK / remaining)}
              </span>
            </div>
            <div className="risk-bar">
              {Array.from({ length: remaining }, (_, i) => (
                <i key={i} className={i < shownK ? 'bad' : ''} />
              ))}
            </div>
          </div>

          <div className="ladder">
            {ladder.map((r, i) => {
              const now = inPlay && round?.r === i;
              const done = inPlay && !!round && i < round.r;
              return (
                <div key={i} className={'rung' + (now ? ' now' : '') + (done ? ' done' : '')}>
                  Round {i + 1}
                  <b>{fmtMult(r.next)}</b>
                  <span className="bp">bite {fmtMult(r.bite)}</span>
                </div>
              );
            })}
          </div>

          <div className="stats">
            <div className="stat">
              <span>Cash Out Now</span>
              <b>{canCash && round ? `${fmtMult(round.cashMult)}` : '–'}</b>
            </div>
            <div className="stat">
              <span>If House Is Bitten</span>
              <b>{rung ? fmtMult(rung.bite) : '–'}</b>
            </div>
            <div className="stat">
              <span>Win Chance (play to end)</span>
              <b>{fmtPct(stats.winChance)}</b>
            </div>
            <div className="stat">
              <span>Max Multiplier</span>
              <b>{fmtMult(stats.max)}</b>
            </div>
          </div>
        </section>
      </main>

      {infoOpen && <InfoModal rtp={config.rtp} onClose={closeInfo} />}
      {drawerOpen && <CustomiseDrawer config={config} onChange={setConfig} onClose={() => setDrawerOpen(false)} />}
    </div>
  );
}
