import { formatAmount, formatMultiplier, formatPercent, type BetTicket } from '@originals/game-sdk';
import { useBalance, useHost, useSettings } from '@originals/game-sdk/react';
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
  type StopReason,
} from './math';

type Phase = 'idle' | 'dropping' | 'checkpoint' | 'toppling' | 'over';
type Tone = 'neutral' | 'win' | 'lose';

interface Round {
  bet: number;
  mode: Mode;
  xs: number[];
  ps: number[];
  /** Cash-out multiplier now: RTP × Π 1/p. */
  mult: number;
}

const MODE_LABEL: Record<Mode, string> = { low: 'Low', medium: 'Med', high: 'High', extreme: 'Max' };

const AUTO_MESSAGES: Record<StopReason, string> = {
  height: 'Tower complete!',
  odds: 'Too wobbly for another block: auto cash-out.',
  cap: 'Max win reached.',
};

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
  const [landed, setLanded] = useState<{ t0: number; factor: number } | null>(null);
  const [result, setResult] = useState<{ mult: number; win: boolean; amount: number } | null>(null);
  const [history, setHistory] = useState<{ mult: number; win: boolean }[]>([]);
  const [message, setMessage] = useState<{ text: string; tone: Tone }>({
    text: 'The block’s centre must land in the green. Its share of the bar is your odds.',
    tone: 'neutral',
  });

  const ticket = useRef<BetTicket | null>(null);
  const placing = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // What the open bet is worth if the game is closed now (the outcome of a drop
  // in flight is already decided).
  const banked = useRef(0);

  const later = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      if (ticket.current) void ticket.current.settle(banked.current);
    },
    [],
  );

  const spec = MODES[round?.mode ?? mode];
  const xs = round?.xs ?? [];
  const odds = nextOdds(xs, spec.s);
  const mult = round?.mult ?? 0;
  const inRound = phase === 'dropping' || phase === 'checkpoint' || phase === 'toppling';
  const bet = parseFloat(betText) || 0;
  const autoTarget = parseFloat(autoText) || 0;
  const swingMs = turbo ? 260 : 900;
  const fallMs = turbo ? 140 : 320;

  // Settles the bet. A loss settles as the topple starts; the fall is only the show.
  const finish = useCallback(
    (r: Round, m: number, text: string, phase: Phase = 'over') => {
      const t = ticket.current;
      ticket.current = null;
      banked.current = 0;
      if (t) void t.settle(m);
      setPhase(phase);
      setResult({ mult: m, win: m > 0, amount: r.bet * m });
      setHistory((h) => [{ mult: m, win: m > 0 }, ...h].slice(0, 8));
      setMessage({ text, tone: m > 0 ? 'win' : 'lose' });
    },
    [],
  );

  const cashOut = useCallback(
    (r: Round, reason?: StopReason) => {
      const text = `${reason ? AUTO_MESSAGES[reason] + ' ' : ''}Cashed out at ${formatMultiplier(r.mult)}.`;
      finish(r, r.mult, text);
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
      setMessage({ text: `Dropping… ${formatPercent(o.p)} to stand.`, tone: 'neutral' });

      later(swingMs + fallMs, () => {
        setDrop(null);
        if (!safe) {
          const fail = failingLevel(nextXs) ?? { level: r.xs.length, dir: d > 0 ? 1 : -1 };
          const lost: Round = { ...r, xs: nextXs, ps: [...r.ps, o.p] };
          setRound(lost);
          const ms = turbo ? 650 : 1300;
          setTopple({ ...fail, t0: performance.now(), ms });
          finish(lost, 0, `Block ${nextXs.length} toppled the tower.`, 'toppling');
          later(ms, () => setPhase('over'));
          return;
        }
        const next: Round = { ...r, xs: nextXs, ps: [...r.ps, o.p], mult: r.mult / o.p };
        setRound(next);
        setLanded({ t0: performance.now(), factor: 1 / o.p });
        const after = nextOdds(nextXs, s);
        const reason = stopReason(r.mode, nextXs.length, next.mult, after.p);
        if (reason) {
          cashOut(next, reason);
          return;
        }
        track({ type: 'checkpoint', multiplier: next.mult, winChance: after.p });
        setPhase('checkpoint');
        setMessage({ text: `Standing. Cash out ${formatMultiplier(next.mult)} or drop again.`, tone: 'neutral' });
      });
    },
    [rng, swingMs, fallMs, turbo, finish, cashOut, track],
  );

  const start = useCallback(async () => {
    if (placing.current || ticket.current) return;
    placing.current = true;
    try {
      ticket.current = await wallet.placeBet(bet);
    } catch {
      setMessage({ text: bet > balance ? 'Not enough balance.' : 'Enter a valid bet.', tone: 'lose' });
      return;
    } finally {
      placing.current = false;
    }
    const r: Round = { bet, mode, xs: [], ps: [], mult: RTP };
    banked.current = 0;
    setRound(r);
    setTopple(null);
    setLanded(null);
    setResult(null);
    dropNext(r);
  }, [wallet, bet, balance, mode, dropNext]);

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

  const pickMode = (m: Mode) => {
    setMode(m);
    if (phase === 'over') {
      setPhase('idle');
      setRound(null);
      setTopple(null);
      setResult(null);
    }
  };

  const showRail = phase === 'idle' || phase === 'dropping' || phase === 'checkpoint';
  const nextMult = (round && phase !== 'idle' ? round.mult : RTP) / (odds.p || 1);
  const height = xs.length;
  const over = (phase === 'over' || phase === 'toppling') && result;
  const betInvalid = !(bet > 0) || bet > balance;

  return (
    <div className={`ovh ${phase === 'toppling' ? 'shake' : ''}`}>
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
            Volatility <em>±{spec.s.toFixed(2)} block drift</em>
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
            <button className="primary cash" onClick={() => cashOut(round)}>
              Cash out <b>{formatAmount(round.bet * round.mult, 2)}</b>
            </button>
            <button className="secondary" onClick={() => dropNext(round)}>
              Drop next <span>→ {formatMultiplier(nextMult)}</span>
            </button>
          </>
        ) : (
          <button className="primary" disabled={inRound || betInvalid} onClick={() => void start()}>
            {phase === 'dropping' ? 'Dropping…' : phase === 'toppling' ? 'Toppling…' : 'Bet'}
          </button>
        )}

        <label className="toggle">
          <input type="checkbox" checked={turbo} disabled={host.turbo} onChange={(e) => setLocalTurbo(e.target.checked)} />
          <span>Turbo</span>
          <kbd>Space</kbd> drop · <kbd>C</kbd> cash
        </label>

        <dl className="stats">
          <div>
            <dt>Height cap</dt>
            <dd>{spec.maxHeight} blocks</dd>
          </div>
          <div>
            <dt>Max win</dt>
            <dd>{formatMultiplier(spec.cap)}</dd>
          </div>
          <div>
            <dt>RTP</dt>
            <dd>{formatPercent(RTP, 0)}</dd>
          </div>
          <div>
            <dt>Balance</dt>
            <dd>{formatAmount(balance, 2)}</dd>
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
          <div className={`hud-mult ${over ? (result.win ? 'win' : 'lose') : ''}`}>
            <span>{over ? (result.win ? 'Paid' : 'Lost') : height > 0 ? 'Cash-out' : 'First block pays'}</span>
            <b>{formatMultiplier(over ? result.mult : height > 0 ? mult : nextMult)}</b>
          </div>
          <div className="history" aria-label="Recent results">
            {history.map((h, i) => (
              <span key={history.length - i} className={h.win ? 'w' : 'l'}>
                {formatMultiplier(h.mult)}
              </span>
            ))}
          </div>
        </header>

        <div className="tower-wrap">
          <Tower
            xs={xs}
            ps={round?.ps ?? []}
            s={spec.s}
            rail={showRail ? odds : null}
            drop={drop}
            topple={topple}
            landed={landed}
            glow={over ? (result.win ? 'win' : 'lose') : null}
          />
          {phase === 'toppling' && <div className="flash" />}
          {phase === 'over' && result && (
            <div className={`result ${result.win ? 'win' : 'lose'}`} key={history.length}>
              <b>{result.win ? formatMultiplier(result.mult) : 'Toppled'}</b>
              <span>{result.win ? `+${formatAmount(result.amount, 2)}` : `on block ${xs.length}`}</span>
            </div>
          )}
        </div>

        <div className="readout">
          <div>
            <span>Next drop stands</span>
            <b className="green">{showRail ? formatPercent(odds.p) : '–'}</b>
          </div>
          <div>
            <span>Next multiplier</span>
            <b>{showRail ? formatMultiplier(nextMult) : '–'}</b>
          </div>
          <div className="readout-msg">
            <p className={`message ${message.tone}`} aria-live="polite">
              {message.text}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
