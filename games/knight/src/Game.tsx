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
import Field, { type BoardOutcome, type Move } from './Board';
import {
  CORNERS,
  MOVES,
  REGIONS,
  REGION_LABEL,
  RTP,
  START,
  TURNS,
  cashAt,
  chance,
  cornerOf,
  endDistribution,
  inTarget,
  nearestReachable,
  prizeFor,
  rankOf,
  reachable,
  squareIndex,
  squareName,
  startChance,
  verdict,
  volatilityOf,
  type Corner,
  type Region,
  type Target,
  type Turns,
} from './math';

type Phase = 'idle' | 'moving' | 'checkpoint' | 'over';

interface Round {
  turns: Turns;
  target: Target;
  stake: number;
  prize: number;
  path: number[];
  cash: number;
  outcome: BoardOutcome | null;
}

const OUTCOME_TITLE: Record<BoardOutcome, string> = {
  win: 'Landed in the target',
  sure: 'Locked in',
  miss: 'Missed the target',
  reach: 'Out of reach',
  cashed: 'Cashed out',
};

const ACCENT = '#d4a373';
const SQUARES = Array.from({ length: 64 }, (_, i) => i);

const CORNER_LABEL: Record<Corner, string> = { a8: '↖ a8', h8: 'h8 ↗', a1: '↙ a1', h1: 'h1 ↘' };

export function targetName(t: Target): string {
  if (t.region === 'rim') return 'the rim';
  if (t.region === 'centre') return 'the centre 4×4';
  if (t.region === 'corner') return `the ${t.corner} quadrant`;
  return squareName(t.square);
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [turns, setTurns] = useState<Turns>(5);
  const [region, setRegion] = useState<Region>('centre');
  const [corner, setCorner] = useState<Corner>('a8');
  const [square, setSquare] = useState(squareIndex('e6'));
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [move, setMove] = useState<Move | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const moveSeq = useRef(0);

  // A chosen square of the wrong colour (or out of range) for this many moves
  // can never be hit: fall back to the nearest square that can.
  const chosen: Target = useMemo(
    () => ({ region, corner, square: reachable(turns, square) ? square : nearestReachable(turns, square) }),
    [region, corner, square, turns],
  );

  // The move in flight is decided when it starts, so leaving mid-jump settles
  // at its real result, never at the pre-move value.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'moving' ? resolved.current : round?.cash ?? 0));

  const moveMs = turbo.turbo ? 200 : 750;
  const live = phase === 'moving' || phase === 'checkpoint';

  function finish(r: Round, outcome: BoardOutcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setMove(null);
    setPhase('over');
  }

  function jump(r: Round) {
    const from = r.path[r.path.length - 1];
    const options = MOVES[from];
    const to = options[rng.int(options.length)];
    const left = r.turns - r.path.length; // moves left after this one
    const end = verdict(to, left, r.target);
    const cash = end === 'win' ? r.prize : end === 'lost' ? 0 : cashAt(r.prize, to, left, r.target);
    resolved.current = cash;
    setPhase('moving');
    setMove({ id: ++moveSeq.current, from, to });
    timers.after(moveMs, () => {
      const next = { ...r, path: [...r.path, to], cash };
      if (end === 'win') return finish(next, left === 0 ? 'win' : 'sure', cash);
      if (end === 'lost') return finish(next, left === 0 ? 'miss' : 'reach', 0);
      setRound(next);
      setMove(null);
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: cash, winChance: chance(to, left, r.target) });
    });
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const r: Round = { turns, target: chosen, stake: bet.value, prize: prizeFor(turns, chosen), path: [START], cash: RTP, outcome: null };
    setRound(r);
    jump(r);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', round.cash);
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    setRound(null);
    setMove(null);
    setPhase('idle');
  }

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    apply();
    if (phase === 'over') clear();
  };

  useHotkeys(
    {
      space: () => (phase === 'checkpoint' && round ? jump(round) : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const T = round?.turns ?? turns;
  const target = round?.target ?? chosen;
  const path = round?.path ?? [START];
  const taken = path.length - 1;
  const left = T - taken;
  const at = path[path.length - 1];
  const prize = round?.prize ?? prizeFor(T, target);
  const p0 = startChance(T, target);
  const pNow = chance(at, left, target);
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const pSel = startChance(turns, chosen);
  const vol = volatilityOf(pSel);

  const showOdds = phase === 'idle' || phase === 'checkpoint';
  const dist = useMemo(() => (showOdds ? endDistribution(at, left) : null), [showOdds, at, left]);
  const next = useMemo(
    () => (showOdds && left > 0 ? new Map(MOVES[at].map((y) => [y, chance(y, left - 1, target)] as const)) : null),
    [showOdds, at, left, target],
  );

  const pickable = (s: number) => (region === 'square' ? reachable(turns, s) : region === 'corner');
  const onPick = live
    ? null
    : (s: number) => change(() => (region === 'square' ? setSquare(s) : setCorner(cornerOf(s))));

  let status = `Ready · ${T} moves · target ${targetName(target)}`;
  if (phase === 'moving') status = `Move ${taken + 1} of ${T}`;
  if (phase === 'checkpoint') status = `Checkpoint · ${left} move${left === 1 ? '' : 's'} left`;
  if (phase === 'over' && round?.outcome) status = `${OUTCOME_TITLE[round.outcome]} · ${taken} of ${T} moves`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  // Put the result card over the half of the board without the knight, and
  // where possible without the target either.
  const covered = (pl: 'top' | 'bottom', s: number) => (pl === 'top' ? rankOf(s) >= 5 : rankOf(s) <= 2);
  const targetSquares = target.region === 'square' || target.region === 'corner' ? SQUARES.filter((s) => inTarget(s, target)) : [];
  const cardScore = (pl: 'top' | 'bottom') => (covered(pl, at) ? 100 : 0) + targetSquares.filter((s) => covered(pl, s)).length;
  const placement = cardScore('top') <= cardScore('bottom') ? 'top' : 'bottom';

  const regionHint =
    region === 'square' ? `${squareName(chosen.square)} · tap the board` : region === 'corner' ? `${chosen.corner} quadrant · tap the board` : null;

  return (
    <GameLayout
      name="Knight"
      accent={ACCENT}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={vol} />}>Moves</Label>
          <Chips
            label="Number of moves"
            options={TURNS.map((v) => ({ value: v, label: v }))}
            value={turns}
            disabled={live}
            onChange={(v) => change(() => setTurns(v))}
          />

          <Label hint={regionHint}>Target</Label>
          <Chips
            label="Target region"
            options={REGIONS.map((v) => ({ value: v, label: REGION_LABEL[v] }))}
            value={region}
            disabled={live}
            onChange={(v) => change(() => setRegion(v))}
          />
          {region === 'corner' && (
            <Chips
              label="Corner quadrant"
              options={CORNERS.map((v) => ({ value: v, label: CORNER_LABEL[v] }))}
              value={corner}
              disabled={live}
              onChange={(v) => change(() => setCorner(v))}
            />
          )}

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
              <ActionButton kind="secondary" onClick={() => round && jump(round)}>
                {left === 1 ? 'Last move' : `Move ${taken + 1} of ${T}`} · {fmtChance(pNow)} to win
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
              {phase === 'moving' ? 'Jumping…' : phase === 'over' ? 'Bet again' : 'Bet'}
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
            label: 'Chance to win',
            value: phase === 'over' ? (round?.outcome === 'cashed' ? '—' : (round?.cash ?? 0) > 0 ? '100%' : '0%') : fmtChance(live ? pNow : p0),
            sub: live ? `${left} move${left === 1 ? '' : 's'} left` : `${T} moves from g1`,
            tone: 'chance',
          },
          {
            label: 'Cash out now',
            value: live || phase === 'over' ? fmtMult(cash) : '—',
            sub: live || phase === 'over' ? formatAmount(stake * cash, 2) : 'after the first move',
            tone: 'cash',
          },
          { label: 'Prize', value: fmtMult(prize), sub: `if it ends on ${targetName(target)}`, tone: 'prize' },
        ]}
      />

      <Board className="knight-board">
        <Field
          target={target}
          path={path}
          move={move}
          moveMs={moveMs}
          dist={dist}
          next={next}
          outcome={phase === 'over' ? round?.outcome ?? null : null}
          onPick={onPick}
          pickable={pickable}
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
            placement={placement}
          />
        )}
      </Board>

      {live ? (
        <ChanceBar
          p={pNow}
          label={`Chance to end on ${targetName(target)}`}
          note="Dot area = chance the knight ends on that square; the green dots add up to your chance. The boxed squares are the next jumps, each with your chance if it lands there: your chance now is their average."
        />
      ) : (
        <Caption>
          From g1, {T} random moves end on {targetName(target)} {fmtChance(p0)} of the time (exact matrix power). Each square's number is its count of
          moves: in the long run the knight is found on a square in proportion to it. RTP {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Knight" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              A knight starts on g1 and makes a fixed number of moves, each one chosen completely at random among its legal moves. If its final square is in
              your target, you win the prize.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick the number of moves and a target: the rim, the centre 4×4, one corner quadrant, or a single square (tap the board to choose).</li>
              <li>The first move is made for you. After every move you can cash out, or make the next move (Space).</li>
              <li>If the target can no longer be reached, the round is lost at once; if every way of finishing hits it, it pays at once.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              Each square's small number is its <b>degree</b>, the number of legal knight moves from it (2 in a corner, 8 in the middle). The dots show where
              the knight can still end: a dot's area is the chance of finishing on that square. <b style={{ color: 'var(--green)' }}>Green</b> dots lie in
              your target, so together they are exactly your chance to win.
            </p>
            <p>
              The boxed squares are where the next move can land, each labelled with your chance if it lands there. Every one is equally likely, so your
              chance now is the plain average of those numbers.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              The knight performs a random walk on the knight's graph. With t moves left from square x, the chance h<sub>t</sub>(x) of ending in the target
              is the average of h<sub>t−1</sub> over x's neighbours, so the game computes it exactly by repeated averaging (a power of the transition matrix).
            </p>
            <p>
              For a random walk on any graph the long-run share of time on a vertex is <b>deg(x) / Σ deg</b>; on the 8×8 board Σ deg = 336. Knight moves
              always change square colour, so after T moves the knight is on one colour only and P(x) ≈ 2·deg(x)/336 there. The rim holds degrees 96 of 336
              and the centre 128 of 336, which is why the long-run chances settle near 29% and 38%.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              The prize is {(RTP * 100).toFixed(0)}% ÷ (chance at the start), and cashing out pays prize × (chance now). Each move averages your chance over
              the possible landing squares, so the cash-out is a fair bet at every move (a martingale): any way of deciding when to stop returns exactly{' '}
              {(RTP * 100).toFixed(0)}% of your stake. Choosing a different target only changes the prize, never that value.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
