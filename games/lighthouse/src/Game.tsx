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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Scene from './Board';
import {
  FAN,
  H_MAX,
  H_MIN,
  MAX_MULTIPLIER,
  PRESETS,
  PRESET_IDS,
  RTP,
  SHORE_MAX,
  SHORE_MIN,
  SHUTTERS,
  W_MAX,
  W_MIN,
  chanceAt,
  fireAngle,
  headlineChance,
  lands,
  moveWindow,
  presetOf,
  prizeFor,
  resizeWindow,
  shutter,
  shutterRisk,
  towerHeight,
  typicalHeight,
  volatilityOf,
  type PresetId,
  type Shutters,
  type Wedge,
  type Win,
} from './math';

type Phase = 'idle' | 'rising' | 'checkpoint' | 'shutter' | 'firing' | 'over';
type Outcome = 'lit' | 'miss' | 'dark' | 'cashed';

interface Round {
  win: Win;
  shutters: Shutters;
  stake: number;
  prize: number;
  /** Tower height, once it has stopped. */
  h: number | null;
  wedge: Wedge;
  /** Shutters closed so far. */
  used: number;
  /** P(win | everything revealed so far). */
  p: number;
  outcome: Outcome | null;
  theta: number | null;
}

/** What the board shows: animated towards the round's true state. */
interface View {
  h: number | null;
  wedge: Wedge;
  beam: number | null;
}

const OUTCOME_TITLE: Record<Outcome, string> = { lit: 'Window lit', miss: 'Missed', dark: 'In the dark', cashed: 'Cashed out' };

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

/** The beam's sweep: lo → hi → lo → θ across the lit wedge, slowing to a stop. */
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

  const [win, setWin] = useState<Win>(PRESETS.mid.win);
  const [shutters, setShutters] = useState<Shutters>(2);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [view, setView] = useState<View>({ h: null, wedge: FAN, beam: null });
  const [infoOpen, setInfoOpen] = useState(false);
  const [compact, setCompact] = useState(false);

  // A reveal is decided the moment it starts, so leaving mid-animation settles
  // at its real result, never at the pre-reveal value.
  const resolved = useRef(0);
  const animating = phase === 'rising' || phase === 'shutter' || phase === 'firing';
  const ticket = useTicket(() => (animating ? resolved.current : round ? round.prize * round.p : 0));

  const ms = turbo.turbo ? { rise: 240, shut: 170, fire: 400 } : { rise: 950, shut: 650, fire: 1500 };
  const live = phase !== 'idle' && phase !== 'over';

  function finish(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome });
    setPhase('over');
    resolved.current = cash;
  }

  function reachCheckpoint(r: Round) {
    setRound(r);
    setPhase('checkpoint');
    track({ type: 'checkpoint', multiplier: r.prize * r.p, winChance: r.p });
  }

  function fire(r: Round) {
    const theta = fireAngle(r.wedge, rng.next());
    const hit = lands(r.win, r.h!, theta);
    resolved.current = hit ? r.prize : 0;
    setRound(r);
    setPhase('firing');
    anim.run(ms.fire, (t) => setView((v) => ({ ...v, beam: sweepAt(r.wedge, theta, t) })));
    timers.after(ms.fire + 40, () => {
      setView((v) => ({ ...v, beam: theta }));
      const done = { ...r, theta, p: hit ? 1 : 0 };
      finish(done, hit ? 'lit' : 'miss', hit ? r.prize : 0);
    });
  }

  function closeShutter(r: Round) {
    const wedge = shutter(r.wedge, rng.next());
    const p = chanceAt(r.win, r.h!, wedge);
    resolved.current = r.prize * p;
    setPhase('shutter');
    const from = r.wedge;
    anim.run(ms.shut, (t) => {
      const e = easeInOut(t);
      setView((v) => ({ ...v, wedge: [lerp(from[0], wedge[0], e), lerp(from[1], wedge[1], e)] }));
    });
    timers.after(ms.shut + 40, () => {
      setView((v) => ({ ...v, wedge }));
      const next: Round = { ...r, wedge, p, used: r.used + 1 };
      if (p === 0) return finish(next, 'dark', 0);
      // The lit wedge lies inside the window: the beam can only light it.
      if (p === 1) return fire(next);
      reachCheckpoint(next);
    });
  }

  function step() {
    if (phase !== 'checkpoint' || !round) return;
    if (round.used < round.shutters) closeShutter(round);
    else fire(round);
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    anim.stop();
    const prize = prizeFor(win);
    const h = towerHeight(rng.next());
    const p = chanceAt(win, h);
    resolved.current = prize * p;
    const r: Round = { win, shutters, stake: bet.value, prize, h: null, wedge: FAN, used: 0, p: headlineChance(win), outcome: null, theta: null };
    setRound(r);
    setPhase('rising');
    setView({ h: H_MIN, wedge: FAN, beam: null });
    anim.run(ms.rise, (t) => setView((v) => ({ ...v, h: lerp(H_MIN, h, easeInOut(t)) })));
    timers.after(ms.rise + 40, () => {
      setView((v) => ({ ...v, h }));
      reachCheckpoint({ ...r, h, p });
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
    setView({ h: null, wedge: FAN, beam: null });
    setPhase('idle');
  }

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    if (live) return;
    apply();
    if (phase === 'over') clear();
  };
  const changeWindow = (w: Win) => change(() => setWin(w));

  useHotkeys(
    {
      space: () => (phase === 'checkpoint' ? step() : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const w = round?.win ?? win;
  const headline = useMemo(() => headlineChance(w), [w]);
  const typicalH = useMemo(() => typicalHeight(w), [w]);
  const settingsP = useMemo(() => headlineChance(win), [win]);
  const vol = volatilityOf(win);
  const preset = presetOf(win);

  const prize = round?.prize ?? prizeFor(w);
  const stake = round?.stake ?? bet.value;
  const p = round ? round.p : headline;
  const cash = round ? (round.outcome && round.outcome !== 'cashed' ? (round.outcome === 'lit' ? prize : 0) : prize * round.p) : RTP;
  const nShutters = round?.shutters ?? shutters;
  const more = round ? round.used < round.shutters : false;
  const risk = round && round.h !== null && more ? shutterRisk(round.win, round.h, round.wedge) : 0;
  const checkpointNo = round ? round.used + 1 : 0;

  let status = `Ready · window ${fx(w.a)} → ${fx(w.b)} · ${nShutters === 0 ? 'no shutters' : `${nShutters} shutter${nShutters > 1 ? 's' : ''}`}`;
  if (phase === 'rising') status = 'Tower rising…';
  if (phase === 'checkpoint') status = `Checkpoint ${checkpointNo} of ${nShutters + 1}`;
  if (phase === 'shutter') status = `Shutter ${(round?.used ?? 0) + 1} of ${nShutters} closing…`;
  if (phase === 'firing') status = 'Beam sweeping…';
  if (phase === 'over' && round?.outcome) status = OUTCOME_TITLE[round.outcome];
  const tone = phase === 'over' ? (round && cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  let next = '';
  if (phase === 'checkpoint' && round) {
    next = more
      ? risk === 0
        ? 'Next shutter: your window is in both halves, so it stays lit either way.'
        : 'Next shutter: a coin flip. One half keeps your window lit, the other leaves it in the dark.'
      : 'Next: the beam sweeps and stops at a random angle inside the lit fan.';
  } else if (phase === 'rising') next = 'The tower is rising. Its height redraws your window’s sector.';
  else if (phase === 'shutter') next = 'A shutter is closing one half of the lamp’s fan.';
  else if (phase === 'firing') next = 'Every direction in the lit fan is equally likely.';

  const busyLabel = phase === 'rising' ? 'Tower rising…' : phase === 'shutter' ? 'Shutter closing…' : 'Beam sweeping…';

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
      accent="#ffe066"
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={vol} />}>Window</Label>
          <Chips<PresetId | 'custom'>
            label="Window preset"
            options={PRESET_IDS.map((id) => ({ value: id, label: PRESETS[id].label }))}
            value={preset}
            disabled={live}
            onChange={(id) => id !== 'custom' && changeWindow(PRESETS[id].win)}
          />
          <Label
            hint={
              <>
                <b>{fx(win.a)}</b> → <b>{fx(win.b)}</b>
              </>
            }
          >
            Distance
          </Label>
          <Slider
            label="Window distance"
            value={Number(((win.a + win.b) / 2).toFixed(2))}
            min={Number((SHORE_MIN + (win.b - win.a) / 2).toFixed(2))}
            max={Number((SHORE_MAX - (win.b - win.a) / 2).toFixed(2))}
            step={0.1}
            disabled={live}
            onChange={(c) => changeWindow(moveWindow(win, c))}
          />
          <Label hint={<b>{fx(win.b - win.a)}</b>}>Width</Label>
          <Slider
            label="Window width"
            value={Number((win.b - win.a).toFixed(1))}
            min={W_MIN}
            max={W_MAX}
            step={0.1}
            risk
            disabled={live}
            onChange={(v) => changeWindow(resizeWindow(win, v))}
          />

          <Label hint="a checkpoint after each">Shutters</Label>
          <Chips<Shutters>
            label="Shutters"
            options={SHUTTERS.map((v) => ({ value: v, label: v === 0 ? 'None' : v }))}
            value={shutters}
            disabled={live}
            onChange={(v) => change(() => setShutters(v))}
          />

          <dl className="og-stats">
            <dt>Chance to win</dt>
            <dd>{fmtChance(settingsP)}</dd>
            <dt>Prize</dt>
            <dd>{fmtMult(RTP / settingsP)}</dd>
          </dl>

          {phase === 'checkpoint' && round ? (
            <>
              <ActionButton kind="cash" onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" onClick={step}>
                {more ? `Close shutter · ${risk === 0 ? 'stays lit' : '50/50'}` : `Fire beam · ${fmtChance(round.p)} hit`}
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
              {live ? busyLabel : phase === 'over' ? 'Bet again' : 'Bet'}
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
            value: fmtChance(p),
            sub:
              phase === 'idle'
                ? 'averaged over the tower'
                : phase === 'over'
                  ? round?.outcome === 'cashed'
                    ? 'when you cashed out'
                    : 'round over'
                  : round?.h === null
                    ? 'before the tower stops'
                    : 'green ÷ lit arc',
            tone: 'chance',
          },
          {
            label: phase === 'over' ? 'Paid' : 'Cash out now',
            value: phase === 'idle' ? '—' : fmtMult(cash),
            sub: phase === 'idle' ? 'at each checkpoint' : formatAmount(stake * cash, 2),
            tone: 'cash',
          },
          { label: 'Prize', value: fmtMult(prize), sub: `pays ${formatAmount(stake * prize, 2)}`, tone: 'prize' },
        ]}
      />

      <Board className="lh-board">
        <Scene
          win={w}
          h={view.h}
          typicalH={typicalH}
          headline={headline}
          wedge={view.wedge}
          beam={view.beam}
          result={phase === 'over' && round?.outcome && round.outcome !== 'cashed' ? round.outcome : null}
          editable={!live}
          motion={phase === 'rising' ? 'rise' : phase === 'shutter' ? 'shutter' : null}
          heldP={p}
          onWindow={changeWindow}
          onCompact={setCompact}
        />
        {!compact && roundOver('top')}
      </Board>
      {compact && roundOver('inline')}

      {live ? (
        <ChanceBar p={p} label="Beam lights your window" note={next} />
      ) : (
        <Caption>
          Every beam angle is equally likely, so your chance is your window’s angle seen from the lamp, out of 180°. Averaged over the tower’s random height
          ({H_MIN} to {H_MAX}): {fmtChance(headline)}. Drag the window or tap the shore to move it. RTP {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Lighthouse" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              A lighthouse stands on a straight shore. Its beam stops at a random angle and lands somewhere on the shore. Win if it lands inside your window.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>
                Place your window: pick a preset, use the sliders, drag it, or tap the shore. Near and wide is likely and pays little; far and narrow is rare
                and pays up to {fmtMult(MAX_MULTIPLIER)}.
              </li>
              <li>Choose how many shutters (0 to 3). Each one adds a checkpoint. Then bet.</li>
              <li>The tower rises to a random height between {H_MIN} and {H_MAX}. Checkpoint: cash out, or continue.</li>
              <li>Each shutter closes one half of the lamp’s lit fan, chosen 50/50. Checkpoint after each.</li>
              <li>Finally the beam sweeps and stops at a uniformly random angle inside the lit fan. Space continues, C cashes out.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              Every direction of the beam is equally likely, so what matters is angle, not distance along the shore. The{' '}
              <b style={{ color: 'var(--green)' }}>green sector</b> runs from the lamp to the two ends of your window. On the{' '}
              <b>lamp’s fan</b> dial (and the small ring round the lamp) it is the green arc. The <b style={{ color: 'var(--red)' }}>red arc</b> is lit
              directions that miss, and the dark arc is shuttered. Your chance is green ÷ (green + red), shown on the dial and the bar below.
            </p>
            <p>
              A higher tower makes far windows bigger in angle and near windows smaller, so watch the sector when the tower stops. A shutter either keeps
              your window (and its share of the lit fan doubles) or leaves it in the dark.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              The Cauchy distribution. A lamp at height h firing at a uniform angle θ in (−90°, 90°) hits the shore at x = h·tan θ. So the window [a, b] is
              lit with chance P(win | h) = (atan(b/h) − atan(a/h)) / π, its angle over 180°. Averaged over the tower’s uniform height, using ∫ atan(c/h) dh
              = h·atan(c/h) + (c/2)·ln(h² + c²), this gives the headline chance P₀ exactly. The tail is heavy: twice as far is about four times as hard.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              A full win pays prize = {(RTP * 100).toFixed(0)}% ÷ P₀. At every checkpoint the cash-out is prize × P(win | what you have seen). That is the
              conditional chance of one fixed event, so on average it never moves: over all tower heights it averages back to P₀, a shutter keeps each
              half with chance ½ and the two halves’ green shares average to the current one, and the beam lands green with exactly the green share. Whenever you cash out, the round is worth{' '}
              {(RTP * 100).toFixed(0)}% of your stake. The number of shutters changes the pace and the swings, never the value.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
