import { formatAmount } from '@originals/game-sdk';
import { useHost } from '@originals/game-sdk/react';
import {
  ACCENTS,
  ActionButton,
  BetField,
  Board,
  Caption,
  Chips,
  GameLayout,
  InfoModal,
  InfoSection,
  Label,
  PanelFoot,
  Readouts,
  RoundOver,
  StageTop,
  eventMs,
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
import { useCallback, useEffect, useRef, useState } from 'react';
import Tower, { type DropAnim, type ToppleAnim } from './Tower';
import {
  MODES,
  MODE_NAMES,
  RTP,
  drawOffset,
  failingLevel,
  landsSafely,
  nextOdds,
  stopReason,
  type Mode,
} from './math';

type Phase = 'idle' | 'dropping' | 'checkpoint' | 'toppling' | 'over';

interface Round {
  bet: number;
  mode: Mode;
  xs: number[];
  ps: number[];
  /** Cash-out multiplier now: RTP × Π 1/p. */
  mult: number;
}

const MODE_LABEL: Record<Mode, string> = { low: 'Low', medium: 'Med', high: 'High', extreme: 'Max' };

export default function Game() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turboState = useTurbo();
  const turbo = turboState.turbo;
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);

  const [mode, setMode] = useState<Mode>('medium');
  const [autoText, setAutoText] = useState('');
  const [infoOpen, setInfoOpen] = useState(false);

  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [drop, setDrop] = useState<DropAnim | null>(null);
  const [topple, setTopple] = useState<ToppleAnim | null>(null);
  const [result, setResult] = useState<{ mult: number; win: boolean; amount: number } | null>(null);

  // What the open bet is worth if the game is closed now (the outcome of a drop
  // in flight is already decided).
  // It is set synchronously at every transition (RTP when a bet is placed, then
  // the decided result of each drop as it starts), never derived from rendered
  // state, so it can't be one render stale.
  const banked = useRef(0);
  const ticket = useTicket(() => banked.current);

  const spec = MODES[round?.mode ?? mode];
  const xs = round?.xs ?? [];
  const odds = nextOdds(xs, spec.s);
  const inRound = phase === 'dropping' || phase === 'checkpoint' || phase === 'toppling';
  const autoTarget = parseFloat(autoText) || 0;
  // A drop is a swing then a fall: about one event (docs/STYLE.md) in all, quicker with Turbo.
  const swingMs = eventMs(turbo, 700);
  const fallMs = eventMs(turbo, 300);

  // Settles the bet. A loss settles as the topple starts; the fall is only the show.
  const finish = useCallback(
    (r: Round, m: number, next: Phase = 'over') => {
      banked.current = 0;
      ticket.settle(m);
      pushHistory(m);
      setPhase(next);
      setResult({ mult: m, win: m > 0, amount: r.bet * m });
    },
    [ticket, pushHistory],
  );

  const cashOut = useCallback(
    (r: Round) => {
      finish(r, r.mult);
    },
    [finish],
  );

  const dropNext = useCallback(
    (r: Round) => {
      const { s } = MODES[r.mode];
      const o = nextOdds(r.xs, s);
      const d = drawOffset(s, rng.next());
      const safe = landsSafely(o, d);
      const top = r.xs.length ? r.xs[r.xs.length - 1] : 0;
      const nextXs = [...r.xs, top + d];
      banked.current = safe ? r.mult / o.p : 0;
      setPhase('dropping');
      setDrop({ d, t0: performance.now(), swingMs, fallMs });

      timers.after(swingMs + fallMs, () => {
        setDrop(null);
        if (!safe) {
          const fail = failingLevel(nextXs) ?? { level: r.xs.length, dir: d > 0 ? 1 : -1 };
          const lost: Round = { ...r, xs: nextXs, ps: [...r.ps, o.p] };
          setRound(lost);
          const ms = eventMs(turbo, 800);
          setTopple({ ...fail, t0: performance.now(), ms });
          finish(lost, 0, 'toppling');
          timers.after(ms, () => setPhase('over'));
          return;
        }
        const next: Round = { ...r, xs: nextXs, ps: [...r.ps, o.p], mult: r.mult / o.p };
        setRound(next);
        const after = nextOdds(nextXs, s);
        const reason = stopReason(r.mode, nextXs.length, next.mult, after.p);
        if (reason) {
          cashOut(next);
          return;
        }
        track({ type: 'checkpoint', multiplier: next.mult, winChance: after.p });
        setPhase('checkpoint');
      });
    },
    [rng, swingMs, fallMs, turbo, finish, cashOut, track, timers],
  );

  const start = useCallback(async () => {
    if (inRound || bet.blocked) return;
    if (!(await ticket.place(bet.value))) return;
    banked.current = RTP;
    const r: Round = { bet: bet.value, mode, xs: [], ps: [], mult: RTP };
    setRound(r);
    setTopple(null);
    setResult(null);
    dropNext(r);
  }, [inRound, bet.blocked, bet.value, ticket, mode, dropNext]);

  // Auto cash-out: keep dropping until the cash-out reaches the target.
  useEffect(() => {
    if (phase !== 'checkpoint' || !round || autoTarget <= 1) return;
    const id = setTimeout(() => (round.mult >= autoTarget ? cashOut(round) : dropNext(round)), turbo ? 150 : 450);
    return () => clearTimeout(id);
  }, [phase, round, autoTarget, turbo, cashOut, dropNext]);

  useHotkeys(
    {
      space: () => {
        if (phase === 'idle' || phase === 'over') void start();
        else if (phase === 'checkpoint' && round) dropNext(round);
      },
      cashOut: () => {
        if (phase === 'checkpoint' && round) cashOut(round);
      },
    },
    !infoOpen,
  );

  // Clears a finished round back to an empty board.
  const clear = () => {
    if (phase !== 'over') return;
    setPhase('idle');
    setRound(null);
    setTopple(null);
    setResult(null);
  };

  const pickMode = (m: Mode) => {
    setMode(m);
    clear();
  };

  const showRail = phase === 'idle' || phase === 'dropping' || phase === 'checkpoint';
  const nextMult = (round && phase !== 'idle' ? round.mult : RTP) / (odds.p || 1);
  const height = xs.length;
  const over = (phase === 'over' || phase === 'toppling') && result;

  let status = `Ready · up to ${spec.maxHeight} blocks`;
  let tone: 'idle' | 'live' | 'won' | 'lost' = 'idle';
  if (phase === 'dropping') {
    status = 'Dropping…';
    tone = 'live';
  } else if (phase === 'checkpoint') {
    status = `Height ${height} of ${spec.maxHeight}`;
    tone = 'live';
  } else if (over) {
    status = result.win ? `Cashed out · ${height} ${height === 1 ? 'block' : 'blocks'} high` : `Toppled on block ${height}`;
    tone = result.win ? 'won' : 'lost';
  }

  const readouts: ReadoutItem[] = [
    { label: 'Next drop stands', value: showRail ? fmtChance(odds.p) : '—', tone: 'chance' },
    { label: 'Next drop pays', value: showRail ? fmtMult(nextMult) : '—', tone: 'prize' },
  ];

  return (
    <GameLayout
      name="Overhang"
      accent={ACCENTS.amber}
      panel={
        <>
          <BetField bet={bet} disabled={inRound} />
          <Label>Volatility</Label>
          <Chips
            label="Volatility"
            options={MODE_NAMES.map((m) => ({ value: m, label: MODE_LABEL[m] }))}
            value={mode}
            disabled={inRound}
            onChange={pickMode}
          />
          <Label hint={autoTarget > 1 ? 'drops for you' : 'off'}>Auto cash-out</Label>
          <div className="ovh-auto">
            <input
              value={autoText}
              placeholder="Off"
              inputMode="decimal"
              aria-label="Auto cash-out multiplier"
              disabled={inRound}
              onChange={(e) => setAutoText(e.target.value)}
              onBlur={() => setAutoText((v) => (parseFloat(v) > 1 ? (parseFloat(v) || 0).toFixed(2) : ''))}
            />
            <span>×</span>
          </div>

          {!inRound && (
            <dl className="og-stats">
              <dt>Max win</dt>
              <dd>{fmtMult(spec.cap)}</dd>
            </dl>
          )}

          {phase === 'checkpoint' && round ? (
            <>
              <ActionButton kind="cash" onClick={() => cashOut(round)}>
                Cash out <span>{formatAmount(round.bet * round.mult, 2)}</span>
              </ActionButton>
              {/* Drop next sits where Bet was (the kit swaps the pair), so pressing the same spot keeps the round going. */}
              <ActionButton kind="secondary" onClick={() => dropNext(round)}>
                Drop next
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={inRound || !!bet.blocked} onClick={() => void start()}>
              {phase === 'dropping' ? 'Dropping…' : phase === 'toppling' ? 'Toppling…' : phase === 'over' ? 'Bet again' : 'Bet'}
            </ActionButton>
          )}
          {bet.blocked && !inRound && <p className="ovh-blocked">{bet.blocked}</p>}

          <PanelFoot turbo={turboState} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />
      <Readouts items={readouts} />

      <Board className="ovh-board">
        <Tower
          xs={xs}
          s={spec.s}
          rail={showRail ? odds : null}
          drop={drop}
          topple={topple}
          glow={over ? (result.win ? 'win' : 'lose') : null}
        />
      </Board>

      {phase === 'over' && result && round && (
        <RoundOver
          key={history[0]?.id}
          title={result.win ? 'Cashed out' : 'Toppled'}
          multiplier={result.mult}
          stake={round.bet}
          nextBet={bet.value}
          blocked={bet.blocked}
          onBetAgain={() => void start()}
          onClear={clear}
          placement="inline"
        />
      )}
      <Caption>Win if the dropped block’s centre lands in the green.</Caption>

      {infoOpen && (
        <InfoModal title="Overhang" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>Stack blocks as high as you dare. Each block that stays up raises your cash-out; a block that topples the tower loses the bet.</p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick a volatility and your bet, then press Bet. The first block drops at once.</li>
              <li>The green part of the rail is where the block's centre must land to stay up. A smaller green means a bigger payout.</li>
              <li>After each block, Cash out or Drop next. Auto cash-out keeps dropping until your target multiplier.</li>
              <li>Keys: Space bets or drops the next block, C cashes out, Esc clears a finished board.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Every drop pays the inverse of its chance of standing, so each step is a fair bet and the long-run return is {(RTP * 100).toFixed(0)}%.
              The top prize on {MODE_LABEL[mode]} is {fmtMult(spec.cap)}.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
