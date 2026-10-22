import { formatAmount } from '@originals/game-sdk';
import { useHost } from '@originals/game-sdk/react';
import {
  ActionButton,
  AutoBetControls,
  BetField,
  Board,
  Caption,
  ChanceBar,
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
  fmtChance,
  fmtMult,
  fmtOneIn,
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
  survival,
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
  const [tick, setTick] = useState(0);
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

  const pumpMs = turbo.turbo ? 150 : 560;
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
    setTick((t) => t + 1);
    setRound(step.kind === 'safe' ? { ...r, k: step.pump, cash: step.cash } : { ...r, popping: true });
    return timers.wait(pumpMs);
  }

  function newRound(stake: number, auto: boolean): Round {
    const r: Round = { d, stake, positions: drawPositions(rng, d), k: 0, cash: RTP, popping: false, outcome: null, auto };
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

  const rungState = (i: number): RungState => {
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

  const showRoundOver = phase === 'over' && outcome !== null && round && !round.auto;
  const pumpLabel = q > 0 ? `${fmtChance(1 - q)} safe` : '';

  return (
    <GameLayout
      name="Pump"
      accent="#38bdf8"
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
            <dt>First pump safe</dt>
            <dd>{fmtChance(1 - d / POSITIONS)}</dd>
            <dt>Top prize ({top} pumps)</dt>
            <dd>{fmtMult(multiplier(d, top))}</dd>
          </dl>

          {auto.mode === 'manual' ? (
            phase === 'checkpoint' || (phase === 'pumping' && k > 0) ? (
              <>
                <ActionButton kind="cash" disabled={phase !== 'checkpoint'} onClick={cashOut}>
                  Cash out <span>{formatAmount(stake * cash, 2)}</span>
                </ActionButton>
                <ActionButton kind="secondary" className="pump-btn" disabled={phase !== 'checkpoint'} onClick={() => void pumpOnce()}>
                  {phase === 'pumping' ? 'Pumping…' : <>Pump <small>{fmtMult(multiplier(rd, k + 1))} · {pumpLabel}</small></>}
                </ActionButton>
              </>
            ) : (
              <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
                {phase === 'pumping' ? 'Pumping…' : phase === 'over' ? 'Bet again' : 'Bet'}
              </ActionButton>
            )
          ) : (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || live}>
              <Label hint={<span className="pump-auto-hint">pays <b>{fmtMult(multiplier(d, target))}</b> · {fmtChance(survival(d, target))}</span>}>
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
          {
            label: 'Next pump safe',
            value: phase === 'over' ? '—' : fmtChance(1 - q),
            sub: phase === 'over' ? `${plural(k, 'safe pump')}` : `${plural(rd, 'pop')} in ${POSITIONS - k} left`,
            tone: 'chance',
          },
          { label: 'Cash out now', value: k > 0 ? fmtMult(cash) : '—', sub: k > 0 ? formatAmount(stake * cash, 2) : 'after the first pump', tone: 'cash' },
          {
            label: phase === 'over' ? 'Top of the ladder' : 'Next pump pays',
            value: phase === 'over' || k >= rTop ? fmtMult(rungs[rTop - 1]) : fmtMult(rungs[k]),
            sub: phase === 'over' ? `${rTop} pumps` : `pump ${Math.min(k + 1, rTop)} of ${rTop}`,
            tone: 'prize',
          },
        ]}
      />

      <Board className="pump-board">
        {auto.mode === 'auto' && lastAuto && <InstantResult multiplier={lastAuto.multiplier} stake={lastAuto.stake} id={lastAuto.id} />}
        <div className="pump-scene">
          <Balloon fill={k / rTop} state={balloonState} q={phase === 'over' ? 0 : q} label={k > 0 ? cash : null} tick={tick} pumpMs={pumpMs} />
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
              placement="center"
            />
          )}
        </div>
        <Ladder rungs={rungs} state={rungState} focus={focus} target={auto.mode === 'auto' && !live ? target - 1 : null} />
      </Board>

      {live ? (
        <ChanceBar p={1 - q} label="Next pump is safe" note={`${plural(rd, 'pop')} hide among the ${POSITIONS - k} positions left, so the next pump pops ${rd} times in ${POSITIONS - k}: the red share of the gauge.`} />
      ) : phase === 'over' && outcome === 'cashed' ? (
        <Caption>
          {popAt <= rTop ? `This balloon would have popped on pump ${popAt} (${fmtMult(rungs[popAt - 1])} was out of reach).` : 'This balloon would have made it all the way.'}{' '}
          The pops were fixed when you bet.
        </Caption>
      ) : (
        <Caption>
          {plural(d, 'pop')} hide among {POSITIONS} pump positions. After k safe pumps you can cash out {RTP} × C(25, k) / C({POSITIONS - d}, k). Pumping
          all {top} pays {fmtMult(multiplier(d, top))} ({fmtOneIn(survival(d, top))}). RTP {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

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
              The <b style={{ color: 'var(--red)' }}>red share of the gauge</b> is the exact chance the next pump pops: the pops still hidden divided by the
              positions left. It grows as you pump, which is why the ladder steps grow too. The ladder under the balloon lists every rung you can reach.
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
