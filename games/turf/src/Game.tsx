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
import Field from './Board';
import {
  CASH_AT,
  DEFAULT_TARGET,
  RTP,
  TARGETS,
  arrows,
  autoRound,
  cashOf,
  count,
  houseNeed,
  prizeFor,
  start,
  tick,
  volatilityOf,
  winChance,
  winner,
  type CashAt,
  type State,
  type Tick,
} from './math';

type Phase = 'idle' | 'ticking' | 'checkpoint' | 'over';
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

const NBSP = '\u00a0';
const RULE = 'Paint spreads along a random arrow; walled-off pockets fill; hold your target cells.';

// The seven status lines (each one template string, under 9 tokens), plus the
// idle line before a bet and the cash-out line.
// A wall-off can carry a paint past its target (a pocket fills whole), so counts shown stop at the target.
const youN = (s: State) => Math.min(count(s.you), s.k);
const houseN = (s: State) => Math.min(count(s.house), houseNeed(s.k));
const line = {
  press: () => 'Press Spread to start',
  you: (s: State) => `You spread: ${youN(s)} of ${s.k}`,
  house: (s: State) => `House spreads: ${houseN(s)} of ${houseNeed(s.k)}`,
  youWall: (n: number) => `You wall off ${n} cell${n === 1 ? '' : 's'}`,
  houseWall: (n: number) => `House walls off ${n} cell${n === 1 ? '' : 's'}`,
  youHold: (s: State) => `You hold ${youN(s)}: win`,
  houseHold: (s: State) => `House holds ${houseN(s)}: lost`,
  cashed: (s: State) => `Cashed out at ${youN(s)} of ${s.k}`,
};

/** The line for the cell just filled. */
const fillLine = (t: Tick) => (t.arrow.paint === 'you' ? line.you(t.filled) : line.house(t.filled));
/** The line for the pocket just captured. */
const wallLine = (t: Tick) => (t.captured!.paint === 'you' ? line.youWall(t.captured!.cells.length) : line.houseWall(t.captured!.cells.length));
const endLine = (s: State) => (winner(s) === 'you' ? line.youHold(s) : line.houseHold(s));

function overTitle(r: Round): string {
  if (r.outcome === 'cashed') return 'Cashed out';
  return r.outcome === 'win' ? 'You hold the turf' : 'The house holds the turf';
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);

  const [k, setK] = useState<number>(DEFAULT_TARGET);
  const [cashAt, setCashAt] = useState<CashAt>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [last, setLast] = useState<number[]>([]);
  const [scan, setScan] = useState<number | null>(null);
  const [status, setStatus] = useState('');
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

  // Manual: the light runs for 700 ms, the filled cell is held for 450 ms and a
  // capture for 800 ms; Turbo about a quarter of that (docs/STYLE.md).
  const scanMs = eventMs(turbo.turbo, 700);
  const fillMs = eventMs(turbo.turbo, 450);
  const capMs = eventMs(turbo.turbo, 800);
  const autoScan = turbo.turbo ? 70 : 320;
  const autoFill = turbo.turbo ? 60 : 260;
  const autoCap = turbo.turbo ? 90 : 420;
  const live = phase === 'ticking' || phase === 'checkpoint';

  // ---------- Manual ----------

  function finish(r: Round, outcome: Outcome, cash: number, s: State) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, s, outcome, cash });
    setPhase('over');
  }

  function spread(r: Round) {
    const t = tick(r.s, rng.next());
    const cash = cashOf(t.after, r.prize);
    resolved.current = cash;
    setPhase('ticking');
    setStatus(NBSP); // blank while the light runs: the pick is the event
    // A light hops across the arrows and stops on the one picked.
    const n = arrows(r.s).length;
    const hops = 7;
    for (let h = 0; h <= hops; h++) {
      const at = (((t.index - (hops - h)) % n) + n * 8) % n;
      timers.after((scanMs * h) / (hops + 1), () => setScan(at));
    }
    // The cell fills only when the light stops.
    timers.after(scanMs, () => {
      setScan(null);
      setLast([t.arrow.to]);
      setStatus(fillLine(t));
      const afterFill = { ...r, s: t.filled, cash: cashOf(t.filled, r.prize) };
      setRound(afterFill);
      const decided = winner(t.filled);
      if (decided) {
        timers.after(fillMs, () => {
          setStatus(endLine(t.filled));
          finish(afterFill, decided === 'you' ? 'win' : 'lose', cash, t.filled);
        });
        return;
      }
      if (!t.captured) {
        timers.after(fillMs, () => {
          setPhase('checkpoint');
          track({ type: 'checkpoint', multiplier: cash, winChance: winChance(t.after) });
        });
        return;
      }
      // A walled-off pocket fills with the paint that surrounds it: slow and plain.
      timers.after(fillMs, () => {
        const next = { ...r, s: t.after, cash };
        setRound(next);
        setLast([t.arrow.to, ...t.captured!.cells]);
        setStatus(wallLine(t));
        const w = winner(t.after);
        timers.after(capMs, () => {
          if (w) {
            setStatus(endLine(t.after));
            return finish(next, w === 'you' ? 'win' : 'lose', cash, t.after);
          }
          setPhase('checkpoint');
          track({ type: 'checkpoint', multiplier: cash, winChance: winChance(t.after) });
        });
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
    setLast([]);
    setScan(null);
    // The bet sets up the grid and waits: no tick yet.
    const r: Round = { prize: prizeFor(k), stake: bet.value, s: start(k), cash: RTP, outcome: null };
    setRound(r);
    setStatus(line.press());
    setPhase('checkpoint');
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    setStatus(line.cashed(round.s));
    finish(round, 'cashed', round.cash, round.s);
  }

  function clear() {
    if (live || autoBusy) return;
    timers.clearAll();
    setRound(null);
    setLast([]);
    setScan(null);
    setAutoS(null);
    setAutoK(null);
    setResult(null);
    setStatus('');
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
    setLast([]);
    setAutoK(target);
    setAutoS(start(target));
    setStatus(line.press());
    for (const t of res.ticks) {
      if (!(await timers.wait(autoScan))) break;
      setAutoS(t.filled);
      setLast([t.arrow.to]);
      setStatus(fillLine(t));
      if (!(await timers.wait(autoFill))) break;
      if (t.captured) {
        setAutoS(t.after);
        setLast([t.arrow.to, ...t.captured.cells]);
        setStatus(wallLine(t));
        if (!(await timers.wait(autoCap))) break;
      }
    }
    const end = res.ticks[res.ticks.length - 1].after;
    setStatus(res.outcome === 'cashed' ? line.cashed(end) : endLine(end));
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
    setLast([]);
    setScan(null);
    setResult(null);
    setStatus('');
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
        if (phase === 'checkpoint' && round) spread(round);
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
  const vol = volatilityOf(k);

  let text = `Hold ${k} cells to win`;
  let tone: StatusTone = 'idle';
  if (isAuto) {
    if (autoBusy || auto.running) {
      text = status || line.press();
      tone = 'live';
    } else if (result) {
      text = status;
      tone = result.multiplier > 0 ? 'won' : 'lost';
    }
  } else if (phase === 'ticking' || phase === 'checkpoint') {
    text = status || line.press();
    tone = 'live';
  } else if (phase === 'over' && round) {
    text = status;
    tone = round.cash >= 1 ? 'won' : 'lost';
  }

  return (
    <GameLayout
      name="Turf"
      accent={ACCENTS.blue}
      className="tf-game"
      panel={
        <>
          <ModeTabs auto={auto} disabled={live || autoBusy} />
          <BetField bet={bet} disabled={locked} />

          <Label hint={<VolBadge level={vol} />}>Cells to hold</Label>
          <Chips
            label="Cells to hold"
            options={TARGETS.map((v) => ({ value: v, label: String(v), title: `Hold ${v} of the 16 cells` }))}
            value={k}
            disabled={locked}
            onChange={(v) => change(() => setK(v))}
          />

          {!isAuto ? (
            live ? (
              <>
                <ActionButton kind="secondary" disabled={phase !== 'checkpoint'} onClick={() => round && spread(round)}>
                  Spread
                </ActionButton>
                <ActionButton kind="cash" disabled={phase !== 'checkpoint'} onClick={cashOut}>
                  Cash out <span>{formatAmount(stake * cash, 2)}</span>
                </ActionButton>
              </>
            ) : (
              <ActionButton disabled={!!bet.blocked} onClick={() => void startRound()}>
                {phase === 'over' ? 'Bet again' : 'Bet'}
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
          {bet.blocked && <p className="tf-blocked">{bet.blocked}</p>}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={text} tone={tone} history={history} />

      <ChanceBar p={chance} />
      <Readouts items={[{ label: 'Prize', value: fmtMult(isAuto ? prizeFor(shownK) : prize), tone: 'prize' }]} />

      <Board className="tf-board">
        {isAuto && <InstantResult multiplier={result && !autoBusy ? result.multiplier : null} stake={result?.stake ?? 0} id={result?.id ?? 0} />}
        <Field s={s} last={!isAuto && phase === 'idle' ? [] : last} scan={scan} done={winner(s) !== null || (!isAuto && phase === 'over')} />
      </Board>

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
          placement="inline"
        />
      )}

      <Caption>{RULE}</Caption>

      {infoOpen && (
        <InfoModal title="Turf" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              Two paints start in opposite corners of a 4 by 4 grid: yours (blue) top-left, the house (grey) bottom-right. Hold your target number of the 16 cells
              before the house holds {houseNeed(k)} of them (17 minus your target). A tie cannot happen, and some cells may stay empty.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick the number of cells to hold, then press Bet. The grid is set up; nothing is painted yet.</li>
              <li>Press Spread (Space). One arrow is picked at random from all the arrows on the board and its empty cell takes that paint.</li>
              <li>After every spread you can cash out (C) or spread again.</li>
              <li>An empty pocket that only one paint touches is certain to go to that paint, so it fills at once (a wall-off).</li>
              <li>Auto plays whole rounds with the bet and stop rules you set.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              An arrow is a small triangle on the border between a painted cell and an empty one, in the paint&apos;s colour. Each tick every arrow is equally likely,
              so the next cell is yours with chance (your arrows) ÷ (all arrows). The bar is your chance to hold your target from here: it rises when your paint
              spreads or boxes the house in, and falls when the house does.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Two-type competitive growth (a Richardson model). P(you, house) = Σ over empty cells and paints of (arrows ÷ total) · P(next state), computed exactly
              over the cells each paint holds, with {fmtChance(winChance(start(k)))} at the target now selected. A wall-off leaves every chance unchanged, so it only
              stops the round from running ticks whose result is already fixed.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              A win pays {(RTP * 100).toFixed(0)}% ÷ P(win). The cash-out is the prize × your chance now, a martingale, so cashing out at any point or playing to the
              end both return exactly {(RTP * 100).toFixed(0)}% in the long run.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
