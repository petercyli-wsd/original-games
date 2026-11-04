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
import { useEffect, useMemo, useRef, useState } from 'react';
import Ring, { type Flight, type TokenPos } from './Board';
import {
  BALLS,
  MAX_SLIDE,
  RTP,
  SLOTS,
  afterSafeBall,
  drop,
  emptyTable,
  maxMultiplier,
  redCount,
  redSlots,
  slideDistance,
  volatilityOf,
  winChance,
  type Balls,
} from './math';

type Phase = 'idle' | 'probing' | 'checkpoint' | 'over';
type Outcome = 'bust' | 'cashed' | 'full';

interface Round {
  target: number;
  stake: number;
  table: boolean[];
  placed: number;
  newest: number | null;
  cash: number;
  outcome: Outcome | null;
}

const ACCENT = '#00bbf9';
const OUTCOME_TITLE: Record<Outcome, string> = { bust: 'Bust', cashed: 'Cashed out', full: 'All balls placed' };
const m = SLOTS;
const P = MAX_SLIDE;
const slides = `${P} slot${P === 1 ? '' : 's'}`;

/** Narrow boards get the result card inline, below the ring, so it never covers the slots. */
function useNarrow(threshold: number) {
  const [el, setEl] = useState<SVGSVGElement | null>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setNarrow(e.contentRect.width < threshold));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, threshold]);
  return [narrow, setEl] as const;
}

export default function Game() {
  const { rng, track } = useHost();
  const [narrow, svgRef] = useNarrow(470);
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [balls, setBalls] = useState<Balls>(10);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [flight, setFlight] = useState<Flight | null>(null);
  const [token, setToken] = useState<TokenPos>({ turn: 0, ms: 0, ease: 'spin' });
  const [infoOpen, setInfoOpen] = useState(false);

  // The open ticket's value: RTP from the bet, then each ball's result the
  // moment it drops (before it slides), so leaving mid-slide settles at its
  // real result, never at the safer pre-drop value. The ticket reads only this
  // ref: the rendered phase and round can be one render stale (leaving right
  // after Bet used to settle the new stake at the previous round's payout).
  const resolved = useRef<number>(0);
  const ticket = useTicket(() => resolved.current);

  // Risky balls get a full spin and a visible pause on their slide window;
  // balls that can't bust (nothing red) go in quickly.
  const T = turbo.turbo
    ? { spin: 130, pause: 40, hop: 40, settle: 55, free: { spin: 55, pause: 10, hop: 22, settle: 25, gap: 15 } }
    : { spin: 520, pause: 170, hop: 150, settle: 220, free: { spin: 220, pause: 40, hop: 85, settle: 90, gap: 60 } };
  // Scheduled drops read the latest timings, so Turbo applies mid-burst.
  const timing = useRef(T);
  timing.current = T;
  const live = phase === 'probing' || phase === 'checkpoint';

  function finish(r: Round, outcome: Outcome, cash: number) {
    timers.clearAll();
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setPhase('over');
  }

  /** Drops the next ball, animates its slide, then settles the step. */
  function dropBall(r: Round) {
    timers.clearAll();
    const red = redCount(r.table, P);
    const free = red === 0;
    const h = rng.int(m);
    const res = drop(r.table, h, P);
    const cash = res.safe ? afterSafeBall(r.cash, red, m) : 0;
    resolved.current = cash;
    setPhase('probing');

    const now = timing.current;
    const { spin, pause, hop, settle } = free ? now.free : now;
    setFlight({ home: h, hop: 0, arrived: false, safe: res.safe, done: false, need: slideDistance(r.table, h) });
    setToken((t) => {
      const goal = (h + 0.5) / m;
      let delta = (((goal - t.turn) % 1) + 1) % 1;
      if (delta < (free ? 0.02 : 0.4)) delta += 1;
      return { turn: t.turn + delta, ms: spin, ease: 'spin' };
    });
    timers.after(spin, () => setFlight((f) => f && { ...f, arrived: true }));
    for (let i = 1; i <= res.hops; i++) {
      const at = spin + pause + (i - 1) * hop;
      timers.after(at, () => setToken((t) => ({ turn: t.turn + 1 / m, ms: hop, ease: 'hop' })));
      timers.after(at + hop * 0.7, () => setFlight((f) => f && { ...f, hop: i }));
    }
    timers.after(spin + pause + res.hops * hop + settle, () => {
      setFlight((f) => f && { ...f, hop: res.hops, arrived: true, done: true });
      if (!res.safe) return finish(r, 'bust', 0);
      const next: Round = { ...r, table: res.table, placed: r.placed + 1, newest: res.slot, cash };
      if (next.placed >= r.target) return finish(next, 'full', cash);
      setRound(next);
      const nextRed = redCount(next.table, P);
      // A ball with no red slot can't bust: it is placed automatically.
      if (nextRed === 0) return timers.after(timing.current.free.gap, () => dropBall(next));
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: cash, winChance: 1 - nextRed / m });
    });
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    resolved.current = RTP;
    timers.clearAll();
    const r: Round = {
      target: balls,
      stake: bet.value,
      table: emptyTable(m),
      placed: 0,
      newest: null,
      cash: RTP,
      outcome: null,
    };
    setRound(r);
    dropBall(r);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', round.cash);
  }

  function next() {
    if (phase === 'checkpoint' && round) dropBall(round);
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    setRound(null);
    setFlight(null);
    setPhase('idle');
  }

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    apply();
    if (phase === 'over') clear();
  };

  useHotkeys(
    {
      space: () => (phase === 'checkpoint' ? next() : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const K = round?.target ?? balls;
  const table = round?.table ?? emptyTable(m);
  const red = useMemo(() => redSlots(table, P), [table]);
  const redN = red.filter(Boolean).length;
  const q = redN / m;
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const placed = round?.placed ?? 0;

  // The panel's settings (always the chosen ones, even mid-round).
  const pickWin = winChance(balls);
  const vol = volatilityOf(balls);
  const winK = winChance(K);

  let status = `Ready · ${K} balls into ${m} slots`;
  if (phase === 'probing') status = q === 0 ? `Ball ${placed + 1}/${K} · can’t bust · placed for you` : `Dropping ball ${placed + 1} of ${K}`;
  if (phase === 'checkpoint') status = `Your call · ${placed} of ${K} placed`;
  if (phase === 'over' && round?.outcome) status = `${OUTCOME_TITLE[round.outcome]} · ${placed} of ${K} placed`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';
  const started = !!round;

  return (
    <GameLayout
      name="Probe"
      accent={ACCENT}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={vol} />}>Balls to place</Label>
          <Chips
            label="Balls to place"
            options={BALLS.map((v) => ({ value: v, label: v, title: `Place ${v} balls into ${m} slots` }))}
            value={balls}
            disabled={live}
            onChange={(v) => change(() => setBalls(v))}
          />

          <dl className="og-stats">
            <dt>Chance to win</dt>
            <dd>{fmtChance(pickWin)}</dd>
            <dt>Average prize</dt>
            <dd>{fmtMult(RTP / pickWin)}</dd>
            <dt>Max prize</dt>
            <dd>{fmtMult(maxMultiplier(m, balls, P))}</dd>
          </dl>

          {phase === 'checkpoint' ? (
            <>
              <ActionButton kind="cash" onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" onClick={next}>
                Drop ball · {fmtChance(1 - q)} safe
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
              {phase === 'probing' ? 'Dropping…' : phase === 'over' ? 'Bet again' : 'Bet'}
            </ActionButton>
          )}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />

      <Readouts
        items={
          started
            ? [
                {
                  label: 'Next ball safe',
                  value: live ? fmtChance(1 - q) : '—',
                  sub: live ? (redN === 0 ? 'no red slots' : `${m - redN} of ${m} slots safe`) : `${placed} of ${K} placed`,
                  tone: 'chance',
                },
                { label: 'Cash out now', value: fmtMult(cash), sub: formatAmount(stake * cash, 2), tone: 'cash' },
                {
                  label: 'If it lands safe',
                  value: live ? fmtMult(cash / (1 - q)) : '—',
                  sub: live ? `ball ${placed + 1} of ${K}` : 'round over',
                  tone: 'prize',
                },
              ]
            : [
                { label: 'Chance to win', value: fmtChance(winK), sub: `place all ${K} balls`, tone: 'chance' },
                { label: 'Cash out now', value: '—', sub: `bet ${formatAmount(stake, 2)}`, tone: 'cash' },
                { label: 'Average prize', value: fmtMult(RTP / winK), sub: 'if you place all', tone: 'prize' },
              ]
        }
      />

      <Board className={'probe-board' + (narrow ? ' narrow' : '')}>
        <Ring
          svgRef={svgRef}
          m={m}
          limit={P}
          target={K}
          table={table}
          red={red}
          placed={placed}
          newest={round?.newest ?? null}
          flight={flight}
          token={token}
          started={started}
          live={live}
          redCount={redN}
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
            placement={narrow ? 'inline' : 'center'}
          />
        )}
      </Board>

      {live ? (
        <ChanceBar
          p={1 - q}
          label="Next ball lands safe"
          note={
            redN === 0
              ? 'No red slots, so this ball can’t bust: it is placed for you.'
              : `A ball landing on a red slot busts. Each slot is 1/${m} of the ring.`
          }
        />
      ) : (
        <Caption>
          Each ball lands on a random slot and slides clockwise to the next empty one. If it would slide more than {slides}, you bust: red slots
          are where that happens. Balls that can’t bust are placed for you. Place all {K} to win, or cash out between balls.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Probe" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              Place every ball on the ring. Each ball may slide at most {slides} from where it lands. Place them all and the round pays out; one ball that
              can’t find an empty slot in time busts it.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick how many balls to place, then bet. More balls means a lower chance to win and a bigger prize.</li>
              <li>
                Each ball lands on a random slot. If that slot is full it slides clockwise to the next empty one. If that would take more than {slides}, the
                round is lost.
              </li>
              <li>While no slot is red, no ball can bust, so balls are placed for you automatically.</li>
              <li>Once a slot is red, the round waits for you before each ball: cash out (C), or drop the next ball (Space).</li>
              <li>Place every ball and the round pays out automatically.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              Every slot is an equal share of the ring, and a ball is equally likely to land on any of them. A slot is{' '}
              <b style={{ color: 'var(--red)' }}>red</b> when a ball landing there would bust: with a max slide of {slides}, that is a full slot whose
              clockwise neighbour is also full. The red share of the ring is exactly the chance that the next ball loses the round.
            </p>
            <p>
              Runs of full slots only grow. When a ball fills the single gap between two runs they join into one long run and the red count jumps. The
              inner ring counts the balls placed out of the balls to place.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              This is linear probing in a hash table, counted with parking functions (Knuth; Konheim and Weiss). Let f<sub>P</sub>(c) count the landing
              sequences that fill a block of c slots with every slide ≤ P. Splitting on the slot the last ball fills, f<sub>P</sub>(c) = Σ<sub>j</sub>{' '}
              C(c−1, j) f<sub>P</sub>(j) f<sub>P</sub>(c−1−j) (min(j, P) + 1); with no limit this is (c+1)<sup>c−1</sup>, the parking functions. Cutting the
              ring at its m − K empty slots gives the exact chance that K balls all fit:
            </p>
            <p>
              P(win) = m/(m−K) · K! [x<sup>K</sup>] F<sub>P</sub>(x)<sup>m−K</sup> / m<sup>K</sup>, where F<sub>P</sub>(x) = Σ f<sub>P</sub>(c) x
              <sup>c</sup>/c!. Here m = {m} and P = {P}.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Dropping a ball while r of the {m} slots are red multiplies your cash-out by {m}/({m}−r). Each ball is therefore a fair bet. Balls that can’t
              bust change nothing, so the cash-out stays at {RTP.toFixed(2)}× until the first red slot. The round is worth {(RTP * 100).toFixed(0)}% of your
              stake however and whenever you cash out, and the average prize for placing every ball is {(RTP * 100).toFixed(0)}% ÷ the chance to win. The
              red count can never exceed the balls placed minus the max slide, which caps the prize at the "Max prize" shown in the panel.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
