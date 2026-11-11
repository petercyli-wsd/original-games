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
  type StatusTone,
} from '@originals/game-sdk/ui';
import { useEffect, useRef, useState } from 'react';
import Tray from './Board';
import { RULE } from './manifest';
import {
  MAX_WIN,
  RTP,
  TARGETS,
  TURNS,
  bankChance,
  bestIsBank,
  canBank,
  isWipe,
  relock,
  rollChance,
  startPrize,
  volatilityOf,
  winChance,
} from './math';

type Phase = 'idle' | 'rolling' | 'landed' | 'checkpoint' | 'banking' | 'over';
type Outcome = 'won' | 'lost' | 'cashed';
type Last = 'none' | 'score' | 'wipe' | 'bank';

interface Round {
  k: number;
  stake: number;
  prize: number;
  banked: number;
  pot: number;
  /** Turns left, this one included. */
  t: number;
  face: number | null;
  /** Pot taken by the last wipe (stays on the bar until the next roll). */
  lost: number;
  rolls: number;
  last: Last;
  /** Win chance before the last event, for the "chance up / down" line. */
  before: number;
  outcome: Outcome | null;
  paid: number;
}

interface HistoryLast {
  id: number;
  multiplier: number;
  stake: number;
}

const AUTO_TARGETS = [0, 1.5, 2, 3, 5, 10];
const TITLE: Record<Outcome, string> = { won: 'Target reached', lost: 'Out of turns', cashed: 'Cashed out' };
const EPS = 1e-9;
const dir = (now: number, before: number) => (now > before + EPS ? 'up' : now < before - EPS ? 'down' : 'same');

const fresh = (k: number, stake: number): Round => ({
  k,
  stake,
  prize: startPrize(k),
  banked: 0,
  pot: 0,
  t: TURNS,
  face: null,
  lost: 0,
  rolls: 0,
  last: 'none',
  before: winChance(k, 0, TURNS),
  outcome: null,
  paid: 0,
});

/** Win chance at a round's state (best play from here). */
const chanceOf = (r: Round) => winChance(r.k - r.banked, r.pot, r.t);

/** The round after a die lands (the outcome is already decided). */
function landRoll(r: Round, face: number): Round {
  const n = r.k - r.banked;
  const before = chanceOf(r);
  const base = { ...r, face, rolls: r.rolls + 1, lost: 0, before };
  if (isWipe(face)) return { ...base, pot: 0, t: r.t - 1, lost: r.pot, last: 'wipe' };
  return { ...base, pot: Math.min(r.pot + face, n), last: 'score' };
}

/** The round after Bank: the pot becomes score and the turn is used. */
function doBank(r: Round): Round {
  return { ...r, banked: r.banked + r.pot, pot: 0, t: r.t - 1, face: r.face, lost: 0, last: 'bank', before: chanceOf(r) };
}

const won = (r: Round) => r.last === 'score' && r.banked + r.pot >= r.k;
const lostRound = (r: Round) => r.last === 'wipe' && r.t === 0;

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);

  const [k, setK] = useState<number>(35);
  const [target, setTarget] = useState(2);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const [last, setLast] = useState<HistoryLast | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const seq = useRef(0);
  const busyRef = useRef(false);

  // A roll is decided the moment it starts, so leaving mid-roll settles at its
  // real result, never at the pre-roll value. `resolved` is the open ticket's
  // value right now, set synchronously at every transition: RTP when the stake
  // is placed, the post-roll value when a die is drawn (prize when the target is
  // reached, 0 on a final wipe), and the unchanged cash-out after a Bank. The
  // ticket reads only this ref, never rendered state, which can be a render stale.
  const resolved = useRef(0);
  const ticket = useTicket(() => resolved.current);

  const isAutoRef = useRef(false);
  const kk = turbo.turbo ? 0.25 : 1;
  // Manual events take about EVENT_MS (Turbo about a quarter); Auto keeps its own faster timings.
  const ms = (manual: number, auto: number) => (isAutoRef.current ? Math.round(auto * kk) : eventMs(turbo.turbo, manual));
  const live = phase === 'rolling' || phase === 'landed' || phase === 'checkpoint' || phase === 'banking';

  function finish(r: Round, outcome: Outcome, paid: number) {
    busyRef.current = false;
    ticket.settle(paid);
    pushHistory(paid);
    setNote(null);
    setRound({ ...r, outcome, paid });
    setPhase('over');
  }

  /** One roll. Resolves when the round is at a checkpoint or over. */
  async function roll(r: Round, wait = ms) {
    if (busyRef.current) return;
    busyRef.current = true;
    const face = 1 + rng.int(6);
    const next = landRoll(r, face);
    resolved.current = won(next) ? r.prize : lostRound(next) ? 0 : r.prize * chanceOf(next);
    setNote(null);
    setRound({ ...r, face: null, lost: 0 });
    setPhase('rolling');
    if (!(await timers.wait(wait(600, 420)))) return;
    setRound(next);
    setPhase('landed');
    if (!(await timers.wait(wait(600, 260)))) return;
    if (won(next)) return finish(next, 'won', next.prize);
    if (lostRound(next)) return finish(next, 'lost', 0);
    busyRef.current = false;
    setPhase('checkpoint');
    track({ type: 'checkpoint', multiplier: next.prize * chanceOf(next), winChance: chanceOf(next) });
  }

  async function bank(r: Round, prize: number, wait = ms) {
    if (busyRef.current) return;
    busyRef.current = true;
    const next = { ...doBank(r), prize };
    resolved.current = r.prize * chanceOf(r);
    setNote(null);
    setRound(next);
    setPhase('banking');
    if (!(await timers.wait(wait(600, 260)))) return;
    busyRef.current = false;
    setPhase('checkpoint');
    track({ type: 'checkpoint', multiplier: next.prize * chanceOf(next), winChance: chanceOf(next) });
  }

  /** The prize after picking Roll or Bank at this state (null if the relock passes MAX_WIN). */
  function prizeFor(r: Round, pick: 'roll' | 'bank'): number | null {
    const n = r.k - r.banked;
    const rc = rollChance(n, r.pot, r.t);
    const bc = bankChance(n, r.pot, r.t);
    return relock(r.prize, Math.max(rc, bc), pick === 'roll' ? rc : bc);
  }

  function pickRoll(r: Round) {
    const prize = prizeFor(r, 'roll');
    if (prize === null) {
      setNote(`Rolling would lock the prize above ${MAX_WIN.toLocaleString('en-US')}×, so Bank.`);
      return;
    }
    void roll({ ...r, prize });
  }

  function pickBank(r: Round) {
    const prize = prizeFor(r, 'bank');
    if (prize === null) {
      setNote(`Banking would lock the prize above ${MAX_WIN.toLocaleString('en-US')}×, so Roll.`);
      return;
    }
    void bank(r, prize);
  }

  async function start() {
    if (live || autoBusy || bet.blocked || busyRef.current) return;
    if (!(await ticket.place(bet.value))) return;
    resolved.current = RTP;
    timers.clearAll();
    setLast(null);
    const r = fresh(k, bet.value);
    setRound(r);
    void roll(r);
  }

  function cashOut() {
    if (!round || phase !== 'checkpoint') return;
    finish(round, 'cashed', round.prize * chanceOf(round));
  }

  function clear() {
    if (live || autoBusy) return;
    timers.clearAll();
    busyRef.current = false;
    setRound(null);
    setNote(null);
    setLast(null);
    setPhase('idle');
  }

  // ---------- Auto: always the best option, cash out at the target ----------

  async function playAuto(stake: number): Promise<number | null> {
    const goal = k;
    const tgt = target;
    if (!(await ticket.place(stake))) return null;
    setAutoBusy(true);
    setLast(null);
    setNote(null);
    let r = fresh(goal, stake);
    resolved.current = RTP;
    setRound(r);
    let outcome: Outcome = 'lost';
    let paid = 0;
    for (;;) {
      const n = r.k - r.banked;
      if (canBank(r.pot, r.t) && bestIsBank(n, r.pot, r.t)) {
        resolved.current = r.prize * chanceOf(r);
        r = doBank(r);
        setRound(r);
        setPhase('banking');
        if (!(await timers.wait(ms(600, 260)))) return null;
      } else {
        const face = 1 + rng.int(6);
        const next = landRoll(r, face);
        resolved.current = won(next) ? r.prize : lostRound(next) ? 0 : r.prize * chanceOf(next);
        setRound({ ...r, face: null, lost: 0 });
        setPhase('rolling');
        if (!(await timers.wait(ms(600, 420)))) return null;
        r = next;
        setRound(r);
        setPhase('landed');
        if (!(await timers.wait(ms(600, 260)))) return null;
        if (won(r)) {
          outcome = 'won';
          paid = r.prize;
          break;
        }
        if (lostRound(r)) break;
      }
      const cash = r.prize * chanceOf(r);
      if (tgt > 0 && cash >= tgt - 1e-12) {
        outcome = 'cashed';
        paid = cash;
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
    busyRef.current = false;
    setRound(null);
    setNote(null);
    setLast(null);
    setPhase('idle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto.mode]);

  // Changing a setting after a round clears the finished board to a preview.
  const change = (apply: () => void) => {
    if (busy) return;
    apply();
    if (phase === 'over') clear();
  };

  useHotkeys(
    {
      space: () => {
        if (isAuto) {
          if (auto.running) auto.stop();
          else if (!autoBusy && !bet.blocked) auto.start();
          return;
        }
        if (phase === 'checkpoint' && round) pickRoll(round);
        else if (phase === 'idle' || phase === 'over') void start();
      },
      cashOut: () => (!isAuto ? cashOut() : undefined),
    },
    !infoOpen,
  );

  // ---------- What the board shows ----------

  const r = round ?? fresh(k, bet.value);
  const outcome = phase === 'over' ? r.outcome : null;
  const n = r.k - r.banked;
  const settled = phase === 'checkpoint' || phase === 'over' || phase === 'landed' || phase === 'banking' || !round;
  let winNow = round ? chanceOf(r) : winChance(k, 0, TURNS);
  if (outcome === 'won') winNow = 1;
  else if (outcome === 'lost') winNow = 0;
  else if (outcome === 'cashed') winNow = r.paid / r.prize;
  const cash = phase === 'over' ? r.paid : r.prize * winNow;
  const vol = volatilityOf(k);
  const tumbling = phase === 'rolling';
  const turnNo = TURNS - r.t + 1;

  // The state the player decides at, for the Roll / Bank buttons.
  const deciding = !isAuto && phase === 'checkpoint' && round !== null;
  const rc = deciding ? rollChance(n, r.pot, r.t) : 0;
  const bc = deciding ? bankChance(n, r.pot, r.t) : 0;
  const bankOk = deciding && canBank(r.pot, r.t);

  let status = `Reach ${k} in ${TURNS} turns`;
  let tone: StatusTone = 'idle';
  if (phase === 'rolling') {
    status = isAuto ? `Autobet, turn ${turnNo}` : 'Rolling…';
    tone = 'live';
  } else if (round && (phase === 'landed' || phase === 'checkpoint' || phase === 'banking' || phase === 'over')) {
    tone = phase === 'over' ? (r.paid > 0 ? 'won' : 'lost') : 'live';
    if (phase === 'over' && outcome === 'cashed') status = `Cashed out with pot ${r.pot}`;
    else if (r.last === 'bank') status = `Banked ${r.banked}: need ${n} more`;
    else if (r.last === 'wipe') status = r.t === 0 ? `Wiped on turn ${TURNS}: need ${n}` : `Wiped! Turn ${turnNo} of ${TURNS}`;
    else if (r.last === 'score') status = outcome === 'won' || won(r) ? `Rolled ${r.face}: target reached` : `Rolled ${r.face}: pot is ${r.pot}`;
  } else if (isAuto && auto.running) {
    status = `Autobet${auto.remaining !== null ? `, ${auto.remaining} left` : ''}`;
    tone = 'live';
  }

  // One short plain line on why the chance moved (never on a finished or cashed round).
  let why: string | null = null;
  if (round && settled && phase !== 'rolling' && outcome !== 'cashed' && !won(r) && !lostRound(r)) {
    const d = dir(winNow, r.before);
    if (r.last === 'score') why = `Longer pot: chance ${d}`;
    else if (r.last === 'wipe') why = `Pot gone, turn used: chance ${d}`;
    else if (r.last === 'bank') why = `Score kept, turn used: chance ${d}`;
  } else if (!round) why = null;

  return (
    <GameLayout
      name="Bank It"
      accent={ACCENTS.amber}
      className="bank-game"
      panel={
        <>
          <ModeTabs auto={auto} disabled={live || autoBusy} />
          <BetField bet={bet} disabled={busy} />

          <Label hint={<VolBadge level={vol} />}>Target points</Label>
          <Chips
            label="Target points"
            options={TARGETS.map((v) => ({ value: v, label: `${v}`, title: `Prize ${fmtMult(startPrize(v))}` }))}
            value={k}
            disabled={busy}
            onChange={(v) => change(() => setK(v))}
          />

          {!isAuto ? (
            <>
              {phase === 'checkpoint' && round ? (
                <>
                  <ActionButton kind="cash" onClick={cashOut}>
                    Cash out <span>{formatAmount(r.stake * cash, 2)}</span>
                  </ActionButton>
                  <ActionButton kind="secondary" onClick={() => pickRoll(r)}>
                    {`Roll · ${fmtChance(rc)}`}
                  </ActionButton>
                  <ActionButton kind="secondary" disabled={!bankOk} title={bankOk ? undefined : r.t < 2 ? 'Last turn: bank would end the round' : 'Nothing in the pot'} onClick={() => pickBank(r)}>
                    {bankOk ? `Bank · ${fmtChance(bc)}` : 'Bank'}
                  </ActionButton>
                </>
              ) : (
                <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
                  {live ? 'Rolling…' : phase === 'over' ? 'Bet again' : 'Bet'}
                </ActionButton>
              )}
            </>
          ) : (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || autoBusy}>
              <Label hint={target > 0 && target >= startPrize(k) ? 'above the prize: plays to the end' : 'always the best option'}>Cash out at</Label>
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
          {bet.blocked && <p className="bank-note">{bet.blocked}</p>}
          {note && <p className="bank-note">{note}</p>}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />
      <ChanceBar p={winNow} label={phase === 'over' ? 'Win chance (round over)' : 'Win chance'} />
      <Readouts items={[{ label: 'Prize', value: fmtMult(r.prize), tone: 'prize' }]} />

      <Board className="bank-board">
        {isAuto && <InstantResult multiplier={last && !autoBusy ? last.multiplier : null} stake={last?.stake ?? 0} id={last?.id ?? 0} />}
        <div className="bank-wrap">
          <Tray
            k={r.k}
            banked={r.banked}
            pot={r.pot}
            lost={r.lost}
            turns={r.t}
            face={r.face}
            tumbling={tumbling}
            outcome={outcome}
            ms={ms(500, 200)}
          />
          <p className="bank-msg" aria-live="polite">
            {why ?? ''}
          </p>
        </div>
      </Board>

      {!isAuto && phase === 'over' && round?.outcome && (
        <RoundOver
          key={history[0]?.id}
          title={TITLE[round.outcome]}
          multiplier={round.paid}
          stake={round.stake}
          nextBet={bet.value}
          blocked={bet.blocked}
          onBetAgain={() => void start()}
          onClear={clear}
          placement="inline"
        />
      )}
      <Caption>Reach the target in five turns: 3 to 6 grows your pot, 1 or 2 wipes it, Bank keeps it.</Caption>

      {infoOpen && (
        <InfoModal title="Bank It" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>{RULE} You win the prize as soon as banked points plus the pot reach the target. You lose if a 1 or 2 wipes your pot on turn 5.</p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick the target, then Bet. The first roll happens at once.</li>
              <li>Each roll is one die. A 3, 4, 5 or 6 adds that many points to your pot (the light part of the bar). A 1 or 2 wipes the pot and uses up the turn.</li>
              <li>Between rolls, Bank turns the pot into score (the solid part) and uses up the turn. Bank is off on the last turn, because it could not win.</li>
              <li>Cash out (C) takes the current value instead. Space rolls. Auto always plays the better of Roll and Bank and cashes out at your target.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The Win chance is your chance of reaching the target from here, choosing Roll or Bank well each time. It depends on three things you can see: points still needed
              (the empty part of the bar), the pot, and the turns left. Every scoring roll makes the pot longer and the chance goes up. A wipe empties the pot and uses a turn, so it goes down.
              The Roll and Bank buttons show the chance each one leaves you.
            </p>
            <p>Two of the six faces wipe, so each roll has a one in three chance of losing the pot.</p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Backward induction (Bellman's principle) over (points needed n, pot p, turns left t): V(n, p, 0) = 0 and V(n, p, t) = max(Roll, Bank), with Roll = (2/6)·V(n, 0, t−1)
              + (1/6)·Σ<sub>d=3..6</sub> V(n, p+d, t) (a roll that reaches n counts 1) and Bank = V(n−p, 0, t−1). The table is exact. Best play reaches a target of 30 about{' '}
              {fmtChance(winChance(30, 0, TURNS))} of the time.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Prize = {(RTP * 100).toFixed(0)}% ÷ your chance at the start. Cash-out = prize × your chance now. Averaged over the die, your chance stays the same under best play, so any
              cash-out rule returns {(RTP * 100).toFixed(0)}% in the long run. Taking the option with the lower chance keeps your cash-out the same and raises the prize to cash-out ÷
              your new chance, so it changes risk, never value. No prize may exceed {MAX_WIN.toLocaleString('en-US')}×.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
