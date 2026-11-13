import { formatAmount } from '@originals/game-sdk';
import { useHost } from '@originals/game-sdk/react';
import {
  ACCENTS,
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
  eventMs,
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
  MAX_MULTIPLIER,
  MAX_ROLLS,
  MAX_WIN,
  RTP,
  TABLES,
  VOLATILITY_OF,
  canRoll,
  drawDice,
  maxFactor,
  pitChance,
  pitCount,
  resolveRoll,
  safeWays,
  type Difficulty,
  type Roll,
} from './math';
import { runAutoRound, type AutoOutcome } from './round';

type Phase = 'idle' | 'rolling' | 'checkpoint' | 'over';
type Outcome = 'pit' | 'cashed' | 'max' | 'last';

interface Round {
  d: Difficulty;
  stake: number;
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

const OUTCOME_TITLE: Record<Outcome, string> = { pit: 'Pit hit', cashed: 'Cashed out', max: 'Max win reached', last: 'Five rolls done' };
const AUTO_OUTCOME: Record<AutoOutcome, Outcome> = { pit: 'pit', rolls: 'last', target: 'cashed', max: 'max' };

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

  const tumbleMs = eventMs(turbo.turbo, 300);
  const hopMs = eventMs(turbo.turbo, 120);
  const landMs = eventMs(turbo.turbo, 300);

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
    // The token returns to Start between rolls, then hops tile by tile to the landed one.
    setToken(0);
    const frames = 4;
    for (let f = 0; f < frames; f++) {
      // Cosmetic faces while the dice tumble; the last frame shows the real roll.
      setDice([((roll.dice[0] + 2 * f + index) % 6) + 1, ((roll.dice[1] + 3 * f + 1) % 6) + 1]);
      setTumble({ on: true, frame: f });
      if (!(await timers.wait(tumbleMs / frames))) return false;
    }
    setDice(roll.dice);
    setTumble((t) => ({ on: false, frame: t.frame }));
    for (let i = 1; i <= roll.to; i++) {
      setToken(i);
      if (!(await timers.wait(hopMs))) return false;
    }
    const r = roundRef.current!;
    setRound({ ...r, cash: roll.pit ? r.cash : roll.cash, rolls: [...r.rolls, roll] });
    setLanded({ square: roll.to, id: ++seq.current });
    return timers.wait(landMs);
  }

  function newRound(stake: number, auto: boolean): Round {
    const r: Round = { d: difficulty, stake, cash: RTP, rolls: [], outcome: null, auto };
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
    const roll = resolveRoll(r.d, r.cash, a, b);
    const ok = await animate(roll, r.rolls.length);
    busy.current = false;
    if (!ok) return;
    const now = roundRef.current!;
    if (roll.pit) return finish(now, 'pit', 0);
    if (now.rolls.length >= MAX_ROLLS) return finish(now, 'last', now.cash);
    if (!canRoll(now.d, now.cash)) return finish(now, 'max', now.cash);
    setPhase('checkpoint');
    track({ type: 'checkpoint', multiplier: now.cash, winChance: 1 - pitChance(now.d) });
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

  // Switching between Manual and Auto clears a finished board, so a manual
  // result card never lingers over the Auto panel (or vice versa).
  useEffect(() => {
    if (phase === 'over') clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto.mode]);

  // Keep the target text in step when it is set elsewhere (e.g. cleared).
  useEffect(() => setTargetText(autoTarget > 0 ? autoTarget.toFixed(2) : ''), [autoTarget]);

  // What the board shows: the live or finished round, else a preview of the settings.
  const d = round?.d ?? difficulty;
  const q = pitChance(d);
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const rolls = round?.rolls ?? [];
  const outcome = round?.outcome ?? null;
  const lastRoll = rolls[rolls.length - 1];
  // A pit shows the moment the token lands on it, not only once the round settles.
  const bitten = outcome === 'pit' || (phase === 'rolling' && !!landed && !!lastRoll?.pit);
  const top = maxFactor(d);
  const n = pitCount(d);

  const mode: BoardMode = bitten ? 'bitten' : outcome ? (cash > 1 ? 'cashed' : 'returned') : live ? 'live' : 'idle';
  const valueLabel =
    bitten ? 'Pit hit' : outcome ? 'Cashed out' : phase === 'checkpoint' ? 'Value' : phase === 'rolling' ? 'Rolling' : 'Starts at';
  let footer = 'Roll two dice';
  if (rolls.length > 0) footer = `Roll ${rolls.length} of ${MAX_ROLLS}: ${lastRoll.sum}`;
  if (phase === 'rolling' && !landed) footer = tumble.on ? 'Rolling…' : `Total ${dice[0] + dice[1]}`;

  let status = `Ready · ${plural(n, 'pit')} of 11 tiles`;
  if (phase === 'rolling') status = landed ? (bitten ? `Pit on roll ${rolls.length}!` : `Roll ${rolls.length} · ${fmtMult(cash)}`) : `Roll ${rolls.length + 1}…`;
  if (phase === 'checkpoint') status = `Roll ${rolls.length} survived · ${fmtMult(cash)}`;
  if (phase === 'over' && outcome === 'pit') status = `Pit on roll ${rolls.length}`;
  if (phase === 'over' && outcome === 'cashed') status = `Cashed out after ${plural(rolls.length, 'roll')}`;
  if (phase === 'over' && outcome === 'last') status = `All ${MAX_ROLLS} rolls · ${fmtMult(cash)}`;
  if (phase === 'over' && outcome === 'max') status = `Max win · ${plural(rolls.length, 'roll')}`;
  const tone = phase === 'over' || bitten ? (cash > 0 && !bitten ? 'won' : 'lost') : live ? 'live' : 'idle';

  const showRoundOver = phase === 'over' && outcome !== null && round && !round.auto && auto.mode === 'manual';

  return (
    <GameLayout
      name="Snakes"
      accent={ACCENTS.sky}
      panel={
        <>
          <ModeTabs auto={auto} disabled={live} />
          <BetField bet={bet} disabled={locked} />

          <Label hint={<VolBadge level={VOLATILITY_OF[difficulty]} />}>Difficulty</Label>
          <Chips
            label="Difficulty"
            options={DIFFICULTIES.map((x) => ({ value: x, label: DIFFICULTY_LABEL[x], title: `${plural(pitCount(x), 'snake')} among 11 tiles` }))}
            value={difficulty}
            disabled={locked}
            onChange={(v) => change(() => setDifficulty(v))}
          />
          {auto.mode === 'manual' && (
            <dl className="og-stats">
              <dt>Max win</dt>
              <dd>{fmtMult(MAX_MULTIPLIER)}</dd>
            </dl>
          )}

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
                    'Roll dice'
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
              <Label>Rolls per bet</Label>
              <div className="snk-stepper">
                <button type="button" aria-label="One roll fewer" disabled={auto.running || autoRolls <= 1} onClick={() => change(() => setAutoRolls(autoRolls - 1))}>
                  −
                </button>
                <Slider label="Rolls per bet" min={1} max={MAX_ROLLS} value={autoRolls} disabled={auto.running} onChange={(v) => change(() => setAutoRolls(v))} />
                <button
                  type="button"
                  aria-label="One roll more"
                  disabled={auto.running || autoRolls >= MAX_ROLLS}
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

      {/* The chance of the next roll; the dots on the tiles are its unit (ways of 36). */}
      <ChanceBar p={bitten ? 0 : 1 - q} label={`Next roll safe · ${safeWays(d)} in 36`} />

      <Readouts items={[{ label: 'Value on best tile', value: phase === 'over' ? fmtMult(top) : fmtMult(cash * top), tone: 'prize' }]} />

      <Board className={'snk-board' + (auto.mode === 'auto' ? ' auto' : '')}>
        {auto.mode === 'auto' && lastAuto && <InstantResult multiplier={lastAuto.multiplier} stake={lastAuto.stake} id={lastAuto.id} />}
        <div className="snk-scene">
          <SnakeBoard
            d={d}
            token={token}
            mode={mode}
            hopMs={hopMs}
            dice={dice}
            landed={landed}
            value={bitten ? 0 : cash}
            valueLabel={valueLabel}
            footer={footer}
          />
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

      <Caption>Each roll lands on its total's tile; a pit loses.</Caption>

      {infoOpen && (
        <InfoModal title="Snakes" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>Roll two dice. Each roll lands on the tile for its total, 2 to 12, and multiplies your value by that tile. A pit tile loses the round. Cash out after any safe roll; a round lasts at most {MAX_ROLLS} rolls.</p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick a difficulty: Easy has 1 snake tile, Medium 3, Hard 5, Expert 7, Master 9. More pits, bigger tiles.</li>
              <li>Press Bet (or Space). Your value starts at {RTP.toFixed(2)}× and the first roll happens straight away.</li>
              <li>The token hops from Start to the tile for the dice total, and your value is multiplied by that tile.</li>
              <li>After each safe roll, press Roll dice (Space) to go on, or Cash out (C) to take the value shown. After roll {MAX_ROLLS} you are cashed out.</li>
              <li>Auto plays a series of bets, each rolling 1 to {MAX_ROLLS} times (or until your cash-out target) and cashing out. Space starts or stops it.</li>
              <li>After a round, Bet again (Space) replays it and Clear board (Esc) resets the board. Changing the difficulty also clears it.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The dots on each tile count how many of the 36 dice pairs make its total (1 to 6), so 7 comes up six times as often as 2 or 12. Every roll is
              independent: the same tiles with the same chances, whatever came before. The pits sit on the common middle totals and the big multipliers on
              the rare edges. The bar shows the chance the next roll is safe.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              For each difficulty the tile factors satisfy Σ ways(s) · f(s) = 3600 over the totals s = 2…12, so one roll has an expected factor of exactly 1.
              The value is a martingale started at {RTP}×, so by optional stopping every way of playing, cashing out after any safe roll, returns the same.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              The round returns {(RTP * 100).toFixed(0)}% of your stake whenever and however you stop. The edge is applied once, not per roll. The best possible
              round is {MAX_ROLLS} edge tiles in a row: {fmtMult(MAX_MULTIPLIER)}. Multipliers for totals 2 to 7 (14 minus the total is the same):
            </p>
            <p className="snk-boards">
              {DIFFICULTIES.map((x) => (
                <span key={x}>
                  <b>{DIFFICULTY_LABEL[x]}</b> {TABLES[x].map((v) => (v === 0 ? 'pit' : (v / 100).toFixed(2) + '×')).join(' · ')}
                </span>
              ))}
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
