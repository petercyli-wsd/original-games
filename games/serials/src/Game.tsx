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
import SerialsBoard, { fmtP } from './Board';
import {
  CUT_MAX,
  CUT_MIN,
  DRAWS,
  MAX_PRIZE,
  N_MIN,
  RTP,
  drawSerial,
  drawTop,
  lowestN,
  minCut,
  nextBust,
  openingPrize,
  posterior,
  posteriorMean,
  priorChance,
  relockPrize,
  volatilityOf,
  winChance,
  type Draws,
} from './math';

type Phase = 'idle' | 'drawing' | 'checkpoint' | 'revealing' | 'over';
type Outcome = 'won' | 'lost' | 'bust' | 'cashed';

interface Round {
  cut: number;
  total: Draws;
  stake: number;
  /** The hidden top serial, drawn at the bet. */
  n: number;
  drawn: number[];
  prize: number;
  cash: number;
  outcome: Outcome | null;
}

/** Animation times in ms (turbo runs them at a quarter). */
const MS = { roll: 480, land: 560, reveal: 700 };

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [cut, setCut] = useState(40);
  const [total, setTotal] = useState<Draws>(4);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [rolling, setRolling] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  // Each draw and the reveal are decided the moment they start, so the fair
  // value jumps to the resolved result straight away: leaving mid-animation
  // settles at the real outcome, never at the pre-step value.
  const fair = useRef(0);
  const ticket = useTicket(() => fair.current);

  const live = phase === 'drawing' || phase === 'checkpoint' || phase === 'revealing';
  const dur = (ms: number) => Math.round(turbo.turbo ? ms * 0.25 : ms);

  function finish(r: Round, outcome: Outcome, cash: number) {
    fair.current = cash;
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setRolling(false);
    setPhase('over');
  }

  function draw(r: Round) {
    const s = drawSerial(r.n, r.drawn, rng.next());
    const drawn = [...r.drawn, s];
    const max = Math.max(...drawn);
    const p = winChance(drawn.length, max, r.cut);
    const cash = r.prize * p;
    fair.current = cash;
    setPhase('drawing');
    setRolling(true);
    const t1 = dur(MS.roll);
    timers.after(t1, () => {
      setRolling(false);
      setRound({ ...r, drawn, cash });
    });
    timers.after(t1 + dur(MS.land), () => {
      const next = { ...r, drawn, cash };
      if (p === 0) return finish(next, 'bust', 0);
      setRound(next);
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: cash, winChance: p });
    });
  }

  function reveal(r: Round) {
    const won = r.n <= r.cut;
    const pay = won ? r.prize : 0;
    fair.current = pay;
    setPhase('revealing');
    timers.after(dur(MS.reveal), () => finish(r, won ? 'won' : 'lost', pay));
  }

  async function start() {
    if (live || bet.blocked) return;
    fair.current = RTP;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const r: Round = { cut, total, stake: bet.value, n: drawTop(rng.next()), drawn: [], prize: openingPrize(cut), cash: RTP, outcome: null };
    setRound(r);
    draw(r);
  }

  function cashOutNow() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', round.cash);
  }

  function step() {
    if (phase !== 'checkpoint' || !round) return;
    if (round.drawn.length < round.total) draw(round);
    else reveal(round);
  }

  function revealNow() {
    if (phase !== 'checkpoint' || !round) return;
    reveal(round);
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    setRound(null);
    setRolling(false);
    setPhase('idle');
  }

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    apply();
    if (phase === 'over') clear();
  };

  // At a checkpoint the cut can move: the cash-out is kept and the prize re-locked.
  function moveCut(x: number) {
    if (phase === 'checkpoint' && round) {
      const j = round.drawn.length;
      const max = Math.max(...round.drawn);
      const to = Math.min(CUT_MAX, Math.max(minCut(round.cash, j, max), x));
      setCut(to);
      setRound({ ...round, cut: to, prize: relockPrize(round.cash, j, max, to) });
      return;
    }
    if (!live) change(() => setCut(x));
  }

  useHotkeys({ space: () => (phase === 'checkpoint' ? step() : !live ? void start() : undefined), cashOut: cashOutNow }, !infoOpen);

  // What the board shows: the live or finished round, else a preview of the settings.
  const X = round?.cut ?? cut;
  const k = round?.total ?? total;
  const drawn = round?.drawn ?? [];
  const j = drawn.length;
  const max = j ? Math.max(...drawn) : 0;
  const post = posterior(j, max);
  const pWin = winChance(j, max, X);
  const prize = round?.prize ?? openingPrize(cut);
  const cash = round ? round.cash : RTP;
  const stake = round?.stake ?? bet.value;
  const truth = phase === 'over' && round ? round.n : null;
  const atCheckpoint = phase === 'checkpoint' && !!round;
  const left = k - j;
  const q = atCheckpoint && left > 0 ? nextBust(j, max, X) : 0;
  const vol = volatilityOf(cut);
  const lowCut = atCheckpoint && round ? minCut(round.cash, j, max) : CUT_MIN;

  let status = `Ready · bet N ≤ ${X} · ${k} serials`;
  if (phase === 'drawing') status = `Drawing serial ${j + (rolling ? 1 : 0)} of ${k}`;
  if (phase === 'checkpoint') status = left > 0 ? `Checkpoint · ${j} of ${k} serials` : `All ${k} serials in · reveal or cash out`;
  if (phase === 'revealing') status = 'Revealing N';
  let title = 'Cashed out';
  if (round?.outcome === 'won') title = `N = ${round.n} · inside the cut`;
  if (round?.outcome === 'lost') title = `N = ${round.n} · above the cut`;
  if (round?.outcome === 'bust') title = `Serial ${max} is above ${X}`;
  if (phase === 'over' && round) status = round.outcome === 'cashed' ? `Cashed out · N was ${round.n}` : title;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  let overNote = '';
  if (phase === 'over' && round) {
    if (round.outcome === 'bust') overNote = `Serial ${max} proves N ≥ ${max} > ${X}, so the bet was lost on the spot. N was ${round.n}.`;
    else {
      const before = winChance(j, max, X);
      const said = `${j} serial${j === 1 ? '' : 's'} (largest ${max}) had put N ≤ ${X} at ${fmtP(before)}`;
      overNote =
        round.outcome === 'cashed'
          ? `N was ${round.n}. ${said}; holding to the reveal would have paid ${fmtMult(round.n <= X ? round.prize : 0)}.`
          : `N was ${round.n}. ${said} before the reveal.`;
    }
  }

  const mean = posteriorMean(j, max);

  return (
    <GameLayout
      name="Serials"
      accent="#ffafcc"
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={atCheckpoint ? 'moving keeps your cash-out' : <VolBadge level={vol} />}>Bet N ≤ {X}</Label>
          <Slider
            label="Cut: bet the top serial is at most this"
            min={CUT_MIN}
            max={CUT_MAX}
            value={X}
            risk
            disabled={live && !atCheckpoint}
            onChange={moveCut}
          />

          <Label hint="then N is revealed">Serials drawn</Label>
          <Chips
            label="Serials drawn before the reveal"
            options={DRAWS.map((v) => ({ value: v, label: v }))}
            value={k}
            disabled={live}
            onChange={(v) => change(() => setTotal(v as Draws))}
          />

          <dl className="og-stats">
            <dt>{round && phase !== 'over' ? 'Chance now' : 'Chance to win'}</dt>
            <dd>{fmtP(round && phase !== 'over' ? pWin : priorChance(cut))}</dd>
            <dt>Prize</dt>
            <dd>{fmtMult(round && phase !== 'over' ? prize : openingPrize(cut))}</dd>
          </dl>

          {live && round ? (
            <>
              <ActionButton kind="cash" disabled={!atCheckpoint} onClick={cashOutNow}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              {phase === 'revealing' ? (
                <ActionButton kind="secondary" disabled>
                  Revealing…
                </ActionButton>
              ) : left > 0 || phase === 'drawing' ? (
                <>
                  <ActionButton kind="secondary" disabled={!atCheckpoint} onClick={step}>
                    {phase === 'drawing' ? 'Drawing…' : `Draw serial · ${fmtChance(1 - q)} safe`}
                  </ActionButton>
                  <ActionButton kind="secondary" disabled={!atCheckpoint} onClick={revealNow}>
                    Reveal N now · {fmtP(pWin)} win
                  </ActionButton>
                </>
              ) : (
                <ActionButton kind="secondary" disabled={!atCheckpoint} onClick={step}>
                  Reveal N · {fmtP(pWin)} win
                </ActionButton>
              )}
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
          {
            label: `Chance N ≤ ${X}`,
            value: fmtP(pWin),
            sub: !round ? `prior (${X} − 9) / 91` : truth !== null ? `N was ${truth}` : 'green mass left of the cut',
            tone: 'chance',
          },
          { label: 'Cash out now', value: round ? fmtMult(cash) : '—', sub: round ? formatAmount(stake * cash, 2) : `opens at ${fmtMult(RTP)}`, tone: 'cash' },
          { label: 'Prize', value: fmtMult(prize), sub: `if N ≤ ${X}`, tone: 'prize' },
        ]}
      />

      <Board className="serials-stage">
        <SerialsBoard
          cut={X}
          total={k}
          drawn={drawn}
          rolling={rolling}
          post={post}
          lo={lowestN(max)}
          win={pWin}
          truth={truth}
          revealing={phase === 'revealing'}
          ms={dur(MS.land * 0.85)}
        />
        {phase === 'over' && round?.outcome && (
          <RoundOver
            key={history[0]?.id}
            title={title}
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
          p={pWin}
          label={`Chance the top serial N ≤ ${X}`}
          note={
            phase === 'revealing' ? (
              <>Turning over N…</>
            ) : j === 0 ? (
              <>Before any serial every N from 10 to 100 is equally likely: the flat prior.</>
            ) : (
              <>
                P(N | serials) ∝ 1 / C(N, {j}) for N ≥ {lowestN(max)}; posterior mean {mean.toFixed(1)}.{' '}
                {atCheckpoint && left > 0 ? `Next serial lands above ${X} (lost) with chance ${fmtChance(q)}.` : ''}
                {atCheckpoint && lowCut > Math.max(N_MIN, max) ? ` Cuts below ${lowCut} would lift the prize past ${MAX_PRIZE}×.` : ''}
              </>
            )
          }
        />
      ) : phase === 'over' && round ? (
        <Caption>{overNote}</Caption>
      ) : (
        <Caption>
          The top serial N is uniform on 10–100. Each serial drawn rules out every N below it and reweights the rest by 1 / C(N, j). Bet N ≤ {X}: hold to
          the reveal and you win {fmtChance(priorChance(X))} of the time. RTP {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Serials" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              A hidden top serial N is picked between 10 and 100. Serial numbers are drawn at random from 1 to N and shown to you, then N is revealed. You win the
              prize if N is at most your cut X.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick your cut X with the slider and how many serials you get to see, then bet. The first serial is drawn straight away.</li>
              <li>After each serial you can cash out (C), draw another (Space), or reveal N now.</li>
              <li>A serial above X proves N &gt; X: the round is lost on the spot. After the last serial, cash out or reveal N.</li>
              <li>At a checkpoint you can also drag the cut. Your cash-out stays the same and the prize is re-priced to match.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The histogram is the chance of every possible N given what you have seen. Bars left of the cut are{' '}
              <b style={{ color: 'var(--green)' }}>green</b> (you win if N is one of them), bars right of it are <b style={{ color: 'var(--red)' }}>red</b>.
              The green share of the total mass is your chance to win, printed above the chart. Values below the largest serial are ruled out.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              The German tank problem. Seeing j particular serials from 1..N has chance 1 / (N (N−1) ⋯ (N−j+1)), which is 1 / (j!·C(N, j)) when N is at
              least the largest serial m and 0 otherwise. With a flat prior, Bayes' rule gives
            </p>
            <p>P(N | serials) ∝ 1 / C(N, j) for max(10, m) ≤ N ≤ 100.</p>
            <p>
              Only the count and the largest serial matter. The posterior is a martingale: averaged over the next serial, every bar stays where it is, so the
              chance N ≤ X drifts with no bias, up or down.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Betting N ≤ X pays {(RTP * 100).toFixed(0)}% ÷ P(N ≤ X) = {(RTP * 100).toFixed(0)}% × 91 / (X − 9): from {fmtMult(openingPrize(CUT_MAX))} at
              X = 99 to {fmtMult(openingPrize(CUT_MIN))} at X = 10. Cashing out pays that prize × the green mass. Every draw, reveal and cut move is a fair
              bet at that price, so the round is worth {(RTP * 100).toFixed(0)}% of your stake however you play it. Moving the cut is limited to prizes up to{' '}
              {MAX_PRIZE}×, which is the most any round can pay.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
