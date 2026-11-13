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
import {
  DEFAULT_CONFIG,
  MAX_CHANCE,
  MAX_MULTIPLIER,
  RTP,
  SIZE,
  chanceOf,
  maxMultiplierOf,
  multiplierForWins,
  multiplierOf,
  nextMode,
  playBet,
  setEnd,
  setMode,
  volatilityOf,
  winsForChance,
  winsForMultiplier,
  withWins,
  type Config,
  type EndKey,
  type Mode,
} from './math';
import RangeTrack, { fmtN, type Ghost, type Marker } from './RangeTrack';

interface Last {
  id: number;
  result: number;
  win: boolean;
  multiplier: number;
  stake: number;
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/** A panel number field that edits one linked value and commits on blur or Enter. */
function LinkedInput({
  label,
  value,
  suffix,
  disabled,
  onCommit,
}: {
  label: string;
  value: string;
  suffix?: string;
  disabled?: boolean;
  onCommit(v: number): void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    const v = parseFloat(text.replace(/,/g, ''));
    if (Number.isFinite(v)) onCommit(v);
    setText(value);
  };
  return (
    <div className="rd-field">
      <Label>{label}</Label>
      <div className="og-num-field">
        <input
          value={text}
          inputMode="decimal"
          disabled={disabled}
          aria-label={label}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
        {suffix && <span className="og-num-suffix">{suffix}</span>}
      </div>
    </div>
  );
}

export default function Game() {
  const { rng } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);

  const [range, setRange] = useState<Config>(DEFAULT_CONFIG);
  const [rolling, setRolling] = useState(false);
  const [last, setLast] = useState<Last | null>(null);
  const [marker, setMarker] = useState<Marker | null>(null);
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  const [infoOpen, setInfoOpen] = useState(false);
  const seq = useRef(0);
  const markerPos = useRef(SIZE / 2);
  const frame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  // The open ticket's value, set synchronously the moment the roll is drawn
  // (right after the bet is accepted). The ticket reads only this ref: the
  // rendered `rolling` flag can be one render stale, which settled a winning
  // roll at 0 if the game unmounted before the next render.
  const resolved = useRef(0);
  const ticket = useTicket(() => resolved.current);

  const chance = chanceOf(range);
  const multiplier = multiplierOf(range);
  const level = volatilityOf(chance);
  // Manual rolls sweep for a readable 600 ms; Turbo and Auto take about a quarter of that (set below, once auto is known).
  const animRef = useRef(eventMs(turbo.turbo));

  /** Sweeps the marker to the drawn number, counting up on the way. */
  function sweep(to: number, ms: number) {
    cancelAnimationFrame(frame.current);
    const from = markerPos.current;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const pos = from + (to + 0.5 - from) * easeOut(t);
      markerPos.current = pos;
      setMarker({ pos, value: Math.min(SIZE - 1, Math.max(0, Math.floor(pos))), tone: 'moving', id: seq.current });
      if (t < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }

  async function playOnce(stake: number): Promise<number | null> {
    if (!(await ticket.place(stake))) return null;
    resolved.current = RTP;
    const r = range;
    const { result, win, multiplier: mult } = playBet(r, rng.next());
    resolved.current = mult;
    const id = ++seq.current;
    setRolling(true);
    setLast(null);
    sweep(result, animRef.current);
    await timers.wait(animRef.current + 20);
    cancelAnimationFrame(frame.current);
    markerPos.current = result + 0.5;
    setMarker({ pos: result + 0.5, value: result, tone: win ? 'win' : 'lose', id });
    setLast({ id, result, win, multiplier: mult, stake });
    setGhosts((g) => [{ id, n: result, win }, ...g].slice(0, 8));
    ticket.settle(mult);
    pushHistory(mult);
    setRolling(false);
    return mult;
  }

  const auto = useAutoBet({ bet, play: playOnce, turbo: turbo.turbo });
  animRef.current = eventMs(turbo.turbo || auto.running);
  const busy = rolling || auto.running;

  /** Any settings change clears the last result off the board. */
  function update(next: Config) {
    if (busy) return;
    setRange(next);
    if (last || marker || ghosts.length) {
      setLast(null);
      setMarker(null);
      setGhosts([]);
      markerPos.current = SIZE / 2;
    }
  }
  const setDir = (mode: Mode) => update(setMode(range, mode));

  const canBet = auto.mode === 'manual' && !busy && !bet.blocked;
  useHotkeys({ space: () => (canBet ? void playOnce(bet.value) : undefined) }, !infoOpen);

  // X cycles Roll in / Roll out / Roll between two (ignored while typing).
  const flipRef = useRef(() => {});
  flipRef.current = () => update(setMode(range, nextMode(range.mode)));
  useEffect(() => {
    if (infoOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.composedPath()[0] as HTMLElement | undefined;
      if (t?.tagName === 'INPUT' && (t as HTMLInputElement).type === 'text') return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (e.key === 'x' || e.key === 'X') flipRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [infoOpen]);

  const rangeText =
    `${fmtN(range.low)}–${fmtN(range.high)}` + (range.mode === 'two' ? `, ${fmtN(range.low2)}–${fmtN(range.high2)}` : '');
  const modeWord = range.mode === 'in' ? 'inside' : range.mode === 'out' ? 'outside' : 'in';
  const fieldOf = (k: EndKey, label: string) => (
    <LinkedInput
      key={k}
      label={label}
      value={fmtN(range[k])}
      disabled={busy}
      onCommit={(v) => update(setEnd(range, k, Math.round(v * 100)))}
    />
  );

  return (
    <GameLayout
      name="Range Dice"
      accent={ACCENTS.sky}
      panel={
        <>
          <ModeTabs auto={auto} disabled={rolling} />
          <BetField bet={bet} disabled={busy} />
          <Label hint={`${fmtMult(multiplier)} payout`}>Profit on win</Label>
          <div className="rd-profit">+{formatAmount(Math.max(0, bet.value * multiplier - bet.value), 2)}</div>

          <Label hint={<VolBadge level={level} />}>Roll (X to swap)</Label>
          <Chips<Mode>
            label="Roll in, out, or between two ranges"
            wrap
            value={range.mode}
            disabled={busy}
            onChange={setDir}
            options={[
              { value: 'in', label: 'Roll in', title: 'Win when the number lands inside the range' },
              { value: 'out', label: 'Roll out', title: 'Win when the number lands outside the range' },
              { value: 'two', label: 'Between two', title: 'Win when the number lands inside either of two ranges' },
            ]}
          />
          {range.mode === 'two' ? (
            <>
              <div className="rd-pair">
                {fieldOf('low', 'Low 1')}
                {fieldOf('high', 'High 1')}
              </div>
              <div className="rd-pair">
                {fieldOf('low2', 'Low 2')}
                {fieldOf('high2', 'High 2')}
              </div>
            </>
          ) : (
            <div className="rd-pair">
              {fieldOf('low', 'Low')}
              {fieldOf('high', 'High')}
            </div>
          )}
          <div className="rd-pair">
            <LinkedInput
              label="Multiplier"
              value={multiplier.toFixed(4)}
              suffix="×"
              disabled={busy}
              onCommit={(m) => m > 0 && update(withWins(range, winsForMultiplier(range.mode, m)))}
            />
            <LinkedInput
              label="Win chance"
              value={(chance * 100).toFixed(2)}
              suffix="%"
              disabled={busy}
              onCommit={(c) => update(withWins(range, winsForChance(range.mode, c)))}
            />
          </div>

          {auto.mode === 'manual' ? (
            <ActionButton disabled={busy || !!bet.blocked} onClick={() => void playOnce(bet.value)}>
              {rolling ? 'Rolling…' : 'Bet'}
            </ActionButton>
          ) : (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || rolling}>
              <p className="rd-auto-note">
                {`Each bet: ${modeWord} ${rangeText}`}
              </p>
            </AutoBetControls>
          )}
          {bet.blocked && <p className="rd-blocked">{bet.blocked}</p>}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop
        status={
          rolling
            ? 'Rolling…'
            : last
              ? `Rolled ${fmtN(last.result)}, ${last.win ? 'win' : 'loss'}`
              : `Roll ${modeWord} ${rangeText}`
        }
        tone={rolling ? 'live' : last ? (last.win ? 'won' : 'lost') : 'idle'}
        history={history}
      />

      <Board className="rd-board">
        <InstantResult multiplier={last && !rolling ? last.multiplier : null} stake={last?.stake ?? 0} id={last?.id ?? 0} />
        <div className="rd-wrap">
          <RangeTrack range={range} onChange={update} disabled={busy} marker={marker} ghosts={ghosts} />
          <Caption>Win if the roll lands on the green part of the track.</Caption>
        </div>
      </Board>

      {infoOpen && (
        <InfoModal title="Range Dice" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>
              A number from 0.00 to 99.99 is rolled. Bet that it lands inside your range (Roll in), outside it (Roll out), or inside either of two
              separate ranges (Roll between two).
            </p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Drag the handles (two, or four in Roll between two) to set the ranges, or drag a band to slide it. Arrow keys nudge a focused handle (Shift for 100).</li>
              <li>Or type a Low, a High, a multiplier or a win chance: the others follow, keeping the ranges centred.</li>
              <li>Pick Roll in, Roll out or Roll between two (X cycles). The first range stays put; the win zone changes.</li>
              <li>Press Bet (or Space). Auto runs a series of bets on the same range with your stop rules.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The track has 10,000 equal cells, one per number. Green cells win, red cells lose, so the green share of the track is exactly your chance.
              Faint ticks show the last few rolls on this range.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              With W winning numbers, the chance is P = W ÷ 10,000 and a win pays {RTP} ÷ P = 9,900 ÷ W. Roll in: W = high − low + 1. Roll out: W =
              10,000 − (high − low + 1). Roll between two: W = the two range sizes added. The expected return is P × {RTP} ÷ P = {RTP} for every range and direction.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Every bet returns {(RTP * 100).toFixed(0)}% of stakes in the long run; the range only sets how often you win and how much. Chance runs from 0.01% ({MAX_MULTIPLIER.toLocaleString('en-US')}×, Roll in)
              or 0.02% ({maxMultiplierOf('out').toLocaleString('en-US')}×, Roll out and Roll between two) up to {MAX_CHANCE}% ({fmtMult(multiplierForWins(9800))}).
              The payout is not rounded, and the number is drawn before the marker moves.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
