// Shared building blocks for kit-based games. The layout follows the house
// template: controls on the left, the board on the right (stacked, board
// first, when the frame is narrow). Every colour comes from the --og-* theme
// tokens, plus one --accent per game.

import { useEffect, useRef, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react';
import { formatAmount } from '../money';
import { useBalance } from '../react';
import type { Volatility } from '../types';
import { fmtChance, fmtMult } from './format';
import type { BetInput, HistoryItem, TurboState } from './hooks';

export function GameLayout({
  name,
  accent,
  className,
  panel,
  children,
}: {
  name: string;
  accent: string;
  className?: string;
  panel: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="og-shell">
      <div className={'og-game' + (className ? ` ${className}` : '')} style={{ '--accent': accent } as CSSProperties}>
        <aside className="og-panel" aria-label={`${name} controls`}>
          {panel}
        </aside>
        <section className="og-stage" aria-label={name}>
          {children}
        </section>
      </div>
    </div>
  );
}

export function Label({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="og-label">
      <span>{children}</span>
      {hint != null && <span className="og-hint">{hint}</span>}
    </div>
  );
}

export function BetField({ bet, disabled }: { bet: BetInput; disabled?: boolean }) {
  const balance = useBalance();
  return (
    <>
      <Label hint={`Balance ${formatAmount(balance, 2)}`}>Bet amount</Label>
      <div className="og-bet-row">
        <input
          value={bet.text}
          inputMode="decimal"
          aria-label="Bet amount"
          disabled={disabled}
          onChange={(e) => bet.setText(e.target.value)}
          onBlur={bet.normalize}
        />
        <button type="button" disabled={disabled} onClick={bet.half} aria-label="Halve bet">
          ½
        </button>
        <button type="button" disabled={disabled} onClick={bet.double} aria-label="Double bet">
          2×
        </button>
      </div>
    </>
  );
}

export interface ChipOption<T> {
  value: T;
  label: ReactNode;
  title?: string;
  disabled?: boolean;
}

/** A segmented choice. `wrap` lets many options flow onto several rows. */
export function Chips<T extends string | number>({
  options,
  value,
  onChange,
  disabled,
  label,
  wrap,
}: {
  options: ChipOption<T>[];
  value: T;
  onChange(value: T): void;
  disabled?: boolean;
  label: string;
  wrap?: boolean;
}) {
  return (
    <div className={'og-chips' + (wrap ? ' wrap' : '')} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={'og-chip' + (o.value === value ? ' on' : '')}
          disabled={disabled || o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  disabled,
  label,
  risk,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange(value: number): void;
  disabled?: boolean;
  label: string;
  /** Paints the track red (left) to green (right), for "safer to the right" knobs. */
  risk?: boolean;
}) {
  return (
    <input
      type="range"
      className={'og-range' + (risk ? ' risk' : '')}
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      aria-label={label}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

export function VolBadge({ level }: { level: Volatility }) {
  return <span className={`og-vol ${level}`}>{level}</span>;
}

export function ActionButton({
  kind = 'bet',
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'bet' | 'cash' | 'secondary' }) {
  return <button type="button" className={`og-btn ${kind}` + (className ? ` ${className}` : '')} {...rest} />;
}

export function PanelFoot({ turbo, onInfo }: { turbo: TurboState; onInfo(): void }) {
  return (
    <div className="og-panel-foot">
      <label className="og-toggle">
        <input type="checkbox" checked={turbo.turbo} disabled={turbo.forced} onChange={(e) => turbo.setLocal(e.target.checked)} />
        <span>Turbo</span>
      </label>
      <button type="button" className="og-ghost og-info-btn" onClick={onInfo}>
        <span className="i">i</span> How to play
      </button>
    </div>
  );
}

export type StatusTone = 'idle' | 'live' | 'won' | 'lost';

export function StageTop({ status, tone = 'idle', history }: { status: ReactNode; tone?: StatusTone; history: HistoryItem[] }) {
  return (
    <div className="og-stage-top">
      <span className={`og-status ${tone}`} aria-live="polite">
        {status}
      </span>
      <div className="og-history" aria-label="Recent results">
        {history.map((h) => (
          <span key={h.id} className={'og-hist ' + (h.multiplier >= 1 ? 'w' : h.multiplier > 0 ? 'p' : 'l')}>
            {fmtMult(h.multiplier)}
          </span>
        ))}
      </div>
    </div>
  );
}

export interface ReadoutItem {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  /** chance = the live win probability, cash = cash-out value, prize = full win. */
  tone?: 'chance' | 'cash' | 'prize' | 'win' | 'lose' | 'neutral';
}

export function Readouts({ items }: { items: ReadoutItem[] }) {
  return (
    <div className="og-readouts">
      {items.map((it, i) => (
        <div key={i} className={`og-readout ${it.tone ?? 'neutral'}`}>
          <span>{it.label}</span>
          <b>{it.value}</b>
          {it.sub != null && <small>{it.sub}</small>}
        </div>
      ))}
    </div>
  );
}

/** A horizontal meter whose filled length is the probability itself. */
export function ChanceBar({ p, label = 'Win chance', note }: { p: number; label?: string; note?: ReactNode }) {
  const v = Math.min(1, Math.max(0, p));
  return (
    <div className="og-chance" role="meter" aria-valuemin={0} aria-valuemax={1} aria-valuenow={v} aria-label={label}>
      <div className="og-chance-head">
        <span>{label}</span>
        <b>{fmtChance(v)}</b>
      </div>
      <div className="og-chance-track">
        <i style={{ width: `${v * 100}%` }} />
      </div>
      {note != null && <small>{note}</small>}
    </div>
  );
}

/** The board area: centres its content and anchors the RoundOver card. */
export function Board({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={'og-board' + (className ? ` ${className}` : '')}>{children}</div>;
}

export function Caption({ children }: { children: ReactNode }) {
  return <p className="og-caption">{children}</p>;
}

export function InfoModal({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  const close = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    close.current?.focus({ preventScroll: true });
    // Capture phase, so Esc closes the modal without also clearing the board.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  return (
    <div className="og-modal-backdrop" onClick={onClose}>
      <div className="og-modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="og-modal-head">
          <h2>{title}</h2>
          <button ref={close} type="button" className="og-ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="og-modal-body">{children}</div>
        <div className="og-modal-foot">
          <ActionButton onClick={onClose}>Got it</ActionButton>
        </div>
      </div>
    </div>
  );
}

export function InfoSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="og-info-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}
