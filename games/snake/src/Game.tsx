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
  type ReadoutItem,
} from '@originals/game-sdk/ui';
import { formatAmount, type Volatility } from '@originals/game-sdk';
import { useMemo, useRef, useState } from 'react';
import Field, { type BoardMode, type Crash, type Outcome } from './Board';
import {
  GRIDS,
  MAX_MULTIPLIER,
  RTP,
  TARGETS,
  autoStop,
  averageWin,
  blockers,
  centre,
  liveOutlook,
  minimumWin,
  startOutlook,
  step,
  winChance,
  type Dir,
  type Grid,
  type Target,
} from './math';

type Phase = 'idle' | 'spin' | 'move' | 'checkpoint' | 'over';

/** Auto-step: keep stepping while at least this many of the 4 directions are free (null = off). */
type Auto = 'off' | '75' | '50' | 'all';
const AUTO_MIN: Record<Auto, number | null> = { off: null, '75': 3, '50': 2, all: 1 };
const AUTO_HINT: Record<Auto, string> = {
  off: 'you take each step',
  '75': 'while ≥ 3 of 4 are safe',
  '50': 'while ≥ 2 of 4 are safe',
  all: 'to the end',
};

interface Round {
  grid: Grid;
  target: Target;
  stake: number;
  path: number[];
  cash: number;
  outcome: Outcome | null;
  crash: Crash | null;
}

const ACCENT = '#00f5d4';

const outcomeTitle = (o: Outcome, target: number) =>
  ({
    wall: 'Hit the wall',
    body: 'Ran into itself',
    cashed: 'Cashed out',
    target: `Length ${target} reached`,
    trapped: 'Boxed in · auto cash-out',
  })[o];

function volatilityOf(grid: Grid, target: Target): Volatility {
  const p = winChance(grid, target);
  return p >= 0.2 ? 'low' : p >= 0.05 ? 'medium' : p >= 0.012 ? 'high' : 'extreme';
}

const FACTOR: Record<number, string> = { 4: '×1', 3: '×4/3', 2: '×2', 1: '×4' };

/** Turns the needle at least a turn and a quarter, landing on direction dir. */
const spinTo = (angle: number, dir: Dir) => {
  const from = angle + 450;
  return from + ((((dir * 90 - from) % 360) + 360) % 360);
};

const GridIcon = ({ n }: { n: number }) => {
  const k = n === 7 ? 3 : 4;
  const s = 12 / k;
  return (
    <svg viewBox="0 0 14 14" aria-hidden="true">
      {Array.from({ length: k * k }, (_, i) => (
        <rect key={i} x={1 + (i % k) * s + 0.6} y={1 + Math.floor(i / k) * s + 0.6} width={s - 1.2} height={s - 1.2} rx={0.6} />
      ))}
    </svg>
  );
};

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [grid, setGrid] = useState<Grid>(9);
  const [target, setTarget] = useState<Target>(8);
  const [auto, setAuto] = useState<Auto>('off');
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [needle, setNeedle] = useState(0);
  const [infoOpen, setInfoOpen] = useState(false);

  // The step in flight is decided the moment it starts, so leaving mid-spin
  // settles at its real result, never at the safer pre-step value.
  const resolved = useRef<number>(0);
  const ticket = useTicket(() => (phase === 'spin' || phase === 'move' ? resolved.current : round?.cash ?? 0));
  // Scheduled auto-steps read the latest setting, so switching auto off stops at the next checkpoint.
  const autoRef = useRef(auto);
  autoRef.current = auto;

  const spinMs = turbo.turbo ? 140 : 540;
  const moveMs = turbo.turbo ? 60 : 200;
  const crashMs = turbo.turbo ? 160 : 520;
  const autoMs = turbo.turbo ? 90 : 360;
  const live = phase === 'spin' || phase === 'move' || phase === 'checkpoint';
  const busy = phase === 'spin' || phase === 'move';

  const autoGo = (path: number[], n: number, mode: Auto = autoRef.current) => {
    const min = AUTO_MIN[mode];
    return min !== null && blockers(n, path).filter((b) => b === null).length >= min;
  };

  function finish(r: Round, outcome: Outcome, cash: number) {
    timers.clearAll();
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setPhase('over');
  }

  /** Queues the next step if the auto rule says so; the player can still cash out during the pause. */
  function scheduleAuto(r: Round, mode: Auto = autoRef.current) {
    if (!autoGo(r.path, r.grid, mode)) return;
    timers.after(autoMs, () => {
      if (autoGo(r.path, r.grid)) stepOnce(r);
    });
  }

  function stepOnce(r: Round) {
    timers.clearAll();
    const dir = rng.int(4) as Dir;
    const res = step(r.grid, r.path, r.cash, dir);
    resolved.current = res.cash;
    setPhase('spin');
    setNeedle((a) => spinTo(a, dir));
    timers.after(spinMs, () => {
      if (!res.safe) {
        const crashed = { ...r, crash: { dir, hit: res.hit } };
        setRound(crashed);
        setPhase('move');
        timers.after(crashMs, () => finish(crashed, res.hit === 'wall' ? 'wall' : 'body', 0));
        return;
      }
      const next = { ...r, path: res.path, cash: res.cash };
      setRound(next);
      setPhase('move');
      timers.after(moveMs, () => {
        const stop = autoStop(next.grid, next.target, next.path);
        if (stop) return finish(next, stop, next.cash);
        setPhase('checkpoint');
        track({ type: 'checkpoint', multiplier: next.cash, winChance: liveOutlook(next.grid, next.target, next.path, next.cash).win });
        scheduleAuto(next);
      });
    });
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const r: Round = { grid, target, stake: bet.value, path: [centre(grid)], cash: RTP, outcome: null, crash: null };
    setRound(r);
    stepOnce(r);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', round.cash);
  }

  function stepNext() {
    if (phase === 'checkpoint' && round) stepOnce(round);
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    setRound(null);
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
      scheduleAuto(round, v);
    }
  }

  useHotkeys(
    {
      space: () => (phase === 'checkpoint' ? stepNext() : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const n = round?.grid ?? grid;
  const t = round?.target ?? target;
  const path = useMemo(() => round?.path ?? [centre(n)], [round?.path, n]);
  const blocked = useMemo(() => blockers(n, path), [n, path]);
  const free = blocked.filter((b) => b === null).length;
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const outcome = round?.outcome ?? null;
  const len = path.length;
  const look = live ? liveOutlook(n, t, path, cash) : startOutlook(n, t);
  const chance = winChance(grid, target);
  const vol = volatilityOf(grid, target);
  const autoNext = phase === 'checkpoint' && round !== null && autoGo(path, n, auto);
  const autoOn = AUTO_MIN[auto] !== null;

  let status = `Ready · grow to length ${t}`;
  if (busy) status = `Stepping · ${len} of ${t}`;
  if (phase === 'checkpoint') status = autoNext ? `Auto-step · ${len} of ${t}` : `Checkpoint · ${len} of ${t}${autoOn ? ' · auto paused' : ''}`;
  if (phase === 'over' && outcome) status = outcome === 'target' || outcome === 'trapped' ? outcomeTitle(outcome, t) : `${outcomeTitle(outcome, t)} · ${len} of ${t}`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  const readouts: ReadoutItem[] =
    phase === 'idle'
      ? [
          { label: 'Win chance', value: fmtChance(look.win), sub: `reach length ${t}`, tone: 'chance' },
          { label: 'Cash out now', value: '—', sub: 'after the first step', tone: 'cash' },
          { label: 'Avg prize', value: fmtMult(averageWin(n, t)), sub: `at least ${fmtMult(minimumWin(t))}`, tone: 'prize' },
        ]
      : phase === 'over'
        ? [
            { label: 'Length', value: `${len} / ${t}`, sub: outcome ? outcomeTitle(outcome, t).toLowerCase() : '', tone: 'chance' },
            { label: 'Paid', value: fmtMult(cash), sub: formatAmount(stake * cash, 2), tone: 'cash' },
            { label: 'Avg prize', value: fmtMult(averageWin(n, t)), sub: `${fmtChance(winChance(n, t))} to reach ${t}`, tone: 'prize' },
          ]
        : [
            { label: 'Win chance', value: fmtChance(look.win), sub: `reach length ${t} from here`, tone: 'chance' },
            { label: 'Cash out now', value: fmtMult(cash), sub: formatAmount(stake * cash, 2), tone: 'cash' },
            {
              label: 'If it survives',
              value: free ? fmtMult((cash * 4) / free) : '—',
              sub: free ? `${FACTOR[free]} · ${free} of 4 safe` : 'boxed in',
              tone: 'prize',
            },
          ];

  const mode: BoardMode = phase === 'checkpoint' ? 'live' : phase;

  return (
    <GameLayout
      name="Snake"
      accent={ACCENT}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={vol} />}>Board</Label>
          <Chips
            label="Board size"
            options={GRIDS.map((v) => ({
              value: v,
              label: (
                <span className="snk-chip">
                  <GridIcon n={v} />
                  {v} × {v}
                </span>
              ),
            }))}
            value={grid}
            disabled={live}
            onChange={(v) => change(() => setGrid(v))}
          />

          <Label hint="pays out when reached">Target length</Label>
          <Chips
            label="Target length"
            options={TARGETS.map((v) => ({ value: v, label: v, title: `Grow to ${v} cells (${v - 1} steps)` }))}
            value={target}
            disabled={live}
            onChange={(v) => change(() => setTarget(v))}
          />

          <Label hint={AUTO_HINT[auto]}>Auto-step</Label>
          <Chips
            label="Auto-step"
            options={[
              { value: 'off' as Auto, label: 'Off' },
              { value: '75' as Auto, label: '≥75%', title: 'Keep stepping while at least 3 of the 4 directions are safe' },
              { value: '50' as Auto, label: '≥50%', title: 'Keep stepping while at least 2 of the 4 directions are safe' },
              { value: 'all' as Auto, label: 'All', title: 'Step all the way to the end' },
            ]}
            value={auto}
            onChange={changeAuto}
          />

          <dl className="og-stats">
            <dt>Chance to win</dt>
            <dd>{fmtChance(chance)}</dd>
            <dt>Avg prize</dt>
            <dd>{fmtMult(averageWin(grid, target))}</dd>
          </dl>

          {phase === 'checkpoint' ? (
            <>
              <ActionButton kind="cash" onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" onClick={stepNext}>
                {autoNext ? 'Auto-stepping…' : `Step · ${free} of 4 safe`}
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
              {busy ? 'Stepping…' : phase === 'over' ? 'Bet again' : 'Bet'}
            </ActionButton>
          )}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />

      <Readouts items={readouts} />

      <Board className="snk-board">
        <Field
          n={n}
          target={t}
          path={path}
          blocked={blocked}
          mode={mode}
          outcome={outcome}
          crash={round?.crash ?? null}
          needle={needle}
          spinMs={spinMs}
          moveMs={moveMs}
          win={look.win}
        />
        {/* The result card covers only the length band under the grid (in flow on narrow frames). */}
        {phase === 'over' && outcome && round && (
          <div className="snk-over">
            <RoundOver
              key={history[0]?.id}
              title={outcomeTitle(outcome, t)}
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

      <div className="snk-foot">
        {live ? (
          <ChanceBar
            p={free / 4}
            label="Next step lands safe"
            note={
              len === 1
                ? 'The first step is free: every direction from the centre is open.'
                : 'Four directions, 1 in 4 each. Green quarters are free cells; red ones are a wall or the snake itself.'
            }
          />
        ) : (
          <Caption>
            Each step picks one of 4 directions at random. A blind snake survives {t - 1} steps on a {n}×{n} board only along a self-avoiding path:{' '}
            {Math.round(winChance(n, t) * 4 ** (t - 1)).toLocaleString('en-US')} of the {(4 ** (t - 1)).toLocaleString('en-US')} possible paths, {fmtChance(winChance(n, t))}. RTP{' '}
            {(RTP * 100).toFixed(0)}%.
          </Caption>
        )}
      </div>

      {infoOpen && (
        <InfoModal title="Snake" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              A blind snake starts on the centre of the board. Every step its head moves one cell in a random direction and the snake grows by one cell.
              Grow it to your target length without running into a wall or into its own body.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick a board size and a target length, then bet. The first step is free.</li>
              <li>After each safe step you can cash out (C), or take the next step (Space).</li>
              <li>Hit a wall or the body and the round is lost. Reach the target length and it pays out automatically.</li>
              <li>If the head is boxed in with no free direction, the round cashes out automatically at its current value.</li>
              <li>
                Auto-step keeps stepping for you while enough directions are safe (or to the end with <b>All</b>), then waits for you. You can still cash
                out between steps.
              </li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The ring around the head has four quarters, one per direction, and the spinner lands on each with chance 1 in 4. A{' '}
              <b style={{ color: 'var(--green)' }}>green quarter</b> (with a green arrow in the cell beyond) is a free cell. A{' '}
              <b style={{ color: 'var(--red)' }}>red quarter</b> is the wall or the snake's own body. So the green share of the ring is exactly the chance the
              next step is safe: 4, 3, 2 or 1 quarters is 100%, 75%, 50% or 25%.
            </p>
            <p>
              <b>Win chance</b> is the exact chance of reaching the target length from here if you keep going, counted over every possible future path. It
              rises as the snake survives and drops when it curls into a pocket. The length bar under the board shows how far there is to go.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Self-avoiding walks. The snake survives n steps exactly when its path never revisits a cell and never leaves the board: a self-avoiding walk.
              Each n-step path has probability 1/4<sup>n</sup>, so P(survive n steps) = c<sub>n</sub> / 4<sup>n</sup>, where c<sub>n</sub> counts the
              self-avoiding walks of n steps from the centre that fit on the board. On an endless grid c<sub>n</sub> = 4, 12, 36, 100, 284, 780, 2172, …,
              growing like μ<sup>n</sup> with μ ≈ 2.638 (the connective constant): a long snake survives about μ/4 ≈ 66% of its steps. Walls make it
              harder. The game counts every path exactly.
            </p>
            <table className="snk-table">
              <thead>
                <tr>
                  <th>Length</th>
                  {TARGETS.map((k) => (
                    <th key={k}>{k}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {GRIDS.map((g) => (
                  <tr key={g}>
                    <td>
                      {g}×{g}
                    </td>
                    {TARGETS.map((k) => (
                      <td key={k}>{fmtChance(winChance(g, k))}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Surviving a step with f free directions multiplies your cash-out by 4/f: ×4/3 with three free, ×2 with two, ×4 with one. Every step is a fair
              bet, since f/4 × 4/f = 1. The cash-out is a martingale that starts at {(RTP * 100).toFixed(0)}% of your stake, so every way of playing
              (cashing out by hand, auto-step, playing to the end) returns exactly {(RTP * 100).toFixed(0)}%. Being boxed in, or reaching the target,
              simply stops the round.
            </p>
            <p>
              Your cash-out is also {(RTP * 100).toFixed(0)}% × the chance that a careful snake, one that only ever picks free cells, would take your exact
              path, divided by the chance the blind snake takes it. The prize at the target therefore depends on the path: straight runs in open space pay
              the least ({fmtMult(minimumWin(target))} for length {target}), tight squeezes pay more, and on average a win pays{' '}
              {(RTP * 100).toFixed(0)}% ÷ (chance to win) × (share of careful snakes that reach it). No payout can exceed {fmtMult(MAX_MULTIPLIER)}.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
