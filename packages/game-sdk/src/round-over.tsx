import { useEffect, useRef } from 'react';
import { formatAmount, formatMultiplier } from './money';
import { useHost } from './react';

export interface RoundOverProps {
  /** What happened, e.g. "Connected" or "Toppled". */
  title: string;
  /** The multiplier the round settled at. */
  multiplier: number;
  /** The settled round's stake, for the net result. */
  stake: number;
  /** The stake the next round will use (the current bet input). */
  nextBet: number;
  /** Why the next bet can't be placed, e.g. "Not enough balance". Disables Bet again. */
  blocked?: string;
  onBetAgain: () => void;
  /** Clears the finished board back to a fresh one. */
  onClear: () => void;
  /** Where the card sits in its (position: relative) parent. `inline` flows in the layout. */
  placement?: 'top' | 'center' | 'bottom' | 'inline';
}

/**
 * The end-of-round card: the result, plus a way straight into the next round
 * (Bet again, or Space) or back to a fresh board (Clear board, or Esc). It stays
 * until the player acts, so a finished round is never a dead end.
 *
 * Colours come from `--og-green`, `--og-red` and `--og-gold`; a game can override
 * them with `--round-over-win`, `--round-over-even` and `--round-over-lose`.
 */
export function RoundOver({ title, multiplier, stake, nextBet, blocked, onBetAgain, onClear, placement = 'center' }: RoundOverProps) {
  const { wallet } = useHost();
  const again = useRef<HTMLButtonElement>(null);
  const tone = multiplier >= 1 ? 'win' : multiplier > 0 ? 'even' : 'lose';
  const net = stake * multiplier - stake;

  // Focus the next step, so Enter/Space replays and screen readers hear the result.
  useEffect(() => again.current?.focus({ preventScroll: true }), []);

  const clear = useRef(onClear);
  clear.current = onClear;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && clear.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={`og-round-over ${placement} ${tone}`} role="status">
      <style>{CSS}</style>
      <div className="og-ro-result">
        <span className="og-ro-title">{title}</span>
        <b className="og-ro-mult">{formatMultiplier(multiplier)}</b>
        <span className="og-ro-net">
          {net >= 0 ? '+' : '−'}
          {formatAmount(Math.abs(net), 2)} {wallet.currency}
        </span>
      </div>
      <div className="og-ro-actions">
        <button ref={again} className="og-ro-again" disabled={!!blocked} onClick={onBetAgain}>
          Bet again <span>{formatAmount(nextBet, 2)}</span>
        </button>
        <button className="og-ro-clear" onClick={onClear}>
          Clear board
        </button>
      </div>
      <span className="og-ro-hint">{blocked ?? 'Space to bet again · Esc to clear'}</span>
    </div>
  );
}

const CSS = `
.og-round-over {
  --c: var(--round-over-even, var(--og-gold, #f5a623));
  position: absolute;
  left: 50%;
  z-index: 5;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  width: max-content;
  max-width: calc(100% - 24px);
  padding: 14px 16px 10px;
  box-sizing: border-box;
  font-family: var(--og-font, system-ui, sans-serif);
  color: var(--og-text, #f6f6f6);
  text-align: center;
  background: rgba(16, 16, 22, 0.92);
  border: 1.5px solid var(--c);
  border-radius: var(--og-radius-lg, 12px);
  backdrop-filter: blur(6px);
  box-shadow: 0 16px 44px rgba(0, 0, 0, 0.5), 0 0 36px -14px var(--c);
  transform: translateX(-50%);
  animation: og-ro-in 0.3s cubic-bezier(0.2, 0.8, 0.3, 1.2) both;
}
.og-round-over.win { --c: var(--round-over-win, var(--og-green, #00e701)); }
.og-round-over.lose { --c: var(--round-over-lose, var(--og-red, #e9113c)); }
.og-round-over.top { top: 16px; }
.og-round-over.bottom { bottom: 12px; }
.og-round-over.center { top: 50%; transform: translate(-50%, -50%); animation-name: og-ro-in-center; }
.og-ro-result {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

/* Inline: a compact bar that flows in the layout instead of covering the board. */
.og-round-over.inline {
  position: relative;
  left: auto;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px 20px;
  max-width: 100%;
  margin: 0 auto;
  padding: 10px 12px 10px 18px;
  transform: none;
  animation-name: og-ro-in-inline;
}
.og-round-over.inline .og-ro-result {
  display: grid;
  grid-template-columns: auto auto;
  align-items: baseline;
  column-gap: 10px;
  text-align: left;
}
.og-round-over.inline .og-ro-title { grid-column: 1 / -1; }
.og-round-over.inline .og-ro-mult { font-size: 24px; }
.og-round-over.inline .og-ro-actions { margin-top: 0; align-items: center; }
.og-round-over.inline .og-ro-hint { display: none; }

.og-ro-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--c);
}
.og-ro-mult {
  font-size: 30px;
  font-weight: 800;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
  color: var(--c);
}
.og-ro-net {
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--og-text-muted, #aaa7b2);
}
.og-ro-actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
.og-ro-actions button {
  height: 38px;
  padding: 0 14px;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
  border-radius: var(--og-radius, 8px);
  cursor: pointer;
  transition: filter 0.15s, background 0.15s;
}
.og-ro-again {
  color: var(--og-text-on-accent, #07070b);
  background: var(--og-green, #00e701);
  border: 0;
}
.og-ro-again span {
  margin-left: 4px;
  font-variant-numeric: tabular-nums;
  opacity: 0.7;
}
.og-ro-again:hover:not(:disabled) { filter: brightness(1.1); }
.og-ro-again:disabled { opacity: 0.4; cursor: not-allowed; }
.og-ro-clear {
  color: var(--og-text, #f6f6f6);
  background: var(--og-bg-raised, #15151c);
  border: 1px solid var(--og-border, rgba(255, 255, 255, 0.14));
}
.og-ro-clear:hover { background: var(--og-bg-hover, #21212a); }
.og-ro-actions button:focus-visible { outline: 2px solid var(--og-text, #f6f6f6); outline-offset: 2px; }
.og-ro-hint {
  margin-top: 6px;
  font-size: 11px;
  color: var(--og-text-muted, #aaa7b2);
}

@keyframes og-ro-in { from { opacity: 0; transform: translateX(-50%) translateY(6px) scale(0.94); } }
@keyframes og-ro-in-center { from { opacity: 0; transform: translate(-50%, -46%) scale(0.94); } }
@keyframes og-ro-in-inline { from { opacity: 0; transform: translateY(6px) scale(0.94); } }
@media (prefers-reduced-motion: reduce) { .og-round-over { animation: none; } }
@media (max-width: 420px) {
  .og-ro-mult { font-size: 24px; }
  .og-ro-actions button { padding: 0 10px; }
}
`;
