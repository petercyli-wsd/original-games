import { type BetTicket } from '@originals/game-sdk';
import { useBalance, useHost } from '@originals/game-sdk/react';
import { DEFAULT_CONFIG, colorVars } from '@originals/crocodile-dentist/config';
import Croc from '@originals/crocodile-dentist/croc';
import Tip from '@originals/crocodile-dentist/tip';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import InfoModal from './components/InfoModal';
import { banked, initialState, reducer } from './game';
import { BAD_TEETH_OPTIONS, RTP, TEETH_OPTIONS } from './manifest';
import { buildLadder, fmtAmt, fmtMult, fmtPct, pickTraps } from './math';

const SEEN_INFO_KEY = 'croc-solo.seenInfo';
const VARS = colorVars(DEFAULT_CONFIG.colors);

function firstVisit() {
  try {
    return !localStorage.getItem(SEEN_INFO_KEY);
  } catch {
    return false;
  }
}

export default function App() {
  const { wallet, rng, track } = useHost();
  const balance = useBalance();
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  // The open bet. `placing` blocks double-starts while the wallet responds.
  const ticket = useRef<BetTicket | null>(null);
  const placing = useRef(false);
  const [N, setN] = useState(12);
  const [k, setK] = useState(1);
  const [betText, setBetText] = useState('1.00000000');
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
  const playing = phase === 'playing';
  const validK = k < N ? k : 1;
  const preview = useMemo(() => buildLadder(N, validK, RTP), [N, validK]);
  const ladder = playing && round ? round.ladder : preview;

  // Settle the bet when a round ends. history[0] is the round just finished.
  useEffect(() => {
    if (phase !== 'over' || !ticket.current) return;
    void ticket.current.settle(state.history[0].mult);
    ticket.current = null;
  }, [phase, state.history]);

  // Each safe press is a checkpoint.
  useEffect(() => {
    if (playing && round && round.safe > 0) {
      const nextStep = round.ladder[round.safe];
      track({ type: 'checkpoint', multiplier: banked(round), winChance: nextStep ? 1 - nextStep.pBite : 1 });
    }
  }, [playing, round?.safe]);

  // Leaving mid-round cashes out whatever has been banked (0 before the first safe press).
  const latest = useRef(state);
  latest.current = state;
  useEffect(
    () => () => {
      const rd = latest.current.round;
      if (ticket.current) void ticket.current.settle(rd && latest.current.phase === 'playing' ? banked(rd) : 0);
    },
    [],
  );

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
      dispatch({ type: 'start', bet, N, k: validK, rtp: RTP, traps: pickTraps(N, validK, rng) });
    } catch {
      /* rejected (e.g. insufficient funds): the button is already disabled for that */
    } finally {
      placing.current = false;
    }
  }, [wallet, rng, bet, N, validK]);

  const pressRandom = useCallback(() => {
    if (!playing || !round) return;
    const free = round.pressed.flatMap((p, i) => (p ? [] : [i]));
    dispatch({ type: 'press', i: free[rng.int(free.length)] });
  }, [playing, round, rng]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.composedPath()[0] as HTMLElement;
      if (infoOpen || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (playing) pressRandom();
        else void startBet();
      } else if (e.key.toLowerCase() === 'c') {
        dispatch({ type: 'cashOut' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playing, startBet, pressRandom, infoOpen]);

  const shown = round && (playing || (phase === 'over' && round.N === N && round.k === validK)) ? round : null;
  const shownN = shown ? shown.N : N;
  const shownK = shown ? shown.k : validK;
  const remaining = playing && round ? round.N - round.pressed.filter(Boolean).length : shownN;
  const safe = playing && round ? round.safe : 0;
  const cash = playing && round ? banked(round) : 0;
  const nextStep = ladder[safe];
  const canCash = playing && safe > 0;
  const betInvalid = !(bet > 0) || bet > balance;
  const last = state.history[0];

  let mainLabel = phase === 'over' ? 'Bet Again' : 'Bet';
  if (playing) mainLabel = canCash && round ? `Cash Out · ${fmtAmt(round.bet * cash)}` : 'Pick a tooth…';

  return (
    <div className="croc-root" style={VARS}>
      <main className="shell">
        <aside className="panel">
          <div className="field-label">
            <span>Bet Amount</span>
          </div>
          <div className="bet-row">
            <input type="number" min="0" step="0.00000001" value={betText} disabled={playing} onChange={(e) => setBetText(e.target.value)} />
            <button disabled={playing} onClick={() => setBetText(fmtAmt(bet / 2))}>
              ½
            </button>
            <button disabled={playing} onClick={() => setBetText(fmtAmt(Math.min(balance, bet * 2)))}>
              2×
            </button>
          </div>

          <div className="field-label">
            <span>
              Teeth <Tip text="How many teeth the croc has. More teeth make each press safer, with smaller steps." />
            </span>
            <span className="hint">more = gentler steps</span>
          </div>
          <div className="chips">
            {TEETH_OPTIONS.map((n) => (
              <button key={n} className={'chip' + (n === N ? ' on' : '')} disabled={playing} onClick={() => changeSetting(() => setN(n))}>
                {n}
              </button>
            ))}
          </div>

          <div className="field-label">
            <span>
              Bad Teeth <Tip text="How many teeth bite. More bad teeth make each press riskier and each step pay more." />
            </span>
            <span className="hint">more = riskier, bigger wins</span>
          </div>
          <div className="chips">
            {BAD_TEETH_OPTIONS.map((x) => (
              <button key={x} className={'chip' + (x === validK ? ' on' : '')} disabled={playing || x >= N} onClick={() => changeSetting(() => setK(x))}>
                {x}
              </button>
            ))}
          </div>

          <button
            className={'primary' + (canCash ? ' cash' : '')}
            disabled={(playing && !canCash) || (!playing && betInvalid)}
            onClick={() => (canCash ? dispatch({ type: 'cashOut' }) : void startBet())}
          >
            {mainLabel}
          </button>
          <button className="secondary" disabled={!playing} onClick={pressRandom}>
            Pick Random Tooth
          </button>

          <div className="panel-links">
            <button className="ghost info-btn" onClick={() => setInfoOpen(true)}>
              <span className="i">i</span> How to play
            </button>
          </div>
        </aside>

        <section className="stage">
          <div className="stage-top">
            <div className="turns">
              <span className={'turn you' + (playing ? ' on' : '')}>
                {safe} / {shownN - shownK} SAFE
              </span>
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
              playable={playing}
              onPress={(i) => dispatch({ type: 'press', i })}
              houseTarget={null}
              fx={state.fx}
              danger={playing ? shownK / remaining : 0}
              focused={false}
              open={playing}
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
                </div>
              </div>
            )}
          </div>

          <div className={'message' + (state.message.tone === 'win' ? ' w' : state.message.tone === 'lose' ? ' l' : '')}>{state.message.text}</div>

          <div className="risk">
            <div className="risk-label">
              <span>Bite odds on the next press</span>
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
            {ladder.map((s, i) => {
              const now = playing && i === safe;
              const done = playing && i < safe;
              return (
                <div key={i} className={'rung' + (now ? ' now' : '') + (done ? ' done' : '')}>
                  Tooth {s.press}
                  <b>{fmtMult(s.mult)}</b>
                  <span className="reach">{fmtPct(s.reach)} reach</span>
                </div>
              );
            })}
          </div>

          <div className="stats">
            <div className="stat">
              <span>Cash Out Now</span>
              <b>{canCash ? fmtMult(cash) : '–'}</b>
            </div>
            <div className="stat">
              <span>Next Safe Press Pays</span>
              <b>{nextStep ? fmtMult(nextStep.mult) : '–'}</b>
            </div>
            <div className="stat">
              <span>Chance Next Press Is Safe</span>
              <b>{nextStep ? fmtPct(1 - nextStep.pBite) : '–'}</b>
            </div>
            <div className="stat">
              <span>Max Multiplier</span>
              <b>{fmtMult(ladder[ladder.length - 1].mult)}</b>
            </div>
          </div>
        </section>
      </main>

      {infoOpen && <InfoModal rtp={RTP} onClose={closeInfo} />}
    </div>
  );
}
