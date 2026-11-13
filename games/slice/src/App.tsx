import { formatAmount } from '@originals/game-sdk';
import { useHost } from '@originals/game-sdk/react';
import {
  ACCENTS,
  ActionButton,
  BetField,
  Board as BoardArea,
  Caption,
  Chips,
  GameLayout,
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
  type StatusTone,
} from '@originals/game-sdk/ui';
import { useEffect, useRef, useState } from 'react';
import Board, { type Blade } from './Board';
import InfoModal from './InfoModal';
import {
  CUT_OPTIONS,
  DEFAULT_CUTS,
  MODES,
  MODE_NAMES,
  RTP,
  cashMultiplier,
  chord,
  clampCentre,
  cutRound,
  isWin,
  newRound,
  radiusFor,
  sampleCut,
  type Mode,
  type Pt,
  type Round,
} from './math';

type Phase = 'idle' | 'cutting' | 'checkpoint' | 'over';
type Tone = 'neutral' | 'win' | 'lose';

/** How a finished round ended: its outcome, or the player cashing out. */
type Ending = { kind: 'cashout' | 'covered' | 'missed' | 'hit' | 'miss'; mult: number; stake: number };

const ENDING_TITLE: Record<Ending['kind'], string> = {
  cashout: 'Cashed out',
  covered: 'Covered',
  missed: 'Sliced away',
  hit: 'Inside',
  miss: 'Missed',
};

const MODE_LABEL: Record<Mode, string> = { low: 'Low', medium: 'Medium', high: 'High', extreme: 'Extreme' };

/** Eases a displayed number toward its target. */
function useTween(target: number, ms: number) {
  const [value, setValue] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    const from = current.current;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / Math.max(ms, 1));
      current.current = from + (target - from) * (1 - (1 - t) ** 3);
      setValue(current.current);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // Background tabs throttle frames: make sure the final value always lands.
    const done = setTimeout(() => {
      cancelAnimationFrame(raf);
      current.current = target;
      setValue(target);
    }, ms + 50);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(done);
    };
  }, [target, ms]);
  return value;
}

export default function App() {
  const { rng, track } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);

  const [mode, setMode] = useState<Mode>('medium');
  const [maxCuts, setMaxCuts] = useState<number>(DEFAULT_CUTS);
  const [centre, setCentre] = useState<Pt>({ x: 0.5, y: 0.5 });
  const [auto, setAuto] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState<Round | null>(null);
  const [blade, setBlade] = useState<Blade | null>(null);
  const [ending, setEnding] = useState<Ending | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: Tone }>({ text: 'Drag the circle, then bet', tone: 'neutral' });

  // A cut is drawn across the square at a readable pace in Manual (docs/STYLE.md), faster with Turbo.
  const bladeMs = eventMs(turbo.turbo);
  const fallMs = turbo.turbo ? 200 : 560;
  const autoPauseMs = turbo.turbo ? 140 : 520;

  // `resolved` is the open ticket's value right now, set synchronously at every
  // transition (RTP when the stake is placed, the post-cut value M x P' the
  // moment a cut is drawn, since the dot is already fixed). So leaving while
  // the blade animates settles at the cut's real result, never at the pre-cut
  // value. The ticket reads only this ref.
  const resolved = useRef(0);
  const ticket = useTicket(() => resolved.current);
  const stakeRef = useRef(0);
  const placing = useRef(false);
  const autoRef = useRef(auto);
  autoRef.current = auto;
  /** The round waiting at a checkpoint: the only one that can be cut again or cashed (null while cutting or over). */
  const waiting = useRef<Round | null>(null);

  const show = (r: Round | null) => setRound(r);

  function finish(r: Round, end: Omit<Ending, 'stake'>) {
    waiting.current = null;
    ticket.settle(end.mult);
    pushHistory(end.mult);
    setPhase('over');
    setEnding({ ...end, stake: stakeRef.current });
    const prize = fmtMult(end.mult);
    const text = {
      cashout: `Cashed out ${prize}`,
      covered: `Covered, you win ${prize}`,
      missed: 'Your circle was sliced away',
      hit: `Dot inside, you win ${prize}`,
      miss: 'Dot outside your circle',
    }[end.kind];
    setMessage({ text, tone: end.mult > 0 ? 'win' : 'lose' });
    show(r);
  }

  function cut(r: Round) {
    waiting.current = null;
    const c = sampleCut(r.region, rng);
    // The dot is already fixed, so the cut's result is known now.
    const next = cutRound(r, c);
    resolved.current = cashMultiplier(next);
    const [from, to] = chord(r.region, c);
    setBlade({ from, to, id: r.slices.length + 1 });
    setPhase('cutting');
    timers.after(bladeMs, () => {
      show(next);
      timers.after(fallMs, () => {
        setBlade(null);
        if (next.outcome !== 'live') {
          finish(next, { kind: next.outcome as Ending['kind'], mult: cashMultiplier(next) });
          return;
        }
        const mult = cashMultiplier(next);
        track({ type: 'checkpoint', multiplier: mult, winChance: next.chance });
        waiting.current = next;
        setPhase('checkpoint');
        setMessage({ text: 'Cash out or cut again', tone: 'neutral' });
        if (autoRef.current) timers.after(autoPauseMs, () => waiting.current === next && cut(next));
      });
    });
  }

  async function start() {
    if (placing.current || phase === 'cutting' || phase === 'checkpoint' || bet.blocked) return;
    placing.current = true;
    let placed = false;
    try {
      placed = await ticket.place(bet.value);
    } finally {
      placing.current = false;
    }
    if (!placed) return;
    stakeRef.current = bet.value;
    // A fresh round is worth M x pi r^2 = RTP until its first cut is drawn.
    resolved.current = RTP;
    // The dot is drawn up front, uniformly in the square, and never shown until the end.
    const r = newRound(mode, centre, maxCuts, { x: rng.next(), y: rng.next() });
    timers.clearAll();
    setEnding(null);
    setMessage({ text: 'Slicing…', tone: 'neutral' });
    show(r);
    cut(r);
  }

  const cashOut = () => {
    const r = waiting.current;
    if (!r) return;
    timers.clearAll();
    setAuto(false);
    autoRef.current = false;
    finish(r, { kind: 'cashout', mult: cashMultiplier(r) });
  };

  const cutAgain = () => {
    if (waiting.current) cut(waiting.current);
  };

  // Settings changes after a round clear its board back to a fresh preview.
  const reset = () => {
    if (phase !== 'over') return;
    setPhase('idle');
    show(null);
    setEnding(null);
    setMessage({ text: 'Drag the circle, then bet', tone: 'neutral' });
  };

  useHotkeys(
    {
      space: () => {
        if (phase === 'idle' || phase === 'over') void start();
        else cutAgain();
      },
      cashOut,
    },
    !infoOpen,
  );

  const inRound = phase === 'cutting' || phase === 'checkpoint';
  const r = radiusFor(mode);
  const preview = newRound(mode, centre, maxCuts, { x: 0, y: 0 });
  const shown = round ?? preview;
  const stake = inRound ? stakeRef.current : bet.value;
  const cashMult = phase === 'checkpoint' && round ? cashMultiplier(round) : 0;
  // Once the dot is known the chance snaps to 100% or 0% (a cash-out keeps the last value).
  const chance = phase === 'over' && ending && ending.kind !== 'cashout' ? (isWin(ending.kind) ? 1 : 0) : shown.chance;
  const shownChance = useTween(chance, fallMs);
  const tone: Tone = phase === 'over' && ending ? (ending.mult > 0 ? 'win' : 'lose') : 'neutral';
  const statusTone: StatusTone = tone === 'win' ? 'won' : tone === 'lose' ? 'lost' : inRound ? 'live' : 'idle';

  const readouts: ReadoutItem[] = [
    { label: 'Win chance', value: fmtChance(shownChance), tone: 'chance' },
    { label: 'If inside', value: fmtMult(shown.mult), tone: 'prize' },
  ];

  return (
    <GameLayout
      name="Slice"
      accent={ACCENTS.sky}
      panel={
        <>
          <BetField bet={bet} disabled={inRound} />

          <Label hint="smaller pays more">Circle size</Label>
          <Chips
            label="Circle size"
            value={mode}
            disabled={inRound}
            options={MODE_NAMES.map((m) => ({
              value: m,
              label: (
                <span className="slice-size">
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <rect x="1" y="1" width="18" height="18" rx="2" />
                    <circle cx="10" cy="10" r={radiusFor(m) * 18} />
                  </svg>
                  <span>{MODE_LABEL[m]}</span>
                  <b>{fmtMult(MODES[m].mult)}</b>
                </span>
              ),
            }))}
            onChange={(m) => {
              reset();
              setMode(m);
              setCentre((c) => clampCentre(c, radiusFor(m)));
            }}
          />

          <Label hint="before the reveal">Cuts</Label>
          <Chips
            label="Cuts"
            value={maxCuts}
            disabled={inRound}
            options={CUT_OPTIONS.map((n) => ({ value: n, label: n }))}
            onChange={(n) => {
              reset();
              setMaxCuts(n);
            }}
          />

          {/* In a round, Cut again sits where Bet was and Cash out goes below. */}
          {inRound ? (
            <>
              <ActionButton kind="secondary" disabled={phase !== 'checkpoint'} onClick={cutAgain}>
                {auto ? 'Auto-cutting…' : `Cut again · ${(round?.slices.length ?? 0) + 1} of ${shown.maxCuts}`}
              </ActionButton>
              <ActionButton kind="cash" disabled={phase !== 'checkpoint'} onClick={cashOut}>
                Cash out {phase === 'checkpoint' && <span>{formatAmount(stake * cashMult, 2)}</span>}
              </ActionButton>
            </>
          ) : (
            <ActionButton disabled={!!bet.blocked} onClick={() => void start()}>
              {phase === 'over' ? 'Bet again' : 'Bet'}
            </ActionButton>
          )}
          {bet.blocked && <p className="slice-blocked">{bet.blocked}</p>}

          <label className="og-toggle">
            <input
              type="checkbox"
              checked={auto}
              onChange={(e) => {
                setAuto(e.target.checked);
                autoRef.current = e.target.checked;
                if (e.target.checked) cutAgain();
              }}
            />
            <span>Auto-cut</span>
          </label>

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={message.text} tone={statusTone} history={history} />
      <Readouts items={readouts} />

      <BoardArea className="slice-board-area">
        <Board
          circle={shown.circle}
          region={shown.region}
          slices={shown.slices}
          blade={blade}
          dot={phase === 'over' ? shown.dot : null}
          dotTone={ending?.kind === 'cashout' ? 'neutral' : tone}
          editable={!inRound}
          showHandle={phase === 'idle'}
          onMove={(p) => {
            reset();
            setCentre(clampCentre(p, r));
          }}
          bladeMs={bladeMs}
          fallMs={fallMs}
        />
      </BoardArea>

      {phase === 'over' && ending && (
        <RoundOver
          key={history[0]?.id}
          placement="inline"
          title={ENDING_TITLE[ending.kind]}
          multiplier={ending.mult}
          stake={ending.stake}
          nextBet={bet.value}
          blocked={bet.blocked}
          onBetAgain={() => void start()}
          onClear={reset}
        />
      )}

      <Caption>Win if the hidden dot is inside your circle.</Caption>

      {infoOpen && <InfoModal rtp={RTP} onClose={() => setInfoOpen(false)} />}
    </GameLayout>
  );
}
