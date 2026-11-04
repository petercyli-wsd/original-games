import { useHost } from '@originals/game-sdk/react';
import {
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
  Slider,
  StageTop,
  VolBadge,
  ACCENTS,
  eventMs,
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Scene from './Board';
import {
  DIST_MAX,
  DIST_MIN,
  DIST_STEP,
  FAN,
  H_MAX,
  H_MIN,
  MAX_MULTIPLIER,
  PRESETS,
  PRESET_IDS,
  RTP,
  WIDTH,
  chanceAt,
  fireAngle,
  headlineChance,
  lands,
  presetOf,
  prizeFor,
  snapDist,
  towerHeight,
  typicalHeight,
  volatilityOf,
  windowAt,
  type PresetId,
  type Wedge,
  type Win,
} from './math';

type Phase = 'idle' | 'rising' | 'checkpoint' | 'firing' | 'over';
type Outcome = 'lit' | 'miss' | 'cashed';

interface Round {
  win: Win;
  stake: number;
  prize: number;
  /** P(win) before the tower stopped. */
  p0: number;
  /** Tower height, once it has stopped. */
  h: number | null;
  /** P(win | everything revealed so far). */
  p: number;
  outcome: Outcome | null;
}

/** What the board shows: animated towards the round's true state. */
interface View {
  h: number | null;
  beam: number | null;
}

const OUTCOME_TITLE: Record<Outcome, string> = { lit: 'Window lit', miss: 'Missed', cashed: 'Cashed out' };
const RULE = 'The beam fires in a random direction; win if it lands in your window.';

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const fx = (x: number) => x.toFixed(1);

/** requestAnimationFrame tweening, cancelled on unmount or on demand. */
function useAnimator() {
  const id = useRef(0);
  useEffect(() => () => cancelAnimationFrame(id.current), []);
  const stop = useCallback(() => cancelAnimationFrame(id.current), []);
  const run = useCallback((ms: number, frame: (t: number) => void) => {
    cancelAnimationFrame(id.current);
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / ms);
      frame(t);
      if (t < 1) id.current = requestAnimationFrame(tick);
    };
    id.current = requestAnimationFrame(tick);
  }, []);
  return { run, stop };
}

/** The beam's sweep: lo → hi → lo → θ across the fan, slowing to a stop. */
function sweepAt([lo, hi]: Wedge, theta: number, t: number) {
  const w = hi - lo;
  const s = easeOut(t) * (2 * w + (theta - lo));
  const m = s % (2 * w);
  return t >= 1 ? theta : m <= w ? lo + m : hi - (m - w);
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const anim = useAnimator();
  const [history, pushHistory] = useHistory();

  const [dist, setDist] = useState<number>(PRESETS.mid.dist);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [view, setView] = useState<View>({ h: null, beam: null });
  const [infoOpen, setInfoOpen] = useState(false);
  const [compact, setCompact] = useState(false);
  const win = useMemo(() => windowAt(dist), [dist]);

  // A reveal is decided the moment it starts, so leaving mid-animation settles
  // at its real result, never at the pre-reveal value.
  const resolved = useRef(0);
  const animating = phase === 'rising' || phase === 'firing';
  const ticket = useTicket(() => (animating ? resolved.current : round ? round.prize * round.p : 0));

  const ms = { rise: eventMs(turbo.turbo), fire: eventMs(turbo.turbo, 1000) };
  const live = phase !== 'idle' && phase !== 'over';

  function finish(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome });
    setPhase('over');
    resolved.current = cash;
  }

  function fire() {
    if (phase !== 'checkpoint' || !round) return;
    const r = round;
    const theta = fireAngle(rng.next());
    const hit = lands(r.win, r.h!, theta);
    resolved.current = hit ? r.prize : 0;
    setPhase('firing');
    anim.run(ms.fire, (t) => setView((v) => ({ ...v, beam: sweepAt(FAN, theta, t) })));
    timers.after(ms.fire + 40, () => {
      setView((v) => ({ ...v, beam: theta }));
      finish({ ...r, p: hit ? 1 : 0 }, hit ? 'lit' : 'miss', hit ? r.prize : 0);
    });
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    anim.stop();
    const prize = prizeFor(win);
    const p0 = headlineChance(win);
    const h = towerHeight(rng.next());
    const p = chanceAt(win, h);
    resolved.current = prize * p;
    const r: Round = { win, stake: bet.value, prize, p0, h: null, p: p0, outcome: null };
    setRound(r);
    setPhase('rising');
    setView({ h: H_MIN, beam: null });
    anim.run(ms.rise, (t) => setView((v) => ({ ...v, h: lerp(H_MIN, h, easeInOut(t)) })));
    timers.after(ms.rise + 40, () => {
      setView((v) => ({ ...v, h }));
      setRound({ ...r, h, p });
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: prize * p, winChance: p });
    });
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', round.prize * round.p);
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    anim.stop();
    setRound(null);
    setView({ h: null, beam: null });
    setPhase('idle');
  }

  // Changing the distance after a round clears the finished board to a preview.
  const changeDist = (d: number) => {
    if (live) return;
    setDist(d);
    if (phase === 'over') clear();
  };

  useHotkeys(
    {
      space: () => (phase === 'checkpoint' ? fire() : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const w = round?.win ?? win;
  const headline = useMemo(() => headlineChance(w), [w]);
  const typicalH = useMemo(() => typicalHeight(w), [w]);
  const vol = volatilityOf(win);
  const preset = presetOf(dist);

  const prize = round?.prize ?? prizeFor(w);
  const stake = round?.stake ?? bet.value;
  const p = round ? round.p : headline;
  const cash = round ? (round.outcome && round.outcome !== 'cashed' ? (round.outcome === 'lit' ? prize : 0) : prize * round.p) : RTP;

  let status = `Ready · window at ${fx(dist)}`;
  if (phase === 'rising') status = 'Tower rising…';
  if (phase === 'checkpoint' && round?.h != null) status = `Tower stopped at ${round.h.toFixed(2)}`;
  if (phase === 'firing') status = 'Beam sweeping…';
  if (phase === 'over' && round?.outcome) status = OUTCOME_TITLE[round.outcome];
  const tone = phase === 'over' ? (round && cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  // Over the sky in wide frames; below the board in narrow ones, where a card would cover the picture.
  const roundOver = (placement: 'top' | 'inline') =>
    phase === 'over' &&
    round?.outcome && (
      <RoundOver
        key={history[0]?.id}
        title={OUTCOME_TITLE[round.outcome]}
        multiplier={cash}
        stake={round.stake}
        nextBet={bet.value}
        blocked={bet.blocked}
        onBetAgain={() => void start()}
        onClear={clear}
        placement={placement}
      />
    );

  return (
    <GameLayout
      name="Lighthouse"
      accent={ACCENTS.amber}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={vol} />}>Window distance</Label>
          <Chips<PresetId | 'custom'>
            label="Window distance preset"
            options={PRESET_IDS.map((id) => ({ value: id, label: PRESETS[id].label }))}
            value={preset}
            disabled={live}
            onChange={(id) => id !== 'custom' && changeDist(PRESETS[id].dist)}
          />
          <Label
            hint={
              <>
                <b>{fx(dist)}</b> from the tower
              </>
            }
          >
            Distance
          </Label>
          <Slider label="Window distance" value={dist} min={DIST_MIN} max={DIST_MAX} step={DIST_STEP} disabled={live} onChange={(d) => changeDist(snapDist(d))} />

          {phase === 'checkpoint' && round ? (
            <>
              <ActionButton kind="cash" onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" onClick={fire}>
                Fire beam
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
              {phase === 'rising' ? 'Tower rising…' : phase === 'firing' ? 'Beam sweeping…' : phase === 'over' ? 'Bet again' : 'Bet'}
            </ActionButton>
          )}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />

      <Readouts
        items={[
          { label: 'Win chance', value: fmtChance(p), tone: 'chance' },
          { label: 'Prize', value: fmtMult(prize), tone: 'prize' },
        ]}
      />

      <Board className="lh-board">
        <Scene
          win={w}
          h={view.h}
          typicalH={typicalH}
          headline={headline}
          beam={view.beam}
          result={phase === 'over' && (round?.outcome === 'lit' || round?.outcome === 'miss') ? round.outcome : null}
          editable={!live}
          rising={phase === 'rising'}
          onDist={changeDist}
          onCompact={setCompact}
        />
        {!compact && roundOver('top')}
      </Board>
      {compact && roundOver('inline')}

      <Caption>{RULE}</Caption>

      {infoOpen && (
        <InfoModal title="Lighthouse" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>{RULE}</p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>
                Choose how far from the tower your window sits (it is always {WIDTH} wide): pick a preset, use the slider, drag it, or tap the shore.
                Near is likely and pays little; far is rare and pays up to {fmtMult(MAX_MULTIPLIER)}. Then bet.
              </li>
              <li>The tower rises to a random height between {H_MIN} and {H_MAX}, and your window’s slice of the fan widens or narrows with it.</li>
              <li>Checkpoint: cash out at the new value, or fire the beam. Space fires, C cashes out.</li>
              <li>The beam sweeps and stops in a random direction. Win the prize if it lands in your window.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              Every direction of the beam is equally likely, so what matters is angle, not distance along the shore. The{' '}
              <b style={{ color: 'var(--win)' }}>green cone</b> runs from the lamp to the two ends of your window. On the{' '}
              <b>fan</b> dial it is the green part of the half circle; the{' '}
              <b style={{ color: 'var(--lose)' }}>red</b> part is every direction that misses. Ticks mark every 10%. Your chance is the green share.
            </p>
            <p>
              A taller tower looks down on near windows more steeply, so their slice narrows; far windows face it more squarely, so theirs widens. Before
              the tower stops, the chance is the average over all heights.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              The Cauchy distribution. A lamp at height h firing at a uniform angle θ in (−90°, 90°) hits the shore at x = h·tan θ. So the window [a, b] is
              lit with chance P(win | h) = (atan(b/h) − atan(a/h)) / π, its share of the fan. Averaged over the tower’s uniform height, using ∫ atan(c/h)
              dh = h·atan(c/h) + (c/2)·ln(h² + c²), this gives the starting chance P₀ exactly. The tail is heavy: twice as far is about four times as
              hard.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              A full win pays prize = {(RTP * 100).toFixed(0)}% ÷ P₀. When the tower stops, the cash-out is prize × P(win | h). Averaged over all tower
              heights that is prize × P₀ = {(RTP * 100).toFixed(0)}%, and firing wins the prize with exactly P(win | h). So whether you cash out or fire,
              the round is worth {(RTP * 100).toFixed(0)}% of your stake.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
