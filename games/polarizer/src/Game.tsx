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
import { useRef, useState } from 'react';
import Field, { type Outcome, type Shot } from './Board';
import {
  GOAL,
  MAX_MULTIPLIER,
  MAX_TURN,
  RTP,
  TURNS,
  afterPass,
  nextTurn,
  passChance,
  passes,
  plan,
  planChance,
  prizeFor,
  volatilityOf,
  zeno,
  type Turn,
} from './math';

type Phase = 'idle' | 'emitting' | 'firing' | 'checkpoint' | 'over';

interface Round {
  id: number;
  stake: number;
  /** The photon's polarisation, in degrees. */
  angle: number;
  cash: number;
  /** Axes of the polarizers passed so far. */
  path: number[];
  outcome: Outcome | null;
}

const ACCENT = '#80ffdb';
const OUTCOME_TITLE: Record<Outcome, string> = { absorbed: 'Absorbed', through: 'Through at 90°', cashed: 'Cashed out' };
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** "3 × 30°", "75° + 15°", "2 × 30° + 15°". */
function planLabel(angle: number, turn: number) {
  const steps = plan(angle, turn);
  if (steps.length === 0) return 'done';
  const [first] = steps;
  const same = steps.filter((d) => d === first).length;
  const head = same === 1 ? `${first}°` : `${same} × ${first}°`;
  return same === steps.length ? head : `${head} + ${steps[steps.length - 1]}°`;
}

/** Turns on offer from a given angle: the chips that fit, plus "the rest" when it is its own size. */
function turnOptions(angle: number): number[] {
  const rest = GOAL - angle;
  const opts: number[] = TURNS.filter((t) => t <= rest);
  if (rest <= MAX_TURN && !opts.includes(rest)) opts.push(rest);
  return opts.sort((a, b) => a - b);
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [turn, setTurn] = useState<Turn>(30);
  /** The turn size chosen during a round (an EV-neutral choice at each checkpoint). */
  const [pick, setPick] = useState<number>(30);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [shot, setShot] = useState<Shot | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const seq = useRef(0);

  // A polarizer's outcome is decided the moment it fires, so leaving
  // mid-animation settles at the real result, never at the pre-shot value.
  const resolved = useRef(0);
  const ticket = useTicket(() => (phase === 'firing' ? resolved.current : round?.cash ?? 0));

  const speed = turbo.turbo ? 0.25 : 1;
  const emitMs = Math.round(450 * speed);
  const dropMs = Math.round(700 * speed);
  const turnMs = Math.round(600 * speed);
  const live = phase === 'emitting' || phase === 'firing' || phase === 'checkpoint';

  function finish(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setPhase('over');
  }

  function fire(r: Round, size: number) {
    const d = nextTurn(r.angle, size);
    const u = rng.next();
    const pass = passes(u, d);
    const cash = pass ? afterPass(r.cash, d) : 0;
    resolved.current = cash;
    setPhase('firing');
    setShot({ from: r.angle, delta: d, u, pass, stage: 'aim' });
    timers.after(30, () => setShot((s) => s && { ...s, stage: 'drop' }));
    timers.after(30 + dropMs, () => setShot((s) => s && { ...s, stage: 'turn' }));
    timers.after(30 + dropMs + turnMs, () => {
      if (!pass) return finish(r, 'absorbed', 0);
      const next: Round = { ...r, angle: r.angle + d, cash, path: [...r.path, r.angle + d] };
      if (next.angle >= GOAL) return finish(next, 'through', cash);
      setRound(next);
      setShot(null);
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: cash, winChance: planChance(next.angle, size) });
    });
  }

  async function start() {
    if (live || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const r: Round = { id: ++seq.current, stake: bet.value, angle: 0, cash: RTP, path: [], outcome: null };
    setRound(r);
    setShot(null);
    setPick(turn);
    setPhase('emitting');
    // The photon leaves the source polarised at 0°: a free first checkpoint.
    timers.after(emitMs, () => {
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: RTP, winChance: planChance(0, turn) });
    });
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', round.cash);
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    setRound(null);
    setShot(null);
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
      space: () => (phase === 'checkpoint' && round ? fire(round, pick) : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const angle = round?.angle ?? 0;
  const size = live ? pick : turn;
  const over = phase === 'over';
  const delta = over || angle >= GOAL ? null : nextTurn(angle, size);
  const planned = live
    ? plan(angle, size).reduce<number[]>((acc, d) => [...acc, (acc[acc.length - 1] ?? angle) + d], [])
    : over
      ? []
      : plan(0, turn).reduce<number[]>((acc, d) => [...acc, (acc[acc.length - 1] ?? 0) + d], []);
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const pPlan = round?.outcome === 'through' ? 1 : round?.outcome === 'absorbed' ? 0 : planChance(angle, size);
  const prize = round?.outcome === 'through' ? cash : round?.outcome === 'absorbed' ? 0 : prizeFor(cash, angle, size);
  const p0 = planChance(0, turn);
  const pNext = delta !== null ? passChance(delta) : 1;
  const busy = phase === 'emitting' || phase === 'firing';

  let status = `Ready · ${planLabel(0, turn)} to 90°`;
  if (phase === 'emitting') status = 'Photon emitted at 0°';
  if (phase === 'firing' && shot) status = `Polarizer at ${shot.from + shot.delta}° · turning ${shot.delta}°`;
  if (phase === 'checkpoint') status = `Checkpoint · photon at ${angle}°, ${GOAL - angle}° to go`;
  if (over && round?.outcome) status = `${OUTCOME_TITLE[round.outcome]} · ${plural(round.path.length + (round.outcome === 'absorbed' ? 1 : 0), 'polarizer')}`;
  const tone = over ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  return (
    <GameLayout
      name="Polarizer"
      accent={ACCENT}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          {live ? (
            <>
              <Label hint="your choice · same value">Next turn</Label>
              <Chips
                label="Next turn"
                options={turnOptions(angle).map((v) => ({ value: v, label: `${v}°`, title: v === GOAL - angle ? 'straight to 90°' : undefined }))}
                value={nextTurn(angle, pick)}
                disabled={phase !== 'checkpoint'}
                onChange={(v) => setPick(v)}
                wrap
              />
            </>
          ) : (
            <>
              <Label hint={<VolBadge level={volatilityOf(turn)} />}>Turn per polarizer</Label>
              <Chips
                label="Turn per polarizer"
                options={TURNS.map((v) => ({ value: v, label: `${v}°` }))}
                value={turn}
                onChange={(v) => change(() => setTurn(v))}
                wrap
              />
            </>
          )}
          <dl className="og-stats">
            <dt>Chance to win</dt>
            <dd>{fmtChance(live ? pPlan : p0)}</dd>
            <dt>Prize</dt>
            <dd>{fmtMult(live ? prize : RTP / p0)}</dd>
          </dl>

          {phase === 'checkpoint' && round ? (
            <>
              <ActionButton kind="cash" onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" onClick={() => fire(round, pick)}>
                Fire +{nextTurn(angle, pick)}° · {fmtChance(pNext)} pass
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
              {phase === 'emitting' ? 'Emitting…' : phase === 'firing' ? 'Firing…' : over ? 'Bet again' : 'Bet'}
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
            label: 'Reach 90°',
            value: fmtChance(live || over ? pPlan : p0),
            sub: live && angle < GOAL ? `plan ${planLabel(angle, size)}` : over ? `photon at ${angle}°` : `plan ${planLabel(0, turn)}`,
            tone: 'chance',
          },
          { label: 'Cash out now', value: live || over ? fmtMult(cash) : '—', sub: live || over ? formatAmount(stake * cash, 2) : 'after each polarizer', tone: 'cash' },
          {
            label: 'Prize at 90°',
            value: round?.outcome === 'absorbed' ? '—' : fmtMult(live || over ? prize : RTP / p0),
            sub: live ? 'for this plan' : round?.outcome === 'absorbed' ? 'absorbed' : formatAmount(stake * (over ? prize : RTP / p0), 2),
            tone: 'prize',
          },
        ]}
      />

      <Board>
        <Field
          angle={angle}
          delta={busy && shot ? shot.delta : delta}
          path={round?.path ?? []}
          planned={phase === 'firing' ? [] : planned}
          shot={shot}
          outcome={over ? round?.outcome ?? null : null}
          live={live || over}
          roundKey={round?.id ?? 0}
          dropMs={dropMs}
          turnMs={turnMs}
        />
        {over && round?.outcome && (
          <RoundOver
            key={history[0]?.id}
            title={OUTCOME_TITLE[round.outcome]}
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
          p={phase === 'emitting' ? passChance(nextTurn(0, pick)) : pNext}
          label={`Next polarizer passes (+${delta ?? 0}°)`}
          note="cos²Δ: the green shadow of the photon on the new axis, squared, is the green part of the bar."
        />
      ) : (
        <Caption>
          Malus: each polarizer passes the photon with chance cos²Δ. Quantum Zeno: {planLabel(0, turn)} gets through {fmtChance(p0)} of the time,{' '}
          {turn === 5 ? `2 × 45° only ${fmtChance(zeno(2))}` : `18 × 5° gets through ${fmtChance(zeno(18))}`}, and one 90° polarizer never does. RTP{' '}
          {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Polarizer" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              A photon leaves the source polarised at 0°. Turn its polarisation to <b style={{ color: 'var(--gold)' }}>90°</b> by sending it through
              polarizers, each set a little further round. If one absorbs it, the round is lost.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick a turn per polarizer and bet. The photon is emitted at 0°.</li>
              <li>
                At every checkpoint you can cash out (C), or fire the next polarizer (Space). You may change the next turn at any checkpoint, from 5° up to
                whatever is left to 90° (never more than 85° at once).
              </li>
              <li>Reaching 90° pays out automatically.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The white arrow is the photon's polarisation. The <b style={{ color: ACCENT }}>dashed line</b> is the next polarizer's axis, Δ degrees further
              round. Drop a perpendicular from the arrow's tip onto that axis: the <b style={{ color: 'var(--green)' }}>green shadow</b> has length cos Δ.
              Its square is the chance the photon passes, drawn as the <b style={{ color: 'var(--green)' }}>green part of the bar</b>. When the polarizer
              fires, a marker drops to a random height on the bar: on green the photon passes and turns to the new axis, on red it is absorbed.
            </p>
            <p>The hollow dots on the dial are the polarizers still to come in your plan; the readout above the board multiplies their chances.</p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Malus's law: light polarised at angle θ passes a polarizer at θ + Δ with probability <b>cos²Δ</b>, and leaves polarised along the new axis.
              One polarizer at 90° blocks everything, but n polarizers of 90°/n each pass the photon with probability
            </p>
            <p>
              <b>cos²ⁿ(90°/n) → 1 as n → ∞</b>
            </p>
            <p>
              That is the quantum Zeno effect: watch a state often enough and you can drag it anywhere. 2 × 45° passes 25%, 3 × 30° passes{' '}
              {fmtChance(zeno(3))}, 18 × 5° passes {fmtChance(zeno(18))}.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Passing a polarizer turned by Δ multiplies your cash-out by 1/cos²Δ, starting from {(RTP * 100).toFixed(0)}% of your stake. Each polarizer is
              therefore a fair bet: cos²Δ × (1/cos²Δ) = 1. Whatever turns you choose and whenever you cash out, the round is worth {(RTP * 100).toFixed(0)}%
              of your stake; big turns only trade a lower chance for a bigger prize. The prize shown is your cash-out divided by the plan's chance. The
              largest possible payout is 85° then 5°, {fmtMult(MAX_MULTIPLIER)}.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
