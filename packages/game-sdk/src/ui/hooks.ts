// Hooks shared by kit-based games: the bet input, the bet ticket's lifecycle,
// keyboard shortcuts, turbo, cancellable timers and the result history.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatAmount } from '../money';
import { useBalance, useHost, useSettings } from '../react';
import { createTicketLifecycle } from './ticket-lifecycle';

export interface BetInput {
  /** What's in the input box. */
  text: string;
  setText(text: string): void;
  /** The parsed bet (0 if the text isn't a number). */
  value: number;
  /** Why the bet can't be placed right now, if it can't. */
  blocked: string | undefined;
  half(): void;
  double(): void;
  /** Reformats the text to 2 decimals (on blur). */
  normalize(): void;
}

export function useBetInput(initial = 1): BetInput {
  const balance = useBalance();
  const [text, setText] = useState(formatAmount(initial, 2));
  const parsed = Number(text.trim());
  const value = Number.isFinite(parsed) ? parsed : 0;
  const blocked = !(value > 0) ? 'Enter a valid bet' : value > balance + 1e-9 ? 'Not enough balance' : undefined;
  return {
    text,
    setText,
    value,
    blocked,
    half: () => setText(formatAmount(value / 2, 2)),
    double: () => setText(formatAmount(Math.min(balance, value * 2), 2)),
    normalize: () => setText(formatAmount(value, 2)),
  };
}

export interface Ticket {
  /** Debits the stake. Resolves false if the bet was rejected or one is already open. */
  place(amount: number): Promise<boolean>;
  /** Pays stake × multiplier and closes the ticket. Safe to call more than once. */
  settle(multiplier: number): void;
  /** Whether a bet is open or being placed. */
  active(): boolean;
}

/**
 * Owns the round's BetTicket. If the game unmounts mid-round (the player
 * leaves), the open bet is settled at `fairValue()`, the cash-out the player
 * could have taken, which is fair at every step under the cash-out rule.
 */
export function useTicket(fairValue: () => number): Ticket {
  const { wallet } = useHost();
  const fair = useRef(fairValue);
  fair.current = fairValue;
  const lifecycle = useMemo(() => createTicketLifecycle(wallet, () => fair.current()), [wallet]);
  useEffect(() => {
    lifecycle.activate();
    return () => lifecycle.dispose();
  }, [lifecycle]);
  return lifecycle;
}

export interface Hotkeys {
  /** Space: the main action (Bet, Continue, Bet again…). */
  space?: () => void;
  /** C: cash out. */
  cashOut?: () => void;
}

/**
 * Space and C shortcuts, ignored while typing in a text field. Esc is handled
 * by the SDK's RoundOver card (clear board) and by InfoModal (close).
 */
export function useHotkeys(keys: Hotkeys, enabled = true) {
  const ref = useRef(keys);
  ref.current = keys;

  useEffect(() => {
    if (!enabled) return;
    const typing = (e: KeyboardEvent) => {
      const t = e.composedPath()[0] as HTMLElement | undefined;
      if (!t || !t.tagName) return false;
      if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return true;
      return t.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes((t as HTMLInputElement).type);
    };
    const onDown = (e: KeyboardEvent) => {
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) ref.current.space?.();
      } else if (e.key === 'c' || e.key === 'C') {
        ref.current.cashOut?.();
      }
    };
    // Stops a focused button from also "clicking" on Space.
    const onUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !typing(e)) e.preventDefault();
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, [enabled]);
}

export interface TurboState {
  /** Effective turbo: the host's setting or the game's own toggle. */
  turbo: boolean;
  /** The game's own toggle. */
  local: boolean;
  setLocal(on: boolean): void;
  /** True when the host forces turbo on (the toggle is then locked). */
  forced: boolean;
}

export function useTurbo(): TurboState {
  const host = useSettings();
  const [local, setLocal] = useState(false);
  return { turbo: local || host.turbo, local, setLocal, forced: host.turbo };
}

export interface Timers {
  /** Runs fn after ms, unless cleared or the game unmounts first. */
  after(ms: number, fn: () => void): void;
  /** Resolves true after ms, or false if cleared or unmounted first. */
  wait(ms: number): Promise<boolean>;
  /** Cancels everything pending (e.g. when the player clears the board). */
  clearAll(): void;
}

export function useTimers(): Timers {
  const pending = useRef(new Map<number, () => void>());

  const clearAll = useCallback(() => {
    for (const [id, cancel] of pending.current) {
      clearTimeout(id);
      cancel();
    }
    pending.current.clear();
  }, []);

  useEffect(() => clearAll, [clearAll]);

  const after = useCallback((ms: number, fn: () => void) => {
    const id = window.setTimeout(() => {
      pending.current.delete(id);
      fn();
    }, ms);
    pending.current.set(id, () => {});
  }, []);

  const wait = useCallback(
    (ms: number) =>
      new Promise<boolean>((resolve) => {
        const id = window.setTimeout(() => {
          pending.current.delete(id);
          resolve(true);
        }, ms);
        pending.current.set(id, () => resolve(false));
      }),
    [],
  );

  return { after, wait, clearAll };
}

export interface HistoryItem {
  id: number;
  multiplier: number;
}

/** The last few results, newest first, for the history chips. */
export function useHistory(max = 12) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const seq = useRef(0);
  const push = useCallback(
    (multiplier: number) => setItems((h) => [{ id: ++seq.current, multiplier }, ...h].slice(0, max)),
    [max],
  );
  return [items, push] as const;
}
