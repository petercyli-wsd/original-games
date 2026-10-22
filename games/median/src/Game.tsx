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
import Field, { type Outcome } from './Board';
import {
  MAX_PRIZE,
  POINTS,
  RTP,
  WIDTHS,
  burstSize,
  clampLo,
  decided,
  half,
  loRange,
  outcomes,
  prizeFor,
  settingsChance,
  tally,
  volatilityOf,
  windowOf,
  type Points,
  type Settings,
  type Width,
} from './math';

type Phase = 'idle' | 'dropping' | 'checkpoint' | 'over';

interface Round {
  s: Settings;
  stake: number;
  /** Locked at bet time: RTP / P(start). */
  prize: number;
  /** Every point decided so far, including the burst in flight. */
  points: number[];
  /** How many of them are on the board. */
  shown: number;
  cash: number;
  outcome: Outcome | null;
}

const ACCENT = '#f4d35e';
const OUTCOME_TITLE: Record<Outcome, string> = { win: 'Median in the window', bust: 'Median pulled out', cashed: 'Cashed out' };

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [n, setN] = useState<Points>(9);
  const [width, setWidth] = useState<Width>(20);
  const [lo, setLo] = useState(40);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  // A burst is decided the moment it starts, so leaving mid-animation settles
  // at its real result, never at the pre-burst value.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'dropping' ? resolved.current : round?.cash ?? 0));

  const dropMs = turbo.turbo ? 90 : 340;
  const live = phase === 'dropping' || phase === 'checkpoint';

  function finish(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash, shown: r.points.length });
    setPhase('over');
  }

  function drop(r: Round) {
    const { a, b } = windowOf(r.s);
    const points = r.points.slice();
    for (let i = 0; i < burstSize(r.s.n) && !decided(r.s.n, tally(points, a, b)); i++) points.push(rng.next());
    const t = tally(points, a, b);
    const d = decided(r.s.n, t);
    const cash = d === 'win' ? r.prize : d === 'bust' ? 0 : r.prize * outcomes(r.s.n, t, a, b).win;
    resolved.current = cash;

    const next: Round = { ...r, points, cash };
    setRound({ ...r, points });
    setPhase('dropping');
    const k = points.length - r.points.length;
    for (let i = 1; i <= k; i++) timers.after(i * dropMs, () => setRound((cur) => (cur ? { ...cur, shown: r.points.length + i } : cur)));
    timers.after(k * dropMs + Math.round(dropMs * 0.6), () => {
      if (d) return finish(next, d, cash);
      setRound({ ...next, shown: points.length });
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: cash, winChance: cash / r.prize });
    });
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const s: Settings = { n, width, lo };
    const r: Round = { s, stake: bet.value, prize: prizeFor(s), points: [], shown: 0, cash: RTP, outcome: null };
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
    setPhase('idle');
  }

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    if (live) return;
    apply();
    if (phase === 'over') clear();
  };
  const pickN = (v: Points) => change(() => (setN(v), setLo((l) => clampLo(v, width, l))));
  const pickWidth = (v: Width) => change(() => (setWidth(v), setLo((l) => clampLo(n, v, l + (width - v) / 2))));
  const moveTo = (centre: number) => {
    const next = clampLo(n, width, centre - width / 2);
    if (next !== lo || phase === 'over') change(() => setLo(next));
  };

  useHotkeys(
    {
      space: () => (phase === 'checkpoint' && round ? drop(round) : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const s = round?.s ?? { n, width, lo };
  const { a, b } = windowOf(s);
  const shown = round ? round.points.slice(0, round.shown) : [];
  const t = tally(shown, a, b);
  const odds = outcomes(s.n, t, a, b);
  const prize = round?.prize ?? prizeFor(s);
  const cash = phase === 'dropping' ? prize * odds.win : round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const m = half(s.n);
  const left = s.n - shown.length;
  const nextBurst = Math.min(burstSize(s.n), left);

  const p0 = settingsChance({ n, width, lo });
  const range = loRange(n, width);
  const vol = volatilityOf(p0);

  let status = `Ready · ${s.n} points, window ${s.lo}–${s.lo + s.width}%`;
  if (phase === 'dropping') status = `Dropping · ${shown.length} of ${s.n} points`;
  if (phase === 'checkpoint') status = `Checkpoint · ${shown.length} of ${s.n} points`;
  if (phase === 'over' && round?.outcome) status = `${OUTCOME_TITLE[round.outcome]} · ${shown.length} points`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  return (
    <GameLayout
      name="Median"
      accent={ACCENT}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={vol} />}>Points</Label>
          <Chips label="Points" options={POINTS.map((v) => ({ value: v, label: v }))} value={n} disabled={live} onChange={pickN} />

          <Label hint="narrower pays more">Window width</Label>
          <Chips label="Window width" options={WIDTHS.map((v) => ({ value: v, label: `${v}%` }))} value={width} disabled={live} onChange={pickWidth} />

          <Label hint={<b>{`${lo}–${lo + width}%`}</b>}>Window position</Label>
          <Slider
            label="Window position"
            min={range.min}
            max={range.max}
            value={lo}
            disabled={live}
            onChange={(v) => change(() => setLo(clampLo(n, width, v)))}
          />
          <div className="median-hint">
            <span>edge: long odds</span>
            <span>centre: safer</span>
          </div>

          <dl className="og-stats">
            <dt>Chance to win</dt>
            <dd>{fmtChance(p0)}</dd>
            <dt>Prize</dt>
            <dd>{fmtMult(prizeFor({ n, width, lo }))}</dd>
          </dl>

          {phase === 'checkpoint' ? (
            <>
              <ActionButton kind="cash" onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" onClick={() => round && drop(round)}>
                {nextBurst === left ? `Drop the last ${left === 1 ? 'point' : left}` : `Drop ${nextBurst} more`} · {fmtChance(odds.win)} to win
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
          {
            label: 'Median in window',
            value: fmtChance(odds.win),
            sub: phase === 'idle' ? `${s.n} points to drop` : `${left} point${left === 1 ? '' : 's'} to drop`,
            tone: 'chance',
          },
          { label: 'Cash out now', value: live || phase === 'over' ? fmtMult(cash) : '—', sub: live || phase === 'over' ? formatAmount(stake * cash, 2) : 'after each drop', tone: 'cash' },
          { label: 'Prize', value: fmtMult(prize), sub: formatAmount(stake * prize, 2), tone: 'prize' },
        ]}
      />

      <Board className="median-board">
        <Field
          n={s.n}
          a={a}
          b={b}
          points={shown}
          tally={t}
          odds={odds}
          preview={phase === 'idle'}
          outcome={phase === 'over' ? round?.outcome ?? null : null}
          dropMs={dropMs}
          onDrag={moveTo}
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
            placement="inline"
          />
        )}
      </Board>

      {live ? (
        <ChanceBar
          p={odds.win}
          label="Median lands in your window"
          note={`The green share of the bar on the board. You lose only if ${m + 1} points land on the same side of the window.`}
        />
      ) : (
        <Caption>
          {s.n} points drop on the line; the {m + 1}th smallest is the median. It lands in your window {fmtChance(p0)} of the time (the shaded area). Prize
          capped at {MAX_PRIZE.toLocaleString('en-US')}×. RTP {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Median" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              An odd number of points drop at random on a line from 0 to 1. The <b>median</b> is the middle one. Place a window on the line before you bet:
              you win if the median ends up inside it.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Choose how many points drop, how wide the window is and where it sits (slider, or drag on the board). Then bet.</li>
              <li>Points drop in small bursts. After each burst you can cash out (C) or drop the next burst (Space).</li>
              <li>
                With n = 2m + 1 points, you lose as soon as m + 1 points land below the window, or m + 1 above it. You win as soon as neither side can get
                there any more.
              </li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              Before the bet, the curve is the law of the median and the <b style={{ color: 'var(--green)' }}>shaded area</b> under your window is your chance.
            </p>
            <p>
              During the round it is a tug of war. Each side of the window has m slots; the last, square slot is <b style={{ color: 'var(--red)' }}>bust</b>.
              Every point lands below, inside or above with the lengths of the line's three parts. The bar at the bottom splits 100% into where the median will
              finish: <b style={{ color: 'var(--red)' }}>below</b>, <b style={{ color: 'var(--green)' }}>in your window</b> or{' '}
              <b style={{ color: 'var(--red)' }}>above</b>. The green share is your chance now.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              The median of n = 2m + 1 uniform points has the Beta(m + 1, m + 1) distribution, with density proportional to x<sup>m</sup>(1 − x)<sup>m</sup>.
              So P(win) = I<sub>b</sub>(m+1, m+1) − I<sub>a</sub>(m+1, m+1). The reason is the tug of war: the median is below a exactly when at least m + 1
              points are below a, and that count is binomial.
            </p>
            <p>
              Mid-round, with r points left, the chance is an exact multinomial sum over how they split between the three parts, with probabilities a, b − a
              and 1 − b. More points squeeze the curve towards ½: a centred window gets safer, an edge window gets rarer.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              The prize is locked when you bet, at {(RTP * 100).toFixed(0)}% ÷ (chance for your window). Cashing out pays prize × your chance now. Each
              point's three outcomes average back to the chance before it, so every drop is a fair bet, and by optional stopping the round is worth{' '}
              {(RTP * 100).toFixed(0)}% of your stake whenever you cash out. Where you put the window trades chance for prize, never value. Windows whose
              prize would pass {MAX_PRIZE.toLocaleString('en-US')}× are not offered, so no payout exceeds it.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
