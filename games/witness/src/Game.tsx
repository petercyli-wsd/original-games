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
import {
  BETS,
  BET_LABEL,
  MAX_FOOLED_TESTS,
  RANGES,
  RANGE_IXS,
  RTP,
  TESTS,
  allowed,
  candidates,
  chance,
  drawN,
  isPrime,
  passChance,
  prize,
  runTest,
  wins,
  type Bet,
  type RangeIx,
  type Settings,
  type TestResult,
  type Tests,
} from './math';

type Phase = 'idle' | 'testing' | 'revealing' | 'checkpoint' | 'over';
type Outcome = 'caught' | 'revealed' | 'cashed';

interface Round {
  s: Settings;
  stake: number;
  n: number;
  prize: number;
  results: TestResult[];
  cash: number;
  outcome: Outcome | null;
}

const ACCENT = '#e9ff70';
const WIN_IF: Record<Bet, string> = { prime: 'if N is prime', composite: 'if N is composite', fooled: 'if N is composite and passes every test' };

function volatilityOf(p: number): Volatility {
  return p > 0.5 ? 'low' : p > 0.1 ? 'medium' : p > 0.002 ? 'high' : 'extreme';
}

const passesOf = (r: Round) => r.results.filter((t) => t.pass).length;

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [betOn, setBetOn] = useState<Bet>('prime');
  const [range, setRange] = useState<RangeIx>(1);
  const [tests, setTests] = useState<Tests>(2);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  // A test (or the reveal) is decided the moment it starts, so leaving
  // mid-animation settles at its real result, never at the pre-test value.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'testing' || phase === 'revealing' ? resolved.current : round?.cash ?? 0));

  const testMs = turbo.turbo ? 260 : 1000;
  const revealMs = turbo.turbo ? 200 : 700;
  const live = phase === 'testing' || phase === 'revealing' || phase === 'checkpoint';

  function finish(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setPhase('over');
  }

  function test(r: Round) {
    const result = runTest(r.n, rng);
    const passes = passesOf(r) + (result.pass ? 1 : 0);
    const cash = result.pass ? r.prize * chance(r.s.range, r.s.bet, r.s.tests, passes) : r.s.bet === 'composite' ? r.prize : 0;
    resolved.current = cash;
    setRound(r);
    setPhase('testing');
    timers.after(testMs, () => {
      const next = { ...r, results: [...r.results, result], cash };
      if (!result.pass) return finish(next, 'caught', cash);
      setRound(next);
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: cash, winChance: chance(r.s.range, r.s.bet, r.s.tests, passes) });
    });
  }

  function reveal(r: Round) {
    const cash = wins(r.s.bet, r.n, true) ? r.prize : 0;
    resolved.current = cash;
    setPhase('revealing');
    timers.after(revealMs, () => finish(r, 'revealed', cash));
  }

  function next() {
    if (phase !== 'checkpoint' || !round) return;
    if (round.results.length < round.s.tests) test(round);
    else reveal(round);
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const s: Settings = { range, bet: betOn, tests };
    const r: Round = { s, stake: bet.value, n: drawN(range, rng), prize: prize(s), results: [], cash: RTP, outcome: null };
    test(r);
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

  useHotkeys({ space: () => (phase === 'checkpoint' ? next() : !live ? void start() : undefined), cashOut }, !infoOpen);

  // What the board shows: the live or finished round, else a preview of the settings.
  const s: Settings = round?.s ?? { range, bet: betOn, tests };
  const passes = round ? passesOf(round) : 0;
  const done = round?.results.length ?? 0;
  const over = phase === 'over' && !!round?.outcome;
  const p = chance(s.range, s.bet, s.tests, passes);
  const pay = round?.prize ?? prize(s);
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const won = over && round!.cash > 0;
  const pPass = passChance(s.range, passes);
  const atReveal = done >= s.tests;
  const cands = candidates(s.range);

  const shown = over ? (round!.outcome === 'cashed' ? p : won ? 1 : 0) : p;

  const settingsP = chance(range, betOn, tests, 0);
  const vol = volatilityOf(settingsP);

  let title = '';
  if (over && round) {
    const prime = isPrime(round.n);
    if (round.outcome === 'cashed') title = 'Cashed out';
    else if (round.outcome === 'caught') title = 'Witness found';
    else title = prime ? 'N is prime' : 'N fooled the tests';
  }

  let status = `Ready · ${BET_LABEL[s.bet]} · ${RANGES[s.range].label} · ${s.tests} test${s.tests > 1 ? 's' : ''}`;
  if (phase === 'testing') status = `Running test ${done + 1} of ${s.tests} · base sealed`;
  if (phase === 'revealing') status = 'Revealing N';
  if (phase === 'checkpoint') status = atReveal ? `Passed all ${s.tests} · reveal or cash out` : `Passed ${passes} of ${s.tests} · probably prime`;
  if (over && round) status = `${title} · N = ${round.n}`;
  const tone = over ? (won ? 'won' : 'lost') : live ? 'live' : 'idle';

  return (
    <GameLayout
      name="Witness"
      accent={ACCENT}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={vol} />}>Bet on</Label>
          <Chips
            label="Bet on"
            options={BETS.map((v) => ({ value: v, label: BET_LABEL[v], title: WIN_IF[v] }))}
            value={betOn}
            disabled={live}
            onChange={(v) =>
              change(() => {
                setBetOn(v);
                if (!allowed(v, tests)) setTests(MAX_FOOLED_TESTS as Tests);
              })
            }
          />

          <Label hint="N is drawn from the odd numbers">Range</Label>
          <Chips
            label="Range"
            options={RANGE_IXS.map((v) => ({ value: v, label: RANGES[v].label }))}
            value={range}
            disabled={live}
            onChange={(v) => change(() => setRange(v))}
          />

          <Label hint={betOn === 'fooled' ? `Fooled: up to ${MAX_FOOLED_TESTS}` : 'then N is revealed'}>Tests</Label>
          <Chips
            label="Tests"
            options={TESTS.map((v) => ({
              value: v,
              label: v,
              disabled: !allowed(betOn, v),
              title: allowed(betOn, v) ? undefined : `Fooled allows at most ${MAX_FOOLED_TESTS} tests`,
            }))}
            value={tests}
            disabled={live}
            onChange={(v) => change(() => setTests(v))}
          />

          <dl className="og-stats">
            <dt>Chance to win</dt>
            <dd>{fmtChance(settingsP)}</dd>
            <dt>Prize</dt>
            <dd>{fmtMult(RTP / settingsP)}</dd>
          </dl>

          {phase === 'checkpoint' ? (
            <>
              <ActionButton kind="cash" onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" onClick={next}>
                {atReveal ? 'Reveal N' : `Run test ${done + 1} · ${fmtChance(pPass)} pass`}
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
              {phase === 'testing' ? 'Testing…' : phase === 'revealing' ? 'Revealing…' : phase === 'over' ? 'Bet again' : 'Bet'}
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
            label: 'Win chance',
            value: fmtChance(shown),
            sub: live ? 'lit share of the dots' : over ? (round!.outcome === 'cashed' ? 'when you cashed' : 'N is known') : 'before any test',
            tone: 'chance',
          },
          { label: 'Cash out now', value: live || over ? fmtMult(cash) : '—', sub: live || over ? formatAmount(stake * cash, 2) : 'after the first pass', tone: 'cash' },
          { label: 'Prize', value: fmtMult(pay), sub: WIN_IF[s.bet], tone: 'prize' },
        ]}
      />

      <Board>
        <Field
          range={s.range}
          bet={s.bet}
          tests={s.tests}
          passes={passes}
          results={round?.results ?? []}
          running={phase === 'testing' ? done : phase === 'revealing' ? s.tests : null}
          n={over ? round!.n : null}
          won={won}
          chance={shown}
          scanMs={testMs}
        />
        {over && round && (
          <RoundOver
            key={history[0]?.id}
            title={title}
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
          p={p}
          label={`Chance you win · ${BET_LABEL[s.bet]}`}
          note={
            atReveal
              ? 'All tests passed. Reveal N, or cash out at the lit share.'
              : `Next test passes ${fmtChance(pPass)} of the time. A pass shrinks every composite to its liar rate.`
          }
        />
      ) : (
        <Caption>
          N is one of the {cands.n.length} odd numbers in {RANGES[s.range].label} ({cands.primes} prime). Each test uses a fresh random base; a composite
          slips through only at its liar rate, always under ¼ (Rabin). RTP {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Witness" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              A hidden odd number N is drawn from the range. Bet that it is <b>Prime</b>, <b>Composite</b>, or <b>Fooled</b>: composite, yet it passes every
              Miller–Rabin test you run.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick your bet, the range and how many tests run, then bet. The first test runs at once.</li>
              <li>Each test picks a random base and says either "probably prime" or finds a witness, which proves N composite and ends the round.</li>
              <li>After each pass you can cash out, run the next test (Space), and after the last test reveal N.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              Every dot is a number N could be, and its area is how likely N is to be that number given what you've seen. Lit dots (or lit cores) are
              outcomes that win your bet, so <b>lit area ÷ total area is your chance</b>, shown again in the bar beneath. A pass leaves primes alone and
              shrinks each composite to its liar rate; most composites have no liars at all and vanish. The bases stay sealed until the round ends, because
              the price only uses pass or witness.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Write N − 1 = 2<sup>s</sup>·d with d odd. Base a passes when a<sup>d</sup> ≡ 1 or a<sup>2<sup>i</sup>d</sup> ≡ −1 (mod N) for some i &lt; s.
              Primes pass every base. A composite's passing bases are its strong liars; Rabin proved there are fewer than φ(N)/4 of them, and Monier's
              formula counts them exactly from N's factors. After r passes, Bayes gives each prime weight 1 and each composite weight f<sup>r</sup>, where f
              is its liar rate.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              A win pays the prize RTP ÷ P(win), fixed when you bet. Cashing out pays the prize × your current chance, which is exact Bayes for what you
              can see, so every test is a fair bet and the round is worth {(RTP * 100).toFixed(0)}% of your stake however and whenever you cash out.
              Fooled allows at most {MAX_FOOLED_TESTS} tests, which keeps its prize under 4,000×.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
