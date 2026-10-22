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
import { useEffect, useRef, useState } from 'react';
import Field, { type Outcome, type Phase } from './Board';
import {
  BUDGETS,
  MAX_MULTIPLIER,
  RTP,
  SEGMENTS,
  advance,
  averageDraws,
  budgetNear,
  clampBudget,
  darkCount,
  headline,
  huntChance,
  litOf,
  prizeFor,
  volatilityOf,
  winChance,
  type Draw,
  type Pace,
  type Segments,
} from './math';

const ACCENT = '#9bf6ff';

interface Round {
  id: number;
  k: Segments;
  D: number;
  stake: number;
  /** Locked at bet time: RTP / P(win). */
  prize: number;
  /** Every draw so far, including a move still animating. */
  draws: Draw[];
  /** The resolved cash-out after the latest move (prize × P, or the settled value). */
  cash: number;
  outcome: Outcome | null;
  pace: Pace;
}

const plural = (x: number, w: string) => `${x} ${w}${x === 1 ? '' : 's'}`;

const OUTCOME_TITLE: Record<Outcome, string> = { full: 'Full set', cashed: 'Cashed out', short: 'Out of reach' };
/** A loss with draws still left means a repeat with no spare: the set went out of reach. */
const titleOf = (r: Round, outcome: Outcome) => (outcome === 'short' && r.draws.length === r.D ? 'Out of draws' : OUTCOME_TITLE[outcome]);

/** Narrow boards get the result card inline, below the board, so it never covers it. */
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

/** Forward to turn position pos, at least `minTurns` full turns first. */
function nextSpin(current: number, pos: number, minTurns: number) {
  const base = Math.floor(current);
  let target = base + pos;
  if (target <= current + 0.04) target += 1;
  return target + minTurns;
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();
  const [narrow, svgRef] = useNarrow(460);

  const [segments, setSegments] = useState<Segments>(6);
  const [budget, setBudget] = useState(10);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [shown, setShown] = useState(0);
  const [spin, setSpin] = useState(0);
  const [travelMs, setTravelMs] = useState(500);
  const [infoOpen, setInfoOpen] = useState(false);
  const seq = useRef(0);
  const busy = useRef(false);

  // A move is decided the moment it starts, so leaving mid-animation settles
  // at its real result, never at the pre-move value.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'drawing' ? resolved.current : round?.cash ?? 0));

  const speed = turbo.turbo ? 0.25 : 1;
  const live = phase === 'drawing' || phase === 'checkpoint';

  function finish(r: Round, outcome: Outcome, cash: number) {
    busy.current = false;
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setShown(r.draws.length);
    setPhase('over');
  }

  /** One draw, or hunt until a new segment lights; then checkpoint or end the round. */
  function move(r: Round, pace: Pace) {
    // One move at a time, even if two clicks land before the buttons disable.
    if (busy.current) return;
    busy.current = true;
    const seen = r.draws.length;
    const drawn = advance(r.k, litOf(r.k, r.draws), r.D - seen, pace, rng);
    const draws = [...r.draws, ...drawn];
    const m = darkCount(litOf(r.k, draws));
    const left = r.D - draws.length;
    const cash = m === 0 ? r.prize : left < m ? 0 : r.prize * winChance(r.k, m, left);
    resolved.current = cash;
    const next: Round = { ...r, draws, cash, pace };

    // One draw spins a full turn; a hunt hops quickly from landing to landing.
    const n = drawn.length;
    const per = Math.round((n === 1 ? 640 : Math.min(420, Math.max(150, 1500 / n))) * speed);
    const travel = Math.round(per * (n === 1 ? 0.9 : 0.8));
    const hold = Math.round((n === 1 ? 140 : 260) * speed);
    setTravelMs(travel);
    setRound(next);
    setPhase('drawing');
    setShown(seen);
    drawn.forEach((dr, i) => {
      timers.after(per * i, () => setSpin((s) => nextSpin(s, dr.pos, n === 1 ? 1 : 0)));
      timers.after(per * i + travel, () => setShown(seen + i + 1));
    });

    timers.after(per * (n - 1) + travel + hold, () => {
      if (m === 0) return finish(next, 'full', r.prize);
      if (left < m) return finish(next, 'short', 0);
      busy.current = false;
      setShown(draws.length);
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: cash, winChance: cash / r.prize });
    });
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const r: Round = {
      id: ++seq.current,
      k: segments,
      D: budget,
      stake: bet.value,
      prize: prizeFor(segments, budget),
      draws: [],
      cash: RTP,
      outcome: null,
      pace: 'draw',
    };
    move(r, 'draw');
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
    setShown(0);
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
      space: () => (phase === 'checkpoint' && round ? move(round, 'hunt') : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const k = round?.k ?? segments;
  const D = round?.D ?? budget;
  const draws = round ? round.draws.slice(0, phase === 'drawing' ? shown : round.draws.length) : [];
  const m = darkCount(litOf(k, draws));
  const d = D - draws.length;
  const prize = round?.prize ?? prizeFor(segments, budget);
  const stake = round?.stake ?? bet.value;
  const pNow = round?.outcome === 'full' ? 1 : round?.outcome === 'short' ? 0 : winChance(k, m, d);
  const cash = phase === 'over' && round ? round.cash : round ? prize * pNow : RTP;
  const p0 = headline(segments, budget);
  const hunt = huntChance(k, m, d);
  const spares = d - m;
  const range = BUDGETS[segments];

  let status = `Ready · ${k} segments, ${D} draws`;
  if (phase === 'drawing') status = round?.pace === 'hunt' ? `Hunting · draw ${draws.length} of ${D}` : `Draw ${Math.max(1, draws.length)} of ${D}`;
  if (phase === 'checkpoint') status = `Checkpoint · ${k - m} of ${k} lit`;
  if (phase === 'over' && round?.outcome) status = `${titleOf(round, round.outcome)} · ${k - m} of ${k} lit`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  let chanceSub = `${k} segments in ${D} draws`;
  if (live) chanceSub = `${m} dark · ${plural(d, 'draw')} left`;
  if (phase === 'over') chanceSub = round?.outcome === 'cashed' ? 'when you cashed out' : `${k - m} of ${k} lit in ${draws.length} draws`;

  return (
    <GameLayout
      name="Full Set"
      accent={ACCENT}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint="more segments, longer rounds">Segments</Label>
          <Chips
            label="Segments"
            options={SEGMENTS.map((v) => ({ value: v, label: v }))}
            value={segments}
            disabled={live}
            onChange={(v) =>
              change(() => {
                setSegments(v);
                setBudget((b) => budgetNear(v, headline(segments, clampBudget(segments, b))));
              })
            }
          />

          <Label hint={<VolBadge level={volatilityOf(segments, budget)} />}>
            Draw budget: <b style={{ color: 'var(--text)' }}>{budget} draws</b>
          </Label>
          <Slider
            label="Draw budget"
            min={range.min}
            max={range.max}
            value={budget}
            disabled={live}
            risk
            onChange={(v) => change(() => setBudget(clampBudget(segments, v)))}
          />
          <Label hint="fewer draws, bigger prize">
            <span style={{ fontWeight: 500 }}>
              {segments} to light + {budget - segments} spare
            </span>
          </Label>

          <dl className="og-stats">
            <dt>Chance to win</dt>
            <dd>{fmtChance(p0)}</dd>
            <dt>Prize</dt>
            <dd>{fmtMult(prizeFor(segments, budget))}</dd>
            <dt>Average draws to fill</dt>
            <dd>{averageDraws(segments).toFixed(1)}</dd>
          </dl>

          {live && round ? (
            <>
              <ActionButton kind="cash" disabled={phase !== 'checkpoint'} onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton
                kind="secondary"
                disabled={phase !== 'checkpoint'}
                title={`Draws until a new segment lights: ${spares + 1} tries at ${m}/${k} each`}
                onClick={() => move(round, 'hunt')}
              >
                {m === 1 ? 'Hunt the last one' : 'Hunt next segment'} · {fmtChance(hunt)}
              </ActionButton>
              <ActionButton kind="secondary" disabled={phase !== 'checkpoint'} onClick={() => move(round, 'draw')}>
                Draw once · {fmtChance(m / k)} new
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
            sub: live || phase === 'over' ? formatAmount(stake * cash, 2) : 'at every checkpoint',
            tone: 'cash',
          },
          { label: 'Prize · full set', value: fmtMult(prize), sub: formatAmount(stake * prize, 2), tone: 'prize' },
        ]}
      />

      <Board className={'fset-board' + (narrow ? ' narrow' : '') + (phase === 'over' ? ' over' : '')}>
        <Field
          svgRef={svgRef}
          narrow={narrow}
          k={k}
          D={D}
          draws={draws}
          phase={phase}
          outcome={round?.outcome ?? null}
          spin={spin}
          travelMs={travelMs}
          roundId={round?.id ?? 0}
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
          label="Chance to light every segment"
          note={`The green share of the strip under the ring. Each draw is new with chance ${m}/${k}: the dark share of the ring.`}
        />
      ) : (
        <Caption>
          Each draw lights a random segment, repeats included. All {k} within {D} draws happens {fmtChance(headline(k, D))} of the time (coupon
          collector: k!·S(D, k)/k<sup>D</sup>); a full ring takes {averageDraws(k).toFixed(1)} draws on average. RTP {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Full Set" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              A ring is cut into equal segments. Every draw lands on a random point of the ring and lights the segment under it, even if it is already lit.
              Light <b style={{ color: ACCENT }}>every segment</b> before your draws run out.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick the number of segments and your draw budget, then bet. The first draw always lights a segment.</li>
              <li>
                At every checkpoint you can cash out (C), <b>hunt</b> the next segment (Space: draw until a new one lights), or <b>draw once</b>. Hunting is
                fast, single draws are slow; both are worth the same.
              </li>
              <li>
                Light the whole ring and the prize pays out at once. A draw that hits a lit segment uses a spare; if one lands on a lit segment with no
                spare left, the set can no longer be finished and the round is lost.
              </li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              <b>The ring.</b> Every point of the ring is equally likely, so the next draw lights a new segment with chance{' '}
              <b>dark segments ÷ all segments</b>: the dark share of the ring, shown in the middle. When you have no spare draws, the lit segments turn
              red: they are exactly where the next draw ends the round.
            </p>
            <p>
              <b>The inner ring</b> is your budget, one cell per draw. Used cells are cyan (new segment) or grey (repeat). The rest are split into one cell
              per dark segment, then your <b>spares</b>. A repeat eats a spare.
            </p>
            <p>
              <b>The strip</b> splits every way the round can end: the full set, or stopped 1, 2, 3+ segments short. The{' '}
              <b style={{ color: 'var(--green)' }}>green share</b> is your exact win chance, and the hunt button shows the chance that a hunt finds a new
              segment before the spares run out: 1 − (lit share)<sup>spares + 1</sup>.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              The coupon collector problem. D random draws light all k segments with chance k!·S(D, k)/k<sup>D</sup>, where S is a Stirling number of the
              second kind (the ways to split D draws into k non-empty groups). By inclusion–exclusion over the segments that are never hit, with m dark
              segments and d draws left the chance is
            </p>
            <p style={{ textAlign: 'center' }}>
              <b>
                P = Σ<sub>j</sub> (−1)<sup>j</sup> C(m, j) (1 − j/k)<sup>d</sup>
              </b>
            </p>
            <p>A full ring of k segments takes k·(1 + ½ + … + 1/k) draws on average: {averageDraws(k).toFixed(1)} for {k}.</p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              The prize is locked when you bet at {(RTP * 100).toFixed(0)}% ÷ (chance for your settings). Cashing out pays prize × your win chance now,
              computed exactly. That chance is a martingale whether you draw once or hunt, so every move is a fair bet and, by optional stopping, the round
              is worth {(RTP * 100).toFixed(0)}% of your stake whatever you do. The largest prize on offer is {fmtMult(MAX_MULTIPLIER)}.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
