import { formatAmount } from '@originals/game-sdk';
import { useHost } from '@originals/game-sdk/react';
import {
  ACCENTS,
  ActionButton,
  AutoBetControls,
  BetField,
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
  type StatusTone,
} from '@originals/game-sdk/ui';
import { useEffect, useRef, useState } from 'react';
import Field, { type Mover } from './Board';
import {
  CASH_AT,
  FUSES,
  RTP,
  TARGETS,
  WAIT,
  autoRound,
  pickFor,
  prizeFor,
  start,
  take,
  volatilityOf,
  winChance,
  winner,
  type CashAt,
  type State,
} from './math';

type Phase = 'idle' | 'drawing' | 'checkpoint' | 'over';
type Outcome = 'win' | 'lose' | 'cashed';

interface Round {
  prize: number;
  stake: number;
  s: State;
  cash: number;
  outcome: Outcome | null;
}

interface Last {
  id: number;
  multiplier: number;
  stake: number;
}

const RULE = 'A random token moves each tick. Get your target in before 3 leave.';

/** One short plain line saying what the last tick changed (always under 9 tokens). */
function tickLine(s: State, id: number, was: State): string {
  const d = winChance(s) - winChance(was);
  const way = Math.abs(d) < 1e-12 ? 'same' : d > 0 ? 'up' : 'down';
  if (was.z[id] === WAIT) return `Entered: ${s.a} of ${s.k}, chance ${way}`;
  return `Token left: fuse ${s.f} of ${FUSES}, chance ${way}`;
}

function overTitle(r: Round): string {
  if (r.outcome === 'cashed') return 'Cashed out';
  return r.outcome === 'win' ? 'Target in, you win' : 'Third token left';
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);

  const [k, setK] = useState<number>(5);
  const [cashAt, setCashAt] = useState<CashAt>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [last, setLast] = useState<number | null>(null);
  const [mover, setMover] = useState<Mover | null>(null);
  const [line, setLine] = useState('');
  const [infoOpen, setInfoOpen] = useState(false);

  const [autoS, setAutoS] = useState<State | null>(null);
  const [autoK, setAutoK] = useState<number | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const [result, setResult] = useState<Last | null>(null);
  const seq = useRef(0);

  // The ticket reads only this ref, set synchronously at every transition (a
  // tick is decided the moment it starts), never rendered state.
  const resolved = useRef(0);
  const ticket = useTicket(() => resolved.current);

  // Manual: the token lifts for 350 ms, then walks for 700 ms; Turbo about 25%.
  const liftMs = eventMs(turbo.turbo, 350);
  const walkMs = eventMs(turbo.turbo, 700);
  const autoMs = turbo.turbo ? 70 : 260;
  const live = phase === 'drawing' || phase === 'checkpoint';

  // ---------- Manual ----------

  function finish(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setPhase('over');
  }

  function draw(r: Round) {
    const id = pickFor(r.s, rng.next());
    const s = take(r.s, id);
    const w = winner(s);
    const cash = w ? (w === 'you' ? r.prize : 0) : r.prize * winChance(s);
    resolved.current = cash;
    setPhase('drawing');
    setLast(null);
    setLine('');
    // The picked token lifts, then walks to its next room; the board changes
    // only when the walk starts, and the round is decided when it lands.
    setMover({ id, from: [r.s.z[id], r.s.sl[id]], phase: 'lift' });
    timers.after(liftMs, () => {
      const next = { ...r, s, cash };
      setRound(next);
      setMover({ id, from: [r.s.z[id], r.s.sl[id]], phase: 'walk' });
      timers.after(walkMs + 40, () => {
        setMover(null);
        setLast(id);
        if (w) return finish(next, w === 'you' ? 'win' : 'lose', cash);
        setLine(tickLine(s, id, r.s));
        setPhase('checkpoint');
        track({ type: 'checkpoint', multiplier: cash, winChance: winChance(s) });
      });
    });
  }

  async function startRound() {
    if (live || autoBusy || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    resolved.current = RTP;
    timers.clearAll();
    setAutoS(null);
    setAutoK(null);
    setResult(null);
    setLast(null);
    const r: Round = { prize: prizeFor(k), stake: bet.value, s: start(k), cash: RTP, outcome: null };
    setRound(r);
    draw(r);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', round.cash);
  }

  function clear() {
    if (live || autoBusy) return;
    timers.clearAll();
    setRound(null);
    setLast(null);
    setMover(null);
    setAutoS(null);
    setAutoK(null);
    setResult(null);
    setLine('');
    setPhase('idle');
  }

  // Changing a setting after a round clears the finished board to a preview.
  function change(apply: () => void) {
    apply();
    if (phase === 'over' || autoS || result) clear();
  }

  // ---------- Auto ----------

  async function playAuto(stake: number): Promise<number | null> {
    const target = k;
    if (!(await ticket.place(stake))) return null;
    const res = autoRound(target, cashAt, () => rng.next());
    resolved.current = res.multiplier;
    setAutoBusy(true);
    setRound(null);
    setPhase('idle');
    setResult(null);
    setLast(null);
    setAutoK(target);
    setAutoS(start(target));
    for (const step of res.steps) {
      if (!(await timers.wait(autoMs))) break;
      setAutoS(step.s);
      setLast(step.id);
      if (!(await timers.wait(autoMs * 0.5))) break;
    }
    ticket.settle(res.multiplier);
    pushHistory(res.multiplier);
    setResult({ id: ++seq.current, multiplier: res.multiplier, stake });
    setAutoBusy(false);
    return res.multiplier;
  }

  const auto = useAutoBet({ bet, play: playAuto, turbo: turbo.turbo });
  const isAuto = auto.mode === 'auto';
  const locked = live || autoBusy || auto.running;

  // Switching Manual / Auto starts from a clean board.
  useEffect(() => {
    timers.clearAll();
    setRound(null);
    setAutoS(null);
    setAutoK(null);
    setLast(null);
    setMover(null);
    setResult(null);
    setLine('');
    setPhase('idle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto.mode]);

  useHotkeys(
    {
      space: () => {
        if (isAuto) {
          if (auto.running) auto.stop();
          else if (!autoBusy && !bet.blocked) auto.start();
          return;
        }
        if (phase === 'checkpoint' && round) draw(round);
        else if (phase === 'idle' || phase === 'over') void startRound();
      },
      cashOut,
    },
    !infoOpen,
  );

  // ---------- What the board shows ----------

  const shownK = isAuto ? (autoK ?? k) : (round?.s.k ?? k);
  const s = isAuto ? (autoS ?? start(shownK)) : (round?.s ?? start(shownK));
  const chance = winChance(s);
  const prize = round?.prize ?? prizeFor(k);
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const over = isAuto ? !!result && !autoBusy : phase === 'over';
  const decided = winner(s) !== null;
  const vol = volatilityOf(k);

  let status = `Get ${k} in before 3 leave`;
  let tone: StatusTone = 'idle';
  if (isAuto) {
    if (autoBusy || auto.running) {
      status = `Autobet${auto.remaining !== null ? ` · ${auto.remaining} left` : ''}`;
      tone = 'live';
    } else if (result) {
      status = `${result.multiplier > 0 ? 'Won' : 'Lost'} ${fmtMult(result.multiplier)}`;
      tone = result.multiplier > 0 ? 'won' : 'lost';
    }
  } else if (phase === 'drawing') {
    status = 'Picking a token…';
    tone = 'live';
  } else if (phase === 'checkpoint') {
    status = line;
    tone = 'live';
  } else if (phase === 'over' && round) {
    status =
      round.outcome === 'cashed'
        ? `Cashed out at ${s.a} of ${s.k}`
        : round.outcome === 'win'
          ? `Target in: ${s.k} of ${s.k}`
          : `Fuse ${s.f} of ${FUSES}: round over`;
    tone = round.cash > 0 ? 'won' : 'lost';
  }

  return (
    <GameLayout
      name="Leak"
      accent={ACCENTS.violet}
      className="lk-game"
      panel={
        <>
          <ModeTabs auto={auto} disabled={live || autoBusy} />
          <BetField bet={bet} disabled={locked} />

          <Label hint={<VolBadge level={vol} />}>Tokens to get in</Label>
          <Chips
            label="Target"
            options={TARGETS.map((v) => ({ value: v, label: String(v), title: `Get ${v} tokens into your room` }))}
            value={k}
            disabled={locked}
            onChange={(v) => change(() => setK(v))}
          />

          {!isAuto ? (
            phase === 'checkpoint' ? (
              <>
                <ActionButton kind="cash" onClick={cashOut}>
                  Cash out <span>{formatAmount(stake * cash, 2)}</span>
                </ActionButton>
                <ActionButton kind="secondary" onClick={() => round && draw(round)}>
                  Next tick
                </ActionButton>
              </>
            ) : (
              <ActionButton disabled={live || !!bet.blocked} onClick={() => void startRound()}>
                {phase === 'drawing' ? 'Moving…' : phase === 'over' ? 'Bet again' : 'Bet'}
              </ActionButton>
            )
          ) : (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || autoBusy}>
              <Label hint={cashAt === null ? 'until the round is decided' : `if it gets to ${fmtMult(cashAt)}`}>Cash out at</Label>
              <Chips
                label="Auto cash-out"
                options={CASH_AT.map((v) => ({ value: v ?? 0, label: v === null ? 'End' : `${v}×` }))}
                value={cashAt ?? 0}
                disabled={autoBusy || auto.running}
                onChange={(v) => change(() => setCashAt(v === 0 ? null : (v as CashAt)))}
              />
            </AutoBetControls>
          )}
          {bet.blocked && <p className="lk-blocked">{bet.blocked}</p>}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />

      <Readouts
        items={[
          { label: 'Win chance', value: fmtChance(chance), tone: 'chance' },
          { label: 'Prize', value: fmtMult(isAuto ? prizeFor(shownK) : prize), tone: 'prize' },
        ]}
      />

      <Board className="lk-board">
        {isAuto && <InstantResult multiplier={result && !autoBusy ? result.multiplier : null} stake={result?.stake ?? 0} id={result?.id ?? 0} />}
        <Field
          s={s}
          last={!isAuto && phase === 'idle' ? null : last}
          mover={isAuto ? null : mover}
          liftMs={liftMs}
          walkMs={isAuto ? autoMs : walkMs}
          chance={chance}
          done={decided && over}
        />
        {!isAuto && phase === 'over' && round?.outcome && (
          <RoundOver
            key={history[0]?.id}
            title={overTitle(round)}
            multiplier={round.cash}
            stake={round.stake}
            nextBet={bet.value}
            blocked={bet.blocked}
            onBetAgain={() => void startRound()}
            onClear={clear}
            placement="center"
          />
        )}
      </Board>

      <Caption>{RULE}</Caption>

      {infoOpen && (
        <InfoModal title="Leak" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              Get your target number of tokens into your room before 3 tokens leave it. 17 tokens start: 14 waiting and 3 already in your room. Only new
              arrivals count towards the target.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick the target, then press Bet. The first tick happens straight away.</li>
              <li>Each tick one random token that is still in play lifts and moves one room on. A green waiting token enters your room and turns red. A red token in your room leaves and fills the next exit slot.</li>
              <li>After every tick you can cash out (C) or run the next tick (Space).</li>
              <li>Auto plays whole rounds with the bet and stop rules you set.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The next tick lets a token in with chance (green tokens) ÷ (tokens in play), and costs a fuse with chance (red tokens) ÷ (tokens in
              play). The bar at the bottom is your chance to get the target in. It rises with every arrival and falls with every departure: when a
              token leaves, the room has one red token fewer, but one of your three fuses is gone for good, and that matters more.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Tokens are picked uniformly, so the chance is computed exactly from the tokens waiting, the tokens in your room, the arrivals still needed
              and the fuses used. From the start you win with {fmtChance(winChance(start(k)))} at the target now selected.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              A win pays {(RTP * 100).toFixed(0)}% ÷ P(win). The cash-out is the prize × your chance now, a martingale, so cashing out at any point or
              playing to the end both return exactly {(RTP * 100).toFixed(0)}% in the long run.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
