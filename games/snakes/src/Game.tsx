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
  useAutoBet,
  useBetInput,
  useHistory,
  useHotkeys,
  useTicket,
  useTimers,
  useTurbo,
} from '@originals/game-sdk/ui';
import { useEffect, useRef, useState } from 'react';
import SnakeBoard, { type BoardMode } from './Board';
import {
  DIFFICULTIES,
  DIFFICULTY_LABEL,
  MAX_WIN,
  PATTERNS,
  RTP,
  VOLATILITY_OF,
  canRoll,
  drawDice,
  maxFactor,
  resolveRoll,
  safeFactors,
  snakeChance,
  snakeCount,
  survival,
  type Difficulty,
  type Roll,
} from './math';
import { runAutoRound, type AutoOutcome } from './round';

type Phase = 'idle' | 'rolling' | 'checkpoint' | 'over';
type Outcome = 'bitten' | 'cashed' | 'max';

interface Round {
  d: Difficulty;
  stake: number;
  /** Square the token rests on. */
  pos: number;
  cash: number;
  rolls: Roll[];
  outcome: Outcome | null;
  auto: boolean;
}

interface LastAuto {
  id: number;
  multiplier: number;
  stake: number;
}

const OUTCOME_TITLE: Record<Outcome, string> = { bitten: 'Snake bite!', cashed: 'Cashed out', max: 'Max win reached' };
const AUTO_OUTCOME: Record<AutoOutcome, Outcome> = { bitten: 'bitten', rolls: 'cashed', target: 'cashed', max: 'max' };
const MAX_AUTO_ROLLS = 10;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);

  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [autoRolls, setAutoRolls] = useState(3);
  const [autoTarget, setAutoTarget] = useState(0);
  const [targetText, setTargetText] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRoundState] = useState<Round | null>(null);
  const [token, setToken] = useState(0);
  const [dice, setDice] = useState<[number, number]>([3, 4]);
  const [tumble, setTumble] = useState({ on: false, frame: 0 });
  const [landed, setLanded] = useState<{ square: number; id: number } | null>(null);
  const [lastAuto, setLastAuto] = useState<LastAuto | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const roundRef = useRef<Round | null>(null);
  const busy = useRef(false);
  const seq = useRef(0);

  const setRound = (r: Round | null) => {
    roundRef.current = r;
    setRoundState(r);
  };

  // A roll is decided before it animates; while it plays the ticket is worth
  // the resolved value, so leaving mid-roll can't dodge a snake.
  const fair = useRef(0);
  const ticket = useTicket(() => fair.current);

  const tumbleMs = turbo.turbo ? 120 : 480;
  const hopMs = turbo.turbo ? 32 : 105;
  const landMs = turbo.turbo ? 90 : 340;

  function finish(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setPhase('over');
    if (r.auto) setLastAuto({ id: ++seq.current, multiplier: cash, stake: r.stake });
  }

  /** Draws one roll: dice tumble, the token hops, the square flashes. Resolves false if the game was left mid-animation. */
  async function animate(roll: Roll, index: number): Promise<boolean> {
    fair.current = roll.cash;
    setPhase('rolling');
    setLanded(null);
    const frames = 4;
    for (let f = 0; f < frames; f++) {
      // Cosmetic faces while the dice tumble; the last frame shows the real roll.
      setDice([((roll.dice[0] + 2 * f + index) % 6) + 1, ((roll.dice[1] + 3 * f + 1) % 6) + 1]);
      setTumble({ on: true, frame: f });
      if (!(await timers.wait(tumbleMs / frames))) return false;
    }
    setDice(roll.dice);
    setTumble((t) => ({ on: false, frame: t.frame }));
    for (let i = 1; i <= roll.sum; i++) {
      setToken((roll.from + i) % 12);
      if (!(await timers.wait(hopMs))) return false;
    }
    const r = roundRef.current!;
    setRound({ ...r, pos: roll.to, cash: roll.snake ? r.cash : roll.cash, rolls: [...r.rolls, roll] });
    setLanded({ square: roll.to, id: ++seq.current });
    return timers.wait(landMs);
  }

  function newRound(stake: number, auto: boolean): Round {
    const r: Round = { d: difficulty, stake, pos: 0, cash: RTP, rolls: [], outcome: null, auto };
    timers.clearAll();
    fair.current = RTP;
    setLastAuto(null);
    setLanded(null);
    setToken(0);
    setRound(r);
    return r;
  }

  /** Manual: one roll, then a checkpoint (or the end of the round). */
  async function rollOnce() {
    const r = roundRef.current;
    if (!r || busy.current || r.outcome) return;
    busy.current = true;
    const [a, b] = drawDice(rng);
    const roll = resolveRoll(r.d, r.pos, r.cash, a, b);
    const ok = await animate(roll, r.rolls.length);
    busy.current = false;
    if (!ok) return;
    const now = roundRef.current!;
    if (roll.snake) return finish(now, 'bitten', 0);
    if (!canRoll(now.d, now.cash)) return finish(now, 'max', now.cash);
    setPhase('checkpoint');
    track({ type: 'checkpoint', multiplier: now.cash, winChance: 1 - snakeChance(now.d) });
  }

  /** Bet: places the stake and makes the first roll. */
  async function start() {
    if (phase === 'rolling' || phase === 'checkpoint' || busy.current || bet.blocked || auto.running) return;
    busy.current = true;
    const placed = await ticket.place(bet.value);
    busy.current = false;
    if (!placed) return;
    newRound(bet.value, false);
    await rollOnce();
  }

  function cashOut() {
    const r = roundRef.current;
    if (phase !== 'checkpoint' || !r || busy.current || r.rolls.length < 1) return;
    finish(r, 'cashed', r.cash);
  }

  function clear() {
    if (phase === 'rolling' || phase === 'checkpoint') return;
    timers.clearAll();
    setRound(null);
    setLastAuto(null);
    setLanded(null);
    setToken(0);
    setPhase('idle');
  }

  // Auto: one whole round per bet, cashing out after the planned rolls or at the target.
  async function playAuto(stake: number): Promise<number | null> {
    if (!(await ticket.place(stake))) return null;
    const r = newRound(stake, true);
    return runAutoRound({
      d: r.d,
      rule: { rolls: autoRolls, target: autoTarget },
      dice: () => drawDice(rng),
      animate,
      settle: (m, outcome) => finish(roundRef.current!, AUTO_OUTCOME[outcome], m),
    });
  }

  const auto = useAutoBet({ bet, play: playAuto, turbo: turbo.turbo });
  const live = phase === 'rolling' || phase === 'checkpoint';
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
        if (phase === 'checkpoint') return void rollOnce();
        if (!live) void start();
      },
      cashOut,
    },
    !infoOpen,
  );

  // Keep the target text in step when it is set elsewhere (e.g. cleared).
  useEffect(() => setTargetText(autoTarget > 0 ? autoTarget.toFixed(2) : ''), [autoTarget]);

  // What the board shows: the live or finished round, else a preview of the settings.
  const d = round?.d ?? difficulty;
  const q = snakeChance(d);
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const rolls = round?.rolls ?? [];
  const outcome = round?.outcome ?? null;
  const lastRoll = rolls[rolls.length - 1];
  const top = maxFactor(d);
  const safe = safeFactors(difficulty);
  const n = snakeCount(d);

  const mode: BoardMode = outcome === 'bitten' ? 'bitten' : outcome ? 'cashed' : live ? 'live' : 'idle';
  const valueLabel =
    outcome === 'bitten' ? 'BITTEN' : outcome ? 'CASHED OUT' : phase === 'checkpoint' ? 'CASH OUT NOW' : phase === 'rolling' ? 'ROLLING' : 'STARTS AT';
  let footer = 'Each opposite pair: 1 in 6';
  if (rolls.length > 0) footer = `Roll ${rolls.length} · rolled ${lastRoll.sum}`;
  if (phase === 'rolling' && !landed) footer = tumble.on ? 'Rolling…' : `Moving ${dice[0] + dice[1]} squares`;

  let status = `Ready · ${plural(n, 'snake')} on 12 squares`;
  if (phase === 'rolling') status = `Roll ${rolls.length + 1}…`;
  if (phase === 'checkpoint') status = `Roll ${rolls.length} survived · ${fmtMult(cash)}`;
  if (phase === 'over' && outcome === 'bitten') status = `Bitten on roll ${rolls.length}`;
  if (phase === 'over' && outcome === 'cashed') status = `Cashed out after ${plural(rolls.length, 'roll')}`;
  if (phase === 'over' && outcome === 'max') status = `Max win · ${plural(rolls.length, 'roll')}`;
  const tone = phase === 'over' ? (cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  const showRoundOver = phase === 'over' && outcome !== null && round && !round.auto;
  const autoChance = survival(difficulty, autoRolls);

  return (
    <GameLayout
      name="Snakes"
      accent="#4ade80"
      panel={
        <>
          <ModeTabs auto={auto} disabled={live} />
          <BetField bet={bet} disabled={locked} />

          <Label hint={<VolBadge level={VOLATILITY_OF[difficulty]} />}>Difficulty</Label>
          <Chips
            label="Difficulty"
            options={DIFFICULTIES.map((x) => ({ value: x, label: DIFFICULTY_LABEL[x], title: `${plural(snakeCount(x), 'snake')} on 12 squares` }))}
            value={difficulty}
            disabled={locked}
            onChange={(v) => change(() => setDifficulty(v))}
          />
          <dl className="og-stats">
            {auto.mode === 'manual' && (
              <>
            <dt>Snakes</dt>
            <dd>{snakeCount(difficulty)} of 12</dd>
            <dt>Each roll safe</dt>
            <dd>{fmtChance(1 - snakeChance(difficulty))}</dd>
            <dt>Safe squares</dt>
            <dd>
              {safe[0].toFixed(2)}–{safe[safe.length - 1].toFixed(2)}×
            </dd>
            <dt>Max win</dt>
            <dd>{fmtMult(MAX_WIN)}</dd>
              </>
            )}
            {auto.mode === 'auto' && (
              <>
                <dt>Each roll safe</dt>
                <dd>{fmtChance(1 - snakeChance(difficulty))}</dd>
              </>
            )}
          </dl>

          {auto.mode === 'manual' ? (
            phase === 'checkpoint' || (phase === 'rolling' && rolls.length > 0) ? (
              <>
                <ActionButton kind="cash" disabled={phase !== 'checkpoint'} onClick={cashOut}>
                  Cash out <span>{formatAmount(stake * cash, 2)}</span>
                </ActionButton>
                <ActionButton kind="secondary" className="snk-roll-btn" disabled={phase !== 'checkpoint'} onClick={() => void rollOnce()}>
                  {phase === 'rolling' ? (
                    'Rolling…'
                  ) : (
                    <>
                      Roll dice <small>{fmtChance(1 - q)} safe · up to {fmtMult(cash * top)}</small>
                    </>
                  )}
                </ActionButton>
              </>
            ) : (
              <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
                {phase === 'rolling' ? 'Rolling…' : phase === 'over' ? 'Bet again' : 'Bet'}
              </ActionButton>
            )
          ) : (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || live}>
              <Label hint={<span className="snk-auto-hint">all safe: {fmtChance(autoChance)}</span>}>Rolls per bet</Label>
              <div className="snk-stepper">
                <button type="button" aria-label="One roll fewer" disabled={auto.running || autoRolls <= 1} onClick={() => change(() => setAutoRolls(autoRolls - 1))}>
                  −
                </button>
                <Slider label="Rolls per bet" min={1} max={MAX_AUTO_ROLLS} value={autoRolls} disabled={auto.running} onChange={(v) => change(() => setAutoRolls(v))} />
                <button
                  type="button"
                  aria-label="One roll more"
                  disabled={auto.running || autoRolls >= MAX_AUTO_ROLLS}
                  onClick={() => change(() => setAutoRolls(autoRolls + 1))}
                >
                  +
                </button>
                <b>{autoRolls}</b>
              </div>
              <Label hint="optional, stops earlier">Cash out at</Label>
              <div className="og-num-field">
                <input
                  value={targetText}
                  inputMode="decimal"
                  aria-label="Cash out at multiplier"
                  placeholder="off"
                  disabled={auto.running}
                  onChange={(e) => setTargetText(e.target.value)}
                  onBlur={() => {
                    const v = parseFloat(targetText);
                    const next = Number.isFinite(v) && v > 1 ? Math.min(MAX_WIN, Math.round(v * 100) / 100) : 0;
                    setAutoTarget(next);
                    setTargetText(next > 0 ? next.toFixed(2) : '');
                  }}
                />
                <span className="og-num-suffix">×</span>
              </div>
            </AutoBetControls>
          )}
          {bet.blocked && !live && <p className="snk-blocked">{bet.blocked}</p>}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />

      <Readouts
        items={[
          { label: 'Next roll safe', value: phase === 'over' ? '—' : fmtChance(1 - q), sub: `${n} snakes of 12`, tone: 'chance' },
          {
            label: 'Cash out now',
            value: rolls.length > 0 && outcome !== 'bitten' ? fmtMult(cash) : outcome === 'bitten' ? fmtMult(0) : '—',
            sub: rolls.length > 0 ? formatAmount(stake * (outcome === 'bitten' ? 0 : cash), 2) : 'after the first roll',
            tone: 'cash',
          },
          {
            label: 'Best next square',
            value: phase === 'over' ? fmtMult(top) : fmtMult(cash * top),
            sub: phase === 'over' ? 'top square' : `${top.toFixed(2)}× · 1 in 6`,
            tone: 'prize',
          },
        ]}
      />

      <Board className={'snk-board' + (auto.mode === 'auto' ? ' auto' : '')}>
        {auto.mode === 'auto' && lastAuto && <InstantResult multiplier={lastAuto.multiplier} stake={lastAuto.stake} id={lastAuto.id} />}
        <div className="snk-scene">
          <SnakeBoard
            d={d}
            token={token}
            from={round?.pos ?? 0}
            showOdds={phase !== 'over'}
            mode={mode}
            hopMs={hopMs}
            dice={dice}
            tumbling={tumble.on}
            frame={tumble.frame}
            landed={landed}
            value={outcome === 'bitten' ? 0 : cash}
            valueLabel={valueLabel}
            footer={footer}
          />
          <div className="snk-log" aria-label="Rolls this round">
            {rolls.length === 0 ? (
              <span className="snk-log-empty">{round ? 'First roll…' : 'Your rolls this round appear here'}</span>
            ) : (
              rolls.map((r, i) => (
                <span key={i} className={'snk-chip ' + (r.snake ? 'bad' : r.factor >= 1 ? 'up' : 'down')}>
                  <i>{r.sum}</i>
                  {r.snake ? 'snake' : `${r.factor.toFixed(2)}×`}
                </span>
              ))
            )}
          </div>
        </div>
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
      </Board>

      {live ? (
        <ChanceBar
          p={1 - q}
          label="Next roll misses every snake"
          note={`Two dice land on each pair of opposite squares exactly 1 time in 6, from any square. ${n / 2} of the 6 pairs hold snakes.`}
        />
      ) : (
        <Caption>
          Opposite squares always match, and two dice land on each opposite pair exactly 1 time in 6, so every roll multiplies your value by 1 on average.
          The dots on a square count its 36ths. RTP {(RTP * 100).toFixed(0)}%.
        </Caption>
      )}

      {infoOpen && (
        <InfoModal title="Snakes" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>Roll two dice to move round a 12-square loop. Every square you land on multiplies your value; land on a snake and the round is lost. Cash out whenever you like between rolls.</p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick a difficulty: Easy has 2 snakes, Medium 4, Hard 6, Expert 8, Master 10. More snakes, bigger squares.</li>
              <li>Press Bet (or Space). Your value starts at {RTP.toFixed(2)}× and the first roll happens straight away.</li>
              <li>The token moves forward by the dice total and your value is multiplied by the square it lands on.</li>
              <li>After each safe roll, press Roll dice (Space) to go on, or Cash out (C) to take the value shown.</li>
              <li>Auto plays a series of bets, each rolling a set number of times (or until your cash-out target) and cashing out. Space starts or stops it.</li>
              <li>After a round, Bet again (Space) replays it and Clear board (Esc) resets the board. Changing the difficulty also clears it.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The six dots on each square count how many of the 36 dice combinations land there from where the token stands; the square right after the
              token can never be hit. Opposite squares always hold the same thing and their dots always add up to 6, so each pair is hit exactly 1 time in 6.
              The chance of a <b style={{ color: 'var(--red)' }}>snake</b> on the next roll is the number of snake pairs ÷ 6, wherever you are.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              One die is uniform modulo 6, so the total of two dice is uniform modulo 6 too: from any square, each pair of opposite squares (i and i + 6) is
              reached with chance exactly 1/6. Each board is six values averaging 1, repeated round the loop, so every roll has an expected factor of exactly
              1. (This is also the only way a fixed 12-square board can be fair from every square: the circulant system Σ P(s)·f(p + s) = 1 forces opposite
              squares to match.)
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              The round starts at {RTP}× and is multiplied by each square you land on, so your cash-out is a martingale: whenever and however you stop, the
              round returns {(RTP * 100).toFixed(0)}% of your stake. The edge is applied once, not per roll. A roll is only offered while its best square keeps
              you within {fmtMult(MAX_WIN)}; past that the round cashes out by itself.
            </p>
            <p className="snk-boards">
              {DIFFICULTIES.map((x) => (
                <span key={x}>
                  <b>{DIFFICULTY_LABEL[x]}</b> {PATTERNS[x].map((v) => (v === 0 ? 'snake' : (v / 100).toFixed(2) + '×')).join(' · ')}
                </span>
              ))}
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
