import { formatAmount, formatMultiplier, formatPercent, type BetTicket } from '@originals/game-sdk';
import { RoundOver, useBalance, useHost, useSettings } from '@originals/game-sdk/react';
import { eventMs } from '@originals/game-sdk/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import Tower, { type DropAnim, type ToppleAnim } from './Tower';
import {
  MODES,
  MODE_NAMES,
  RTP,
  drawOffset,
  failingLevel,
  landsSafely,
  nextOdds,
  stopReason,
  type Mode,
} from './math';

type Phase = 'idle' | 'dropping' | 'checkpoint' | 'toppling' | 'over';

interface Round {
  bet: number;
  mode: Mode;
  xs: number[];
  ps: number[];
  /** Cash-out multiplier now: RTP × Π 1/p. */
  mult: number;
}

const MODE_LABEL: Record<Mode, string> = { low: 'Low', medium: 'Med', high: 'High', extreme: 'Max' };

export default function Game() {
  const { wallet, rng, track } = useHost();
  const balance = useBalance();
  const host = useSettings();

  const [mode, setMode] = useState<Mode>('medium');
  const [betText, setBetText] = useState('1.00');
  const [autoText, setAutoText] = useState('');
  const [localTurbo, setLocalTurbo] = useState(false);
  const turbo = host.turbo || localTurbo;

  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [drop, setDrop] = useState<DropAnim | null>(null);
  const [topple, setTopple] = useState<ToppleAnim | null>(null);
  const [result, setResult] = useState<{ mult: number; win: boolean; amount: number } | null>(null);
  const [history, setHistory] = useState<{ mult: number; win: boolean }[]>([]);

  const ticket = useRef<BetTicket | null>(null);
  const placing = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // What the open bet is worth if the game is closed now (the outcome of a drop
  // in flight is already decided).
  // It is set synchronously at every transition (RTP when a bet is placed, then
  // the decided result of each drop as it starts), never derived from rendered
  // state, so it can't be one render stale.
  const banked = useRef(0);
  const mounted = useRef(true);

  const later = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      timers.current.forEach(clearTimeout);
      const t = ticket.current;
      ticket.current = null;
      if (t) void t.settle(banked.current);
    };
  }, []);

  const spec = MODES[round?.mode ?? mode];
  const xs = round?.xs ?? [];
  const odds = nextOdds(xs, spec.s);
  const inRound = phase === 'dropping' || phase === 'checkpoint' || phase === 'toppling';
  const bet = parseFloat(betText) || 0;
  const autoTarget = parseFloat(autoText) || 0;
  // A drop is a swing then a fall: about one event (docs/STYLE.md) in all, quicker with Turbo.
  const swingMs = eventMs(turbo, 700);
  const fallMs = eventMs(turbo, 300);

  // Settles the bet. A loss settles as the topple starts; the fall is only the show.
  const finish = useCallback(
    (r: Round, m: number, phase: Phase = 'over') => {
      const t = ticket.current;
      ticket.current = null;
      banked.current = 0;
      if (t) void t.settle(m);
      setPhase(phase);
      setResult({ mult: m, win: m > 0, amount: r.bet * m });
      setHistory((h) => [{ mult: m, win: m > 0 }, ...h].slice(0, 8));
    },
    [],
  );

  const cashOut = useCallback(
    (r: Round) => {
      finish(r, r.mult);
    },
    [finish],
  );

  const dropNext = useCallback(
    (r: Round) => {
      const { s } = MODES[r.mode];
      const o = nextOdds(r.xs, s);
      const d = drawOffset(s, rng.next());
      const safe = landsSafely(o, d);
      const top = r.xs.length ? r.xs[r.xs.length - 1] : 0;
      const nextXs = [...r.xs, top + d];
      banked.current = safe ? r.mult / o.p : 0;
      setPhase('dropping');
      setDrop({ d, t0: performance.now(), swingMs, fallMs });

      later(swingMs + fallMs, () => {
        setDrop(null);
        if (!safe) {
          const fail = failingLevel(nextXs) ?? { level: r.xs.length, dir: d > 0 ? 1 : -1 };
          const lost: Round = { ...r, xs: nextXs, ps: [...r.ps, o.p] };
          setRound(lost);
          const ms = eventMs(turbo, 800);
          setTopple({ ...fail, t0: performance.now(), ms });
          finish(lost, 0, 'toppling');
          later(ms, () => setPhase('over'));
          return;
        }
        const next: Round = { ...r, xs: nextXs, ps: [...r.ps, o.p], mult: r.mult / o.p };
        setRound(next);
        const after = nextOdds(nextXs, s);
        const reason = stopReason(r.mode, nextXs.length, next.mult, after.p);
        if (reason) {
          cashOut(next);
          return;
        }
        track({ type: 'checkpoint', multiplier: next.mult, winChance: after.p });
        setPhase('checkpoint');
      });
    },
    [rng, swingMs, fallMs, turbo, finish, cashOut, track],
  );

  const start = useCallback(async () => {
    if (placing.current || ticket.current) return;
    placing.current = true;
    let placed: BetTicket;
    try {
      placed = await wallet.placeBet(bet);
    } catch {
      return;
    } finally {
      placing.current = false;
    }
    // Closed while the bet was being placed: no round was started or drawn, so return the stake.
    if (!mounted.current) {
      void placed.settle(1);
      return;
    }
    ticket.current = placed;
    banked.current = RTP;
    const r: Round = { bet, mode, xs: [], ps: [], mult: RTP };
    setRound(r);
    setTopple(null);
    setResult(null);
    dropNext(r);
  }, [wallet, bet, mode, dropNext]);

  // Auto mode: keep dropping until the cash-out reaches the target.
  useEffect(() => {
    if (phase !== 'checkpoint' || !round || autoTarget <= 1) return;
    const id = setTimeout(() => (round.mult >= autoTarget ? cashOut(round) : dropNext(round)), turbo ? 150 : 450);
    return () => clearTimeout(id);
  }, [phase, round, autoTarget, turbo, cashOut, dropNext]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.composedPath()[0] as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'BUTTON') return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (phase === 'idle' || phase === 'over') void start();
        else if (phase === 'checkpoint' && round) dropNext(round);
      } else if (e.key.toLowerCase() === 'c' && phase === 'checkpoint' && round) {
        cashOut(round);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, round, start, dropNext, cashOut]);

  // Clears a finished round back to an empty board.
  const clear = () => {
    if (phase !== 'over') return;
    setPhase('idle');
    setRound(null);
    setTopple(null);
    setResult(null);
  };

  const pickMode = (m: Mode) => {
    setMode(m);
    clear();
  };

  const showRail = phase === 'idle' || phase === 'dropping' || phase === 'checkpoint';
  const nextMult = (round && phase !== 'idle' ? round.mult : RTP) / (odds.p || 1);
  const height = xs.length;
  const over = (phase === 'over' || phase === 'toppling') && result;
  const betInvalid = !(bet > 0) || bet > balance;

  return (
    <div className="ovh">
      <aside className="panel">
        <div className="field">
          <span>Bet amount</span>
          <div className="bet-row">
            <input
              value={betText}
              inputMode="decimal"
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
          <span className="field-head">
            Volatility
          </span>
          <div className="segmented">
            {MODE_NAMES.map((m) => (
              <button key={m} className={m === mode ? 'on' : ''} disabled={inRound} onClick={() => pickMode(m)}>
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          <span className="field-head">
            Auto cash-out <em>{autoTarget > 1 ? 'drops for you' : 'off'}</em>
          </span>
          <div className="auto-row">
            <input
              value={autoText}
              placeholder="Off"
              inputMode="decimal"
              disabled={inRound}
              onChange={(e) => setAutoText(e.target.value)}
              onBlur={() => setAutoText((v) => (parseFloat(v) > 1 ? (parseFloat(v) || 0).toFixed(2) : ''))}
            />
            <span>×</span>
          </div>
        </label>

        {phase === 'checkpoint' && round ? (
          <>
            {/* Drop next sits where Bet was, so pressing the same spot keeps the round going; Cash out is below. */}
            <button className="secondary" onClick={() => dropNext(round)}>
              Drop next
            </button>
            <button className="primary cash" onClick={() => cashOut(round)}>
              Cash out <b>{formatAmount(round.bet * round.mult, 2)}</b>
            </button>
          </>
        ) : (
          <button className="primary" disabled={inRound || betInvalid} onClick={() => void start()}>
            {phase === 'dropping' ? 'Dropping…' : phase === 'toppling' ? 'Toppling…' : phase === 'over' ? 'Bet again' : 'Bet'}
          </button>
        )}

        <label className="toggle">
          <input type="checkbox" checked={turbo} disabled={host.turbo} onChange={(e) => setLocalTurbo(e.target.checked)} />
          <span>Turbo</span>
        </label>

        <dl className="stats">
          <div>
            <dt>Max win</dt>
            <dd>{formatMultiplier(spec.cap)}</dd>
          </div>
        </dl>
      </aside>

      <section className="stage">
        <header className="hud">
          <div className="hud-height">
            <span>Height</span>
            <b>
              {height}
              <small>/{spec.maxHeight}</small>
            </b>
          </div>
          <div className="history" aria-label="Recent results">
            {history.map((h, i) => (
              <span key={history.length - i} className={h.win ? 'w' : 'l'}>
                {formatMultiplier(h.mult)}
              </span>
            ))}
          </div>
        </header>

        <div className="readout">
          <div>
            <span>Next drop stands</span>
            <b className="win">{showRail ? formatPercent(odds.p) : '–'}</b>
          </div>
          <div>
            <span>Next multiplier</span>
            <b>{showRail ? formatMultiplier(nextMult) : '–'}</b>
          </div>
        </div>

        <div className="tower-wrap">
          <Tower
            xs={xs}
            s={spec.s}
            rail={showRail ? odds : null}
            drop={drop}
            topple={topple}
            glow={over ? (result.win ? 'win' : 'lose') : null}
          />
          {phase === 'over' && result && round && (
            <RoundOver
              key={history.length}
              placement="top"
              title={result.win ? `Cashed out · ${height} ${height === 1 ? 'block' : 'blocks'} high` : `Toppled on block ${height}`}
              multiplier={result.mult}
              stake={round.bet}
              nextBet={bet}
              blocked={bet > balance ? 'Not enough balance' : !(bet > 0) ? 'Enter a valid bet' : undefined}
              onBetAgain={() => void start()}
              onClear={clear}
            />
          )}
        </div>

        <p className="og-caption">Win if the dropped block’s centre lands in the green.</p>
      </section>
    </div>
  );
}
