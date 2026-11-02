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
  MAX_MULTIPLIER,
  N,
  RTP,
  ROW_CENTRE,
  START,
  WIDTHS,
  cardsLeft,
  gateCentre,
  headline,
  placeGate,
  positions,
  prizeFor,
  rowOf,
  runToGate,
  sealed,
  step,
  tally,
  volatilityOf,
  type Gate,
  type Pos,
} from './math';

const ACCENT = '#b8f2e6';

interface Round {
  id: number;
  gate: Gate;
  stake: number;
  /** Locked at the bet: RTP / P(win). */
  prize: number;
  /** Every tile the ball has reached after the start, including a move still animating. */
  path: Pos[];
  /** The resolved cash-out after the latest card. */
  cash: number;
  outcome: Outcome | null;
  running: boolean;
}

const TITLE: Record<Outcome, string> = {
  through: 'Through the gate',
  locked: 'Gate locked in',
  missed: 'Missed the gate',
  unreachable: 'Gate out of reach',
  cashed: 'Cashed out',
};

/** What the line under the bar says once the round is over. */
const OVER_LINE: Record<Outcome, string> = {
  through: 'The ball landed in your gate',
  locked: "The last cards can't miss your gate",
  missed: 'The ball landed outside your gate',
  unreachable: "The last cards can't reach your gate",
  cashed: 'Cashed out',
};

const RULE = `Six ↙ cards and six ↘ cards are shuffled. The ball follows the first ${N} dealt; land it in the green gate to win.`;

function offsetText(g: Gate) {
  const d = gateCentre(g) - ROW_CENTRE;
  if (Math.abs(d) < 1e-9) return 'centre';
  const k = Math.abs(d);
  return `${k % 1 ? k.toFixed(1) : k} ${d < 0 ? 'left' : 'right'} of centre`;
}

/** Narrow boards get the result card inline, below the board, so it never covers the bar. */
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
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();
  const [narrow, svgRef] = useNarrow(470);

  const [gate, setGate] = useState<Gate>(() => placeGate(1, ROW_CENTRE));
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [shown, setShown] = useState(0);
  const [stepMs, setStepMs] = useState(420);
  const [infoOpen, setInfoOpen] = useState(false);
  const seq = useRef(0);

  // A card is decided the moment it is dealt, so leaving mid-animation settles
  // at its real result, never at the pre-deal value.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'stepping' ? resolved.current : round?.cash ?? 0));

  const speed = turbo.turbo ? 0.25 : 1;
  const live = phase === 'stepping' || phase === 'checkpoint';

  function finish(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash, running: false });
    setShown(r.path.length);
    setPhase('over');
  }

  /** Deal one card, or deal until the round is sealed; then pause or end. */
  function move(r: Round, run: boolean) {
    const seen = r.path.length;
    const from = r.path[seen - 1] ?? START;
    const drawn = run ? runToGate(from, r.gate, rng) : [step(from, rng)];
    const path = [...r.path, ...drawn];
    const end = path[path.length - 1];
    const fate = sealed(end, r.gate);
    const t = tally(end, r.gate);
    const cash = fate === 'win' ? r.prize : fate === 'lose' ? 0 : (r.prize * t.through) / t.total;
    resolved.current = cash;
    const next: Round = { ...r, path, cash, running: run };

    const per = Math.round((run ? 300 : 460) * speed);
    const hold = Math.round((run ? 240 : 80) * speed);
    // A new round snaps the ball back to the top before it moves.
    const lead = seen === 0 ? 40 : 0;
    setStepMs(seen === 0 ? 0 : per);
    setRound(next);
    setPhase('stepping');
    setShown(seen);
    drawn.forEach((_, i) =>
      timers.after(lead + per * i, () => {
        setStepMs(per);
        setShown(seen + i + 1);
      }),
    );

    timers.after(lead + per * drawn.length + hold, () => {
      if (fate) {
        const onRow = rowOf(end) === N;
        return finish(next, fate === 'win' ? (onRow ? 'through' : 'locked') : onRow ? 'missed' : 'unreachable', cash);
      }
      setShown(path.length);
      setRound({ ...next, running: false });
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: cash, winChance: t.through / t.total });
    });
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const r: Round = {
      id: ++seq.current,
      gate,
      stake: bet.value,
      prize: prizeFor(gate),
      path: [],
      cash: RTP,
      outcome: null,
      running: false,
    };
    move(r, false);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', round.cash);
  }

  function clear() {
    if (live) return;
    timers.clearAll();
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

  const setGateWidth = (width: number) => change(() => setGate((g) => placeGate(width, gateCentre(g))));
  const setGateLo = (lo: number) => change(() => setGate((g) => ({ ...g, lo })));
  const pickTile = (a: number) => change(() => setGate((g) => placeGate(g.width, a)));

  useHotkeys(
    {
      space: () => (phase === 'checkpoint' && round ? move(round, false) : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const g = round?.gate ?? gate;
  const trail = round ? round.path.slice(0, phase === 'stepping' ? shown : round.path.length) : [];
  const walker = trail[trail.length - 1] ?? START;
  const prize = round?.prize ?? prizeFor(gate);
  const stake = round?.stake ?? bet.value;
  const now = tally(walker, g);
  const pNow = now.through / now.total;
  const cash = phase === 'over' && round ? round.cash : round ? prize * pNow : RTP;
  const dealt = rowOf(walker);
  const p0 = headline(gate);
  const lows = positions(gate.width);
  const deck = cardsLeft(walker);

  let status = `Ready · ${N} cards to the bottom row`;
  if (phase === 'stepping') status = round?.running ? `Dealing to the gate · card ${dealt}` : `Dealing card ${dealt} of ${N}`;
  if (phase === 'checkpoint') status = `Your call · ${dealt} of ${N} cards dealt`;
  if (phase === 'over' && round?.outcome) status = `${TITLE[round.outcome]} · ${dealt} of ${N} cards`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  let prompt = 'Tap a bottom tile to move the gate';
  if (phase === 'stepping') prompt = round?.running ? 'Dealing to the gate…' : 'Dealing…';
  if (phase === 'checkpoint') prompt = 'Deal the next card, or cash out';
  if (phase === 'over' && round?.outcome) prompt = OVER_LINE[round.outcome];

  return (
    <GameLayout
      name="Pascal"
      accent={ACCENT}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={volatilityOf(p0)} />}>Gate width</Label>
          <Chips
            label="Gate width"
            options={WIDTHS.map((v) => ({ value: v, label: `${v} tile${v > 1 ? 's' : ''}` }))}
            value={gate.width}
            disabled={live}
            onChange={setGateWidth}
          />

          <Label hint={offsetText(gate)}>Gate position</Label>
          <Slider label="Gate position" min={lows[0]} max={lows[lows.length - 1]} value={gate.lo} disabled={live} onChange={setGateLo} />

          <dl className="og-stats">
            <dt>Chance to win</dt>
            <dd>{fmtChance(p0)}</dd>
            <dt>Prize</dt>
            <dd>{fmtMult(prizeFor(gate))}</dd>
          </dl>

          {live && round ? (
            <>
              <ActionButton kind="cash" disabled={phase !== 'checkpoint'} onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" className="pas-next" disabled={phase !== 'checkpoint'} onClick={() => move(round, false)}>
                Deal next card
                <small>
                  {deck.left} ↙ · {deck.right} ↘ left
                </small>
              </ActionButton>
              <ActionButton kind="secondary" disabled={phase !== 'checkpoint'} onClick={() => move(round, true)}>
                Run to the gate
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
          { label: 'Win chance', value: fmtChance(pNow), sub: 'ball lands in the gate', tone: 'chance' },
          {
            label: 'Cash out now',
            value: live || phase === 'over' ? fmtMult(cash) : '—',
            sub: live || phase === 'over' ? formatAmount(stake * cash, 2) : 'after every card',
            tone: 'cash',
          },
          { label: 'Prize', value: fmtMult(prize), sub: `pays ${formatAmount(stake * prize, 2)}`, tone: 'prize' },
        ]}
      />

      <Board className="pas-board">
        <Field
          svgRef={svgRef}
          gate={g}
          walker={walker}
          trail={trail}
          phase={phase}
          outcome={round?.outcome ?? null}
          stepMs={phase === 'stepping' ? stepMs : 0}
          prompt={prompt}
          onPick={live ? undefined : pickTile}
        />
        {phase === 'over' && round?.outcome && (
          <RoundOver
            key={history[0]?.id}
            title={TITLE[round.outcome]}
            multiplier={round.cash}
            stake={round.stake}
            nextBet={bet.value}
            blocked={bet.blocked}
            onBetAgain={() => void start()}
            onClear={clear}
            placement={narrow ? 'inline' : dealt >= N / 2 ? 'top' : 'bottom'}
          />
        )}
      </Board>

      {live ? <ChanceBar p={pNow} label="Chance to pass through the gate" note={RULE} /> : <Caption>{RULE} RTP {(RTP * 100).toFixed(0)}%.</Caption>}

      {infoOpen && (
        <InfoModal title="Pascal" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              A ball starts on the top tile of a triangle and drops one row per card. Land it in your <b style={{ color: 'var(--green)' }}>gate</b>: one
              to three tiles on the bottom row.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick the gate's width, and move it with the slider or by tapping a bottom tile. Then bet. The bet deals the first card.</li>
              <li>
                The deck holds six <b>↙</b> cards and six <b>↘</b> cards, shuffled. Each card dealt moves the ball one tile that way and leaves the pile
                in the corner. Six cards take the ball to the bottom row.
              </li>
              <li>
                After every card the round waits for you: <b>Cash out</b> (C), <b>Deal next card</b> (Space), or <b>Run to the gate</b> to deal the rest.
                It ends early once the result is certain.
              </li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              <b>The next card</b> is just the piles in the corners. With 3 ↙ cards and 5 ↘ cards left, the next card is ↘ with chance 5 in 8. Once
              you have seen a lot of ↙ cards, ↘ cards become more likely, which pulls the ball back towards the middle.
            </p>
            <p>
              <b>The bar</b> under the triangle is the bottom row again, each tile stretched to its chance of being where the ball lands. The{' '}
              <b style={{ color: 'var(--green)' }}>green share</b> is your gate: your exact chance to win. Tiles the ball can no longer reach are dimmed
              and drop out of the bar.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              The ball's bottom tile is the number of ↘ cards among the first six dealt from the deck: a hypergeometric draw. With R ↘ and L ↙ cards left
              and k cards still to deal,
            </p>
            <p style={{ textAlign: 'center' }}>
              <b>P(j more ↘) = C(R, j) · C(L, k − j) ÷ C(R + L, k)</b>
            </p>
            <p>
              From the start that is C(6, t)² ÷ 924 for bottom tile t: 1, 36, 225, 400, 225, 36 and 1 in 924, the squares of a row of Pascal's triangle
              (Vandermonde's identity).
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              The prize is locked when you bet at {(RTP * 100).toFixed(0)}% ÷ (your gate's chance). Cashing out pays prize × your chance now, an exact
              ratio of whole numbers. Your chance is a conditional probability of one fixed event, so averaged over the next card (weighted by the cards
              left) it stays exactly the same: every card is a fair bet and, by optional stopping, the round is worth {(RTP * 100).toFixed(0)}% of your
              stake whenever you cash out and wherever you put the gate. A gate must cover less than half the row and have at least a 1 in 2,000 chance,
              so the largest prize is {fmtMult(MAX_MULTIPLIER)} (a corner tile).
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
