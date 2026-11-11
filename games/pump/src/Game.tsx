import { formatAmount } from '@originals/game-sdk';
import { useHost } from '@originals/game-sdk/react';
import {
  ActionButton,
  AutoBetControls,
  BetField,
  ACCENTS,
  Board,
  Caption,
  Chips,
  GameLayout,
  InfoModal,
  InfoSection,
  InstantResult,
  Label,
  ModeTabs,
  PanelFoot,
  Readouts,
  RoundOver,
  Slider,
  StageTop,
  VolBadge,
  eventMs,
  fmtChance,
  fmtMult,
  useAutoBet,
  useBetInput,
  useHistory,
  useHotkeys,
  useTicket,
  useTimers,
  useTurbo,
} from '@originals/game-sdk/ui';
import { useRef, useState } from 'react';
import Balloon, { type BalloonState } from './Balloon';
import Ladder, { type RungState } from './Ladder';
import {
  DIFFICULTIES,
  DIFFICULTY_LABEL,
  POPS,
  POSITIONS,
  RTP,
  VOLATILITY_OF,
  drawPositions,
  firstPop,
  ladder,
  maxPumps,
  multiplier,
  popChance,
  type Difficulty,
} from './math';
import { runAutoRound, stepAt, type Step } from './round';

type Phase = 'idle' | 'pumping' | 'checkpoint' | 'over';
type Outcome = 'popped' | 'cashed' | 'max';

interface Round {
  d: number;
  stake: number;
  /** The hidden layout: true = pop position, in pump order. */
  positions: boolean[];
  /** Safe pumps so far. */
  k: number;
  cash: number;
  /** The pump in flight pops (drawn as strain, then the burst). */
  popping: boolean;
  outcome: Outcome | null;
  auto: boolean;
}

interface LastAuto {
  id: number;
  multiplier: number;
  stake: number;
}

const OUTCOME_TITLE: Record<Outcome, string> = { popped: 'Popped!', cashed: 'Cashed out', max: 'Fully pumped' };
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);

  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [autoTarget, setAutoTarget] = useState(5);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRoundState] = useState<Round | null>(null);
  const [lastAuto, setLastAuto] = useState<LastAuto | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const roundRef = useRef<Round | null>(null);
  const busy = useRef(false);
  const autoSeq = useRef(0);

  const setRound = (r: Round | null) => {
    roundRef.current = r;
    setRoundState(r);
  };

  // A pump's outcome is fixed when the bet is placed; while it animates the
  // ticket is worth its resolved value, so leaving mid-pump can't dodge a pop.
  const fair = useRef(0);
  const ticket = useTicket(() => fair.current);

  const pumpMs = eventMs(turbo.turbo); // the circle grows over a readable 600 ms (docs/STYLE.md)
  const d = POPS[difficulty];
  const top = maxPumps(d);
  const target = Math.min(autoTarget, top);

  function finish(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash, popping: false });
    setPhase('over');
    if (r.auto) setLastAuto({ id: ++autoSeq.current, multiplier: cash, stake: r.stake });
  }

  /** Draws one pump. Resolves false if the game was left mid-animation. */
  async function animate(step: Step): Promise<boolean> {
    const r = roundRef.current!;
    fair.current = step.kind === 'safe' ? step.cash : 0;
    setPhase('pumping');
    setRound(step.kind === 'safe' ? { ...r, k: step.pump, cash: step.cash } : { ...r, popping: true });
    return timers.wait(pumpMs);
  }

  function newRound(stake: number, auto: boolean): Round {
    const r: Round = { d, stake, positions: drawPositions(rng, d), k: 0, cash: RTP, popping: false, outcome: null, auto };
    fair.current = RTP; // never carry the last round's cash-out into this ticket
    timers.clearAll();
    setLastAuto(null);
    setRound(r);
    return r;
  }

  /** Manual: one pump, then a checkpoint (or the end of the round). */
  async function pumpOnce() {
    const r = roundRef.current;
    if (!r || busy.current) return;
    busy.current = true;
    const step = stepAt(r.positions, r.d, r.k);
    const ok = await animate(step);
    busy.current = false;
    if (!ok) return;
    const now = roundRef.current!;
    if (step.kind === 'pop') return finish(now, 'popped', 0);
    if (now.k >= maxPumps(now.d)) return finish(now, 'max', now.cash);
    setPhase('checkpoint');
    track({ type: 'checkpoint', multiplier: now.cash, winChance: 1 - popChance(now.d, now.k) });
  }

  /** Bet: places the stake and makes the first pump. */
  async function start() {
    if (phase === 'pumping' || phase === 'checkpoint' || busy.current || bet.blocked || auto.running) return;
    busy.current = true;
    const placed = await ticket.place(bet.value);
    busy.current = false;
    if (!placed) return;
    newRound(bet.value, false);
    await pumpOnce();
  }

  function cashOut() {
    const r = roundRef.current;
    if (phase !== 'checkpoint' || !r || busy.current || r.k < 1) return;
    finish(r, 'cashed', r.cash);
  }

  function clear() {
    if (phase === 'pumping' || phase === 'checkpoint') return;
    timers.clearAll();
    setRound(null);
    setLastAuto(null);
    setPhase('idle');
  }

  // Auto: one whole round per bet, cashing out after the target pump.
  async function playAuto(stake: number): Promise<number | null> {
    if (!(await ticket.place(stake))) return null;
    const r = newRound(stake, true);
    return runAutoRound({
      positions: r.positions,
      d: r.d,
      target,
      animate,
      settle: (m, step) => finish(roundRef.current!, step.kind === 'pop' ? 'popped' : m >= multiplier(r.d, maxPumps(r.d)) ? 'max' : 'cashed', m),
    });
  }

  const auto = useAutoBet({ bet, play: playAuto, turbo: turbo.turbo });
  const live = phase === 'pumping' || phase === 'checkpoint';
  const locked = live || auto.running;

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    apply();
    if (phase === 'over') clear();
  };

  useHotkeys(
    {
      space: () => {
        if (auto.mode === 'auto') return auto.running ? auto.stop() : !bet.blocked && !live ? auto.start() : undefined;
        if (phase === 'checkpoint') return void pumpOnce();
        if (!live) void start();
      },
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const rd = round?.d ?? d;
  const rTop = maxPumps(rd);
  const k = round?.k ?? 0;
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const q = popChance(rd, k);
  const rungs = ladder(rd);
  const outcome = round?.outcome ?? null;
  const popAt = round ? firstPop(round.positions) : 0; // 1-based pump that pops

  let balloonState: BalloonState = 'idle';
  if (live) balloonState = round?.popping ? 'strain' : 'live';
  if (phase === 'over') balloonState = outcome === 'popped' ? 'popped' : outcome === 'max' ? 'max' : 'cashed';

  // The circle swells for a popping pump too; the pop ring then stays at that size.
  const balloonFill = round?.popping || (phase === 'over' && outcome === 'popped') ? Math.min(1, (k + 1) / rTop) : k / rTop;

  const rungState =(i: number): RungState => {
    const pump = i + 1;
    if (pump <= k) return pump === k && phase !== 'idle' ? 'current' : 'passed';
    if (phase === 'over') {
      if (outcome === 'popped') return pump === k + 1 ? 'pop' : 'future';
      if (pump < popAt) return 'ghost';
      return pump === popAt ? 'missed' : 'future';
    }
    if (live && pump === k + 1) return 'next';
    return 'future';
  };
  const focus = phase === 'idle' ? (auto.mode === 'auto' ? target - 1 : 0) : phase === 'over' && outcome !== 'popped' ? Math.min(rTop - 1, popAt - 1, k + 1) : Math.min(rTop - 1, k);

  let status = `Ready · ${plural(d, 'pop')} hidden in ${POSITIONS} positions`;
  if (phase === 'pumping') status = round?.popping ? `Pump ${k + 1}…` : `Pump ${k}…`;
  if (phase === 'checkpoint') status = `Pump ${k} of ${rTop} · ${fmtMult(cash)}`;
  if (phase === 'over' && outcome === 'popped') status = `Popped on pump ${k + 1}`;
  if (phase === 'over' && outcome === 'cashed') status = `Cashed out after ${plural(k, 'pump')}`;
  if (phase === 'over' && outcome === 'max') status = `Fully pumped · ${plural(k, 'pump')}`;
  const tone = phase === 'over' ? (cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  const showRoundOver = phase === 'over' && outcome !== null && round && !round.auto && auto.mode === 'manual';

  return (
    <GameLayout
      name="Pump"
      accent={ACCENTS.sky}
      panel={
        <>
          <ModeTabs auto={auto} disabled={live} />
          <BetField bet={bet} disabled={locked} />

          <Label hint={<VolBadge level={VOLATILITY_OF[difficulty]} />}>Difficulty</Label>
          <Chips
            label="Difficulty"
            options={DIFFICULTIES.map((x) => ({ value: x, label: DIFFICULTY_LABEL[x], title: `${plural(POPS[x], 'pop')} in ${POSITIONS}` }))}
            value={difficulty}
            disabled={locked}
            onChange={(v) => change(() => setDifficulty(v))}
          />
          <dl className="og-stats">
            <dt>Pops</dt>
            <dd>
              {d} of {POSITIONS}
            </dd>
            <dt>Top prize ({top} pumps)</dt>
            <dd>{fmtMult(multiplier(d, top))}</dd>
          </dl>

          {auto.mode === 'manual' ? (
            phase === 'checkpoint' || (phase === 'pumping' && k > 0) ? (
              <div className="pump-actions">
                <ActionButton kind="cash" disabled={phase !== 'checkpoint'} onClick={cashOut}>
                  Cash out <span>{formatAmount(stake * cash, 2)}</span>
                </ActionButton>
                <ActionButton kind="secondary" className="pump-btn" disabled={phase !== 'checkpoint'} onClick={() => void pumpOnce()}>
                  {phase === 'pumping' ? 'Pumping…' : <>Pump <small>{fmtMult(multiplier(rd, k + 1))}</small></>}
                </ActionButton>
              </div>
            ) : (
              <div className="pump-actions">
                <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
                  {phase === 'pumping' ? 'Pumping…' : phase === 'over' ? 'Bet again' : 'Bet'}
                </ActionButton>
              </div>
            )
          ) : (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || live}>
              <Label hint={<span className="pump-auto-hint">pays <b>{fmtMult(multiplier(d, target))}</b></span>}>
                Pumps per bet
              </Label>
              <div className="pump-target">
                <button type="button" aria-label="One pump fewer" disabled={auto.running || target <= 1} onClick={() => change(() => setAutoTarget(Math.max(1, target - 1)))}>
                  −
                </button>
                <Slider label="Pumps per bet" min={1} max={top} value={target} disabled={auto.running} onChange={(v) => change(() => setAutoTarget(v))} />
                <button type="button" aria-label="One pump more" disabled={auto.running || target >= top} onClick={() => change(() => setAutoTarget(Math.min(top, target + 1)))}>
                  +
                </button>
                <b>{target}</b>
              </div>
            </AutoBetControls>
          )}
          {bet.blocked && !live && <p className="pump-blocked">{bet.blocked}</p>}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />

      <Readouts
        items={[
          { label: 'Next pump safe', value: phase === 'over' ? '—' : fmtChance(1 - q), tone: 'chance' },
          phase === 'over'
            ? { label: 'Payout', value: fmtMult(cash), tone: 'cash' as const }
            : { label: 'Next pump pays', value: k >= rTop ? fmtMult(rungs[rTop - 1]) : fmtMult(rungs[k]), tone: 'prize' as const },
        ]}
      />

      <Board className="pump-board">
        {auto.mode === 'auto' && lastAuto && <InstantResult multiplier={lastAuto.multiplier} stake={lastAuto.stake} id={lastAuto.id} />}
        <div className="pump-scene">
          <Balloon fill={balloonFill} state={balloonState} label={k > 0 ? cash : null} pumpMs={pumpMs} />
        </div>
        <Ladder rungs={rungs} state={rungState} focus={focus} target={auto.mode === 'auto' && !live ? target - 1 : null} />
      </Board>

      {showRoundOver && (
        <RoundOver
          key={history[0]?.id}
          title={OUTCOME_TITLE[outcome!]}
          multiplier={cash}
          stake={round!.stake}
          nextBet={bet.value}
          blocked={bet.blocked}
          onBetAgain={() => void start()}
          onClear={clear}
          placement="inline"
        />
      )}
      <Caption>Pump as far as you dare and cash out before the balloon pops.</Caption>

      {infoOpen && (
        <InfoModal title="Pump" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>Pump the balloon as far as you dare. Every safe pump raises the multiplier; cash out before the balloon pops.</p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick a difficulty: Easy hides 1 pop among the 25 pump positions, Medium 3, Hard 5, Expert 10.</li>
              <li>Press Bet (or Space). The first pump happens straight away.</li>
              <li>After each safe pump, press Pump (Space) to go on or Cash out (C) to take the multiplier shown.</li>
              <li>Use every safe position and the round cashes out at the top of the ladder automatically.</li>
              <li>Auto plays a series of bets, each pumping a set number of times and cashing out. Space starts or stops it.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The chance the next pump pops is the pops still hidden divided by the positions left, and the board shows its complement as "Next pump safe". It
              grows as you pump, which is why the ladder steps grow too. The ladder under the balloon lists every rung you can reach. A pop leaves a red ring
              where the balloon was, and the ladder marks the pump that popped.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              The d pops sit at a uniformly random set of the 25 positions, so the first k pumps are all safe with chance C(25 − d, k) / C(25, k). The cash-out
              after k safe pumps is {RTP} × C(25, k) / C(25 − d, k), the inverse of that chance times the RTP.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Each pump that survives a pop chance q multiplies the cash-out by exactly 1 / (1 − q), so every pump is a fair bet and the round returns{' '}
              {(RTP * 100).toFixed(0)}% however far you go. Top prizes: Easy {fmtMult(multiplier(1, 24))}, Medium {fmtMult(multiplier(3, 22))}, Hard{' '}
              {fmtMult(multiplier(5, 20))}, Expert {fmtMult(multiplier(10, 15))}. The pop positions are drawn when you bet; after a cash-out the ladder shows
              where the balloon would have popped.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
