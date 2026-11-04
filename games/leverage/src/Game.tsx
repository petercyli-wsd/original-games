import { formatAmount } from '@originals/game-sdk';
import { useHost } from '@originals/game-sdk/react';
import {
  ActionButton,
  AutoBetControls,
  ACCENTS,
  BetField,
  Board,
  Caption,
  GameLayout,
  InfoModal,
  InfoSection,
  InstantResult,
  Label,
  ModeTabs,
  PanelFoot,
  Readouts,
  RoundOver,
  StageTop,
  VolBadge,
  fmtChance,
  fmtMult,
  useAutoBet,
  useBetInput,
  useHistory,
  useHotkeys,
  useTicket,
  useTurbo,
} from '@originals/game-sdk/ui';
import { useEffect, useRef, useState } from 'react';
import Chart, { type ChartLine, type ChartView } from './Chart';
import {
  EXPIRIES,
  MAX_LEVERAGE,
  MAX_MULTIPLIER,
  MAX_SL,
  MIN_LEVERAGE,
  MIN_SL,
  MIN_TP,
  QUICK_LEVERAGE,
  RTP,
  TICK_MS,
  barrierHit,
  barriersOf,
  bustPrice,
  clampLeverage,
  fmtPrice,
  fmtSignedPct,
  levFromSlider,
  odds,
  priceAt,
  sliderFromLev,
  startOdds,
  tickMove,
  tickSize,
  valueAt,
  volatilityOf,
  type Barriers,
  type Direction,
  type Expiry,
  type Odds,
  type Outcome,
  type Setup,
} from './math';

const ACCENT = ACCENTS.sky;
const START_PRICE = 5000;

type Phase = 'idle' | 'live' | 'over';

interface Position {
  id: number;
  stake: number;
  setup: Setup;
  b: Barriers;
  entry: number;
  entryIdx: number;
  auto: boolean;
  start: number;
  speed: number;
  /** Ticks elapsed and ticks in the player's favour. */
  t: number;
  k: number;
  outcome: Outcome | null;
  payout: number;
  odds: Odds;
  oddsAt: number;
}

const OUTCOME_TITLE: Record<Outcome, string> = {
  tp: 'Take profit hit',
  sl: 'Stopped out',
  bust: 'Busted',
  expired: 'Expired',
  closed: 'Position closed',
};

const fmtSecs = (ticks: number) => (ticks * TICK_MS) / 1000;

/** A chance, with the tails that round away shown as bounds instead of exponents. */
function fmtP(p: number) {
  if (p <= 0) return '0%';
  if (p < 1e-4) return '<0.01%';
  if (p >= 1) return '100%';
  if (p > 1 - 1e-4) return '>99.99%';
  return fmtChance(p);
}

export default function Game() {
  const { rng } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const [history, pushHistory] = useHistory(14);

  const [dir, setDir] = useState<Direction>('up');
  const [lev, setLev] = useState(200);
  const [expiry, setExpiry] = useState<Expiry>(30);
  const [tp, setTp] = useState<number | null>(null);
  const [sl, setSl] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [, setFrame] = useState(0);
  const [infoOpen, setInfoOpen] = useState(false);

  // The simulated market: one continuous price series, seeded with some history.
  const series = useRef<number[] | null>(null);
  if (series.current === null) {
    const s = [START_PRICE];
    for (let i = 0; i < 600; i++) s.push(s[s.length - 1] * (1 + tickMove(rng.next()) * 1e-4));
    series.current = s.map((p) => Math.round(p * 100) / 100);
  }

  const pos = useRef<Position | null>(null);
  const raf = useRef(0);
  const done = useRef<((m: number) => void) | null>(null);
  const seq = useRef(0);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
      cancelAnimationFrame(raf.current);
    },
    [],
  );

  // Leaving mid-round closes the position at its current value: a close the
  // player could have clicked, so it is worth exactly the fair value.
  const ticket = useTicket(() => {
    const p = pos.current;
    return p && !p.outcome ? valueAt(p.k, p.b.n) : 0;
  });

  const setup: Setup = { lev, dir, expiry, tp, sl };

  function finish(p: Position, outcome: Outcome) {
    p.outcome = outcome;
    p.payout = valueAt(p.k, p.b.n);
    ticket.settle(p.payout);
    pushHistory(p.payout);
    setPhase('over');
    setFrame((x) => x + 1);
    const resolve = done.current;
    done.current = null;
    if (resolve) window.setTimeout(() => resolve(p.payout), p.auto ? (turbo.turbo ? 160 : 600) : 0);
  }

  function loop() {
    const p = pos.current;
    if (!p || p.outcome || !alive.current) return;
    const s = series.current!;
    const due = Math.min(p.b.T, Math.floor(((performance.now() - p.start) * p.speed) / TICK_MS));
    while (p.t < due) {
      p.t++;
      p.k += tickMove(rng.next());
      s.push(priceAt(p.entry, p.setup.lev, p.setup.dir, p.k));
      const hit = barrierHit(p.k, p.b);
      if (hit) return finish(p, hit);
    }
    if (p.t >= p.b.T) return finish(p, 'expired');
    if (p.t - p.oddsAt >= 5) {
      p.odds = odds(p.k, p.b, p.b.T - p.t);
      p.oddsAt = p.t;
    }
    setFrame((x) => x + 1);
    raf.current = requestAnimationFrame(loop);
  }

  async function open(stake: number, isAuto: boolean): Promise<number | null> {
    if (pos.current && !pos.current.outcome) return null;
    if (!(await ticket.place(stake))) return null;
    const s = series.current!;
    if (s.length > 8000) s.splice(0, s.length - 3000);
    const b = barriersOf(setup);
    const p: Position = {
      id: ++seq.current,
      stake,
      setup: { ...setup },
      b,
      entry: s[s.length - 1],
      entryIdx: s.length - 1,
      auto: isAuto,
      start: performance.now(),
      speed: turbo.turbo ? 4 : 1,
      t: 0,
      k: 0,
      outcome: null,
      payout: 0,
      odds: startOdds(b),
      oddsAt: 0,
    };
    pos.current = p;
    setPhase('live');
    cancelAnimationFrame(raf.current);
    const result = new Promise<number>((res) => (done.current = res));
    raf.current = requestAnimationFrame(loop);
    return result;
  }

  function close() {
    const p = pos.current;
    if (!p || p.outcome || p.auto) return;
    finish(p, 'closed');
  }

  const auto = useAutoBet({ bet, play: (stake) => open(stake, true), turbo: turbo.turbo });
  const mode = auto.mode;
  const live = phase === 'live';
  const lock = live || auto.running;
  const p = pos.current;

  function clear() {
    if (live) return;
    pos.current = null;
    setPhase('idle');
  }
  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    apply();
    if (phase === 'over') clear();
  };
  const lastMode = useRef(mode);
  useEffect(() => {
    if (lastMode.current !== mode && phase === 'over') clear();
    lastMode.current = mode;
  });

  useHotkeys(
    {
      space: () => {
        if (mode === 'auto') {
          if (auto.running) auto.stop();
          else if (!bet.blocked && !live) auto.start();
          return;
        }
        if (live) close();
        else if (!bet.blocked) void open(bet.value, false);
      },
      cashOut: () => mode === 'manual' && close(),
    },
    !infoOpen,
  );
  // Arrow up / down pick the direction between rounds.
  const dirKeys = useRef({ lock, change });
  dirKeys.current = { lock, change };
  useEffect(() => {
    if (infoOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      const t = e.composedPath()[0] as HTMLElement | undefined;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (dirKeys.current.lock) return;
      e.preventDefault();
      const d: Direction = e.key === 'ArrowUp' ? 'up' : 'down';
      dirKeys.current.change(() => setDir(d));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [infoOpen]);

  // ----- What the board shows: the live or finished round, else a preview -----
  const s = series.current!;
  const shownSetup = p && phase !== 'idle' ? p.setup : setup;
  const b = p && phase !== 'idle' ? p.b : barriersOf(setup);
  const k = p && phase !== 'idle' ? p.k : 0;
  const t = p && phase !== 'idle' ? p.t : 0;
  const entry = p && phase !== 'idle' ? p.entry : s[s.length - 1];
  const entryIdx = p && phase !== 'idle' ? p.entryIdx : s.length - 1;
  const o: Odds = p && live ? p.odds : p && phase === 'over' ? odds(k, b, 0) : startOdds(b);
  const stake = p && phase !== 'idle' ? p.stake : bet.value;
  const value = valueAt(k, b.n);
  const priceNow = s[s.length - 1];
  const tpFill = b.hi !== null ? valueAt(b.hi, b.n) : null;
  const slFill = b.lo > -b.n ? valueAt(b.lo, b.n) : null;
  const vol = volatilityOf(lev, expiry);
  const bustMove = -1 / shownSetup.lev;

  const lines: ChartLine[] = [{ kind: 'bust', price: bustPrice(entry, shownSetup.lev, shownSetup.dir), label: `Bust ${fmtSignedPct(bustMove)}` }];
  if (b.hi !== null) lines.push({ kind: 'tp', price: priceAt(entry, shownSetup.lev, shownSetup.dir, b.hi), label: `Take profit ${fmtMult(tpFill!)}` });
  if (slFill !== null) lines.push({ kind: 'sl', price: priceAt(entry, shownSetup.lev, shownSetup.dir, b.lo), label: `Stop loss ${fmtMult(slFill)}` });

  const view: ChartView = {
    state: phase,
    series: s,
    entryIdx,
    T: b.T,
    pre: Math.round(b.T * 0.3),
    entry,
    dir: shownSetup.dir,
    lines,
    tick: entry * tickSize(shownSetup.lev),
    close:
      p && phase === 'over'
        ? { idx: entryIdx + p.t, price: s[entryIdx + p.t] ?? priceNow, tone: p.payout > 1 ? 'win' : p.payout > 0 ? 'even' : 'lose', label: fmtMult(p.payout) }
        : null,
    clock: t / b.T,
  };

  const secsLeft = fmtSecs(b.T - t);
  let status = `${dir === 'up' ? 'Up' : 'Down'} · ${lev}× · ${expiry}s`;
  let tone: 'idle' | 'live' | 'won' | 'lost' = 'idle';
  if (p && live) {
    status = `${p.setup.dir === 'up' ? '▲ Up' : '▼ Down'} ${p.setup.lev}× · ${secsLeft.toFixed(1)}s left`;
    tone = 'live';
  } else if (p && phase === 'over' && p.outcome) {
    status = `${OUTCOME_TITLE[p.outcome]} · ${fmtMult(p.payout)}`;
    tone = p.payout >= 1 ? 'won' : 'lost';
  }

  const pnl = stake * value - stake;
  const ret = (priceNow - entry) / entry;

  // ----- Panel -----
  const knobs = (
    <>
      <Label>Direction</Label>
      <div className="lev-dir" role="radiogroup" aria-label="Direction">
        {(['up', 'down'] as const).map((d) => (
          <button
            key={d}
            type="button"
            role="radio"
            aria-checked={dir === d}
            className={`lev-dir-btn ${d}` + (dir === d ? ' on' : '')}
            disabled={lock}
            onClick={() => change(() => setDir(d))}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d={d === 'up' ? 'M3 14 L8 8 L11.5 11 L17 5 M12.5 5 H17 V9.5' : 'M3 6 L8 12 L11.5 9 L17 15 M12.5 15 H17 V10.5'} />
            </svg>
            {d === 'up' ? 'Up' : 'Down'}
          </button>
        ))}
      </div>

      <Label hint={<VolBadge level={vol} />}>Leverage</Label>
      <LeverageField lev={lev} disabled={lock} onChange={(v) => change(() => setLev(v))} />

      <Label hint="auto-closes at the bell">Expiry</Label>
      <div className="og-chips" role="radiogroup" aria-label="Expiry">
        {EXPIRIES.map((e) => (
          <button
            key={e}
            type="button"
            role="radio"
            aria-checked={expiry === e}
            className={'og-chip' + (expiry === e ? ' on' : '')}
            disabled={lock}
            onClick={() => change(() => setExpiry(e))}
          >
            {e}s
          </button>
        ))}
      </div>

      <div className="lev-limits">
        <LimitField
          label="Take profit"
          value={tp}
          min={MIN_TP}
          max={MAX_MULTIPLIER}
          disabled={lock}
          tone="tp"
          note={tpFill !== null ? `fills ${fmtMult(tpFill)}` : 'off'}
          onChange={(v) => change(() => setTp(v))}
        />
        <LimitField
          label="Stop loss"
          value={sl}
          min={MIN_SL}
          max={MAX_SL}
          disabled={lock}
          tone="sl"
          note={slFill !== null ? `fills ${fmtMult(slFill)}` : 'bust only'}
          onChange={(v) => change(() => setSl(v))}
        />
      </div>

      <dl className="og-stats">
        <dt>Position size</dt>
        <dd>{formatAmount(bet.value * RTP * lev, 2)}</dd>
      </dl>
    </>
  );

  return (
    <GameLayout
      name="Leverage"
      accent={ACCENT}
      className="lev-game"
      panel={
        <>
          <ModeTabs auto={auto} disabled={live} />
          <BetField bet={bet} disabled={lock} />
          {mode === 'manual' ? (
            <>
              {knobs}
              {live && p ? (
                <ActionButton kind="cash" onClick={close}>
                  Close <span>{formatAmount(p.stake * value, 2)}</span>
                </ActionButton>
              ) : (
                <ActionButton disabled={!!bet.blocked} className={`lev-open ${dir}`} onClick={() => void open(bet.value, false)}>
                  {phase === 'over' ? 'Bet again' : `Bet ${dir === 'up' ? 'Up' : 'Down'}`}
                </ActionButton>
              )}
              {bet.blocked && !live && <p className="lev-blocked">{bet.blocked}</p>}
            </>
          ) : (
            <AutoBetControls auto={auto} disabled={!!bet.blocked}>
              {knobs}
            </AutoBetControls>
          )}
          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />

      {phase !== 'over' && (
        <Readouts
          items={[
            { label: 'Finish in profit', value: fmtP(o.profit), tone: 'chance' },
            ...(tpFill !== null ? [{ label: 'Take profit pays', value: fmtMult(tpFill), tone: 'prize' as const }] : []),
          ]}
        />
      )}

      <Board className="lev-board">
        {p && phase === 'over' && p.auto && <InstantResult multiplier={p.payout} stake={p.stake} id={p.id} />}
        <Chart view={view}>
          <div className="lev-hud">
            <span className="lev-sim">Simulated price</span>
            <span className="lev-price">
              {fmtPrice(priceNow)} {phase !== 'idle' && <small>{fmtSignedPct(ret, 3)}</small>}
            </span>
          </div>
          {phase !== 'idle' && p && (
            <div className={'lev-pnl ' + (pnl > 1e-9 ? 'up' : pnl < -1e-9 ? 'down' : '')}>
              {pnl >= 0 ? '+' : '−'}
              {formatAmount(Math.abs(pnl), 2)}
            </div>
          )}
        </Chart>
      </Board>

      {phase === 'over' && p && !p.auto && (
        <RoundOver
          key={p.id}
          title={OUTCOME_TITLE[p.outcome!]}
          multiplier={p.payout}
          stake={p.stake}
          nextBet={bet.value}
          blocked={bet.blocked}
          onBetAgain={() => void open(bet.value, false)}
          onClear={clear}
          placement="inline"
        />
      )}
      <Caption>Win if the position closes worth more than your bet.</Caption>

      {infoOpen && (
        <InfoModal title="Leverage" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              Call where a <b>simulated</b> price goes next: Up or Down, with leverage from {MIN_LEVERAGE}× to {MAX_LEVERAGE}×. Your position gains or loses
              leverage × the price move, and you close it whenever you like. The price is generated by the game; it is not a real market.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick Up or Down (or press ↑ / ↓), a leverage and an expiry. Optionally set a take profit and a stop loss, as a multiple of your bet.</li>
              <li>Press Bet (Space). The position opens at the current price after a 1% fee, so it starts worth 0.99× your bet.</li>
              <li>Press Close (Space or C) at any moment to cash the position at its value. Take profit and stop loss close it for you.</li>
              <li>If the price reaches the solid red bust line, the position is worth 0. At expiry it closes at its value.</li>
              <li>Auto mode opens a series of positions with your settings; each runs to take profit, stop loss, bust or expiry.</li>
              <li>After a round: Bet again (Space) or Clear board (Esc). Turbo runs the market clock four times faster.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The chance above the chart is the exact probability the position finishes in profit if held to expiry. While a position is open it updates from
              where you are.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              The price moves in ticks of about 0.01%. For leverage L each tick is exactly 1/(L·n) of the entry price with n = round(10,000 ÷ L), so the bust price
              (entry × (1 ∓ 1/L)) is exactly n ticks away and is hit exactly, never jumped past. Each tick is up or down with chance ½: a fair walk with no drift.
            </p>
            <p>
              Your position is worth 0.99 × bet × (1 + L × return) = 0.99 × bet × (1 + k/n) after k ticks in your favour. A fair walk makes this a martingale,
              so by the optional stopping theorem every way of closing (a click, take profit, stop loss, expiry) is worth exactly 0.99× the bet on average. The
              chances on screen are computed exactly by dynamic programming over the remaining ticks; with no clock they reduce to gambler's ruin.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              RTP is exactly {(RTP * 100).toFixed(0)}% for every leverage, direction, limit and closing time: the 1% opening fee is the whole house edge. Leverage
              and expiry only change the volatility. Take profit fills at the first price at or beyond your level, stop loss likewise, so a fill can be slightly
              better than the level typed. The largest possible payout is {fmtMult(MAX_MULTIPLIER)} (1000× leverage riding the full 60 s up). Leaving mid-round
              closes the position at its value at that moment.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}

function LeverageField({ lev, disabled, onChange }: { lev: number; disabled: boolean; onChange(v: number): void }) {
  const [text, setText] = useState(String(lev));
  useEffect(() => setText(String(lev)), [lev, disabled]);
  const commit = () => {
    const v = parseFloat(text);
    if (Number.isFinite(v) && v > 0) onChange(clampLeverage(v));
    else setText(String(lev));
  };
  return (
    <div className="lev-lev">
      <div className="lev-lev-row">
        <div className="lev-input">
          <input
            value={text}
            inputMode="numeric"
            aria-label="Leverage"
            disabled={disabled}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
          <b>×</b>
        </div>
        <input
          type="range"
          className="og-range lev-range"
          min={0}
          max={1000}
          step={1}
          value={Math.round(sliderFromLev(lev))}
          disabled={disabled}
          aria-label="Leverage slider"
          onChange={(e) => onChange(levFromSlider(Number(e.target.value)))}
        />
      </div>
      <div className="og-chips lev-quick" role="group" aria-label="Quick leverage">
        {QUICK_LEVERAGE.map((q) => (
          <button key={q} type="button" className={'og-chip' + (q === lev ? ' on' : '')} disabled={disabled} onClick={() => onChange(q)}>
            {q}×
          </button>
        ))}
      </div>
    </div>
  );
}

function LimitField({
  label,
  value,
  min,
  max,
  disabled,
  tone,
  note,
  onChange,
}: {
  label: string;
  value: number | null;
  min: number;
  max: number;
  disabled: boolean;
  tone: 'tp' | 'sl';
  note: string;
  onChange(v: number | null): void;
}) {
  const [text, setText] = useState(value === null ? '' : value.toFixed(2));
  // A lock (round start) also drops any half-typed text, so the field always shows the level in force.
  useEffect(() => setText(value === null ? '' : value.toFixed(2)), [value, disabled]);
  const commit = () => {
    const v = parseFloat(text);
    const next = text.trim() === '' || !Number.isFinite(v) || v <= 0 ? null : Math.round(Math.min(max, Math.max(min, v)) * 100) / 100;
    onChange(next);
    setText(next === null ? '' : next.toFixed(2));
  };
  return (
    <div className={`lev-limit ${tone}`}>
      <span className="lev-limit-label">{label}</span>
      <div className="lev-input">
        <input
          value={text}
          inputMode="decimal"
          placeholder="Off"
          aria-label={`${label} multiplier`}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        {(value !== null || text !== '') && <b>×</b>}
      </div>
      <small>
        {note}
        {value !== null && !disabled && (
          <button type="button" className="lev-x" aria-label={`Clear ${label}`} onClick={() => onChange(null)}>
            clear
          </button>
        )}
      </small>
    </div>
  );
}
