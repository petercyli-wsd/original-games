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
import { useMemo, useRef, useState } from 'react';
import Field, { type Probe } from './Board';
import {
  BETS,
  MAX_N,
  MIN_N,
  OMEGA_COUNTS,
  PAUSES,
  PAUSE_LABEL,
  RANGE,
  RTP,
  baseChance,
  betLabel,
  betPhrase,
  decided,
  divisor,
  finish as runToEnd,
  fmtFactors,
  fmtInt,
  fork,
  odds,
  pausesAfter,
  prize,
  startTrial,
  step,
  volatilityOf,
  winners,
  type Bet,
  type Pause,
  type Trial,
} from './math';

type Phase = 'idle' | 'dividing' | 'checkpoint' | 'over';
type Outcome = 'won' | 'lost' | 'cashed';

interface Round {
  bet: Bet;
  pause: Pause;
  stake: number;
  /** The hidden number, drawn when the bet is placed. */
  n: number;
  trial: Trial;
  /** The state before the last division (for the cells it ruled out). */
  prev: Trial | null;
  cash: number;
  outcome: Outcome | null;
}

/** Average Ω(N) over the range (Erdős–Kac centre, about ln ln N + 1.03). */
const MEAN_OMEGA = OMEGA_COUNTS.reduce((s, c, w) => s + c * w, 0) / RANGE;

function title(bet: Bet, outcome: Outcome, omega: number) {
  if (outcome === 'cashed') return 'Cashed out';
  if (outcome === 'won') return bet === 1 ? 'Prime!' : `${omega} prime factors`;
  return bet === 1 ? 'Not prime' : `Only ${omega} prime factor${omega === 1 ? '' : 's'}`;
}

const pct = (x: number) => (x > 0 && x < 0.01 ? '<1%' : `${Math.round(x * 100)}%`);

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [backing, setBacking] = useState<Bet>(3);
  const [pause, setPause] = useState<Pause>('test');
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [probe, setProbe] = useState<Probe | null>(null);
  const [stepKey, setStepKey] = useState(0);
  const [infoOpen, setInfoOpen] = useState(false);

  // The division in flight is decided the moment it starts, so leaving
  // mid-animation settles at its real result, never at the pre-step value.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'dividing' ? resolved.current : (round?.cash ?? 0)));

  const tryMs = turbo.turbo ? 110 : 420;
  const showMs = turbo.turbo ? 90 : 330;
  const live = phase === 'dividing' || phase === 'checkpoint';

  function settle(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setProbe(null);
    setPhase('over');
  }

  /** One division test. Its outcome (and the cash-out after it) is fixed before the animation starts. */
  function divide(r: Round) {
    const before = r.trial;
    const next = step(before, r.n);
    const o = odds(next, r.bet);
    const end = decided(o);
    const full = prize(r.bet);
    const cash = end ? (o.win ? full : 0) : full * o.chance;
    resolved.current = cash;
    const pTried = divisor(before);
    const divisorTried: Probe['result'] = next.tests === before.tests ? 'end' : next.exps[before.i] > before.exps[before.i] ? 'hit' : 'miss';

    setPhase('dividing');
    setProbe({ p: pTried, result: null });
    // Runs that don't stop at every test play faster.
    const k = r.pause === 'test' ? 1 : 0.4;
    timers.after(tryMs * k, () => {
      setProbe({ p: pTried, result: divisorTried });
      timers.after(showMs * k, () => {
        const nr: Round = { ...r, trial: next, prev: before, cash };
        setStepKey((s) => s + 1);
        if (end) return settle(nr, o.win ? 'won' : 'lost', cash);
        setRound(nr);
        if (!pausesAfter(r.pause, before, next)) return divide(nr);
        setProbe(null);
        setPhase('checkpoint');
        track({ type: 'checkpoint', multiplier: cash, winChance: o.chance });
      });
    });
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const n = MIN_N + rng.int(RANGE);
    const r: Round = { bet: backing, pause, stake: bet.value, n, trial: startTrial(), prev: null, cash: RTP, outcome: null };
    setRound(r);
    divide(r);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    settle(round, 'cashed', round.cash);
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    setRound(null);
    setProbe(null);
    setPhase('idle');
  }

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    apply();
    if (phase === 'over') clear();
  };

  useHotkeys(
    {
      space: () => (phase === 'checkpoint' && round ? divide(round) : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const b = round?.bet ?? backing;
  const trial = useMemo(() => round?.trial ?? startTrial(), [round]);
  const reveal = useMemo(() => (phase === 'over' && round ? runToEnd(round.trial, round.n) : null), [phase, round]);
  const o = odds(trial, b);
  const f = phase === 'checkpoint' ? fork(trial, b) : null;
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const full = prize(b);
  const vol = volatilityOf(backing);
  const omega = reveal?.factors.length ?? 0;

  let status = `Ready · bet ${betLabel(b)} · N from ${MIN_N} to ${fmtInt(MAX_N)}`;
  if (phase === 'dividing' && probe) status = `Dividing by ${probe.p}`;
  if (phase === 'checkpoint') status = `Checkpoint · ${trial.tests} division${trial.tests === 1 ? '' : 's'}, ${trial.factors.length} factor${trial.factors.length === 1 ? '' : 's'} found`;
  if (phase === 'over' && round?.outcome && reveal) status = `${title(b, round.outcome, omega)} · N = ${fmtInt(reveal.found)} = ${fmtFactors(reveal.factors)}`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  return (
    <GameLayout
      name="Factor"
      accent="#f4a261"
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={vol} />}>Bet that N has</Label>
          <Chips
            label="Bet that N has"
            wrap
            options={BETS.map((v) => ({ value: v, label: betLabel(v), title: betPhrase(v) }))}
            value={backing}
            disabled={live}
            onChange={(v) => change(() => setBacking(v))}
          />

          <Label hint="same value either way">Stop to cash out</Label>
          <Chips
            label="Stop to cash out"
            options={PAUSES.map((v) => ({ value: v, label: PAUSE_LABEL[v] }))}
            value={pause}
            disabled={live}
            onChange={(v) => change(() => setPause(v))}
          />
          <dl className="og-stats">
            <dt>Chance to win</dt>
            <dd>{fmtChance(baseChance(backing))}</dd>
            <dt>Prize</dt>
            <dd>{fmtMult(prize(backing))}</dd>
          </dl>

          {phase === 'checkpoint' ? (
            <>
              <ActionButton kind="cash" onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" onClick={() => round && divide(round)}>
                Divide by {f?.p ?? '…'} {f ? `· ${pct(f.pHit)} it divides` : ''}
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
              {phase === 'dividing' ? 'Dividing…' : phase === 'over' ? 'Bet again' : 'Bet'}
            </ActionButton>
          )}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />

      <Readouts
        items={[
          { label: 'Win chance', value: fmtChance(o.chance), sub: `${fmtInt(o.win)} of ${fmtInt(o.total)} lit`, tone: 'chance' },
          { label: 'Cash out now', value: live || phase === 'over' ? fmtMult(cash) : '—', sub: formatAmount(stake * cash, 2), tone: 'cash' },
          { label: 'Prize', value: fmtMult(full), sub: `if ${betPhrase(b)}`, tone: 'prize' },
        ]}
      />

      <Board className="fx-board">
        <Field
          bet={b}
          trial={trial}
          prev={round?.prev ?? null}
          stepKey={stepKey}
          probe={probe}
          reveal={reveal}
          live={live}
          chance={o.chance}
          win={o.win}
          total={o.total}
          ms={tryMs}
          overlay={
            phase === 'over' && round?.outcome ? (
              <RoundOver
                key={history[0]?.id}
                title={title(round.bet, round.outcome, omega)}
                multiplier={round.cash}
                stake={round.stake}
                nextBet={bet.value}
                blocked={bet.blocked}
                onBetAgain={() => void start()}
                onClear={clear}
                placement="center"
              />
            ) : undefined
          }
        />
      </Board>

      {live ? (
        <ChanceBar
          p={o.chance}
          label={`Chance ${betPhrase(b)}`}
          note="Exactly the lit share of the dots: every N still consistent with the divisions so far."
        />
      ) : (
        <Caption>
          N is uniform on {MIN_N}…{fmtInt(MAX_N)}: {fmtInt(winners(b))} of {fmtInt(RANGE)} {b === 1 ? 'are prime' : `have ${b}+ prime factors`}, so you win{' '}
          {fmtChance(baseChance(b))} of the time. On average Ω(N) = {MEAN_OMEGA.toFixed(2)} here. RTP {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Factor" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              A whole number N between {MIN_N} and {fmtInt(MAX_N)} is hidden. Bet on how many prime factors it has, counted with repeats (12 = 2·2·3 has three):
              either <b>N is prime</b>, or <b>N has k or more</b> prime factors.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick your bet, choose where the round stops to offer a cash-out (after every division, after each new factor, or never), then bet.</li>
              <li>
                N is factored by trial division: divide by 2 as long as it goes, then 3, 5, 7… Each found factor grows the factor tree. The run stops once p² is
                larger than what's left, which is then 1 or a prime.
              </li>
              <li>At a checkpoint, cash out or divide by the next prime (Space). The round ends by itself as soon as the bet is certain to win or to lose.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The square holds every N from 0 to 9,999, 100 per row. Dots that are still possible stay on: <b style={{ color: 'var(--accent)' }}>lit</b> ones
              win your bet, dim ones lose, and the faint grid is ruled out. All candidates are equally likely, so the lit share is exactly your chance.
            </p>
            <p>
              The bars give the chance of each final count Ω(N) among the candidates (green ones win). The trial-divisor strip shows primes already tried
              (struck out if they missed, with their power if they hit) and how far the run can still go.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              After the divisions so far, the hidden remainder m = N / (factors found) has no prime factor below the current divisor p, lies under ⌊9999 /
              found⌋, and is at least p² (the guard that let the run continue). Those are the only constraints, so the odds are an exact count over a sieve.
            </p>
            <p>
              The Erdős–Kac theorem says Ω(N) is roughly normal with mean and variance ln ln N. Here the mean is {MEAN_OMEGA.toFixed(2)} (ln ln N plus Mertens'
              constant 1.03), and only 33 numbers have ten or more prime factors.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              A win pays prize = {(RTP * 100).toFixed(0)}% ÷ P(win), fixed when you bet. Cashing out pays prize × (lit share now). Each division splits the
              candidates into those it divides and those it doesn't, so on average the chance after it equals the chance before. The cash-out is a martingale and,
              by optional stopping, every strategy and every stop setting returns exactly {(RTP * 100).toFixed(0)}% of your stake.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}

