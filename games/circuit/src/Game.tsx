import { formatAmount, formatMultiplier, formatPercent, type BetTicket } from '@originals/game-sdk';
import { useBalance, useHost, useSettings } from '@originals/game-sdk/react';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import Board, { TopologyGlyph } from './Board';
import { initialState, reducer, type GameState } from './round';
import {
  Q,
  TOPOLOGIES,
  TOPOLOGY_IDS,
  analysis,
  cashMultiplier,
  nextWire,
  prize,
  reliability,
  type TopologyId,
} from './math';

const fmtPct = (x: number) => formatPercent(x, x > 0 && x < 0.1 ? 2 : 1);

// Current reliability of a round, including finished ones (won = 1, lost = 0).
function currentR(s: GameState): number {
  const rd = s.round;
  if (!rd) return 0;
  if (rd.outcome === 'won') return 1;
  if (rd.outcome === 'lost') return 0;
  return analysis(TOPOLOGIES[rd.topo], rd.live, rd.dead).r;
}

export default function Game() {
  const { wallet, rng, track } = useHost();
  const balance = useBalance();
  const { turbo } = useSettings();

  const [topoId, setTopoId] = useState<TopologyId>('bridge');
  const [betText, setBetText] = useState('1.00');
  const [auto, setAuto] = useState(false);
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const ticket = useRef<BetTicket | null>(null);
  const placing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const { phase, round } = state;
  const inPlay = phase === 'probing' || phase === 'checkpoint';
  const probeMs = turbo ? 220 : 720;

  // Show the live or just-finished round unless the player has picked another network since.
  const shown = round && (inPlay || round.topo === topoId) ? round : null;
  const t = TOPOLOGIES[shown ? shown.topo : topoId];
  const r = shown ? currentR(state) : reliability(t);
  const M = prize(t);
  const a = analysis(t, shown?.live ?? 0, shown?.dead ?? 0);
  const next = phase === 'checkpoint' && round ? nextWire(t, round.live, round.dead, round.order) : null;
  const bet = parseFloat(betText) || 0;
  const stake = shown?.bet ?? bet;
  const cashMult = phase === 'checkpoint' ? cashMultiplier(t, r) : shown?.outcome ? shown.mult : 0;

  // Settle the bet when a round ends.
  useEffect(() => {
    if (phase !== 'over' || !ticket.current || !round) return;
    void ticket.current.settle(round.mult);
    ticket.current = null;
    setAuto(false);
  }, [phase, round]);

  // Every reveal that leaves the round undecided is a checkpoint.
  useEffect(() => {
    if (phase === 'checkpoint' && round) {
      const R = currentR(state);
      track({ type: 'checkpoint', multiplier: cashMultiplier(TOPOLOGIES[round.topo], R), winChance: R });
    }
  }, [phase, round?.trail.length]);

  // Leaving mid-round cashes out at the current value (fair: it is the expectation).
  const latest = useRef(state);
  latest.current = state;
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      const rd = latest.current.round;
      if (ticket.current && rd) void ticket.current.settle(cashMultiplier(TOPOLOGIES[rd.topo], currentR(latest.current)));
    },
    [],
  );

  // Draw the wire's fate now; show it once the probe animation finishes.
  const scheduleResolve = useCallback(() => {
    const holds = rng.next() < Q;
    timer.current = setTimeout(() => dispatch({ type: 'resolve', holds }), probeMs);
  }, [rng, probeMs]);

  const startBet = useCallback(async () => {
    if (placing.current || ticket.current) return;
    placing.current = true;
    try {
      ticket.current = await wallet.placeBet(bet);
      const topo = TOPOLOGIES[topoId];
      const order = rng.shuffle(topo.edges.map((_, e) => e));
      dispatch({ type: 'start', topo: topoId, bet, order, first: nextWire(topo, 0, 0, order)! });
      scheduleResolve();
    } catch {
      /* rejected (e.g. insufficient funds): the button is already disabled for that */
    } finally {
      placing.current = false;
    }
  }, [wallet, rng, bet, topoId, scheduleResolve]);

  const reveal = useCallback(() => {
    if (phase !== 'checkpoint' || next === null) return;
    dispatch({ type: 'probe', wire: next });
    scheduleResolve();
  }, [phase, next, scheduleResolve]);

  const cashOut = useCallback(() => {
    setAuto(false);
    dispatch({ type: 'cashOut' });
  }, []);

  // Auto: keep testing wires until the round is decided.
  useEffect(() => {
    if (!auto || phase !== 'checkpoint') return;
    const id = setTimeout(reveal, turbo ? 90 : 320);
    return () => clearTimeout(id);
  }, [auto, phase, reveal, turbo]);

  const betInvalid = !(bet > 0) || bet > balance;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The game lives in a shadow root, so the real target is the first in the path.
      const target = e.composedPath()[0] as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'BUTTON') return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (phase === 'checkpoint') reveal();
        else if ((phase === 'idle' || phase === 'over') && !betInvalid) void startBet();
      } else if (e.key.toLowerCase() === 'c' && phase === 'checkpoint') {
        cashOut();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, reveal, startBet, cashOut, betInvalid]);

  const pickTopo = (id: TopologyId) => {
    setTopoId(id);
    dispatch({ type: 'clear' });
  };

  let message = `Every wire is a coin flip. Connect S to T to win ${formatMultiplier(M)}.`;
  let tone: 'neutral' | 'win' | 'even' | 'lose' = 'neutral';
  if (shown) {
    const lastHeld = shown.last !== null && ((shown.live >> shown.last) & 1) === 1;
    if (phase === 'probing') message = 'Testing wire…';
    else if (phase === 'checkpoint') message = `${lastHeld ? 'Wire held.' : 'Wire snapped.'} Cash out, or test the next wire.`;
    else if (shown.outcome === 'won') [message, tone] = [`Connected! Power reached T. Paid ${formatMultiplier(shown.mult)}`, 'win'];
    else if (shown.outcome === 'lost') [message, tone] = ['Circuit broken. Every route to T is cut.', 'lose'];
    else if (shown.outcome === 'cashed') [message, tone] = [`Cashed out at ${formatMultiplier(shown.mult)}`, shown.mult >= 1 ? 'win' : 'even'];
  }

  const tested = shown ? shown.trail.length - 1 : 0;
  const amount = (mult: number) => `${formatAmount(stake * mult, 2)} ${wallet.currency}`;

  return (
    <div className="circuit">
      <aside className="panel">
        <div className="field">
          <span className="label">Bet amount</span>
          <div className="bet-row">
            <input
              value={betText}
              inputMode="decimal"
              aria-label="Bet amount"
              disabled={inPlay}
              onChange={(e) => setBetText(e.target.value)}
              onBlur={() => setBetText((v) => formatAmount(parseFloat(v) || 0, 2))}
            />
            <button disabled={inPlay} onClick={() => setBetText(formatAmount(bet / 2, 2))}>
              ½
            </button>
            <button disabled={inPlay} onClick={() => setBetText(formatAmount(Math.min(balance, bet * 2), 2))}>
              2×
            </button>
          </div>
        </div>

        <div className="field">
          <span className="label">
            Network <span className="hint">sets the volatility</span>
          </span>
          <div className="topos" role="radiogroup" aria-label="Network">
            {TOPOLOGY_IDS.map((id) => {
              const topo = TOPOLOGIES[id];
              return (
                <button
                  key={id}
                  role="radio"
                  aria-checked={id === topoId}
                  className={'topo' + (id === topoId ? ' on' : '')}
                  disabled={inPlay}
                  onClick={() => pickTopo(id)}
                  title={topo.blurb}
                >
                  <TopologyGlyph topo={topo} />
                  <span className="topo-name">
                    {topo.name}
                    <i className={'vol ' + topo.volatility}>{topo.volatility}</i>
                  </span>
                  <span className="topo-odds">
                    <span>{fmtPct(reliability(topo))}</span>
                    <b>{formatMultiplier(prize(topo))}</b>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {phase === 'checkpoint' ? (
          <>
            <button className="primary cash" onClick={cashOut}>
              Cash out {formatAmount(stake * cashMult, 2)}
            </button>
            <div className="duo">
              <button className="secondary" onClick={reveal}>
                Next wire
              </button>
              <button className="secondary" onClick={() => setAuto(true)}>
                Play it out
              </button>
            </div>
          </>
        ) : (
          <>
            <button className="primary" disabled={phase === 'probing' || betInvalid} onClick={() => void startBet()}>
              {phase === 'probing' ? (auto ? 'Playing out…' : 'Testing wire…') : 'Bet'}
            </button>
            <div className="duo">
              <button className="secondary" disabled>
                Next wire
              </button>
              <button className="secondary" disabled>
                Play it out
              </button>
            </div>
          </>
        )}

        <dl className="stats">
          <div>
            <dt>Wire holds</dt>
            <dd>{formatPercent(Q, 0)} each</dd>
          </div>
          <div>
            <dt>Balance</dt>
            <dd>{formatAmount(balance, 2)}</dd>
          </div>
          <div className="keys">
            <kbd>Space</kbd> bet / next wire <kbd>C</kbd> cash out
          </div>
        </dl>
      </aside>

      <section className="stage">
        <div className="tiles">
          <div className={'tile meter' + (shown?.outcome ? ' ' + shown.outcome : '')}>
            <span className="tile-label">Connection chance</span>
            <b className="big">{fmtPct(r)}</b>
            <div className="bar">
              <i style={{ width: `${r * 100}%` }} />
            </div>
            <span className="sub">
              {shown ? `from ${fmtPct(shown.trail[0])} · ${tested} ${tested === 1 ? 'wire' : 'wires'} tested` : `${t.edges.length} wires, each a coin flip`}
            </span>
          </div>
          <div className="tile">
            <span className="tile-label">Cash out now</span>
            <b className="big">{phase === 'checkpoint' || shown?.outcome === 'cashed' ? formatMultiplier(cashMult) : '–'}</b>
            <span className="sub">{phase === 'checkpoint' || shown?.outcome === 'cashed' ? amount(cashMult) : 'prize × chance'}</span>
          </div>
          <div className="tile">
            <span className="tile-label">Prize if connected</span>
            <b className="big prize">{formatMultiplier(M)}</b>
            <span className="sub">{amount(M)}</span>
          </div>
        </div>

        <div className="board-wrap">
          <Board topo={t} round={shown} next={next} probeMs={probeMs} />
          {shown?.outcome && (
            <div className={'result ' + shown.outcome + (shown.mult >= 1 ? ' profit' : '')} key={state.history.length}>
              <span className="result-title">
                {shown.outcome === 'won' ? 'Connected' : shown.outcome === 'lost' ? 'Broken' : 'Cashed out'}
              </span>
              <b>{formatMultiplier(shown.mult)}</b>
              <span>{formatAmount(shown.bet * shown.mult, 2)}</span>
            </div>
          )}
        </div>

        <div className={'next-odds' + (next === null ? ' hidden' : '')} aria-hidden={next === null}>
          <span className="muted">Next wire</span>
          <span className="up">holds → {next === null ? '–' : fmtPct(a.ifHolds[next])}</span>
          <span className="down">snaps → {next === null ? '–' : fmtPct(a.ifSnaps[next])}</span>
        </div>
        <p className={'message ' + tone} aria-live="polite">
          {message}
        </p>

        {state.history.length > 0 && (
          <div className="history" aria-label="Recent rounds">
            {state.history.map((h, i) => (
              <span key={state.history.length - i} className={'hist ' + (h.mult >= 1 ? 'w' : h.mult > 0 ? 'p' : 'l')}>
                {formatMultiplier(h.mult)}
              </span>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
