// Small presentation parts of the slot UI: the rolling win counter, the win chip and the
// cards that cover the window at the big moments (feature intro and outro, retrigger,
// big win). All flat: a solid surface with a 1px border, no dim layer, no confetti.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import { ActionButton } from '@originals/game-sdk/ui';
import type { SlotSymbolArt } from './types';

export interface RollHandle {
  /** Counts from the current value to `to` over `ms`. Resolves when it lands (or when skipped). */
  roll(to: number, ms: number): Promise<void>;
  /** Jumps to a value now. */
  set(v: number): void;
  /** Lands a running roll now. */
  skip(): void;
  value(): number;
}

/** A number that rolls up (the win counter). `format` defaults to 2 decimals. */
export const RollNumber = forwardRef<RollHandle, { format?: (v: number) => string; initial?: number }>(function RollNumber({ format = (v) => v.toFixed(2), initial = 0 }, ref) {
  const [v, setV] = useState(initial);
  const cur = useRef(initial);
  const raf = useRef(0);
  const finish = useRef<(() => void) | null>(null);

  const stop = () => {
    cancelAnimationFrame(raf.current);
    const f = finish.current;
    finish.current = null;
    f?.();
  };

  useImperativeHandle(ref, () => ({
    roll(to, ms) {
      stop();
      const from = cur.current;
      if (ms <= 0 || from === to) {
        cur.current = to;
        setV(to);
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        const t0 = performance.now();
        const tick = (now: number) => {
          const p = Math.min(1, (now - t0) / ms);
          const e = 1 - Math.pow(1 - p, 2); // eases out, so the last digits settle
          cur.current = from + (to - from) * e;
          setV(cur.current);
          if (p < 1) raf.current = requestAnimationFrame(tick);
          else stop();
        };
        finish.current = () => {
          cur.current = to;
          setV(to);
          resolve();
        };
        raf.current = requestAnimationFrame(tick);
      });
    },
    set(x) {
      stop();
      cur.current = x;
      setV(x);
    },
    skip: stop,
    value: () => cur.current,
  }));

  return <span className="sl-roll">{format(v)}</span>;
});

/** "Crab ×4 = 2.50": the symbol (small, on a tile of the theme), then the sum. */
export function WinChip({ art, text, event }: { art?: SlotSymbolArt | null; text: string; event?: boolean }) {
  return (
    <span className={'sl-chip' + (event ? ' event' : '')} role="status">
      {art && <span className="sl-mini">{art.render(22)}</span>}
      {text}
    </span>
  );
}

export interface CardProps {
  /** Small label above the title: the tier ("Big win") or the feature name. */
  kicker?: string;
  title?: ReactNode;
  /** The big number (the amount). */
  amount?: ReactNode;
  lines?: string[];
  /** 1 or 2 for the big-win tiers (a thicker border at 2). */
  tier?: 0 | 1 | 2;
  /** Where the card sits: 'center' (default), or 'top' / 'bottom' to keep clear of cells that must stay in view. */
  placement?: 'center' | 'top' | 'bottom' | 'below';
  /** A button label: the card waits for a press. null: the card closes by itself or on a click. */
  button?: string | null;
  onContinue?: () => void;
}

/** A solid card centred over the reel window. */
export function Card({ kicker, title, amount, lines, tier = 0, button, onContinue, placement = 'center' }: CardProps) {
  return (
    <div className={`sl-card t${tier} at-${placement}`} role="status" onClick={onContinue}>
      {kicker && <span className="sl-card-kicker">{kicker}</span>}
      {title != null && <b className="sl-card-title">{title}</b>}
      {amount != null && <b className="sl-card-amount">{amount}</b>}
      {lines?.map((l, i) => (
        <span key={i} className="sl-card-line">
          {l}
        </span>
      ))}
      {button && (
        <ActionButton onClick={onContinue} autoFocus>
          {button}
        </ActionButton>
      )}
    </div>
  );
}

/**
 * A multiplier reel (the marquee: ×1 ×2 ×3 ×5 ×10) in a row above the window. While the reels spin the highlight
 * steps along the values; when they stop it rests on the spin's value (or on none if the spin has none).
 */
export function MultiplierReel({ label, values, spinning, value, turbo, dim }: { label: string; values: number[]; spinning: boolean; value: number | null; turbo: boolean; dim?: boolean }) {
  const [at, setAt] = useState(0);
  useEffect(() => {
    if (!spinning) return;
    const id = setInterval(() => setAt((i) => (i + 1) % values.length), turbo ? 40 : 90);
    return () => clearInterval(id);
  }, [spinning, turbo, values.length]);
  const on = spinning ? values[at] : value;
  return (
    <div className="sl-mreel" role="img" aria-label={`${label}${!spinning && value ? ` ×${value}` : ''}`}>
      <span className="sl-mreel-label">{label}</span>
      {values.map((v) => (
        <span key={v} className={'sl-mreel-v' + (v === on ? ' on' : '') + (v === on && dim && !spinning ? ' dim' : '')}>
          ×{v}
        </span>
      ))}
    </div>
  );
}
