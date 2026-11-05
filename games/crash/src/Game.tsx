import { formatAmount } from '@originals/game-sdk';
import { useHost } from '@originals/game-sdk/react';
import {
  ACCENTS,
  ActionButton,
  AutoBetControls,
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
  VolBadge,
  fmtChance,
  eventMs,
  useAutoBet,
  useBetInput,
  useHotkeys,
  useTicket,
  useTurbo,
} from '@originals/game-sdk/ui';
import { useEffect, useRef, useState } from 'react';
import Chart, { type ChartState } from './Chart';
import {
  CAP,
  MAX_MULTIPLIER,
  MIN_TARGET,
  RTP,
  autoEnd,
  cashAt,
  centsAt,
  clampTarget,
  crashCents,
  endTime,
  fmtX,
  levelOf,
  nextMilestone,
  shownCrash,
  targetForChance,
  targetTime,
  winChance,
} from './math';

const ACCENT = ACCENTS.amber;
const QUICK = [150, 200, 300, 1000, 10000];

type Phase = 'idle' | 'live' | 'reveal' | 'over';
type Outcome = 'cashed' | 'crashed' | 'max';

interface Flight {
  id: number;
  stake: number;
  /** Crash point in cents, fixed when the bet is placed. */
  crash: number;
  /** Auto cash-out target in cents, or null for a hand cash-out. */
  target: number | null;
  auto: boolean;
  /** Wall clock (performance.now) at launch, and the flight-time speed-up. */
  start: number;
  speed: number;
  phase: Phase;
  /** Flight time shown on the graph (ms). */
  tau: number;
  cash: { tau: number; cents: number } | null;
  /** After a cash-out, the rest of the flight fast-forwards to the crash. */
  reveal: { wall: number; from: number; ms: number } | null;
  outcome: Outcome | null;
  payout: number;
}

interface Past {
  id: number;
  crash: number;
  won: boolean;
}

const easeInOut = (p: number) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);

export default function Game() {
  const { rng } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();

  const [target, setTarget] = useState(200);
  const [autoCash, setAutoCash] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [, setFrame] = useState(0);
  const [past, setPast] = useState<Past[]>([]);
  const [infoOpen, setInfoOpen] = useState(false);

  const flight = useRef<Flight | null>(null);
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

  // Leaving mid-flight settles as if the round ran on: at the auto target if
  // one is set (the crash point is already fixed), else a cash-out right now,
  // which the player could have clicked. Both are stopping rules worth 99%.
  const ticket = useTicket(() => {
    const f = flight.current;
    if (!f || f.phase !== 'live') return 0;
    if (f.target !== null) {
      const end = autoEnd(f.target, f.crash);
      return end.kind === 'crashed' ? 0 : end.cents / 100;
    }
    return cashAt((performance.now() - f.start) * f.speed, f.crash) / 100;
  });

  function finish(f: Flight, outcome: Outcome) {
    f.phase = 'over';
    f.outcome = outcome;
    f.reveal = null;
    setPast((p) => [{ id: f.id, crash: f.crash, won: f.payout > 0 }, ...p].slice(0, 18));
    setPhase('over');
    setFrame((x) => x + 1);
    const resolve = done.current;
    done.current = null;
    if (resolve) {
      // Auto bets hold the result on screen briefly before the next launch.
      const hold = f.auto ? (turbo.turbo ? 120 : 450) : 0;
      window.setTimeout(() => resolve(f.payout), hold);
    }
  }

  function cashAtPoint(f: Flight, tau: number, cents: number, now: number) {
    f.cash = { tau, cents };
    f.payout = cents / 100;
    ticket.settle(f.payout);
    const rest = endTime(f.crash) - tau;
    if (rest <= 0) return finish(f, f.crash >= CAP ? 'max' : 'cashed');
    f.phase = 'reveal';
    f.tau = tau;
    f.reveal = { wall: now, from: tau, ms: Math.max(140, Math.min(eventMs(turbo.turbo), rest / f.speed)) };
    setPhase('reveal');
  }

  function loop() {
    const f = flight.current;
    if (!f || !alive.current) return;
    const now = performance.now();
    const end = endTime(f.crash);
    if (f.phase === 'live') {
      const tau = (now - f.start) * f.speed;
      if (f.target !== null && f.crash >= f.target && tau >= targetTime(f.target)) {
        cashAtPoint(f, targetTime(f.target), f.target, now);
      } else if (tau >= end) {
        f.tau = end;
        if (f.crash >= CAP) {
          // The cap: whoever is still in is paid 1,000,000×.
          f.cash = { tau: end, cents: CAP };
          f.payout = MAX_MULTIPLIER;
          ticket.settle(f.payout);
          return finish(f, 'max');
        }
        f.payout = 0;
        ticket.settle(0);
        return finish(f, 'crashed');
      } else {
        f.tau = tau;
      }
    }
    if (f.phase === 'reveal' && f.reveal) {
      const p = Math.min(1, (now - f.reveal.wall) / f.reveal.ms);
      f.tau = f.reveal.from + (end - f.reveal.from) * easeInOut(p);
      if (p >= 1) {
        f.tau = end;
        return finish(f, f.crash >= CAP ? 'max' : 'cashed');
      }
    }
    setFrame((x) => x + 1);
    raf.current = requestAnimationFrame(loop);
  }

  async function launch(stake: number, isAuto: boolean): Promise<number | null> {
    const cur = flight.current;
    if (cur && (cur.phase === 'live' || cur.phase === 'reveal')) return null;
    if (!(await ticket.place(stake))) return null;
    const f: Flight = {
      id: ++seq.current,
      stake,
      crash: crashCents(rng.next()),
      target: isAuto || autoCash ? target : null,
      auto: isAuto,
      start: performance.now(),
      speed: turbo.turbo ? 4 : 1,
      phase: 'live',
      tau: 0,
      cash: null,
      reveal: null,
      outcome: null,
      payout: 0,
    };
    flight.current = f;
    setPhase('live');
    cancelAnimationFrame(raf.current);
    const result = new Promise<number>((res) => (done.current = res));
    loop();
    return result;
  }

  function cashOut() {
    const f = flight.current;
    if (!f || f.phase !== 'live' || f.auto) return;
    const now = performance.now();
    const tau = (now - f.start) * f.speed;
    // If the auto target was passed between frames, it fired first.
    if (f.target !== null && f.crash >= f.target && tau >= targetTime(f.target)) return cashAtPoint(f, targetTime(f.target), f.target, now);
    const k = cashAt(tau, f.crash);
    if (k < MIN_TARGET) return; // too early (1.00×), or it already crashed
    cashAtPoint(f, tau, k, now);
  }

  const auto = useAutoBet({ bet, play: (stake) => launch(stake, true), turbo: turbo.turbo });

  const f = flight.current;
  const flying = phase === 'live' || phase === 'reveal';
  const lock = flying || auto.running;

  function clear() {
    if (flying) return;
    flight.current = null;
    setPhase('idle');
  }
  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    apply();
    if (phase === 'over') clear();
  };
  const mode = auto.mode;
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
          else if (!bet.blocked && !flying) auto.start();
          return;
        }
        if (phase === 'live') cashOut();
        else if (!flying && !bet.blocked) void launch(bet.value, false);
      },
      cashOut: () => mode === 'manual' && cashOut(),
    },
    !infoOpen,
  );

  // Linked inputs: target multiplier ⇄ win chance.
  const [targetText, setTargetText] = useState((target / 100).toFixed(2));
  const [chanceText, setChanceText] = useState((winChance(target) * 100).toFixed(4));
  useEffect(() => {
    setTargetText((target / 100).toFixed(2));
    setChanceText(trimPct(winChance(target) * 100));
  }, [target]);
  const commitTarget = (cents: number) => change(() => setTarget(cents));

  const targetOn = mode === 'auto' || autoCash;
  const shownTarget = f && phase !== 'idle' ? f.target : targetOn ? target : null;
  const stake = f?.stake ?? bet.value;

  // Live numbers.
  const k = f ? Math.min(Math.max(100, f.crash), centsAt(f.tau)) : 100;
  const liveCents = f && phase === 'live' ? k : null;
  const milestone = liveCents !== null ? (f!.target !== null && f!.target > liveCents ? f!.target : nextMilestone(liveCents)) : null;

  // After a cash-out or a crash the readout shows the result, not a live-looking chance.
  const resultItem =
    f && phase === 'reveal' && f.cash
      ? { label: 'Cashed out', value: fmtX(f.cash.cents / 100), tone: 'win' as const }
      : f && phase === 'over'
        ? f.payout > 0
          ? { label: f.outcome === 'max' ? 'Max win' : 'Cashed out', value: fmtX(f.outcome === 'max' ? MAX_MULTIPLIER : f.cash ? f.cash.cents / 100 : 0), tone: 'win' as const }
          : { label: 'Crashed at', value: fmtX(shownCrash(f.crash)), tone: 'lose' as const }
        : null;

  // The odds picture: chance of reaching the target (or next milestone) from the line's current point.
  // Idle: the whole-bet chance. After the round: the bet's chance, coloured by the result.
  let reachP: number | null = null;
  let reachTone: 'idle' | 'live' | 'won' | 'lost' = 'idle';
  let reachLabel = '';
  if (liveCents !== null && milestone !== null) {
    reachP = liveCents / milestone;
    reachTone = 'live';
    reachLabel = `Chance of reaching ${fmtX(milestone / 100)} from here`;
  } else if (f && phase !== 'idle') {
    const ref = f.target ?? f.cash?.cents ?? null;
    reachP = ref !== null ? winChance(ref) : null;
    reachTone = f.payout > 0 ? 'won' : phase === 'over' ? 'lost' : 'won';
    reachLabel = 'Chance the bet wins';
  } else {
    reachP = targetOn ? winChance(target) : winChance(200);
    reachLabel = targetOn ? 'Win chance' : 'Chance of reaching 2.00×';
  }

  const chartState: ChartState = !f || phase === 'idle' ? 'idle' : f.phase === 'over' ? (f.outcome === 'max' ? 'max' : 'crashed') : 'live';

  let status = targetOn ? `Auto cash-out at ${fmtX(target / 100)}` : 'Place a bet to launch';
  let tone: 'idle' | 'live' | 'won' | 'lost' = 'idle';
  if (f && phase === 'live') {
    status = `In flight · ${fmtX(k / 100)}`;
    tone = 'live';
  } else if (f && phase === 'reveal' && f.cash) {
    status = `Cashed out @ ${fmtX(f.cash.cents / 100)}`;
    tone = 'won';
  } else if (f && phase === 'over') {
    if (f.outcome === 'max') status = `Max win · ${fmtX(MAX_MULTIPLIER)}`;
    else status = f.cash ? `Cashed ${fmtX(f.cash.cents / 100)} · crashed @ ${fmtX(shownCrash(f.crash))}` : `Crashed @ ${fmtX(shownCrash(f.crash))}`;
    tone = f.payout > 0 ? 'won' : 'lost';
  }

  const targetField = (
    <TargetField
      target={target}
      targetText={targetText}
      chanceText={chanceText}
      setTargetText={setTargetText}
      setChanceText={setChanceText}
      commit={commitTarget}
      disabled={lock || !targetOn}
      locked={lock}
      toggle={mode === 'manual' ? { on: autoCash, set: (v) => change(() => setAutoCash(v)) } : null}
    />
  );

  const profit = Math.max(0, bet.value * (target / 100) - bet.value);
  const stats = (
    <dl className="og-stats">
      <dt>Profit on win</dt>
      <dd>{targetOn ? '+' + formatAmount(profit, 2) : '—'}</dd>
    </dl>
  );

  return (
    <GameLayout
      name="Crash"
      accent={ACCENT}
      className="crash-game"
      panel={
        <>
          <ModeTabs auto={auto} disabled={flying} />
          <BetField bet={bet} disabled={lock} />
          {mode === 'manual' ? (
            <>
              {targetField}
              {stats}
              {phase === 'live' ? (
                <ActionButton kind="cash" disabled={k < MIN_TARGET} onClick={cashOut}>
                  Cash out <span>{formatAmount(stake * (k / 100), 2)}</span>
                </ActionButton>
              ) : phase === 'reveal' && f?.cash ? (
                <ActionButton kind="secondary" disabled>
                  Cashed out · {formatAmount(stake * (f.cash.cents / 100), 2)}
                </ActionButton>
              ) : (
                <ActionButton disabled={!!bet.blocked} onClick={() => void launch(bet.value, false)}>
                  {phase === 'over' ? 'Bet again' : 'Bet'}
                </ActionButton>
              )}
              {bet.blocked && !flying && <p className="crash-blocked">{bet.blocked}</p>}
            </>
          ) : (
            <AutoBetControls auto={auto} disabled={!!bet.blocked}>
              {targetField}
            </AutoBetControls>
          )}
          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <div className="og-stage-top">
        <span className={`og-status ${tone}`} aria-live="polite">
          {status}
        </span>
        <div className="og-history crash-history" aria-label="Recent crash points">
          {past.map((p) => (
            <span key={p.id} className={'og-hist ' + (p.won ? 'w' : 'l')} title={p.won ? 'You cashed out in time' : 'Crashed first'}>
              {fmtX(shownCrash(p.crash))}
            </span>
          ))}
        </div>
      </div>

      <Readouts
        items={[
          resultItem ??
            (liveCents !== null && milestone !== null
              ? { label: `Reach ${fmtX(milestone / 100)}`, value: fmtChance(liveCents / milestone), tone: 'chance' as const }
              : targetOn
                ? { label: 'Win chance', value: fmtChance(winChance(target)), tone: 'chance' as const }
                : { label: 'Reach 2.00×', value: fmtChance(winChance(200)), tone: 'chance' as const }),
          ...(shownTarget !== null ? [{ label: 'Target pays', value: formatAmount(stake * (shownTarget / 100), 2), tone: 'prize' as const }] : []),
        ]}
      />

      <Board className="crash-board">
        {f && phase === 'over' && f.auto && <InstantResult multiplier={f.payout} stake={f.stake} id={f.id} />}
        <Chart state={chartState} tau={f && phase !== 'idle' ? f.tau : 0} target={shownTarget} cash={f && phase !== 'idle' ? f.cash : null}>
          <BigReadout f={phase === 'idle' ? null : f} k={k} />
        </Chart>
      </Board>

      <div
        className={`og-chance crash-reach ${reachTone}`}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={reachP ?? 0}
        aria-label={reachLabel}
        style={reachP === null ? { visibility: 'hidden' } : undefined}
      >
        <div className="og-chance-track">
          <i style={{ width: `${Math.min(1, Math.max(0, reachP ?? 0)) * 100}%` }} />
        </div>
      </div>

      {phase === 'over' && f && !f.auto && (
        <RoundOver
          key={f.id}
          title={f.outcome === 'max' ? 'Max win' : f.cash ? 'Cashed out' : `Crashed @ ${fmtX(shownCrash(f.crash))}`}
          multiplier={f.payout}
          stake={f.stake}
          nextBet={bet.value}
          blocked={bet.blocked}
          onBetAgain={() => void launch(bet.value, false)}
          onClear={clear}
          placement="inline"
        />
      )}
      <Caption>Cash out before the curve crashes and win your bet times the multiplier.</Caption>

      {infoOpen && (
        <InfoModal title="Crash" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>A multiplier climbs from 1.00× and crashes at a random point. Cash out before the crash to win your bet times the multiplier.</p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Enter a bet and press Bet (or Space). The curve launches.</li>
              <li>Press Cash out (Space or C) at any moment to lock in the multiplier on screen.</li>
              <li>
                Optional: switch on <b>Auto cash-out</b> and set a target (or a win chance). The round cashes out by itself the moment the curve reaches it, and you
                can still cash out earlier by hand.
              </li>
              <li>Auto mode runs a series of bets at your target, with on-win / on-loss stake changes and stop limits.</li>
              <li>After a round: Bet again (Space) or Clear board (Esc). Turbo runs the clock four times faster.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The curve reaches any height x with chance {(RTP * 100).toFixed(0)}% ÷ x. In flight, the chance above the graph is that of reaching the next
              milestone (or your target) from where you are now: the current value divided by the milestone.
            </p>
            <p>The history row shows past crash points: green if you cashed out in time, red if the curve crashed first. The amber line is your auto cash-out target.</p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              The crash point is C = 0.99 ÷ U for a uniform random U, rounded down to the cent, so P(C ≥ x) = 0.99 ÷ x for every x. One time in a hundred it
              crashes instantly. The curve follows m(t) = e<sup>0.00006·t</sup> (t in ms): 2× after about 11.6 s, 10× after 38 s.
            </p>
            <p>
              Cashing out at x pays x with probability 0.99 ÷ x, which is 0.99 for every x. The value of a bet that is still flying at x is x itself, and the chance
              of climbing on from x to y is x ÷ y, so the value is a martingale: no timing, no target and no pattern of play can change the return.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              RTP is exactly {(RTP * 100).toFixed(0)}% for every strategy. Targets run from 1.01× (98.02% chance) to {fmtX(MAX_MULTIPLIER)}. A curve that reaches
              {' '}
              {fmtX(MAX_MULTIPLIER)} pays out automatically there; that cap is the largest possible win. If the curve sits exactly on your target when it crashes,
              you win. The crash point is drawn when your bet is placed; leaving mid-flight settles at your auto target, or as a cash-out at that moment.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}

function trimPct(pct: number) {
  return pct >= 1 ? pct.toFixed(2) : pct.toPrecision(3);
}

function TargetField({
  target,
  targetText,
  chanceText,
  setTargetText,
  setChanceText,
  commit,
  disabled,
  locked,
  toggle,
}: {
  target: number;
  targetText: string;
  chanceText: string;
  setTargetText(s: string): void;
  setChanceText(s: string): void;
  commit(cents: number): void;
  disabled: boolean;
  locked: boolean;
  toggle: { on: boolean; set(on: boolean): void } | null;
}) {
  return (
    <div className={'crash-target-field' + (disabled && !locked ? ' off' : '')}>
      <Label
        hint={
          toggle ? (
            <label className="crash-switch">
              <input type="checkbox" checked={toggle.on} disabled={locked} onChange={(e) => toggle.set(e.target.checked)} />
              <i />
              <span>{toggle.on ? <VolBadge level={levelOf(target)} /> : 'off'}</span>
            </label>
          ) : (
            <VolBadge level={levelOf(target)} />
          )
        }
      >
        {toggle ? 'Auto cash-out' : 'Cash out at'}
      </Label>
      <div className="crash-pair">
        <div className="crash-input">
          <input
            value={targetText}
            inputMode="decimal"
            aria-label="Cash out at multiplier"
            disabled={disabled}
            onChange={(e) => setTargetText(e.target.value)}
            onBlur={() => {
              const x = parseFloat(targetText);
              if (Number.isFinite(x) && x > 0) commit(clampTarget(x));
              else setTargetText((target / 100).toFixed(2));
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
          <b>×</b>
        </div>
        <div className="crash-input">
          <input
            value={chanceText}
            inputMode="decimal"
            aria-label="Win chance"
            disabled={disabled}
            onChange={(e) => setChanceText(e.target.value)}
            onBlur={() => {
              const c = parseFloat(chanceText);
              if (Number.isFinite(c) && c > 0) commit(targetForChance(c));
              else setChanceText(trimPct(winChance(target) * 100));
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
          <b>%</b>
        </div>
      </div>
      <div className="og-chips crash-quick" role="group" aria-label="Quick targets">
        {QUICK.map((c) => (
          <button key={c} type="button" className={'og-chip' + (c === target ? ' on' : '')} disabled={disabled} onClick={() => commit(c)}>
            {c >= 1000 ? `${c / 100}×` : fmtX(c / 100).replace('.00', '')}
          </button>
        ))}
        <button type="button" className="og-chip" disabled={disabled} onClick={() => commit(clampTarget(target / 200))} title="Halve the target">
          ½
        </button>
        <button type="button" className="og-chip" disabled={disabled} onClick={() => commit(clampTarget(target / 50))} title="Double the target">
          ×2
        </button>
      </div>
    </div>
  );
}

/** The one hero number: the live multiplier. After a crash it stays, in --lose (or --win if cashed out first), until the next bet. */
function BigReadout({ f, k }: { f: Flight | null; k: number }) {
  if (!f) return <div className="crash-big idle">{fmtX(1)}</div>;
  if (f.phase === 'over') {
    return <div className={'crash-big ' + (f.payout > 0 ? 'won' : 'lost')}>{fmtX(f.outcome === 'max' ? MAX_MULTIPLIER : shownCrash(f.crash))}</div>;
  }
  return <div className="crash-big live">{fmtX(k / 100)}</div>;
}
