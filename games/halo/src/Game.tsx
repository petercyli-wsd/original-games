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
  fmtOneIn,
  useBetInput,
  useHistory,
  useHotkeys,
  useTicket,
  useTurbo,
} from '@originals/game-sdk/ui';
import { formatAmount } from '@originals/game-sdk';
import { useCallback, useEffect, useRef, useState } from 'react';
import Field from './Board';
import {
  ARC_MAX,
  ARC_MIN,
  ARC_STEP,
  CENTRE,
  RINGS,
  RTP,
  TAU,
  cashOut,
  geodesic,
  haloArc,
  leg,
  prize,
  release,
  ringRadii,
  startChance,
  volatilityOf,
  winChance,
  type Pt,
  type Rings,
} from './math';

type Phase = 'idle' | 'walking' | 'checkpoint' | 'releasing' | 'over';
type Outcome = 'win' | 'lose' | 'cashed';

interface Round {
  arc: number;
  rings: Rings;
  radii: number[];
  stake: number;
  /** Rings reached so far. */
  reached: number;
  /** Where the particle rests. */
  z: Pt;
  /** Legs walked so far (each ends on a ring), then the release flight. */
  legs: Pt[][];
  cash: number;
  outcome: Outcome | null;
  exit: Pt | null;
}

/** What is moving right now. */
type Motion =
  | { kind: 'walk'; path: Pt[]; cum: number[]; t: number }
  | { kind: 'spin'; from: number; to: number; t: number }
  | { kind: 'fly'; path: Pt[]; cum: number[]; theta: number; t: number };

const OUTCOME_TITLE: Record<Outcome, string> = { win: 'Through the arc', lose: 'Missed the arc', cashed: 'Cashed out' };

/** Cumulative weights along a path; each segment's weight is length^power. */
function cumulative(path: Pt[], power: number) {
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y) ** power);
  return cum;
}

/** The stretch of a path drawn so far at progress t, and its last point. */
function partial(path: Pt[], cum: number[], t: number): Pt[] {
  const target = t * cum[cum.length - 1];
  let i = 1;
  while (i < path.length - 1 && cum[i] < target) i++;
  const span = cum[i] - cum[i - 1] || 1;
  const s = Math.min(1, Math.max(0, (target - cum[i - 1]) / span));
  const a = path[i - 1];
  const b = path[i];
  return [...path.slice(0, i), { x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s }];
}

const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** requestAnimationFrame driver with a timeout fallback, cancelled on clear and unmount. */
function useFrames() {
  const raf = useRef<number | null>(null);
  const timeout = useRef<number | null>(null);
  const stop = useCallback(() => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    if (timeout.current !== null) clearTimeout(timeout.current);
    raf.current = null;
    timeout.current = null;
  }, []);
  useEffect(() => stop, [stop]);
  const run = useCallback(
    (ms: number, frame: (t: number) => void, done: () => void) => {
      stop();
      const t0 = performance.now();
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        stop();
        frame(1);
        done();
      };
      const tick = (now: number) => {
        const t = (now - t0) / ms;
        if (t >= 1) return finish();
        frame(Math.max(0, t));
        raf.current = requestAnimationFrame(tick);
      };
      raf.current = requestAnimationFrame(tick);
      timeout.current = window.setTimeout(finish, ms + 150);
    },
    [stop],
  );
  return { run, stop };
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const frames = useFrames();
  const [history, pushHistory] = useHistory();

  const [arc, setArc] = useState(90);
  const [rings, setRings] = useState<Rings>(4);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [motion, setMotion] = useState<Motion | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  // Each step is decided the moment it starts, so leaving mid-animation
  // settles at its real result, never at the pre-step value.
  const resolved = useRef(0);
  // Set synchronously while a step animates, so a double click (or C in the same tick) can't act twice.
  const stepping = useRef(false);
  const ticket = useTicket(() => (phase === 'walking' || phase === 'releasing' ? resolved.current : round?.cash ?? 0));

  const speed = turbo.turbo ? 0.25 : 1;
  const live = phase === 'walking' || phase === 'checkpoint' || phase === 'releasing';
  const busy = phase === 'walking' || phase === 'releasing';

  function finish(r: Round, outcome: Outcome, cash: number) {
    stepping.current = false;
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setMotion(null);
    setPhase('over');
  }

  function drift(r: Round) {
    if (stepping.current) return;
    stepping.current = true;
    const rho = r.radii[r.reached];
    const path = leg(r.z, rho, rng.next);
    const end = path[path.length - 1];
    const cash = cashOut(end, r.arc);
    resolved.current = cash;
    const cum = cumulative(path, 0.5);
    setPhase('walking');
    setMotion({ kind: 'walk', path, cum, t: 0 });
    frames.run(
      1000 * speed,
      (t) => setMotion({ kind: 'walk', path, cum, t }),
      () => {
        const next: Round = { ...r, z: end, reached: r.reached + 1, legs: [...r.legs, path], cash };
        stepping.current = false;
        setRound(next);
        setMotion(null);
        setPhase('checkpoint');
        track({ type: 'checkpoint', multiplier: cash, winChance: winChance(end, r.arc) });
      },
    );
  }

  function releaseNow(r: Round) {
    if (stepping.current) return;
    stepping.current = true;
    const out = release(r.z, r.arc, rng.next());
    const pay = out.win ? prize(r.arc) : 0;
    resolved.current = pay;
    const halo = haloArc(r.z, r.arc);
    // The pointer starts in the middle of the red part and spins at least two turns.
    const from = halo.start + halo.length + (TAU - halo.length) / 2;
    const to = from + 2 * TAU + ((((out.theta - from) % TAU) + TAU) % TAU);
    const flight = geodesic(r.z, out.theta, 80);
    const cum = cumulative(flight, 1);
    setPhase('releasing');
    setMotion({ kind: 'spin', from, to, t: 0 });
    frames.run(
      1100 * speed,
      (t) => setMotion({ kind: 'spin', from, to, t }),
      () =>
        frames.run(
          600 * speed,
          (t) => setMotion({ kind: 'fly', path: flight, cum, theta: out.theta, t }),
          () => finish({ ...r, legs: [...r.legs, flight], exit: out.exit }, out.win ? 'win' : 'lose', pay),
        ),
    );
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    frames.stop();
    stepping.current = false;
    const r: Round = {
      arc,
      rings,
      radii: ringRadii(rings),
      stake: bet.value,
      reached: 0,
      z: CENTRE,
      legs: [],
      cash: RTP,
      outcome: null,
      exit: null,
    };
    setRound(r);
    if (r.radii.length > 0) drift(r);
    else releaseNow(r);
  }

  function cashOutNow() {
    if (phase !== 'checkpoint' || !round || stepping.current) return;
    finish(round, 'cashed', round.cash);
  }

  function clear() {
    if (live) return;
    frames.stop();
    stepping.current = false;
    setRound(null);
    setMotion(null);
    setPhase('idle');
  }

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    apply();
    if (phase === 'over') clear();
  };

  const canDrift = phase === 'checkpoint' && !!round && round.reached < round.radii.length;
  const proceed = () => {
    if (phase !== 'checkpoint' || !round) return;
    if (canDrift) drift(round);
    else releaseNow(round);
  };

  useHotkeys(
    {
      space: () => (phase === 'checkpoint' ? proceed() : !live ? void start() : undefined),
      cashOut: cashOutNow,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const g = round?.arc ?? arc;
  const n = round?.rings ?? rings;
  const radii = round?.radii ?? ringRadii(rings);
  const reached = round?.reached ?? 0;
  const prizeX = prize(g);
  const stake = round?.stake ?? bet.value;

  let pos: Pt = round?.z ?? CENTRE;
  let current: Pt[] | null = null;
  let pointer: number | null = null;
  let legs = round?.legs ?? [];
  if (motion?.kind === 'walk') {
    current = partial(motion.path, motion.cum, motion.t);
    pos = current[current.length - 1];
  } else if (motion?.kind === 'spin') {
    pointer = motion.from + (motion.to - motion.from) * easeOut(motion.t);
  } else if (motion?.kind === 'fly') {
    current = partial(motion.path, motion.cum, easeInOut(motion.t));
    pos = current[current.length - 1];
    pointer = motion.theta;
  }
  const flying = motion?.kind === 'fly';
  const finished = phase === 'over' && !!round?.exit;
  if (finished && round?.exit) {
    // The flight is the last leg; keep it bright and leave the particle on the rim.
    current = legs[legs.length - 1] ?? null;
    legs = legs.slice(0, -1);
    pos = round.exit;
  }

  // While flying (and after), the odds shown are those of the release point.
  const releaseChance = round ? winChance(round.z, g) : startChance(g);
  const chance = flying || finished ? releaseChance : winChance(pos, g);
  const cashNow = phase === 'over' ? round?.cash ?? 0 : prizeX * chance;
  const vol = volatilityOf(arc);

  let status = `Ready · ${g}° arc · ${n ? `${n} rings` : 'straight release'}`;
  if (phase === 'walking') status = `Drifting to ring ${reached + 1} of ${n}`;
  if (phase === 'checkpoint') status = `Checkpoint · ring ${reached} of ${n}`;
  if (phase === 'releasing') status = flying ? 'Released · flying to the rim' : 'Released · spinning the halo';
  if (phase === 'over' && round?.outcome) status = `${OUTCOME_TITLE[round.outcome]} · ${fmtMult(round.cash)}`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  return (
    <GameLayout
      name="Halo"
      accent="#a0c4ff"
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={vol} />}>
            Green arc <b style={{ color: 'var(--text)' }}>{arc}°</b>
          </Label>
          <Slider
            label="Green arc size"
            min={ARC_MIN}
            max={ARC_MAX}
            step={ARC_STEP}
            value={arc}
            risk
            disabled={live}
            onChange={(v) => change(() => setArc(v))}
          />

          <Label hint="cash-out stops">Checkpoint rings</Label>
          <Chips
            label="Checkpoint rings"
            options={RINGS.map((v) => ({ value: v, label: v === 0 ? 'None' : v }))}
            value={rings}
            disabled={live}
            onChange={(v) => change(() => setRings(v))}
          />

          <dl className="og-stats">
            <dt>Chance to win</dt>
            <dd>
              {fmtChance(startChance(arc))} · {fmtOneIn(startChance(arc))}
            </dd>
            <dt>Prize</dt>
            <dd>{fmtMult(prize(arc))}</dd>
          </dl>

          {phase === 'checkpoint' && round ? (
            <>
              <ActionButton kind="cash" onClick={cashOutNow}>
                Cash out <span>{formatAmount(stake * round.cash, 2)}</span>
              </ActionButton>
              {canDrift && (
                <ActionButton kind="secondary" onClick={proceed}>
                  Drift to ring {round.reached + 1}
                </ActionButton>
              )}
              <ActionButton kind="secondary" onClick={() => releaseNow(round)}>
                Release · {fmtChance(releaseChance)} to win
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={busy || !!bet.blocked} onClick={() => void start()}>
              {phase === 'walking' ? 'Drifting…' : phase === 'releasing' ? 'Releasing…' : phase === 'over' ? 'Bet again' : 'Bet'}
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
            value: fmtChance(phase === 'over' ? (round?.outcome === 'win' ? 1 : round?.outcome === 'lose' ? 0 : chance) : chance),
            sub:
              phase === 'over'
                ? round?.outcome === 'win'
                  ? 'left through the arc'
                  : round?.outcome === 'lose'
                    ? 'left outside the arc'
                    : 'when you cashed out'
                : live
                  ? 'green share of the halo'
                  : `${g}° of the 360° rim`,
            tone: 'chance',
          },
          {
            label: phase === 'over' ? 'Paid' : 'Cash out now',
            value: live || phase === 'over' ? fmtMult(cashNow) : '—',
            sub: live || phase === 'over' ? formatAmount(stake * cashNow, 2) : n ? `at each of ${n} rings` : 'no stops: one release',
            tone: 'cash',
          },
          { label: 'Prize', value: fmtMult(prizeX), sub: 'leave through the green arc', tone: 'prize' },
        ]}
      />

      <Board>
        <Field
          arc={g}
          radii={radii}
          reached={reached}
          target={live && reached < radii.length ? reached : null}
          pos={pos}
          anchor={flying ? round!.z : pos}
          chance={chance}
          legs={legs}
          current={current}
          showHalo={!finished}
          showLabel={phase !== 'over'}
          pointer={pointer}
          exit={phase === 'over' ? round?.exit ?? null : null}
          outcome={phase === 'over' ? round?.outcome ?? null : null}
          live={live}
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
            placement="center"
          />
        )}
      </Board>

      {live ? (
        <ChanceBar
          p={chance}
          label="Chance to leave through the green arc"
          note="Green share of the halo = your chance. Dashed arcs join points with equal odds; the dotted ring is the next stop."
        />
      ) : (
        <Caption>
          From the centre every exit point is equally likely, so a {g}° arc wins {g}°/360° = {fmtChance(startChance(g))} of the time: the green share of the
          halo. Prize {fmtMult(prizeX)}. RTP {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Halo" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              A particle starts at the centre of the disc and wanders at random until it reaches the rim. If it leaves through the{' '}
              <b style={{ color: 'var(--green)' }}>green arc</b>, you win the prize.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Choose the size of the green arc (smaller pays more) and how many checkpoint rings to stop at, then bet.</li>
              <li>The particle drifts out to the first ring and stops. At each ring you can cash out, drift on to the next ring (Space), or release it.</li>
              <li>
                Release: a pointer spins on the particle's halo and the particle flies to the rim in that direction. Green wins the prize. From the last ring,
                releasing is the only way on. With no rings, the bet is a single release from the centre.
              </li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The ring around the particle is its <b>halo</b>. Its <b style={{ color: 'var(--green)' }}>green share</b> is exactly your chance to win from
              where the particle is, and the release pointer lands on any part of the halo with equal chance. The shaded green fan shows the curved paths
              those green directions follow to the arc. The faint arcs through the ends of the green arc are iso-odds lines: every point on the one marked 25%
              has a 25% chance. Drifting towards the arc grows the green; drifting away shrinks it.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              The chance that Brownian motion from z leaves through the arc G is its <b>harmonic measure</b> ω(z, G). Brownian motion is conformally
              invariant, so map z to the centre with φ<sub>z</sub>(w) = (w − z)/(1 − z̄w). From the centre every exit point is equally likely, so ω(z, G) =
              |φ<sub>z</sub>(G)| / 2π. At the start that is |G|/360°. The map sends straight lines from the centre to the curved paths (geodesics) leaving z
              in the same direction, which is why the halo is a literal picture of the odds. The level sets of ω are circular arcs through G&apos;s ends.
            </p>
            <p>
              The drift is an exact &quot;walk on circles&quot;: each hop lands at a uniform point of a circle around the particle (that is where Brownian
              motion first leaves such a circle), and the stop on each ring is sampled from the ring&apos;s Poisson kernel.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              The prize is {(RTP * 100).toFixed(0)}% × 360° / |G|, and cashing out pays prize × ω(z). Because ω is harmonic, its expected value after any hop,
              ring or release equals its value now (it is a martingale). So the round is worth {(RTP * 100).toFixed(0)}% of your stake however and whenever
              you cash out, drift or release. The largest possible payout is the {ARC_MIN}° prize, {fmtMult(prize(ARC_MIN))}.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
