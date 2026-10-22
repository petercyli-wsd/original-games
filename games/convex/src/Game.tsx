import { useHost } from '@originals/game-sdk/react';
import {
  ActionButton,
  BetField,
  Board,
  Caption,
  ChanceBar,
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
  ARENAS,
  FREE_DROPS,
  MAX_WIN,
  POLYGON_NAME,
  RTP,
  TARGETS,
  afterSafeDrop,
  averageFullPrize,
  convexChance,
  hitsCap,
  landsSafe,
  samplePoint,
  swallowed,
  zones,
  type Arena,
  type Pt,
  type Target,
} from './math';

type Phase = 'idle' | 'dropping' | 'checkpoint' | 'over';
type Outcome = 'inside' | 'swallow' | 'cashed' | 'full' | 'max';

/** Auto-drop: keep dropping while the next drop is at least this safe (null = off, 0 = to the end). */
type Auto = 'off' | '90' | '75' | 'all';
const AUTO_MIN: Record<Auto, number | null> = { off: null, '90': 0.9, '75': 0.75, all: 0 };
const AUTO_HINT: Record<Auto, string> = {
  off: 'you drop each point',
  '90': 'while ≥ 90% safe',
  '75': 'while ≥ 75% safe',
  all: 'to the end',
};

interface Round {
  arena: Arena;
  target: Target;
  stake: number;
  points: Pt[];
  cash: number;
  outcome: Outcome | null;
  bust: BustInfo | null;
}

const ACCENT = '#43aa8b';

const outcomeTitle = (o: Outcome, target: Target) =>
  ({
    inside: 'Landed inside',
    swallow: 'Corner swallowed',
    cashed: 'Cashed out',
    full: `Convex ${POLYGON_NAME[target]}`,
    max: 'Max win reached',
  })[o];

function volatilityOf(arena: Arena, target: Target): Volatility {
  const p = convexChance(target, arena);
  return p > 0.25 ? 'low' : p > 0.06 ? 'medium' : p > 0.015 ? 'high' : 'extreme';
}

const ARENA_ICON: Record<Arena, JSX.Element> = {
  square: <rect x="1.5" y="1.5" width="11" height="11" rx="1" />,
  triangle: <polygon points="7,1.5 13,12.5 1,12.5" />,
};

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [arena, setArena] = useState<Arena>('square');
  const [target, setTarget] = useState<Target>(6);
  const [auto, setAuto] = useState<Auto>('off');
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [dropping, setDropping] = useState(false);
  const [cursor, setCursor] = useState<Pt>({ x: 0.5, y: 0.5 });
  const [infoOpen, setInfoOpen] = useState(false);

  // The drop in flight is decided the moment it starts, so leaving mid-drop
  // settles at its real result, never at the safer pre-drop value.
  const resolved = useRef<number>(0);
  const ticket = useTicket(() => (phase === 'dropping' ? resolved.current : round?.cash ?? 0));
  // Scheduled auto-drops read the latest setting, so switching auto off stops at the next checkpoint.
  const autoRef = useRef(auto);
  autoRef.current = auto;

  const dropMs = turbo.turbo ? 190 : 760;
  const freeMs = turbo.turbo ? 110 : 340;
  const autoMs = turbo.turbo ? 160 : 520;
  const live = phase === 'dropping' || phase === 'checkpoint';

  const autoGo = (q: number, mode: Auto = autoRef.current) => {
    const min = AUTO_MIN[mode];
    return min !== null && 1 - q >= min;
  };

  function finish(r: Round, outcome: Outcome, cash: number, bust: BustInfo | null = null) {
    timers.clearAll();
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash, bust });
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
    const z = zones(r.points, r.arena);
    const p = samplePoint(r.arena, rng.next);
    const safe = landsSafe(z.hull, p);
    const cash = safe ? afterSafeDrop(r.cash, z.q) : 0;
    resolved.current = cash;
    setPhase('dropping');
    setDropping(true);
    setCursor(p);
    timers.after(free ? freeMs : dropMs, () => {
      setDropping(false);
      if (!safe) {
        const lost = swallowed(z.hull, p);
        return finish(r, lost.length ? 'swallow' : 'inside', 0, { point: p, swallowed: lost });
      }
      const next = { ...r, points: [...r.points, p], cash };
      if (next.points.length >= r.target) return finish(next, 'full', cash);
      setRound(next);
      if (next.points.length < FREE_DROPS) return drop(next);
      const nz = zones(next.points, r.arena);
      if (hitsCap(cash, nz.q)) return finish(next, 'max', cash);
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: cash, winChance: 1 - nz.q });
      scheduleAuto(next, nz.q);
    });
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const r: Round = { arena, target, stake: bet.value, points: [], cash: RTP, outcome: null, bust: null };
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
      scheduleAuto(round, zones(round.points, round.arena).q, v);
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
  const a = round?.arena ?? arena;
  const t = round?.target ?? target;
  const points = useMemo(() => round?.points ?? [], [round?.points]);
  const z = useMemo(() => zones(points, a), [points, a]);
  const n = points.length;
  const q = z.q;
  const free = n < FREE_DROPS;
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const chance = convexChance(t, a);
  const vol = volatilityOf(arena, target);
  const outcome = round?.outcome ?? null;
  const autoOn = AUTO_MIN[auto] !== null;
  const autoNext = phase === 'checkpoint' && autoGo(q, auto);

  let status = `Ready · ${t} corners in a ${a}`;
  if (phase === 'dropping') status = free ? `Free drop ${n + 1} of ${FREE_DROPS}` : `Dropping point ${n + 1} of ${t}`;
  if (phase === 'checkpoint') status = autoNext ? `Auto-drop · point ${n + 1} of ${t}` : `Checkpoint · ${n} of ${t} corners${autoOn ? ' · auto paused' : ''}`;
  if (phase === 'over' && outcome) status = `${outcomeTitle(outcome, t)} · ${n} corners`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  const readouts =
    phase === 'idle'
      ? [
          { label: 'Chance to complete', value: fmtChance(chance), sub: `${t} corners in a ${a}`, tone: 'chance' as const },
          { label: 'Cash out now', value: '—', sub: 'from corner 3 on', tone: 'cash' as const },
          { label: 'Avg full prize', value: fmtMult(averageFullPrize(t, a)), sub: `if all ${t} are corners`, tone: 'prize' as const },
        ]
      : phase === 'over'
        ? [
            { label: 'Corners built', value: `${n} / ${t}`, sub: outcome === 'full' ? `convex ${POLYGON_NAME[t]}` : `${fmtChance(chance)} to complete`, tone: 'chance' as const },
            { label: 'Paid', value: fmtMult(cash), sub: formatAmount(stake * cash, 2), tone: 'cash' as const },
            { label: 'Avg full prize', value: fmtMult(averageFullPrize(t, a)), sub: `if all ${t} are corners`, tone: 'prize' as const },
          ]
        : [
            { label: 'Next drop safe', value: fmtChance(1 - q), sub: free ? 'free drop' : 'the green area', tone: 'chance' as const },
            { label: 'Cash out now', value: fmtMult(cash), sub: formatAmount(stake * cash, 2), tone: 'cash' as const },
            { label: 'If it lands safe', value: fmtMult(afterSafeDrop(cash, q)), sub: `corner ${Math.min(n + 1, t)} of ${t}`, tone: 'prize' as const },
          ];

  return (
    <GameLayout
      name="Convex"
      accent={ACCENT}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={vol} />}>Arena</Label>
          <Chips
            label="Arena"
            options={ARENAS.map((v) => ({
              value: v,
              label: (
                <span className="cvx-chip">
                  <svg viewBox="0 0 14 14" aria-hidden="true">
                    {ARENA_ICON[v]}
                  </svg>
                  {v === 'square' ? 'Square' : 'Triangle'}
                </span>
              ),
            }))}
            value={arena}
            disabled={live}
            onChange={(v) => change(() => setArena(v))}
          />

          <Label hint="first 3 drops are free">Corners to build</Label>
          <Chips
            label="Corners to build"
            options={TARGETS.map((v) => ({ value: v, label: v, title: `Convex ${POLYGON_NAME[v]}` }))}
            value={target}
            disabled={live}
            onChange={(v) => change(() => setTarget(v))}
          />

          <Label hint={AUTO_HINT[auto]}>Auto-drop</Label>
          <Chips
            label="Auto-drop"
            options={[
              { value: 'off' as Auto, label: 'Off' },
              { value: '90' as Auto, label: '≥90%', title: 'Keep dropping while the next drop is at least 90% safe' },
              { value: '75' as Auto, label: '≥75%', title: 'Keep dropping while the next drop is at least 75% safe' },
              { value: 'all' as Auto, label: 'All', title: 'Drop every point to the end' },
            ]}
            value={auto}
            onChange={changeAuto}
          />

          <dl className="og-stats">
            <dt>Chance to complete</dt>
            <dd>{fmtChance(convexChance(target, arena))}</dd>
            <dt>Avg full prize</dt>
            <dd>{fmtMult(averageFullPrize(target, arena))}</dd>
          </dl>

          {phase === 'checkpoint' ? (
            <>
              <ActionButton kind="cash" onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" onClick={dropNext}>
                {autoNext ? 'Auto-dropping…' : `Drop next · ${fmtChance(1 - q)} safe`}
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
          arena={a}
          target={t}
          points={points}
          zones={z}
          mode={phase === 'idle' ? 'idle' : phase === 'over' ? 'over' : 'live'}
          complete={outcome === 'full'}
          dropping={dropping}
          cursor={cursor}
          crossMs={free ? freeMs : dropMs}
          fadeMs={turbo.turbo ? 90 : 260}
          bust={round?.bust ?? null}
          chance={chance}
        />
        {/* The result card covers only the legend band under the arena (in flow on narrow frames). */}
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

      <div className="cvx-foot">
        {live ? (
          <ChanceBar
            p={1 - q}
            label="Next drop lands safe"
            note={
              free
                ? 'The first three drops are free: any three points make a triangle.'
                : 'Green: it becomes a new corner. Red: it lands inside your shape or swallows a corner.'
            }
          />
        ) : (
          <Caption>
            Every point must stay a corner of the shape. Valtr: {t} random points in a {a} form a convex {POLYGON_NAME[t]} {fmtChance(chance)} of the
            time. RTP {(RTP * 100).toFixed(0)}%.
          </Caption>
        )}
      </div>

      {infoOpen && (
        <InfoModal title="Convex" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              Points drop at random into the arena. Every point must stay a corner of the shape they make (their convex hull). Build a convex polygon with
              the number of corners you chose and it pays out.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick an arena and how many corners to build, then bet.</li>
              <li>The first three points are free: any three points make a triangle.</li>
              <li>After each safe drop you can cash out (C), or drop the next point (Space).</li>
              <li>If a point lands inside your shape, or knocks an existing corner inside, the round is lost. Reach the target and it pays out automatically.</li>
              <li>
                Auto-drop keeps dropping for you while the next drop is at least as safe as you chose (or to the end with <b>All</b>), then waits for you.
                You can still cash out between drops.
              </li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              Extend every edge of your shape across the arena (the dashed lines). A point beyond <b>exactly one</b> edge slots in as a new corner between
              that edge's ends: those are the <b style={{ color: 'var(--green)' }}>green caps</b>, labelled with their share of the arena. Everything else is{' '}
              <b style={{ color: 'var(--red)' }}>red</b>: inside the shape, or in the cone behind a corner (beyond both of its edges), which swallows that
              corner.
            </p>
            <p>The red share of the arena is exactly the chance of losing the next drop. Each grid cell is 1% of the arena, so you can count it.</p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Valtr's theorem (1995): n uniform random points in a square are in convex position with probability (C(2n−2, n−1) / n!)². In a triangle it
              is 2<sup>n</sup>·(3n−3)! / ((n−1)!³·(2n)!). For n = 4 this is Sylvester's four-point problem: 25/36 in a square, 2/3 in a triangle. A subset
              of points in convex position is itself in convex position, so dropping points one at a time reaches n corners exactly this often.
            </p>
            <table className="cvx-table">
              <thead>
                <tr>
                  <th>Corners</th>
                  {TARGETS.map((k) => (
                    <th key={k}>{k}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ARENAS.map((ar) => (
                  <tr key={ar}>
                    <td>{ar === 'square' ? 'Square' : 'Triangle'}</td>
                    {TARGETS.map((k) => (
                      <td key={k}>{fmtChance(convexChance(k, ar))}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Surviving a drop whose red area is a share q of the arena multiplies your cash-out by 1/(1−q). Every drop is therefore a fair bet: the
              cash-out is a martingale, and the round is worth {(RTP * 100).toFixed(0)}% of your stake however and whenever you cash out, with or without
              auto-drop. The full prize depends on how the shape grew; on average it is {(RTP * 100).toFixed(0)}% ÷ the chance to complete.
            </p>
            <p>
              The safe caps can get very thin, so the round cashes out automatically before any drop that could pay more than{' '}
              {MAX_WIN.toLocaleString('en-US')}×. That is a stopping rule too, so it doesn't change the return.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
