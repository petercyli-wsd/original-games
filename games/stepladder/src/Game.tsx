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
import { formatAmount } from '@originals/game-sdk';
import { useRef, useState } from 'react';
import Ladder, { type DuelResult, type Rolling } from './Board';
import { DICE, ROLL_OFFS, RTP, START, cashOf, duelChances, gridCells, levelOf, matchOf, prizeOf, step, titleChance, type State } from './math';

type Phase = 'idle' | 'rolling' | 'checkpoint' | 'over';
type Outcome = 'out' | 'cashed' | 'top';

interface Round {
  die: number;
  stake: number;
  s: State;
  cash: number;
  results: (DuelResult | null)[];
  outcome: Outcome | null;
  /** The last roll-off: the state it was played from and its faces. */
  last: { from: State; fa: number; fb: number; won: boolean } | null;
}

const OUTCOME_TITLE: Record<Outcome, string> = { out: 'Dropped off', cashed: 'Cashed out', top: 'Top step' };

const RULE =
  'Back one of four dice (d6, d8, d12, d20): it rolls off against each of the other three, smallest first, and must win all three. Highest roll wins; a tie goes to the bigger die.';

const STOP_AFTER = [1, 2, 3] as const;

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [die, setDie] = useState(1);
  const [stopAfter, setStopAfter] = useState<(typeof STOP_AFTER)[number]>(3);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [rolling, setRolling] = useState<Rolling | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const seq = useRef(0);
  const [resultId, setResultId] = useState(0);

  // The open ticket's value right now, set synchronously when the stake is placed
  // and again the moment each roll-off is drawn, so leaving mid-roll settles at
  // the real result. The ticket reads only this ref, never rendered state.
  const resolved = useRef(0);
  const ticket = useTicket(() => resolved.current);
  // Guards every action against a second press in the same tick.
  const busy = useRef(false);

  const manualMs = turbo.turbo ? 500 : 2000;
  const autoMs = turbo.turbo ? 140 : 650;
  const live = phase === 'rolling' || phase === 'checkpoint';

  const auto = useAutoBet({ bet, play: playAuto, turbo: turbo.turbo });
  const locked = live || auto.running;

  function finish(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setResultId(++seq.current);
    setRolling(null);
    setPhase('over');
    busy.current = false;
  }

  /** Places the bet and returns the new round, or null if refused. */
  async function begin(stake: number): Promise<Round | null> {
    if (busy.current) return null;
    busy.current = true;
    if (!(await ticket.place(stake))) {
      busy.current = false;
      return null;
    }
    resolved.current = RTP;
    timers.clearAll();
    const r: Round = { die, stake, s: START, cash: RTP, results: [null, null, null], outcome: null, last: null };
    setRound(r);
    return r;
  }

  /** Draws and animates one roll-off. The outcome is decided now, after the bet is placed. */
  async function rollOff(r: Round, ms: number): Promise<Round | null> {
    const { a, b } = matchOf(r.die, r.s);
    const fa = 1 + rng.int(a);
    const fb = 1 + rng.int(b);
    const s = step(r.die, r.s, fa, fb);
    const cash = cashOf(r.die, s);
    resolved.current = cash;
    const results = [...r.results];
    results[r.s.j] = { fa, fb, won: !s.lost };
    const next: Round = { ...r, s, cash, results, last: { from: r.s, fa, fb, won: !s.lost } };
    setRound(r);
    setPhase('rolling');
    setRolling({ fa, fb, ms });
    const ok = await timers.wait(ms);
    if (!ok) return null;
    setRolling(null);
    setRound(next);
    return next;
  }

  async function advance(r: Round) {
    busy.current = true;
    const next = await rollOff(r, manualMs);
    if (!next) return;
    if (next.cash === 0) return finish(next, 'out', 0);
    if (next.s.j >= ROLL_OFFS) return finish(next, 'top', next.cash);
    setPhase('checkpoint');
    busy.current = false;
    track({ type: 'checkpoint', multiplier: next.cash, winChance: titleChance(next.die, next.s) });
  }

  async function start() {
    if (live || locked || bet.blocked) return;
    const r = await begin(bet.value);
    if (r) void advance(r);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round || busy.current) return;
    busy.current = true;
    finish(round, 'cashed', round.cash);
  }

  function next() {
    if (phase !== 'checkpoint' || !round || busy.current) return;
    void advance(round);
  }

  async function playAuto(stake: number): Promise<number | null> {
    let r = await begin(stake);
    if (!r) return null;
    for (;;) {
      const n = await rollOff(r, autoMs);
      if (!n) return null;
      r = n;
      if (r.cash === 0) return finish(r, 'out', 0), 0;
      if (r.s.j >= ROLL_OFFS) return finish(r, 'top', r.cash), r.cash;
      if (r.s.j >= stopAfter) return finish(r, 'cashed', r.cash), r.cash;
    }
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    setRound(null);
    setRolling(null);
    setPhase('idle');
  }

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    apply();
    if (phase === 'over') clear();
  };

  useHotkeys(
    {
      space: () => {
        if (auto.mode !== 'manual') return;
        if (phase === 'checkpoint') next();
        else if (!locked) void start();
      },
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const d = round?.die ?? die;
  const s = round?.s ?? START;
  const gridState = phase === 'over' && round?.last ? round.last.from : s;
  const stake = round?.stake ?? bet.value;
  const cash = round?.cash ?? RTP;
  const prize = prizeOf(d);
  const p0 = titleChance(die, START);
  const now = round ? titleChance(d, s) : p0;
  const nextGrid = gridCells(d, gridState);
  const rollOffChance = nextGrid.good / nextGrid.total;

  const lastText = round?.last ? (round.last.won ? 'you won the roll-off' : 'you lost the roll-off') : '';

  let status = `Ready · backing the d${DICE[die]}`;
  if (phase === 'rolling') status = `Roll-off ${s.j + 1} of ${ROLL_OFFS} · d${matchOf(d, s).a} vs d${matchOf(d, s).b}`;
  if (phase === 'checkpoint') status = `Checkpoint · ${lastText}`;
  if (phase === 'over' && round?.outcome) status = `${OUTCOME_TITLE[round.outcome]} · ${lastText}`;
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  return (
    <GameLayout
      name="Stepladder"
      accent="#38bdf8"
      panel={
        <>
          <ModeTabs auto={auto} disabled={live} />
          <BetField bet={bet} disabled={locked} />

          <Label hint={<VolBadge level={levelOf(die)} />}>Back a die</Label>
          <Chips
            label="Die to back"
            options={DICE.map((n, i) => ({ value: i, label: `d${n}` }))}
            value={die}
            disabled={locked}
            onChange={(v) => change(() => setDie(v))}
          />
          <dl className="og-stats">
            <dt>Chance to win</dt>
            <dd>{fmtChance(p0)}</dd>
            <dt>Prize</dt>
            <dd>{fmtMult(prizeOf(die))}</dd>
          </dl>

          {auto.mode === 'manual' ? (
            phase === 'checkpoint' ? (
              <>
                <ActionButton kind="cash" onClick={cashOut}>
                  Cash out <span>{formatAmount(stake * cash, 2)}</span>
                </ActionButton>
                <ActionButton kind="secondary" onClick={next}>
                  Next roll-off · d{matchOf(d, s).a} vs d{matchOf(d, s).b}
                </ActionButton>
              </>
            ) : (
              <ActionButton disabled={locked || !!bet.blocked} onClick={() => void start()}>
                {phase === 'rolling' ? 'Rolling…' : phase === 'over' ? 'Bet again' : 'Bet'}
              </ActionButton>
            )
          ) : (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || live}>
              <Label hint="then cash out">Play through roll-off</Label>
              <Chips
                label="Cash out after roll-off"
                options={STOP_AFTER.map((n) => ({ value: n, label: n === 3 ? '3 (top)' : n }))}
                value={stopAfter}
                disabled={auto.running}
                onChange={(v) => setStopAfter(v as (typeof STOP_AFTER)[number])}
              />
            </AutoBetControls>
          )}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />

      <Readouts
        items={[
          { label: 'Chance to win', value: fmtChance(now), sub: `your d${DICE[d]} wins all three`, tone: 'chance' },
          { label: 'Cash out now', value: live || phase === 'over' ? fmtMult(cash) : '—', sub: formatAmount(stake * cash, 2), tone: 'cash' },
          { label: 'Full prize', value: fmtMult(prize), sub: 'if you win all three', tone: 'prize' },
        ]}
      />

      <Board className="ladder-board">
        {auto.mode === 'auto' && <InstantResult multiplier={phase === 'over' && round ? round.cash : null} stake={round?.stake ?? 0} id={resultId} />}
        <Ladder
          die={d}
          s={s}
          grid={gridState}
          results={round?.results ?? [null, null, null]}
          mark={phase === 'over' && round?.last ? { fa: round.last.fa, fb: round.last.fb } : null}
          rolling={rolling}
        />
        {phase === 'over' && round?.outcome && auto.mode === 'manual' && (
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
          p={rollOffChance}
          label={`Your d${DICE[d]} wins this roll-off`}
          note="The green share of the face-pair grid is exactly this chance."
        />
      ) : (
        <Caption>{RULE}</Caption>
      )}

      {infoOpen && (
        <InfoModal title="Stepladder" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>Back one of four dice (d6, d8, d12, d20). Your die must beat each of the other three in a roll-off.</p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick a die to back, then bet. Your die rolls off against the smallest of the other dice first, then the next, then the biggest.</li>
              <li>In each roll-off both dice roll once. The higher roll wins; a tie goes to the bigger die. Lose one and the round is over.</li>
              <li>After each win you can cash out, or play the next roll-off (Space). Win all three to take the full prize.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The grid has one cell for every pair of faces, all equally likely. <b style={{ color: 'var(--green)' }}>Green</b> cells are the pairs where your die wins
              the current roll-off, and the green share is that roll-off's chance. The three bars list the chances of all three roll-offs, and your overall chance is
              written as their product.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              A die of size a beats a bigger die of size b with probability (a − 1) / 2b, and a smaller one with probability 1 − (b − 1) / 2a (ties to the bigger die).
              The roll-offs use fresh dice, so they are independent and P(win) = p₁ × p₂ × p₃: d20 {fmtChance(titleChance(3, START))}, d12 {fmtChance(titleChance(2, START))}, d8{' '}
              {fmtChance(titleChance(1, START))}, d6 {fmtChance(titleChance(0, START))}. Your chances in order for the die you pick: {duelChances(die).map(fmtChance).join(' × ')}.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              A full win pays {(RTP * 100).toFixed(0)}% ÷ P(win). Your cash-out is that prize times the chance of winning the roll-offs still to come, so every roll-off leaves its
              expected value unchanged and any way of cashing out returns {(RTP * 100).toFixed(0)}% of stakes in the long run.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}


