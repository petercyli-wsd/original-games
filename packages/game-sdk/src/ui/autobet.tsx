// Auto-bet: the Manual / Auto mode every crypto casino ships. The game supplies
// `play(stake)`, which places one bet, plays one whole round with the game's
// own auto choices (preset tiles, target row, cash-out target…) and resolves
// to the payout multiplier. The hook loops it with the standard controls:
// number of bets, on win / on loss (reset or increase by %), stop on profit
// and stop on loss. Auto-bet only changes stakes and stopping, so the RTP of
// every round is unchanged.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { formatAmount } from '../money';
import { useBalance } from '../react';
import { ActionButton, Label } from './components';
import type { BetInput } from './hooks';

export type BetMode = 'manual' | 'auto';

export interface AutoBetSettings {
  /** Bets to place; 0 = until stopped. */
  count: number;
  onWin: 'reset' | 'increase';
  onWinPct: number;
  onLoss: 'reset' | 'increase';
  onLossPct: number;
  /** Stop once session profit reaches this (0 = off). */
  stopProfit: number;
  /** Stop once session loss reaches this (0 = off). */
  stopLoss: number;
}

export const DEFAULT_AUTO: AutoBetSettings = { count: 10, onWin: 'reset', onWinPct: 0, onLoss: 'reset', onLossPct: 0, stopProfit: 0, stopLoss: 0 };

export interface AutoBet {
  mode: BetMode;
  setMode(mode: BetMode): void;
  settings: AutoBetSettings;
  update(patch: Partial<AutoBetSettings>): void;
  running: boolean;
  /** Bets left in this run (null when unlimited). */
  remaining: number | null;
  /** Profit of the current (or last) run. */
  profit: number;
  start(): void;
  /** Finishes the round in progress, then stops. */
  stop(): void;
}

export function useAutoBet({
  bet,
  play,
  turbo = false,
}: {
  bet: BetInput;
  /** Places one bet and plays one full round; resolves to the payout multiplier, or null if the bet was refused. */
  play: (stake: number) => Promise<number | null>;
  turbo?: boolean;
}): AutoBet {
  const balance = useBalance();
  const [mode, setMode] = useState<BetMode>('manual');
  const [settings, setSettings] = useState<AutoBetSettings>(DEFAULT_AUTO);
  const [running, setRunning] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [profit, setProfit] = useState(0);

  const latest = useRef({ play, bet, settings, balance, turbo });
  latest.current = { play, bet, settings, balance, turbo };
  const stopRequested = useRef(false);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
      stopRequested.current = true;
    },
    [],
  );

  const start = useCallback(() => {
    if (running) return;
    const { bet: b, settings: s } = latest.current;
    if (b.blocked) return;
    stopRequested.current = false;
    setRunning(true);
    setProfit(0);
    void (async () => {
      const base = b.value;
      let stake = base;
      let total = 0;
      for (let i = 0; s.count === 0 || i < s.count; i++) {
        if (stopRequested.current || !alive.current) break;
        if (stake > latest.current.balance + 1e-9 || !(stake > 0)) break;
        setRemaining(s.count === 0 ? null : s.count - i);
        const mult = await latest.current.play(stake);
        if (mult === null || !alive.current) break;
        total += stake * mult - stake;
        setProfit(total);
        if (mult > 1) stake = s.onWin === 'reset' ? base : stake * (1 + s.onWinPct / 100);
        else if (mult < 1) stake = s.onLoss === 'reset' ? base : stake * (1 + s.onLossPct / 100);
        stake = Math.max(0.01, Math.round(stake * 100) / 100);
        latest.current.bet.setText(formatAmount(stake, 2));
        if (s.stopProfit > 0 && total >= s.stopProfit) break;
        if (s.stopLoss > 0 && -total >= s.stopLoss) break;
        await new Promise((r) => setTimeout(r, latest.current.turbo ? 60 : 350));
      }
      if (alive.current) {
        setRunning(false);
        setRemaining(null);
      }
    })();
  }, [running]);

  const stop = useCallback(() => {
    stopRequested.current = true;
  }, []);

  const update = useCallback((patch: Partial<AutoBetSettings>) => setSettings((s) => ({ ...s, ...patch })), []);

  return { mode, setMode, settings, update, running, remaining, profit, start, stop };
}

/** Manual | Auto tabs for the top of the panel. */
export function ModeTabs({ auto, disabled }: { auto: AutoBet; disabled?: boolean }) {
  return (
    <div className="og-mode-tabs" role="tablist" aria-label="Bet mode">
      {(['manual', 'auto'] as const).map((m) => (
        <button
          key={m}
          type="button"
          role="tab"
          aria-selected={auto.mode === m}
          className={auto.mode === m ? 'on' : ''}
          disabled={disabled || auto.running}
          onClick={() => auto.setMode(m)}
        >
          {m === 'manual' ? 'Manual' : 'Auto'}
        </button>
      ))}
    </div>
  );
}

function NumberField({ value, onChange, disabled, placeholder, suffix, label }: { value: number; onChange(v: number): void; disabled?: boolean; placeholder?: string; suffix?: ReactNode; label: string }) {
  const [text, setText] = useState(value ? String(value) : '');
  useEffect(() => setText(value ? String(value) : ''), [value]);
  return (
    <div className="og-num-field">
      <input
        value={text}
        inputMode="decimal"
        aria-label={label}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
          const v = parseFloat(e.target.value);
          onChange(Number.isFinite(v) && v > 0 ? v : 0);
        }}
      />
      {suffix != null && <span className="og-num-suffix">{suffix}</span>}
    </div>
  );
}

function OnOutcome({ label, kind, pct, onKind, onPct, disabled }: { label: string; kind: 'reset' | 'increase'; pct: number; onKind(k: 'reset' | 'increase'): void; onPct(v: number): void; disabled?: boolean }) {
  return (
    <>
      <Label>{label}</Label>
      <div className="og-on-outcome">
        <div className="og-chips">
          <button type="button" className={'og-chip' + (kind === 'reset' ? ' on' : '')} disabled={disabled} onClick={() => onKind('reset')}>
            Reset
          </button>
          <button type="button" className={'og-chip' + (kind === 'increase' ? ' on' : '')} disabled={disabled} onClick={() => onKind('increase')}>
            Increase
          </button>
        </div>
        <NumberField label={`${label} increase`} value={pct} onChange={onPct} disabled={disabled || kind === 'reset'} placeholder="0" suffix="%" />
      </div>
    </>
  );
}

/**
 * The auto-bet settings plus the Start / Stop button. Render it in place of
 * the manual action buttons when `auto.mode === 'auto'`; `children` can hold
 * the game's own auto choices (e.g. tiles to reveal, cash-out target).
 */
export function AutoBetControls({ auto, disabled, children }: { auto: AutoBet; disabled?: boolean; children?: ReactNode }) {
  const s = auto.settings;
  const lock = auto.running || disabled;
  return (
    <div className="og-autobet">
      {children}
      <Label hint={s.count === 0 ? 'until stopped' : undefined}>Number of bets</Label>
      <NumberField label="Number of bets" value={s.count} onChange={(v) => auto.update({ count: Math.floor(v) })} disabled={lock} placeholder="∞" />
      <OnOutcome label="On win" kind={s.onWin} pct={s.onWinPct} onKind={(k) => auto.update({ onWin: k })} onPct={(v) => auto.update({ onWinPct: v })} disabled={lock} />
      <OnOutcome label="On loss" kind={s.onLoss} pct={s.onLossPct} onKind={(k) => auto.update({ onLoss: k })} onPct={(v) => auto.update({ onLossPct: v })} disabled={lock} />
      <div className="og-stop-row">
        <div>
          <Label>Stop on profit</Label>
          <NumberField label="Stop on profit" value={s.stopProfit} onChange={(v) => auto.update({ stopProfit: v })} disabled={lock} placeholder="off" />
        </div>
        <div>
          <Label>Stop on loss</Label>
          <NumberField label="Stop on loss" value={s.stopLoss} onChange={(v) => auto.update({ stopLoss: v })} disabled={lock} placeholder="off" />
        </div>
      </div>
      {auto.running ? (
        <ActionButton kind="cash" onClick={auto.stop}>
          Stop autobet{auto.remaining !== null ? ` · ${auto.remaining} left` : ''}
        </ActionButton>
      ) : (
        <ActionButton disabled={disabled} onClick={auto.start}>
          Start autobet
        </ActionButton>
      )}
      {(auto.running || auto.profit !== 0) && (
        <div className={'og-auto-profit ' + (auto.profit > 0 ? 'up' : auto.profit < 0 ? 'down' : '')}>
          Session profit <b>{auto.profit >= 0 ? '+' : '−'}{formatAmount(Math.abs(auto.profit), 2)}</b>
        </div>
      )}
    </div>
  );
}

/**
 * The non-blocking result for instant games (dice, limbo, plinko…), where a
 * modal after every round would slow play down: a pill on the board showing
 * the multiplier and net. Bet again is just the Bet button (or Space).
 */
export function InstantResult({ multiplier, stake, id }: { multiplier: number | null; stake: number; id: number }) {
  if (multiplier === null) return null;
  const net = stake * multiplier - stake;
  const tone = multiplier >= 1 ? (multiplier > 1 ? 'win' : 'even') : 'lose';
  return (
    <div key={id} className={`og-instant ${tone}`} role="status">
      <b>{multiplier.toFixed(2)}×</b>
      <span>
        {net >= 0 ? '+' : '−'}
        {formatAmount(Math.abs(net), 2)}
      </span>
    </div>
  );
}
