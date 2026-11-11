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
import Field, { type Spin } from './Board';
import {
  CASH_AT,
  EMPTY,
  RTP,
  SHARES,
  addPoint,
  autoRound,
  isYours,
  needServer,
  needYou,
  prizeFor,
  volatilityOf,
  winChance,
  winner,
  type CashAt,
  type Score,
} from './math';

type Phase = 'idle' | 'spinning' | 'checkpoint' | 'over';
type Outcome = 'win' | 'lose' | 'cashed';

interface Round {
  p: number;
  prize: number;
  stake: number;
  x: Score;
  cash: number;
  outcome: Outcome | null;
}

interface Last {
  id: number;
  multiplier: number;
  stake: number;
}

const RULE = 'Win four points and lead by two before the server does.';
const pct = (p: number) => `${Math.round(p * 100)}%`;

/** One short plain line saying what the last point changed (always under 9 tokens). */
function pointLine(x: Score, you: boolean): string {
  const ny = needYou(x);
  const ns = needServer(x);
  if (ny === 2 && ns === 2) return 'Level: both need 2 more';
  return `${you ? 'Your point' : "Server's point"}: you need ${ny}, server ${ns}`;
}

function overTitle(r: Round): string {
  if (r.outcome === 'cashed') return 'Cashed out';
  return r.outcome === 'win' ? 'You win the game' : 'Server wins the game';
}

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);

  const [p, setP] = useState<number>(0.65);
  const [cashAt, setCashAt] = useState<CashAt>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [spin, setSpin] = useState<Spin | null>(null);
  const [line, setLine] = useState('');
  const [infoOpen, setInfoOpen] = useState(false);

  const [autoX, setAutoX] = useState<Score | null>(null);
  const [autoP, setAutoP] = useState<number | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const [last, setLast] = useState<Last | null>(null);
  const seq = useRef(0);
  const restU = useRef(0);

  // The ticket reads only this ref, set synchronously at every transition (a
  // point is decided the moment it is spun), never rendered state.
  const resolved = useRef(0);
  const ticket = useTicket(() => resolved.current);

  // Manual: the pointer spins for about 600 ms; Turbo about 150 ms (docs/STYLE.md).
  const spinMs = eventMs(turbo.turbo, 700);
  const autoSpinMs = turbo.turbo ? 70 : 260;
  const live = phase === 'spinning' || phase === 'checkpoint';

  // ---------- Manual ----------

  function finish(r: Round, outcome: Outcome, cash: number) {
    ticket.settle(cash);
    pushHistory(cash);
    setRound({ ...r, outcome, cash });
    setPhase('over');
  }

  function point(r: Round) {
    const u = rng.next();
    const you = isYours(u, r.p);
    const x = addPoint(r.x, you);
    const w = winner(x);
    const cash = w ? (w === 'you' ? r.prize : 0) : r.prize * winChance(x, r.p);
    resolved.current = cash;
    const id = ++seq.current;
    const from = restU.current;
    restU.current = u;
    setSpin({ id, u, from, you, ms: spinMs, landed: false });
    setPhase('spinning');
    // The score changes only when the pointer stops.
    timers.after(spinMs, () => {
      setSpin({ id, u, from, you, ms: spinMs, landed: true });
      const next = { ...r, x, cash };
      setRound(next);
      if (w) {
        setLine('');
        return finish(next, w === 'you' ? 'win' : 'lose', cash);
      }
      setLine(pointLine(x, you));
      setPhase('checkpoint');
      track({ type: 'checkpoint', multiplier: cash, winChance: winChance(x, r.p) });
    });
  }

  async function start() {
    if (live || autoBusy || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    resolved.current = RTP;
    timers.clearAll();
    setAutoX(null);
    setAutoP(null);
    setLast(null);
    const r: Round = { p, prize: prizeFor(p), stake: bet.value, x: EMPTY, cash: RTP, outcome: null };
    setRound(r);
    point(r);
  }

  function cashOut() {
    if (phase !== 'checkpoint' || !round) return;
    finish(round, 'cashed', round.cash);
  }

  function clear() {
    if (live || autoBusy) return;
    timers.clearAll();
    setRound(null);
    setSpin(null);
    setAutoX(null);
    setAutoP(null);
    setLast(null);
    setLine('');
    restU.current = 0;
    setPhase('idle');
  }

  // Changing a setting after a round clears the finished board to a preview.
  function change(apply: () => void) {
    apply();
    if (phase === 'over' || autoX || last) clear();
  }

  // ---------- Auto ----------

  async function playAuto(stake: number): Promise<number | null> {
    const share = p;
    if (!(await ticket.place(stake))) return null;
    const us: number[] = [];
    const res = autoRound(share, cashAt, () => {
      const u = rng.next();
      us.push(u);
      return u;
    });
    resolved.current = res.multiplier;
    setAutoBusy(true);
    setRound(null);
    setPhase('idle');
    setLast(null);
    setAutoP(share);
    setAutoX(EMPTY);
    for (let i = 0; i < res.states.length; i++) {
      const id = ++seq.current;
      const from = restU.current;
      restU.current = us[i];
      const you = isYours(us[i], share);
      setSpin({ id, u: us[i], from, you, ms: autoSpinMs, landed: false });
      if (!(await timers.wait(autoSpinMs))) break;
      setSpin({ id, u: us[i], from, you, ms: autoSpinMs, landed: true });
      setAutoX(res.states[i]);
      if (!(await timers.wait(autoSpinMs * 0.5))) break;
    }
    ticket.settle(res.multiplier);
    pushHistory(res.multiplier);
    setLast({ id: ++seq.current, multiplier: res.multiplier, stake });
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
    setAutoX(null);
    setAutoP(null);
    setSpin(null);
    setLast(null);
    setLine('');
    restU.current = 0;
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
        if (phase === 'checkpoint' && round) point(round);
        else if (phase === 'idle' || phase === 'over') void start();
      },
      cashOut,
    },
    !infoOpen,
  );

  // ---------- What the board shows ----------

  const shownP = isAuto ? (autoP ?? p) : (round?.p ?? p);
  const x = isAuto ? (autoX ?? EMPTY) : (round?.x ?? EMPTY);
  const chance = winChance(x, shownP);
  const prize = round?.prize ?? prizeFor(p);
  const cash = round?.cash ?? RTP;
  const stake = round?.stake ?? bet.value;
  const over = isAuto ? !!last && !autoBusy : phase === 'over';
  const decided = winner(x) !== null;
  const vol = volatilityOf(p);
  const points = x.r + x.s;

  let status = 'First to 4 points, two clear';
  let tone: StatusTone = 'idle';
  if (isAuto) {
    if (autoBusy || auto.running) {
      status = `Autobet${auto.remaining !== null ? ` · ${auto.remaining} left` : ''}`;
      tone = 'live';
    } else if (last) {
      status = `${last.multiplier > 0 ? 'Won' : 'Lost'} ${fmtMult(last.multiplier)}`;
      tone = last.multiplier > 0 ? 'won' : 'lost';
    }
  } else if (phase === 'spinning') {
    status = 'Spinning the point…';
    tone = 'live';
  } else if (phase === 'checkpoint') {
    status = line;
    tone = 'live';
  } else if (phase === 'over' && round) {
    status = round.outcome === 'cashed' ? `Cashed out after ${points} points` : `${overTitle(round)}, ${x.r} to ${x.s}`;
    tone = round.cash > 0 ? 'won' : 'lost';
  }

  return (
    <GameLayout
      name="Break Point"
      accent={ACCENTS.amber}
      className="bp-game"
      panel={
        <>
          <ModeTabs auto={auto} disabled={live || autoBusy} />
          <BetField bet={bet} disabled={locked} />

          <Label hint={<VolBadge level={vol} />}>Server wins each point</Label>
          <Chips
            label="Server's share of points"
            options={SHARES.map((v) => ({ value: v, label: pct(v), title: `The server wins ${pct(v)} of points` }))}
            value={p}
            disabled={locked}
            onChange={(v) => change(() => setP(v))}
          />

          {!isAuto ? (
            phase === 'checkpoint' ? (
              <>
                <ActionButton kind="cash" onClick={cashOut}>
                  Cash out <span>{formatAmount(stake * cash, 2)}</span>
                </ActionButton>
                <ActionButton kind="secondary" onClick={() => round && point(round)}>
                  Next point
                </ActionButton>
              </>
            ) : (
              <ActionButton disabled={live || !!bet.blocked} onClick={() => void start()}>
                {phase === 'spinning' ? 'Spinning…' : phase === 'over' ? 'Bet again' : 'Bet'}
              </ActionButton>
            )
          ) : (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || autoBusy}>
              <Label hint={cashAt === null ? 'until the game is decided' : `if it gets to ${fmtMult(cashAt)}`}>Cash out at</Label>
              <Chips
                label="Auto cash-out"
                options={CASH_AT.map((v) => ({ value: v ?? 0, label: v === null ? 'End' : `${v}×` }))}
                value={cashAt ?? 0}
                disabled={autoBusy || auto.running}
                onChange={(v) => change(() => setCashAt(v === 0 ? null : (v as CashAt)))}
              />
            </AutoBetControls>
          )}
          {bet.blocked && <p className="bp-blocked">{bet.blocked}</p>}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />

      <Readouts
        items={[
          { label: 'Win the game', value: fmtChance(chance), tone: 'chance' },
          { label: 'Prize', value: fmtMult(isAuto ? prizeFor(shownP) : prize), tone: 'prize' },
        ]}
      />

      <Board className="bp-board">
        {isAuto && <InstantResult multiplier={last && !autoBusy ? last.multiplier : null} stake={last?.stake ?? 0} id={last?.id ?? 0} />}
        <Field x={x} p={shownP} chance={chance} spin={!isAuto && phase === 'idle' ? null : spin} done={decided && over} />
        {!isAuto && phase === 'over' && round?.outcome && (
          <RoundOver
            key={history[0]?.id}
            title={overTitle(round)}
            multiplier={round.cash}
            stake={round.stake}
            nextBet={bet.value}
            blocked={bet.blocked}
            onBetAgain={() => void start()}
            onClear={clear}
            placement="center"
          />
        )}
      </Board>

      <Caption>{RULE}</Caption>

      {infoOpen && (
        <InfoModal title="Break Point" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              You are the returner. Each point goes to the server with the red share of the spinner and to you with the green share. You win the game by
              winning four points and leading by two.
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick how often the server wins a point, then press Bet. The first point is spun straight away.</li>
              <li>After every point you can cash out (C) or spin the next point (Space).</li>
              <li>
                Each side shows its points and the fewest more points it needs. When both have three or more points, a lead of one point is not enough, so
                a point for one side raises the other side's need by one.
              </li>
              <li>Auto plays whole games with the bet and stop rules you set.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The spinner's green arc is exactly your chance to win the next point. The bar at the bottom is your chance to win the whole game; it rises
              when you win a point and falls when the server does. Fewer points needed means a higher chance.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              With the server's share p and yours q = 1 − p, level scores at two or more each are equivalent, and from level you win with chance
              q<sup>2</sup> / (q<sup>2</sup> + p<sup>2</sup>) (a split of two points returns to level). Every other score follows from W(r, s) = q W(r+1, s) +
              p W(r, s+1), computed exactly. From 0-0 you win with {fmtChance(winChance(EMPTY, p))} at the server share now selected.
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
