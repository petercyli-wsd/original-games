import { InsufficientFundsError, formatAmount, formatMultiplier, formatPercent, type BetTicket } from '@originals/game-sdk';
import { useBalance, useHost, useSettings } from '@originals/game-sdk/react';
import { useEffect, useRef, useState } from 'react';
import Board, { type Blade } from './Board';
import InfoModal from './InfoModal';
import {
  CUT_OPTIONS,
  DEFAULT_CUTS,
  MODES,
  MODE_NAMES,
  RTP,
  cashMultiplier,
  chord,
  clampCentre,
  cutRound,
  inCircle,
  isWin,
  newRound,
  radiusFor,
  sampleCut,
  type Mode,
  type Pt,
  type Round,
} from './math';

type Phase = 'idle' | 'cutting' | 'checkpoint' | 'over';
type Tone = 'neutral' | 'win' | 'lose';

/** How a finished round ended: its outcome, or the player cashing out. */
type Ending = { kind: 'cashout' | 'covered' | 'missed' | 'hit' | 'miss'; mult: number };

const MODE_LABEL: Record<Mode, string> = { low: 'Low', medium: 'Medium', high: 'High', extreme: 'Extreme' };

/** A percentage that never rounds a live chance to a misleading 0% or 100%. */
function pct(x: number, digits: number) {
  const floor = 10 ** -(digits + 2);
  if (x > 0 && x < floor) return `<${formatPercent(floor, digits)}`;
  if (x < 1 && x > 1 - floor) return `>${formatPercent(1 - floor, digits)}`;
  return formatPercent(x, digits);
}

/** Eases a displayed number toward its target. */
function useTween(target: number, ms: number) {
  const [value, setValue] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    const from = current.current;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / Math.max(ms, 1));
      current.current = from + (target - from) * (1 - (1 - t) ** 3);
      setValue(current.current);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // Background tabs throttle frames: make sure the final value always lands.
    const done = setTimeout(() => {
      cancelAnimationFrame(raf);
      current.current = target;
      setValue(target);
    }, ms + 50);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(done);
    };
  }, [target, ms]);
  return value;
}

export default function App() {
  const { wallet, rng, track } = useHost();
  const balance = useBalance();
  const host = useSettings();

  const [mode, setMode] = useState<Mode>('medium');
  const [maxCuts, setMaxCuts] = useState<number>(DEFAULT_CUTS);
  const [centre, setCentre] = useState<Pt>({ x: 0.5, y: 0.5 });
  const [betText, setBetText] = useState('1.00');
  const [localTurbo, setLocalTurbo] = useState(false);
  const [auto, setAuto] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [blade, setBlade] = useState<Blade | null>(null);
  const [ending, setEnding] = useState<Ending | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: Tone }>({
    text: 'Drag your circle anywhere, pick a size, and bet.',
    tone: 'neutral',
  });

  const turbo = localTurbo || host.turbo;
  const bladeMs = turbo ? 140 : 420;
  const fallMs = turbo ? 200 : 560;
  const autoPauseMs = turbo ? 140 : 520;

  // Latest values for timer callbacks and the unmount cleanup.
  const ticket = useRef<BetTicket | null>(null);
  const placing = useRef(false);
  const roundRef = useRef<Round | null>(null);
  const autoRef = useRef(auto);
  autoRef.current = auto;
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const later = (ms: number, fn: () => void) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(fn, ms);
  };

  // Leaving mid-round cashes out at the current value, M × P (fair at any point).
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      if (ticket.current && roundRef.current) void ticket.current.settle(cashMultiplier(roundRef.current));
    },
    [],
  );

  const show = (r: Round | null) => {
    roundRef.current = r;
    setRound(r);
  };

  function finish(r: Round, end: Ending) {
    const t = ticket.current;
    ticket.current = null;
    setPhase('over');
    setEnding(end);
    const prize = formatMultiplier(end.mult);
    const text = {
      cashout: `Cashed out at ${prize}. The dot was ${inCircle(r.circle, r.dot) ? 'inside' : 'outside'} your circle.`,
      covered: `Everything left is inside your circle. You win ${prize}!`,
      missed: 'Your circle has been sliced away. The dot was elsewhere.',
      hit: `Revealed: the dot is inside your circle. You win ${prize}!`,
      miss: 'Revealed: the dot is outside your circle.',
    }[end.kind];
    setMessage({ text, tone: end.mult > 0 ? 'win' : 'lose' });
    if (t) void t.settle(end.mult);
    show(r);
  }

  function cut(r: Round) {
    const c = sampleCut(r.region, rng);
    const [from, to] = chord(r.region, c);
    setBlade({ from, to, id: r.slices.length + 1 });
    setPhase('cutting');
    later(bladeMs, () => {
      const next = cutRound(r, c);
      show(next);
      later(fallMs, () => {
        setBlade(null);
        if (next.outcome !== 'live') {
          finish(next, { kind: next.outcome as Ending['kind'], mult: cashMultiplier(next) });
          return;
        }
        const mult = cashMultiplier(next);
        track({ type: 'checkpoint', multiplier: mult, winChance: next.chance });
        setPhase('checkpoint');
        setMessage({
          text: `The dot is on the bright side. Cash out ${formatMultiplier(mult)} or cut again.`,
          tone: 'neutral',
        });
        if (autoRef.current) later(autoPauseMs, () => cut(next));
      });
    });
  }

  const bet = parseFloat(betText) || 0;
  const betInvalid = !(bet > 0) || bet > balance;

  async function start() {
    if (placing.current || ticket.current) return;
    placing.current = true;
    try {
      ticket.current = await wallet.placeBet(bet);
    } catch (err) {
      setMessage({ text: err instanceof InsufficientFundsError ? 'Not enough balance.' : 'Enter a valid bet.', tone: 'lose' });
      return;
    } finally {
      placing.current = false;
    }
    // The dot is drawn up front, uniformly in the square, and never shown until the end.
    const r = newRound(mode, centre, maxCuts, { x: rng.next(), y: rng.next() });
    setEnding(null);
    setMessage({ text: 'Slicing…', tone: 'neutral' });
    show(r);
    cut(r);
  }

  const cashOut = () => {
    const r = roundRef.current;
    if (phase !== 'checkpoint' || !r) return;
    clearTimeout(timer.current);
    setAuto(false);
    finish(r, { kind: 'cashout', mult: cashMultiplier(r) });
  };

  const cutAgain = () => {
    if (phase === 'checkpoint' && roundRef.current) cut(roundRef.current);
  };

  // Settings changes after a round clear its board back to a fresh preview.
  const reset = () => {
    if (phase !== 'over') return;
    setPhase('idle');
    show(null);
    setEnding(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.composedPath()[0] as HTMLElement;
      if (infoOpen || target.tagName === 'INPUT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (phase === 'idle' || phase === 'over') {
          if (!betInvalid) void start();
        } else cutAgain();
      } else if (e.key.toLowerCase() === 'c') cashOut();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const inRound = phase === 'cutting' || phase === 'checkpoint';
  const r = radiusFor(mode);
  const preview = newRound(mode, centre, maxCuts, { x: 0, y: 0 });
  const shown = round ?? preview;
  const stake = ticket.current?.amount ?? bet;
  const prize = shown.mult;
  const cashMult = phase === 'checkpoint' && round ? cashMultiplier(round) : 0;
  // Once the dot is known the chance snaps to 100% or 0% (a cash-out keeps the last value).
  const chance = phase === 'over' && ending && ending.kind !== 'cashout' ? (isWin(ending.kind) ? 1 : 0) : shown.chance;
  const shownChance = useTween(chance, fallMs);
  const tone: Tone = phase === 'over' && ending ? (ending.mult > 0 ? 'win' : 'lose') : 'neutral';

  let main: { label: string; action: () => void; disabled: boolean } = { label: 'Bet', action: () => void start(), disabled: betInvalid };
  if (phase === 'cutting') main = { label: 'Slicing…', action: () => {}, disabled: true };
  if (phase === 'checkpoint') main = { label: `Cash out ${formatAmount(stake * cashMult, 2)}`, action: cashOut, disabled: false };

  return (
    <div className="slice">
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
            Circle size <em>smaller pays more</em>
          </span>
          <div className="sizes">
            {MODE_NAMES.map((m) => (
              <button
                key={m}
                className={m === mode ? 'on' : ''}
                disabled={inRound}
                onClick={() => {
                  reset();
                  setMode(m);
                  setCentre((c) => clampCentre(c, radiusFor(m)));
                }}
              >
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <rect x="1" y="1" width="18" height="18" rx="2" />
                  <circle cx="10" cy="10" r={radiusFor(m) * 18} />
                </svg>
                <span>{MODE_LABEL[m]}</span>
                <b>{formatMultiplier(MODES[m].mult)}</b>
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="label">
            Cuts <em>before the reveal</em>
          </span>
          <div className="segmented">
            {CUT_OPTIONS.map((n) => (
              <button
                key={n}
                className={n === maxCuts ? 'on' : ''}
                disabled={inRound}
                onClick={() => {
                  reset();
                  setMaxCuts(n);
                }}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <button className="primary" disabled={main.disabled} onClick={main.action}>
          {main.label}
        </button>
        {inRound && (
          <button className="secondary" disabled={phase !== 'checkpoint'} onClick={cutAgain}>
            {auto ? 'Auto-cutting…' : `Cut again · ${(round?.slices.length ?? 0) + 1} of ${shown.maxCuts}`}
          </button>
        )}

        <div className="toggles">
          <label className="toggle">
            <input
              type="checkbox"
              checked={auto}
              onChange={(e) => {
                setAuto(e.target.checked);
                autoRef.current = e.target.checked;
                if (e.target.checked) cutAgain();
              }}
            />
            <i />
            <span>Auto-cut</span>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={turbo} disabled={host.turbo} onChange={(e) => setLocalTurbo(e.target.checked)} />
            <i />
            <span>Turbo</span>
          </label>
        </div>

        <dl className="stats">
          <div>
            <dt>Circle covers</dt>
            <dd>{formatPercent(Math.PI * r * r)}</dd>
          </div>
          <div>
            <dt>Max prize</dt>
            <dd>{formatAmount(stake * MODES[mode].mult, 2)}</dd>
          </div>
          <div>
            <dt>Balance</dt>
            <dd>{formatAmount(balance, 2)}</dd>
          </div>
        </dl>
        <button className="link" onClick={() => setInfoOpen(true)}>
          <span className="i">i</span> How to play
        </button>
      </aside>

      <section className="stage">
        <div className="readout">
          <div className={'chance ' + tone}>
            <span className="label">Win chance</span>
            <b>{pct(shownChance, 1)}</b>
            <div className="odds" aria-hidden="true">
              <i style={{ width: `${shownChance * 100}%` }} />
            </div>
          </div>
          <div className="tile">
            <span className="label">Cash out</span>
            <b>{phase === 'checkpoint' ? formatAmount(stake * cashMult, 2) : '–'}</b>
            <small>{phase === 'checkpoint' ? formatMultiplier(cashMult) : 'after a cut'}</small>
          </div>
          <div className="tile">
            <span className="label">If inside</span>
            <b>{formatAmount(stake * prize, 2)}</b>
            <small>{formatMultiplier(prize)}</small>
          </div>
        </div>

        <div className="board-wrap">
          <Board
            circle={shown.circle}
            region={shown.region}
            slices={shown.slices}
            blade={blade}
            dot={phase === 'over' ? shown.dot : null}
            dotTone={ending?.kind === 'cashout' ? 'neutral' : tone}
            editable={!inRound}
            showHandle={phase === 'idle'}
            onMove={(p) => {
              reset();
              setCentre(clampCentre(p, r));
            }}
            bladeMs={bladeMs}
            fallMs={fallMs}
          />
          {phase === 'idle' && <div className="hint">Drag to place your circle · the odds don't change</div>}
        </div>

        <ol className="ladder" aria-label="Win chance after each cut">
          {Array.from({ length: shown.maxCuts }, (_, i) => {
            const s = shown.slices[i];
            const prev = i === 0 ? shown.circle.r ** 2 * Math.PI : shown.slices[i - 1]?.chance;
            const next = inRound && i === shown.slices.length;
            const trend = s && prev !== undefined ? (s.chance > prev + 1e-9 ? ' up' : s.chance < prev - 1e-9 ? ' down' : '') : '';
            const last = i === shown.maxCuts - 1;
            return (
              <li key={i} className={(s ? 'done' + trend : '') + (next ? ' next' : '')}>
                <span>Cut {i + 1}</span>
                <b>{s ? pct(s.chance, s.chance < 0.1 ? 1 : 0) : '–'}</b>
                <small>{last ? 'then reveal' : s ? formatMultiplier(shown.mult * s.chance) : ''}</small>
              </li>
            );
          })}
        </ol>

        <div className="outcome" aria-live="polite">
          {phase === 'over' && ending && (
            <span className={'result ' + tone} key={round?.dot.x}>
              <b>{ending.mult > 0 ? formatMultiplier(ending.mult) : ending.kind === 'missed' ? 'Sliced away' : 'Missed'}</b>
              <span>
                {ending.mult > 0 ? '+' : '−'}
                {formatAmount(Math.abs(stake * ending.mult - stake), 2)}
              </span>
            </span>
          )}
          <p className={'message ' + message.tone}>{message.text}</p>
        </div>
      </section>

      {infoOpen && <InfoModal rtp={RTP} onClose={() => setInfoOpen(false)} />}
    </div>
  );
}
