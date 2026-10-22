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
  type ReadoutItem,
} from '@originals/game-sdk/ui';
import { formatAmount } from '@originals/game-sdk';
import { useRef, useState } from 'react';
import Field from './Board';
import Picker from './Picker';
import {
  HOUSE,
  PRESETS,
  RTP,
  YOURS,
  cashAt,
  conwayChance,
  leading,
  onePointAway,
  pairProblem,
  progress,
  race,
  volatilityOf,
  type Coin,
  type PresetId,
  type Race,
} from './math';

const ACCENT = '#f9c74f';

type Phase = 'idle' | 'flipping' | 'checkpoint' | 'over';
type Outcome = 'landed' | 'beaten' | 'sealed' | 'doomed' | 'cashed';

/** Auto-flip: off, pause only when a side is one coin away, or run to the finish. */
type Auto = 'off' | 'one' | 'end';
const AUTO_HINT: Record<Auto, string> = {
  off: 'you flip every coin',
  one: 'pauses when a side is 1 coin away',
  end: 'flips to the finish',
};

interface Round {
  /** Counts rounds, so the board never animates one round's coins into the next. */
  id: number;
  you: string;
  house: string;
  stake: number;
  flips: string;
  /** The race's automaton node (YOURS / HOUSE once a pattern lands). */
  node: string;
  cash: number;
  outcome: Outcome | null;
}

const OUTCOME_TITLE: Record<Outcome, string> = {
  landed: 'Your pattern landed',
  beaten: 'House pattern landed',
  sealed: 'Locked in',
  doomed: 'Out of reach',
  cashed: 'Cashed out',
};

/** The matched coins of each pattern, read straight off the flips. */
function matches(r: Round) {
  return {
    you: r.node === YOURS ? r.you.length : progress(r.flips, r.you),
    house: r.node === HOUSE ? r.house.length : progress(r.flips, r.house),
  };
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory();

  const [you, setYou] = useState<string>(PRESETS[1].you);
  const [house, setHouse] = useState<string>(PRESETS[1].house);
  const [auto, setAuto] = useState<Auto>('off');
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [pending, setPending] = useState<Coin | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  // The coin in the air is decided the moment it is tossed, so leaving
  // mid-flip settles at its real result, never at the pre-flip value.
  const resolved = useRef(0);
  const roundNo = useRef(0);
  const ticket = useTicket(() => (phase === 'flipping' ? resolved.current : round?.cash ?? 0));
  // Scheduled auto-flips read the latest setting, so switching auto off stops at the next checkpoint.
  const autoRef = useRef(auto);
  autoRef.current = auto;

  const spinMs = turbo.turbo ? 160 : 620;
  const gapMs = turbo.turbo ? 90 : 320;
  const live = phase === 'flipping' || phase === 'checkpoint';
  const problem = pairProblem(you, house);

  function finish(r: Round, outcome: Outcome, cash: number) {
    timers.clearAll();
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setPending(null);
    setPhase('over');
  }

  const autoGo = (rc: Race, node: string, mode: Auto) => mode === 'end' || (mode === 'one' && !onePointAway(rc, node));

  /** Queues the next flip if the auto rule says so; the player can still cash out in the pause. */
  function scheduleAuto(r: Round, mode: Auto = autoRef.current) {
    const rc = race(r.you, r.house);
    if (!autoGo(rc, r.node, mode)) return;
    timers.after(gapMs, () => {
      if (autoGo(rc, r.node, autoRef.current)) flip(r);
    });
  }

  function flip(r: Round) {
    timers.clearAll();
    const rc = race(r.you, r.house);
    const coin: Coin = rng.next() < 0.5 ? 'H' : 'T';
    const node = rc.next(r.node, coin);
    const cash = cashAt(rc, node);
    resolved.current = cash;
    setPending(coin);
    setPhase('flipping');
    timers.after(spinMs, () => {
      const next: Round = { ...r, flips: r.flips + coin, node, cash };
      if (node === YOURS) return finish(next, 'landed', cash);
      if (node === HOUSE) return finish(next, 'beaten', 0);
      if (rc.decided(node)) return finish(next, rc.chance(node) === 1 ? 'sealed' : 'doomed', cash);
      setPending(null);
      setRound(next);
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: cash, winChance: rc.chance(node) });
      scheduleAuto(next);
    });
  }

  async function start() {
    if (live || bet.blocked || problem) return;
    if (!(await ticket.place(bet.value))) return;
    timers.clearAll();
    const r: Round = { id: ++roundNo.current, you, house, stake: bet.value, flips: '', node: '', cash: RTP, outcome: null };
    setRound(r);
    flip(r);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', round.cash);
  }

  function flipNext() {
    if (phase === 'checkpoint' && round) flip(round);
  }

  function clear() {
    if (live) return;
    timers.clearAll();
    setRound(null);
    setPending(null);
    setPhase('idle');
  }

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    apply();
    if (phase === 'over') clear();
  };

  function changeAuto(v: Auto) {
    setAuto(v);
    autoRef.current = v;
    // At a checkpoint the new rule applies straight away.
    if (phase === 'checkpoint' && round) {
      timers.clearAll();
      scheduleAuto(round, v);
    }
  }

  useHotkeys(
    {
      space: () => (phase === 'checkpoint' ? flipNext() : !live ? void start() : undefined),
      cashOut,
    },
    !infoOpen,
  );

  // What the board shows: the live or finished round, else a preview of the settings.
  const A = round?.you ?? you;
  const B = round?.house ?? house;
  const valid = round !== null || !problem;
  const rc = valid ? race(A, B) : null;
  const node = round?.node ?? '';
  const flips = round?.flips ?? '';
  const m = round ? matches(round) : { you: 0, house: 0 };
  const p = rc ? rc.chance(node) : null;
  const p0 = rc?.p0 ?? 0;
  const prize = rc?.prize ?? 0;
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const outcome = round?.outcome ?? null;
  const showFork = rc && (phase === 'idle' || phase === 'checkpoint');
  const fork = showFork ? { h: rc.chance(rc.next(node, 'H')), t: rc.chance(rc.next(node, 'T')) } : null;

  // Panel stats follow the chosen settings, not the round on the board.
  const chosen = problem ? null : race(you, house);
  const vol = chosen ? volatilityOf(chosen.p0) : 'medium';
  const presetId: PresetId | 'custom' = PRESETS.find((x) => x.you === you && x.house === house)?.id ?? 'custom';

  let status = problem && !round ? 'Patterns overlap · change a coin' : `Ready · ${A} vs ${B}`;
  if (phase === 'flipping') status = `Flipping coin ${flips.length + 1}…`;
  if (phase === 'checkpoint') status = `Checkpoint · ${flips.length} flip${flips.length === 1 ? '' : 's'}`;
  if (phase === 'over' && outcome) {
    status =
      outcome === 'sealed'
        ? `Decided · ${A} must now land before ${B}`
        : outcome === 'doomed'
          ? `Decided · ${B} must now land before ${A}`
          : `${OUTCOME_TITLE[outcome]} · ${flips.length} flip${flips.length === 1 ? '' : 's'}`;
  }
  const tone = phase === 'over' ? (round && round.cash > 0 ? 'won' : 'lost') : live ? 'live' : 'idle';

  const readouts: ReadoutItem[] =
    phase === 'idle'
      ? [
          { label: 'Yours lands first', value: rc ? fmtChance(p0) : '—', sub: "Conway's exact odds", tone: 'chance' },
          { label: 'Cash out now', value: '—', sub: 'after every flip', tone: 'cash' },
          { label: 'Prize', value: rc ? fmtMult(prize) : '—', sub: `if ${A} lands first`, tone: 'prize' },
        ]
      : [
          {
            label: 'Yours lands first',
            value: p === null ? '—' : fmtChance(p),
            sub: phase === 'over' && outcome !== 'cashed' ? 'race decided' : `started at ${fmtChance(p0)}`,
            tone: 'chance',
          },
          { label: phase === 'over' ? 'Paid' : 'Cash out now', value: fmtMult(cash), sub: formatAmount(stake * cash, 2), tone: 'cash' },
          { label: 'Prize', value: fmtMult(prize), sub: `if ${A} lands first`, tone: 'prize' },
        ];

  const forkNote = !fork
    ? 'Coin in the air…'
    : Math.abs(fork.h - fork.t) < 1e-12
      ? `Next flip: heads or tails, your chance stays at ${fmtChance(fork.h)}. Only the patterns move.`
      : `Next flip: heads takes it to ${fmtChance(fork.h)}, tails to ${fmtChance(fork.t)}. Your chance now is exactly their average.`;

  return (
    <GameLayout
      name="Penney"
      accent={ACCENT}
      panel={
        <>
          <BetField bet={bet} disabled={live} />

          <Label hint={<VolBadge level={vol} />}>Matchup</Label>
          <div className="pn-presets">
            <Chips
              label="Matchup"
              wrap
              options={PRESETS.map((x) => ({
                value: x.id as PresetId | 'custom',
                label: (
                  <span className="pn-preset">
                    {x.label} <small>{fmtChance(race(x.you, x.house).p0)}</small>
                  </span>
                ),
                title: `${x.you} vs ${x.house}`,
              }))}
              value={presetId}
              disabled={live}
              onChange={(id) => {
                const x = PRESETS.find((q) => q.id === id);
                if (x) change(() => (setYou(x.you), setHouse(x.house)));
              }}
            />
          </div>

          <Label hint="wins if it lands first">Your pattern</Label>
          <Picker label="Your pattern" side="you" value={you} disabled={live} onChange={(v) => change(() => setYou(v))} />

          <Label
            hint={
              <button type="button" className="pn-swap" disabled={live} onClick={() => change(() => (setYou(house), setHouse(you)))} title="Swap the two patterns">
                ⇄ swap
              </button>
            }
          >
            House pattern
          </Label>
          <Picker label="House pattern" side="house" value={house} disabled={live} onChange={(v) => change(() => setHouse(v))} />

          <Label hint={AUTO_HINT[auto]}>Auto-flip</Label>
          <Chips
            label="Auto-flip"
            options={[
              { value: 'off' as Auto, label: 'Off' },
              { value: 'one' as Auto, label: 'One away', title: 'Flip automatically, but pause whenever either pattern is one coin from landing' },
              { value: 'end' as Auto, label: 'To the end', title: 'Flip every coin to the finish' },
            ]}
            value={auto}
            onChange={changeAuto}
          />

          {chosen ? (
            <dl className="og-stats">
              <dt>Chance to win</dt>
              <dd>{fmtChance(chosen.p0)}</dd>
              <dt>Prize</dt>
              <dd>{fmtMult(chosen.prize)}</dd>
              <dt>Average round</dt>
              <dd>{chosen.flipsLeft('').toFixed(1)} flips</dd>
            </dl>
          ) : (
            <p className="pn-warn" role="alert">
              {problem}
            </p>
          )}

          {/* Both live buttons stay put while a coin is in the air (disabled), so auto-flip never makes the panel jump. */}
          {live ? (
            <>
              <ActionButton kind="cash" disabled={phase !== 'checkpoint'} onClick={cashOut}>
                Cash out <span>{formatAmount(stake * cash, 2)}</span>
              </ActionButton>
              <ActionButton kind="secondary" disabled={phase !== 'checkpoint'} onClick={flipNext}>
                {phase === 'flipping' ? 'Flipping…' : rc && autoGo(rc, node, auto) ? 'Auto-flipping…' : 'Flip next coin'}
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={!!bet.blocked || !!problem} onClick={() => void start()}>
              {phase === 'over' ? 'Bet again' : 'Bet'}
            </ActionButton>
          )}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />

      <Readouts items={readouts} />

      <Board className="pn-board">
        <Field
          you={A}
          house={B}
          flips={flips}
          pending={pending}
          spinMs={spinMs}
          moveMs={turbo.turbo ? 90 : 340}
          youMatch={m.you}
          houseMatch={m.house}
          p={p}
          fork={fork}
          landed={outcome === 'landed' ? 'you' : outcome === 'beaten' ? 'house' : null}
          note={
            outcome === 'sealed'
              ? { text: `Decided: ${A} must land first`, side: 'you' }
              : outcome === 'doomed'
                ? { text: `Decided: ${B} must land first`, side: 'house' }
                : null
          }
          roundKey={round?.id ?? 0}
          mode={phase === 'idle' ? 'idle' : phase === 'over' ? 'over' : 'live'}
        />
        {/* The result card sits over the odds bar (in flow on narrow frames). */}
        {phase === 'over' && round?.outcome && (
          <div className="pn-result">
            <RoundOver
              key={history[0]?.id}
              title={OUTCOME_TITLE[round.outcome]}
              multiplier={round.cash}
              stake={round.stake}
              nextBet={bet.value}
              blocked={bet.blocked ?? problem ?? undefined}
              onBetAgain={() => void start()}
              onClear={clear}
              placement="inline"
            />
          </div>
        )}
      </Board>

      <div className="pn-foot">
        {live && p !== null ? (
          <ChanceBar p={p} label="Your pattern lands first" note={forkNote} />
        ) : (
          <Caption>
            {rc ? (
              <>
                {A} against {B}: by Conway's leading numbers yours lands first {fmtChance(p0)} of the time, so a win pays {fmtMult(prize)}. Cash out after
                any flip at its exact value. RTP {(RTP * 100).toFixed(0)}%.
              </>
            ) : (
              <>{problem}</>
            )}
          </Caption>
        )}
      </div>

      {infoOpen && (
        <InfoModal title="Penney" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              A fair coin is flipped again and again. You pick a pattern of heads (H) and tails (T), and a pattern for the house. If yours shows up as a run of
              consecutive flips before the house's does, you win the prize.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick a matchup, or build both patterns yourself: click a coin to turn it over, − / + to change the length (2 to 5 coins).</li>
              <li>Bet. The first coin is flipped straight away.</li>
              <li>After every flip you can cash out (C) or flip the next coin (Space). Auto-flip can keep going for you, pausing when either side is one coin away.</li>
              <li>The round ends when a pattern lands, or as soon as the race is decided (one side can no longer land first), at its exact value.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              Each pattern sits under the flips it already matches: the lit coins (and the bar beneath them) are matched, the dashed ones are still needed,
              and the pulsing coin is the one each side needs next.
            </p>
            <p>
              The <b style={{ color: 'var(--green)' }}>green</b> share of the bar at the bottom is your exact chance of landing first; the{' '}
              <b style={{ color: 'var(--red)' }}>red</b> share is the house's. The small H and T coins above it show where the split moves after heads or
              tails. Your chance now sits exactly halfway between them.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              <b>Penney's game</b> is non-transitive: every pattern of three or more coins has another that tends to beat it, even though all runs of the same
              length are equally common. <b>Conway's leading numbers</b> give the odds. Write X:Y for the sum of 2<sup>k−1</sup> over every k where the last k
              coins of X equal the first k coins of Y. Then the odds that B lands before A are (A:A − A:B) : (B:B − B:A).
            </p>
            {rc && (
              <p>
                Here: {A}:{A} = {leading(A, A)}, {A}:{B} = {leading(A, B)}, {B}:{B} = {leading(B, B)}, {B}:{A} = {leading(B, A)}. So the odds of {B}{' '}
                landing first are {leading(A, A) - leading(A, B)} : {leading(B, B) - leading(B, A)}, and {A} lands first {fmtChance(conwayChance(A, B))} of the
                time.
              </p>
            )}
            <p>
              Mid-round, all that matters is the longest tail of the flips that still starts either pattern. The live chance from there is the exact solution
              of a small Markov chain on those states.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              A win pays {RTP * 100}% ÷ P(your pattern first). Cashing out pays that prize × your live chance. Every flip is a fair bet, because your chance now
              is the average of the chances after heads and after tails, so the round is worth {(RTP * 100).toFixed(0)}% of your stake whenever you cash out.
              Choosing the patterns changes the prize and the swings, never the value. Because your pattern always lands first if the opening flips spell it,
              the chance is at least 1 in 32 and no payout exceeds {fmtMult(RTP * 32)}.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
