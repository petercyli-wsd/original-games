import { useHost } from '@originals/game-sdk/react';
import {
  ACCENTS,
  ActionButton,
  BetField,
  Board,
  Caption,
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
  eventMs,
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
  HOPS,
  MOVES,
  REGIONS,
  REGION_LABEL,
  RTP,
  START,
  cashAt,
  chance,
  cornerOf,
  drawHops,
  endDistribution,
  inTarget,
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
} from './math';

type Phase = 'idle' | 'moving' | 'checkpoint' | 'over';

interface Round {
  target: Target;
  stake: number;
  prize: number;
  path: number[];
  cash: number;
  outcome: BoardOutcome | null;
}

const OUTCOME_TITLE: Record<BoardOutcome, string> = {
  win: 'Ended on green',
  sure: 'Locked in',
  miss: 'Missed the green',
  reach: 'Out of reach',
  cashed: 'Cashed out',
};

const ACCENT = ACCENTS.sand;
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

  const [region, setRegion] = useState<Region>('centre');
  const [corner, setCorner] = useState<Corner>('a8');
  const [square, setSquare] = useState(squareIndex('e6'));
  const [phase, setPhase] = useState<Phase>('idle');
  const [running, setRunning] = useState(false);
  const [round, setRound] = useState<Round | null>(null);
  const [move, setMove] = useState<Move | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const moveSeq = useRef(0);

  const chosen: Target = useMemo(() => ({ region, corner, square }), [region, corner, square]);

  // The hops in flight are all decided when the button is pressed, so leaving
  // mid-jump (or mid-run) settles at their real result, never at the pre-hop value.
  // `resolved` is the open ticket's value right now, set synchronously at every
  // transition (stake placed, hops drawn). The ticket reads only this ref: a
  // value derived from rendered state can be one render stale, e.g. the last
  // round's payout just after Bet again, if the game unmounts before the next
  // render.
  const resolved = useRef(0);
  const ticket = useTicket(() => resolved.current);

  const moveMs = eventMs(turbo.turbo);
  const gapMs = turbo.turbo ? 60 : 220;
  const live = phase === 'moving' || phase === 'checkpoint';

  function finish(r: Round, outcome: BoardOutcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setMove(null);
    setRunning(false);
    setPhase('over');
  }

  /** One hop, or (all = true) every hop until the result is certain. */
  function hop(r: Round, all: boolean) {
    const from = r.path[r.path.length - 1];
    const left = HOPS - (r.path.length - 1);
    const steps = drawHops(from, left, r.target, all, (n) => rng.int(n));
    const last = steps[steps.length - 1];
    const leftAfter = left - steps.length;
    const end = verdict(last, leftAfter, r.target);
    const cash = end === 'win' ? r.prize : end === 'lost' ? 0 : cashAt(r.prize, last, leftAfter, r.target);
    resolved.current = cash;
    setRunning(all);
    setPhase('moving');
    animate(r, steps, 0, () => {
      const done = { ...r, path: [...r.path, ...steps], cash };
      if (end === 'win') return finish(done, leftAfter === 0 ? 'win' : 'sure', cash);
      if (end === 'lost') return finish(done, leftAfter === 0 ? 'miss' : 'reach', 0);
      setRound(done);
      setMove(null);
      setRunning(false);
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: cash, winChance: chance(last, leftAfter, r.target) });
    });
  }

  function animate(r: Round, steps: number[], i: number, done: () => void) {
    const from = r.path[r.path.length - 1];
    const to = steps[i];
    setMove({ id: ++moveSeq.current, from, to });
    timers.after(moveMs, () => {
      if (i === steps.length - 1) return done();
      // Mid-run: commit the hop so the readouts follow the knight, then jump again.
      const left = HOPS - r.path.length;
      const next = { ...r, path: [...r.path, to], cash: cashAt(r.prize, to, left, r.target) };
      setRound(next);
      setMove(null);
      timers.after(gapMs, () => animate(next, steps, i + 1, done));
    });
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    resolved.current = RTP;
    timers.clearAll();
    const r: Round = { target: chosen, stake: bet.value, prize: prizeFor(chosen), path: [START], cash: RTP, outcome: null };
    setRound(r);
    hop(r, false);
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
      space: () => (phase === 'checkpoint' && round ? hop(round, false) : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const target = round?.target ?? chosen;
  const path = round?.path ?? [START];
  const taken = path.length - 1;
  const left = HOPS - taken;
  const at = path[path.length - 1];
  const prize = round?.prize ?? prizeFor(target);
  const p0 = startChance(target);
  const pNow = chance(at, left, target);
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const pSel = startChance(chosen);
  const vol = volatilityOf(pSel);

  // The end-chance dots follow the knight square by square (also during a run);
  // the next-hop squares only show while the round waits for a decision.
  const showOdds = phase === 'idle' || phase === 'checkpoint';
  const showDots = phase !== 'over';
  const dist = useMemo(() => (showDots ? endDistribution(at, left) : null), [showDots, at, left]);
  const next = useMemo(
    () => (showOdds && left > 0 ? new Map(MOVES[at].map((y) => [y, chance(y, left - 1, target)] as const)) : null),
    [showOdds, at, left, target],
  );

  // Single squares: only light ones, the only squares the knight can finish on.
  const pickable = (s: number) => (region === 'square' ? reachable(s) : region === 'corner');
  const onPick = live ? null : (s: number) => change(() => (region === 'square' ? setSquare(s) : setCorner(cornerOf(s))));

  let status = `${HOPS} random hops · finish on green`;
  if (phase === 'moving') status = `${running ? 'Running · ' : ''}Hop ${taken + 1} of ${HOPS}`;
  if (phase === 'checkpoint') status = `Cash out or hop on · ${left} left`;
  if (phase === 'over' && round?.outcome) status = `${OUTCOME_TITLE[round.outcome]} · ${taken} of ${HOPS} hops`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  // Put the result card over the half of the board without the knight, and
  // where possible without the target either.
  const covered = (pl: 'top' | 'bottom', s: number) => (pl === 'top' ? rankOf(s) >= 5 : rankOf(s) <= 2);
  const targetSquares = target.region === 'square' || target.region === 'corner' ? SQUARES.filter((s) => inTarget(s, target)) : [];
  const cardScore = (pl: 'top' | 'bottom') => (covered(pl, at) ? 100 : 0) + targetSquares.filter((s) => covered(pl, s)).length;
  const placement = cardScore('top') <= cardScore('bottom') ? 'top' : 'bottom';

  const rule = `${HOPS} random knight moves: win if the knight ends on green.`;

  return (
    <GameLayout
      name="Knight"
      accent={ACCENT}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={vol} />}>Target</Label>
          <Chips
            label="Target region"
            options={REGIONS.map((v) => ({ value: v, label: REGION_LABEL[v] }))}
            value={region}
            disabled={live}
            onChange={(v) => change(() => setRegion(v))}
          />
          {region === 'corner' && (
            <>
              <Label hint="or tap the board">Quadrant</Label>
              <Chips
                label="Corner quadrant"
                options={CORNERS.map((v) => ({ value: v, label: CORNER_LABEL[v] }))}
                value={corner}
                disabled={live}
                onChange={(v) => change(() => setCorner(v))}
              />
            </>
          )}
          {region === 'square' && <Label hint="tap a light square">Square {squareName(square)}</Label>}

          {live ? (
            <>
              <ActionButton kind="cash" disabled={phase !== 'checkpoint'} onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" disabled={phase !== 'checkpoint'} onClick={() => round && hop(round, false)}>
                {phase === 'moving' ? (running ? 'Running…' : 'Hopping…') : left === 1 ? 'Last hop' : `Next hop (${taken + 1} of ${HOPS})`}
              </ActionButton>
              <ActionButton kind="secondary" disabled={phase !== 'checkpoint'} onClick={() => round && hop(round, true)}>
                Run to the end
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
          {
            label: 'Chance to win',
            value: phase === 'over' ? (round?.outcome === 'cashed' ? '—' : (round?.cash ?? 0) > 0 ? '100%' : '0%') : fmtChance(live ? pNow : p0),
            tone: 'chance',
          },
          { label: 'Prize', value: fmtMult(prize), tone: 'prize' },
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
          now={pNow}
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

      <Caption>{rule}</Caption>

      {infoOpen && (
        <InfoModal title="Knight" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              A knight starts on g1 and makes {HOPS} hops, each one a chess knight's move (two squares one way, one square to the side) chosen completely
              at random among its legal moves. If its final square is green, you win the prize.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick a target: the rim, the centre 4×4, one corner quadrant, or a single square (tap the board to choose). That is the only setting.</li>
              <li>The first hop is made for you. Then the knight waits: cash out, press Next hop (Space) for one more hop, or Run to the end.</li>
              <li>If no green square can still be reached, the round is lost at once; if every way of finishing is green, it pays at once.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The dots show where the knight can still finish: a dot's area is the chance of finishing on that square.{' '}
              <b style={{ color: 'var(--win)' }}>Green</b> dots lie in your target, so together they are exactly your chance to win.
            </p>
            <p>
              The outlined squares are where the next hop can land. Every one is equally likely, so your chance now is the plain average of your chance
              from each of them. A green outline means that hop would raise your chance, red means it would lower it.
            </p>
            <p>
              Every knight move changes square colour, and g1 is dark, so after {HOPS} hops the knight is always on a light square. That is why only light
              squares are filled green and only light squares can be picked.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              The knight performs a random walk (a Markov chain) on the knight's graph. By first-step analysis, the chance h<sub>t</sub>(x) of ending
              green with t hops left from square x is the average of h<sub>t−1</sub> over x's legal moves, with h<sub>0</sub>(x) = 1 on green and 0
              elsewhere. The game computes it exactly by repeated averaging (a power of the transition matrix), never by sampling.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              The prize is {(RTP * 100).toFixed(0)}% ÷ (chance at the start), and cashing out pays prize × (chance now). Each hop averages your chance over
              the possible landing squares, so the cash-out is a fair bet at every hop (a martingale): any way of deciding when to stop, including Run to
              the end, returns exactly {(RTP * 100).toFixed(0)}% of your stake. Choosing a different target only changes the prize, never that value.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
