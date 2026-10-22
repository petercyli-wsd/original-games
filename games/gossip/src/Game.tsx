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
  Slider,
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
import Field, { type Outcome, type Phase } from './Board';
import {
  BUDGETS,
  MAX_MULTIPLIER,
  RTP,
  SIZES,
  budgetNear,
  clampBudget,
  countOf,
  expectedNew,
  headline,
  meanRounds,
  playRound,
  prizeFor,
  spreadEstimate,
  startInformed,
  volatilityOf,
  winChance,
  type Call,
  type Size,
} from './math';

const ACCENT = '#8ac926';

interface Round {
  id: number;
  n: Size;
  R: number;
  stake: number;
  /** Locked at bet time: RTP / P(win). */
  prize: number;
  /** Rounds played, including one still animating. */
  t: number;
  informed: boolean[];
  /** Informed count after each round played. */
  counts: number[];
  calls: Call[];
  fresh: Set<number>;
  /** The resolved cash-out after the latest round. */
  cash: number;
  outcome: Outcome | null;
}

const plural = (x: number, w: string) => `${x} ${w}${x === 1 ? '' : 's'}`;

function titleOf(r: Round, outcome: Outcome) {
  if (outcome === 'all') return 'Everyone knows';
  if (outcome === 'cashed') return 'Cashed out';
  return r.t >= r.R ? 'Out of rounds' : 'Out of reach';
}

const EMPTY = new Set<number>();

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [size, setSize] = useState<Size>(16);
  const [budget, setBudget] = useState(7);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const seq = useRef(0);
  const busy = useRef(false);

  // A round of calls is decided the moment it starts, so leaving mid-animation
  // settles at its real result, never at the pre-round value.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'spreading' ? resolved.current : round?.cash ?? 0));

  const callMs = turbo.turbo ? 200 : 800;
  const holdMs = turbo.turbo ? 80 : 300;
  const live = phase === 'spreading' || phase === 'checkpoint';

  function finish(r: Round, outcome: Outcome, cash: number) {
    busy.current = false;
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setPhase('over');
  }

  /** One round: every informed node calls a random other node. */
  function spread(r: Round) {
    if (busy.current) return;
    busy.current = true;
    const { calls, informed } = playRound(r.n, r.informed, rng);
    const i = countOf(informed);
    const t = r.t + 1;
    const p = winChance(r.n, i, r.R - t);
    const cash = i >= r.n ? r.prize : r.prize * p;
    resolved.current = cash;
    const fresh = new Set(calls.filter((c) => c.fresh).map((c) => c.to));
    const next: Round = { ...r, t, informed, counts: [...r.counts, i], calls, fresh, cash };
    setRound(next);
    setPhase('spreading');
    timers.after(callMs + holdMs, () => {
      if (i >= r.n) return finish(next, 'all', r.prize);
      if (cash <= 0) return finish(next, 'out', 0);
      busy.current = false;
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: cash, winChance: p });
    });
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    busy.current = false;
    spread({
      id: ++seq.current,
      n: size,
      R: budget,
      stake: bet.value,
      prize: prizeFor(size, budget),
      t: 0,
      informed: startInformed(size),
      counts: [],
      calls: [],
      fresh: EMPTY,
      cash: RTP,
      outcome: null,
    });
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round || busy.current) return;
    finish(round, 'cashed', round.cash);
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    busy.current = false;
    setRound(null);
    setPhase('idle');
  }

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    if (live) return;
    apply();
    if (phase === 'over') clear();
  };

  useHotkeys(
    {
      space: () => (phase === 'checkpoint' && round ? spread(round) : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const n = round?.n ?? size;
  const R = round?.R ?? budget;
  const spreading = phase === 'spreading' && !!round;
  const tShown = round ? (spreading ? round.t - 1 : round.t) : 0;
  const countsShown = round ? (spreading ? round.counts.slice(0, -1) : round.counts) : [];
  const iShown = round ? (spreading ? (round.counts[round.counts.length - 2] ?? 1) : countOf(round.informed)) : 1;
  const prize = round?.prize ?? prizeFor(size, budget);
  const stake = round?.stake ?? bet.value;
  const left = R - tShown;
  const pNow = round?.outcome === 'all' ? 1 : round?.outcome === 'out' ? 0 : winChance(n, iShown, left);
  const cash = phase === 'over' && round ? round.cash : round ? (spreading ? prize * pNow : round.cash) : RTP;
  const p0 = headline(size, budget);
  const range = BUDGETS[size];

  let status = `Ready · ${n} nodes, ${R} rounds`;
  if (spreading && round) status = `Round ${round.t} of ${R} · ${plural(iShown, 'caller')}`;
  if (phase === 'checkpoint') status = `Checkpoint · ${iShown} of ${n} know`;
  if (phase === 'over' && round?.outcome) status = `${titleOf(round, round.outcome)} · ${iShown} of ${n} know`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  let chanceSub = `everyone in ${R} rounds`;
  if (live) chanceSub = `${iShown} of ${n} know · ${plural(left, 'round')} left`;
  if (phase === 'over') chanceSub = round?.outcome === 'cashed' ? 'when you cashed out' : `${iShown} of ${n} in ${plural(tShown, 'round')}`;

  return (
    <GameLayout
      name="Gossip"
      accent={ACCENT}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint="more nodes, longer rounds">Network size</Label>
          <Chips
            label="Network size"
            options={SIZES.map((v) => ({ value: v, label: v }))}
            value={size}
            disabled={live}
            onChange={(v) =>
              change(() => {
                setSize(v);
                setBudget((b) => budgetNear(v, headline(size, clampBudget(size, b))));
              })
            }
          />

          <Label hint={<VolBadge level={volatilityOf(size, budget)} />}>
            Round budget: <b style={{ color: 'var(--text)' }}>{plural(budget, 'round')}</b>
          </Label>
          <Slider
            label="Round budget"
            min={range.min}
            max={range.max}
            value={budget}
            disabled={live}
            risk
            onChange={(v) => change(() => setBudget(clampBudget(size, v)))}
          />
          <Label hint="fewer rounds, bigger prize">
            <span style={{ fontWeight: 500 }}>
              log₂n + ln n ≈ {spreadEstimate(size).toFixed(1)}
            </span>
          </Label>

          <dl className="og-stats">
            <dt>Chance to win</dt>
            <dd>{fmtChance(p0)}</dd>
            <dt>Prize</dt>
            <dd>{fmtMult(prizeFor(size, budget))}</dd>
            <dt>Mean spread time</dt>
            <dd>{meanRounds(size).toFixed(2)} rounds</dd>
          </dl>

          {live && round ? (
            <>
              <ActionButton kind="cash" disabled={phase !== 'checkpoint'} onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton
                kind="secondary"
                disabled={phase !== 'checkpoint'}
                title={`Each of the ${iShown} callers rings a random other node`}
                onClick={() => spread(round)}
              >
                Spread · round {Math.min(R, tShown + 1)} · ≈ +{expectedNew(n, iShown).toFixed(1)}
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={!!bet.blocked} onClick={() => void start()}>
              {phase === 'over' ? 'Bet again' : 'Bet'}
            </ActionButton>
          )}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />

      <Readouts
        items={[
          { label: 'Win chance', value: fmtChance(pNow), sub: chanceSub, tone: 'chance' },
          {
            label: 'Cash out now',
            value: live || phase === 'over' ? fmtMult(cash) : '—',
            sub: live || phase === 'over' ? formatAmount(stake * cash, 2) : 'after every round',
            tone: 'cash',
          },
          { label: 'Prize · everyone knows', value: fmtMult(prize), sub: formatAmount(stake * prize, 2), tone: 'prize' },
        ]}
      />

      <Board className={'gossip-board' + (phase === 'over' ? ' over' : '')}>
        <Field
          n={n}
          R={R}
          t={tShown}
          count={iShown}
          informed={round?.informed ?? startInformed(n)}
          counts={countsShown}
          calls={round?.calls ?? []}
          fresh={round?.fresh ?? EMPTY}
          phase={phase}
          outcome={round?.outcome ?? null}
          roundKey={(round?.id ?? 0) * 100 + (round?.t ?? 0)}
          callMs={callMs}
        />
        {phase === 'over' && round?.outcome && (
          <RoundOver
            key={history[0]?.id}
            title={titleOf(round, round.outcome)}
            multiplier={round.cash}
            stake={round.stake}
            nextBet={bet.value}
            blocked={bet.blocked}
            onBetAgain={() => void start()}
            onClear={clear}
            placement="inline"
          />
        )}
      </Board>

      {live ? (
        <ChanceBar
          p={pNow}
          label={`Chance everyone knows by round ${R}`}
          note={`The green share of the strip under the chart. Next round ${iShown === 1 ? 'the one caller reaches' : `each of the ${iShown} callers reaches`} a given uninformed node with chance 1/${n - 1}.`}
        />
      ) : (
        <Caption>
          Every informed node calls a random other node each round. All {n} know within {R} rounds {fmtChance(headline(n, R))} of the time; it takes{' '}
          {meanRounds(n).toFixed(2)} rounds on average (log₂n + ln n ≈ {spreadEstimate(n).toFixed(1)}). RTP {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Gossip" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              One node of a network knows a rumour. Every round, <b>each node that knows it calls one other node at random</b> and tells it. Get the rumour
              to <b style={{ color: ACCENT }}>everyone</b> within your round budget.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick the network size and the round budget, then bet. The first round always reaches a second node.</li>
              <li>After every round you can cash out (C) or spread the next round (Space).</li>
              <li>
                When everyone knows, the prize pays out at once. If the budget runs out, or the informed count can no longer double its way to everyone in
                the rounds left, the round is lost.
              </li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              <b>The ring.</b> Green nodes know the rumour. Each round's calls are drawn as arrows: green arrows reach someone new, grey ones are wasted on
              someone who already knew.
            </p>
            <p>
              <b>The rounds row</b> shows how many know after each round. Early on the count roughly doubles; later most calls are wasted and it creeps.
            </p>
            <p>
              <b>The chart</b> shows, for every round, the exact chance that the last node hears it in that round. Columns inside your budget are{' '}
              <b style={{ color: 'var(--green)' }}>green</b>, later ones <b style={{ color: 'var(--red)' }}>red</b>. The strip below adds them up: its green
              length is your win chance.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Push gossip (Frieze–Grimmett, Pittel): everyone hears in about <b>log₂n + ln n</b> rounds. The log₂n is the doubling phase, while most calls
              find someone new. The ln n is the mop-up: with i callers each uninformed node is missed by all of them with chance (1 − 1/(n−1))
              <sup>i</sup> ≈ 1/e once i ≈ n, so the uninformed shrink by a factor of about e per round.
            </p>
            <p>
              The number of new nodes in a round is an occupancy count: u = n − i marked boxes among n − 1, hit by i balls,
            </p>
            <p style={{ textAlign: 'center' }}>
              <b>
                P(K = k) = C(u, k) Σ<sub>j</sub> (−1)<sup>j</sup> C(k, j) ((n − 1 − u + k − j)/(n − 1))<sup>i</sup>
              </b>
            </p>
            <p>and the win chance follows exactly by a small recursion over the informed count and the rounds left.</p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              The prize is locked when you bet at {(RTP * 100).toFixed(0)}% ÷ (chance for your settings). Cashing out pays prize × your win chance now,
              computed exactly. That chance is a martingale from round to round, so every round is a fair bet and, by optional stopping, the round is worth{' '}
              {(RTP * 100).toFixed(0)}% of your stake whenever you cash out. The largest prize on offer is {fmtMult(MAX_MULTIPLIER)}.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
