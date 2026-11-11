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
  type ReadoutItem,
  type StatusTone,
} from '@originals/game-sdk/ui';
import { useEffect, useRef, useState } from 'react';
import Floor, { RAIL_Y, restY } from './Board';
import {
  BINS,
  BIN_NAME,
  HEIGHT,
  MAX_WIN,
  RTP,
  emptyStacks,
  firstChances,
  landing,
  relock,
  startPrize,
  volatilityOf,
  winChance,
} from './math';

type Phase = 'idle' | 'dropping' | 'checkpoint' | 'over';
type Outcome = 'won' | 'lost' | 'cashed';

interface Round {
  mine: number;
  stake: number;
  prize: number;
  stacks: number[];
  balls: number;
  /** The bin the last ball fell into. */
  landed: number | null;
  outcome: Outcome | null;
  paid: number;
}

interface Last {
  id: number;
  multiplier: number;
  stake: number;
}

const RULE = 'Balls drop onto a floor of unequal bins; back the bin that is first to stack three balls.';
const CAPTION = `Back the bin that is first to stack ${HEIGHT} balls.`;
const AUTO_TARGETS = [0, 1.5, 2, 3, 5, 10];
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const START = emptyStacks();
const START_P = firstChances(START);

const newRound = (mine: number, stake: number): Round => ({ mine, stake, prize: startPrize(mine), stacks: emptyStacks(), balls: 0, landed: null, outcome: null, paid: 0 });

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);

  const [mine, setMine] = useState(1);
  const [target, setTarget] = useState(3);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [ball, setBall] = useState<{ u: number; y: number } | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const [last, setLast] = useState<Last | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const seq = useRef(0);
  const lastU = useRef(0.5);

  // `resolved` is the open bet's value right now, set synchronously at every
  // transition (RTP once the stake is accepted, the dropped ball's result the
  // moment it is drawn, the kept cash-out on a switch). The ticket reads only
  // this ref: a value derived from rendered state can be one render stale if
  // the game unmounts before the next render (0 or the last round's state just
  // after Bet, or the pre-drop cash-out just after Drop next).
  const resolved = useRef(0);
  const ticket = useTicket(() => resolved.current);

  const isAutoRef = useRef(false);
  const fast = turbo.turbo;
  // Manual: the ball slides (360 ms) then falls (240 ms), about 600 ms in all (docs/STYLE.md).
  const sweepMs = () => (isAutoRef.current ? (fast ? 90 : 300) : eventMs(fast, 360));
  const fallMs = () => (isAutoRef.current ? (fast ? 70 : 220) : eventMs(fast, 240));
  const live = phase === 'dropping' || phase === 'checkpoint';

  function cashOf(r: Round) {
    return r.prize * winChance(r.stacks, r.mine);
  }

  /** Runs f(t) for t from 0 to 1 over ms, once per frame. Resolves false if cancelled (cleared or unmounted). */
  async function tween(ms: number, fn: (t: number) => void): Promise<boolean> {
    const t0 = performance.now();
    let alive = true;
    let raf = 0;
    const loop = () => {
      const t = Math.min(1, (performance.now() - t0) / ms);
      fn(t);
      if (t < 1 && alive) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const ok = await timers.wait(ms + 20);
    alive = false;
    cancelAnimationFrame(raf);
    if (ok) fn(1);
    return ok;
  }

  /** The ball slides along the rail to the point u, then falls onto the stack in the bin below it. */
  async function animateDrop(u: number, height: number): Promise<boolean> {
    const u0 = lastU.current;
    lastU.current = u;
    if (!(await tween(sweepMs(), (t) => setBall({ u: u0 + (u - u0) * easeOut(t), y: RAIL_Y })))) return false;
    const y1 = restY(height);
    if (!(await tween(fallMs(), (t) => setBall({ u, y: RAIL_Y + (y1 - RAIL_Y) * t * t })))) return false;
    setBall(null);
    return true;
  }

  /** One ball: where it lands, the new stacks, and what the round is worth after it. */
  function rollBall(r: Round) {
    const u = rng.next();
    const j = landing(u);
    const stacks = r.stacks.slice();
    stacks[j]++;
    const next: Round = { ...r, stacks, balls: r.balls + 1, landed: j };
    const done = stacks[j] >= HEIGHT;
    const value = done ? (j === r.mine ? r.prize : 0) : cashOf(next);
    return { u, j, next, done, value };
  }

  // ---------- Manual round ----------

  function finish(r: Round, outcome: Outcome, paid: number) {
    resolved.current = paid;
    ticket.settle(paid);
    pushHistory(paid);
    setNote(null);
    setRound({ ...r, outcome, paid });
    setPhase('over');
  }

  async function drop(r: Round) {
    const { u, j, next, done, value } = rollBall(r);
    resolved.current = value;
    setNote(null);
    setPhase('dropping');
    setRound({ ...r, landed: null });
    if (!(await animateDrop(u, r.stacks[j]))) return;
    setRound(next);
    if (done) return finish(next, j === r.mine ? 'won' : 'lost', value);
    setPhase('checkpoint');
    track({ type: 'checkpoint', multiplier: value, winChance: winChance(next.stacks, next.mine) });
  }

  async function start() {
    if (live || autoBusy || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    resolved.current = RTP;
    timers.clearAll();
    setLast(null);
    setNote(null);
    const r = newRound(mine, bet.value);
    setRound(r);
    void drop(r);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', cashOf(round));
  }

  function clear() {
    if (live || autoBusy) return;
    timers.clearAll();
    setRound(null);
    setBall(null);
    setLast(null);
    setNote(null);
    setPhase('idle');
  }

  /** At a checkpoint: back another bin, keeping the cash-out and relocking the prize. */
  function switchTo(i: number) {
    if (phase !== 'checkpoint' || !round || i === round.mine) return;
    const cash = cashOf(round);
    const prize = relock(cash, round.stacks, i);
    if (prize === null) {
      setNote(`Backing the ${BIN_NAME[i]} bin now would pay over ${MAX_WIN.toLocaleString('en-US')}× (the max win), so it is not allowed.`);
      return;
    }
    resolved.current = cash;
    setNote(`Switched to the ${BIN_NAME[i]} bin: cash-out stays ${fmtMult(cash)}, prize relocked at ${fmtMult(prize)}.`);
    setRound({ ...round, mine: i, prize });
    setMine(i);
  }

  // ---------- Auto ----------

  async function playAuto(stake: number): Promise<number | null> {
    const tgt = target;
    if (!(await ticket.place(stake))) return null;
    resolved.current = RTP;
    setAutoBusy(true);
    setLast(null);
    let r = newRound(mine, stake);
    setRound(r);
    setPhase('dropping');
    let paid = 0;
    let outcome: Outcome = 'lost';
    for (;;) {
      const { u, j, next, done, value } = rollBall(r);
      resolved.current = value;
      setRound({ ...r, landed: null });
      if (!(await animateDrop(u, r.stacks[j]))) return null;
      r = next;
      setRound(r);
      if (done) {
        outcome = j === r.mine ? 'won' : 'lost';
        paid = value;
        if (!(await timers.wait(fast ? 120 : 320))) return null;
        break;
      }
      if (tgt > 0 && value >= tgt - 1e-12) {
        outcome = 'cashed';
        paid = value;
        break;
      }
    }
    ticket.settle(paid);
    pushHistory(paid);
    setRound({ ...r, outcome, paid });
    setPhase('over');
    setLast({ id: ++seq.current, multiplier: paid, stake });
    setAutoBusy(false);
    return paid;
  }

  const auto = useAutoBet({ bet, play: playAuto, turbo: turbo.turbo });
  const isAuto = auto.mode === 'auto';
  isAutoRef.current = isAuto;
  const busy = live || autoBusy || auto.running;

  // Switching Manual / Auto starts from a clean board.
  useEffect(() => {
    timers.clearAll();
    setRound(null);
    setBall(null);
    setLast(null);
    setNote(null);
    setPhase('idle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto.mode]);

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    if (busy) return;
    apply();
    if (phase === 'over') clear();
  };

  function onBin(i: number) {
    if (phase === 'checkpoint' && round && !isAuto) return switchTo(i);
    if (busy) return;
    setNote(null);
    change(() => setMine(i));
  }

  useHotkeys(
    {
      space: () => {
        if (isAuto) {
          if (auto.running) auto.stop();
          else if (!autoBusy && !bet.blocked) auto.start();
          return;
        }
        if (phase === 'checkpoint' && round) void drop(round);
        else if (phase === 'idle' || phase === 'over') void start();
      },
      cashOut: () => (!isAuto ? cashOut() : undefined),
    },
    !infoOpen,
  );

  // ---------- What the board shows ----------

  const r: Round = round ?? newRound(mine, bet.value);
  const chances = firstChances(r.stacks);
  const outcome = phase === 'over' ? r.outcome : null;
  const winNow = outcome === 'won' ? 1 : outcome === 'lost' ? 0 : chances[r.mine];
  const cash = r.prize * winNow;
  const decided = r.stacks.findIndex((x) => x >= HEIGHT);
  const stake = r.stake;
  const name = BIN_NAME[r.mine];

  const p0 = START_P[mine];
  const prize0 = RTP / p0;
  const vol = volatilityOf(p0);

  let status = `Ready · back a bin to stack ${HEIGHT} first`;
  let tone: StatusTone = 'idle';
  if (phase === 'dropping') {
    status = isAuto ? `Autobet · ball ${r.balls + 1}` : `Ball ${r.balls + 1}…`;
    tone = 'live';
  } else if (phase === 'checkpoint') {
    status = `Ball ${r.balls} fell in the ${BIN_NAME[r.landed ?? 0]} bin · drop next or cash out`;
    tone = 'live';
  } else if (phase === 'over' && outcome) {
    status =
      outcome === 'cashed'
        ? `Cashed out after ${r.balls} balls`
        : outcome === 'won'
          ? `Your ${name} bin stacked ${HEIGHT} first`
          : `The ${BIN_NAME[decided]} bin stacked ${HEIGHT} first`;
    tone = r.paid > 0 ? 'won' : 'lost';
  } else if (isAuto && auto.running) {
    status = `Autobet${auto.remaining !== null ? ` · ${auto.remaining} left` : ''}`;
    tone = 'live';
  }

  // One chance and one prize (docs/STYLE.md §6); the cash-out lives on its button.
  const readouts: ReadoutItem[] = [
    { label: 'Win chance', value: fmtChance(round ? winNow : p0), tone: 'chance' },
    { label: 'Prize', value: fmtMult(r.prize), tone: 'prize' },
  ];

  // Options show the prize, not the chance.
  const binChips = Array.from({ length: BINS }, (_, i) => ({
    value: i,
    label: (
      <span className="tally-chip">
        {BIN_NAME[i]}
        <small>{fmtMult(RTP / START_P[i])}</small>
      </span>
    ),
    title: `Backing the ${BIN_NAME[i]} bin pays ${fmtMult(RTP / START_P[i])} if it stacks ${HEIGHT} first`,
  }));

  return (
    <GameLayout
      name="Tally"
      accent={ACCENTS.blue}
      className="tally-game"
      panel={
        <>
          <ModeTabs auto={auto} disabled={live || autoBusy} />
          <BetField bet={bet} disabled={busy} />

          <Label hint={<VolBadge level={vol} />}>Your bin</Label>
          <Chips
            label="Your bin"
            options={binChips}
            value={phase === 'checkpoint' && round ? round.mine : mine}
            disabled={phase === 'checkpoint' && !isAuto ? false : busy}
            onChange={onBin}
          />
          <p className="tally-hint">{phase === 'checkpoint' && !isAuto ? 'Switch bins: cash-out kept, prize relocked.' : 'Bin width on top, prize below.'}</p>
          {note && <p className="tally-note">{note}</p>}

          {!isAuto ? (
            <>
              {phase === 'checkpoint' && round ? (
                <>
                  <ActionButton kind="cash" onClick={cashOut}>
                    Cash out <span>{formatAmount(stake * cash, 2)}</span>
                  </ActionButton>
                  <ActionButton kind="secondary" onClick={() => void drop(round)}>
                    Drop next ball
                  </ActionButton>
                </>
              ) : (
                <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
                  {phase === 'dropping' ? 'Dropping…' : phase === 'over' ? 'Bet again' : 'Bet'}
                </ActionButton>
              )}
            </>
          ) : (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || autoBusy}>
              <Label hint={target > 0 && target >= prize0 ? 'above the prize: plays to the end' : undefined}>Cash out at</Label>
              <Chips
                label="Auto cash-out"
                options={AUTO_TARGETS.map((t) => ({ value: t, label: t === 0 ? 'End' : `${t}×` }))}
                value={target}
                disabled={busy}
                onChange={(t) => {
                  setTarget(t);
                  if (phase === 'over' && !busy) clear();
                }}
              />
            </AutoBetControls>
          )}
          {bet.blocked && <p className="tally-note">{bet.blocked}</p>}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />
      <Readouts items={readouts} />

      <Board className="tally-board">
        {isAuto && <InstantResult multiplier={last && !autoBusy ? last.multiplier : null} stake={last?.stake ?? 0} id={last?.id ?? 0} />}
        <Floor
          stacks={r.stacks}
          mine={r.mine}
          chances={chances}
          ball={ball}
          landed={phase === 'dropping' ? null : r.landed}
          winner={decided >= 0 ? decided : null}
          editable={(!isAuto && phase === 'checkpoint') || !busy}
          onBin={onBin}
        />
      </Board>

      {!isAuto && phase === 'over' && round?.outcome ? (
        <RoundOver
          key={history[0]?.id}
          title={round.outcome === 'cashed' ? 'Cashed out' : round.outcome === 'won' ? `Your ${name} bin stacked ${HEIGHT}` : `The ${BIN_NAME[decided]} bin stacked ${HEIGHT}`}
          multiplier={round.paid}
          stake={round.stake}
          nextBet={bet.value}
          blocked={bet.blocked}
          onBetAgain={() => void start()}
          onClear={clear}
          placement="inline"
        />
      ) : null}
      <Caption>{CAPTION}</Caption>

      {infoOpen && (
        <InfoModal title="Tally" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              {RULE} The floor has five bins, 40%, 30%, 15%, 10% and 5% of its width. You win the prize if your bin is the first to hold {HEIGHT} balls.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick a bin (in the panel or by tapping the board), then Bet. The first ball drops at once.</li>
              <li>Each ball lands at a random point along the floor and stacks a block in the bin below it.</li>
              <li>After every ball, cash out (C) or drop the next one (Space). If another bin reaches {HEIGHT} first, you lose.</li>
              <li>At a checkpoint you can switch to another bin: your cash-out stays the same and the prize is relocked to match.</li>
              <li>Auto plays whole rounds and cashes out once the round is worth your target (or plays to the finish with End).</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              Each bin's width is its exact chance to catch the next ball; the label under it says so. The bar at the top splits 100% between the bins by their
              chance to stack {HEIGHT} first. Your piece is blue: that is your chance to win, shown above the board as Win chance. A ball in your bin raises it;
              a ball for a rival lowers it, most of all for a rival that is close to the line.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Poissonization: drop the balls at the times of a rate-1 Poisson process and each bin j gets its own independent Poisson stream of rate p<sub>j</sub>{' '}
              (its width). A bin that needs r more balls finishes at a Gamma(r, p<sub>j</sub>) time, so your chance is the chance your Gamma clock rings first:
              P = ∫ f<sub>you</sub>(t) · Π<sub>j ≠ you</sub> P(Poisson(p<sub>j</sub>t) &lt; r<sub>j</sub>) dt.
            </p>
            <p>
              The game computes the same number with the one-ball recursion P(c) = Σ<sub>j</sub> p<sub>j</sub> · P(c + one ball in j) over all 3<sup>5</sup> = 243
              stack heights. A round lasts at most 11 balls, so every chance is an exact fraction over 20<sup>11</sup>, worked out in whole numbers. No simulation is
              used.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Prize = {(RTP * 100).toFixed(0)}% ÷ your chance at the start. Cash-out = prize × your chance now. Your chance is a martingale: each ball moves it, but
              weighted by the bin widths it stays the same on average, so any cash-out rule returns {(RTP * 100).toFixed(0)}% in the long run. Switching keeps the
              cash-out and relocks the prize at cash-out ÷ new chance, so it changes risk, never value. No prize may exceed {MAX_WIN.toLocaleString('en-US')}× (switches
              that would are refused).
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
