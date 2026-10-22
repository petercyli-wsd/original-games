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
  fmtOneIn,
  useAutoBet,
  useBetInput,
  useHistory,
  useHotkeys,
  useTicket,
  useTimers,
  useTurbo,
} from '@originals/game-sdk/ui';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CaseIcon, Gem, multLabel } from './Item';
import {
  CASES,
  CASE_COUNTS,
  DIFFICULTIES,
  DIFFICULTY_NAMES,
  MAX_MULTIPLIER,
  RTP,
  TIER_NAMES,
  WEIGHT_TOTAL,
  playRound,
  profitChance,
  reelFor,
  tierOf,
  topItem,
  volatilityOf,
  type CaseCount,
  type Difficulty,
  type Opening,
} from './math';
import { Reel } from './Reel';

const ACCENT = '#f472b6';
const AUTO_STOPS = [0, 10, 50, 200] as const;

interface Last {
  id: number;
  stake: number;
  d: Difficulty;
  n: number;
  openings: Opening[];
  multiplier: number;
  durations: number[];
}

type WaitOutcome = 'done' | 'skip' | 'cancel';

export default function Game() {
  const { rng } = useHost();
  const bet = useBetInput();
  const turbo = useTurbo();
  const timers = useTimers();
  const [history, pushHistory] = useHistory(14);

  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [count, setCount] = useState<CaseCount>(1);
  const [stopAt, setStopAt] = useState<number>(0);
  const [opening, setOpening] = useState(false);
  const [skip, setSkip] = useState(false);
  const [last, setLast] = useState<Last | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const seq = useRef(0);

  // The bet is decided before the reel moves, so leaving mid-spin settles at the real result.
  const resolved = useRef(0);
  const ticket = useTicket(() => (opening ? resolved.current : 0));

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
    const n = count;
    const res = playRound(() => rng.next(), d, n);
    const inAuto = !!autoRef.current?.running;
    const base = turbo.turbo ? 800 : inAuto ? 1900 : 3600;
    const stagger = turbo.turbo ? 90 : inAuto ? 160 : 280;
    const durations = res.openings.map((_, r) => base + r * stagger);
    resolved.current = res.multiplier;
    setSkip(false);
    setOpening(true);
    setLast({ id: ++seq.current, stake, d, n, openings: res.openings, multiplier: res.multiplier, durations });
    const outcome = await skippableWait(durations[durations.length - 1] + 80);
    if (outcome === 'cancel') return null;
    if (outcome === 'skip') await timers.wait(230);
    ticket.settle(res.multiplier);
    pushHistory(res.multiplier);
    setOpening(false);
    if (stopAt > 0 && autoRef.current?.running && res.openings.some((o) => o.mult >= stopAt)) autoRef.current.stop();
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
  const reels = useMemo(() => {
    if (last) return last.openings.map((o) => reelFor(last.d, o.index, o.u));
    const top = CASES[difficulty].length - 1;
    return Array.from({ length: count }, (_, r) => reelFor(difficulty, top - r, 0.37 + 0.113 * r + DIFFICULTIES.indexOf(difficulty) * 0.05));
  }, [last, difficulty, count]);
  const phase = last ? (opening ? 'spinning' : 'done') : 'preview';
  const wonSet = new Set(last && !opening ? last.openings.map((o) => o.index) : []);

  const top = topItem(difficulty);
  const pProfit = profitChance(difficulty, count);
  const vol = volatilityOf(difficulty, count);
  const n = last?.n ?? count;

  let status = `${DIFFICULTY_NAMES[difficulty]} case · up to ${multLabel(top.mult)}`;
  if (opening && last) status = last.n > 1 ? `Opening ${last.n} ${DIFFICULTY_NAMES[last.d]} cases…` : `Opening ${DIFFICULTY_NAMES[last.d]} case…`;
  else if (last) {
    status =
      last.n > 1
        ? `${last.n} cases · average ${fmtMult(last.multiplier)}`
        : `${TIER_NAMES[tierOf(last.multiplier)]} · ${fmtMult(last.multiplier)}`;
  }
  const tone = opening ? 'live' : last ? (last.multiplier >= 1 ? 'won' : 'lost') : 'idle';

  let caption: ReactNode = 'Only the item that stops under the marker pays. Every item and its exact chance is listed below.';
  if (opening) caption = auto.mode === 'manual' ? 'Press Space or Skip to stop the reel now. The prize was drawn when you bet.' : 'Auto is opening cases…';
  else if (last && last.n > 1)
    caption = (
      <>
        ({last.openings.map((o) => multLabel(o.mult)).join(' + ')}) ÷ {last.n} = <b>{fmtMult(last.multiplier)}</b> on your {formatAmount(last.stake, 2)} stake
      </>
    );
  else if (last) {
    const it = CASES[last.d][last.openings[0].index];
    caption = (
      <>
        {TIER_NAMES[tierOf(it.mult)]} item <b>{fmtMult(it.mult)}</b> · {fmtChance(it.p)} chance ({fmtOneIn(it.p)})
      </>
    );
  }

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

          <Label hint="stake split evenly">Cases per bet</Label>
          <Chips
            label="Cases per bet"
            options={CASE_COUNTS.map((c) => ({ value: c, label: `${c}×`, title: `Open ${c} case${c > 1 ? 's' : ''}; you win the average` }))}
            value={count}
            disabled={busy}
            onChange={(v) => change(() => setCount(v))}
          />

          <dl className="og-stats">
            <dt>Chance to profit</dt>
            <dd>{fmtChance(pProfit)}</dd>
            <dt>Top prize</dt>
            <dd>
              {multLabel(top.mult)} · {formatAmount(bet.value * top.mult, 2)}
            </dd>
            {count > 1 && (
              <>
                <dt>Stake per case</dt>
                <dd>{formatAmount(bet.value / count, 2)}</dd>
              </>
            )}
            <dt>RTP</dt>
            <dd>{(RTP * 100).toFixed(2)}%</dd>
          </dl>

          {auto.mode === 'manual' ? (
            opening ? (
              <ActionButton kind="secondary" onClick={() => skipFn.current?.()}>
                Skip <span className="cs-key">Space</span>
              </ActionButton>
            ) : (
              <ActionButton disabled={busy || !!bet.blocked} onClick={() => void playOnce(bet.value)}>
                {count > 1 ? `Bet · open ${count}` : 'Bet'}
              </ActionButton>
            )
          ) : (
            <AutoBetControls auto={auto} disabled={!!bet.blocked || opening}>
              <Label hint="any single item">Stop on a hit of</Label>
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

      <Board className="cs-board">
        <InstantResult multiplier={last && !opening ? last.multiplier : null} stake={last?.stake ?? 0} id={last?.id ?? 0} />
        {reels.length <= 2 && (
          <div className="cs-case-head">
            <CaseIcon level={DIFFICULTIES.indexOf(shownD)} shaking={opening} />
            <div>
              <b>{DIFFICULTY_NAMES[shownD]} case</b>
              <span>
                {items.length} items · up to {multLabel(topItem(shownD).mult)} · {fmtChance(profitChance(shownD, n))} to profit
              </span>
            </div>
          </div>
        )}
        <div className={`cs-reels n${reels.length}`}>
          {reels.map((r, i) => (
            <Reel
              key={`${last?.id ?? 'p'}-${i}`}
              mults={mults}
              strip={r.strip}
              jitter={r.jitter}
              phase={phase}
              durationMs={last?.durations[i] ?? 0}
              skip={skip}
            />
          ))}
        </div>
        <p className="cs-caption">{caption}</p>
      </Board>

      <section className="cs-contents" aria-label="Case contents">
        <div className="cs-contents-head">
          <h3>
            {DIFFICULTY_NAMES[shownD]} case <span>· {items.length} items</span>
          </h3>
          <span className="cs-contents-sub">
            {n > 1 ? `${n} cases, ` : ''}profit {fmtChance(profitChance(shownD, n))} · RTP {(RTP * 100).toFixed(0)}%
          </span>
        </div>
        <div className="cs-oddsbar" role="img" aria-label="Item chances as shares of the bar">
          {items.map((it, i) => (
            <i key={i} className={`t-${tierOf(it.mult)}` + (wonSet.has(i) ? ' won' : '')} style={{ flexGrow: it.weight }} title={`${multLabel(it.mult)} · ${fmtChance(it.p)}`} />
          ))}
        </div>
        <ul className="cs-list">
          {items.map((it, i) => (
            <li key={i} className={`t-${tierOf(it.mult)}` + (wonSet.has(i) ? ' won' : '')}>
              <Gem mult={it.mult} />
              <b>{multLabel(it.mult)}</b>
              <span>{((it.weight / WEIGHT_TOTAL) * 100).toFixed(it.weight < 100 ? 3 : it.weight < 1000 ? 2 : 1)}%</span>
            </li>
          ))}
        </ul>
      </section>

      {infoOpen && (
        <InfoModal title="Cases" onClose={() => setInfoOpen(false)}>
          <InfoSection title="Goal">
            <p>Open a case and win the item the reel stops on. Every item is a payout multiplier, from {fmtMult(0)} up to {fmtMult(MAX_MULTIPLIER)}.</p>
          </InfoSection>
          <InfoSection title="How to play">
            <ol>
              <li>Pick a difficulty (keys 1–4). Easy pays often but small; Expert is mostly empty, with a 1,000× top item.</li>
              <li>Choose how many cases each bet opens. Your stake is split evenly between them and you win the average of the items.</li>
              <li>Press Bet (or Space). Press Space again to skip the reel. Use Auto for a series of bets, with an optional stop on a big hit.</li>
            </ol>
          </InfoSection>
          <InfoSection title="Reading the odds">
            <p>
              The contents panel lists every item with its exact chance; the coloured bar splits into those same shares. Colours mark rarity: grey under 1×, blue
              1–2×, violet 2–5×, pink 5–20×, orange 20–100× and gold 100× and up. The items scrolling past on the reel are decoration; only the one under the marker
              counts.
            </p>
          </InfoSection>
          <InfoSection title="The maths">
            <p>
              Each case has integer weights out of {WEIGHT_TOTAL.toLocaleString('en-US')}, so P(item) = weight ÷ {WEIGHT_TOTAL.toLocaleString('en-US')} and RTP = Σ
              P(item) × multiplier = exactly {(RTP * 100).toFixed(0)}%. Opening n cases pays the average (m₁ + … + mₙ) ÷ n; by linearity of expectation that still
              returns {(RTP * 100).toFixed(0)}%, while the swings shrink by √n.
            </p>
          </InfoSection>
          <InfoSection title="Payouts and fairness">
            <p>
              Every difficulty and every case count returns {(RTP * 100).toFixed(0)}% of stakes in the long run. The prize is drawn the moment you bet, before the reel
              moves; skipping or leaving mid-spin pays the same result.
            </p>
          </InfoSection>
        </InfoModal>
      )}
    </GameLayout>
  );
}
