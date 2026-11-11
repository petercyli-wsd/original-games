import { useHost } from '@originals/game-sdk/react';
import {
  ActionButton,
  BetField,
  Board,
  ACCENTS,
  Caption,
  Chips,
  GameLayout,
  InfoModal,
  InfoSection,
  Label,
  PanelFoot,
  Readouts,
  RoundOver,
  StageTop,
  VolBadge,
  eventMs,
  fmtChance,
  fmtMult,
  useBetInput,
  useHistory,
  useHotkeys,
  useTicket,
  useTimers,
  useTurbo,
} from '@originals/game-sdk/ui';
import { formatAmount, type Volatility } from '@originals/game-sdk';
import { useMemo, useRef, useState } from 'react';
import Field, { type BustInfo } from './Board';
import {
  FREE_DROPS,
  MAX_WIN,
  RTP,
  TARGETS,
  afterSafeDrop,
  convexChance,
  hitsCap,
  landsSafe,
  samplePoint,
  swallowed,
  zones,
  type Pt,
  type Target,
} from './math';

type Phase = 'idle' | 'dropping' | 'checkpoint' | 'over';
type Outcome = 'red' | 'cashed' | 'full' | 'max';

/** Auto-drop: keep dropping while the next drop is at least this safe (null = off, 0 = to the end). */
type Auto = 'off' | '90' | '75' | 'all';
const AUTO_MIN: Record<Auto, number | null> = { off: null, '90': 0.9, '75': 0.75, all: 0 };
const AUTO_HINT: Record<Auto, string> = {
  off: 'you drop each dot',
  '90': 'while ≥ 90% green',
  '75': 'while ≥ 75% green',
  all: 'to the end',
};

interface Round {
  target: Target;
  stake: number;
  points: Pt[];
  cash: number;
  outcome: Outcome | null;
  bust: BustInfo | null;
  /** Red share of the square for the round's last drop (the one that lost, or the one that placed the last dot). */
  lastQ: number;
}

const MAX_TEXT = `${MAX_WIN.toLocaleString('en-US')}×`;
const RULE = 'Every dot must land in green; one dot in red loses.';

const outcomeTitle = (o: Outcome, target: Target) =>
  ({
    red: 'Landed in red',
    cashed: 'Cashed out',
    full: `All ${target} dots landed green`,
    max: 'Max win reached',
  })[o];

function volatilityOf(target: Target): Volatility {
  const p = convexChance(target);
  return p > 0.25 ? 'low' : p > 0.06 ? 'medium' : p > 0.015 ? 'high' : 'extreme';
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [target, setTarget] = useState<Target>(6);
  const [auto, setAuto] = useState<Auto>('off');
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [dropping, setDropping] = useState(false);
  const [cursor, setCursor] = useState<Pt>({ x: 0.5, y: 0.5 });
  const [infoOpen, setInfoOpen] = useState(false);

  // The drop in flight is decided the moment it starts, so leaving mid-drop
  // settles at its real result, never at the safer pre-drop value.
  // `resolved` is the open ticket's value right now, set synchronously at every
  // transition (stake placed, step drawn). The ticket reads only this ref: a
  // value derived from rendered state can be one render stale, e.g. the last
  // round's cash-out just after Bet again, if the game unmounts before the
  // next render.
  const resolved = useRef<number>(0);
  const ticket = useTicket(() => resolved.current);
  // Scheduled auto-drops read the latest setting, so switching auto off stops at the next checkpoint.
  const autoRef = useRef(auto);
  autoRef.current = auto;

  const dropMs = eventMs(turbo.turbo);
  const freeMs = eventMs(turbo.turbo, 200);
  const autoMs = turbo.turbo ? 160 : 520;
  const live = phase === 'dropping' || phase === 'checkpoint';

  const autoGo = (q: number, mode: Auto = autoRef.current) => {
    const min = AUTO_MIN[mode];
    return min !== null && 1 - q >= min;
  };

  function finish(r: Round, outcome: Outcome, cash: number, bust: BustInfo | null = null, lastQ = 0) {
    timers.clearAll();
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash, bust, lastQ });
    setDropping(false);
    setPhase('over');
  }

  /** Queues the next drop if the auto rule says so; the player can still cash out during the pause. */
  function scheduleAuto(r: Round, q: number, mode: Auto = autoRef.current) {
    if (!autoGo(q, mode)) return;
    timers.after(autoMs, () => {
      if (autoGo(q)) drop(r);
    });
  }

  function drop(r: Round) {
    timers.clearAll();
    const free = r.points.length < FREE_DROPS;
    const z = zones(r.points);
    const p = samplePoint(rng.next);
    const safe = landsSafe(z.hull, p);
    const cash = safe ? afterSafeDrop(r.cash, z.q) : 0;
    resolved.current = cash;
    setPhase('dropping');
    setDropping(true);
    setCursor(p);
    timers.after(free ? freeMs : dropMs, () => {
      setDropping(false);
      if (!safe) return finish(r, 'red', 0, { point: p, swallowed: swallowed(z.hull, p) }, z.q);
      const next = { ...r, points: [...r.points, p], cash };
      if (next.points.length >= r.target) return finish(next, 'full', cash, null, z.q);
      setRound(next);
      if (next.points.length < FREE_DROPS) return drop(next);
      const nz = zones(next.points);
      if (hitsCap(cash, nz.q)) return finish(next, 'max', cash);
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: cash, winChance: 1 - nz.q });
      scheduleAuto(next, nz.q);
    });
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    resolved.current = RTP;
    timers.clearAll();
    const r: Round = { target, stake: bet.value, points: [], cash: RTP, outcome: null, bust: null, lastQ: 0 };
    setRound(r);
    drop(r);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', round.cash);
  }

  function dropNext() {
    if (phase === 'checkpoint' && round) drop(round);
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    setRound(null);
    setDropping(false);
    setPhase('idle');
  }

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    apply();
    if (phase === 'over') clear();
  };

  function changeAuto(v: Auto) {
    setAuto(v);
    autoRef.current = v;
    // At a checkpoint, the new rule applies straight away.
    if (phase === 'checkpoint' && round) {
      timers.clearAll();
      scheduleAuto(round, zones(round.points).q, v);
    }
  }

  useHotkeys(
    {
      space: () => (phase === 'checkpoint' ? dropNext() : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const t = round?.target ?? target;
  const points = useMemo(() => round?.points ?? [], [round?.points]);
  const z = useMemo(() => zones(points), [points]);
  const n = points.length;
  const q = z.q;
  const free = n < FREE_DROPS;
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  // Exact only before the first drop (Valtr), so it is shown only then: in the idle preview and for the next bet.
  const chance = convexChance(t);
  const vol = volatilityOf(target);
  const outcome = round?.outcome ?? null;
  const autoOn = AUTO_MIN[auto] !== null;
  const autoNext = phase === 'checkpoint' && autoGo(q, auto);

  let status = `Ready · place ${t} dots`;
  if (phase === 'dropping') status = free ? `Free dot ${n + 1} of ${FREE_DROPS}` : `Dropping dot ${n + 1} of ${t}`;
  if (phase === 'checkpoint') status = autoNext ? `Auto-drop · dot ${n + 1} of ${t}` : `${n} of ${t} dots placed${autoOn ? ' · auto paused' : ''}`;
  if (phase === 'over' && outcome) status = `${outcomeTitle(outcome, t)} · ${n} of ${t} dots placed`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  // One chance for the finished round: how likely the dot that ended it was to land green.
  const overItem =
    outcome === 'red'
      ? { label: 'Dot landed in red', value: fmtChance(round?.lastQ ?? 0), tone: 'lose' as const }
      : outcome === 'full'
        ? { label: 'Last dot green', value: fmtChance(1 - (round?.lastQ ?? 0)), tone: 'chance' as const }
        : { label: 'Next dot green', value: fmtChance(1 - q), tone: 'chance' as const };

  const readouts =
    phase === 'idle'
      ? [{ label: 'Chance to place all', value: fmtChance(chance), tone: 'chance' as const }]
      : phase === 'over'
        ? [overItem]
        : [
            { label: 'Next dot green', value: fmtChance(1 - q), tone: 'chance' as const },
            { label: 'If it lands green', value: fmtMult(afterSafeDrop(cash, q)), tone: 'prize' as const },
          ];

  return (
    <GameLayout
      name="Convex"
      accent={ACCENTS.sky}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={vol} />}>Dots to place</Label>
          <Chips
            label="Dots to place"
            options={TARGETS.map((v) => ({ value: v, label: v, title: `Place ${v} dots, every one in green` }))}
            value={target}
            disabled={live}
            onChange={(v) => change(() => setTarget(v))}
          />

          <Label hint={AUTO_HINT[auto]}>Auto-drop</Label>
          <Chips
            label="Auto-drop"
            options={[
              { value: 'off' as Auto, label: 'Off' },
              { value: '90' as Auto, label: '≥90%', title: 'Keep dropping while the next dot is at least 90% likely to land green' },
              { value: '75' as Auto, label: '≥75%', title: 'Keep dropping while the next dot is at least 75% likely to land green' },
              { value: 'all' as Auto, label: 'All', title: 'Drop every dot to the end' },
            ]}
            value={auto}
            onChange={changeAuto}
          />

          {phase === 'checkpoint' ? (
            <>
              <ActionButton kind="cash" onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" onClick={dropNext}>
                {autoNext ? 'Auto-dropping…' : `Drop next · ${fmtChance(1 - q)} green`}
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
              {phase === 'dropping' ? 'Dropping…' : phase === 'over' ? 'Bet again' : 'Bet'}
            </ActionButton>
          )}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />

      <Readouts items={readouts} />

      <Board className="cvx-board">
        <Field
          target={t}
          points={points}
          zones={z}
          mode={phase === 'idle' ? 'idle' : phase === 'over' ? 'over' : 'live'}
          complete={outcome === 'full'}
          dropping={dropping}
          cursor={cursor}
          crossMs={free ? freeMs : dropMs}
          bust={round?.bust ?? null}
          chance={chance}
        />
        {phase === 'over' && round?.outcome && (
          <div className="cvx-over">
            <RoundOver
              key={history[0]?.id}
              title={outcomeTitle(round.outcome, t)}
              multiplier={round.cash}
              stake={round.stake}
              nextBet={bet.value}
              blocked={bet.blocked}
              onBetAgain={() => void start()}
              onClear={clear}
              placement="inline"
            />
          </div>
        )}
      </Board>

      <Caption>{RULE}</Caption>

      {infoOpen && (
        <InfoModal title="Convex" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              Dots drop at random into the square, one at a time. Each dot must land in the <b style={{ color: 'var(--win)' }}>green</b> zone. A dot
              that lands in <b style={{ color: 'var(--lose)' }}>red</b> loses the round. Place every dot you chose and the round pays out; or cash out
              after any dot.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick how many dots to place (4 to 8), then bet. More dots, more risk.</li>
              <li>The first three dots are free: they always land safe.</li>
              <li>From then on the square is split into green and red. After each green landing you can cash out (C) or drop the next dot (Space).</li>
              <li>A dot in red loses. When the last dot lands green, the round pays your cash-out automatically.</li>
              <li>
                Auto-drop keeps dropping for you while the next dot is at least as likely to land green as you chose (or to the end with <b>All</b>),
                then waits for you. You can still cash out between drops.
              </li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The <b style={{ color: 'var(--lose)' }}>red</b> share of the square is exactly the chance that the next dot loses, and the green share is
              the chance it lands safe. The screen shows the green share as the chance for the next dot.
            </p>
            <p>
              Why the zones look the way they do: the dots must stay the corners of the shape they make. Red is the inside of the shape, plus the
              shadow behind each dot (beyond both edges that meet at it). A dot landing in a shadow would pull the dot in front of it inside the shape,
              so that dot is ringed when it happens. Green is everywhere the new dot just becomes one more corner.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Valtr's theorem (1995): n uniform random points in a square are in convex position (every one a corner of their convex hull) with
              probability (C(2n−2, n−1) / n!)². For n = 4 this is Sylvester's four-point problem: 25/36. A subset of points in convex position is itself
              in convex position, so dropping dots until the first red one places all n exactly this often:
            </p>
            <table className="cvx-table">
              <thead>
                <tr>
                  <th>Dots</th>
                  {TARGETS.map((k) => (
                    <th key={k}>{k}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Chance to place all</td>
                  {TARGETS.map((k) => (
                    <td key={k}>{fmtChance(convexChance(k))}</td>
                  ))}
                </tr>
              </tbody>
            </table>
            <p>This chance is exact before the first drop. Once dots are down the game shows the exact chance for the next dot instead.</p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              A dot that lands green when the red share was q multiplies your cash-out by 1/(1−q). Every drop is therefore a fair bet: the cash-out is a
              martingale, and the round is worth {(RTP * 100).toFixed(0)}% of your stake however and whenever you cash out, with or without auto-drop.
            </p>
            <p>
              There is no fixed full prize. When the last dot lands, you are paid the cash-out at that moment, which grows by more after riskier drops.
              The screen always shows what cashing out pays now and what the next green landing would make it.
            </p>
            <p>
              The green patches can get very thin, so the round cashes out automatically before any drop that could pay more than{' '}
              {MAX_TEXT}. That is a stopping rule too, so it doesn't change the return.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
