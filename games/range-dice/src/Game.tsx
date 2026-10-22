import { formatAmount } from '@originals/game-sdk';
import { useHost } from '@originals/game-sdk/react';
import {
  ActionButton,
  AutoBetControls,
  BetField,
  Board,
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
import { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_RANGE,
  MAX_CHANCE,
  MAX_MULTIPLIER,
  MIN_CHANCE,
  PRESETS,
  RTP,
  SIZE,
  chanceOf,
  flip,
  multiplierForWins,
  multiplierOf,
  playBet,
  setEnd,
  volatilityOf,
  winCount,
  winsForChance,
  winsForMultiplier,
  withWins,
  type Direction,
  type Range,
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

/** A text box that edits a number and commits on blur or Enter. */
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
    <label className="rd-field">
      <span>{label}</span>
      <div className="rd-input">
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
        {suffix && <b>{suffix}</b>}
      </div>
    </label>
  );
}

export default function Game() {
  const { rng } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);

  const [range, setRange] = useState<Range>(DEFAULT_RANGE);
  const [rolling, setRolling] = useState(false);
  const [last, setLast] = useState<Last | null>(null);
  const [marker, setMarker] = useState<Marker | null>(null);
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  const [infoOpen, setInfoOpen] = useState(false);
  const seq = useRef(0);
  const markerPos = useRef(SIZE / 2);
  const frame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const resolved = useRef(0);
  const ticket = useTicket(() => (rolling ? resolved.current : 0));

  const wins = winCount(range);
  const chance = chanceOf(range);
  const multiplier = multiplierOf(range);
  const level = volatilityOf(chance);
  const animMs = turbo.turbo ? 140 : 560;

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
    const r = range;
    const { result, win, multiplier: mult } = playBet(r, rng.next());
    resolved.current = mult;
    const id = ++seq.current;
    setRolling(true);
    setLast(null);
    sweep(result, animMs);
    await timers.wait(animMs + 20);
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
  const busy = rolling || auto.running;

  /** Any settings change clears the last result off the board. */
  function update(next: Range) {
    if (busy) return;
    setRange(next);
    if (last || marker || ghosts.length) {
      setLast(null);
      setMarker(null);
      setGhosts([]);
      markerPos.current = SIZE / 2;
    }
  }
  const setDir = (dir: Direction) => {
    if (dir !== range.dir) update(flip(range));
  };

  const canBet = auto.mode === 'manual' && !busy && !bet.blocked;
  useHotkeys({ space: () => (canBet ? void playOnce(bet.value) : undefined) }, !infoOpen);

  // X flips Roll in / Roll out (ignored while typing).
  const flipRef = useRef(() => {});
  flipRef.current = () => update(flip(range));
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

  const presetOn = PRESETS.find((m) => wins === winsForMultiplier(m));
  const rangeText = `${fmtN(range.low)}–${fmtN(range.high)}`;

  return (
    <GameLayout
      name="Range Dice"
      accent="#06b6d4"
      panel={
        <>
          <ModeTabs auto={auto} disabled={rolling} />
          <BetField bet={bet} disabled={busy} />
          <Label hint={`${fmtMult(multiplier)} payout`}>Profit on win</Label>
          <div className="rd-profit">+{formatAmount(Math.max(0, bet.value * multiplier - bet.value), 2)}</div>

          <Label hint="X to swap">Roll</Label>
          <Chips<Direction>
            label="Roll in or out of the range"
            value={range.dir}
            disabled={busy}
            onChange={setDir}
            options={[
              { value: 'in', label: 'Roll in', title: 'Win when the number lands inside the range' },
              { value: 'out', label: 'Roll out', title: 'Win when the number lands outside the range' },
            ]}
          />
          <Label hint={<VolBadge level={level} />}>Quick payout</Label>
          <div className="rd-presets">
            <Chips<number>
              label="Quick payout"
              wrap
              value={presetOn ?? -1}
              disabled={busy}
              onChange={(m) => update(withWins(range, winsForMultiplier(m)))}
              options={PRESETS.map((m) => ({ value: m, label: `${m}×` }))}
            />
          </div>
          <dl className="og-stats">
            <dt>Chance to win</dt>
            <dd>{fmtChance(chance)}</dd>
            <dt>Winning numbers</dt>
            <dd>
              {wins.toLocaleString('en-US')} / {SIZE.toLocaleString('en-US')}
            </dd>
          </dl>

          {auto.mode === 'manual' ? (
            <ActionButton disabled={busy || !!bet.blocked} onClick={() => void playOnce(bet.value)}>
              {rolling ? 'Rolling…' : 'Bet'}
            </ActionButton>
          ) : (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || rolling}>
              <p className="rd-auto-note">
                Each bet rolls {range.dir} {rangeText} at {fmtMult(multiplier)}.
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
              ? `Rolled ${fmtN(last.result)} · ${last.win ? 'win' : 'loss'}`
              : `Roll ${range.dir === 'in' ? 'inside' : 'outside'} ${rangeText}`
        }
        tone={rolling ? 'live' : last ? (last.win ? 'won' : 'lost') : 'idle'}
        history={history}
      />

      <Board className="rd-board">
        <InstantResult multiplier={last && !rolling ? last.multiplier : null} stake={last?.stake ?? 0} id={last?.id ?? 0} />
        <div className="rd-wrap">
          <RangeTrack range={range} onChange={update} disabled={busy} marker={marker} ghosts={ghosts} />
          <div className="rd-legend" aria-hidden="true">
            <span className="w">Win {fmtChance(chance)}</span>
            <span className="rng">
              {range.dir === 'in' ? 'Inside' : 'Outside'} {rangeText}
            </span>
            <span className="l">Lose {fmtChance(1 - chance)}</span>
          </div>
          <p className="rd-caption">
            Green covers {wins.toLocaleString('en-US')} of the 10,000 numbers: your exact chance. Payout {fmtMult(multiplier)} ={' '}
            {(RTP * 100).toFixed(0)} ÷ {(chance * 100).toFixed(2)}.
          </p>
        </div>
      </Board>

      <div className="rd-inputs">
        <LinkedInput label="Low" value={fmtN(range.low)} disabled={busy} onCommit={(v) => update(setEnd(range, 'low', v))} />
        <LinkedInput label="High" value={fmtN(range.high)} disabled={busy} onCommit={(v) => update(setEnd(range, 'high', v))} />
        <LinkedInput
          label="Multiplier"
          value={multiplier.toFixed(4)}
          suffix="×"
          disabled={busy}
          onCommit={(m) => m > 0 && update(withWins(range, winsForMultiplier(m)))}
        />
        <LinkedInput
          label="Win chance"
          value={(chance * 100).toFixed(2)}
          suffix="%"
          disabled={busy}
          onCommit={(c) => update(withWins(range, winsForChance(c)))}
        />
      </div>

      {infoOpen && (
        <InfoModal title="Range Dice" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>A number from 0000 to 9999 is rolled. Bet that it lands inside your range (Roll in) or outside it (Roll out).</p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Drag the two handles to set the range, or drag the band between them to slide it. Arrow keys nudge a focused handle (Shift for 100).</li>
              <li>Or type Low, High, a multiplier or a win chance: the others follow, keeping the range centred.</li>
              <li>Pick Roll in or Roll out (X swaps). The range stays put; the win zone flips.</li>
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
              10,000 − (high − low + 1). The expected return is P × {RTP} ÷ P = {RTP} for every range and direction.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Every bet returns {(RTP * 100).toFixed(0)}% of stakes in the long run; the range only sets how often you win and how much. Chance runs from{' '}
              {MIN_CHANCE.toFixed(2)}% ({MAX_MULTIPLIER.toLocaleString('en-US')}×) to {MAX_CHANCE}% ({fmtMult(multiplierForWins(9800))}), the payout is not
              rounded, and the number is drawn before the marker moves.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
