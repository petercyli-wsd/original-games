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
import { formatAmount } from '@originals/game-sdk';
import { useRef, useState } from 'react';
import Field, { type BoardOutcome } from './Board';
import {
  BUDGETS,
  DIMS,
  RTP,
  l1,
  moveChances,
  origin,
  pressSize,
  prizeFor,
  sideChance,
  startChance,
  volatilityOf,
  walkBurst,
  type Budget,
  type Dim,
  type Settings,
  type Side,
} from './math';

type Phase = 'idle' | 'walking' | 'checkpoint' | 'over';

interface Round {
  s: Settings;
  stake: number;
  prize: number;
  path: number[][];
  cash: number;
  outcome: BoardOutcome | null;
}

const OUTCOME_TITLE: Record<BoardOutcome, string> = {
  'came-home': 'Came home',
  'too-far': 'Never came home',
  'stayed-away': 'Stayed away',
  caught: 'Came home',
  cashed: 'Cashed out',
};

const ACCENT = '#e0aaff';
const SIDE_LABEL: Record<Side, string> = { home: 'Home', away: 'Away' };
const POLYA: Record<Dim, string> = {
  1: 'In 1D a walk is certain to come home eventually',
  2: 'In 2D a walk is still certain to come home eventually, just slowly',
  3: 'In 3D a walk comes home only ≈ 34% of the time, ever',
};

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [dim, setDim] = useState<Dim>(2);
  const [budget, setBudget] = useState<Budget>(20);
  const [side, setSide] = useState<Side>('home');
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  // A burst of steps is decided when it starts, so leaving mid-walk settles
  // at its real result, never at the pre-burst value.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'walking' ? resolved.current : round?.cash ?? 0));

  const stepMs = turbo.turbo ? 70 : 260;
  const live = phase === 'walking' || phase === 'checkpoint';

  function finish(r: Round, outcome: BoardOutcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setPhase('over');
  }

  function walk(r: Round) {
    const from = r.path[r.path.length - 1];
    const left = r.s.budget - (r.path.length - 1);
    const b = walkBurst(r.s, from, left, () => rng.next());
    resolved.current = b.cash;
    setPhase('walking');
    b.path.forEach((_, i) => timers.after(i * stepMs, () => setRound((cur) => (cur ? { ...cur, path: [...r.path, ...b.path.slice(0, i + 1)] } : cur))));
    timers.after(b.path.length * stepMs + 120, () => {
      const next = { ...r, path: [...r.path, ...b.path], cash: b.cash };
      if (b.verdict) {
        const home = l1(next.path[next.path.length - 1]) === 0;
        const outcome: BoardOutcome = r.s.side === 'home' ? (home ? 'came-home' : 'too-far') : home ? 'caught' : 'stayed-away';
        return finish(next, outcome, b.cash);
      }
      setRound(next);
      setPhase('checkpoint');
      const now = next.path[next.path.length - 1];
      track({ type: 'checkpoint', multiplier: b.cash, winChance: sideChance(r.s.side, r.s.dim, now, left - b.path.length) });
    });
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const s: Settings = { dim, budget, side };
    const r: Round = { s, stake: bet.value, prize: prizeFor(s), path: [origin(dim)], cash: RTP, outcome: null };
    setRound(r);
    walk(r);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', round.cash);
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

  useHotkeys(
    {
      space: () => (phase === 'checkpoint' && round ? walk(round) : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const s: Settings = round?.s ?? { dim, budget, side };
  const path = round?.path ?? [origin(s.dim)];
  const taken = path.length - 1;
  const left = s.budget - taken;
  const pos = path[path.length - 1];
  const dist = l1(pos);
  const prize = round?.prize ?? prizeFor(s);
  const settled = phase === 'over';
  const chance = settled ? (round?.cash ?? 0) / prize : taken === 0 ? startChance(s) : sideChance(s.side, s.dim, pos, left);
  const bars = settled ? null : moveChances(s, pos, left);
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const sel: Settings = { dim, budget, side };
  const pSel = startChance(sel);
  const vol = volatilityOf(sel);
  const nextSteps = pressSize(s.budget, left);
  const sideWord = s.side === 'home' ? 'comes home' : 'stays away';

  let status = `Ready · ${s.dim}D · ${s.budget} steps · back ${SIDE_LABEL[s.side]}`;
  if (phase === 'walking') status = `Walking · step ${Math.max(1, taken)} of ${s.budget}`;
  if (phase === 'checkpoint') status = `Checkpoint · ${dist} from home · ${left} steps left`;
  if (phase === 'over' && round?.outcome) status = `${OUTCOME_TITLE[round.outcome]} · ${taken} of ${s.budget} steps`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  return (
    <GameLayout
      name="Homecoming"
      accent={ACCENT}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={vol} />}>Dimension</Label>
          <Chips
            label="Dimension"
            options={DIMS.map((v) => ({ value: v, label: `${v}D`, title: `${2 * v} equally likely moves per step` }))}
            value={dim}
            disabled={live}
            onChange={(v) => change(() => setDim(v))}
          />

          <Label hint="time to get home">Steps</Label>
          <Chips
            label="Step budget"
            options={BUDGETS.map((v) => ({ value: v, label: v }))}
            value={budget}
            disabled={live}
            onChange={(v) => change(() => setBudget(v))}
          />

          <Label hint="both are fairly priced">Back</Label>
          <Chips
            label="Back a side"
            options={[
              { value: 'home' as Side, label: 'Home', title: 'Win if the walk returns to the start in time' },
              { value: 'away' as Side, label: 'Away', title: 'Win if it never returns in time' },
            ]}
            value={side}
            disabled={live}
            onChange={(v) => change(() => setSide(v))}
          />

          <dl className="og-stats">
            <dt>Chance to win</dt>
            <dd>{fmtChance(pSel)}</dd>
            <dt>Prize</dt>
            <dd>{fmtMult(RTP / pSel)}</dd>
          </dl>

          {phase === 'checkpoint' ? (
            <>
              <ActionButton kind="cash" onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" onClick={() => round && walk(round)}>
                Walk {nextSteps} step{nextSteps === 1 ? '' : 's'} · {fmtChance(chance)} to win
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
              {phase === 'walking' ? 'Walking…' : phase === 'over' ? 'Bet again' : 'Bet'}
            </ActionButton>
          )}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />

      <Readouts
        items={[
          {
            label: `Chance it ${sideWord}`,
            value: settled ? (round?.outcome === 'cashed' ? '—' : chance >= 1 ? '100%' : '0%') : fmtChance(chance),
            sub: live ? `${dist} from home · ${left} steps left` : `${s.dim}D · ${s.budget} steps`,
            tone: 'chance',
          },
          {
            label: 'Cash out now',
            value: live || settled ? fmtMult(cash) : '—',
            sub: live || settled ? formatAmount(stake * cash, 2) : `${fmtMult(RTP)} after the free first step`,
            tone: 'cash',
          },
          { label: 'Prize', value: fmtMult(prize), sub: `if the walk ${sideWord}`, tone: 'prize' },
        ]}
      />

      <Board className="homecoming-board">
        <Field dim={s.dim} budget={s.budget} side={s.side} path={path} chance={chance} bars={bars} stepMs={stepMs} outcome={settled ? round?.outcome ?? null : null} />
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
        <ChanceBar
          p={chance}
          label={`Chance the walk ${sideWord}`}
          note={`Each bar is your chance after one of the ${2 * s.dim} equally likely moves; the dashed line, their average, is your chance now.`}
        />
      ) : (
        <Caption>
          Pólya: {POLYA[s.dim]}. Within {s.budget} steps it comes home {fmtChance(startChance({ ...s, side: 'home' }))} of the time. RTP{' '}
          {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Homecoming" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              A walker leaves home (the origin of a 1D, 2D or 3D grid) and takes random steps. Back <b>Home</b> to win if it comes back to the origin
              within your step budget, or <b>Away</b> to win if it doesn't.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick the dimension, the number of steps and a side, then bet.</li>
              <li>
                The first step is taken for you (it is free: every first step is the same distance from home). After that each press walks a few steps;
                between presses you can cash out (C) or keep walking (Space).
              </li>
              <li>
                The round settles the moment the walker reaches home, or once home is further away than the steps left (the out-of-reach wedge), or when
                the steps run out.
              </li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              Each step moves one coordinate by ±1, chosen at random, so there are {2 * s.dim} equally likely moves. The number lines show the walk
              projected onto each coordinate: home is when every coordinate is back on the home column at the same time, and the shaded gaps add up to
              the steps from home.
            </p>
            <p>
              The bars at the bottom are your exact chance after each possible next move. Moves towards home are{' '}
              <b style={{ color: 'var(--green)' }}>green</b> if you backed Home; moves away are green if you backed Away. The dashed line is their average, and
              that average is your chance right now.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Pólya's recurrence theorem (1921): a simple random walk on the grid returns to its start with probability 1 in one and two dimensions, but only
              with probability ≈ 0.3405 in three. Within T steps the chance is lower: in 1D exactly 1 − C(T, T/2)/2<sup>T</sup>.
            </p>
            <p>
              The game computes the chance g(x, t) of reaching home from x within t steps exactly: g(x, 0) = 0, and g(x, t) is the average over the{' '}
              {2 * s.dim} neighbours y of (1 if y is home, else g(y, t − 1)). Positions are reduced by symmetry (signs and the order of coordinates do not
              matter), and the result is checked against the renewal equation for return probabilities.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              The prize is {(RTP * 100).toFixed(0)}% ÷ (your side's chance at the start), and cashing out pays prize × (your chance now). Because the chance now
              is the average of the chances after the next move, the cash-out is a fair bet at every step (a martingale): any way of deciding when to stop
              returns exactly {(RTP * 100).toFixed(0)}% of your stake. Home and Away are each priced at their own odds, so the side you back changes the
              swings, not the value.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
