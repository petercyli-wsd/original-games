import { cashMultiplier, type AutoRules } from '../math';
import type { Outcome, Phase } from '../round';
import { fmtChance, fmtMult, fmtPct } from '../format';

interface Props {
  W: number;
  x0: number;
  path: number[];
  checkpoints: number[];
  rules: AutoRules;
  phase: Phase;
  outcome: Outcome | null;
  stepMs: number;
}

const QUARTERS = [0, 0.25, 0.5, 0.75, 1];
const at = (x: number, W: number) => `${(x / W) * 100}%`;

/**
 * The corridor. Horizontal position is everything: the top scale reads it as a
 * win chance, the bottom scale as a cash-out multiplier, and the trace below
 * the rail is the same position over time (newest step at the top).
 */
export default function Field({ W, x0, path, checkpoints, rules, phase, outcome, stepMs }: Props) {
  const x = path[path.length - 1];
  const prize = cashMultiplier(W, x0);
  // Rows of history shown: enough that short tracks don't flatten into a zigzag.
  const rows = Math.max(30, 2 * W);
  const tail = path.slice(-(rows + 1));
  const first = path.length - tail.length;
  const points = tail.map((p, i) => `${p},${tail.length - 1 - i}`).join(' ');
  const trail = path.slice(-7, -1);
  const motion = { transitionDuration: `${Math.round(stepMs * 0.9)}ms` };
  const ended = outcome === 'win' ? 'win' : outcome === 'lose' ? 'lose' : '';
  const live = phase === 'running' || phase === 'paused';

  return (
    <div className={`field ${ended} ${live ? 'live' : ''}`} style={{ ['--w' as string]: W }}>
      <div className="wall red" aria-hidden />
      <div className="wall green" aria-hidden />

      <div className="lane">
        <div className="scale top" aria-hidden>
          {QUARTERS.map((q) => (
            <span key={q} style={{ left: `${q * 100}%` }}>
              {fmtPct(q, 0)}
            </span>
          ))}
        </div>

        <div className="rail">
          <div className="marker start" style={{ left: at(x0, W) }} title="Start" />
          {rules.takeProfit !== null && rules.takeProfit < W && <div className="marker tp" style={{ left: at(rules.takeProfit, W) }} title="Take profit" />}
          {rules.stopLoss !== null && rules.stopLoss > 0 && <div className="marker sl" style={{ left: at(rules.stopLoss, W) }} title="Stop loss" />}
          {trail.map((p, i) => (
            <i key={path.length - trail.length + i} className="ghost-dot" style={{ left: at(p, W), opacity: ((i + 1) / (trail.length + 1)) * 0.5 }} />
          ))}
        </div>

        <div className="trace-box">
          <svg className="trace" viewBox={`0 0 ${W} ${rows}`} preserveAspectRatio="none" aria-hidden>
            <defs>
              <linearGradient id="drift-ink" gradientUnits="userSpaceOnUse" x1={0} x2={W} y1={0} y2={0}>
                <stop offset="0" style={{ stopColor: 'var(--red)' }} />
                <stop offset="0.5" style={{ stopColor: 'var(--gold)' }} />
                <stop offset="1" style={{ stopColor: 'var(--green)' }} />
              </linearGradient>
            </defs>
            {QUARTERS.slice(1, -1).map((q) => (
              <line key={q} className="grid" x1={q * W} x2={q * W} y1={0} y2={rows} />
            ))}
            <line className="level start" x1={x0} x2={x0} y1={0} y2={rows} />
            {rules.takeProfit !== null && rules.takeProfit < W && <line className="level tp" x1={rules.takeProfit} x2={rules.takeProfit} y1={0} y2={rows} />}
            {rules.stopLoss !== null && rules.stopLoss > 0 && <line className="level sl" x1={rules.stopLoss} x2={rules.stopLoss} y1={0} y2={rows} />}
            {checkpoints
              .filter((c) => c >= first)
              .map((c) => (
                <line key={c} className="checkpoint" x1={path[c] - W * 0.025} x2={path[c] + W * 0.025} y1={path.length - 1 - c} y2={path.length - 1 - c} />
              ))}
            {tail.length > 1 && <polyline className="ink" points={points} />}
          </svg>
          {path.length === 1 && phase === 'idle' && <p className="trace-hint">Place a bet to release the dot. Its path is drawn here.</p>}
        </div>

        <div className="scale bottom" aria-hidden>
          {QUARTERS.map((q) => (
            <span key={q} style={{ left: `${q * 100}%` }}>
              {fmtMult(prize * q)}
            </span>
          ))}
        </div>

        {/* The needle: the dot on the rail, a hairline through the trace, and the cash-out value at the bottom. */}
        <div className="needle" style={{ left: at(x, W), ...motion }}>
          <span className="chance">{fmtChance(x, W)}</span>
          <span className="dot" />
          <span className="hair" />
          <span className="value">{fmtMult(cashMultiplier(x, x0))}</span>
        </div>
      </div>
    </div>
  );
}
