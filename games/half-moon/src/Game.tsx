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
import { useRef, useState } from 'react';
import Field from './Board';
import { RTP, TARGETS, WINDOWS, afterSafeDrop, danger, fitChance, fits, span, type Target, type Window } from './math';

type Phase = 'idle' | 'dropping' | 'checkpoint' | 'over';
type Outcome = 'bust' | 'cashed' | 'full';

interface Round {
  window: Window;
  target: Target;
  stake: number;
  points: number[];
  cash: number;
  outcome: Outcome | null;
  bustPoint: number | null;
}

const OUTCOME_TITLE: Record<Outcome, string> = { bust: 'Out of the window', cashed: 'Cashed out', full: 'Full moon' };

function volatilityOf(win: Window, target: Target): Volatility {
  const p = fitChance(target, win);
  return p > 0.3 ? 'low' : p > 0.08 ? 'medium' : p > 0.01 ? 'high' : 'extreme';
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [win, setWin] = useState<Window>(180);
  const [target, setTarget] = useState<Target>(6);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [dropping, setDropping] = useState<number | null>(null);
  const [spin, setSpin] = useState(0);
  const [infoOpen, setInfoOpen] = useState(false);

  // The drop in flight is decided the moment it starts, so leaving mid-spin
  // settles at its real result, never at the safer pre-drop value.
  const resolved = useRef<number>(0);
  const ticket = useTicket(() => (phase === 'dropping' ? resolved.current : round?.cash ?? 0));

  const spinMs = turbo.turbo ? 220 : 850;
  const live = phase === 'dropping' || phase === 'checkpoint';

  function finish(r: Round, outcome: Outcome, cash: number, bustPoint: number | null = null) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash, bustPoint });
    setDropping(null);
    setPhase('over');
  }

  function drop(r: Round) {
    const { q } = danger(r.points, r.window);
    const p = rng.next();
    const points = [...r.points, p];
    const safe = fits(points, r.window);
    const cash = safe ? afterSafeDrop(r.cash, q) : 0;
    resolved.current = cash;
    setPhase('dropping');
    setDropping(p);
    // Spin at least one full turn, ending exactly on p.
    setSpin((s) => Math.floor(s) + 1 + p + (p < (s % 1) ? 1 : 0));
    timers.after(spinMs, () => {
      if (!safe) return finish(r, 'bust', 0, p);
      const next = { ...r, points, cash };
      if (points.length >= r.target) return finish(next, 'full', cash);
      setRound(next);
      setDropping(null);
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: cash, winChance: 1 - danger(points, r.window).q });
    });
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const r: Round = { window: win, target, stake: bet.value, points: [], cash: RTP, outcome: null, bustPoint: null };
    setRound(r);
    drop(r);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', round.cash);
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    setRound(null);
    setDropping(null);
    setPhase('idle');
  }

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    apply();
    if (phase === 'over') clear();
  };

  useHotkeys(
    {
      space: () => (phase === 'checkpoint' && round ? drop(round) : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const w = round?.window ?? win;
  const t = round?.target ?? target;
  const points = round?.points ?? [];
  
  const { q, arc } = danger(points, w);
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const fill = fitChance(t, w);
  const vol = volatilityOf(win, target);

  let status = `Ready · ${t} points in a ${w}° window`;
  if (phase === 'dropping') status = `Dropping point ${points.length + 1} of ${t}`;
  if (phase === 'checkpoint') status = `Checkpoint · ${points.length} of ${t} points`;
  if (phase === 'over' && round?.outcome) status = `${OUTCOME_TITLE[round.outcome]} · ${points.length} points`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  return (
    <GameLayout
      name="Half Moon"
      accent="#b59cff"
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={vol} />}>Window</Label>
          <Chips
            label="Window size"
            options={WINDOWS.map((v) => ({ value: v, label: `${v}°` }))}
            value={win}
            disabled={live}
            onChange={(v) => change(() => setWin(v))}
          />

          <Label hint="the board pays out when full">Points to fill</Label>
          <Chips
            label="Points to fill"
            options={TARGETS.map((v) => ({ value: v, label: v }))}
            value={target}
            disabled={live}
            onChange={(v) => change(() => setTarget(v))}
          />
          <dl className="og-stats">
            <dt>Chance to fill</dt>
            <dd>{fmtChance(fitChance(target, win))}</dd>
            <dt>Typical full prize</dt>
            <dd>{fmtMult(RTP / fitChance(target, win))}</dd>
          </dl>

          {phase === 'checkpoint' ? (
            <>
              <ActionButton kind="cash" onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" onClick={() => round && drop(round)}>
                Drop next {q === 0 ? '· free' : `· ${fmtChance(1 - q)} safe`}
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

      <Readouts
        items={[
          { label: 'Next drop safe', value: live ? fmtChance(1 - q) : '—', sub: live ? (q === 0 ? 'nothing can bust' : 'outside the red arc') : `${t} points to fill`, tone: 'chance' },
          { label: 'Cash out now', value: live || phase === 'over' ? fmtMult(cash) : '—', sub: formatAmount(stake * cash, 2), tone: 'cash' },
          { label: 'If it lands safe', value: live ? fmtMult(cash / (1 - q)) : fmtMult(RTP / fill), sub: live ? `point ${points.length + 1} of ${t}` : 'typical full prize', tone: 'prize' },
        ]}
      />

      <Board>
        <Field
          window={w}
          points={points}
          spanArc={span(points)}
          bustArc={phase === 'checkpoint' || phase === 'dropping' ? arc : null}
          dropping={dropping}
          spin={spin}
          spinMs={spinMs}
          bustPoint={round?.bustPoint ?? null}
          q={q}
          live={live}
        />
        {phase === 'over' && round?.outcome && (
          <RoundOver
            key={history[0]?.id}
            title={OUTCOME_TITLE[round.outcome]}
            multiplier={round.cash}
            stake={round.stake}
            nextBet={bet.value}
            blocked={bet.blocked}
            onBetAgain={() => void start()}
            onClear={clear}
            placement="bottom"
          />
        )}
      </Board>

      {live ? (
        <ChanceBar p={1 - q} label="Next drop lands safe" note="The red arc is exactly where the next point would break your window." />
      ) : (
        <Caption>
          Every point must fit inside one {w}° window. Wendel: {t} random points do so {fmtChance(fill)} of the time. RTP {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Half Moon" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>Points drop at random onto a circle. Keep all of them inside one window (an arc of the size you chose) until the board is full.</p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick a window size and how many points fill the board, then bet.</li>
              <li>After each safe drop you can cash out, or drop the next point (Space).</li>
              <li>If a point lands where the window can no longer hold everything, the round is lost. Fill the board and it pays out automatically.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The <b style={{ color: 'var(--red)' }}>red arc</b> is the only place the next point can bust you, so its length is the chance of losing the
              drop. Points that land inside your cluster, or close enough to either end of it, are safe. Sometimes no position can bust you: that drop is free.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Wendel's theorem: n random points on a circle all fit in some half circle with probability n / 2<sup>n−1</sup>. For a window that is a fraction a of
              the circle (a ≤ ½) the chance is n·a<sup>n−1</sup>; larger windows need an inclusion–exclusion correction.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Surviving a drop whose red arc covers q of the circle multiplies your cash-out by 1/(1−q). Every drop is therefore a fair bet, and the round is
              worth {(RTP * 100).toFixed(0)}% of your stake however and whenever you cash out.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
