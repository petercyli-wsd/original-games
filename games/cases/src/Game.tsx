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
} from '@originals/game-sdk/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CaseIcon, multLabel } from './Item';
import {
  CASES,
  DIFFICULTIES,
  DIFFICULTY_NAMES,
  MAX_MULTIPLIER,
  RTP,
  WEIGHT_TOTAL,
  playRound,
  type RoundResult,
  profitChance,
  reelFor,
  topItem,
  volatilityOf,
  type Difficulty,
} from './math';
import { Reel } from './Reel';

const ACCENT = ACCENTS.pink;
const AUTO_STOPS = [0, 10, 50, 200] as const;

interface Last {
  id: number;
  stake: number;
  d: Difficulty;
  result: RoundResult;
  multiplier: number;
  duration: number;
}

type WaitOutcome = 'done' | 'skip' | 'cancel';

export default function Game() {
  const { rng } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);

  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [stopAt, setStopAt] = useState<number>(0);
  const [opening, setOpening] = useState(false);
  const [skip, setSkip] = useState(false);
  const [last, setLast] = useState<Last | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const seq = useRef(0);

  // The bet is decided before the reel moves, so leaving mid-spin settles at the real result.
  // A ticket only exists after the outcome is drawn (synchronously, right
  // after place() resolves), so the fair value is always the drawn result.
  const resolved = useRef(0);
  const ticket = useTicket(() => resolved.current);

  const skipFn = useRef<(() => void) | null>(null);
  function skippableWait(ms: number): Promise<WaitOutcome> {
    return new Promise((resolve) => {
      let settled = false;
      const fin = (v: WaitOutcome) => {
        if (settled) return;
        settled = true;
        skipFn.current = null;
        resolve(v);
      };
      skipFn.current = () => {
        setSkip(true);
        fin('skip');
      };
      void timers.wait(ms).then((ok) => fin(ok ? 'done' : 'cancel'));
    });
  }

  const autoRef = useRef<{ running: boolean; stop(): void } | null>(null);

  async function playOnce(stake: number): Promise<number | null> {
    if (!(await ticket.place(stake))) return null;
    const d = difficulty;
    const res = playRound(() => rng.next(), d);
    const inAuto = !!autoRef.current?.running;
    // A reel needs a little longer than a plain 600 ms event to read as a spin; Turbo is a quarter of the Manual time.
    const duration = eventMs(turbo.turbo || inAuto, 1800);
    resolved.current = res.multiplier;
    setSkip(false);
    setOpening(true);
    setLast({ id: ++seq.current, stake, d, result: res, multiplier: res.multiplier, duration });
    const outcome = await skippableWait(duration + 80);
    if (outcome === 'cancel') return null;
    if (outcome === 'skip') await timers.wait(230);
    ticket.settle(res.multiplier);
    pushHistory(res.multiplier);
    setOpening(false);
    if (stopAt > 0 && autoRef.current?.running && res.multiplier >= stopAt) autoRef.current.stop();
    return res.multiplier;
  }

  const auto = useAutoBet({ bet, play: playOnce, turbo: turbo.turbo });
  autoRef.current = auto;
  const busy = opening || auto.running;

  function betOrSkip() {
    if (opening) {
      if (auto.mode === 'manual') skipFn.current?.();
      return;
    }
    if (auto.mode === 'manual' && !busy && !bet.blocked) void playOnce(bet.value);
  }

  // A settings change clears the last result back to a preview of the new case.
  function change(apply: () => void) {
    if (busy) return;
    apply();
    setLast(null);
  }

  useHotkeys({ space: betOrSkip }, !infoOpen);

  // 1–4 pick the difficulty.
  useEffect(() => {
    if (infoOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.composedPath()[0] as HTMLElement | undefined;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = Number(e.key);
      if (k >= 1 && k <= DIFFICULTIES.length && !busy) {
        setDifficulty(DIFFICULTIES[k - 1]);
        setLast(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [infoOpen, busy]);

  // What the board shows: the last opening, or a preview of the chosen case.
  const shownD = last?.d ?? difficulty;
  const items = CASES[shownD];
  const mults = useMemo(() => items.map((it) => it.mult), [items]);
  const reel = useMemo(() => {
    if (last) return reelFor(last.d, last.result.index, last.result.u);
    // Preview: the slot under the marker is an unopened "?" card, so nothing reads as a result.
    return reelFor(difficulty, 0, 0.37 + DIFFICULTIES.indexOf(difficulty) * 0.05);
  }, [last, difficulty]);
  const phase = last ? (opening ? 'spinning' : 'done') : 'preview';

  // The odds bar marks the landed item(s) after the spin, until the next bet or a setting change.
  const hitSet = new Set(last && !opening ? [last.result.index] : []);
  const top = topItem(shownD);
  const pProfit = profitChance(difficulty);
  const vol = volatilityOf(difficulty);

  let status = `${DIFFICULTY_NAMES[difficulty]} case · up to ${multLabel(top.mult)}`;
  if (opening && last) status = `Opening ${DIFFICULTY_NAMES[last.d]} case…`;
  else if (last) status = `Landed ${fmtMult(last.multiplier)}`;
  const tone = opening ? 'live' : last ? (last.multiplier >= 1 ? 'won' : 'lost') : 'idle';

  return (
    <GameLayout
      name="Cases"
      accent={ACCENT}
      className="cs-game"
      panel={
        <>
          <ModeTabs auto={auto} disabled={opening} />
          <BetField bet={bet} disabled={busy} />

          <Label hint={<VolBadge level={vol} />}>Difficulty</Label>
          <Chips
            label="Difficulty"
            options={DIFFICULTIES.map((d, i) => ({ value: d, label: DIFFICULTY_NAMES[d], title: `${DIFFICULTY_NAMES[d]} (key ${i + 1}) · up to ${multLabel(topItem(d).mult)}` }))}
            value={difficulty}
            disabled={busy}
            onChange={(v) => change(() => setDifficulty(v))}
          />

          {auto.mode === 'manual' ? (
            opening ? (
              <ActionButton kind="secondary" onClick={() => skipFn.current?.()}>
                Skip <span className="cs-key">Space</span>
              </ActionButton>
            ) : (
              <ActionButton disabled={busy || !!bet.blocked} onClick={() => void playOnce(bet.value)}>
                Bet
              </ActionButton>
            )
          ) : (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || opening}>
              <Label hint="one case">Stop on a hit of</Label>
              <Chips
                label="Stop autobet on a hit of"
                options={AUTO_STOPS.map((s) => ({ value: s, label: s === 0 ? 'Off' : `${s}×+` }))}
                value={stopAt}
                disabled={auto.running}
                onChange={(v) => setStopAt(Number(v))}
              />
            </AutoBetControls>
          )}
          {bet.blocked && <p className="cs-blocked">{bet.blocked}</p>}

          <PanelFoot turbo={turbo} onInfo={() => setInfoOpen(true)} />
        </>
      }
    >
      <StageTop status={status} tone={tone} history={history} />

      <Readouts
        items={[
          { label: 'Chance to profit', value: fmtChance(pProfit), tone: 'chance' },
          { label: 'Top prize', value: multLabel(top.mult), tone: 'prize' },
        ]}
      />

      <Board className="cs-board">
        <InstantResult multiplier={last && !opening ? last.multiplier : null} stake={last?.stake ?? 0} id={last?.id ?? 0} />
        <div className="cs-case-head">
          <CaseIcon level={DIFFICULTIES.indexOf(shownD)} open={opening} />
          <b>{DIFFICULTY_NAMES[shownD]} case</b>
        </div>
        <div className="cs-reels n1">
          <Reel key={last?.id ?? 'p'} mults={mults} strip={reel.strip} jitter={reel.jitter} phase={phase} durationMs={last?.duration ?? 0} skip={skip} />
        </div>
        <Caption>Only the item that stops under the marker pays.</Caption>
      </Board>

      <div className="cs-oddsbar" role="img" aria-label="Item chances as shares of the bar: grey loses, green wins, pink is the top prize">
        {items.map((it, i) => {
          const share = it.weight / WEIGHT_TOTAL;
          const cls = it.mult < 1 ? 'lose' : it.mult === top.mult ? 'top' : 'win';
          return (
            <i key={i} className={`${cls}${hitSet.has(i) ? ' hit' : ''}`} style={{ flexGrow: it.weight }} title={multLabel(it.mult)}>
              {it.mult >= 1 && share >= 0.09 ? multLabel(it.mult) : ''}
            </i>
          );
        })}
      </div>

      {infoOpen && (
        <InfoModal title="Cases" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>Open a case and win the item the reel stops on. Every item is a payout multiplier, from {fmtMult(0)} up to {fmtMult(MAX_MULTIPLIER)}.</p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick a difficulty (keys 1–4). Easy pays often but small; Expert is mostly empty, with a 10,000× top item.</li>
              <li>Press Bet (or Space). Press Space again to skip the reel. Use Auto for a series of bets, with an optional stop on a big hit.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              Every item in the {DIFFICULTY_NAMES[shownD]} case, with its exact chance:
            </p>
            <ul className="cs-list">
              {items.map((it, i) => (
                <li key={i}>
                  <b>{multLabel(it.mult)}</b>
                  <span>{((it.weight / WEIGHT_TOTAL) * 100).toFixed(it.weight < 100 ? 3 : it.weight < 1000 ? 2 : 1)}%</span>
                </li>
              ))}
            </ul>
            <p>
              The items scrolling past on the reel are decoration that shows off the whole case (rare items appear there more often than their real chances); only
              the one under the marker counts, at the chance listed. The tile that stops under the marker is outlined green when it pays 1× or more, red when it pays less.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Each case has integer weights out of {WEIGHT_TOTAL.toLocaleString('en-US')}, so P(item) = weight ÷ {WEIGHT_TOTAL.toLocaleString('en-US')} and RTP = Σ
              P(item) × multiplier = exactly {(RTP * 100).toFixed(0)}%. One case is opened per bet, so there is no cash-out and nothing to decide after the bet; the four
              difficulties share the same RTP and differ only in how the prizes are spread.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Every difficulty returns {(RTP * 100).toFixed(0)}% of stakes in the long run. The prize is drawn the moment you bet, before the reel
              moves; skipping or leaving mid-spin pays the same result.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
