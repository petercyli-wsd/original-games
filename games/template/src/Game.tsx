import { InsufficientFundsError, formatAmount, formatMultiplier, formatPercent, type BetTicket } from '@originals/game-sdk';
import { useBalance, useHost, useSettings } from '@originals/game-sdk/react';
import { useEffect, useRef, useState } from 'react';
import { MODES, MODE_NAMES, multiplierAt, type Mode } from './math';

type Phase = 'idle' | 'spinning' | 'checkpoint';

const R = 90;
const CENTER = 110;

// SVG arc from the top of the circle, clockwise, covering `fraction` of it.
function arcPath(fraction: number) {
  const a = Math.min(fraction, 0.9999) * 2 * Math.PI;
  const x = CENTER + R * Math.sin(a);
  const y = CENTER - R * Math.cos(a);
  return `M ${CENTER} ${CENTER - R} A ${R} ${R} 0 ${fraction > 0.5 ? 1 : 0} 1 ${x} ${y}`;
}

export default function Game() {
  const { wallet, rng, track } = useHost();
  const balance = useBalance();
  const { turbo } = useSettings();

  const [mode, setMode] = useState<Mode>('medium');
  const [betText, setBetText] = useState('1.00');
  const [phase, setPhase] = useState<Phase>('idle');
  const [steps, setSteps] = useState(0);
  const [angle, setAngle] = useState(0);
  const [message, setMessage] = useState<{ text: string; tone: 'neutral' | 'win' | 'lose' }>({
    text: 'Pick a volatility and place a bet.',
    tone: 'neutral',
  });
  const ticket = useRef<BetTicket | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(timer.current), []);

  const { p, maxSteps } = MODES[mode];
  const inRound = phase !== 'idle';
  const spinMs = turbo ? 250 : 900;

  async function settle(multiplier: number, text: string, tone: 'win' | 'lose') {
    const t = ticket.current;
    ticket.current = null;
    setPhase('idle');
    setMessage({ text, tone });
    if (t) await t.settle(multiplier);
  }

  function spin(currentSteps: number) {
    setPhase('spinning');
    const u = rng.next();
    const win = u < p;
    // The needle lands at u of the way round; the green arc covers [0, p).
    setAngle((prev) => prev + 1080 + ((u * 360 - (prev % 360) + 360) % 360));
    timer.current = setTimeout(() => {
      if (!win) {
        void settle(0, 'Missed the arc.', 'lose');
        return;
      }
      const next = currentSteps + 1;
      const mult = multiplierAt(mode, next);
      setSteps(next);
      if (next >= maxSteps) {
        void settle(mult, `Top of the climb! Paid ${formatMultiplier(mult)}`, 'win');
        return;
      }
      track({ type: 'checkpoint', multiplier: mult, winChance: p });
      setPhase('checkpoint');
      setMessage({ text: `In the arc. Cash out ${formatMultiplier(mult)} or spin again.`, tone: 'neutral' });
    }, spinMs);
  }

  async function start() {
    try {
      ticket.current = await wallet.placeBet(parseFloat(betText));
    } catch (err) {
      const text = err instanceof InsufficientFundsError ? 'Not enough balance.' : 'Enter a valid bet.';
      setMessage({ text, tone: 'lose' });
      return;
    }
    setSteps(0);
    spin(0);
  }

  const cashMult = multiplierAt(mode, steps);
  const nextMult = multiplierAt(mode, steps + 1);

  return (
    <div className="arc">
      <aside className="panel">
        <label className="field">
          <span>Bet amount</span>
          <input
            value={betText}
            inputMode="decimal"
            disabled={inRound}
            onChange={(e) => setBetText(e.target.value)}
            onBlur={() => setBetText((v) => formatAmount(parseFloat(v) || 0, 2))}
          />
        </label>

        <div className="field">
          <span>Volatility</span>
          <div className="segmented">
            {MODE_NAMES.map((m) => (
              <button key={m} className={m === mode ? 'on' : ''} disabled={inRound} onClick={() => setMode(m)}>
                {m}
              </button>
            ))}
          </div>
        </div>

        {phase === 'checkpoint' ? (
          <>
            <button
              className="primary"
              onClick={() => void settle(cashMult, `Cashed out at ${formatMultiplier(cashMult)}`, 'win')}
            >
              Cash out {formatAmount((ticket.current?.amount ?? 0) * cashMult, 2)}
            </button>
            <button className="secondary" onClick={() => spin(steps)}>
              Spin again → {formatMultiplier(nextMult)}
            </button>
          </>
        ) : (
          <button className="primary" disabled={inRound} onClick={() => void start()}>
            {phase === 'spinning' ? 'Spinning…' : 'Bet'}
          </button>
        )}

        <dl className="stats">
          <div>
            <dt>Win chance / spin</dt>
            <dd>{formatPercent(p, 0)}</dd>
          </div>
          <div>
            <dt>Top prize</dt>
            <dd>{formatMultiplier(multiplierAt(mode, maxSteps))}</dd>
          </div>
          <div>
            <dt>Balance</dt>
            <dd>{formatAmount(balance, 2)}</dd>
          </div>
        </dl>
      </aside>

      <section className="stage">
        <svg viewBox="0 0 220 220" className="dial" role="img" aria-label={`Green arc is ${formatPercent(p, 0)} of the circle`}>
          <circle cx={CENTER} cy={CENTER} r={R} className="track" />
          <path d={arcPath(p)} className="win-arc" />
          <g style={{ transform: `rotate(${angle}deg)`, transitionDuration: `${spinMs}ms` }} className="needle">
            <line x1={CENTER} y1={CENTER} x2={CENTER} y2={CENTER - R + 6} />
            <circle cx={CENTER} cy={CENTER} r={6} />
          </g>
        </svg>

        <ol className="ladder" aria-label="Multiplier ladder">
          {Array.from({ length: maxSteps }, (_, i) => (
            <li key={i} className={i < steps ? 'done' : i === steps && inRound ? 'next' : ''}>
              {formatMultiplier(multiplierAt(mode, i + 1))}
            </li>
          ))}
        </ol>

        <p className={`message ${message.tone}`} aria-live="polite">
          {message.text}
        </p>
      </section>
    </div>
  );
}
