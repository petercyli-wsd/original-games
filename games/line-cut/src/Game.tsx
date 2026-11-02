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
import { useCallback, useEffect, useRef, useState } from 'react';
import Field, { Glyph } from './Board';
import { RTP, SHAPES, SHAPE_IDS, aimedCutChance, cutChance, direction, lineHits, offset, prizeFor, shadowRange, volatilityOf, winChance, type ShapeId } from './math';

type Phase = 'idle' | 'aiming' | 'checkpoint' | 'cutting' | 'over';
type Outcome = 'cut' | 'missed' | 'cashed';

interface Round {
  shape: ShapeId;
  stake: number;
  prize: number;
  /** The line's direction, once aimed. */
  phi: number | null;
  /** The cash-out value now: prize × P(win | what's on the board). */
  cash: number;
  outcome: Outcome | null;
}

const OUTCOME_TITLE: Record<Outcome, string> = {
  cut: 'Cut!',
  missed: 'Missed',
  cashed: 'Cashed out',
};

const easeOut = (t: number) => 1 - (1 - t) ** 3;
const mod = (x: number, m: number) => ((x % m) + m) % m;

/** requestAnimationFrame tweens whose completion is guaranteed by a timer, so a hidden tab can't stall a round. */
function useAnim() {
  const raf = useRef(0);
  const timer = useRef(0);
  const cancel = useCallback(() => {
    cancelAnimationFrame(raf.current);
    clearTimeout(timer.current);
    raf.current = 0;
    timer.current = 0;
  }, []);
  useEffect(() => cancel, [cancel]);
  const run = useCallback(
    (ms: number, frame: (t: number) => void, done: () => void) => {
      cancel();
      const t0 = performance.now();
      const tick = (now: number) => {
        frame(Math.min(1, (now - t0) / ms));
        raf.current = requestAnimationFrame(tick);
      };
      raf.current = requestAnimationFrame(tick);
      timer.current = window.setTimeout(() => {
        cancel();
        frame(1);
        done();
      }, ms);
    },
    [cancel],
  );
  return { run, cancel };
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const anim = useAnim();
  const [history, pushHistory] = useHistory();

  const [shape, setShape] = useState<ShapeId>('rod');
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [angle, setAngle] = useState<number | null>(null);
  const [cutAt, setCutAt] = useState<number | null>(null);
  const [landed, setLanded] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const shownAngle = useRef(0);
  /** True while a reveal animates, so a stale click or key can't start another. */
  const stepping = useRef(false);

  // Each reveal is decided the moment it starts, so leaving mid-animation
  // settles at its real result, never at the pre-reveal value.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'aiming' || phase === 'cutting' ? resolved.current : round?.cash ?? 0));

  const spinMs = turbo.turbo ? 220 : 900;
  const cutMs = turbo.turbo ? 260 : 1000;
  const live = phase === 'aiming' || phase === 'checkpoint' || phase === 'cutting';

  function finish(r: Round, outcome: Outcome, cash: number) {
    stepping.current = false;
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setPhase('over');
  }

  /** Stage 1: the ruler spins to the line's direction and the shadow appears. */
  function aim(r: Round) {
    const phi = direction(rng.next());
    const cash = r.prize * aimedCutChance(SHAPES[r.shape], phi);
    resolved.current = cash;
    stepping.current = true;
    setRound(r);
    setCutAt(null);
    setLanded(false);
    setPhase('aiming');
    const a0 = shownAngle.current;
    let d = mod(phi - a0, 2 * Math.PI);
    if (d < Math.PI) d += 2 * Math.PI;
    anim.run(
      spinMs,
      (t) => setAngle(a0 + d * easeOut(t)),
      () => {
        shownAngle.current = a0 + d;
        stepping.current = false;
        setRound({ ...r, phi, cash });
        setPhase('checkpoint');
        track({ type: 'checkpoint', multiplier: cash, winChance: cash / r.prize });
      },
    );
  }

  /** Stage 2: the line sweeps along the ruler and lands at a uniform offset. */
  function cut(r: Round) {
    if (r.phi === null || stepping.current) return;
    stepping.current = true;
    const p = offset(rng.next());
    const hit = lineHits(SHAPES[r.shape], r.phi, p);
    const cash = hit ? r.prize : 0;
    resolved.current = cash;
    setLanded(false);
    setPhase('cutting');
    // Sweep from −1 up to +1, then back down to p.
    const travel = 2 + (1 - p);
    anim.run(
      cutMs,
      (t) => {
        const x = travel * easeOut(t);
        setCutAt(x <= 2 ? -1 + x : 1 - (x - 2));
      },
      () => {
        setCutAt(p);
        setLanded(true);
        finish(r, hit ? 'cut' : 'missed', cash);
      },
    );
  }

  async function start() {
    if (live || stepping.current || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    anim.cancel();
    aim({ shape, stake: bet.value, prize: prizeFor(shape), phi: null, cash: RTP, outcome: null });
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round || stepping.current) return;
    finish(round, 'cashed', round.cash);
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    anim.cancel();
    setRound(null);
    setAngle(null);
    setCutAt(null);
    setLanded(false);
    setPhase('idle');
  }

  // Changing the shape after a round clears the finished board to a preview.
  const pick = (id: ShapeId) => {
    if (live) return;
    setShape(id);
    if (phase === 'over') clear();
  };

  useHotkeys(
    {
      space: () => (phase === 'checkpoint' && round ? cut(round) : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the chosen shape.
  const sh = SHAPES[round?.shape ?? shape];
  const avg = cutChance(sh);
  const prize = round?.prize ?? prizeFor(sh.id);
  const cash = round?.cash ?? RTP;
  const pNow = round ? cash / prize : avg;
  const stake = round?.stake ?? bet.value;
  const aimedShare = round?.phi != null ? aimedCutChance(sh, round.phi) : null;
  const name = sh.name.toLowerCase();
  const range = shadowRange(sh);

  let status = `Ready · one line must cut the ${name}`;
  if (phase === 'aiming') status = 'Turning the ruler';
  if (phase === 'checkpoint') status = `Aimed · shadow ${fmtChance(aimedShare ?? 0)} of the ruler`;
  if (phase === 'cutting') status = 'Dropping the line';
  if (phase === 'over' && round?.outcome) status = OUTCOME_TITLE[round.outcome];
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';
  const result =
    phase === 'over' && round?.outcome && round.outcome !== 'cashed' ? (round.cash > 0 ? 'win' : 'lose') : null;

  const vol = volatilityOf(winChance(shape));
  const compare =
    aimedShare === null
      ? ''
      : Math.abs(aimedShare - avg) < 0.005
        ? `about its ${fmtChance(avg)} average`
        : `${aimedShare > avg ? 'wider' : 'narrower'} than its ${fmtChance(avg)} average`;

  return (
    <GameLayout
      name="Line Cut"
      accent="#80ed99"
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={vol} />}>Shape</Label>
          <Chips
            label="Shape"
            options={SHAPE_IDS.map((id) => ({
              value: id,
              title: `${SHAPES[id].name}: the line cuts it ${fmtChance(winChance(id))} of the time`,
              label: (
                <span className="lc-chip">
                  <Glyph id={id} />
                  <small>{Math.round(winChance(id) * 100)}%</small>
                </span>
              ),
            }))}
            value={shape}
            disabled={live}
            onChange={pick}
          />

          <dl className="og-stats">
            <dt>Chance to win</dt>
            <dd>{fmtChance(winChance(shape))}</dd>
            <dt>Prize</dt>
            <dd>{fmtMult(prizeFor(shape))}</dd>
          </dl>

          {phase === 'checkpoint' && round ? (
            <>
              <ActionButton kind="cash" onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" onClick={() => cut(round)}>
                Drop the line · {fmtChance(aimedShare ?? 0)} to cut
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
              {phase === 'aiming' ? 'Turning…' : phase === 'cutting' ? 'Dropping…' : phase === 'over' ? 'Bet again' : 'Bet'}
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
            value: fmtChance(pNow),
            sub: round?.outcome ? (round.outcome === 'cashed' ? 'cashed out' : round.outcome === 'cut' ? `the line cut the ${name}` : 'the line missed') : aimedShare === null ? 'average shadow' : 'shadow on the ruler',
            tone: 'chance',
          },
          {
            label: 'Cash out now',
            value: live || phase === 'over' ? fmtMult(cash) : '—',
            sub: live || phase === 'over' ? formatAmount(stake * cash, 2) : 'once the ruler stops',
            tone: 'cash',
          },
          { label: 'Prize', value: fmtMult(prize), sub: formatAmount(stake * prize, 2), tone: 'prize' },
        ]}
      />

      <Board>
        <Field
          shape={sh.id}
          mode={phase === 'idle' ? 'idle' : phase === 'over' ? 'over' : 'live'}
          angle={angle}
          p={cutAt}
          settled={landed}
          result={result}
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
            placement="bottom"
          />
        )}
      </Board>

      {live ? (
        <ChanceBar
          p={pNow}
          label="Win chance"
          note={
            phase === 'aiming'
              ? `The ruler turns to a random direction. The ${name}'s shadow on it is your chance: ${fmtChance(range.lo)} to ${fmtChance(range.hi)}, ${fmtChance(avg)} on average.`
              : `Turned this way the ${name} is ${compare}. The line lands at a random spot on the ruler, square to it: inside the green shadow it cuts the ${name}.`
          }
        />
      ) : (
        <Caption>
          A random line crosses the arena; win if it cuts your shape. Your chance is the shape's shadow: its green share of the ruler. RTP{' '}
          {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Line Cut" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>A random straight line crosses the round arena. You win if it cuts your shape.</p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick a shape. A bigger outline is cut more often and pays less. Then bet.</li>
              <li>The ruler (a line through the middle) turns to a random direction, and your shape's shadow appears on it in green: a checkpoint.</li>
              <li>Cash out (C), or drop the line (Space). It lands at a random spot along the ruler, square to it, and cuts your shape if it lands in the shadow.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              Every spot on the ruler is equally likely, so the shadow's green share of the ruler is your chance to win. The flat bar under the arena is the same
              ruler laid flat.
            </p>
            <p>
              A shape looks wider from some sides than others. The rod seen side-on casts a long shadow (up to 47% of the ruler); seen end-on it casts almost none.
              Before the ruler turns, the chance is the shape's average shadow over all directions, shown in the panel and dashed on the bar once the ruler stops.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Cauchy–Crofton: a random line through a disc of radius 1 (uniform direction, uniform offset) cuts a convex shape K with probability perimeter(K) / 2π.
              For a fixed direction the chance is K's width in that direction ÷ 2 (the shadow), and Cauchy's formula says the average width is perimeter / π.
            </p>
            <p>
              Only the outline's length matters, not the area or where the shape sits. Each outline is chosen for a round chance: pin 2%, triangle 10%, square 20%,
              rod 30% (a rod's outline counts both sides) and plank 60%.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              A cut pays RTP ÷ (average chance) for your shape. At the checkpoint the cash-out is that prize × the shadow share: your exact chance of winning from
              there. Averaged over all directions that is exactly what you staked × {(RTP * 100).toFixed(0)}%, so every shape and every cash-out choice returns
              exactly {(RTP * 100).toFixed(0)}%. A line that only grazes the shape counts as a cut. The largest prize is {fmtMult(prizeFor('pin'))} (cut the pin).
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
