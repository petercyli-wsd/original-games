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
import Field from './Board';
import {
  MAX_WIN,
  RTP,
  TARGETS,
  afterSafeDrop,
  averageFullPrize,
  completeChance,
  core as coreOf,
  hitsCap,
  meets,
  risk,
  shareChance,
  type Interval,
  type Target,
} from './math';

type Phase = 'idle' | 'dropping' | 'checkpoint' | 'over';
type Outcome = 'left' | 'right' | 'cashed' | 'full' | 'max';

interface Round {
  target: Target;
  stake: number;
  intervals: Interval[];
  cash: number;
  outcome: Outcome | null;
  bust: Interval | null;
}

const ACCENT = '#e76f51';

const outcomeTitle = (o: Outcome, target: Target) =>
  ({
    left: 'Missed left of the core',
    right: 'Missed right of the core',
    cashed: 'Cashed out',
    full: `All ${target} share a point`,
    max: 'Max win reached',
  })[o];

function volatilityOf(target: Target): Volatility {
  const p = shareChance(target);
  return p > 0.3 ? 'low' : p > 0.1 ? 'medium' : p > 0.015 ? 'high' : 'extreme';
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [target, setTarget] = useState<Target>(5);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [pending, setPending] = useState<Interval | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  // The drop in flight is decided the moment it starts, so leaving mid-drop
  // settles at its real result, never at the safer pre-drop value.
  const resolved = useRef<number>(0);
  const ticket = useTicket(() => (phase === 'dropping' ? resolved.current : round?.cash ?? 0));

  const dropMs = turbo.turbo ? 190 : 760;
  const live = phase === 'dropping' || phase === 'checkpoint';

  function finish(r: Round, outcome: Outcome, cash: number, bust: Interval | null = null) {
    timers.clearAll();
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash, bust });
    setPending(null);
    setPhase('over');
  }

  function drop(r: Round) {
    timers.clearAll();
    const c = coreOf(r.intervals);
    const q = risk(c);
    const iv: Interval = { u: rng.next(), v: rng.next() };
    const safe = meets(c, iv);
    const cash = safe ? afterSafeDrop(r.cash, q) : 0;
    resolved.current = cash;
    setPhase('dropping');
    setPending(iv);
    timers.after(dropMs, () => {
      setPending(null);
      if (!safe) return finish(r, Math.max(iv.u, iv.v) < c.l ? 'left' : 'right', 0, iv);
      const next = { ...r, intervals: [...r.intervals, iv], cash };
      if (next.intervals.length >= r.target) return finish(next, 'full', cash);
      const nq = risk(coreOf(next.intervals));
      if (hitsCap(cash, nq)) return finish(next, 'max', cash);
      setRound(next);
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: cash, winChance: 1 - nq });
    });
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const r: Round = { target, stake: bet.value, intervals: [], cash: RTP, outcome: null, bust: null };
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
    setPending(null);
    setPhase('idle');
  }

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    apply();
    if (phase === 'over') clear();
  };

  useHotkeys(
    {
      space: () => (phase === 'checkpoint' ? dropNext() : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const t = round?.target ?? target;
  const intervals = useMemo(() => round?.intervals ?? [], [round?.intervals]);
  const c = coreOf(intervals);
  const n = intervals.length;
  const q = risk(c);
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const chance = shareChance(t);
  const toGo = completeChance(c, t - n);
  const vol = volatilityOf(target);
  const outcome = round?.outcome ?? null;

  let status = `Ready · ${t} intervals to land`;
  if (phase === 'dropping') status = n === 0 ? `Free drop · interval 1 of ${t}` : `Dropping interval ${n + 1} of ${t}`;
  if (phase === 'checkpoint') status = `Checkpoint · ${n} of ${t} share a point`;
  if (phase === 'over' && outcome) status = `${outcomeTitle(outcome, t)} · ${n} landed`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  const readouts =
    phase === 'idle'
      ? [
          { label: 'Chance to complete', value: fmtChance(chance), sub: `${t} intervals share a point`, tone: 'chance' as const },
          { label: 'Cash out now', value: '—', sub: 'after the first interval', tone: 'cash' as const },
          { label: 'Avg full prize', value: fmtMult(averageFullPrize(t)), sub: `if all ${t} share a point`, tone: 'prize' as const },
        ]
      : phase === 'over'
        ? [
            { label: 'Intervals landed', value: `${n} / ${t}`, sub: outcome === 'full' ? 'the core survived' : `${fmtChance(chance)} to complete`, tone: 'chance' as const },
            { label: 'Paid', value: fmtMult(cash), sub: formatAmount(stake * cash, 2), tone: 'cash' as const },
            { label: 'Avg full prize', value: fmtMult(averageFullPrize(t)), sub: `if all ${t} share a point`, tone: 'prize' as const },
          ]
        : [
            { label: 'Next drop safe', value: fmtChance(1 - q), sub: `${fmtChance(toGo)} to complete`, tone: 'chance' as const },
            { label: 'Cash out now', value: fmtMult(cash), sub: formatAmount(stake * cash, 2), tone: 'cash' as const },
            { label: 'If it meets the core', value: fmtMult(afterSafeDrop(cash, q)), sub: `interval ${Math.min(n + 1, t)} of ${t}`, tone: 'prize' as const },
          ];

  return (
    <GameLayout
      name="Core"
      accent={ACCENT}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={vol} />}>Intervals to land</Label>
          <Chips
            label="Intervals to land"
            options={TARGETS.map((v) => ({ value: v, label: v, title: `${fmtChance(shareChance(v))} to complete` }))}
            value={target}
            disabled={live}
            onChange={(v) => change(() => setTarget(v))}
          />

          <dl className="og-stats">
            <dt>Chance to complete</dt>
            <dd>{fmtChance(shareChance(target))}</dd>
            <dt>Avg full prize</dt>
            <dd>{fmtMult(averageFullPrize(target))}</dd>
          </dl>

          {phase === 'checkpoint' ? (
            <>
              <ActionButton kind="cash" onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" onClick={dropNext}>
                Drop next · {fmtChance(1 - q)} safe
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

      <Board className="core-stage">
        <Field
          target={t}
          intervals={intervals}
          pending={pending}
          bust={round?.bust ?? null}
          mode={phase === 'idle' ? 'idle' : phase === 'over' ? 'over' : 'live'}
          complete={outcome === 'full'}
          dropMs={dropMs}
        />
        {phase === 'over' && round?.outcome && (
          <div className="core-over">
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

      {live ? (
        <ChanceBar
          p={1 - q}
          label="Next interval meets the core"
          note={n === 0 ? 'The first interval is free: it becomes the core.' : 'It misses only if both its ends land left of l (red square l²) or right of r (red square (1 − r)²).'}
        />
      ) : (
        <Caption>
          Every interval must share one common point. {t} random intervals do so {fmtChance(chance)} of the time: 2ⁿ(n!)²/(2n)!. RTP{' '}
          {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Core" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              Random intervals drop onto the segment from 0 to 1. Keep them all sharing one common point (the <b style={{ color: ACCENT }}>core</b>) until
              the number of intervals you chose has landed.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick how many intervals to land, then bet. The first interval is free: it becomes the core.</li>
              <li>After each interval that meets the core you can cash out (C), or drop the next one (Space).</li>
              <li>An interval that misses the core entirely ends the round. Land them all and it pays out automatically.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The core is [l, r]: from the largest left end to the smallest right end. Each new interval comes from two random points, drawn as one dot in
              the square below the line (first end across, second end up). It misses the core only when both ends land left of l, or both land right of r:
              the two <b style={{ color: 'var(--red)' }}>red corner squares</b>, with sides l and 1 − r. Their area, l² + (1 − r)², is exactly the chance of
              losing the next drop. The dashed lines carry l and r straight down to the squares' edges.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Helly's theorem in one dimension: intervals have a common point exactly when every two of them overlap, and the common part is [max left end,
              min right end]. n random intervals share a point exactly when all n left ends come before all n right ends among the 2n endpoints, so the
              chance is 2<sup>n</sup>·(n!)² / (2n)!: 2/3 for two, 2/5 for three, 8/35 for four.
            </p>
            <p>
              From a live core [l, r] with m intervals to go, the chance to complete is (2l(1 − l))<sup>m</sup> + P<sub>m</sub>·[T(r) − T(l)], where
              P<sub>m</sub> is the fresh chance above and T(x) is the chance that a Binomial(2m, x) is at least m. That is the "to complete" figure under
              Next drop safe.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Surviving a drop whose red area is q multiplies your cash-out by 1/(1 − q). Every drop is therefore a fair bet: the cash-out is a martingale,
              and the round is worth {(RTP * 100).toFixed(0)}% of your stake however and whenever you cash out. The full prize depends on how the core
              shrank; on average it is {(RTP * 100).toFixed(0)}% ÷ the chance to complete.
            </p>
            <p>
              A core squeezed near one end of the segment makes the red area close to 1, so the round cashes out automatically before any drop that could
              pay more than {MAX_WIN.toLocaleString('en-US')}×. That is a stopping rule too, so it doesn't change the return.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
